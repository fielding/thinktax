import { DateTime } from "luxon";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import fg from "fast-glob";
import { execSync } from "node:child_process";
import {
  ThinktaxConfig,
  resolveCursorTeamUrl,
} from "../core/config.js";
import {
  UsageEvent,
  UsageProject,
  emptyCost,
  emptyProject,
  createEventId,
} from "../core/events.js";
import { readEtagState, writeEtagState } from "../core/state.js";
import { debug, warn } from "../core/logger.js";

const CURSOR_DASHBOARD_API = "https://cursor.com/api/dashboard/get-filtered-usage-events";

// ─────────────────────────────────────────────────────────────────────────────
// Workspace Activity Tracking for Project Attribution
// ─────────────────────────────────────────────────────────────────────────────

interface WorkspaceActivity {
  folder: string;
  timestamps: number[]; // Unix ms timestamps of activity
}

interface WorkspaceActivityMap {
  workspaces: Map<string, WorkspaceActivity>; // workspaceId → activity
}

function getCursorWorkspaceStoragePath(): string | null {
  const home = process.env.HOME;
  if (!home) return null;

  if (process.platform === "darwin") {
    return path.join(home, "Library/Application Support/Cursor/User/workspaceStorage");
  } else if (process.platform === "linux") {
    return path.join(home, ".config/Cursor/User/workspaceStorage");
  }
  return null;
}

