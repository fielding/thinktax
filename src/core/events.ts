import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

export type UsageSource =
  | "cursor_ide"
  | "cursor_agent_cli"
  | "claude_code"
  | "codex_cli";

export type UsageProvider = "cursor" | "anthropic" | "openai";

export interface UsageTokens {
  in: number;
  out: number;
  cache_write: number;
  cache_read: number;
}

export interface UsageCost {
  reported_usd: number | null;
  estimated_usd: number | null;
  final_usd: number | null;
  mode: "reported" | "estimated" | "mixed" | "unknown";
}

export interface UsageProject {
  id: string | null;
  name: string | null;
  root: string | null;
}

export interface UsageEvent {
  id: string;
  ts: string;
  source: UsageSource;
  provider: UsageProvider;
  model: string | null;
  tokens: UsageTokens;
  cost: UsageCost;
  project: UsageProject;
  meta: Record<string, unknown>;
}

export function createEventId(parts: Record<string, unknown>): string {
  const payload = JSON.stringify(parts);
  return crypto.createHash("sha1").update(payload).digest("hex");
}

export async function readJsonl<T>(filePath: string): Promise<T[]> {
  const items: T[] = [];
  if (!fs.existsSync(filePath)) return items;

  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      items.push(JSON.parse(trimmed) as T);
    } catch {
      // Skip malformed line.
    }
  }

  return items;
}

export function writeJsonl<T>(filePath: string, items: T[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const data = items.map((item) => JSON.stringify(item)).join("\n");
  fs.writeFileSync(filePath, data + (data ? "\n" : ""), "utf8");
}

export function appendJsonl<T>(filePath: string, item: T): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, JSON.stringify(item) + "\n", "utf8");
}

export function emptyCost(): UsageCost {
  return {
    reported_usd: null,
    estimated_usd: null,
    final_usd: null,
    mode: "unknown",
  };
}

export function emptyTokens(): UsageTokens {
  return { in: 0, out: 0, cache_write: 0, cache_read: 0 };
}

export function emptyProject(): UsageProject {
  return { id: null, name: null, root: null };
}
