// Worker thread for load testing
import { parentPort, workerData } from 'worker_threads';
import { LoadTester } from './loadTester.js';

// Custom logger that forwards messages to the main thread
class WorkerLogger {
  constructor(threadId) {
    this.threadId = threadId;
    
    // Define log levels
    this.levels = ['error', 'warn', 'info', 'debug'];
    
    // Create methods for each log level
    this.levels.forEach(level => {
      this[level] = (message, meta = {}) => {
        if (parentPort) {
          parentPort.postMessage({
            type: 'log',
            level: level,
            message: message,
            meta: meta
          });
        }
      };
    });
  }
}

async function runLoadTest() {
  const { config } = workerData;
  const logger = new WorkerLogger(config.threadId);
  
  logger.info(`Worker thread ${config.threadId} starting with ${config.eventsPerSecond} events/sec`);
  
  try {
    const loadTester = new LoadTester(config, logger);
    
    // Override the setupStatsReporting method to send stats to the main thread
    const originalSetupStatsReporting = loadTester.setupStatsReporting;
    loadTester.setupStatsReporting = function() {
      originalSetupStatsReporting.call(this);
      
      // Add an additional reporting function that sends stats to the main thread
      this.statsReportInterval = setInterval(() => {
        if (!this.running) return;
        
        const stats = this.statsTracker.getStats();
        if (parentPort && stats) {
          parentPort.postMessage({
            type: 'stats',
            stats: stats
          });
        }
      }, 5000);
    };
    
    // Override the stop method to send final stats before shutting down
    const originalStop = loadTester.stop;
    loadTester.stop = async function() {
      await originalStop.call(this);
      
      // Send final stats to the main thread
      if (parentPort) {
        const finalStats = this.statsTracker.getStats();
        parentPort.postMessage({
          type: 'final_stats',
          stats: finalStats
        });
      }
    };
    
    // Start the load test
    await loadTester.run();
    
    // Listen for messages from the main thread
    parentPort.on('message', async (message) => {
      if (message.type === 'shutdown') {
        logger.info(`Worker thread ${config.threadId} received shutdown signal`);
        await loadTester.stop();
        
        // Clean up any intervals
        if (loadTester.statsReportInterval) {
          clearInterval(loadTester.statsReportInterval);
        }
        
        // Exit the worker thread
        parentPort.close();
        process.exit(0);
      }
    });
  } catch (error) {
    logger.error(`Worker thread ${config.threadId} error:`, { error: error.message });
    process.exit(1);
  }
}

// Run the load test in this worker
runLoadTest();