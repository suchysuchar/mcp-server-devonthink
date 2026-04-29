/**
 * Application configuration for DEVONthink MCP Server.
 * Reads the target DEVONthink application name from environment variables.
 *
 * The installed app bundle name can differ from the product version.
 * On this machine, /Applications/DEVONthink 2.app is the newer DEVONthink
 * app used for the MCP integration, while DEVONthink 3.app is the older one.
 *
 * Set DEVONTHINK_APP_NAME env var to override. It may be either an application
 * name or an app bundle path. Defaults to "DEVONthink 3" for upstream
 * compatibility.
 */
export const DEVONTHINK_APP_NAME: string =
	process.env.DEVONTHINK_APP_NAME?.trim() || "DEVONthink 3";
