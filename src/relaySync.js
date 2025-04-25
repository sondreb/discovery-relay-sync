import { RelayConnector } from './relayConnector.js';
import { StatsTracker } from './statsTracker.js';
import { verifyEvent } from 'nostr-tools/pure';

export class RelaySync {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.statsTracker = new StatsTracker();
    this.sourceRelays = [];
    this.targetRelays = [];
    this.processedEvents = new Set(); // For deduplication
    this.running = false;
    this.reportInterval = null;
  }
  
  async start() {
    this.logger.info('Starting relay sync...');
    this.running = true;
    
    try {
      // Connect to target relays
      await this.connectToTargetRelays();
      
      // Connect to source relays
      await this.connectToSourceRelays();
      
      // Set up regular stats reporting
      this.setupStatsReporting();
      
      return true;
    } catch (error) {
      this.logger.error('Failed to start relay sync:', error);
      return false;
    }
  }
  
  async stop() {
    this.logger.info('Stopping relay sync...');
    this.running = false;
    
    // Clear reporting interval
    if (this.reportInterval) {
      clearInterval(this.reportInterval);
      this.reportInterval = null;
    }
    
    // Generate final report
    const finalReport = this.statsTracker.endSession();
    this.logger.info('Final stats report:', finalReport);
    
    // Disconnect from all relays
    const disconnectPromises = [
      ...this.sourceRelays.map(relay => relay.disconnect()),
      ...this.targetRelays.map(relay => relay.disconnect())
    ];
    
    await Promise.all(disconnectPromises);
    this.logger.info('Relay sync stopped');
  }
  
  async connectToSourceRelays() {
    this.logger.info(`Connecting to ${this.config.sourceRelays.length} source relays...`);
    
    for (const relayUrl of this.config.sourceRelays) {
      const relay = new RelayConnector(
        relayUrl, 
        {
          reconnectInterval: this.config.reconnectInterval,
          maxRetries: this.config.maxRetries
        },
        this.logger,
        this.statsTracker
      );
      
      const connected = await relay.connect();
      
      if (connected) {
        this.sourceRelays.push(relay);
        
        // Subscribe to kinds 10002 and 3
        // const sub = relay.subscribe([
        //   { kinds: [10002, 3] }
        // ]);
        
        // if (sub) {
        //   sub.on('event', event => {
        //     this.handleIncomingEvent(relayUrl, event);
        //   });
          
        //   sub.on('eose', () => {
        //     this.logger.debug(`End of stored events from ${relayUrl}`);
        //   });
        // }
      }
    }
    
    if (this.sourceRelays.length === 0) {
      throw new Error('Failed to connect to any source relays');
    }
    
    this.logger.info(`Connected to ${this.sourceRelays.length} source relays`);
  }
  
  async connectToTargetRelays() {
    this.logger.info(`Connecting to ${this.config.targetRelays.length} target relays...`);
    
    for (const relayUrl of this.config.targetRelays) {
      const relay = new RelayConnector(
        relayUrl,
        {
          reconnectInterval: this.config.reconnectInterval,
          maxRetries: this.config.maxRetries
        },
        this.logger,
        this.statsTracker
      );
      
      const connected = await relay.connect();
      
      if (connected) {
        this.targetRelays.push(relay);
      }
    }
    
    if (this.targetRelays.length === 0) {
      throw new Error('Failed to connect to any target relays');
    }
    
    this.logger.info(`Connected to ${this.targetRelays.length} target relays`);
  }
  
  handleIncomingEvent(relayUrl, event) {
    if (!this.running) return;
    
    const eventId = event.id;
    
    // Deduplicate events
    if (this.processedEvents.has(eventId)) {
      this.logger.debug(`Skipping duplicate event ${eventId}`);
      return;
    }
    
    // Validate event kinds
    if (![10002, 3].includes(event.kind)) {
      this.logger.debug(`Skipping event with unsupported kind: ${event.kind}`);
      return;
    }
    
    // Verify signature
    if (!verifyEvent(event)) {
      this.logger.warn(`Skipping event ${eventId} with invalid signature`);
      this.statsTracker.recordError('invalid_signature');
      return;
    }
    
    // Record this event as received
    this.statsTracker.recordEventReceived(relayUrl, event);
    
    // Mark as processed to avoid duplicates
    this.processedEvents.add(eventId);
    
    // Publish to target relays
    this.publishToTargetRelays(event);
  }
  
  async publishToTargetRelays(event) {
    const publishPromises = this.targetRelays.map(relay => relay.publish(event));
    await Promise.allSettled(publishPromises);
  }
  
  setupStatsReporting() {
    // Report stats every 60 seconds
    this.reportInterval = setInterval(() => {
      if (!this.running) return;
      
      const stats = this.statsTracker.getStats();
      this.logger.info('Stats report:', stats.summary);
      
      // Clean up the processed events set occasionally to prevent memory bloat
      if (this.processedEvents.size > this.config.bufferSize) {
        this.logger.debug(`Clearing processed events cache (${this.processedEvents.size} items)`);
        this.processedEvents.clear();
      }
    }, 60000); // 60 seconds
  }
}