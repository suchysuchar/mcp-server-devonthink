---
name: devonthink-mcp-codex
description: Use when working with this DEVONthink MCP fork in Codex: adding the local MCP server to Codex, choosing safe environment variables, reading the JSONL audit log, debugging hidden runtime errors, or explaining why a DEVONthink MCP tool was blocked or failed.
---

# DEVONthink MCP In Codex

Use this skill when the task is about:
- running this repository as a local MCP server for Codex
- configuring safe DEVONthink MCP access
- reading or interpreting the persistent audit log
- debugging tool failures that the MCP client UI did not surface clearly

## Default operating mode

Prefer this startup profile first:
- `DEVONTHINK_MODE=read_only`
- `DEVONTHINK_ENABLE_AI_TOOLS=false`
- `DEVONTHINK_ALLOWED_DATABASE_UUID=<test database UUID>`
- `DEVONTHINK_AUDIT_LOG_FILE=<jsonl log path>`

Reason:
- this minimizes blast radius
- the audit log gives post-session visibility into blocked calls, runtime errors, and tool failures

## Standard workflow

1. Build the repo:
```bash
npm ci --cache /tmp/npm-cache-mcp
npm run build
```

2. Add the MCP server to Codex using `stdio`, not SSE:
```bash
codex mcp add devonthink-safe \
  --env DEVONTHINK_ALLOWED_DATABASE_UUID=YOUR_DATABASE_UUID \
  --env DEVONTHINK_MODE=read_only \
  --env DEVONTHINK_ENABLE_AI_TOOLS=false \
  --env DEVONTHINK_AUDIT_LOG_FILE="$HOME/Library/Logs/devonthink-mcp.audit.jsonl" \
  -- node /ABS/PATH/TO/mcp-server-devonthink/dist/index.js
```

3. Verify configuration:
```bash
codex mcp get devonthink-safe
codex mcp list
```

4. After changing env vars, restart the MCP process or open a fresh Codex session.

## Audit log usage

The file configured by `DEVONTHINK_AUDIT_LOG_FILE` is append-only JSONL.

Key events:
- `server_startup`
- `server_config`
- `tool_call_started`
- `tool_call_completed`
- `tool_call_failed`
- `guard_blocked`
- `guard_allowed`
- `runtime_error`

When debugging, start with:
```bash
tail -n 30 "$HOME/Library/Logs/devonthink-mcp.audit.jsonl"
rg 'tool_call_failed|runtime_error|guard_blocked' "$HOME/Library/Logs/devonthink-mcp.audit.jsonl"
```

## How to reason about failures

If you see:

- `guard_blocked`
  The server intentionally refused the call. Check mode, allowed write tools, and allowed database UUID.

- `tool_call_failed`
  The request reached the tool, but the tool or JXA layer failed. Inspect the summarized args and error object.

- `runtime_error`
  Something failed outside the normal tool response flow. Treat this as infrastructure/debugging first, not user error.

## When to relax permissions

Only move from `read_only` to `read_plus_safe_edit` after:
- MCP registration works
- DEVONthink is reachable
- the audit log is being written
- basic read operations behave correctly

If writes are needed, prefer:
```bash
DEVONTHINK_MODE=read_plus_safe_edit
DEVONTHINK_ALLOWED_WRITE_TOOLS=rename_record,add_tags,remove_tags
```

Do not default to `full_access` unless the user explicitly asks for it and understands the tradeoff.

## Reference

For a fuller walkthrough, read:
- `docs/codex-setup.md`
