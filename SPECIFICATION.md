# Discovery Relay Sync - Specification Document

## Overview

Discovery Relay Sync is a Node.js utility designed to connect to multiple Nostr relays, monitor specific event kinds (10002 and 3), and synchronize these events across relays. It supports both regular operation and load testing capabilities.

## Purpose

The primary purpose of this utility is to facilitate the propagation of Nostr relay discovery events (kind 10002) and contact lists (kind 3) across the Nostr network, ensuring wider distribution of relay metadata and user contacts.

## Technical Requirements

- Node.js runtime environment
- `nostr-tools` package for Nostr protocol interactions
- Command-line interface (CLI) support
- Configuration options for source and target relays
- Logging and performance metrics

## Architecture

### Core Components

1. **Relay Connector**: Manages WebSocket connections to source and target relays
2. **Event Monitor**: Subscribes to and processes incoming events from source relays
3. **Event Publisher**: Publishes events to target relays
4. **Configuration Manager**: Handles CLI arguments and configuration settings
5. **Statistics Tracker**: Records performance metrics and generates reports
6. **Load Test Generator**: Creates synthetic events for performance testing

### Data Flow

1. Connect to specified source relays
2. Subscribe to event kinds 10002 (relay list metadata) and 3 (contact lists)
3. When events are received from source relays, validate and process them
4. Publish valid events to all configured target relays
5. Track and log statistics about throughput and performance

## Features

### Basic Functionality

- Connect to multiple source and target relays concurrently
- Filter and capture only events of kinds 10002 and 3
- Deduplicate events before republishing
- Handle relay connection failures gracefully
- Support secure WebSocket connections (wss://)

### Configuration Options

- Source relay URLs (multiple)
- Target relay URLs (multiple)
- Log level (debug, info, warn, error)
- Event buffer size
- Connection timeout settings
- Reconnection strategy

### Metrics and Logging

- Events received (per relay, per kind)
- Events published (per relay, per kind)
- Connection status (connected, disconnected, reconnecting)
- Error rates and types
- Processing time statistics (min, max, average)
- Bandwidth usage estimates

### Load Testing Mode

- Generate random Nostr keypairs
- Create synthetic kind 10002 (relay lists) and kind 3 (contact lists) events
- Configure event generation rate and volume
- Publish events directly to target relays
- Measure maximum throughput capabilities
- Report on success/failure rates during high load

## CLI Interface

```
Usage: discovery-relay-sync [options]

Options:
  -c, --config <path>       Path to configuration file
  -s, --source <urls>       Comma-separated list of source relay URLs
  -t, --target <urls>       Comma-separated list of target relay URLs
  -l, --log-level <level>   Log level (debug, info, warn, error)
  --load-test               Enable load testing mode
  --events-per-second <n>   Events to generate per second in load test
  --test-duration <seconds> Duration of load test in seconds
  --keypairs <number>       Number of random keypairs to generate for testing
  -h, --help                Display help information
```

## Implementation Guidelines

### Event Handling

- Use the `nostr-tools` library for Nostr protocol implementation
- Implement subscription filters for kinds 10002 and 3
- Validate event signatures before republishing
- Handle rate limiting from target relays

### Performance Considerations

- Use connection pooling for efficient relay connections
- Implement a queue system for event publishing to prevent overloading
- Use async/await patterns for non-blocking operations
- Buffer events when target relays are temporarily unavailable

### Error Handling

- Implement exponential backoff for reconnection attempts
- Log detailed error information for debugging
- Handle edge cases like malformed events and relay timeouts

## Load Test Implementation

### Key Generation

- Create multiple random keypairs using the `nostr-tools` library
- Store keypairs in memory during the test session

### Event Generation

- Randomly create kind 10002 events with lists of relay URLs
- Generate kind 3 events with random contacts (other generated keypairs)
- Sign events with the corresponding private keys

### Performance Testing

- Gradually increase publishing rate until failures occur
- Measure and report maximum sustainable throughput
- Track latency between event creation and successful publishing

## Output and Reporting

- Real-time console logging of significant events
- JSON-formatted logs for machine processing
- Summary statistics at regular intervals
- Detailed performance report at the end of a session or test
- Export capabilities for metrics data

## Future Enhancements

- Support for additional event kinds
- Web interface for monitoring
- Database integration for event persistence
- Filter capabilities for specific event attributes
- Clustering for distributed operation

## Example Configuration File

```json
{
  "sourceRelays": [
    "wss://relay.damus.io",
    "wss://relay.nostr.info"
  ],
  "targetRelays": [
    "wss://nos.lol",
    "wss://nostr.bitcoiner.social"
  ],
  "logLevel": "info",
  "reconnectInterval": 5000,
  "maxRetries": 10,
  "bufferSize": 1000
}
```
