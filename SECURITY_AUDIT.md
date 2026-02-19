# Security Audit Report: mcp-server-devonthink

**Date:** 2026-02-19
**Scope:** Full codebase review (v1.7.1)
**Auditor:** Automated security analysis

---

## Executive Summary

This MCP (Model Context Protocol) server bridges AI assistants with DEVONthink, a macOS document management application. It executes JXA (JavaScript for Automation) scripts via `osascript` to interact with DEVONthink's API.

The project has a well-designed security mode system (read_only / read_plus_safe_edit / full_access) and single-database locking. However, the audit identified **critical JXA injection vulnerabilities** in several tools where user input is interpolated into scripts without escaping, alongside outdated dependencies with known CVEs.

### Risk Summary

| Severity | Count | Description |
|----------|-------|-------------|
| CRITICAL | 3 | JXA script injection via unescaped user input |
| HIGH     | 2 | Missing escaping in additional tools; outdated SDK with known CVEs |
| MEDIUM   | 3 | SSE transport lacks authentication; inconsistent escaping patterns; `isJXASafeString` not universally enforced |
| LOW      | 3 | Dev dependency CVEs; schema validation gaps; information leakage in error messages |

---

## 1. Project Overview

### What It Does

`mcp-server-devonthink` is a TypeScript MCP server that exposes 27 tools for interacting with DEVONthink 3/4 on macOS. It supports two transports:

- **StdioServerTransport** (`src/index.ts`): Primary mode - communicates via stdin/stdout (used by AI clients like Claude Desktop)
- **SSEServerTransport** (`src/sse.ts`): Alternative mode - HTTP/SSE via Express (requires `DEVONTHINK_ENABLE_SSE=true`)

### Architecture

```
AI Client (Claude, etc.)
    |
    v
MCP Protocol (stdio or SSE)
    |
    v
devonthink.ts (Security guards, tool routing)
    |
    v
Tool implementations (src/tools/*.ts)
    |
    v
executeJxa() -> osascript -l JavaScript -e <script>
    |
    v
DEVONthink application (via JXA/AppleScript bridge)
```

### Security Model

The server implements three security layers:

1. **Security modes** (`DEVONTHINK_MODE`): Controls which tools are exposed
   - `read_only` (default): Only 7 read-only tools
   - `read_plus_safe_edit`: Read tools + configurable safe write tools
   - `full_access`: All 27 tools

2. **Single-database lock** (`DEVONTHINK_ALLOWED_DATABASE_UUID`): Restricts all operations to one database

3. **Tool-level guards** (`applySecurityGuards`): Validates record ownership before execution

---

## 2. Critical Findings

### CRITICAL-01: JXA Injection in `createRecord.ts`

**File:** `src/tools/createRecord.ts:48-79`
**Severity:** CRITICAL
**CVSS Estimate:** 9.1

All user-supplied parameters are interpolated directly into the JXA script without any escaping:

```typescript
// Line 48-50: databaseName - NO ESCAPING
if ("${databaseName || ""}") {
  targetDatabase = databases.find(db => db.name() === "${databaseName}");

// Line 70-72: name and type - NO ESCAPING
const recordProps = {
  name: "${name}",
  type: "${type}"
};

// Line 76: content - ONLY backtick escaping, not comprehensive
recordProps.content = \`${content.replace(/`/g, "\\`")}\`;

// Line 79: url - NO ESCAPING
recordProps.URL = "${url}";

// Line 60-61: parentGroupUuid - NO ESCAPING
destinationGroup = theApp.getRecordWithUuid("${parentGroupUuid}");
```

**Impact:** An attacker who can invoke this tool (e.g., through prompt injection in an AI context) can execute arbitrary JXA code on the host system. JXA has full system access including file operations, shell command execution, and application control.

**Proof of Concept:**
```json
{
  "name": "\"; const app = Application('System Events'); app.doShellScript('id > /tmp/pwned'); //",
  "type": "markdown"
}
```

The `name` value breaks out of the string context, executes a shell command, and comments out the rest of the script.

---

### CRITICAL-02: JXA Injection in `lookupRecord.ts`

