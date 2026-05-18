import { describe, expect, it } from "vitest";
import { applyBillingMetadata } from "../src/core/billing-metadata.js";
import { UsageEvent, emptyCost, emptyProject } from "../src/core/events.js";

function buildEvent(meta: Record<string, unknown> = {}): UsageEvent {
  return {
    id: "test-event",
    ts: "2026-02-02T10:00:00Z",
    source: "claude_code",
    provider: "anthropic",
    model: "claude-3-5-sonnet",
    tokens: { in: 1000, out: 500, cache_write: 0, cache_read: 0 },
    cost: emptyCost(),
    project: emptyProject(),
    meta,
  };
}

describe("applyBillingMetadata", () => {
  it("records explicit registry billing with source and high confidence", () => {
    const event = buildEvent({ existing: true });

    const result = applyBillingMetadata(event, {
      mode: "api",
      source: "session_registry",
      confidence: "high",
    });

    expect(result.meta).toMatchObject({
      existing: true,
      billing: "api",
      billing_source: "session_registry",
      billing_confidence: "high",
    });
    expect(event.meta).toEqual({ existing: true });
  });

  it("keeps default billing visibly lower-confidence instead of flattening it into a bare mode", () => {
    const result = applyBillingMetadata(buildEvent(), {
      mode: "subscription",
      source: "config_default",
      confidence: "default",
    });

    expect(result.meta.billing).toBe("subscription");
    expect(result.meta.billing_source).toBe("config_default");
    expect(result.meta.billing_confidence).toBe("default");
  });
});