export function buildWorkspaceActivityMap(): WorkspaceActivityMap {
  const map: WorkspaceActivityMap = { workspaces: new Map() };
  const storagePath = getCursorWorkspaceStoragePath();

  if (!storagePath || !fs.existsSync(storagePath)) {
    debug("Cursor: workspace storage path not found");
    return map;
  }

  try {
    const workspaceDirs = fs.readdirSync(storagePath);

    for (const wsId of workspaceDirs) {
      const wsPath = path.join(storagePath, wsId);
      if (!fs.statSync(wsPath).isDirectory()) continue;

      // Read workspace.json to get folder path
      const workspaceJsonPath = path.join(wsPath, "workspace.json");
      if (!fs.existsSync(workspaceJsonPath)) continue;

      let folder: string;
      try {
        const wsJson = JSON.parse(fs.readFileSync(workspaceJsonPath, "utf8"));
        const folderUri = wsJson.folder || wsJson.configuration?.folders?.[0]?.uri;
        if (!folderUri) continue;

        // Convert file:// URI to path
        folder = decodeURIComponent(folderUri.replace(/^file:\/\//, ""));
      } catch {
        continue;
      }

      // Read state.vscdb for composer activity timestamps
      const stateDbPath = path.join(wsPath, "state.vscdb");
      const timestamps: number[] = [];

      if (fs.existsSync(stateDbPath)) {
        try {
          const composerData = execSync(
            `sqlite3 "${stateDbPath}" "SELECT value FROM ItemTable WHERE key='composer.composerData'"`,
            { encoding: "utf8", timeout: 5000 }
          ).trim();

          if (composerData) {
            const data = JSON.parse(composerData);
            const composers = data.allComposers ?? [];
            for (const c of composers) {
              if (typeof c.createdAt === "number") {
                timestamps.push(c.createdAt);
              }
            }
          }
        } catch {
          // Use file modification time as fallback
          const stats = fs.statSync(stateDbPath);
          timestamps.push(stats.mtimeMs);
        }
      }

      if (timestamps.length > 0 || folder) {
        // If no timestamps, use directory modification time
        if (timestamps.length === 0) {
          const stats = fs.statSync(wsPath);
          timestamps.push(stats.mtimeMs);
        }
        map.workspaces.set(wsId, { folder, timestamps });
      }
    }

    debug("Cursor: built activity map for", map.workspaces.size, "workspaces");
  } catch (err) {
    debug("Cursor: failed to build workspace activity map:", err);
  }

  return map;
}

export function findProjectForTimestamp(
  activityMap: WorkspaceActivityMap,
  eventTimestampMs: number,
  toleranceMs: number = 30 * 60 * 1000 // 30 minutes
): UsageProject {
  let bestMatch: { folder: string; distance: number } | null = null;

  for (const [wsId, activity] of activityMap.workspaces) {
    for (const ts of activity.timestamps) {
      const distance = Math.abs(eventTimestampMs - ts);
      if (distance <= toleranceMs) {
        if (!bestMatch || distance < bestMatch.distance) {
          bestMatch = { folder: activity.folder, distance };
        }
      }
    }
  }

  if (bestMatch) {
    const projectName = path.basename(bestMatch.folder);
    const projectId = crypto.createHash("sha1").update(bestMatch.folder).digest("hex").slice(0, 12);
    return {
      id: projectId,
      name: projectName,
      root: bestMatch.folder,
    };
  }

  return emptyProject();
}

interface CursorSpendRow {
  ts: string;
  model: string | null;
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  reportedUsd: number | null;
  meta: Record<string, unknown>;
}

interface DashboardUsageEvent {
  timestamp: string;
  model: string;
  kind: string;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
    totalCents: number;
  };
  requestsCosts?: number;
  usageBasedCosts?: string;
  owningUser?: string;
  owningTeam?: string;
}

interface DashboardResponse {
  totalUsageEventsCount: number;
  usageEventsDisplay: DashboardUsageEvent[];
}

interface CursorAuth {
  sessionToken: string;
  teamId: number | null;
}

async function getAuthFromStateDb(): Promise<CursorAuth | null> {
  const dbPath = process.platform === "darwin"
    ? `${process.env.HOME}/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
    : process.platform === "linux"
    ? `${process.env.HOME}/.config/Cursor/User/globalStorage/state.vscdb`
    : null;

  if (!dbPath || !fs.existsSync(dbPath)) {
    debug("Cursor: state.vscdb not found");
    return null;
  }

  try {
    // Use sqlite3 CLI to avoid ESM/native module issues
    const accessToken = execSync(
      `sqlite3 "${dbPath}" "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'"`,
      { encoding: "utf8", timeout: 5000 }
    ).trim();

    if (!accessToken) {
      debug("Cursor: no access token in state.vscdb");
      return null;
    }

    // Extract user ID from JWT payload
    const payloadB64 = accessToken.split('.')[1];
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'));
    const userId = payload.sub?.replace('auth0|', '');

    if (!userId) {
      debug("Cursor: could not extract user ID from token");
      return null;
    }

    // Construct session token in the format the web API expects
    const sessionToken = `${userId}::${accessToken}`;

    // Try to get team ID from the profile API
    let teamId: number | null = null;
    try {
      const profileResponse = await fetch("https://api2.cursor.sh/auth/full_stripe_profile", {
        headers: { "Authorization": `Bearer ${accessToken}` }
      });
      if (profileResponse.ok) {
        const profile = await profileResponse.json() as { teamId?: number };
        teamId = profile.teamId ?? null;
      }
    } catch {
      debug("Cursor: could not fetch team ID from profile");
    }

    debug("Cursor: auto-extracted auth from state.vscdb, teamId:", teamId);
    return { sessionToken, teamId };
  } catch (err) {
    debug("Cursor: failed to read state.vscdb:", err);
    return null;
  }
}

async function fetchTeamIdFromProfile(token: string): Promise<number | null> {
  try {
    const response = await fetch("https://api2.cursor.sh/auth/full_stripe_profile", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!response.ok) return null;
    const data = await response.json() as { teamId?: number };
    return data.teamId ?? null;
  } catch {
    return null;
  }
}

async function fetchCursorDashboard(
  config: ThinktaxConfig
): Promise<{ rows: CursorSpendRow[]; skipped: boolean }> {
  const dashboard = config.cursor?.dashboard;

  // Try config first, then auto-extract from state.vscdb
  let sessionToken = dashboard?.sessionToken;
  let teamId = dashboard?.teamId;

  if (!sessionToken || !teamId) {
    debug("Cursor: trying to auto-extract auth from state.vscdb");
    const autoAuth = await getAuthFromStateDb();
    if (autoAuth) {
      sessionToken = sessionToken ?? autoAuth.sessionToken;
      teamId = teamId ?? autoAuth.teamId ?? undefined;
    }
  }

  if (!sessionToken || !teamId) {
    debug("Cursor: could not get session token or team ID");
    return { rows: [], skipped: true };
  }

  // Check cache
  const cacheKey = `cursor_dashboard_${teamId}`;
  const etagState = readEtagState();
  const entry = etagState[cacheKey];
  const ttlMinutes = dashboard?.cacheTtlMinutes ?? 15;
  const ttlMs = ttlMinutes * 60 * 1000;

  if (entry?.lastChecked) {
    const lastChecked = Date.parse(entry.lastChecked);
    if (!Number.isNaN(lastChecked) && Date.now() - lastChecked < ttlMs) {
      debug("Cursor: dashboard cache still valid, skipping API call");
      return { rows: [], skipped: true };
    }
  }

  debug("Cursor: fetching from dashboard API for team", teamId);

  const lookbackDays = dashboard?.lookbackDays ?? 30;
  const endDate = Date.now();
  const startDate = endDate - (lookbackDays * 24 * 60 * 60 * 1000);
  const pageSize = 500;

  try {
    const rows: CursorSpendRow[] = [];
    let page = 1;
    let totalEvents = 0;

    // Paginate through all events
    while (true) {
      const response = await fetch(CURSOR_DASHBOARD_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": "https://cursor.com",
          "Referer": "https://cursor.com/dashboard?tab=usage",
          "Cookie": `WorkosCursorSessionToken=${encodeURIComponent(sessionToken)}; team_id=${teamId}`,
        },
        body: JSON.stringify({
          teamId,
          startDate: String(startDate),
          endDate: String(endDate),
          page,
          pageSize,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        warn("Cursor: dashboard API error:", response.status, text);
        break;
      }

      const data = await response.json() as DashboardResponse;
      totalEvents = data.totalUsageEventsCount ?? 0;
      const events = data.usageEventsDisplay ?? [];

      debug("Cursor: dashboard page", page, "returned", events.length, "events");

      for (const event of events) {
        const ts = DateTime.fromMillis(parseInt(event.timestamp, 10)).toISO() ?? new Date().toISOString();
        const tokenUsage = event.tokenUsage;

        rows.push({
          ts,
          model: event.model,
          input: tokenUsage?.inputTokens ?? 0,
          output: tokenUsage?.outputTokens ?? 0,
          cacheWrite: tokenUsage?.cacheWriteTokens ?? 0,
          cacheRead: tokenUsage?.cacheReadTokens ?? 0,
          reportedUsd: tokenUsage?.totalCents ? tokenUsage.totalCents / 100 : null,
          meta: {
            kind: event.kind,
            owningUser: event.owningUser,
            source: "dashboard_api",
          },
        });
      }

      // Check if we got all events
      if (events.length < pageSize || rows.length >= totalEvents) {
        break;
      }

      page++;

      // Safety limit to avoid infinite loops
      if (page > 100) {
        warn("Cursor: hit pagination limit, stopping at", rows.length, "events");
        break;
      }
    }

    // Update cache timestamp
    etagState[cacheKey] = { lastChecked: new Date().toISOString() };
    writeEtagState(etagState);

    debug("Cursor: dashboard returned", rows.length, "of", totalEvents, "total events");
    return { rows, skipped: false };
  } catch (err) {
    warn("Cursor: dashboard API fetch failed:", err);
    return { rows: [], skipped: false };
  }
}

function estimateTokensFromChars(chars: number): number {
  if (chars <= 0) return 0;
  return Math.ceil(chars / 4);
}

function extractTokenField(value: any, keys: string[]): number {
  for (const key of keys) {
    if (typeof value?.[key] === "number") return value[key];
  }
  return 0;
}

function toUsd(cents: any): number | null {
  if (typeof cents !== "number") return null;
  return cents / 100;
}

function flattenCursorPayload(payload: any): any[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  const candidates = [
    payload.usage,
    payload.data,
    payload.items,
    payload.rows,
    payload.results,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [payload];
}

function parseCursorRows(payload: any): CursorSpendRow[] {
  const rows: CursorSpendRow[] = [];
  const records = flattenCursorPayload(payload);

  for (const record of records) {
    const nested = record?.byModel ?? record?.models ?? record?.breakdown;
    if (Array.isArray(nested)) {
      for (const item of nested) {
        rows.push(...parseCursorRows(item));
      }
      continue;
    }

    const tsRaw =
      record?.date ?? record?.day ?? record?.timestamp ?? record?.ts ?? record?.startTime;
    const ts = tsRaw
      ? DateTime.fromISO(String(tsRaw)).toISO() ?? new Date().toISOString()
      : new Date().toISOString();

    rows.push({
      ts,
      model: record?.model ?? record?.modelName ?? null,
      input: extractTokenField(record, [
        "inputTokens",
        "promptTokens",
        "input_tokens",
        "prompt_tokens",
      ]),
      output: extractTokenField(record, [
        "outputTokens",
        "completionTokens",
        "output_tokens",
        "completion_tokens",
      ]),
      cacheWrite: extractTokenField(record, [
        "cacheWriteTokens",
        "cache_write_tokens",
        "cacheWrite",
      ]),
      cacheRead: extractTokenField(record, [
        "cacheReadTokens",
        "cache_read_tokens",
        "cacheRead",
      ]),
      reportedUsd: toUsd(
        record?.totalCents ?? record?.costCents ?? record?.amountCents
      ),
      meta: { record },
    });
  }

  return rows;
}

async function fetchCursorSpend(
  config: ThinktaxConfig
): Promise<{ rows: CursorSpendRow[]; skipped: boolean }> {
  const url = resolveCursorTeamUrl(config);
  if (!url) {
    debug("Cursor: no Team API URL configured");
    return { rows: [], skipped: true };
  }

  debug("Cursor: checking Team API at", url);

  const etagState = readEtagState();
  const entry = etagState[url];
  const ttlMinutes = config.cursor?.team?.etagTtlMinutes ?? 15;
  const ttlMs = ttlMinutes * 60 * 1000;

  if (entry?.lastChecked) {
    const lastChecked = Date.parse(entry.lastChecked);
    if (!Number.isNaN(lastChecked) && Date.now() - lastChecked < ttlMs) {
      debug("Cursor: skipping API call, cached response still valid");
      return { rows: [], skipped: true };
    }
  }

  const headers = new Headers();
  const team = config.cursor?.team;
  const method = team?.method ?? "POST";

  if (method === "GET" && entry?.etag) {
    headers.set("If-None-Match", entry.etag);
  }

  if (team?.basicAuth) {
    headers.set("Authorization", `Basic ${team.basicAuth}`);
    debug("Cursor: using basicAuth credentials");
  } else if (team?.apiKey) {
    const encoded = Buffer.from(`${team.apiKey}:`).toString("base64");
    headers.set("Authorization", `Basic ${encoded}`);
    debug("Cursor: using apiKey credentials");
  } else if (team?.email && team?.token) {
    const encoded = Buffer.from(`${team.email}:${team.token}`).toString("base64");
    headers.set("Authorization", `Basic ${encoded}`);
    debug("Cursor: using email+token credentials");
  } else {
    debug("Cursor: no credentials configured");
  }

  let body: string | undefined;
  if (method === "POST") {
    headers.set("Content-Type", "application/json");
    if (team?.body) {
      body = team.body;
    } else if (team?.lookbackDays) {
      const end = DateTime.now().toUTC();
      const start = end.minus({ days: team.lookbackDays });
      body = JSON.stringify({
        startDate: start.toMillis(),
        endDate: end.toMillis(),
      });
    } else {
      body = "{}";
    }
  }

  debug("Cursor: fetching with method", method);
  const response = await fetch(url, { headers, method, body });
  const nowIso = new Date().toISOString();

  etagState[url] = {
    etag: response.headers.get("etag") ?? entry?.etag,
    lastChecked: nowIso,
  };
  writeEtagState(etagState);

  if (response.status === 304) {
    debug("Cursor: 304 Not Modified, data unchanged");
    return { rows: [], skipped: true };
  }

  if (!response.ok) {
    warn("Cursor: API returned", response.status, response.statusText);
    return { rows: [], skipped: true };
  }

  const payload = await response.json();
  const rows = parseCursorRows(payload);
  debug("Cursor: parsed", rows.length, "rows from API response");
  return { rows, skipped: false };
}

async function tryReadCursorLocal(
  config: ThinktaxConfig
): Promise<CursorSpendRow[]> {
  const dbPath =
    config.cursor?.local?.stateVscdbPath ??
    (process.platform === "darwin"
      ? `${process.env.HOME}/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
      : null);
  if (!dbPath || !fs.existsSync(dbPath)) return [];

  try {
    const mod = await import("better-sqlite3");
    const Database = mod.default;
    const db = new Database(dbPath, { readonly: true });
    const rows = db
      .prepare(
        "SELECT key, value FROM ItemTable WHERE key LIKE '%cursor%' OR key LIKE '%usage%'"
      )
      .all();
    db.close();

    const extracted: CursorSpendRow[] = [];
    for (const row of rows) {
      try {
        const value = JSON.parse(row.value);
        const recordRows = parseCursorRows(value);
        for (const record of recordRows) {
          extracted.push({
            ...record,
            meta: { key: row.key, source: "state.vscdb" },
          });
        }
      } catch {
        // Ignore unparsable rows.
      }
    }
    return extracted;
  } catch {
    return [];
  }
}

