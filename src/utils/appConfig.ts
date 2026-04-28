/**
 * Application configuration for DEVONthink MCP Server.
 * Reads the target DEVONthink application name from environment variables.
 *
 * DEVONthink 3 uses: "DEVONthink 3"
 * DEVONthink 4 uses: "DEVONthink"
 *
 * Set DEVONTHINK_APP_NAME env var to override. Defaults to "DEVONthink 3".
 */
export const DEVONTHINK_APP_NAME: string =
	process.env.DEVONTHINK_APP_NAME?.trim() || "DEVONthink 3";
