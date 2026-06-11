// The ONLY path to the Anthropic API (ARCHITECTURE.md §6). Every agent call
// goes through callAgent(): structured output validated against a zod schema,
// real token usage priced into USD, and an AuditEntry with a sha256 of the
// exact input. Nothing can call the model and dodge the audit log.

import { createHash } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { MODEL_ID } from "./config";
import { costUsd } from "./cost";
import type { AuditEntry } from "./types";

let _client: Anthropic | undefined;

function client(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set.");
    }
    _client = new Anthropic();
  }
  return _client;
}

export interface CallAgentOptions<S extends z.ZodTypeAny> {
  stage: string;
  system: string | Anthropic.Messages.TextBlockParam[];
  input: unknown; // serialized to the user message — pre-fetched facts only
  schema: S;
  summary: string; // human-readable one-liner for the audit log
  thinking?: boolean; // adaptive thinking for judgment-heavy agents
  maxTokens?: number;
}

export interface CallAgentResult<T> {
  result: T;
  entry: AuditEntry;
}

export async function callAgent<S extends z.ZodTypeAny>(
  options: CallAgentOptions<S>,
): Promise<CallAgentResult<z.infer<S>>> {
  const { stage, system, input, schema, summary, thinking, maxTokens } = options;
  const userContent =
    typeof input === "string" ? input : JSON.stringify(input, null, 2);
  const started = Date.now();

  const response = await client().messages.parse({
    model: MODEL_ID,
    max_tokens: maxTokens ?? 4096,
    system,
    messages: [{ role: "user", content: userContent }],
    output_config: { format: zodOutputFormat(schema) },
    ...(thinking ? { thinking: { type: "adaptive" as const } } : {}),
  });

  const result = response.parsed_output;
  if (result == null) {
    throw new Error(`${stage}: model output failed schema validation`);
  }

  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
  };

  const entry: AuditEntry = {
    ts: new Date().toISOString(),
    stage,
    kind: "llm_call",
    model: response.model,
    usage,
    costUsd: costUsd(usage),
    durationMs: Date.now() - started,
    inputDigest: sha256(`${JSON.stringify(system)}\n${userContent}`),
    summary,
  };

  return { result, entry };
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
