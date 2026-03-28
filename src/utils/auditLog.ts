import * as fs from "node:fs";
import * as path from "node:path";

const MAX_STRING_LENGTH = 240;
const MAX_ARRAY_ITEMS = 10;
const MAX_OBJECT_KEYS = 20;
const MAX_DEPTH = 4;
const sessionId = `${Date.now().toString(36)}-${process.pid}-${Math.random()
	.toString(36)
	.slice(2, 8)}`;

let lastAuditFailureKey: string | undefined;
let processHandlersInstalled = false;

function getAuditLogFile(): string | undefined {
	const configured = process.env.DEVONTHINK_AUDIT_LOG_FILE?.trim();
	return configured ? configured : undefined;
}

function truncateString(value: string, limit = MAX_STRING_LENGTH): string {
	if (value.length <= limit) {
		return value;
	}
	return `${value.slice(0, limit)}... [truncated ${value.length - limit} chars]`;
}

function reportAuditFailure(message: string): void {
	const key = `${getAuditLogFile() || "no-path"}:${message}`;
	if (lastAuditFailureKey === key) {
		return;
	}
	lastAuditFailureKey = key;
	console.error(`[audit] ${message}`);
}

export function serializeErrorForAudit(error: unknown): Record<string, unknown> {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack ? truncateString(error.stack, 1200) : undefined,
		};
	}

	return {
		message: truncateString(String(error)),
	};
}

export function summarizeForAudit(value: unknown, depth = 0): unknown {
	if (
		value === null ||
		value === undefined ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}

	if (typeof value === "string") {
		return truncateString(value);
	}

	if (typeof value === "bigint") {
		return value.toString();
	}

	if (value instanceof Error) {
		return serializeErrorForAudit(value);
	}

	if (Array.isArray(value)) {
		if (depth >= MAX_DEPTH) {
			return `[Array(${value.length})]`;
		}

		const summarized = value
			.slice(0, MAX_ARRAY_ITEMS)
			.map((entry) => summarizeForAudit(entry, depth + 1));
		if (value.length > MAX_ARRAY_ITEMS) {
			summarized.push(`[${value.length - MAX_ARRAY_ITEMS} more items]`);
		}
		return summarized;
	}

	if (typeof value === "object") {
		if (depth >= MAX_DEPTH) {
			return "[Max depth reached]";
		}

		const entries = Object.entries(value as Record<string, unknown>);
		const summarized: Record<string, unknown> = {};
		for (const [key, nestedValue] of entries.slice(0, MAX_OBJECT_KEYS)) {
			summarized[key] = summarizeForAudit(nestedValue, depth + 1);
		}
		if (entries.length > MAX_OBJECT_KEYS) {
			summarized.__truncatedKeys = entries.length - MAX_OBJECT_KEYS;
		}
		return summarized;
	}

	return truncateString(String(value));
}

export function writeAuditEvent(event: string, details: Record<string, unknown> = {}): void {
	const auditLogFile = getAuditLogFile();
	if (!auditLogFile) {
		return;
	}

	try {
		fs.mkdirSync(path.dirname(auditLogFile), { recursive: true });
		const entry = {
			timestamp: new Date().toISOString(),
			sessionId,
			pid: process.pid,
			event,
			...(summarizeForAudit(details) as Record<string, unknown>),
		};
		fs.appendFileSync(auditLogFile, `${JSON.stringify(entry)}\n`, "utf8");
	} catch (error) {
		reportAuditFailure(
			`Failed to write audit log entry to '${auditLogFile}': ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

export function installProcessAuditHandlers(transport: "stdio" | "sse"): void {
	if (processHandlersInstalled) {
		return;
	}
	processHandlersInstalled = true;

	process.on("uncaughtException", (error) => {
		writeAuditEvent("runtime_error", {
			transport,
			source: "uncaughtException",
			error: serializeErrorForAudit(error),
		});
	});

	process.on("unhandledRejection", (reason) => {
		writeAuditEvent("runtime_error", {
			transport,
			source: "unhandledRejection",
			error: serializeErrorForAudit(reason),
		});
	});
}

export function getAuditLogStatus(): { enabled: boolean; path?: string; sessionId: string } {
	const auditLogFile = getAuditLogFile();
	return {
		enabled: Boolean(auditLogFile),
		path: auditLogFile,
		sessionId,
	};
}
