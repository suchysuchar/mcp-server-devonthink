# Codex Setup For Local DEVONthink MCP

This guide explains how to run this fork as a local MCP server for Codex with:
- single-database safety
- persistent audit logging
- practical debugging steps when Codex does not show the runtime error directly

## Recommended operating model

Use the server over `stdio`, not SSE.

Why:
- `stdio` is simpler
- it avoids an extra local HTTP layer
- it is the normal setup for a local desktop MCP integration

Start with the safest profile:
- `DEVONTHINK_MODE=read_only`
- `DEVONTHINK_ENABLE_AI_TOOLS=false`
- `DEVONTHINK_ALLOWED_DATABASE_UUID=<test database UUID>`
- `DEVONTHINK_AUDIT_LOG_FILE=<path to JSONL audit log>`

Only relax permissions after verifying that the tools and audit log behave correctly.

## 1. Build the server

From the repository root:

```bash
npm ci --cache /tmp/npm-cache-mcp
npm run build
```

## 2. Choose an audit log path

Example:

```bash
mkdir -p "$HOME/Library/Logs"
export DEVONTHINK_AUDIT_LOG_FILE="$HOME/Library/Logs/devonthink-mcp.audit.jsonl"
```

This file is append-only JSONL, which means:
- one JSON object per line
- safe to inspect with `tail`, `rg`, `jq`
- useful across multiple sessions

## 3. Add the MCP server to Codex

Replace:
- `/ABS/PATH/TO/mcp-server-devonthink`
- `YOUR_DATABASE_UUID`

with your real values.

```bash
codex mcp add devonthink-safe \
  --env DEVONTHINK_ALLOWED_DATABASE_UUID=YOUR_DATABASE_UUID \
  --env DEVONTHINK_MODE=read_only \
  --env DEVONTHINK_ENABLE_AI_TOOLS=false \
  --env DEVONTHINK_AUDIT_LOG_FILE="$HOME/Library/Logs/devonthink-mcp.audit.jsonl" \
  -- node /ABS/PATH/TO/mcp-server-devonthink/dist/index.js
```

Then verify:

```bash
codex mcp get devonthink-safe
codex mcp list
```

## 4. Restart the session after config changes

If you change:
- allowed database UUID
- mode
- AI tools
- audit log file

restart the MCP process or open a fresh Codex session.

Reason:
- this server reads its guard configuration on startup
- the exposed tool list is also decided on startup

## 5. What the audit log contains

Typical events:
- `server_startup`
- `server_config`
- `tool_call_started`
- `tool_call_completed`
- `tool_call_failed`
- `guard_blocked`
- `guard_allowed`
- `runtime_error`

Example:

```json
{"timestamp":"2026-03-28T09:30:00.000Z","sessionId":"abc123","pid":12345,"event":"tool_call_failed","tool":"lookup_record","durationMs":12,"error":{"name":"McpError","message":"Record is outside allowed database scope"}}
```

## 6. Fast debugging commands

Show latest events:

```bash
tail -n 30 "$HOME/Library/Logs/devonthink-mcp.audit.jsonl"
```

Show only problems:

```bash
rg 'tool_call_failed|runtime_error|guard_blocked' "$HOME/Library/Logs/devonthink-mcp.audit.jsonl"
```

Show configuration and startup events:

```bash
rg 'server_startup|server_config' "$HOME/Library/Logs/devonthink-mcp.audit.jsonl"
```

Pretty-print with `jq`:

```bash
tail -n 20 "$HOME/Library/Logs/devonthink-mcp.audit.jsonl" | jq .
```

## 7. Interpreting common problems

### `guard_blocked`

Meaning:
- the server intentionally refused the action

Typical reasons:
- tool disabled by current mode
- UUID belongs to a different database
- single-database lock blocks the request

### `tool_call_failed`

Meaning:
- the request reached the tool but ended with an MCP/JXA/runtime error

Check:
- tool name
- summarized arguments
- error name and message

### `runtime_error`

Meaning:
- something failed outside normal tool execution

Examples:
- startup issue
- unhandled rejection
- unexpected exception

## 8. Safe rollout path

Recommended order:

1. Run with `read_only`
2. Verify audit log is being written
3. Test `is_running`, `current_database`, `search`
4. If needed, move to `read_plus_safe_edit`
5. Allow only the minimum write tools

Example:

```bash
codex mcp remove devonthink-safe

codex mcp add devonthink-safe \
  --env DEVONTHINK_ALLOWED_DATABASE_UUID=YOUR_DATABASE_UUID \
  --env DEVONTHINK_MODE=read_plus_safe_edit \
  --env DEVONTHINK_ALLOWED_WRITE_TOOLS=rename_record,add_tags,remove_tags \
  --env DEVONTHINK_ENABLE_AI_TOOLS=false \
  --env DEVONTHINK_AUDIT_LOG_FILE="$HOME/Library/Logs/devonthink-mcp.audit.jsonl" \
  -- node /ABS/PATH/TO/mcp-server-devonthink/dist/index.js
```

## 9. Practical note

If Codex does something odd and the chat does not clearly show the failure, the audit log is the first place to inspect.

That is the main reason this fork now includes persistent audit logging.
