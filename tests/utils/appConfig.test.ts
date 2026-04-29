import { afterEach, describe, expect, it, vi } from "vitest";

const originalAppName = process.env.DEVONTHINK_APP_NAME;

afterEach(() => {
	vi.resetModules();
	if (originalAppName === undefined) {
		delete process.env.DEVONTHINK_APP_NAME;
	} else {
		process.env.DEVONTHINK_APP_NAME = originalAppName;
	}
});

async function loadAppName(value: string | undefined): Promise<string> {
	vi.resetModules();
	if (value === undefined) {
		delete process.env.DEVONTHINK_APP_NAME;
	} else {
		process.env.DEVONTHINK_APP_NAME = value;
	}

	const module = await import("../../src/utils/appConfig");
	return module.DEVONTHINK_APP_NAME;
}

describe("DEVONTHINK_APP_NAME", () => {
	it("defaults to DEVONthink 3", async () => {
		await expect(loadAppName(undefined)).resolves.toBe("DEVONthink 3");
	});

	it("uses explicit application names unchanged", async () => {
		await expect(loadAppName("DEVONthink 2")).resolves.toBe("DEVONthink 2");
	});

	it("keeps app bundle paths unchanged", async () => {
		await expect(loadAppName("/Applications/DEVONthink 2.app")).resolves.toBe(
			"/Applications/DEVONthink 2.app",
		);
	});
});
