# Next Work Plan: DEVONthink App Runtime Stabilization

## Current status

This fork is built and usable as a guarded local MCP server in principle:
- `stdio` is the intended transport
- `DEVONTHINK_MODE` controls tool exposure
- `DEVONTHINK_ALLOWED_DATABASE_UUID` can lock the server to one database
- `DEVONTHINK_AUDIT_LOG_FILE` records startup, guard, tool, and runtime events
- `DEVONTHINK_ENABLE_AI_TOOLS=false` keeps AI tools disabled unless explicitly enabled

The local Codex MCP entry currently points at this repository's built server:

```text
/Users/lgajewski/Documents/Codex/Areas/3-system/mcp-devonthink-modyfikacja/dist/index.js
```

The active app target for this machine is:

```text
/Applications/DEVONthink 2.app
```

Important naming decision:
- `DEVONthink 2.app` is the newer DEVONthink app used here
- `DEVONthink 3.app` is an older parallel install
- do not switch to `DEVONthink 3.app` to make tests pass

## Current repo state

The cleanup pass is complete enough to checkpoint:
- dead `justfile` commands from another project were replaced with real local commands
- guard logs no longer write allowed-call messages to `stdout`
- documentation now lists `set_record_properties`
- app config comments document the local bundle-name vs product-version mismatch
- `.mcp.json` was removed because it was a local empty config file and was not tracked
- a focused app-config unit test covers preserving app bundle paths such as `/Applications/DEVONthink 2.app`

## Verified checks

The non-invasive project checks pass:

```bash
npm run format:check
npm test
npm run build
```

Latest verified result:
- formatting: passed
- unit/server tests: passed, 21 tests
- TypeScript build: passed

## Current blocker

`npm run test:integration` does not currently validate the live integration.

Observed failure:

```text
Error: Brak parametru
```

Where it appears:
- integration global setup calls `createDatabase` through Node/JXA
- the setup fails before Vitest can collect and run the integration test files

Observed distinction:
- direct shell `osascript` can see `/Applications/DEVONthink 2.app`
- direct shell `osascript` can list the expected open databases
- the Node runtime used by this MCP server can fail when it launches `osascript` and sends parameterized DEVONthink JXA commands

Practical meaning:
- this is not a product-version naming issue
- this is not a reason to target `DEVONthink 3.app`
- the next work should isolate the Node-to-osascript-to-DEVONthink execution boundary

## Next stage objective

Make the active DEVONthink app target reliable from the same Node runtime that the MCP server uses.

The success condition is narrow:
- `executeJxa` can run a minimal read command against `/Applications/DEVONthink 2.app`
- `executeJxa` can run a minimal parameterized command against the same app
- integration setup can create and remove a temporary test database
- `npm run test:integration` reaches actual test execution

## Proposed work sequence

### 1. Build a minimal runtime probe

Create a small diagnostic script or test helper that runs the same command through:
- direct shell `osascript`
- Node `execFile`
- the repository's `executeJxa`

The probe should capture:
- command shape
- app target string
- stdout
- stderr
- exit code
- parsed JSON result if available

Keep this probe local to the repository, for example under `scripts/` or `tests/integration/diagnostics/`.

### 2. Separate app resolution from command execution

Test these targets explicitly:
- `/Applications/DEVONthink 2.app`
- `DEVONthink 2`
- `DEVONthink`
- bundle identifier `com.devon-technologies.think` where supported

Do not assume any target is correct because of the product version name. The correct target is the one that works from Node for both read and parameterized commands.

### 3. Fix the integration harness before broad tool testing

Current integration tests depend on global setup. That makes one setup failure look like the whole suite is broken.

Refactor the harness so it can report clearer stages:
- app reachable
- database list readable
- temporary database creatable
- temporary record creatable
- cleanup successful

This should happen before changing production tool behavior.

### 4. Validate safe profile through MCP server boundaries

After the runtime probe is green, test the actual guarded server path:
- startup with `DEVONTHINK_MODE=read_only`
- startup with single-database lock
- exposed tools list
- `current_database`
- `search`
- one rejected write call, verified in audit log

Only then test `read_plus_safe_edit`.

### 5. Re-enable integration suite as a release gate

When setup is stable:
- fix any Vitest include/root issue if it still reports `No test files found`
- run `npm run test:integration`
- keep the standard gate as:

```bash
npm run format:check
npm test
npm run build
npm run test:integration
```

## Do not do next

- Do not deploy, publish, or push remotely without explicit instruction.
- Do not target `DEVONthink 3.app` as a workaround.
- Do not broaden write permissions while runtime behavior is still unclear.
- Do not run destructive DEVONthink operations outside a temporary database or the configured safe-edit allowlist.

## Suggested first task for the next session

Start with the minimal runtime probe.

Recommended question:

```text
Why does direct shell osascript reach DEVONthink 2.app, while Node-launched osascript returns `Error: Brak parametru` for parameterized DEVONthink JXA commands?
```

The expected output of that task should be a short diagnostic matrix and a concrete recommendation for how `executeJxa` or the integration setup should launch DEVONthink commands.
