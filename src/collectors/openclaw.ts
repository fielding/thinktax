import path from "node:path";
import fg from "fast-glob";
import { DateTime } from "luxon";
import { ThinktaxConfig, resolveOpenClawSessionsDir } from "../core/config.js";
import {
  UsageEvent,
  UsageProvider,
  emptyCost,
  createEventId,
  readJsonl,
} from "../core/events.js";
import { debug } from "../core/logger.js";

/** Map OpenClaw provider strings to thinktax UsageProvider. */
const PROVIDER_MAP: Record<string, UsageProvider> = {
  "kimi-coding": "moonshot",
};

function extractUsage(entry: any): {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
} | null {
  const usage = entry?.message?.usage;
  if (!usage) return null;

  const input = usage.input ?? 0;
  const output = usage.output ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const cacheRead = usage.cacheRead ?? 0;

  if (input === 0 && output === 0 && cacheWrite === 0 && cacheRead === 0) {
    return null;
  }

  return { input, output, cacheWrite, cacheRead };
}

function extractTimestamp(entry: any): string {
  // Prefer ISO timestamp on the entry itself
  if (entry?.timestamp) {
    const dt = DateTime.fromISO(entry.timestamp);
    if (dt.isValid) return dt.toISO() ?? new Date().toISOString();
  }
  // Fall back to epoch ms on the message
  const ms = entry?.message?.timestamp;
  if (typeof ms === "number") {
    const dt = DateTime.fromMillis(ms);
    if (dt.isValid) return dt.toISO() ?? new Date().toISOString();
  }
  return new Date().toISOString();
}

export async function collectOpenClaw(
  config: ThinktaxConfig
): Promise<UsageEvent[]> {
  const sessionsDir = resolveOpenClawSessionsDir(config);
  const billing = config.openclaw?.billing?.defaultMode ?? "estimate";
  debug("OpenClaw: scanning", sessionsDir, "billing:", billing);

  const pattern = path.join(sessionsDir, "**/*.jsonl").replace(/\\/g, "/");
  const files = await fg(pattern, { onlyFiles: true, dot: true });
  debug("OpenClaw: found", files.length, "JSONL files");

  const events: UsageEvent[] = [];

  for (const filePath of files) {
    const entries = await readJsonl<any>(filePath);
    const sessionId = path.basename(filePath, ".jsonl");
    let fileEvents = 0;

    for (const entry of entries) {
      // Only process assistant messages with usage
      if (entry?.type !== "message") continue;
      if (entry?.message?.role !== "assistant") continue;

      const usage = extractUsage(entry);
      if (!usage) continue;

      const ts = extractTimestamp(entry);
      const model = entry?.message?.model ?? null;
      const rawProvider = entry?.message?.provider ?? "unknown";
      const provider: UsageProvider = PROVIDER_MAP[rawProvider] ?? "moonshot";

      const event: UsageEvent = {
        id: createEventId({
          source: "openclaw",
          ts,
          model,
          tokens: usage,
          sessionId,
        }),
        ts,
        source: "openclaw",
        provider,
        model,
        tokens: {
          in: usage.input,
          out: usage.output,
          cache_write: usage.cacheWrite,
          cache_read: usage.cacheRead,
        },
        cost: emptyCost(),
        project: {
          id: "openclaw",
          name: "OpenClaw",
          root: null,
        },
        meta: {
          file: filePath,
          sessionId,
          openclawProvider: rawProvider,
          billing,
        },
      };

      events.push(event);
      fileEvents++;
    }

    if (fileEvents > 0) {
      debug("OpenClaw:", fileEvents, "events from", path.basename(filePath));
    }
  }

  return events;
}
