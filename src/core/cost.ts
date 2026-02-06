import { UsageEvent } from "./events.js";
import { estimateCostUsd, findPricing, PricingTable } from "./pricing.js";

export interface CostingOptions {
  includeUnknown?: boolean;
}

export function applyCosting(
  event: UsageEvent,
  pricing: PricingTable,
  options: CostingOptions = {}
): UsageEvent {
  const updated = { ...event, cost: { ...event.cost } };

  // Always compute the estimate for "what it would have cost" tracking
  const pricingModel = findPricing(pricing, updated.provider, updated.model);
  if (pricingModel) {
    updated.cost.estimated_usd = estimateCostUsd(pricingModel, updated.tokens);
  }

  // Subscription billing: tokens are covered by flat-rate plan
  if (updated.meta?.billing === "subscription") {
    updated.cost.final_usd = 0;
    updated.cost.mode = "subscription";
    return updated;
  }

  // Reported cost from API takes priority
  if (updated.cost.reported_usd !== null) {
    updated.cost.final_usd = updated.cost.reported_usd;
    updated.cost.mode = updated.cost.estimated_usd !== null ? "mixed" : "reported";
    return updated;
  }

  if (!pricingModel) {
    updated.cost.mode = "unknown";
    updated.cost.final_usd = options.includeUnknown
      ? updated.cost.estimated_usd
      : null;
    return updated;
  }

  updated.cost.final_usd = updated.cost.estimated_usd;
  updated.cost.mode = "estimated";
  return updated;
}
