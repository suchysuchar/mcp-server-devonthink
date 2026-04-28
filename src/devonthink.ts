import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	ErrorCode,
	ListResourcesRequestSchema,
	ListPromptsRequestSchema,
	ListResourceTemplatesRequestSchema,
	McpError,
	Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { executeJxa } from "./applescript/execute.js";
import { escapeStringForJXA } from "./utils/escapeString.js";
import { isRunningTool } from "./tools/isRunning.js";
import { createRecordTool } from "./tools/createRecord.js";
import { deleteRecordTool } from "./tools/deleteRecord.js";
import { moveRecordTool } from "./tools/moveRecord.js";
import { getRecordPropertiesTool } from "./tools/getRecordProperties.js";
import { getRecordByIdentifierTool } from "./tools/getRecordByIdentifier.js";
import { searchTool } from "./tools/search.js";
import { lookupRecordTool } from "./tools/lookupRecord.js";
import { createFromUrlTool } from "./tools/createFromUrl.js";
import { getOpenDatabasesTool } from "./tools/getOpenDatabases.js";
import { listGroupContentTool } from "./tools/listGroupContent.js";
import { getRecordContentTool } from "./tools/getRecordContent.js";
import { renameRecordTool } from "./tools/renameRecord.js";
import { addTagsTool } from "./tools/addTags.js";
import { removeTagsTool } from "./tools/removeTags.js";
import { classifyTool } from "./tools/classify.js";
import { compareTool } from "./tools/compare.js";
import { currentDatabaseTool } from "./tools/getCurrentDatabase.js";
import { selectedRecordsTool } from "./tools/getSelectedRecords.js";
import { replicateRecordTool } from "./tools/replicateRecord.js";
import { duplicateRecordTool } from "./tools/duplicateRecord.js";
import { convertRecordTool } from "./tools/convertRecord.js";
import { updateRecordContentTool } from "./tools/updateRecordContent.js";
import { setRecordPropertiesTool } from "./tools/setRecordProperties.js";
import { askAiAboutDocumentsTool } from "./tools/ai/askAiAboutDocuments.js";
import { checkAIHealthTool } from "./tools/ai/checkAIHealth.js";
import { createSummaryDocumentTool } from "./tools/ai/createSummaryDocument.js";
import { getToolDocumentationTool } from "./tools/ai/getToolDocumentation.js";
import { DEVONTHINK_APP_NAME } from "./utils/appConfig.js";

type SecurityMode = "read_only" | "read_plus_safe_edit" | "full_access";

interface SecurityConfig {
	mode: SecurityMode;
	allowedDatabaseUuid?: string;
	enableAiTools: boolean;
	allowedWriteTools: Set<string>;
}

interface DatabaseLookupResult {
	success: boolean;
	error?: string;
	database?: {
		id: number;
		uuid: string;
		name: string;
		path: string;
		filename: string;
		encrypted: boolean;
		revisionProof?: boolean;
		auditProof?: boolean;
		readOnly: boolean;
		spotlightIndexing: boolean;
		versioning: boolean;
		comment?: string;
	};
}

interface RecordOwnershipResult {
	success: boolean;
	error?: string;
	found: boolean;
	databaseUuid?: string;
	databaseName?: string;
}

const AI_TOOL_NAMES = new Set<string>([
	"ask_ai_about_documents",
	"check_ai_health",
	"create_summary_document",
	"get_tool_documentation",
]);

const READ_ONLY_TOOL_NAMES = new Set<string>([
	"is_running",
	"current_database",
	"search",
	"get_record_by_identifier",
	"get_record_properties",
	"get_record_content",
	"list_group_content",
]);

const TOOLS_WITH_DATABASE_NAME = new Set<string>([
	"classify",
	"compare",
	"convert_record",
	"create_record",
	"create_from_url",
	"delete_record",
	"duplicate_record",
	"get_record_content",
	"get_record_properties",
	"list_group_content",
	"lookup_record",
	"move_record",
	"remove_tags",
	"rename_record",
	"replicate_record",
	"search",
	"set_record_properties",
]);

