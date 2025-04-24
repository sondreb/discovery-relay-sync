// filepath: c:\src\github\sondreb\discovery-relay-sync\src\aggregateStatsTracker.js
/**
 * Class for tracking and aggregating statistics from multiple worker threads
 */
export class AggregateStatsTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.stats = {
      eventsPublished: {
        total: 0,
        byRelay: {},
        byKind: {
          '10002': 0,
          '3': 0
        }
      },
      eventsReceived: {
        total: 0,
        byRelay: {},
        byKind: {
          '10002': 0,
          '3': 0
        }
      },
      errors: {
        total: 0,
        byType: {}
      },
      processingTime: {
        min: Infinity,
        max: 0,
        avg: 0,
        count: 0,
        total: 0
      },
      bandwidthEstimate: {
        bytesSent: 0,
        bytesReceived: 0
      },
      startTime: Date.now(),
      endTime: null,
      threadCount: 0,
      threadStats: {}
    };
  }

  updateThreadStats(threadId, threadStats) {
    // Update the thread count if this is a new thread
    if (!this.stats.threadStats.hasOwnProperty(threadId)) {
      this.stats.threadCount++;
    }
    
    // Keep track of stats for each thread
    this.stats.threadStats[threadId] = threadStats;
  }

  aggregateAllThreadStats() {
    // Reset accumulated stats while preserving start time and thread count
    const startTime = this.stats.startTime;
    const threadCount = this.stats.threadCount;
    const threadStats = this.stats.threadStats;
    this.reset();
    this.stats.startTime = startTime;
    this.stats.threadCount = threadCount;
    this.stats.threadStats = threadStats;

    // Aggregate stats from all threads
    for (const [threadId, stats] of Object.entries(this.stats.threadStats)) {
      this.aggregateThreadStats(stats);
    }

    return this.stats;
  }

  aggregateThreadStats(threadStats) {
    if (!threadStats) return;

    // Events published
    if (threadStats.eventsPublished) {
      this.stats.eventsPublished.total += threadStats.eventsPublished.total || 0;
      
      // Aggregate by kind
      if (threadStats.eventsPublished.byKind) {
        for (const [kind, count] of Object.entries(threadStats.eventsPublished.byKind)) {
          if (!this.stats.eventsPublished.byKind[kind]) {
            this.stats.eventsPublished.byKind[kind] = 0;
          }
          this.stats.eventsPublished.byKind[kind] += count;
        }
      }
      
      // Aggregate by relay
      if (threadStats.eventsPublished.byRelay) {
        for (const [relay, count] of Object.entries(threadStats.eventsPublished.byRelay)) {
          if (!this.stats.eventsPublished.byRelay[relay]) {
            this.stats.eventsPublished.byRelay[relay] = 0;
          }
          this.stats.eventsPublished.byRelay[relay] += count;
        }
      }
    }

    // Events received
    if (threadStats.eventsReceived) {
      this.stats.eventsReceived.total += threadStats.eventsReceived.total || 0;
      
      // Aggregate by kind
      if (threadStats.eventsReceived.byKind) {
        for (const [kind, count] of Object.entries(threadStats.eventsReceived.byKind)) {
          if (!this.stats.eventsReceived.byKind[kind]) {
            this.stats.eventsReceived.byKind[kind] = 0;
          }
          this.stats.eventsReceived.byKind[kind] += count;
        }
      }
      
      // Aggregate by relay
      if (threadStats.eventsReceived.byRelay) {
        for (const [relay, count] of Object.entries(threadStats.eventsReceived.byRelay)) {
          if (!this.stats.eventsReceived.byRelay[relay]) {
            this.stats.eventsReceived.byRelay[relay] = 0;
          }
          this.stats.eventsReceived.byRelay[relay] += count;
        }
      }
    }

    // Errors
    if (threadStats.errors) {
      this.stats.errors.total += threadStats.errors.total || 0;
      
      if (threadStats.errors.byType) {
        for (const [type, count] of Object.entries(threadStats.errors.byType)) {
          if (!this.stats.errors.byType[type]) {
            this.stats.errors.byType[type] = 0;
          }
          this.stats.errors.byType[type] += count;
        }
      }
    }

    // Processing time
    if (threadStats.processingTime) {
      const pt = threadStats.processingTime;
      
      if (pt.count && pt.count > 0) {
        this.stats.processingTime.count += pt.count;
        this.stats.processingTime.total += pt.total || 0;
        
        // Update min/max
        if (pt.min && pt.min < this.stats.processingTime.min) {
          this.stats.processingTime.min = pt.min;
        }
        
        if (pt.max && pt.max > this.stats.processingTime.max) {
          this.stats.processingTime.max = pt.max;
        }
        
        // Recalculate average
        if (this.stats.processingTime.count > 0) {
          this.stats.processingTime.avg = this.stats.processingTime.total / this.stats.processingTime.count;
        }
      }
    }

    // Bandwidth estimates
    if (threadStats.bandwidthEstimate) {
      this.stats.bandwidthEstimate.bytesSent += threadStats.bandwidthEstimate.bytesSent || 0;
      this.stats.bandwidthEstimate.bytesReceived += threadStats.bandwidthEstimate.bytesReceived || 0;
    }
  }

  getStats() {
    const now = Date.now();
    const runningTime = (now - this.stats.startTime) / 1000; // in seconds
    
    return {
      ...this.stats,
      runningTime,
      threadCount: this.stats.threadCount,
      throughput: {
        eventsPerSecond: runningTime > 0 ? this.stats.eventsPublished.total / runningTime : 0,
        eventsPerSecondPerThread: runningTime > 0 && this.stats.threadCount > 0 ? 
          (this.stats.eventsPublished.total / runningTime) / this.stats.threadCount : 0
      }
    };
  }

  generateReport() {
    const stats = this.getStats();
    
    return {
      summary: {
        runningTime: `${stats.runningTime.toFixed(2)} seconds`,
        threadCount: stats.threadCount,
        eventsPublished: stats.eventsPublished.total,
        eventsReceived: stats.eventsReceived.total,
        throughput: `${stats.throughput.eventsPerSecond.toFixed(2)} events/s`,
        throughputPerThread: `${stats.throughput.eventsPerSecondPerThread.toFixed(2)} events/s/thread`,
        errors: stats.errors.total
      },
      details: stats,
      timestamp: new Date().toISOString()
    };
  }

  formatConsoleReport() {
    const stats = this.getStats();
    const report = this.generateReport();
    
    // Create a nicely formatted string for console output
    let formattedReport = '\n========== AGGREGATE STATISTICS REPORT ==========\n';
    
    // Summary section
    formattedReport += '--- SUMMARY ---\n';
    formattedReport += `Runtime: ${report.summary.runningTime}\n`;
    formattedReport += `Thread count: ${report.summary.threadCount}\n`;
    formattedReport += `Events published: ${report.summary.eventsPublished}\n`;
    formattedReport += `Events received: ${report.summary.eventsReceived}\n`;
    formattedReport += `Total throughput: ${report.summary.throughput}\n`;
    formattedReport += `Throughput per thread: ${report.summary.throughputPerThread}\n`;
    formattedReport += `Error count: ${report.summary.errors}\n`;
    
    // Relay details
    formattedReport += '\n--- RELAY DETAILS ---\n';
    formattedReport += 'Published events by relay:\n';
    Object.entries(stats.eventsPublished.byRelay).forEach(([relay, count]) => {
      formattedReport += `  ${relay}: ${count} events\n`;
    });
    
    // Event type breakdown
    formattedReport += '\n--- EVENT TYPES ---\n';
    formattedReport += `Kind 3 events: ${stats.eventsPublished.byKind['3'] || 0}\n`;
    formattedReport += `Kind 10002 events: ${stats.eventsPublished.byKind['10002'] || 0}\n`;
    
    // Errors if any
    if (stats.errors.total > 0) {
      formattedReport += '\n--- ERRORS ---\n';
      Object.entries(stats.errors.byType).forEach(([type, count]) => {
        formattedReport += `  ${type}: ${count}\n`;
      });
    }
    
    // Processing time
    formattedReport += '\n--- PROCESSING TIME ---\n';
    if (stats.processingTime.count > 0) {
      formattedReport += `Min: ${stats.processingTime.min} ms\n`;
      formattedReport += `Max: ${stats.processingTime.max} ms\n`;
      formattedReport += `Avg: ${stats.processingTime.avg.toFixed(2)} ms\n`;
    } else {
      formattedReport += `No processing time data available\n`;
    }
    
    // Bandwidth usage estimate
    formattedReport += '\n--- BANDWIDTH USAGE ---\n';
    const sentKB = (stats.bandwidthEstimate.bytesSent / 1024).toFixed(2);
    const receivedKB = (stats.bandwidthEstimate.bytesReceived / 1024).toFixed(2);
    formattedReport += `Sent: ${sentKB} KB\n`;
    formattedReport += `Received: ${receivedKB} KB\n`;
    
    formattedReport += '==============================================\n';
    
    return formattedReport;
  }

  endSession() {
    this.stats.endTime = Date.now();
    return this.generateReport();
  }
}