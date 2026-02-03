import fs from "node:fs";
import path from "node:path";
import * as toml from "@iarna/toml";
import { getPaths } from "./paths.js";

export interface ProjectMapping {
  id?: string;
  name?: string;
  root?: string;
  match?: {
    instanceId?: string;
    pathPrefix?: string;
  };
}

export interface ThinktaxConfig {
  ui?: {
    timezone?: string;
    includeUnknown?: boolean;
  };
  claude?: {
    projectsDir?: string;
  };
  codex?: {
    home?: string;
  };
  cursor?: {
    dashboard?: {
      /** Session token in format "user_id::jwt" (from WorkosCursorSessionToken cookie) */
      sessionToken?: string;
      /** Team ID for usage queries */
      teamId?: number;
      /** Number of days to look back for usage (default: 30) */
      lookbackDays?: number;
      /** Cache TTL in minutes (default: 15) */
      cacheTtlMinutes?: number;
    };
    team?: {
      apiKey?: string;
      spendUrl?: string;
      apiBase?: string;
      spendPath?: string;
      endpoint?: string;
      method?: "GET" | "POST";
      lookbackDays?: number;
      body?: string;
      email?: string;
      token?: string;
      basicAuth?: string;
      etagTtlMinutes?: number;
    };
    local?: {
      stateVscdbPath?: string;
      estimateTranscripts?: boolean;
      transcriptsDir?: string;
      estimateModel?: string;
    };
  };
  anthropic?: {
    adminKey?: string;
    usageApiBase?: string;
  };
  openai?: {
    adminKey?: string;
    usageApiBase?: string;
  };
  projects?: {
    mappings?: ProjectMapping[];
  };
}

export interface LoadedConfig {
  path: string;
  exists: boolean;
  config: ThinktaxConfig;
}

export function interpolateEnv(input: string): string {
  const replaceBraced = input.replace(/\$\{([A-Z0-9_]+)\}/gi, (match, key) => {
    const value = process.env[key];
    return value === undefined ? match : value;
  });

  return replaceBraced.replace(/\$([A-Z0-9_]+)/gi, (match, key) => {
    const value = process.env[key];
    return value === undefined ? match : value;
  });
}

export function loadConfig(customPath?: string): LoadedConfig {
  const paths = getPaths();
  const configPath = customPath ?? paths.configFile;

  if (!fs.existsSync(configPath)) {
    return { path: configPath, exists: false, config: {} };
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const interpolated = interpolateEnv(raw);
  const parsed = toml.parse(interpolated) as ThinktaxConfig;

  return { path: configPath, exists: true, config: parsed };
}

export function resolveTimezone(config: ThinktaxConfig): string {
  if (config.ui?.timezone) return config.ui.timezone;
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}

export function resolveCursorTeamUrl(config: ThinktaxConfig): string | null {
  const team = config.cursor?.team;
  if (!team) return null;
  if (team.spendUrl) return team.spendUrl;
  const base = team.apiBase ?? "https://api.cursor.com";
  if (team.endpoint) {
    if (team.endpoint.startsWith("http")) return team.endpoint;
    return new URL(team.endpoint, base).toString();
  }
  const path = team.spendPath ?? "/teams/spend";
  return new URL(path, base).toString();
}

export function resolveClaudeProjectsDir(config: ThinktaxConfig): string {
  if (config.claude?.projectsDir) return config.claude.projectsDir;
  return path.join(process.env.HOME ?? "", ".claude", "projects");
}

export function resolveCodexHome(config: ThinktaxConfig): string {
  if (config.codex?.home) return config.codex.home;
  if (process.env.CODEX_HOME) return process.env.CODEX_HOME;
  return path.join(process.env.HOME ?? "", ".codex");
}