const BLOCKED_WHEN_DATABASE_LOCKED = new Set<string>(["get_open_databases", "selected_records"]);

const DEFAULT_SAFE_WRITE_TOOLS = new Set<string>(["rename_record", "add_tags", "remove_tags"]);

function guardTimestamp(): string {
	return new Date().toISOString();
}

function logGuardBlocked(toolName: string, reason: string, uuid?: string): void {
	const uuidPart = uuid ? ` | uuid: ${uuid}` : "";
	console.error(
		`[GUARD] ${guardTimestamp()} | BLOCKED | ${toolName} | reason: ${reason}${uuidPart}`,
	);
}

function logGuardAllowed(toolName: string, uuid?: string): void {
	const uuidPart = uuid ? ` | uuid: ${uuid}` : "";
	console.log(`[GUARD] ${guardTimestamp()} | ALLOWED | ${toolName}${uuidPart}`);
}

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
	if (value === undefined) {
		return defaultValue;
	}
	const normalized = value.trim().toLowerCase();
	if (
		normalized === "1" ||
		normalized === "true" ||
		normalized === "yes" ||
		normalized === "on"
	) {
		return true;
	}
	if (
		normalized === "0" ||
		normalized === "false" ||
		normalized === "no" ||
		normalized === "off"
	) {
		return false;
	}
	return defaultValue;
}

function parseMode(value: string | undefined): SecurityMode {
	const normalized = value?.trim().toLowerCase();
	if (normalized === "read_plus_safe_edit" || normalized === "full_access") {
		return normalized;
	}
	return "read_only";
}

function parseCsvToSet(value: string | undefined): Set<string> {
	if (!value) {
		return new Set<string>();
	}
	return new Set(
		value
			.split(",")
			.map((item) => item.trim())
			.filter((item) => item.length > 0),
	);
}

function asObjectArgs(input: unknown): Record<string, unknown> {
	if (input && typeof input === "object" && !Array.isArray(input)) {
		return { ...(input as Record<string, unknown>) };
	}
	return {};
}

function firstUuid(value: unknown): string | undefined {
	return collectUuids(value)[0];
}

function collectUuids(value: unknown, keyHint = ""): string[] {
	const collected: string[] = [];

	if (typeof value === "string") {
		if (keyHint.toLowerCase().includes("uuid")) {
			collected.push(value);
		}
		return collected;
	}

	if (Array.isArray(value)) {
		for (const entry of value) {
			collected.push(...collectUuids(entry, keyHint));
		}
		return collected;
	}

	if (value && typeof value === "object") {
		for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
			collected.push(...collectUuids(nestedValue, key));
		}
	}

	return collected;
}

async function lookupDatabaseByUuid(databaseUuid: string): Promise<DatabaseLookupResult> {
	const escaped = escapeStringForJXA(databaseUuid);
	const script = `
    (() => {
      const theApp = Application("${DEVONTHINK_APP_NAME}");
      theApp.includeStandardAdditions = true;

      try {
        const db = theApp.databases().find(candidate => candidate.uuid() === "${escaped}");
        if (!db) {
          return JSON.stringify({
            success: false,
            error: "Allowed database is not open: ${escaped}"
          });
        }

        const info = {};
        info["id"] = db.id();
        info["uuid"] = db.uuid();
        info["name"] = db.name();
        info["path"] = db.path();
        info["encrypted"] = db.encrypted();
        info["readOnly"] = db.readOnly();

        try { info["filename"] = db.filename(); } catch (e) {}
        try { info["spotlightIndexing"] = db.spotlightIndexing(); } catch (e) {}
        try { info["versioning"] = db.versioning(); } catch (e) {}
        try { info["revisionProof"] = db.revisionProof(); } catch (e) {}
        try { info["auditProof"] = db.auditProof(); } catch (e) {}
        try { if (db.comment && db.comment()) { info["comment"] = db.comment(); } } catch (e) {}

        return JSON.stringify({
          success: true,
          database: info
        });
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error.toString()
        });
      }
    })();
  `;

	return executeJxa<DatabaseLookupResult>(script);
}

