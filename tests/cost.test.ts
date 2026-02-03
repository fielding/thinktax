import { describe, expect, it } from "vitest";
import { applyCosting } from "../src/core/cost.js";
import { UsageEvent, emptyCost, emptyProject, emptyTokens } from "../src/core/events.js";
import { PricingTable } from "../src/core/pricing.js";

function buildEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    id: "test-event",
    ts: "2026-02-02T10:00:00Z",
    source: "claude_code",
    provider: "anthropic",
    model: "claude-3-5-sonnet",
    tokens: { in: 1000, out: 500, cache_write: 0, cache_read: 0 },
    cost: emptyCost(),
    project: emptyProject(),
    meta: {},
    ...overrides,
  };
}

const mockPricing: PricingTable = {
  updated: "2026-02-02",
  currency: "USD",
  per: "1M",
  models: [
    {
      provider: "anthropic",
      model: "claude-3-5-sonnet",
      input_per_million: 3.0,
      output_per_million: 15.0,
      cache_write_per_million: 3.75,
      cache_read_per_million: 0.30,
    },
    {
      provider: "openai",
      model: "gpt-4o",
      input_per_million: 2.5,
      output_per_million: 10.0,
    },
  ],
};

describe("applyCosting", () => {
  it("uses reported cost when available", () => {
    const event = buildEvent({
      cost: { ...emptyCost(), reported_usd: 0.05 },
    });

    const result = applyCosting(event, mockPricing);

    expect(result.cost.final_usd).toBe(0.05);
    expect(result.cost.mode).toBe("reported");
  });

  it("marks as mixed when both reported and estimated exist", () => {
    const event = buildEvent({
      cost: { ...emptyCost(), reported_usd: 0.05, estimated_usd: 0.04 },
    });

    const result = applyCosting(event, mockPricing);

    expect(result.cost.final_usd).toBe(0.05);
    expect(result.cost.mode).toBe("mixed");
  });

  it("estimates cost when no reported cost exists", () => {
    const event = buildEvent({
      tokens: { in: 1_000_000, out: 100_000, cache_write: 0, cache_read: 0 },
    });

    const result = applyCosting(event, mockPricing);

    // 1M input * $3/M = $3, 100K output * $15/M = $1.50
    expect(result.cost.estimated_usd).toBeCloseTo(4.5);
    expect(result.cost.final_usd).toBeCloseTo(4.5);
    expect(result.cost.mode).toBe("estimated");
  });

  it("includes cache costs in estimation", () => {
    const event = buildEvent({
      tokens: { in: 1_000_000, out: 0, cache_write: 500_000, cache_read: 1_000_000 },
    });

    const result = applyCosting(event, mockPricing);

    // 1M input * $3/M = $3, 500K cache_write * $3.75/M = $1.875, 1M cache_read * $0.30/M = $0.30
    expect(result.cost.estimated_usd).toBeCloseTo(5.175);
    expect(result.cost.mode).toBe("estimated");
  });

  it("marks unknown models correctly", () => {
    const event = buildEvent({
      model: "unknown-model-xyz",
    });

    const result = applyCosting(event, mockPricing);

    expect(result.cost.mode).toBe("unknown");
    expect(result.cost.final_usd).toBeNull();
  });

  it("includes unknown models when option is set", () => {
    const event = buildEvent({
      model: "unknown-model-xyz",
      cost: { ...emptyCost(), estimated_usd: 0.10 },
    });

    const result = applyCosting(event, mockPricing, { includeUnknown: true });

    expect(result.cost.mode).toBe("unknown");
    expect(result.cost.final_usd).toBe(0.10);
  });

  it("handles null model", () => {
    const event = buildEvent({ model: null });

    const result = applyCosting(event, mockPricing);

    expect(result.cost.mode).toBe("unknown");
  });

  it("does not mutate original event", () => {
    const event = buildEvent();
    const originalCost = { ...event.cost };

    applyCosting(event, mockPricing);

    expect(event.cost).toEqual(originalCost);
  });
});
