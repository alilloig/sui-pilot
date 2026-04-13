/**
 * Version compatibility checking for Move LSP MCP server
 * Compares plugin VERSION.json against server package version
 */

import { readFileSync, existsSync } from 'fs';
import { log } from './logger.js';

/**
 * VERSION.json schema
 */
export interface VersionJson {
  pluginVersion: string;
  suiPilotRevision: string;
  syncTimestamp: string;
}

/**
 * Compatibility check result
 */
export interface CompatibilityResult {
  compatible: boolean;
  warning?: string;
}

/**
 * Get the server's package version
 */
function getServerVersion(): string {
  // The version is baked into the server at build time
  return '0.1.0';
}

/**
 * Check version compatibility between VERSION.json and server
 * @param versionJsonPath Path to the VERSION.json file
 * @returns Compatibility result with optional warning
 */
export function checkVersionCompatibility(versionJsonPath: string): CompatibilityResult {
  if (!existsSync(versionJsonPath)) {
    const warning = `VERSION.json not found at ${versionJsonPath}`;
    log('warn', warning, { event: 'version_incompatibility', reason: 'file_not_found' });
    return { compatible: false, warning };
  }

  try {
    const content = readFileSync(versionJsonPath, 'utf8');
    const versionJson: VersionJson = JSON.parse(content);

    const serverVersion = getServerVersion();
    const pluginVersion = versionJson.pluginVersion;

    if (pluginVersion !== serverVersion) {
      const warning = `Plugin version mismatch: VERSION.json specifies ${pluginVersion} but server is ${serverVersion}`;
      log('warn', warning, {
        event: 'version_incompatibility',
        pluginVersion,
        serverVersion,
        suiPilotRevision: versionJson.suiPilotRevision,
      });
      return { compatible: false, warning };
    }

    return { compatible: true };
  } catch (error) {
    const warning = `Failed to parse VERSION.json: ${error}`;
    log('warn', warning, { event: 'version_incompatibility', reason: 'parse_error', error });
    return { compatible: false, warning };
  }
}
