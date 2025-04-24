export class StatsTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.stats = {
      eventsReceived: {
        total: 0,
        byRelay: {},
        byKind: {
          '10002': 0,
          '3': 0
        }
      },
      eventsPublished: {
        total: 0,
        byRelay: {},
        byKind: {
          '10002': 0,
          '3': 0
        }
      },
      connectionStatus: {
        connected: [],
        disconnected: [],
        reconnecting: []
      },
      processingTime: {
        min: Infinity,
        max: 0,
        avg: 0,
        count: 0,
        total: 0
      },
      errors: {
        total: 0,
        byType: {}
      },
      notices: {
        total: 0,
        byType: {}
      },
      startTime: Date.now(),
      endTime: null,
      bandwidthEstimate: {
        bytesSent: 0,
        bytesReceived: 0
      }
    };
  }

  recordEventReceived(relay, event) {
    this.stats.eventsReceived.total++;
    
    if (!this.stats.eventsReceived.byRelay[relay]) {
      this.stats.eventsReceived.byRelay[relay] = 0;
    }
    this.stats.eventsReceived.byRelay[relay]++;
    
    if (this.stats.eventsReceived.byKind[event.kind] !== undefined) {
      this.stats.eventsReceived.byKind[event.kind]++;
    }

    // Estimate bandwidth (rough calculation)
    const eventSize = JSON.stringify(event).length;
    this.stats.bandwidthEstimate.bytesReceived += eventSize;
  }

  recordEventPublished(relay, event) {
    this.stats.eventsPublished.total++;
    
    if (!this.stats.eventsPublished.byRelay[relay]) {
      this.stats.eventsPublished.byRelay[relay] = 0;
    }
    this.stats.eventsPublished.byRelay[relay]++;
    
    if (this.stats.eventsPublished.byKind[event.kind] !== undefined) {
      this.stats.eventsPublished.byKind[event.kind]++;
    }

    // Estimate bandwidth (rough calculation)
    const eventSize = JSON.stringify(event).length;
    this.stats.bandwidthEstimate.bytesSent += eventSize;
  }

  recordNotice(noticeType, message) {
    if (!this.stats.notices.byType[noticeType]) {
      this.stats.notices.byType[noticeType] = [];
    }
    this.stats.notices.total++;
    this.stats.notices.byType[noticeType].push({
      time: new Date().toISOString(),
      message
    });
  }

  recordConnectionStatus(relay, status) {
    const currentStatuses = ['connected', 'disconnected', 'reconnecting'];
    
    // Remove relay from all statuses first
    currentStatuses.forEach(s => {
      this.stats.connectionStatus[s] = this.stats.connectionStatus[s].filter(r => r !== relay);
    });
    
    // Add relay to current status
    if (currentStatuses.includes(status)) {
      this.stats.connectionStatus[status].push(relay);
    }
  }

  recordProcessingTime(milliseconds) {
    this.stats.processingTime.count++;
    this.stats.processingTime.total += milliseconds;
    this.stats.processingTime.avg = this.stats.processingTime.total / this.stats.processingTime.count;
    
    if (milliseconds < this.stats.processingTime.min) {
      this.stats.processingTime.min = milliseconds;
    }
    
    if (milliseconds > this.stats.processingTime.max) {
      this.stats.processingTime.max = milliseconds;
    }
  }

  recordError(errorType) {
    this.stats.errors.total++;
    
    if (!this.stats.errors.byType[errorType]) {
      this.stats.errors.byType[errorType] = 0;
    }
    this.stats.errors.byType[errorType]++;
  }

  getStats() {
    const now = Date.now();
    const runningTime = (now - this.stats.startTime) / 1000; // in seconds
    
    return {
      ...this.stats,
      runningTime,
      throughput: {
        eventsPerSecond: this.stats.eventsPublished.total / runningTime
      }
    };
  }

  generateReport() {
    const stats = this.getStats();
    
    return {
      summary: {
        runningTime: `${stats.runningTime.toFixed(2)} seconds`,
        eventsReceived: stats.eventsReceived.total,
        eventsPublished: stats.eventsPublished.total,
        throughput: `${stats.throughput.eventsPerSecond.toFixed(2)} events/s`,
        errors: stats.errors.total
      },
      details: stats,
      timestamp: new Date().toISOString()
    };
  }

  endSession() {
    this.stats.endTime = Date.now();
    return this.generateReport();
  }
}