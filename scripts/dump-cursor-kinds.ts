#!/usr/bin/env npx tsx
/**
 * Dump distinct `kind` (and model) values from Cursor's Dashboard API.
 * Run: npx tsx scripts/dump-cursor-kinds.ts
 */

import { execSync } from "node:child_process";
import fs from "node:fs";

const DB_PATH =
  process.platform === "darwin"
    ? `${process.env.HOME}/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
    : `${process.env.HOME}/.config/Cursor/User/globalStorage/state.vscdb`;

const DASHBOARD_API =
  "https://cursor.com/api/dashboard/get-filtered-usage-events";

async function main() {
  // ── 1. Extract auth from state.vscdb ──────────────────────────────────
  if (!fs.existsSync(DB_PATH)) {
    console.error("state.vscdb not found at", DB_PATH);
    process.exit(1);
  }

  const accessToken = execSync(
    `sqlite3 "${DB_PATH}" "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'"`,
    { encoding: "utf8", timeout: 5000 }
  ).trim();

  if (!accessToken) {
    console.error("No access token found in state.vscdb");
    process.exit(1);
  }

  const payloadB64 = accessToken.split(".")[1];
  const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString());
  const userId = payload.sub?.replace("auth0|", "");
  const sessionToken = `${userId}::${accessToken}`;

  // ── 2. Fetch team ID ──────────────────────────────────────────────────
  const profileRes = await fetch(
    "https://api2.cursor.sh/auth/full_stripe_profile",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!profileRes.ok) {
    console.error("Profile API failed:", profileRes.status);
    process.exit(1);
  }
  const profile = (await profileRes.json()) as { teamId?: number };
  const teamId = profile.teamId;
  if (!teamId) {
    console.error("No teamId in profile response");
    process.exit(1);
  }

  console.log(`Team ID: ${teamId}\n`);

  // ── 3. Fetch dashboard events (last 30 days, paginated) ──────────────
  const endDate = Date.now();
  const startDate = endDate - 30 * 24 * 60 * 60 * 1000;
  const pageSize = 500;

  interface DashboardEvent {
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
    owningUser?: string;
    [key: string]: unknown;
  }

  const allEvents: DashboardEvent[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(DASHBOARD_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://cursor.com",
        Referer: "https://cursor.com/dashboard?tab=usage",
        Cookie: `WorkosCursorSessionToken=${encodeURIComponent(sessionToken)}; team_id=${teamId}`,
      },
      body: JSON.stringify({
        teamId,
        startDate: String(startDate),
        endDate: String(endDate),
        page,
        pageSize,
      }),
    });

    if (!res.ok) {
      console.error("Dashboard API error:", res.status, await res.text());
      break;
    }

    const data = (await res.json()) as {
      totalUsageEventsCount: number;
      usageEventsDisplay: DashboardEvent[];
    };
    const events = data.usageEventsDisplay ?? [];
    allEvents.push(...events);

    console.log(
      `Page ${page}: ${events.length} events (${allEvents.length}/${data.totalUsageEventsCount} total)`
    );

    if (events.length < pageSize || allEvents.length >= data.totalUsageEventsCount) break;
    if (++page > 100) break;
  }

  console.log(`\nFetched ${allEvents.length} events total\n`);

  // ── 4. Aggregate by kind ──────────────────────────────────────────────
  const byKind = new Map<string, { count: number; models: Map<string, number>; extraKeys: Set<string> }>();

  for (const ev of allEvents) {
    const kind = ev.kind ?? "(null)";
    let entry = byKind.get(kind);
    if (!entry) {
      entry = { count: 0, models: new Map(), extraKeys: new Set() };
      byKind.set(kind, entry);
    }
    entry.count++;
    const model = ev.model ?? "(null)";
    entry.models.set(model, (entry.models.get(model) ?? 0) + 1);

    // Capture any non-standard keys for inspection
    for (const key of Object.keys(ev)) {
      if (!["timestamp", "model", "kind", "tokenUsage", "requestsCosts", "usageBasedCosts", "owningUser", "owningTeam"].includes(key)) {
        entry.extraKeys.add(key);
      }
    }
  }

  // ── 5. Print results ─────────────────────────────────────────────────
  const sorted = [...byKind.entries()].sort((a, b) => b[1].count - a[1].count);

  console.log("═══ Distinct `kind` values ═══\n");
  for (const [kind, { count, models, extraKeys }] of sorted) {
    console.log(`  ${kind}  (${count} events)`);
    const sortedModels = [...models.entries()].sort((a, b) => b[1] - a[1]);
    for (const [model, n] of sortedModels) {
      console.log(`    ├─ model: ${model}  (${n})`);
    }
    if (extraKeys.size > 0) {
      console.log(`    └─ extra keys: ${[...extraKeys].join(", ")}`);
    }
    console.log();
  }

  // ── 6. Print one sample event per kind for full schema inspection ────
  console.log("═══ Sample event per kind ═══\n");
  const seen = new Set<string>();
  for (const ev of allEvents) {
    const kind = ev.kind ?? "(null)";
    if (seen.has(kind)) continue;
    seen.add(kind);
    console.log(`── ${kind} ──`);
    console.log(JSON.stringify(ev, null, 2));
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
