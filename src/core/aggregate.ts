import fs from "node:fs";
import path from "node:path";
import { DateTime } from "luxon";
import { readJsonl, UsageEvent, UsageProvider } from "./events.js";
import { getPaths } from "./paths.js";

export interface Totals {
  count: number;
  tokens_in: number;
  tokens_out: number;
  cache_write: number;
  cache_read: number;
  reported_usd: number;
  estimated_usd: number;
  final_usd: number;
  unknown_cost: number;
}

export interface SummaryBreakdowns {
  provider: Record<string, Totals>;
  source: Record<string, Totals>;
  model: Record<string, Totals>;
  project: Record<string, Totals>;
}

export interface Summary {
  timezone: string;
  from: string;
  to: string;
  totals: Totals;
  breakdowns: SummaryBreakdowns;
}

export function emptyTotals(): Totals {
  return {
    count: 0,
    tokens_in: 0,
    tokens_out: 0,
    cache_write: 0,
    cache_read: 0,
    reported_usd: 0,
    estimated_usd: 0,
    final_usd: 0,
    unknown_cost: 0,
  };
}

function addTotals(target: Totals, event: UsageEvent): void {
  target.count += 1;
  target.tokens_in += event.tokens.in;
  target.tokens_out += event.tokens.out;
  target.cache_write += event.tokens.cache_write;
  target.cache_read += event.tokens.cache_read;
  target.reported_usd += event.cost.reported_usd ?? 0;
  target.estimated_usd += event.cost.estimated_usd ?? 0;
  target.final_usd += event.cost.final_usd ?? 0;
  if (event.cost.mode === "unknown") {
    target.unknown_cost += 1;
  }
}

function bucketKey(value: string | null, fallback: string): string {
  return value && value.length > 0 ? value : fallback;
}

function addBreakdown(
  breakdown: Record<string, Totals>,
  key: string,
  event: UsageEvent
): void {
  const totals = breakdown[key] ?? emptyTotals();
  addTotals(totals, event);
  breakdown[key] = totals;
}

export function aggregateEvents(
  events: UsageEvent[],
  timezone: string,
  from: DateTime,
  to: DateTime
): Summary {
  const totals = emptyTotals();
  const breakdowns: SummaryBreakdowns = {
    provider: {},
    source: {},
    model: {},
    project: {},
  };

  for (const event of events) {
    const eventTime = DateTime.fromISO(event.ts).setZone(timezone);
    if (eventTime < from || eventTime > to) continue;
    addTotals(totals, event);
    addBreakdown(breakdowns.provider, event.provider, event);
    addBreakdown(breakdowns.source, event.source, event);
    addBreakdown(breakdowns.model, bucketKey(event.model, "unknown"), event);
    addBreakdown(
      breakdowns.project,
      bucketKey(event.project.name ?? event.project.id, "unassigned"),
      event
    );
  }

  return {
    timezone,
    from: from.toISO() ?? "",
    to: to.toISO() ?? "",
    totals,
    breakdowns,
  };
}

export async function loadEventsForRange(
  timezone: string,
  from: DateTime,
  to: DateTime
): Promise<UsageEvent[]> {
  const { eventsDir } = getPaths();
  const events: UsageEvent[] = [];

  if (!fs.existsSync(eventsDir)) return events;

  const startDate = from.setZone(timezone).startOf("day");
  const endDate = to.setZone(timezone).startOf("day");

  let cursor = startDate;
  while (cursor <= endDate) {
    const day = cursor.toISODate();
    if (day) {
      const filePath = path.join(eventsDir, `${day}.jsonl`);
      const dayEvents = await readJsonl<UsageEvent>(filePath);
      events.push(...dayEvents);
    }
    cursor = cursor.plus({ days: 1 });
  }

  return events;
}

function parseEventDate(fileName: string): DateTime | null {
  const match = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(fileName);
  if (!match) return null;
  const parsed = DateTime.fromISO(match[1]);
  return parsed.isValid ? parsed : null;
}

export async function loadAllEvents(
  timezone: string,
  now: DateTime
): Promise<{ events: UsageEvent[]; earliest: DateTime }> {
  const { eventsDir } = getPaths();
  if (!fs.existsSync(eventsDir)) {
    return { events: [], earliest: now };
  }

  const files = fs.readdirSync(eventsDir);
  let earliest = now;
  let found = false;

  for (const file of files) {
    const date = parseEventDate(file);
    if (!date) continue;
    if (!found || date < earliest) {
      earliest = date;
      found = true;
    }
  }

  if (!found) {
    return { events: [], earliest: now };
  }

  const events = await loadEventsForRange(timezone, earliest, now);
  return { events, earliest };
}

export async function loadSummaries(
  timezone: string,
  now: DateTime
): Promise<{ today: Summary; mtd: Summary; ytd: Summary; all: Summary }> {
  const startOfDay = now.setZone(timezone).startOf("day");
  const startOfMonth = now.setZone(timezone).startOf("month");
  const startOfYear = now.setZone(timezone).startOf("year");

  const { events, earliest } = await loadAllEvents(timezone, now);
  const today = aggregateEvents(events, timezone, startOfDay, now);
  const mtd = aggregateEvents(events, timezone, startOfMonth, now);
  const ytd = aggregateEvents(events, timezone, startOfYear, now);
  const all = aggregateEvents(events, timezone, earliest, now);

  return { today, mtd, ytd, all };
}

export function summarizeByProvider(
  summary: Summary
): Record<UsageProvider, Totals> {
  return summary.breakdowns.provider as Record<UsageProvider, Totals>;
}
