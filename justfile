# DEVONthink MCP Server - Just Commands

# Default recipe to show available commands
default:
    @just --list

# Check formatting without changing files
format-check:
    npm run format:check

# Format code with Biome
format:
    npm run format

# Run unit tests
test:
    npm test

# Build the project
build:
    npm run build

# Type-check without emitting build output
type-check:
    npm run type-check

# Run integration tests against a live DEVONthink instance
test-integration:
    npm run test:integration

# Start the stdio MCP server from the built dist directory
start:
    npm start