async function estimateCursorFromTranscripts(
  config: ThinktaxConfig
): Promise<CursorSpendRow[]> {
  const enabled = config.cursor?.local?.estimateTranscripts ?? true;
  if (!enabled) return [];

  const baseDir =
    config.cursor?.local?.transcriptsDir ??
    path.join(process.env.HOME ?? "", ".cursor", "projects");
  const pattern = path
    .join(baseDir, "**/agent-transcripts/*.json")
    .replace(/\\/g, "/");

  const files = await fg(pattern, { onlyFiles: true, dot: true });
  const rows: CursorSpendRow[] = [];
  const model = config.cursor?.local?.estimateModel ?? "cursor-local-estimate";

  for (const filePath of files) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) continue;

      let inputChars = 0;
      let outputChars = 0;
      let userCount = 0;
      let assistantCount = 0;

      for (const item of data) {
        if (item?.role === "user") {
          if (typeof item.text === "string") inputChars += item.text.length;
          userCount += 1;
        } else if (item?.role === "assistant") {
          if (typeof item.text === "string") outputChars += item.text.length;
          if (typeof item.thinking === "string")
            outputChars += item.thinking.length;
          assistantCount += 1;
        }
      }

      const inputTokens = estimateTokensFromChars(inputChars);
      const outputTokens = estimateTokensFromChars(outputChars);
      if (inputTokens === 0 && outputTokens === 0) continue;

      const stats = fs.statSync(filePath);
      const ts = stats.mtime.toISOString();

      rows.push({
        ts,
        model,
        input: inputTokens,
        output: outputTokens,
        cacheWrite: 0,
        cacheRead: 0,
        reportedUsd: null,
        meta: {
          file: filePath,
          mode: "local_transcript_estimate",
          messages: { user: userCount, assistant: assistantCount },
          chars: { input: inputChars, output: outputChars },
        },
      });
    } catch {
      // ignore unreadable transcript files
    }
  }

  return rows;
}

