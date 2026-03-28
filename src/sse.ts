import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { createServer } from "./devonthink.js";
import {
	installProcessAuditHandlers,
	serializeErrorForAudit,
	writeAuditEvent,
} from "./utils/auditLog.js";

async function main() {
	installProcessAuditHandlers("sse");
	const sseEnabled = process.env.DEVONTHINK_ENABLE_SSE === "true";
	if (!sseEnabled) {
		console.error(
			"SSE transport is disabled. Set DEVONTHINK_ENABLE_SSE=true only for controlled local debugging.",
		);
		process.exit(1);
	}

	const app = express();

	const { server, cleanup } = await createServer();
	writeAuditEvent("server_startup", {
		transport: "sse",
	});

	let transport: SSEServerTransport;

	app.get("/sse", async (req, res) => {
		console.log("Received connection");
		writeAuditEvent("transport_event", {
			transport: "sse",
			event: "connection_opened",
		});
		transport = new SSEServerTransport("/message", res);
		await server.connect(transport);

		server.onclose = async () => {
			writeAuditEvent("server_shutdown", {
				transport: "sse",
				reason: "server_onclose",
			});
			await cleanup();
			await server.close();
			process.exit(0);
		};
	});

	app.post("/message", async (req, res) => {
		console.log("Received message");
		writeAuditEvent("transport_event", {
			transport: "sse",
			event: "message_received",
		});

		await transport.handlePostMessage(req, res);
	});

	const PORT = process.env.PORT || 3001;
	app.listen(PORT, () => {
		console.log(`Server is running on port ${PORT}`);
	});
}

main().catch((error) => {
	console.error("Server error:", error);
	writeAuditEvent("runtime_error", {
		transport: "sse",
		source: "main.catch",
		error: serializeErrorForAudit(error),
	});
	process.exit(1);
});
