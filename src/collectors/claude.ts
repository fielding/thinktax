import path from "node:path";
import fg from "fast-glob";
import { DateTime } from "luxon";
import { ThinktaxConfig, resolveClaudeProjectsDir } from "../core/config.js";
import {
  UsageEvent,
  emptyCost,
  emptyProject,
  createEventId,
} from "../core/events.js";
import { readJsonl } from "../core/events.js";
import { resolveProjectFromMapping } from "../core/projects.js";
import { debug } from "../core/logger.js";

const SKIP_TYPES = new Set([
  "summary",
  "file-history-snapshot",
  "tool-result",
  "tool-use",
]);

function extractUsage(entry: any): {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
} | null {
  const usage = entry?.message?.usage ?? entry?.usage ?? entry?.data?.usage;
  if (!usage) return null;

  const input =
    usage.input_tokens ??
    usage.inputTokens ??
    usage.prompt_tokens ??
    usage.promptTokens ??
    usage.tokens?.in ??
    0;
  const output =
    usage.output_tokens ??
    usage.outputTokens ??
    usage.completion_tokens ??
    usage.completionTokens ??
    usage.tokens?.out ??
    0;
  const cacheWrite =
    usage.cache_creation_input_tokens ??
    usage.cache_write ??
    usage.cacheWriteTokens ??
    0;
  const cacheRead =
    usage.cache_read_input_tokens ?? usage.cache_read ?? usage.cacheReadTokens ?? 0;

  if (input === 0 && output === 0 && cacheWrite === 0 && cacheRead === 0) {
    return null;
  }

  return { input, output, cacheWrite, cacheRead };
}

function extractTimestamp(entry: any): string {
  const raw =
    entry?.timestamp ??
    entry?.created_at ??
    entry?.createdAt ??
    entry?.message?.created_at ??
    entry?.message?.timestamp;
  if (raw) {
    const dt = DateTime.fromISO(raw);
    if (dt.isValid) return dt.toISO() ?? new Date().toISOString();
  }
  return new Date().toISOString();
}

function extractModel(entry: any): string | null {
  return (
    entry?.message?.model ??
    entry?.model ??
    entry?.message?.metadata?.model ??
    entry?.data?.model ??
    null
  );
}

function shouldSkip(entry: any): boolean {
  if (!entry) return true;
  if (entry.type && SKIP_TYPES.has(entry.type)) return true;
  const role = entry?.message?.role ?? entry?.role;
  if (role && role !== "assistant") return true;
  return false;
}

export async function collectClaude(
  config: ThinktaxConfig
): Promise<UsageEvent[]> {
  const projectsDir = resolveClaudeProjectsDir(config);
  debug("Claude: scanning", projectsDir);

  const pattern = path.join(projectsDir, "**/*.jsonl").replace(/\\/g, "/");
  const files = await fg(pattern, { onlyFiles: true, dot: true });
  debug("Claude: found", files.length, "JSONL files");

  const events: UsageEvent[] = [];

  for (const filePath of files) {
    const entries = await readJsonl<any>(filePath);
    const instanceId = path.basename(path.dirname(filePath));
    const project = resolveProjectFromMapping(config, instanceId, null);
    let fileEvents = 0;

    for (const entry of entries) {
      if (shouldSkip(entry)) continue;
      const usage = extractUsage(entry);
      if (!usage) continue;
      const ts = extractTimestamp(entry);
      const model = extractModel(entry);

      const event: UsageEvent = {
        id: createEventId({
          source: "claude_code",
          ts,
          model,
          tokens: usage,
          instanceId,
        }),
        ts,
        source: "claude_code",
        provider: "anthropic",
        model,
        tokens: {
          in: usage.input,
          out: usage.output,
          cache_write: usage.cacheWrite,
          cache_read: usage.cacheRead,
        },
        cost: emptyCost(),
        project: project ?? emptyProject(),
        meta: {
          file: filePath,
          type: entry?.type ?? null,
        },
      };

      events.push(event);
      fileEvents++;
    }

    if (fileEvents > 0) {
      debug("Claude:", fileEvents, "events from", path.basename(filePath));
    }
  }

  return events;
}
