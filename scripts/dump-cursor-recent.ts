#!/usr/bin/env npx tsx
/**
 * Dump the 20 most recent Cursor Dashboard events with all fields.
 * Run: npx tsx scripts/dump-cursor-recent.ts
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
  const accessToken = execSync(
    `sqlite3 "${DB_PATH}" "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'"`,
    { encoding: "utf8", timeout: 5000 }
  ).trim();

  const payloadB64 = accessToken.split(".")[1];
  const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString());
  const userId = payload.sub?.replace("auth0|", "");
  const sessionToken = `${userId}::${accessToken}`;

  const profileRes = await fetch(
    "https://api2.cursor.sh/auth/full_stripe_profile",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const profile = (await profileRes.json()) as { teamId?: number };
  const teamId = profile.teamId!;

  // Fetch just page 1 (most recent events)
  const endDate = Date.now();
  const startDate = endDate - 30 * 24 * 60 * 60 * 1000;

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
      page: 1,
      pageSize: 20,
    }),
  });

  const data = (await res.json()) as {
    totalUsageEventsCount: number;
    usageEventsDisplay: any[];
  };

  console.log(`Total events: ${data.totalUsageEventsCount}\n`);
  console.log(`═══ 20 most recent events ═══\n`);

  for (const ev of data.usageEventsDisplay) {
    const ts = new Date(parseInt(ev.timestamp, 10)).toISOString();
    console.log(`${ts}  model=${ev.model}  kind=${ev.kind}  headless=${ev.isHeadless}  maxMode=${ev.maxMode ?? "-"}`);
    // Print all keys that aren't in the standard set
    const extras: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ev)) {
      if (!["timestamp", "model", "kind", "tokenUsage", "requestsCosts", "usageBasedCosts", "owningUser", "owningTeam", "isHeadless", "maxMode", "isTokenBasedCall", "cursorTokenFee", "isChargeable"].includes(k)) {
        extras[k] = v;
      }
    }
    if (Object.keys(extras).length > 0) {
      console.log(`  extras: ${JSON.stringify(extras)}`);
    }
    console.log();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
