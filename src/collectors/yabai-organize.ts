import path from "node:path";
import {
  UsageEvent,
  UsageProvider,
  emptyCost,
  createEventId,
  readJsonl,
} from "../core/events.js";
import { debug } from "../core/logger.js";
import { resolveYabaiOrganizeUsageDir } from "../core/config.js";
import type { ThinktaxConfig } from "../core/config.js";

interface YabaiOrganizeEntry {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  ts: string;
  tool: string;
}

function inferProvider(model: string): UsageProvider {
  const m = model.toLowerCase();
  if (m.startsWith("claude")) return "anthropic";
  if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3"))
    return "openai";
  if (m.startsWith("moonshot")) return "moonshot";
  return "anthropic";
}

export async function collectYabaiOrganize(
  config: ThinktaxConfig
): Promise<UsageEvent[]> {
  const usageDir = resolveYabaiOrganizeUsageDir(config);
  const filePath = path.join(usageDir, "usage.jsonl");
  debug("YabaiOrganize: reading", filePath);

  const entries = await readJsonl<YabaiOrganizeEntry>(filePath);
  debug("YabaiOrganize:", entries.length, "entries");

  const events: UsageEvent[] = [];

  for (const entry of entries) {
    if (!entry.ts || !entry.model) continue;

    const inTok = entry.input_tokens ?? 0;
    const outTok = entry.output_tokens ?? 0;
    const cacheWrite = entry.cache_creation_input_tokens ?? 0;
    const cacheRead = entry.cache_read_input_tokens ?? 0;

    if (inTok === 0 && outTok === 0 && cacheWrite === 0 && cacheRead === 0) {
      continue;
    }

    const event: UsageEvent = {
      id: createEventId({
        source: "yabai_organize",
        ts: entry.ts,
        model: entry.model,
        tokens: {
          in: inTok,
          out: outTok,
          cache_write: cacheWrite,
          cache_read: cacheRead,
        },
      }),
      ts: entry.ts,
      source: "yabai_organize",
      provider: inferProvider(entry.model),
      model: entry.model,
      tokens: {
        in: inTok,
        out: outTok,
        cache_write: cacheWrite,
        cache_read: cacheRead,
      },
      cost: emptyCost(),
      project: {
        id: "yabai-organize",
        name: "Yabai Organize",
        root: null,
      },
      meta: {
        file: filePath,
        tool: entry.tool ?? "yabai-organize",
        billing: "api",
      },
    };

    events.push(event);
  }

  debug("YabaiOrganize:", events.length, "events");
  return events;
}
