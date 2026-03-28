#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./devonthink.js";
import {
	installProcessAuditHandlers,
	serializeErrorForAudit,
	writeAuditEvent,
} from "./utils/auditLog.js";

async function main() {
	installProcessAuditHandlers("stdio");
	writeAuditEvent("server_startup", {
		transport: "stdio",
	});

	const transport = new StdioServerTransport();
	const { server, cleanup } = await createServer();

	await server.connect(transport);

	// Cleanup on exit
	process.on("SIGINT", async () => {
		writeAuditEvent("server_shutdown", {
			transport: "stdio",
			reason: "SIGINT",
		});
		await cleanup();
		await server.close();
		process.exit(0);
	});
}

main().catch((error) => {
	console.error("Server error:", error);
	writeAuditEvent("runtime_error", {
		transport: "stdio",
		source: "main.catch",
		error: serializeErrorForAudit(error),
	});
	process.exit(1);
});
