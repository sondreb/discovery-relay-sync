// Import WebSocket from ws directly for Node.js environment
import WebSocket from 'ws';
// Make WebSocket available globally
global.WebSocket = WebSocket;

// Import SimplePool instead of Relay
import { SimplePool } from 'nostr-tools/pool';
import { useWebSocketImplementation } from 'nostr-tools/pool';
import { StatsTracker } from './statsTracker.js';

// Setup WebSocket for Node.js environment
useWebSocketImplementation(WebSocket);

export class RelayConnector {
  constructor(relayUrl, options = {}, logger, statsTracker) {
    this.url = relayUrl;
    this.options = {
      reconnectInterval: 5000,
      maxRetries: 10,
      ...options
    };
    this.logger = logger;
    this.connected = false;
    this.pool = new SimplePool();
    this.retryCount = 0;
    this.subscriptions = new Map();
    this.statsTracker = statsTracker || new StatsTracker();
    this.eventQueue = [];
  }

  async connect() {
    try {
      this.logger.debug(`Connecting to relay: ${this.url}`);
      // SimplePool doesn't have a direct connect method like Relay
      // Connection happens on first interaction with a relay
      // We'll create a test subscription to initiate the connection
      const testSub = this.pool.subscribe([this.url], { kinds: [3, 10002] }, {
        maxWait: 5000,
        onevent: (event) => {
          console.log('On event:', event);
          this.connected = true;
          this.logger.info(`Connected to relay: ${this.url}`);
          this.statsTracker.recordConnectionStatus(this.url, 'connected');
          this.processQueuedEvents();
        },
        onclose: () => {
          this.logger.debug(`Test subscription closed for relay ${this.url}`);
          this.connected = false;
        },
        oneose: () => {
          this.logger.debug(`Test subscription end of stored events for relay ${this.url}`);
        }
      });

      return testSub;

      // Set a connection timeout
      // const timeout = new Promise((_, reject) => {
      //   setTimeout(() => {
      //     reject(new Error(`Connection timeout to relay ${this.url}`));
      //   }, 5000);
      // });

      // Wait for either connection or timeout
      // await Promise.race([
      //   new Promise(resolve => {
      //     testSub.on('eose', () => {
      //       this.connected = true;
      //       testSub.unsub();
      //       this.logger.info(`Connected to relay: ${this.url}`);
      //       this.statsTracker.recordConnectionStatus(this.url, 'connected');
      //       this.processQueuedEvents();
      //       resolve();
      //     });
      //   }),
      //   timeout
      // ]);

      // return this.connected;
    } catch (error) {
      this.logger.error(`Failed to connect to relay ${this.url}:`, error);
      this.statsTracker.recordError(`connection_error_${this.url}`);
      // this.attemptReconnect();
      return false;
    }
  }

  attemptReconnect() {
    if (this.retryCount >= this.options.maxRetries) {
      this.logger.error(`Max retry attempts reached for relay ${this.url}. Giving up.`);
      return;
    }

    this.retryCount++;
    this.statsTracker.recordConnectionStatus(this.url, 'reconnecting');
    this.logger.info(`Attempting to reconnect to relay ${this.url} (attempt ${this.retryCount}/${this.options.maxRetries})`);

    setTimeout(() => {
      this.connect();
    }, this.options.reconnectInterval * Math.pow(1.5, this.retryCount - 1)); // Exponential backoff
  }

  async disconnect() {
    if (this.connected) {
      this.logger.debug(`Disconnecting from relay: ${this.url}`);

      // Close all subscriptions
      for (const [subId, sub] of this.subscriptions.entries()) {
        this.unsubscribe(subId);
      }

      // Close the pool connection to this relay
      this.pool.close([this.url]);
      this.connected = false;
    }
  }

  subscribe(filters) {
    if (!this.connected) {
      this.logger.warn(`Cannot subscribe to relay ${this.url}: not connected`);
      return null;
    }

    try {
      const sub = this.pool.subscribe([this.url], filters);
      const subId = Math.random().toString(36).substring(2, 15);
      this.subscriptions.set(subId, sub);
      this.logger.debug(`Subscribed to relay ${this.url} with filters:`, filters);

      // Add error handling
      sub.on('error', (error) => {
        this.logger.error(`Error on subscription for relay ${this.url}:`, error);
        this.statsTracker.recordError(`subscription_error_${this.url}`);
      });

      return sub;
    } catch (error) {
      this.logger.error(`Failed to subscribe to relay ${this.url}:`, error);
      this.statsTracker.recordError(`subscription_error_${this.url}`);
      return null;
    }
  }

  unsubscribe(subId) {
    const sub = this.subscriptions.get(subId);
    if (sub) {
      sub.unsub();
      this.subscriptions.delete(subId);
      this.logger.debug(`Unsubscribed from relay ${this.url} subscription ${subId}`);
    }
  }

  async publish(event) {
    if (!this.connected) {
      // Queue the event for later publishing
      this.logger.debug(`Relay ${this.url} not connected, queueing event`);
      this.eventQueue.push(event);
      return false;
    }

    try {
      const startTime = Date.now();

      // pool.publish returns an array of promises
      const publishPromises = await this.pool.publish([this.url], event);
      
      // Wait for all promises to resolve
      const results = await Promise.all(publishPromises.map(promise => 
        promise.catch(error => error.message || 'Unknown error')
      ));

      console.log('PUBLISH RESULTS:', results);
      
      const endTime = Date.now();
      const processingTime = endTime - startTime;

      this.statsTracker.recordProcessingTime(processingTime);

      // Check if any results contain error messages
      const errors = results.filter(result => typeof result === 'string');
      
      if (errors.length === 0) {
        this.logger.debug(`Event published to relay ${this.url} (took ${processingTime}ms)`);
        this.statsTracker.recordEventPublished(this.url, event);
        return true;
      } else {
        this.logger.warn(`Failed to publish event to relay ${this.url}. Errors: ${errors.join(', ')}`);
        this.statsTracker.recordError(`publish_error_${this.url}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Error publishing event to relay ${this.url}:`, error);
      this.statsTracker.recordError(`publish_error_${this.url}`);
      return false;
    }
  }

  async processQueuedEvents() {
    if (this.eventQueue.length === 0) return;

    this.logger.debug(`Processing ${this.eventQueue.length} queued events for relay ${this.url}`);

    // Create a copy of the queue and clear the original
    const eventsToProcess = [...this.eventQueue];
    this.eventQueue = [];

    for (const event of eventsToProcess) {
      await this.publish(event);
    }
  }
}