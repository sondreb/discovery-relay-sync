# discovery-relay-sync
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