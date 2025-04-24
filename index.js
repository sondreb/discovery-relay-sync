#!/usr/bin/env node

import { parseArgs } from './src/configManager.js';
import { Logger } from './src/logger.js';
import { RelaySync } from './src/relaySync.js';
import { LoadTester } from './src/loadTester.js';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { AggregateStatsTracker } from './src/aggregateStatsTracker.js';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  try {
    const config = parseArgs();
    const logger = new Logger(config.logLevel);
    
    logger.info('Discovery Relay Sync Starting...');
    logger.debug('Configuration:', config);

    if (config.loadTest) {
      logger.info('Running in load test mode');
      
      // For load testing, calculate the optimal thread count if not explicitly specified
      if (config.threads === 1 && config.eventsPerSecond > 1) {
        // Due to Nostr timestamp limitations (1 event per second per keypair),
        // we need as many threads as events per second we want to achieve
        config.threads = config.eventsPerSecond;
        logger.info(`Auto-scaling to ${config.threads} threads to achieve ${config.eventsPerSecond} events/second`);
      }
      
      if (config.threads > 1) {
        await runMultithreadedTest(config, logger);
      } else {
        // Single thread mode
        const loadTester = new LoadTester(config, logger);
        await loadTester.run();
      }
    } else {
      logger.info('Running in sync mode');
      const relaySync = new RelaySync(config, logger);
      await relaySync.start();

      // Handle graceful shutdown
      process.on('SIGINT', async () => {
        logger.info('Shutdown signal received');
        await relaySync.stop();
        process.exit(0);
      });
    }
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

async function runMultithreadedTest(config, logger) {
  const threadCount = config.threads;
  logger.info(`Starting ${threadCount} load testing threads`);
  
  // In Nostr, we can only do 1 event per second per keypair
  // So each thread will produce exactly 1 event per second
  // We don't need to divide events per second among threads
  logger.info(`Each thread will publish 1 event per second (Nostr timestamp limitation)`);
  logger.info(`Total throughput will be approximately ${threadCount} events/second with ${threadCount} threads`);
  
  // Keep track of all worker threads
  const workers = [];
  
  // Create aggregate stats tracker
  const aggregateStats = new AggregateStatsTracker();
  
  // Flag to suppress individual thread reports
  const suppressThreadReports = threadCount > 1;
  
  // Handle graceful shutdown
  const shutdown = async (showFinalReport = true) => {
    logger.info('Shutdown signal received - stopping all worker threads');
    
    // Send termination message to all workers
    for (const worker of workers) {
      worker.postMessage({ type: 'shutdown' });
    }
    
    // Wait a moment for workers to clean up
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (showFinalReport) {
      // Generate and display the aggregate report
      const aggregatedStats = aggregateStats.aggregateAllThreadStats();
      const finalReport = aggregateStats.endSession();
      logger.info('Final aggregate load test report:', finalReport.summary);
      
      // Display a nicely formatted report
      const formattedReport = aggregateStats.formatConsoleReport();
      logger.info(`\n${formattedReport}`);
    }
    
    process.exit(0);
  };
  
  process.on('SIGINT', () => shutdown());
  
  // Create worker threads
  for (let i = 0; i < threadCount; i++) {
    const threadConfig = {
      ...config,
      // Set events per second to 1 for each thread
      eventsPerSecond: 1,
      // Add thread ID for identification
      threadId: i + 1
    };
    
    // Create the worker
    const worker = new Worker(resolve(__dirname, 'src/loadTestWorker.js'), {
      workerData: { config: threadConfig }
    });
    
    worker.on('error', error => {
      logger.error(`Error in worker thread ${i + 1}:`, error);
    });
    
    worker.on('exit', code => {
      if (!suppressThreadReports) {
        logger.info(`Worker thread ${i + 1} exited with code ${code}`);
      }
      
      // Remove from workers array
      const index = workers.indexOf(worker);
      if (index > -1) {
        workers.splice(index, 1);
      }
      
      // If all workers are done, exit main process
      if (workers.length === 0) {
        logger.info('All worker threads completed');
        shutdown(true);
      }
    });
    
    worker.on('message', message => {
      if (message.type === 'log') {
        // Only pass through critical log messages if we're suppressing thread reports
        if (suppressThreadReports && (message.level === 'error' || message.level === 'warn')) {
          logger[message.level](`[Thread ${i + 1}] ${message.message}`, message.meta);
        } else if (!suppressThreadReports) {
          logger[message.level](`[Thread ${i + 1}] ${message.message}`, message.meta);
        }
      } else if (message.type === 'stats') {
        // Collect stats from worker threads
        aggregateStats.updateThreadStats(i + 1, message.stats);
        
        // Only log individual stats if we're not suppressing thread reports
        if (!suppressThreadReports) {
          logger.info(`[Thread ${i + 1}] Stats: ${JSON.stringify(message.stats)}`);
        }
      } else if (message.type === 'final_stats') {
        // Receive final stats from a worker thread
        aggregateStats.updateThreadStats(i + 1, message.stats);
      }
    });
    
    workers.push(worker);
  }
  
  logger.info(`${threadCount} worker threads started`);
  
  // Set up a periodic aggregate stats report if we have multiple threads
  if (threadCount > 1) {
    const reportInterval = setInterval(() => {
      if (workers.length === 0) {
        clearInterval(reportInterval);
        return;
      }
      
      // Aggregate and report overall stats periodically
      const stats = aggregateStats.aggregateAllThreadStats();
      const combinedStats = aggregateStats.getStats(); // Get processed stats with calculated fields
      const runningTime = combinedStats.runningTime.toFixed(2);
      const eventsPublished = combinedStats.eventsPublished.total;
      const throughput = (eventsPublished / combinedStats.runningTime).toFixed(2);
      
      logger.info(`Aggregate stats - Runtime: ${runningTime}s, Events: ${eventsPublished}, Throughput: ${throughput} events/s`);
    }, 15000); // Every 15 seconds
  }
  
  // Wait until the test duration completes
  await new Promise(resolve => setTimeout(resolve, config.testDuration * 1000));
  
  // Send shutdown signal to all workers
  logger.info('Test duration completed, shutting down worker threads');
  await shutdown();
}

main();