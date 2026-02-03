import path from "node:path";
import fg from "fast-glob";
import { DateTime } from "luxon";
import { ThinktaxConfig, resolveCodexHome } from "../core/config.js";
import {
  UsageEvent,
  emptyCost,
  createEventId,
} from "../core/events.js";
import { readJsonl } from "../core/events.js";
import { findGitRoot, resolveProjectFromMapping } from "../core/projects.js";
import { debug } from "../core/logger.js";

interface UsageSnapshot {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
  reasoning_output_tokens?: number;
}

function normalizeUsage(entry: any): {
  delta: UsageSnapshot;
  total?: UsageSnapshot;
} | null {
  const payload = entry?.payload;
  if (payload?.type === "token_count") {
    const info = payload.info ?? {};
    const last = info.last_token_usage as TokenUsage | undefined;
    const total = info.total_token_usage as TokenUsage | undefined;

    const delta: UsageSnapshot = {
      input: last?.input_tokens ?? 0,
      output:
        (last?.output_tokens ?? 0) + (last?.reasoning_output_tokens ?? 0),
      cacheWrite: 0,
      cacheRead: last?.cached_input_tokens ?? 0,
    };

    const totalSnapshot: UsageSnapshot | undefined = total
      ? {
          input: total.input_tokens ?? 0,
          output:
            (total.output_tokens ?? 0) + (total.reasoning_output_tokens ?? 0),
          cacheWrite: 0,
          cacheRead: total.cached_input_tokens ?? 0,
        }
      : undefined;

    if (
      delta.input === 0 &&
      delta.output === 0 &&
      delta.cacheWrite === 0 &&
      delta.cacheRead === 0 &&
      !totalSnapshot
    ) {
      return null;
    }

    return { delta, total: totalSnapshot };
  }

  const usage = entry?.usage ?? entry?.tokens ?? entry?.data?.usage;
  if (!usage) return null;

  const input =
    usage.input_tokens ??
    usage.prompt_tokens ??
    usage.input ??
    usage.in ??
    usage.inputTokens ??
    0;
  const output =
    usage.output_tokens ??
    usage.completion_tokens ??
    usage.output ??
    usage.out ??
    usage.outputTokens ??
    0;
  const cacheWrite = usage.cache_write ?? usage.cacheWrite ?? 0;
  const cacheRead = usage.cache_read ?? usage.cacheRead ?? 0;

  if (input === 0 && output === 0 && cacheWrite === 0 && cacheRead === 0) {
    return null;
  }

  return {
    delta: { input, output, cacheWrite, cacheRead },
    total: { input, output, cacheWrite, cacheRead },
  };
}

function extractTimestamp(entry: any): string {
  const raw = entry?.timestamp ?? entry?.ts ?? entry?.created_at ?? entry?.createdAt;
  if (raw) {
    const dt = DateTime.fromISO(raw);
    if (dt.isValid) return dt.toISO() ?? new Date().toISOString();
  }
  return new Date().toISOString();
}

function extractModel(entry: any): string | null {
  return entry?.model ?? entry?.response?.model ?? entry?.data?.model ?? null;
}

export async function collectCodex(
  config: ThinktaxConfig
): Promise<UsageEvent[]> {
  const codexHome = resolveCodexHome(config);
  const sessionsDir = path.join(codexHome, "sessions");
  debug("Codex: scanning", sessionsDir);

  const pattern = path.join(sessionsDir, "**/*.jsonl").replace(/\\/g, "/");
  const files = await fg(pattern, { onlyFiles: true, dot: true });
  debug("Codex: found", files.length, "session files");

  const events: UsageEvent[] = [];

  for (const filePath of files) {
    const entries = await readJsonl<any>(filePath);
    let lastTotalUsage: UsageSnapshot | null = null;
    let lastProjectRoot: string | null = null;
    let instanceId: string | null = null;
    let lastModel: string | null = null;

    for (const entry of entries) {
      const payload = entry?.payload;
      if (!instanceId) {
        instanceId =
          entry?.session_id ??
          payload?.id ??
          payload?.session_id ??
          instanceId;
        if (instanceId) instanceId = String(instanceId);
      }

      const cwd = entry?.cwd ?? payload?.cwd;
      if (cwd) {
        const root = findGitRoot(cwd) ?? cwd;
        lastProjectRoot = root;
      }

      if (entry?.type === "turn_context" && payload?.model) {
        lastModel = String(payload.model);
      }

      const usage = normalizeUsage(entry);
      if (!usage) continue;

      let delta = usage.delta;
      if (usage.total && lastTotalUsage) {
        const total = usage.total;
        if (
          total.input === lastTotalUsage.input &&
          total.output === lastTotalUsage.output &&
          total.cacheWrite === lastTotalUsage.cacheWrite &&
          total.cacheRead === lastTotalUsage.cacheRead
        ) {
          continue;
        }
      }
      if (usage.total) {
        if (lastTotalUsage) {
          delta = {
            input: Math.max(usage.total.input - lastTotalUsage.input, 0),
            output: Math.max(usage.total.output - lastTotalUsage.output, 0),
            cacheWrite: Math.max(
              usage.total.cacheWrite - lastTotalUsage.cacheWrite,
              0
            ),
            cacheRead: Math.max(
              usage.total.cacheRead - lastTotalUsage.cacheRead,
              0
            ),
          };
        }
        lastTotalUsage = usage.total;
      }

      if (
        delta.input === 0 &&
        delta.output === 0 &&
        delta.cacheWrite === 0 &&
        delta.cacheRead === 0
      ) {
        continue;
      }

      const ts = extractTimestamp(entry);
      const model = extractModel(entry) ?? lastModel;
      const project = resolveProjectFromMapping(
        config,
        instanceId,
        lastProjectRoot
      );

      const event: UsageEvent = {
        id: createEventId({
          source: "codex_cli",
          ts,
          model,
          tokens: delta,
          session: instanceId,
        }),
        ts,
        source: "codex_cli",
        provider: "openai",
        model,
        tokens: {
          in: delta.input,
          out: delta.output,
          cache_write: delta.cacheWrite,
          cache_read: delta.cacheRead,
        },
        cost: emptyCost(),
        project,
        meta: {
          file: filePath,
          session: instanceId,
        },
      };

      events.push(event);
    }
  }

  return events;
}