export async function collectCursor(
  config: ThinktaxConfig
): Promise<UsageEvent[]> {
  const events: UsageEvent[] = [];
  debug("Cursor: starting collection");

  // Build workspace activity map for project attribution
  const activityMap = buildWorkspaceActivityMap();

  // Try dashboard API first (most accurate, has actual costs)
  let fetched = await fetchCursorDashboard(config);
  let rows = fetched.rows;

  // Fall back to team API if dashboard didn't work
  if (rows.length === 0 && !fetched.skipped) {
    debug("Cursor: dashboard API returned no rows, trying team API");
    fetched = await fetchCursorSpend(config);
    rows = fetched.rows;
  }

  // Fall back to local state.vscdb
  if (rows.length === 0 && !fetched.skipped) {
    debug("Cursor: Team API returned no rows, trying local state.vscdb");
    rows = await tryReadCursorLocal(config);
  }

  // Last resort: transcript estimation
  if (rows.length === 0) {
    debug("Cursor: trying transcript estimation fallback");
    rows = await estimateCursorFromTranscripts(config);
  }

  debug("Cursor: processing", rows.length, "total rows");

  let attributed = 0;
  for (const row of rows) {
    // Try to attribute to a project based on timestamp
    const eventTimestampMs = DateTime.fromISO(row.ts).toMillis();
    const project = findProjectForTimestamp(activityMap, eventTimestampMs);
    if (project.id) attributed++;

    const event: UsageEvent = {
      id: createEventId({
        source: "cursor_ide",
        ts: row.ts,
        model: row.model,
        tokens: row,
      }),
      ts: row.ts,
      source: "cursor_ide",
      provider: "cursor",
      model: row.model,
      tokens: {
        in: row.input,
        out: row.output,
        cache_write: row.cacheWrite,
        cache_read: row.cacheRead,
      },
      cost: {
        ...emptyCost(),
        reported_usd: row.reportedUsd,
      },
      project,
      meta: row.meta,
    };

    events.push(event);
  }

  debug("Cursor: attributed", attributed, "of", rows.length, "events to projects");
  return events;
}
