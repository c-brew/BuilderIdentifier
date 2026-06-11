import { PRICING } from "./config";
import type { AuditEntry } from "./types";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function costUsd(u: Usage): number {
  const usd =
    (u.inputTokens / 1_000_000) * PRICING.inputPerMTok +
    (u.outputTokens / 1_000_000) * PRICING.outputPerMTok +
    (u.cacheReadTokens / 1_000_000) * PRICING.cacheReadPerMTok +
    (u.cacheWriteTokens / 1_000_000) * PRICING.cacheWritePerMTok;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

export function totalCost(entries: AuditEntry[]): number {
  const usd = entries.reduce((sum, e) => sum + (e.costUsd ?? 0), 0);
  return Math.round(usd * 10_000) / 10_000;
}

export function fmtUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}
