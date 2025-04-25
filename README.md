# Discovery Relay Sync
Utility used to sync kind 10002 from other relays and publish to Discovery Relay (also includes load testing)

# Regular sync mode
node index.js -s wss://relay.damus.io,wss://relay.nostr.info -t wss://nos.lol

# Load testing mode
# This will spin up 20 threads, one pr. second publish.
node index.js --load-test -t ws://localhost:5210 --events-per-second 20 --test-duration 120

# Multi-threaded load testing
node index.js --load-test -t ws://localhost:5210 --events-per-second 20 --test-duration 120 --threads 30

# Using configuration file
node index.js -c config.json

## Running Discovery Relay Sync

Discovery Relay Sync is a utility designed to sync kind 10002 (Relay Lists) and kind 3 events from source relays to target relays.

## Running in Sync Mode
To sync events from one relay to another, use this command:
```bash
node index.js -s <source-relay-urls> -t <target-relay-urls>
```

For example, to sync relay lists from damus.io and nostr.info to nos.lol:
```bash
node index.js -s wss://relay.damus.io,wss://relay.nostr.info -t wss://nos.lol
```

## Using a Configuration File
For more complex setups, you can use a configuration file:
```bash
node index.js -c config.json
```

Your config.json might look like:
```json
{
  "sourceRelays": ["wss://relay.damus.io", "wss://relay.nostr.info"],
  "targetRelays": ["wss://nos.lol"],
  "logLevel": "info",
  "reconnectInterval": 5000,
  "maxRetries": 3,
  "bufferSize": 10000
}
```

### What It Does

The application:

Connects to the source relays
Subscribes to kind 10002 (Relay Lists) and kind 3 events
Validates and deduplicates incoming events
Publishes valid events to the target relays
Provides periodic stats reports
The sync will run continuously until you stop it with Ctrl+C (SIGINT).
