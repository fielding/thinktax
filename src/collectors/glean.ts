import path from "node:path";
import fg from "fast-glob";
import {
  UsageEvent,
  UsageProvider,
  emptyCost,
  createEventId,
  readJsonl,
} from "../core/events.js";
import { resolveGleanUsageDir } from "../core/config.js";
import { debug } from "../core/logger.js";
import type { ThinktaxConfig } from "../core/config.js";

/** Map model prefixes to thinktax UsageProvider. */
function inferProvider(model: string | null): UsageProvider {
  const m = (model ?? "").toLowerCase();
  if (m.startsWith("claude")) return "anthropic";
  if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3")) return "openai";
  if (m.startsWith("moonshot")) return "moonshot";
  return "anthropic";
}

interface GleanEntry {
  timestamp: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  input_cost: number;
  output_cost: number;
  total_cost: number;
  reason: string;
  session_title?: string;
  event_count?: number;
  streams?: string[];
}

export async function collectGlean(
  config: ThinktaxConfig
): Promise<UsageEvent[]> {
  const usageDir = resolveGleanUsageDir(config);
  debug("Glean: scanning", usageDir);

  const pattern = path.join(usageDir, "**/*.jsonl").replace(/\\/g, "/");
  const files = await fg(pattern, { onlyFiles: true, dot: true });
  debug("Glean: found", files.length, "JSONL files");

  const events: UsageEvent[] = [];

  for (const filePath of files) {
    const entries = await readJsonl<GleanEntry>(filePath);
    let fileEvents = 0;

    for (const entry of entries) {
      if (!entry.timestamp) continue;

      const inTok = entry.input_tokens ?? 0;
      const outTok = entry.output_tokens ?? 0;
      if (inTok === 0 && outTok === 0) continue;

      const provider = inferProvider(entry.model);

      const event: UsageEvent = {
        id: createEventId({
          source: "glean",
          ts: entry.timestamp,
          model: entry.model,
          tokens: { in: inTok, out: outTok },
          reason: entry.reason,
        }),
        ts: entry.timestamp,
        source: "glean",
        provider,
        model: entry.model ?? null,
        tokens: {
          in: inTok,
          out: outTok,
          cache_write: 0,
          cache_read: 0,
        },
        cost: emptyCost(),
        project: {
          id: "glean",
          name: "Glean",
          root: null,
        },
        meta: {
          file: filePath,
          billing: "api",
          reason: entry.reason,
          session_title: entry.session_title ?? null,
          event_count: entry.event_count ?? null,
          streams: entry.streams ?? [],
        },
      };

      events.push(event);
      fileEvents++;
    }

    if (fileEvents > 0) {
      debug("Glean:", fileEvents, "events from", path.basename(filePath));
    }
  }

  return events;
}