**File:** `src/tools/lookupRecord.ts:59-106`
**Severity:** CRITICAL
**CVSS Estimate:** 9.1

Every user parameter (`databaseName`, `value`, `lookupType`) is interpolated raw:

```typescript
// Line 59-61: databaseName unescaped
searchDatabase = databases.find(db => db.name() === "${databaseName}");

// Lines 78-91: value unescaped in ALL switch branches
theApp.lookupRecordsWithFile("${value}", { in: searchDatabase });
theApp.lookupRecordsWithPath("${value}", { in: searchDatabase });
theApp.lookupRecordsWithURL("${value}", { in: searchDatabase });
theApp.lookupRecordsWithComment("${value}", { in: searchDatabase });
theApp.lookupRecordsWithContentHash("${value}", { in: searchDatabase });

// Line 94-95: value also unescaped in tag branch
if (tagArray.length === 0 && "${value}") {
  tagArray.push("${value}");
```

**Impact:** Same as CRITICAL-01 - arbitrary code execution via any of the 6 lookup types.

**Note:** The file does not even import `escapeStringForJXA`.

---

### CRITICAL-03: JXA Injection in `createFromUrl.ts`

**File:** `src/tools/createFromUrl.ts:72-130`
**Severity:** CRITICAL
**CVSS Estimate:** 9.1

All parameters interpolated raw despite the `url` field having Zod `.url()` validation:

```typescript
// Line 72-74: databaseName unescaped
targetDatabase = databases.find(db => db.name() === "${databaseName}");

// Line 84-85: parentGroupUuid unescaped
destinationGroup = theApp.getRecordWithUuid("${parentGroupUuid}");

// Line 96-99: name, userAgent, referrer all unescaped
options.name = "${name}";
options.agent = "${userAgent}";
options.referrer = "${referrer}";

// Lines 116-125: url unescaped in all format branches
theApp.createFormattedNoteFrom("${url}", options);
theApp.createMarkdownFrom("${url}", options);
```

**Impact:** While `url` has `.url()` Zod validation (limiting injection surface slightly), all other fields (`databaseName`, `parentGroupUuid`, `name`, `userAgent`, `referrer`) are fully exploitable.

---

### HIGH-01: Missing Escaping in `listGroupContent.ts`

**File:** `src/tools/listGroupContent.ts:41-54`
**Severity:** HIGH
**CVSS Estimate:** 8.1

```typescript
// Line 41-43: databaseName unescaped
targetDatabase = databases.find(db => db.name() === "${databaseName}");

// Line 54: uuid unescaped
const group = theApp.getRecordWithUuid("${uuid}");
```

**Note:** This file does not import `escapeStringForJXA` at all.

---

### HIGH-02: Outdated `@modelcontextprotocol/sdk` (v1.0.1)

**Severity:** HIGH

The MCP SDK is pinned at v1.0.1 while the current patched version is v1.26.0+. Two advisories:

| Advisory | Description |
|----------|-------------|
| GHSA-8r9q-7v3j-jr4g | ReDoS vulnerability |
| GHSA-w48q-cv73-mx4w | DNS rebinding protection not enabled by default |

The DNS rebinding issue is particularly relevant for the SSE transport mode, where an attacker on the local network could potentially interact with the server.

---

## 3. Medium Findings

### MEDIUM-01: SSE Transport Lacks Authentication

**File:** `src/sse.ts:20-36`
**Severity:** MEDIUM

The SSE transport exposes HTTP endpoints (`/sse`, `/message`) with:
- No authentication or API key requirement
- No CORS restrictions
- No rate limiting
- Only protected by the `DEVONTHINK_ENABLE_SSE=true` flag check

While the flag requirement and "controlled local debugging" documentation help, any local process or malicious web page (via DNS rebinding) could connect and invoke tools.

**Mitigations in place:** Requires explicit environment variable opt-in.

---

### MEDIUM-02: Inconsistent Escaping Patterns Across Tools

**Severity:** MEDIUM

The codebase has three distinct patterns for handling user input in JXA scripts:

1. **No escaping at all** (CRITICAL tools above)
2. **`isJXASafeString()` + `escapeStringForJXA()`** (properly secured tools like `search.ts`, `setRecordProperties.ts`, `updateRecordContent.ts`)
3. **`escapeStringForJXA()` without `isJXASafeString()` pre-check** (some tools use escaping but skip the safety validation)

Tools properly secured (pattern 2):
- `search.ts` - full validation + escaping
- `deleteRecord.ts` - proper escaping
- `moveRecord.ts` - proper escaping
- `getRecordProperties.ts` - proper escaping
- `getRecordByIdentifier.ts` - proper escaping
- `getRecordContent.ts` - proper escaping
- `updateRecordContent.ts` - full validation + escaping
- `setRecordProperties.ts` - full validation + escaping
- `addTags.ts` - proper escaping
- `removeTags.ts` - proper escaping

AI tools (using DevonThinkTool base class) are all properly secured via `helpers.formatValue()`.

---

### MEDIUM-03: `isJXASafeString()` Not Universally Enforced

**File:** `src/utils/escapeString.ts:86-93`
**Severity:** MEDIUM

The `isJXASafeString()` function exists but is only called in ~5 tools (search, updateRecordContent, setRecordProperties, and some others). Many tools that DO use `escapeStringForJXA()` skip this pre-validation step. While `escapeStringForJXA()` handles most dangerous characters, `isJXASafeString()` catches control characters (0x00-0x08, 0x0B, etc.) that escaping doesn't address.

---

## 4. Low Findings

### LOW-01: Development Dependency Vulnerabilities

**Severity:** LOW (dev-only)

| Package | Advisory | Severity |
|---------|----------|----------|
| vite 6.4.0 | GHSA-g4jq-h2w9-997c | Moderate |
| vite 6.4.0 | GHSA-jqfw-vq24-v9c3 | Moderate |
| minimatch (via shx) | GHSA-3ppc-4f35-3m26 | High |
| brace-expansion (via shx) | GHSA-v6h2-p8h4-qcjw | Low |

These are dev dependencies and not exploitable in production, but should be updated.

---

### LOW-02: Schema Validation Gaps

**Severity:** LOW

All Zod schemas use `.strict()` (good), but string inputs lack character-level restrictions:
- `name: z.string()` - no `.max()`, no `.regex()` constraints
- `value: z.string()` - completely unrestricted
- `content: z.string()` - no limits

While the escaping layer should handle this, defense-in-depth would benefit from schema-level constraints (e.g., `.max(10000)` for content, `.regex()` for UUIDs).

---

### LOW-03: Verbose Error Messages

**Severity:** LOW

Error messages in some tools expose internal details:
- Database names and paths in error responses
- Full JXA error stack traces via `error.toString()`
- Internal record IDs and UUIDs in error context

In the MCP context (AI client), this is low risk, but could aid reconnaissance if the server were exposed more broadly.

---

## 5. Positive Security Observations

The project has several security strengths worth noting:

1. **Well-designed security mode system**: The `read_only` default, configurable write tools, and database locking are well-implemented in `devonthink.ts`.

2. **`execFile` instead of `exec`**: The `executeJxa()` function uses `execFile` which passes the script as an argument rather than through shell interpretation, preventing shell-level injection.

3. **Proper escaping in newer tools**: Tools written more recently (search, setRecordProperties, AI tools, DevonThinkTool base class) consistently use `escapeStringForJXA()` and `isJXASafeString()`.

4. **DevonThinkTool base class**: The newer tool pattern (`src/tools/base/DevonThinkTool.ts`) with `helpers.formatValue()` bakes in security by default. All AI tools use this pattern.

5. **Zod `.strict()` on all schemas**: Prevents unexpected fields from being passed through.

6. **Environment variable guard on SSE**: Requires explicit opt-in for the network-exposed transport.

---

## 6. Recommendations

### Immediate (P0)

1. **Fix CRITICAL-01/02/03 and HIGH-01**: Add `escapeStringForJXA()` to all raw string interpolations in:
   - `createRecord.ts` (name, type, content, url, databaseName, parentGroupUuid)
   - `lookupRecord.ts` (value, databaseName)
   - `createFromUrl.ts` (databaseName, parentGroupUuid, name, userAgent, referrer)
   - `listGroupContent.ts` (uuid, databaseName)

