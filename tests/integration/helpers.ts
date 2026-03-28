import { executeJxa } from "../../src/applescript/execute.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface TestContext {
	dbPath: string;
	dbUuid: string;
	dbName: string;
	emlPath: string;
	timestamp: string;
}

export interface TempDatabaseContext {
	dbPath: string;
	dbUuid: string;
	dbName: string;
}

const CONTEXT_FILE = path.join(os.tmpdir(), "mcp-devonthink-test-context.json");

export function getTestContext(): TestContext {
	return JSON.parse(fs.readFileSync(CONTEXT_FILE, "utf-8"));
}

export function writeTestContext(ctx: TestContext): void {
	fs.writeFileSync(CONTEXT_FILE, JSON.stringify(ctx));
}

export function cleanupContextFile(): void {
	try {
		fs.unlinkSync(CONTEXT_FILE);
	} catch (_) {}
}

export async function jxa<T>(script: string): Promise<T> {
	return executeJxa<T>(`(() => {
    const theApp = Application("DEVONthink");
    theApp.includeStandardAdditions = true;
    try {
      ${script}
    } catch (error) {
      const r = {};
      r["success"] = false;
      r["error"] = error.toString();
      return JSON.stringify(r);
    }
  })()`);
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createTestRecord(
	ctx: TestContext,
	name: string,
	type: string,
	content: string,
	parentGroupUuid?: string,
): Promise<{ uuid: string; id: number; referenceURL: string }> {
	const inClause = parentGroupUuid
		? `theApp.getRecordWithUuid("${parentGroupUuid}")`
		: `theApp.getDatabaseWithUuid("${ctx.dbUuid}").root()`;

	const result = await jxa<{
		success: boolean;
		uuid?: string;
		id?: number;
		referenceURL?: string;
		error?: string;
	}>(`
    const dest = ${inClause};
    if (!dest) throw new Error("Destination not found");
    const props = {};
    props["name"] = ${JSON.stringify(name)};
    props["type"] = ${JSON.stringify(type)};
    props["content"] = ${JSON.stringify(content)};
    const record = theApp.createRecordWith(props, { in: dest });
    const r = {};
    r["success"] = true;
    r["uuid"] = record.uuid();
    r["id"] = record.id();
    r["referenceURL"] = record.referenceURL();
    return JSON.stringify(r);
  `);

	if (!result.success || !result.uuid) {
		throw new Error(`Failed to create test record "${name}": ${result.error}`);
	}
	return {
		uuid: result.uuid,
		id: result.id!,
		referenceURL: result.referenceURL!,
	};
}

export async function createTestGroup(ctx: TestContext, name: string): Promise<{ uuid: string }> {
	const result = await jxa<{
		success: boolean;
		uuid?: string;
		error?: string;
	}>(`
    const db = theApp.getDatabaseWithUuid("${ctx.dbUuid}");
    if (!db) throw new Error("Temp database not found");
    const props = {};
    props["name"] = ${JSON.stringify(name)};
    props["type"] = "group";
    const group = theApp.createRecordWith(props, { in: db.root() });
    const r = {};
    r["success"] = true;
    r["uuid"] = group.uuid();
    return JSON.stringify(r);
  `);
	if (!result.success || !result.uuid) {
		throw new Error(`Failed to create group "${name}": ${result.error}`);
	}
	return { uuid: result.uuid };
}

export async function createTemporaryDatabase(prefix: string): Promise<TempDatabaseContext> {
	const timestamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const dbName = `${prefix}-${timestamp}`;
	const dbPath = path.join(os.tmpdir(), `${dbName}.dtBase2`);

	const result = await jxa<{
		success: boolean;
		uuid?: string;
		error?: string;
	}>(`
    const db = theApp.createDatabase(${JSON.stringify(dbPath)});
    if (!db) throw new Error("Failed to create temp database");
    const r = {};
    r["success"] = true;
    r["uuid"] = db.uuid();
    return JSON.stringify(r);
  `);

	if (!result.success || !result.uuid) {
		throw new Error(`Failed to create temp database "${dbName}": ${result.error}`);
	}

	return { dbPath, dbUuid: result.uuid, dbName };
}

export async function closeAndRemoveDatabase(db: TempDatabaseContext): Promise<void> {
	await jxa(`
    const databases = theApp.databases();
    for (let i = 0; i < databases.length; i++) {
      if (databases[i].uuid() === "${db.dbUuid}") {
        theApp.close(databases[i]);
        break;
      }
    }
    return JSON.stringify({ success: true });
  `);

	try {
		fs.rmSync(db.dbPath, { recursive: true, force: true });
	} catch (_) {}
}

export async function createRecordInDatabase(
	dbUuid: string,
	name: string,
	type: string,
	content: string,
): Promise<{ uuid: string; id: number; referenceURL: string }> {
	const result = await jxa<{
		success: boolean;
		uuid?: string;
		id?: number;
		referenceURL?: string;
		error?: string;
	}>(`
    const db = theApp.getDatabaseWithUuid("${dbUuid}");
    if (!db) throw new Error("Database not found");
    const props = {};
    props["name"] = ${JSON.stringify(name)};
    props["type"] = ${JSON.stringify(type)};
    props["content"] = ${JSON.stringify(content)};
    const record = theApp.createRecordWith(props, { in: db.root() });
    const r = {};
    r["success"] = true;
    r["uuid"] = record.uuid();
    r["id"] = record.id();
    r["referenceURL"] = record.referenceURL();
    return JSON.stringify(r);
  `);

	if (!result.success || !result.uuid || !result.referenceURL || result.id === undefined) {
		throw new Error(`Failed to create record in database "${dbUuid}": ${result.error}`);
	}

	return {
		uuid: result.uuid,
		id: result.id,
		referenceURL: result.referenceURL,
	};
}

export async function deleteRecord(uuid: string): Promise<void> {
	await jxa(`
    const record = theApp.getRecordWithUuid("${uuid}");
    if (record) theApp.delete({ record: record });
    return JSON.stringify({ success: true });
  `);
}
