import { Totals } from "../core/aggregate.js";

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `$${value.toFixed(2)}`;
}

export function formatTotalsLine(label: string, totals: Totals): string {
  return `${label}: ${formatUsd(totals.final_usd)} (in ${totals.tokens_in}, out ${totals.tokens_out})`;
}

export function formatBreakdown(
  breakdown: Record<string, Totals>,
  max = 8
): string[] {
  return Object.entries(breakdown)
    .sort((a, b) => b[1].final_usd - a[1].final_usd)
    .slice(0, max)
    .map(([key, totals]) => formatTotalsLine(key, totals));
}
