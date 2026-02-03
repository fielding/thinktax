import fs from "node:fs";
import { UsageProvider, UsageTokens } from "./events.js";
import { getPaths } from "./paths.js";

export interface PricingModel {
  provider: UsageProvider;
  model: string;
  input_per_million: number;
  output_per_million: number;
  cache_write_per_million?: number;
  cache_read_per_million?: number;
  notes?: string;
}

export interface PricingTable {
  updated: string | null;
  currency: "USD";
  per: "1M";
  models: PricingModel[];
}

export function loadPricingTable(): PricingTable {
  const { pricingFile } = getPaths();
  const raw = fs.readFileSync(pricingFile, "utf8");
  return JSON.parse(raw) as PricingTable;
}

export function findPricing(
  table: PricingTable,
  provider: UsageProvider,
  model: string | null
): PricingModel | null {
  if (!model) return null;
  const direct = table.models.find(
    (entry) => entry.provider === provider && entry.model === model
  );
  if (direct) return direct;

  const fuzzy = table.models.find(
    (entry) => entry.provider === provider && model.includes(entry.model)
  );

  return fuzzy ?? null;
}

export function estimateCostUsd(
  pricing: PricingModel,
  tokens: UsageTokens
): number {
  const input = (tokens.in / 1_000_000) * pricing.input_per_million;
  const output = (tokens.out / 1_000_000) * pricing.output_per_million;
  const cacheWrite =
    pricing.cache_write_per_million !== undefined
      ? (tokens.cache_write / 1_000_000) * pricing.cache_write_per_million
      : 0;
  const cacheRead =
    pricing.cache_read_per_million !== undefined
      ? (tokens.cache_read / 1_000_000) * pricing.cache_read_per_million
      : 0;

  return input + output + cacheWrite + cacheRead;
}
