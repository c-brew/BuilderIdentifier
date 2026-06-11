// Single source of truth for model + pricing disclosure (ARCHITECTURE.md §6, §8).
// Rendered in the governance banner and stamped on every run and audit entry.

export const MODEL_ID = "claude-opus-4-8";

export const PRICING_VERSION = "anthropic-2026-05";

// USD per million tokens for MODEL_ID
export const PRICING = {
  inputPerMTok: 5.0,
  outputPerMTok: 25.0,
  cacheReadPerMTok: 0.5,
  cacheWritePerMTok: 6.25,
} as const;

export const EST_COST_PER_RUN = "~$0.60";
