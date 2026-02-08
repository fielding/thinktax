import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import {
  UsageEvent,
  createEventId,
} from "../core/events.js";
import { resolveReviewCrewHistoryDir } from "../core/config.js";
import { debug } from "../core/logger.js";
import type { ThinktaxConfig } from "../core/config.js";

interface ReviewMetadata {
  session_id?: string;
  repo?: string;
  pr_number?: number;
  pr_title?: string;
  started_at?: string;
  verdict?: string;
  claude_model?: string;
  num_reviewers?: number;
  summarized_at?: number;
  costs?: {
    summarizer?: {
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
    };
    total_usd?: number;
  };
}

/** Derive a timestamp from the session directory name (YYYY-MM-DD_HH-MM-SS). */
function tsFromSessionDir(dirName: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/.exec(dirName);
  if (!match) return null;
  return `${match[1]}T${match[2]}:${match[3]}:${match[4]}`;
}

/** Map model shortnames used in review to full model IDs. */
function resolveModel(model: string | undefined): string | null {
  if (!model) return null;
  const m = model.toLowerCase();
  if (m === "opus") return "claude-opus-4-6";
  if (m === "sonnet-4.5") return "claude-sonnet-4-5-20250929";
  return model;
}

export async function collectReviewCrew(
  config: ThinktaxConfig
): Promise<UsageEvent[]> {
  const historyDir = resolveReviewCrewHistoryDir(config);
  debug("ReviewCrew: scanning", historyDir);

  const pattern = path
    .join(historyDir, "**/metadata.json")
    .replace(/\\/g, "/");
  const files = await fg(pattern, { onlyFiles: true, dot: true });
  debug("ReviewCrew: found", files.length, "metadata files");

  // Filter out pr-context/metadata.json files
  const sessionFiles = files.filter((f) => !f.includes("/pr-context/"));
  debug("ReviewCrew:", sessionFiles.length, "session metadata files");

  const events: UsageEvent[] = [];

  for (const filePath of sessionFiles) {
    let meta: ReviewMetadata;
    try {
      meta = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }

    const sessionDir = path.basename(path.dirname(filePath));
    const ts = meta.started_at ?? tsFromSessionDir(sessionDir);
    if (!ts) continue;

    const repo = meta.repo ?? null;
    const pr = meta.pr_number ?? null;
    const projectName = repo ? repo.split("/").pop() ?? repo : "review-crew";
    const projectId = meta.session_id ?? `review-crew/${sessionDir}`;

    const baseMeta = {
      file: filePath,
      billing: "api" as const,
      repo,
      pr_number: pr,
      pr_title: meta.pr_title ?? null,
      verdict: meta.verdict ?? null,
    };

    // Only collect the summarizer call — reviewer costs are already tracked
    // by the Claude Code collector (opus reviewer) and Cursor collector
    // (GPT/Gemini reviewers).
    const summarizer = meta.costs?.summarizer;
    if (summarizer && summarizer.cost_usd > 0) {
      const model = resolveModel(meta.claude_model) ?? "claude-opus-4-6";
      events.push({
        id: createEventId({
          source: "review_crew",
          ts,
          role: "summarizer",
          session: projectId,
          tokens: {
            in: summarizer.input_tokens,
            out: summarizer.output_tokens,
          },
        }),
        ts,
        source: "review_crew",
        provider: "anthropic",
        model,
        tokens: {
          in: summarizer.input_tokens,
          out: summarizer.output_tokens,
          cache_write: 0,
          cache_read: 0,
        },
        cost: {
          reported_usd: summarizer.cost_usd,
          estimated_usd: null,
          final_usd: summarizer.cost_usd,
          mode: "reported",
        },
        project: { id: projectId, name: projectName, root: null },
        meta: { ...baseMeta, role: "summarizer" },
      });
    }
  }

  debug("ReviewCrew:", events.length, "events from", sessionFiles.length, "sessions");
  return events;
}
