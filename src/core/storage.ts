import fs from "node:fs";
import path from "node:path";
import { DateTime } from "luxon";
import { appendJsonl, readJsonl, writeJsonl, UsageEvent } from "./events.js";
import { getPaths } from "./paths.js";

export async function writeEvents(events: UsageEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  const { eventsDir } = getPaths();
  const grouped = new Map<string, UsageEvent[]>();

  for (const event of events) {
    const day = DateTime.fromISO(event.ts).toISODate();
    if (!day) continue;
    const bucket = grouped.get(day) ?? [];
    bucket.push(event);
    grouped.set(day, bucket);
  }

  let written = 0;
  for (const [day, dayEvents] of grouped) {
    const filePath = path.join(eventsDir, `${day}.jsonl`);
    const existing = await readJsonl<UsageEvent>(filePath);
    const seen = new Set(existing.map((event) => event.id));

    for (const event of dayEvents) {
      if (seen.has(event.id)) continue;
      appendJsonl(filePath, event);
      written += 1;
    }
  }

  return written;
}

export async function loadAllStoredEvents(): Promise<UsageEvent[]> {
  const { eventsDir } = getPaths();
  if (!fs.existsSync(eventsDir)) return [];

  const files = fs.readdirSync(eventsDir).filter((f) => f.endsWith(".jsonl"));
  const allEvents: UsageEvent[] = [];

  for (const file of files) {
    const filePath = path.join(eventsDir, file);
    const events = await readJsonl<UsageEvent>(filePath);
    allEvents.push(...events);
  }

  return allEvents;
}

export async function overwriteEvents(events: UsageEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  const { eventsDir } = getPaths();
  const grouped = new Map<string, UsageEvent[]>();

  for (const event of events) {
    const day = DateTime.fromISO(event.ts).toISODate();
    if (!day) continue;
    const bucket = grouped.get(day) ?? [];
    bucket.push(event);
    grouped.set(day, bucket);
  }

  let written = 0;
  for (const [day, dayEvents] of grouped) {
    const filePath = path.join(eventsDir, `${day}.jsonl`);
    writeJsonl(filePath, dayEvents);
    written += dayEvents.length;
  }

  return written;
}
