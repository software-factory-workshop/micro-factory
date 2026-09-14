import type { ModelUsage } from "../../runtime/lib/delivery-usage.ts";

type DisplayUsage = Pick<ModelUsage, "inputTokens" | "outputTokens" | "usd">;

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function formatUsd(value: number) {
  const decimals = value >= 1 ? 2 : Math.min(8, Math.max(2, Math.ceil(-Math.log10(value)) + 2));
  return `$${value.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function formatModelUsage(usage: DisplayUsage | undefined): string | undefined {
  if (!usage) return undefined;
  const parts: string[] = [];
  if (positive(usage.inputTokens)) parts.push(`${usage.inputTokens.toLocaleString("en-US")} in`);
  if (positive(usage.outputTokens)) parts.push(`${usage.outputTokens.toLocaleString("en-US")} out`);
  if (positive(usage.usd)) parts.push(formatUsd(usage.usd));
  return parts.length ? parts.join(" · ") : undefined;
}
