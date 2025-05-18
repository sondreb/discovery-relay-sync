import WebSocket from 'ws';
import { nanoid } from 'nanoid';
import { AzureStorageHelper } from './azureStorageHelper.js';
const { Negentropy, NegentropyStorageVector } = await import('./Negentropy.cjs');

export class NegentropySync {
    constructor(config) {
        this.config = config;
        
        if (this.config.conn) {
            try {
                this.storageHelper = new AzureStorageHelper(this.config.conn);
            } catch (error) {
                console.error('Error initializing Azure Storage:', error);
            }
        }
    }

    async getItemsFromBlobStorage() {
        if (!this.storageHelper) {
            console.error('Azure Storage helper not initialized');
            return [];
        }

        try {
            const containerName = this.config.containerName || 'nostr-events';
            
            // Get items with ID and timestamp
            return await this.storageHelper.getItems(containerName, {
                maxItems: 1000,
                filterFn: (item) => item.id && item.timestamp
            });
        } catch (error) {
            console.error('Error retrieving items from Azure Blob Storage:', error);
            return [];
        }
    }
    
    async sync() {
        console.log('Running in sync mode with WebSockets...');

        // Retrieve items from Azure Blob Storage instead of hardcoding
        const myItems = await this.getItemsFromBlobStorage();

        console.log(`Retrieved ${myItems.length} items from Azure Blob Storage`);
        
        // If no items were retrieved from Blob Storage, use a default item as fallback
        // if (myItems.length === 0) {
        //     console.log('No items found in Azure Blob Storage, using default item');
        //     myItems.push({ 
        //         id: '0000000000231b9b53f04f0ce3560f5cbcce30e4b9f49f327d2d7a9946cffba7', 
        //         timestamp: 1700000000 
        //     });
        // }

        let storage = new NegentropyStorageVector();
        for (let item of myItems) {
            storage.insert(item.timestamp, item.id);
        }

        storage.seal();

        console.log('Connecting to:', this.config.sourceRelays[0]);

        // Connect to the WebSocket server
        const socket = new WebSocket(this.config.sourceRelays[0]);
        
        // Wait for the connection to establish
        await new Promise((resolve, reject) => {
            socket.on('open', resolve);
            socket.on('error', reject);
        });

        // Implement the sync logic with WebSockets
        await this.negentropySync(
            storage,
            socket,
            this.config.filter || {
                kinds: [3, 10002],
                // limit: 10
            },
            this.handleReconcile.bind(this),
            { frameSizeLimit: 10000 }
            // { frameSizeLimit: 50_000 }
        );
    }

    async negentropySync(
        storage,
        socket,
        filter,
        reconcileCallback,
        opts = { frameSizeLimit: 10000 }
        // opts = { frameSizeLimit: 50_000 }
    ) {
        const id = nanoid();
        const ne = new Negentropy(storage, opts.frameSizeLimit);

        let initialMessage = await ne.initiate();
        let msg = initialMessage;

        console.log("Sending initial message", id, filter, initialMessage);
        
        // Send NEG-OPEN message to start the sync
        socket.send(JSON.stringify(["NEG-OPEN", id, filter, initialMessage]));

        // Set up message handler
        const messagePromises = [];
        let messageResolve;
        
        const messageHandler = (event) => {
            try {
                // Convert Buffer to string if needed
                const messageString = typeof event === 'string' ? event : 
                                     event instanceof Buffer ? event.toString('utf-8') : 
                                     typeof event.data === 'string' ? event.data : 
                                     Buffer.isBuffer(event.data) ? event.data.toString('utf-8') : 
                                     JSON.stringify(event.data);
                
                const data = JSON.parse(messageString);
                
                if ((data[0] === "NEG-MSG" || data[0] === "NEG-ERR") && data[1] === id) {
                    if (data[0] === "NEG-ERR") {
                        throw new Error(data[2]);
                    }
                    
                    if (messageResolve) {
                        messageResolve(data[2]);
                    }
                }
            } catch (err) {
                console.error("Error handling WebSocket message:", err, typeof event);
                if (event instanceof Buffer) {
                    console.error("Buffer content:", event.toString('utf-8'));
                } else if (event.data instanceof Buffer) {
                    console.error("Buffer content:", event.data.toString('utf-8'));
                }
            }
        };

        socket.on('message', messageHandler);

        try {
            while (msg && !opts.signal?.aborted) {
                // Create a promise for the next message
                const messagePromise = new Promise(resolve => {
                    messageResolve = resolve;
                });
                
                // Wait for the next message
                const received = await messagePromise;
                if (opts.signal?.aborted) return false;

                // Process the message
                const [newMsg, have, need] = await ne.reconcile(received);
                
                // Call the reconcile callback with the results
                await reconcileCallback(have, need);
                
                msg = newMsg;
                
                // If we have a new message to send, send it
                if (msg) {
                    socket.send(JSON.stringify(["NEG-MSG", id, msg]));
                }
            }
            
            // Send NEG-CLOSE message when done
            socket.send(JSON.stringify(["NEG-CLOSE", id]));
            return true;
        } finally {
            socket.off('message', messageHandler);
        }
    }
    
