import { UsageEvent } from "./events.js";

export type BillingMode = "subscription" | "api" | "estimate" | "unknown" | "mixed";
export type BillingSource =
  | "session_registry"
  | "config_default"
  | "collector"
  | "manual_override"
  | "unknown";
export type BillingConfidence = "high" | "default" | "low" | "unknown";

export interface BillingMetadataInput {
  mode: BillingMode;
  source: BillingSource;
  confidence: BillingConfidence;
}

export function applyBillingMetadata(
  event: UsageEvent,
  billing: BillingMetadataInput
): UsageEvent {
  return {
    ...event,
    meta: {
      ...event.meta,
      billing: billing.mode,
      billing_source: billing.source,
      billing_confidence: billing.confidence,
    },
  };
}