async function lookupRecordOwnership(recordUuid: string): Promise<RecordOwnershipResult> {
	const escaped = escapeStringForJXA(recordUuid);
	const script = `
    (() => {
      const theApp = Application("${DEVONTHINK_APP_NAME}");
      theApp.includeStandardAdditions = true;

      try {
        const record = theApp.getRecordWithUuid("${escaped}");
        if (!record) {
          return JSON.stringify({
            success: true,
            found: false
          });
        }

        const db = record.database();
        return JSON.stringify({
          success: true,
          found: true,
          databaseUuid: db ? db.uuid() : null,
          databaseName: db ? db.name() : null
        });
      } catch (error) {
        return JSON.stringify({
          success: true,
          found: false
        });
      }
    })();
  `;

	return executeJxa<RecordOwnershipResult>(script);
}

function isToolEnabled(toolName: string, config: SecurityConfig): boolean {
	if (!config.enableAiTools && AI_TOOL_NAMES.has(toolName)) {
		return false;
	}

	if (config.allowedDatabaseUuid && BLOCKED_WHEN_DATABASE_LOCKED.has(toolName)) {
		return false;
	}

	switch (config.mode) {
		case "read_only":
			return READ_ONLY_TOOL_NAMES.has(toolName);
		case "read_plus_safe_edit":
			return READ_ONLY_TOOL_NAMES.has(toolName) || config.allowedWriteTools.has(toolName);
		case "full_access":
			return true;
		default:
			return false;
	}
}

async function applySecurityGuards(
	toolName: string,
	args: Record<string, unknown>,
	config: SecurityConfig,
	allowedDatabaseName: string | undefined,
): Promise<Record<string, unknown>> {
	const scopedArgs = { ...args };
	const argUuid = firstUuid(scopedArgs);

	if (!config.allowedDatabaseUuid) {
		return scopedArgs;
	}

	if (BLOCKED_WHEN_DATABASE_LOCKED.has(toolName)) {
		logGuardBlocked(toolName, "tool blocked when single-database lock is enabled", argUuid);
		throw new McpError(
			ErrorCode.InternalError,
			`Tool '${toolName}' is blocked when single-database lock is enabled.`,
		);
	}

	if (allowedDatabaseName && TOOLS_WITH_DATABASE_NAME.has(toolName)) {
		scopedArgs.databaseName = allowedDatabaseName;
	}

	const candidateUuids = Array.from(
		new Set(collectUuids(scopedArgs).filter((value) => value && value.length > 0)),
	);

	for (const uuid of candidateUuids) {
		const ownership = await lookupRecordOwnership(uuid);
		if (!ownership.success || !ownership.found) {
			continue;
		}
		if (ownership.databaseUuid !== config.allowedDatabaseUuid) {
			const reason = `record belongs to database '${ownership.databaseName || "unknown"}', allowed is '${allowedDatabaseName || config.allowedDatabaseUuid}'`;
			logGuardBlocked(toolName, reason, uuid);
			throw new McpError(
				ErrorCode.InternalError,
				`Record UUID '${uuid}' belongs to database '${ownership.databaseName || "unknown"}', which is outside the allowed test database.`,
			);
		}
	}

	return scopedArgs;
}