    async handleReconcile(have, need) {
        console.log("Handling reconciliation:", { have: have.length, need: need.length });

        console.log(need[0]);
        
        // Import "need" records into blob storage
        if (need && need.length > 0 && this.storageHelper) {
            try {
                const containerName = this.config.targetContainer || 'nostr-events';
                
                console.log(`Processing ${need.length} records for Azure Blob Storage container: ${containerName}`);
                
                let validEventsCount = 0;
                let uploadedCount = 0;
                
                // Ensure the container exists before processing events
                // await this.storageHelper.ensureContainer(containerName);
                
                for (const id of need) {
                    try {
                        // console.log(`Processing event with ID: ${id}`);
                        // Get the event from the relay to determine its kind
                        const event = await this.getEventFromRelay(id);

                        // console.log(`Fetched event with ID ${id}:`, event);
                        
                        // Only process events with kind 3 or 10002
                        if (event && (event.kind === 3 || event.kind === 10002)) {
                            // Format blob name as event.pubkey + "__" + event.kind
                            const blobName = `${event.pubkey}__${event.kind}`;
                            
                            // Upload the event immediately
                            console.log(`Uploading event ${event.id} with kind ${event.kind} to blob storage as ${blobName}`);
                            const success = await this.storageHelper.uploadItem(containerName, blobName, event);
                            
                            validEventsCount++;
                            if (success) {
                                uploadedCount++;
                            }
                        } else {
                            if (event) {
                                console.log(`Skipping event ${event.id} with kind ${event.kind} - not of interest`);
                            } else {
                                console.log(`Failed to retrieve event with ID ${id} from relay`);
                            }
                        }
                    } catch (err) {
                        console.error(`Error processing event with ID ${id}:`, err);
                    }
                }

                console.log(`Found ${validEventsCount} valid events (kinds 3 and 10002)`);
                console.log(`Successfully uploaded ${uploadedCount} of ${validEventsCount} valid events to Azure Blob Storage`);
                
                if (validEventsCount === 0) {
                    console.log('No valid events (kinds 3 and 10002) found to upload');
                }
            } catch (error) {
                console.error('Error importing records to Azure Blob Storage:', error);
            }
        }
    }
    
    // Helper method to fetch event from relay based on ID
    async getEventFromRelay(id) {
        try {
            // If we have a cache of events, use it
            if (this.eventCache && this.eventCache[id]) {
                return this.eventCache[id];
            }
            
            // Otherwise, query the relay for the event
            const relayUrl = this.config.sourceRelays[0];
            
            return new Promise((resolve, reject) => {
                const ws = new WebSocket(relayUrl);
                const timeout = setTimeout(() => {
                    ws.close();
                    reject(new Error(`Timeout getting event ${id}`));
                }, 10000); // 10 second timeout
                
                ws.on('open', () => {
                    // Send REQ message to get the event by ID
                    ws.send(JSON.stringify([
                        "REQ",
                        "get_event_" + id.substring(0, 8),
                        { ids: [id] }
                    ]));
                });
                
                ws.on('message', (rawData) => {
                    try {
                        const data = JSON.parse(rawData.toString());
                        
                        // Handle EVENT message
                        if (data && data[0] === "EVENT" && data[2] && data[2].id === id) {
                            clearTimeout(timeout);
                            ws.close();
                            resolve(data[2]);
                        }
                        
                        // Handle EOSE (end of stored events)
                        if (data && data[0] === "EOSE") {
                            clearTimeout(timeout);
                            ws.close();
                            resolve(null); // No matching event found
                        }
                    } catch (err) {
                        console.error('Error parsing relay response:', err);
                    }
                });
                
                ws.on('error', (error) => {
                    clearTimeout(timeout);
                    ws.close();
                    reject(error);
                });
                
                ws.on('close', () => {
                    clearTimeout(timeout);
                    resolve(null); // Connection closed without getting an event
                });
            });
        } catch (error) {
            console.error(`Error getting event ${id} from relay:`, error);
            return null;
        }
    }
}

// Helper function for stream to string conversion - more robust implementation
async function streamToString(readableStream) {
    return new Promise((resolve, reject) => {
        // Check if the stream exists and has the 'on' method
        if (!readableStream || typeof readableStream.on !== 'function') {
            if (readableStream && typeof readableStream.arrayBuffer === 'function') {
                // Handle Response object from fetch or similar
                readableStream.arrayBuffer()
                    .then(buffer => resolve(Buffer.from(buffer).toString('utf-8')))
                    .catch(reject);
                return;
            }
            
            // If it's already a string or buffer, convert/return it
            if (typeof readableStream === 'string') {
                resolve(readableStream);
                return;
            }
            
            if (Buffer.isBuffer(readableStream)) {
                resolve(readableStream.toString('utf-8'));
                return;
            }
            
            // Can't process this type
            reject(new Error(`Unsupported stream type: ${typeof readableStream}`));
            return;
        }
        
        const chunks = [];
        readableStream.on('data', (data) => {
            chunks.push(data.toString());
        });
        readableStream.on('end', () => {
            resolve(chunks.join(''));
        });
        readableStream.on('error', reject);
    });
}