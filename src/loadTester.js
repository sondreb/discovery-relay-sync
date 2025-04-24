import { RelayConnector } from './relayConnector.js';
import { StatsTracker } from './statsTracker.js';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';

export class LoadTester {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.statsTracker = new StatsTracker();
    this.targetRelays = [];
    this.keypair = null;   // Single keypair instead of an array
    this.otherPubkeys = []; // Array of pubkeys for creating contacts
    this.running = false;
    this.reportInterval = null;
    this.testInterval = null;
  }

  async run() {
    this.logger.info('Starting load test...');
    this.running = true;

    try {
      // Generate a single keypair
      this.generateKeypair();
      
      // Generate some random pubkeys for contact lists (not actual keypairs)
      this.generateRandomPubkeys();

      // Connect to target relays
      await this.connectToTargetRelays();

      // Set up regular stats reporting
      this.setupStatsReporting();

      // Start publishing events at the configured rate
      this.startPublishing();

      // Set timer to end the test after specified duration
      setTimeout(() => {
        this.stop();
      }, this.config.testDuration * 1000);

      return true;
    } catch (error) {
      this.logger.error('Failed to start load test:', error);
      return false;
    }
  }

  async stop() {
    if (!this.running) return;

    this.logger.info('Stopping load test...');
    this.running = false;

    // Clear intervals
    if (this.reportInterval) {
      clearInterval(this.reportInterval);
      this.reportInterval = null;
    }

    if (this.testInterval) {
      clearInterval(this.testInterval);
      this.testInterval = null;
    }

    // Generate final report
    const finalReport = this.statsTracker.endSession();
    this.logger.info('Final load test report:', finalReport);

    // Disconnect from all relays
    const disconnectPromises = this.targetRelays.map(relay => relay.disconnect());
    await Promise.all(disconnectPromises);

    this.logger.info('Load test completed');
  }

  generateKeypair() {
    // Check if a specific threadId is provided and use it as a seed for consistent generation
    let threadId = this.config.threadId || 1;
    
    this.logger.info(`Generating keypair for thread ${threadId}...`);

    // Generate a single keypair
    const privateKey = generateSecretKey(); 
    const publicKey = getPublicKey(privateKey);
    
    this.keypair = { privateKey, publicKey };

    this.logger.info(`Generated keypair with pubkey: ${publicKey.substring(0, 8)}...`);
  }
  
  generateRandomPubkeys() {
    // Generate random pubkeys (not actual keypairs) for contact lists
    const numPubkeys = 50; // Number of random pubkeys to generate
    this.logger.info(`Generating ${numPubkeys} random pubkeys for contacts...`);
    
    for (let i = 0; i < numPubkeys; i++) {
      // Generate a fake pubkey (32 bytes of random hex)
      const fakePubkey = Array.from({length: 64}, () => 
        '0123456789abcdef'[Math.floor(Math.random() * 16)]
      ).join('');
      
      this.otherPubkeys.push(fakePubkey);
    }
    
    this.logger.info(`Generated ${this.otherPubkeys.length} random pubkeys for contacts`);
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

  startPublishing() {
    if (!this.running) return;

    const intervalMs = 1000 / this.config.eventsPerSecond;

    this.logger.info(`Publishing events at a rate of ${this.config.eventsPerSecond} per second (interval: ${intervalMs}ms)`);

    this.testInterval = setInterval(() => {
      if (!this.running) return;

      // For each interval, publish one event
      this.publishRandomEvent();
    }, intervalMs);
  }

  async publishRandomEvent() {
    if (!this.running || this.targetRelays.length === 0) return;

    try {
      // Use the single keypair for all events
      const keypair = this.keypair;

      // Randomly choose between kind 10002 and kind 3 (evenly)
      const eventKind = Math.random() < 0.5 ? 10002 : 3;

      // Get current timestamp for this event to ensure unique creation time
      const created_at = Math.floor(Date.now() / 1000);
      
      let event;

      if (eventKind === 10002) {
        // Generate a relay list metadata event
        event = this.generateRelayListEvent(keypair, created_at);
      } else {
        // Generate a contact list event
        event = this.generateContactListEvent(keypair, created_at);
      }

      // Sign the event
      event = await this.signEvent(event, keypair.privateKey);

      // Publish to target relays
      await this.publishToTargetRelays(event);

    } catch (error) {
      this.logger.error('Error publishing random event:', error);
      this.statsTracker.recordError('event_generation_error');
    }
  }

  createTags(tagType, values) {
    const tags = [];

    for (const value of values) {
      tags.push([tagType, value]);
    }

    return tags;
  }

  generateRelayListEvent(keypair, created_at) {
    // Generate a kind 10002 event with random relay URLs
    const relayCount = 5 + Math.floor(Math.random() * 10); // 5-14 relays
    const relaysUrls = [];

    for (let i = 0; i < relayCount; i++) {
      const relayUrl = `wss://relay${i}.example.com`;
      relaysUrls.push(relayUrl);
    }

    const tags = this.createTags('r', relaysUrls);

    return {
      kind: 10002,
      created_at: created_at,
      content: '',
      tags,
      pubkey: keypair.publicKey,
    };
  }

  generateContactListEvent(keypair, created_at) {
    // Generate a kind 3 event with random contacts from our pubkey list
    const contactCount = 5 + Math.floor(Math.random() * 20); // 5-24 contacts
    const tags = [];

    // Get a random subset of our other pubkeys for contacts
    const shuffledPubkeys = [...this.otherPubkeys].sort(() => 0.5 - Math.random());
    const selectedPubkeys = shuffledPubkeys.slice(0, Math.min(contactCount, shuffledPubkeys.length));

    for (const pubkey of selectedPubkeys) {
      tags.push(['p', pubkey, 'wss://relay.example.com', Math.random() > 0.5 ? 'follow' : '']);
    }

    return {
      kind: 3,
      created_at: created_at,
      content: '',
      tags: tags,
      pubkey: keypair.publicKey
    };
  }

  async signEvent(event, privateKey) {
    return finalizeEvent(event, privateKey);
  }

  async publishToTargetRelays(event) {
    console.log('PUBLISH: ', event.created_at, event.id, event.kind, event.tags);

    // Randomly select some or all target relays to publish to
    const relayCount = Math.max(1, Math.floor(Math.random() * this.targetRelays.length));
    const shuffledRelays = [...this.targetRelays].sort(() => 0.5 - Math.random());
    const selectedRelays = shuffledRelays.slice(0, relayCount);
    const relayUrls = selectedRelays.map(r => r.url);

    // Publish to selected relays
    const publishPromises = selectedRelays.map(async relay => {
      try {
        const publishPromises = await relay.pool.publish(relayUrls, event);

        // Wait for all promises to resolve
        const results = await Promise.all(publishPromises.map(promise =>
          promise.catch(error => error.message || 'Unknown error')
        ));

        // Check if any results contain actual error messages
        // Empty strings ('') are successful publishes, not errors
        const errors = results.filter(result => typeof result === 'string' && result !== '');

        if (errors.length === 0) {
          this.logger.debug(`Event published to relay ${relay.url} (took ${Date.now() - new Date(event.created_at * 1000)}ms)`);
          this.statsTracker.recordEventPublished(relay.url, event);
          return true;
        } else {
          this.logger.warn(`Failed to publish event to relay ${relay.url}. Errors: ${errors.join(', ')}`);
          this.statsTracker.recordError(`publish_error_${relay.url}`);
          return false;
        }

        // Handle case where relay rejects the event (returns false)
        // if (result === false) {
        //   // This is likely an older event being rejected, we'll just ignore this case
        //   this.logger.debug(`Relay ${relay.url} rejected event with id ${event.id}, likely too old`);
        //   return { success: false, reason: 'rejected' };
        // }

        // return { success: true };
      } catch (error) {
        console.log('ERROR PUBLISHING!!', error);
        // Record the error but don't fail the whole operation
        this.statsTracker.recordError('event_publish_error');
        this.logger.debug(`Error publishing to relay ${relay.url}: ${error.message}`);
        return { success: false, reason: error.message };
      }
    });

    const results = await Promise.allSettled(publishPromises);

    // Count successes and failures
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
    const rejectedCount = results.filter(r => r.status === 'fulfilled' && r.value?.reason === 'rejected').length;
    const errorCount = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value?.success && r.value?.reason !== 'rejected')).length;

    if (errorCount > 0 || rejectedCount > 0) {
      this.logger.debug(`Event ${event.id} publish results: ${successCount} success, ${rejectedCount} rejected, ${errorCount} errors`);
    }
  }

  setupStatsReporting() {
    // Report stats every 5 seconds during load testing
    this.reportInterval = setInterval(() => {
      if (!this.running) return;

      const stats = this.statsTracker.getStats();
      this.logger.info('Load test stats:', stats.summary);

      // Calculate success rate
      const successRate = stats.eventsPublished.total > 0
        ? (stats.eventsPublished.total / (stats.eventsPublished.total + stats.errors.total) * 100).toFixed(2)
        : '0.00';

      this.logger.info(`Success rate: ${successRate}%`);
      this.logger.info(`Current throughput: ${stats.throughput.eventsPerSecond.toFixed(2)} events/s`);

    }, 5000); // 5 seconds
  }
}