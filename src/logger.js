import winston from 'winston';

export class Logger {
  constructor(level = 'info') {
    this.logger = winston.createLogger({
      level: level,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...rest }) => {
          const restString = Object.keys(rest).length ? JSON.stringify(rest) : '';
          return `${timestamp} ${level.toUpperCase()} ${message} ${restString}`;
        })
      ),
      transports: [
        new winston.transports.Console()
      ]
    });
  }

  debug(message, meta = {}) {
    this.logger.debug(message, meta);
  }

  info(message, meta = {}) {
    this.logger.info(message, meta);
  }

  warn(message, meta = {}) {
    this.logger.warn(message, meta);
  }

  error(message, meta = {}) {
    this.logger.error(message, meta);
  }

  // Method to create a formatted stats report
  generateStatsReport(stats) {
    return {
      timestamp: new Date().toISOString(),
      eventsReceived: stats.eventsReceived,
      eventsPublished: stats.eventsPublished,
      connectionStatus: stats.connectionStatus,
      processingTime: {
        min: stats.processingTime.min,
        max: stats.processingTime.max,
        avg: stats.processingTime.avg
      },
      errors: stats.errors
    };
  }
}