2. **Add `isJXASafeString()` pre-checks** in these same files before interpolation.

3. **Consider migrating affected tools to DevonThinkTool base class** which handles escaping by default.

### Short-term (P1)

4. **Upgrade `@modelcontextprotocol/sdk`** from 1.0.1 to latest (1.26.0+) to fix ReDoS and DNS rebinding vulnerabilities.

5. **Run `npm audit fix`** to resolve `qs`/`body-parser`/`express`/`vite` vulnerabilities.

6. **Add CORS restrictions** to the SSE transport in `sse.ts` (e.g., `cors({ origin: 'http://localhost' })`).

7. **Standardize escaping pattern**: Ensure ALL tools follow the same pattern: `isJXASafeString()` check -> `escapeStringForJXA()` for interpolation.

### Long-term (P2)

8. **Add security-focused tests**: Create test cases with injection payloads for every tool (e.g., inputs containing `"`, `\`, `');`, template literal breaks).

9. **Add Zod schema constraints**: `.max()` on string lengths, `.regex()` for UUID format validation, `.url()` for URL fields.

10. **Consider parameterized JXA execution**: Instead of string interpolation, explore passing parameters as separate `osascript` arguments or via environment variables to eliminate the injection surface entirely.

11. **Add authentication to SSE transport**: At minimum, require a bearer token via environment variable.

---

## 7. Files Audited

| File | Lines | Escaping Status |
|------|-------|-----------------|
| `src/applescript/execute.ts` | 27 | N/A (executor) |
| `src/devonthink.ts` | 537 | Properly escaped |
| `src/index.ts` | 23 | N/A (entry point) |
| `src/sse.ts` | 44 | See MEDIUM-01 |
| `src/utils/escapeString.ts` | 93 | Security utility |
| `src/utils/jxaHelpers.ts` | 331 | Properly escaped |
| `src/tools/base/DevonThinkTool.ts` | 223 | Properly escaped |
| `src/tools/createRecord.ts` | 121 | **CRITICAL - No escaping** |
| `src/tools/lookupRecord.ts` | 170 | **CRITICAL - No escaping** |
| `src/tools/createFromUrl.ts` | 167 | **CRITICAL - No escaping** |
| `src/tools/listGroupContent.ts` | 110 | **HIGH - No escaping** |
| `src/tools/deleteRecord.ts` | 124 | Properly escaped |
| `src/tools/moveRecord.ts` | 173 | Properly escaped |
| `src/tools/getRecordProperties.ts` | 195 | Properly escaped |
| `src/tools/getRecordByIdentifier.ts` | 161 | Properly escaped |
| `src/tools/getRecordContent.ts` | 107 | Properly escaped |
| `src/tools/search.ts` | 332 | Properly escaped |
| `src/tools/renameRecord.ts` | 97 | Properly escaped |
| `src/tools/addTags.ts` | 86 | Properly escaped |
| `src/tools/removeTags.ts` | 105 | Properly escaped |
| `src/tools/classify.ts` | 154 | Properly escaped |
| `src/tools/compare.ts` | 249 | Properly escaped |
| `src/tools/replicateRecord.ts` | 203 | Properly escaped |
| `src/tools/duplicateRecord.ts` | 196 | Properly escaped |
| `src/tools/convertRecord.ts` | 221 | Properly escaped |
| `src/tools/updateRecordContent.ts` | 110 | Properly escaped |
| `src/tools/setRecordProperties.ts` | 202 | Properly escaped |
| `src/tools/ai/askAiAboutDocuments.ts` | 110 | Properly escaped (base class) |
| `src/tools/ai/checkAIHealth.ts` | 138 | Properly escaped (base class) |
| `src/tools/ai/createSummaryDocument.ts` | 150 | Properly escaped (base class) |
| `src/tools/ai/getToolDocumentation.ts` | 254 | Properly escaped (base class) |
| `src/tools/ai/constants.ts` | 21 | N/A (constants) |

---

*End of Security Audit Report*
