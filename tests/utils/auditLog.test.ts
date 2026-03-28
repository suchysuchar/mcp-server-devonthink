import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	getAuditLogStatus,
	serializeErrorForAudit,
	summarizeForAudit,
	writeAuditEvent,
} from "../../src/utils/auditLog";

const originalAuditLogFile = process.env.DEVONTHINK_AUDIT_LOG_FILE;
const createdPaths: string[] = [];

afterEach(() => {
	if (originalAuditLogFile === undefined) {
		delete process.env.DEVONTHINK_AUDIT_LOG_FILE;
	} else {
		process.env.DEVONTHINK_AUDIT_LOG_FILE = originalAuditLogFile;
	}

	for (const createdPath of createdPaths.splice(0)) {
		try {
			fs.rmSync(createdPath, { recursive: true, force: true });
		} catch (_) {}
	}
});

describe("summarizeForAudit", () => {
	it("truncates long strings and limits arrays", () => {
		const summary = summarizeForAudit({
			content: "x".repeat(400),
			results: Array.from({ length: 12 }, (_, index) => index),
		}) as Record<string, unknown>;

		expect(summary.content).toMatch(/\[truncated 160 chars\]$/);
		expect(summary.results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, "[2 more items]"]);
	});

	it("serializes nested errors", () => {
		const error = new Error("Boom");
		const summary = summarizeForAudit({ error }) as Record<string, unknown>;

		expect(summary.error).toMatchObject({
			name: "Error",
			message: "Boom",
		});
	});
});

describe("serializeErrorForAudit", () => {
	it("returns a readable shape for unknown values", () => {
		expect(serializeErrorForAudit("failure")).toEqual({ message: "failure" });
	});
});

describe("writeAuditEvent", () => {
	it("does nothing when audit logging is disabled", () => {
		delete process.env.DEVONTHINK_AUDIT_LOG_FILE;
		writeAuditEvent("tool_call_started", { tool: "search" });

		expect(getAuditLogStatus().enabled).toBe(false);
	});

	it("writes JSONL audit entries when configured", () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-log-test-"));
		createdPaths.push(tempDir);
		const auditLogFile = path.join(tempDir, "logs", "audit.jsonl");
		process.env.DEVONTHINK_AUDIT_LOG_FILE = auditLogFile;

		writeAuditEvent("tool_call_completed", {
			tool: "search",
			argsSummary: {
				query: "project plan",
			},
			resultSummary: {
				success: true,
				results: Array.from({ length: 12 }, (_, index) => ({ index })),
			},
		});

		const fileContents = fs.readFileSync(auditLogFile, "utf8").trim();
		const entry = JSON.parse(fileContents) as Record<string, unknown>;

		expect(entry.event).toBe("tool_call_completed");
		expect(entry.sessionId).toBeTruthy();
		expect(entry.pid).toBe(process.pid);
		expect(entry.argsSummary).toMatchObject({
			query: "project plan",
		});
		expect(entry.resultSummary).toMatchObject({
			success: true,
		});
		expect((entry.resultSummary as Record<string, unknown>).results).toHaveLength(11);
	});
});
