import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createServer } from "../../src/devonthink";

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

describe("audit logging in createServer", () => {
	it("writes audit entries for rejected MCP tool calls", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-server-test-"));
		createdPaths.push(tempDir);
		const auditLogFile = path.join(tempDir, "audit.jsonl");
		process.env.DEVONTHINK_AUDIT_LOG_FILE = auditLogFile;

		const { server, cleanup } = await createServer();

		try {
			const callHandler = (
				server as unknown as {
					_requestHandlers: Map<
						string,
						(request: unknown, extra: unknown) => Promise<unknown>
					>;
				}
			)._requestHandlers.get("tools/call");

			expect(callHandler).toBeTypeOf("function");

			await expect(
				callHandler!(
					{
						jsonrpc: "2.0",
						id: 1,
						method: "tools/call",
						params: {
							name: "does_not_exist",
							arguments: {},
						},
					},
					{},
				),
			).rejects.toMatchObject({
				code: -32601,
			});

			const entries = fs
				.readFileSync(auditLogFile, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as Record<string, unknown>);

			expect(entries.some((entry) => entry.event === "server_config")).toBe(true);
			expect(
				entries.some(
					(entry) =>
						entry.event === "tool_call_rejected" && entry.reason === "unknown_tool",
				),
			).toBe(true);
		} finally {
			await cleanup();
		}
	});
});
