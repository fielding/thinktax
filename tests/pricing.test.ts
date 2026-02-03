import { describe, expect, it } from "vitest";
import { findPricing, estimateCostUsd, PricingTable, PricingModel } from "../src/core/pricing.js";

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
    {
      provider: "openai",
      model: "o1",
      input_per_million: 15.0,
      output_per_million: 60.0,
    },
  ],
};

describe("findPricing", () => {
  it("finds exact model match", () => {
    const result = findPricing(mockPricing, "anthropic", "claude-3-5-sonnet");

    expect(result).not.toBeNull();
    expect(result?.model).toBe("claude-3-5-sonnet");
  });

  it("finds fuzzy match for model variants", () => {
    // Full model name includes base model name
    const result = findPricing(mockPricing, "anthropic", "claude-3-5-sonnet-20241022");

    expect(result).not.toBeNull();
    expect(result?.model).toBe("claude-3-5-sonnet");
  });

  it("returns null for unknown model", () => {
    const result = findPricing(mockPricing, "anthropic", "claude-unknown");

    expect(result).toBeNull();
  });

  it("returns null for null model", () => {
    const result = findPricing(mockPricing, "anthropic", null);

    expect(result).toBeNull();
  });

  it("respects provider when matching", () => {
    // gpt-4o exists for openai but not anthropic
    const resultOpenai = findPricing(mockPricing, "openai", "gpt-4o");
    const resultAnthropic = findPricing(mockPricing, "anthropic", "gpt-4o");

    expect(resultOpenai).not.toBeNull();
    expect(resultAnthropic).toBeNull();
  });
});

describe("estimateCostUsd", () => {
  const pricing: PricingModel = {
    provider: "anthropic",
    model: "claude-3-5-sonnet",
    input_per_million: 3.0,
    output_per_million: 15.0,
    cache_write_per_million: 3.75,
    cache_read_per_million: 0.30,
  };

  it("calculates basic input/output cost", () => {
    const tokens = { in: 1_000_000, out: 100_000, cache_write: 0, cache_read: 0 };

    const cost = estimateCostUsd(pricing, tokens);

    // 1M * $3/M + 0.1M * $15/M = $3 + $1.50 = $4.50
    expect(cost).toBeCloseTo(4.5);
  });

  it("calculates cache costs", () => {
    const tokens = { in: 0, out: 0, cache_write: 1_000_000, cache_read: 2_000_000 };

    const cost = estimateCostUsd(pricing, tokens);

    // 1M * $3.75/M + 2M * $0.30/M = $3.75 + $0.60 = $4.35
    expect(cost).toBeCloseTo(4.35);
  });

  it("handles zero tokens", () => {
    const tokens = { in: 0, out: 0, cache_write: 0, cache_read: 0 };

    const cost = estimateCostUsd(pricing, tokens);

    expect(cost).toBe(0);
  });

  it("handles missing cache pricing", () => {
    const pricingNoCache: PricingModel = {
      provider: "openai",
      model: "gpt-4o",
      input_per_million: 2.5,
      output_per_million: 10.0,
    };
    const tokens = { in: 1_000_000, out: 0, cache_write: 1_000_000, cache_read: 1_000_000 };

    const cost = estimateCostUsd(pricingNoCache, tokens);

    // Only input cost, cache costs are 0 when not defined
    expect(cost).toBeCloseTo(2.5);
  });

  it("handles fractional token counts", () => {
    const tokens = { in: 500, out: 250, cache_write: 0, cache_read: 0 };

    const cost = estimateCostUsd(pricing, tokens);

    // 500/1M * $3 + 250/1M * $15 = $0.0015 + $0.00375 = $0.00525
    expect(cost).toBeCloseTo(0.00525);
  });
});
