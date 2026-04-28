import { execFile } from "child_process";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
export const executeJxa = <T>(script: string): Promise<T> => {
	return new Promise((resolve, reject) => {
		execFile("osascript", ["-l", "JavaScript", "-e", script], (error, stdout, stderr) => {
			if (error) {
				return reject(
					new McpError(ErrorCode.InternalError, `JXA execution failed: ${error.message}`),
				);
			}
			const trimmedStdout = stdout.trim();
			if (trimmedStdout) {
				try {
					const result = JSON.parse(trimmedStdout);
					resolve(result as T);
					return;
				} catch (parseError) {
					reject(
						new McpError(
							ErrorCode.InternalError,
							`Failed to parse JXA output: ${parseError}`,
						),
					);
					return;
				}
			}
			if (stderr.trim()) {
				return reject(new McpError(ErrorCode.InternalError, `JXA error: ${stderr}`));
			}
			reject(new McpError(ErrorCode.InternalError, "JXA returned no output."));
		});
	});
};
