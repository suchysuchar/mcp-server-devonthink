import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { createServer } from "./devonthink.js";

async function main() {
	const sseEnabled = process.env.DEVONTHINK_ENABLE_SSE === "true";
	if (!sseEnabled) {
		console.error(
			"SSE transport is disabled. Set DEVONTHINK_ENABLE_SSE=true only for controlled local debugging.",
		);
		process.exit(1);
	}

	const app = express();

	const { server, cleanup } = await createServer();

	let transport: SSEServerTransport;

	app.get("/sse", async (req, res) => {
		console.log("Received connection");
		transport = new SSEServerTransport("/message", res);
		await server.connect(transport);

		server.onclose = async () => {
			await cleanup();
			await server.close();
			process.exit(0);
		};
	});

	app.post("/message", async (req, res) => {
		console.log("Received message");

		await transport.handlePostMessage(req, res);
	});

	const PORT = process.env.PORT || 3001;
	app.listen(PORT, () => {
		console.log(`Server is running on port ${PORT}`);
	});
}

main();