export const createServer = async () => {
	const securityMode = parseMode(process.env.DEVONTHINK_MODE);
	const configuredWriteTools = parseCsvToSet(process.env.DEVONTHINK_ALLOWED_WRITE_TOOLS);
	const allowedWriteTools =
		configuredWriteTools.size > 0 ? configuredWriteTools : new Set(DEFAULT_SAFE_WRITE_TOOLS);
	const securityConfig: SecurityConfig = {
		mode: securityMode,
		allowedDatabaseUuid: process.env.DEVONTHINK_ALLOWED_DATABASE_UUID?.trim() || undefined,
		enableAiTools: parseBooleanEnv(process.env.DEVONTHINK_ENABLE_AI_TOOLS, false),
		allowedWriteTools,
	};

	let allowedDatabaseName: string | undefined;
	let allowedDatabaseInfo: DatabaseLookupResult["database"];

	if (securityConfig.allowedDatabaseUuid) {
		const lookup = await lookupDatabaseByUuid(securityConfig.allowedDatabaseUuid);
		if (!lookup.success || !lookup.database) {
			logGuardBlocked(
				"server_startup",
				lookup.error ||
					`allowed database UUID '${securityConfig.allowedDatabaseUuid}' is not open`,
			);
			throw new Error(
				lookup.error ||
					`Allowed database UUID '${securityConfig.allowedDatabaseUuid}' is not available.`,
			);
		}
		allowedDatabaseName = lookup.database.name;
		allowedDatabaseInfo = lookup.database;
	}

	console.error(
		`[security] mode=${securityConfig.mode} single_db_lock=${securityConfig.allowedDatabaseUuid ? "on" : "off"} ai_tools=${securityConfig.enableAiTools ? "on" : "off"}`,
	);

	const server = new Server(
		{
			name: "devonthink-mcp",
			version: "0.1.0",
		},
		{
			capabilities: {
				tools: {},
				resources: {},
				prompts: {},
			},
		},
	);

	const tools: Tool[] = [
		isRunningTool,
		createRecordTool,
		deleteRecordTool,
		moveRecordTool,
		getRecordPropertiesTool,
		getRecordByIdentifierTool,
		searchTool,
		lookupRecordTool,
		createFromUrlTool,
		getOpenDatabasesTool,
		currentDatabaseTool,
		selectedRecordsTool,
		listGroupContentTool,
		getRecordContentTool,
		renameRecordTool,
		addTagsTool,
		removeTagsTool,
		classifyTool,
		compareTool,
		replicateRecordTool,
		duplicateRecordTool,
		convertRecordTool,
		updateRecordContentTool,
		setRecordPropertiesTool,
		askAiAboutDocumentsTool,
		checkAIHealthTool,
		createSummaryDocumentTool,
		getToolDocumentationTool,
	];

	const exposedTools = tools.filter((tool) => isToolEnabled(tool.name, securityConfig));

	server.setRequestHandler(ListToolsRequestSchema, async () => {
		return { tools: exposedTools };
	});

	server.setRequestHandler(ListResourcesRequestSchema, async () => {
		return { resources: [] };
	});

	server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
		return { resources: [] };
	});

	server.setRequestHandler(ListPromptsRequestSchema, async () => {
		return { prompts: [] };
	});

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args = {} } = request.params;
		const rawArgs = asObjectArgs(args);
		const requestedUuid = firstUuid(rawArgs);

		const tool = tools.find((t) => t.name === name);

		if (!tool) {
			throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
		}

		if (!isToolEnabled(name, securityConfig)) {
			logGuardBlocked(name, "tool not in allowed list", requestedUuid);
			throw new McpError(
				ErrorCode.InvalidRequest,
				`Tool '${name}' is disabled by security policy (mode: ${securityConfig.mode}).`,
			);
		}

		if (typeof tool.run !== "function") {
			throw new McpError(ErrorCode.InternalError, `Tool '${name}' has no run function.`);
		}

		try {
			if (
				name === "current_database" &&
				securityConfig.allowedDatabaseUuid &&
				allowedDatabaseInfo
			) {
				const forcedCurrentDatabaseResult = {
					success: true,
					database: allowedDatabaseInfo,
				};
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(forcedCurrentDatabaseResult, null, 2),
						},
					],
				};
			}

			const scopedArgs = await applySecurityGuards(
				name,
				rawArgs,
				securityConfig,
				allowedDatabaseName,
			);

			const result = await tool.run(scopedArgs);
			if (
				securityConfig.mode === "read_plus_safe_edit" &&
				securityConfig.allowedWriteTools.has(name)
			) {
				logGuardAllowed(name, firstUuid(scopedArgs) || firstUuid(result));
			}
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(result, null, 2),
					},
				],
			};
		} catch (error) {
			throw error instanceof McpError
				? error
				: new McpError(
						ErrorCode.InternalError,
						error instanceof Error ? error.message : String(error),
					);
		}
	});

	return { server, cleanup: async () => {} };
};
