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

  if (updated.cost.reported_usd !== null) {
    updated.cost.final_usd = updated.cost.reported_usd;
    updated.cost.mode = updated.cost.estimated_usd !== null ? "mixed" : "reported";
    return updated;
  }

  const pricingModel = findPricing(pricing, updated.provider, updated.model);
  if (!pricingModel) {
    updated.cost.mode = "unknown";
    updated.cost.final_usd = options.includeUnknown
      ? updated.cost.estimated_usd
      : null;
    return updated;
  }

  const estimate = estimateCostUsd(pricingModel, updated.tokens);
  updated.cost.estimated_usd = estimate;
  updated.cost.final_usd = estimate;
  updated.cost.mode = "estimated";
  return updated;
}
