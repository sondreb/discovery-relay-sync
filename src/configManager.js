import yargs from 'yargs';
import fs from 'fs';
import { hideBin } from 'yargs/helpers';

/**
 * Parse command-line arguments and configuration file
 */
export function parseArgs() {
  const argv = yargs(hideBin(process.argv))
    .option('config', {
      alias: 'c',
      type: 'string',
      description: 'Path to configuration file'
    })
    .option('source', {
      alias: 's',
      type: 'string',
      description: 'Comma-separated list of source relay URLs'
    })
    .option('conn', {
      type: 'string',
      description: 'Azure Storage connection string for event storage',
    })
    .option('container', {
      type: 'string',
      description: 'Azure Storage container name for storing events',
      default: 'nostr-events'
    })
    .option('target-container', {
      type: 'string',
      description: 'Azure Storage container name for storing reconciled events',
      default: 'nostr-events'
    })
    .option('path', {
      alias: 'p',
      type: 'string',
      description: 'Local path to store events'
    })
    .option('target', {
      alias: 't',
      type: 'string',
      description: 'Comma-separated list of target relay URLs'
    })
    .option('log-level', {
      alias: 'l',
      type: 'string',
      choices: ['error', 'warn', 'info', 'debug'],
      default: 'info',
      description: 'Log level'
    })
    .option('load-test', {
      type: 'boolean',
      default: false,
      description: 'Enable load testing mode'
    })
    .option('events-per-second', {
      type: 'number',
      default: 10,
      description: 'Events to generate per second in load test'
    })
    .option('test-duration', {
      type: 'number',
      default: 60,
      description: 'Duration of load test in seconds'
    })
    .help('h')
    .alias('h', 'help')
    .argv;

  // Default configuration
  let config = {
    sourceRelays: [],
    targetRelays: [],
    logLevel: argv.logLevel || 'info',
    reconnectInterval: 5000,
    maxRetries: 10,
    bufferSize: 1000,
    sync: argv.sync || false,
    path: argv.path || '',
    loadTest: argv.loadTest || false,
    conn: argv.conn,
    containerName: argv.container || 'nostr-events',
    targetContainer: argv['target-container'] || 'nostr-events',
    eventsPerSecond: argv.eventsPerSecond || 10,
    testDuration: argv.testDuration || 60,
    threads: 1
  };

  // Load configuration from file if specified
  if (argv.config) {
    try {
      const fileConfig = JSON.parse(fs.readFileSync(argv.config, 'utf-8'));
      config = { ...config, ...fileConfig };
    } catch (error) {
      console.error(`Error loading configuration file: ${error.message}`);
      process.exit(1);
    }
  }

  // Override with command line arguments
  if (argv.source) {
    config.sourceRelays = argv.source.split(',').map(url => url.trim());
  }

  if (argv.target) {
    config.targetRelays = argv.target.split(',').map(url => url.trim());
  }

  // Validate configuration
  if (!config.loadTest && (config.sourceRelays.length === 0 || config.targetRelays.length === 0)) {
    console.error('Error: Both source and target relays must be specified in sync mode');
    process.exit(1);
  }

  if (config.loadTest && config.targetRelays.length === 0) {
    console.error('Error: Target relays must be specified in load test mode');
    process.exit(1);
  }

  return config;
}