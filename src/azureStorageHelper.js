import { BlobServiceClient } from '@azure/storage-blob';

/**
 * Helper class for Azure Blob Storage operations
 */
export class AzureStorageHelper {
    /**
     * Constructor
     * @param {string} connectionString - Azure Storage connection string
     */
    constructor(connectionString) {
        if (!connectionString) {
            console.error('Azure Storage connection string not provided');
            throw new Error('Azure Storage connection string not provided');
        }
        this.blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
    }

    /**
     * Get container client
     * @param {string} containerName - Container name
     * @returns {ContainerClient} Container client
     */
    getContainerClient(containerName) {
        return this.blobServiceClient.getContainerClient(containerName);
    }

    /**
     * Ensure container exists
     * @param {string} containerName - Container name
     * @returns {Promise<boolean>} True if container exists or was created
     */
    async ensureContainer(containerName) {
        try {
            const containerClient = this.getContainerClient(containerName);
            const createResponse = await containerClient.createIfNotExists();
            if (createResponse.succeeded) {
                console.log(`Container "${containerName}" created`);
            } else {
                console.log(`Container "${containerName}" already exists`);
            }
            return true;
        } catch (error) {
            console.error(`Error ensuring container "${containerName}" exists:`, error);
            return false;
        }
    }

    /**
     * Retrieve items from blob storage
     * @param {string} containerName - Container name
     * @param {Object} options - Options for retrieving items
     * @param {number} options.maxItems - Maximum number of items to retrieve
     * @param {function} options.filterFn - Filter function for items
     * @returns {Promise<Array>} Array of items
     */
    async getItems(containerName, options = {}) {
        try {
            const containerClient = this.getContainerClient(containerName);
            const maxItems = options.maxItems || 10000;

            const items = [];
            let processedCount = 0;

            console.log(`Retrieving up to ${maxItems} items from container: ${containerName}`);

            // Use maxPageSize to limit the number of items retrieved per request
            const blobIterable = containerClient.listBlobsFlat({ maxPageSize: maxItems });
            let iterator = blobIterable[Symbol.asyncIterator]();

            // Only process up to maxItems blobs
            while (items.length < maxItems) {
                const { value: blob, done } = await iterator.next();
                if (done) break;

                processedCount++;
                console.log(`Processing blob ${processedCount}: ${blob.name}`);

                try {
                    const blobClient = containerClient.getBlobClient(blob.name);
                    const downloadResponse = await blobClient.download();

                    // Process the content using a buffer
                    const chunks = [];
                    for await (const chunk of downloadResponse.readableStreamBody) {
                        chunks.push(chunk);
                    }

                    const content = Buffer.concat(chunks).toString('utf-8');
                    const item = JSON.parse(content);

                    items.push(item);
                    console.log(`Added item ${items.length} of ${maxItems} (from blob: ${blob.name})`);

                    // Stop if we've collected enough items
                    if (items.length >= maxItems) {
                        console.log(`Reached maximum items (${maxItems}), stopping blob enumeration`);
                        break;
                    }

                } catch (e) {
                    console.error(`Error processing blob ${blob.name}:`, e);
                }
            }

            console.log(`Retrieved ${items.length} items from ${processedCount} processed blobs in container: ${containerName}`);
            return items;
        } catch (error) {
            console.error(`Error retrieving items from container ${containerName}:`, error);
            return [];
        }
    }

    /**
     * Upload item to blob storage
     * @param {string} containerName - Container name
     * @param {string} blobName - Blob name
     * @param {Object} data - Data to upload
     * @returns {Promise<boolean>} True if upload succeeded
     */
    async uploadItem(containerName, blobName, data) {
        try {
            // await this.ensureContainer(containerName);

            const containerClient = this.getContainerClient(containerName);
            const blockBlobClient = containerClient.getBlockBlobClient(blobName);

            // Check if blob exists
            const exists = await blockBlobClient.exists();
            if (exists) {
                console.log(`Blob "${blobName}" already exists in container "${containerName}"`);
                return true;
            }

            // Convert data to JSON string
            const content = JSON.stringify(data);

            // Upload content
            await blockBlobClient.upload(content, content.length, {
                blobHTTPHeaders: { blobContentType: 'application/json' }
            });

            console.log(`Uploaded blob "${blobName}" to container "${containerName}"`);
            return true;
        } catch (error) {
            console.error(`Error uploading blob "${blobName}" to container "${containerName}":`, error);
            return false;
        }
    }

    /**
     * Upload multiple items to blob storage
     * @param {string} containerName - Container name
     * @param {Array<{name: string, data: Object}>} items - Array of items to upload
     * @returns {Promise<number>} Number of items successfully uploaded
     */
    async uploadItems(containerName, items) {
        try {
            // await this.ensureContainer(containerName);

            let successCount = 0;
            const batchSize = 25;

            for (let i = 0; i < items.length; i += batchSize) {
                const batch = items.slice(i, i + batchSize);
                const results = await Promise.allSettled(batch.map(async (item) => {
                    return this.uploadItem(containerName, item.name, item.data);
                }));

                successCount += results.filter(r => r.status === 'fulfilled' && r.value).length;

                console.log(`Processed batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(items.length / batchSize)}`);
            }

            return successCount;
        } catch (error) {
            console.error(`Error uploading items to container ${containerName}:`, error);
            return 0;
        }
    }
}
