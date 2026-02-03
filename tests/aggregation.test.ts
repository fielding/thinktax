import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { aggregateEvents } from "../src/core/aggregate.js";
import { UsageEvent, emptyCost, emptyProject } from "../src/core/events.js";

function buildEvent(ts: string, usd: number): UsageEvent {
  return {
    id: ts,
    ts,
    source: "codex_cli",
    provider: "openai",
    model: "gpt-test",
    tokens: { in: 100, out: 50, cache_write: 0, cache_read: 0 },
    cost: { ...emptyCost(), estimated_usd: usd, final_usd: usd, mode: "estimated" },
    project: emptyProject(),
    meta: {},
  };
}

describe("aggregation boundaries", () => {
  it("respects local midnight for today window", () => {
    const tz = "America/Los_Angeles";
    const now = DateTime.fromISO("2026-02-02T10:00:00", { zone: tz });
    const start = now.startOf("day");

    const before = start.minus({ minutes: 30 });
    const after = start.plus({ minutes: 30 });

    const events = [
      buildEvent(before.toISO() ?? "", 1),
      buildEvent(after.toISO() ?? "", 2),
    ];

    const summary = aggregateEvents(events, tz, start, now);
    expect(summary.totals.count).toBe(1);
    expect(summary.totals.final_usd).toBeCloseTo(2);
  });
});
