# Devonthink MCP Server

This MCP server provides access to DEVONthink functionality via the Model Context Protocol (MCP). It enables listing, searching, creating, modifying, and managing records and databases in DEVONthink Pro on macOS.

![screenshot](./screenshot.png)

## Features

- Exposes a comprehensive set of DEVONthink operations as MCP tools
- List, search, and look up records by various attributes
- Create, delete, move, and rename records and groups
- Retrieve and modify record content, properties, and tags
- Create records from URLs in multiple formats
- List open databases and group contents
- All tools are type-safe and validated with Zod schemas

## Tools

### Core Tools

1. `is_running`

   - Checks if DEVONthink is currently running
   - No input required
   - Returns: `{ "success": true | false }`

2. `create_record`

   - Creates new records (notes, bookmarks, groups) with specified properties
   - Input: record type, name, parent group, and optional metadata

3. `delete_record`

   - Deletes records by ID, name, or path
   - Input: record identifier

4. `move_record`

   - Moves records between groups
   - Input: record ID and destination group

5. `get_record_properties`

   - Retrieves detailed metadata and properties for records
   - Input: record identifier

6. `search`

   - Performs text-based searches with various comparison options
   - Input: query string and search options

7. `lookup_record`

   - Looks up records by filename, path, URL, tags, comment, or content hash (exact matches only)
   - Input: lookup type and value

8. `create_from_url`

   - Creates records from web URLs in multiple formats
   - Input: URL and format options

9. `get_open_databases`

   - Lists all currently open databases
   - No input required

10. `list_group_content`

    - Lists the content of a specific group
    - Input: group identifier

11. `get_record_content`

    - Retrieves the content of a specific record
    - Input: record identifier

12. `rename_record`

    - Renames a specific record
    - Input: record ID and new name

13. `add_tags`

    - Adds tags to a specific record
    - Input: record ID and tags

14. `remove_tags`

    - Removes tags from a specific record
    - Input: record ID and tags

15. `classify`

    - Gets classification proposals for a record using DEVONthink's AI
    - Input: record UUID, optional database name, comparison type, and tags option
    - Returns: Array of classification proposals (groups or tags) with scores

16. `compare`
    - Compares records to find similarities (hybrid approach)
    - Input: primary record UUID, optional second record UUID, database name, and comparison type
    - Returns: Either similar records (single mode) or detailed comparison analysis (two-record mode)

### Example: Search Tool

```json
{
  "query": "project plan",
  "comparison": "contains",
  "database": "Inbox"
}
```

Returns:

```json
{
  "results": [
    { "id": "123", "name": "Project Plan", "path": "/Inbox/Project Plan.md" }
  ]
}
```

## Usage with Claude

Add to your Claude configuration:

```json
{
  "mcpServers": {
    "devonthink": {
      "command": "npx",
      "args": ["-y", "mcp-server-devonthink"]
    }
  }
}
```

### Security Hardening (Single Test Database)

For safer testing with MCP clients, configure a single-database lock and restricted tool modes:

- `DEVONTHINK_ALLOWED_DATABASE_UUID`: UUID of the only DEVONthink database this server may access
- `DEVONTHINK_MODE`: `read_only` (default), `read_plus_safe_edit`, or `full_access`
- `DEVONTHINK_ALLOWED_WRITE_TOOLS`: comma-separated tool allowlist for `read_plus_safe_edit`
- `DEVONTHINK_ENABLE_AI_TOOLS`: `true` or `false` (default `false`)
- `DEVONTHINK_ENABLE_SSE`: `true` to enable SSE transport (default disabled)
- `DEVONTHINK_AUDIT_LOG_FILE`: optional path to a persistent JSONL audit log for tool calls, guard decisions, startup, shutdown, and runtime errors
- Profile changes are applied at process startup (update env vars and restart the MCP server)

Recommended start:

```bash
DEVONTHINK_ALLOWED_DATABASE_UUID="<your-test-db-uuid>" \
DEVONTHINK_MODE="read_only" \
DEVONTHINK_ENABLE_AI_TOOLS="false" \
node dist/index.js
```

Guard events are logged to console for auditability:

```
[GUARD] 2026-02-19T14:30:00Z | BLOCKED | delete_record | reason: tool not in allowed list
[GUARD] 2026-02-19T14:31:00Z | ALLOWED | rename_record | uuid: ABC-123
```

To persist debug history across multiple MCP sessions, set an audit log file:

```bash
DEVONTHINK_AUDIT_LOG_FILE="$HOME/Library/Logs/devonthink-mcp.audit.jsonl" \
node dist/index.js
```

Each line is a JSON object. Typical events include:
- `server_startup`
- `server_config`
- `tool_call_started`
- `tool_call_completed`
- `tool_call_failed`
- `guard_blocked`
- `guard_allowed`
- `runtime_error`

Example entry:

```json
{"timestamp":"2026-03-28T09:30:00.000Z","sessionId":"abc123","pid":12345,"event":"tool_call_failed","tool":"lookup_record","durationMs":12,"error":{"name":"McpError","message":"Record is outside allowed database scope"}}
```

## Implementation Details

- Uses JXA (JavaScript for Automation) to control DEVONthink via AppleScript APIs
- All tool inputs are validated with Zod schemas for safety and clarity
- Returns structured JSON for all tool outputs
- Implements robust error handling for all operations
- Includes comprehensive tests using Vitest

See [CLAUDE.md](./CLAUDE.md) for full documentation, tool development guidelines, and API reference.
