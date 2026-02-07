import path from "node:path";
import os from "node:os";
import fg from "fast-glob";
import {
  UsageEvent,
  UsageProvider,
  emptyCost,
  createEventId,
  readJsonl,
} from "../core/events.js";
import { debug } from "../core/logger.js";
import type { ThinktaxConfig } from "../core/config.js";

/** Map Apprentice provider strings to thinktax UsageProvider. */
const PROVIDER_MAP: Record<string, UsageProvider> = {
  anthropic: "anthropic",
  "openai-compat": "openai",
};

interface ApprenticeEntry {
  ts: string;
  role: string;
  model: string;
  provider: string;
  tokens: {
    in: number;
    out: number;
    cache_write: number;
    cache_read: number;
  };
  latencyMs: number;
}

export async function collectApprentice(
  _config: ThinktaxConfig
): Promise<UsageEvent[]> {
  const usageDir = path.join(os.homedir(), ".apprentice", "usage");
  debug("Apprentice: scanning", usageDir);

  const pattern = path.join(usageDir, "**/*.jsonl").replace(/\\/g, "/");
  const files = await fg(pattern, { onlyFiles: true, dot: true });
  debug("Apprentice: found", files.length, "JSONL files");

  const events: UsageEvent[] = [];

  for (const filePath of files) {
    const entries = await readJsonl<ApprenticeEntry>(filePath);
    let fileEvents = 0;

    for (const entry of entries) {
      if (!entry.ts || !entry.tokens) continue;

      const tokens = entry.tokens;
      if (
        tokens.in === 0 &&
        tokens.out === 0 &&
        tokens.cache_write === 0 &&
        tokens.cache_read === 0
      ) {
        continue;
      }

      const provider: UsageProvider =
        PROVIDER_MAP[entry.provider] ?? "openai";

      const event: UsageEvent = {
        id: createEventId({
          source: "apprentice",
          ts: entry.ts,
          model: entry.model,
          tokens,
          role: entry.role,
        }),
        ts: entry.ts,
        source: "apprentice",
        provider,
        model: entry.model ?? null,
        tokens: {
          in: tokens.in,
          out: tokens.out,
          cache_write: tokens.cache_write,
          cache_read: tokens.cache_read,
        },
        cost: emptyCost(),
        project: {
          id: "apprentice",
          name: "Apprentice",
          root: null,
        },
        meta: {
          role: entry.role,
          billing: "api",
          latencyMs: entry.latencyMs,
        },
      };

      events.push(event);
      fileEvents++;
    }

    if (fileEvents > 0) {
      debug(
        "Apprentice:",
        fileEvents,
        "events from",
        path.basename(filePath)
      );
    }
  }

  return events;
}
