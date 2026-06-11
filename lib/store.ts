import { getCandidate, saveCandidate } from "./data";
import { supabaseAdmin } from "./supabase";
import type {
  AgentOutputRecord,
  AuditEntry,
  DivergenceFlag,
  EvaluationRun,
  ReviewerDecision,
  RubricScore,
  VerificationCheckRow,
} from "./types";

type DbRun = {
  id: string;
  candidate_id: string;
  status: "running" | "complete" | "error";
  model: string;
  pricing_version: string;
  blinded_packet: unknown;
  token_map: unknown;
  synthesis: unknown;
  transparency: unknown;
  total_cost_usd: string | number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
};

export async function saveRun(run: EvaluationRun): Promise<EvaluationRun> {
  const candidate = await getCandidate(run.candidateId);
  if (!candidate) throw new Error(`Candidate not found: ${run.candidateId}`);

  const supabase = supabaseAdmin();
  await saveCandidate(candidate);

  await must(
    supabase.from("evaluation_runs").insert({
      id: run.id,
      candidate_id: run.candidateId,
      status: run.status,
      model: run.model,
      pricing_version: run.pricingVersion,
      blinded_packet: run.blindedPacket,
      token_map: run.tokenMap,
      synthesis: run.scorecard.synthesis,
      transparency: run.transparencySummary,
      total_cost_usd: run.totalCostUsd,
      error_message: run.errorMessage ?? null,
      started_at: run.startedAt,
      completed_at: run.completedAt ?? null,
    }),
  );

  await insertVerificationChecks(run.id, run.verificationChecks);
  await insertAgentOutputs(run.id, run.agentOutputs);
  await insertScores(run.id, run.scorecard.passes);
  await insertAudit(run.id, run.auditLog);

  return run;
}

export async function getRun(id: string): Promise<EvaluationRun | undefined> {
  const supabase = supabaseAdmin();
  const { data: run, error } = await supabase
    .from("evaluation_runs")
    .select("*")
    .eq("id", id)
    .maybeSingle<DbRun>();

  if (error) throw error;
  if (!run) return undefined;

  return hydrateRun(run);
}

export async function listRuns(candidateId?: string): Promise<EvaluationRun[]> {
  const supabase = supabaseAdmin();
  let query = supabase
    .from("evaluation_runs")
    .select("*")
    .order("started_at", { ascending: false });

  if (candidateId) query = query.eq("candidate_id", candidateId);

  const { data, error } = await query.returns<DbRun[]>();
  if (error) throw error;

  return Promise.all((data ?? []).map((run) => hydrateRun(run)));
}

export async function recordDecision(
  runId: string,
  decision: Omit<ReviewerDecision, "runId" | "ts">,
): Promise<EvaluationRun | undefined> {
  const supabase = supabaseAdmin();
  const existing = await getRun(runId);
  if (!existing || existing.reviewerDecision) return existing;

  const userId = await getReviewerUserId();
  await must(
    supabase.from("reviewer_decisions").insert({
      run_id: runId,
      user_id: userId,
      decision: decision.decision,
      rationale: decision.rationale,
    }),
  );

  await insertAudit(runId, [
    {
      ts: new Date().toISOString(),
      stage: "reviewerDecision",
      kind: "reviewer_action",
      durationMs: 0,
      summary: `Reviewer recorded ${decision.decision}.`,
    },
  ]);

  return getRun(runId);
}

async function hydrateRun(run: DbRun): Promise<EvaluationRun> {
  const supabase = supabaseAdmin();
  const [scores, outputs, checks, audit, pii, decision] = await Promise.all([
    mustData(
      supabase
        .from("scores")
        .select("*")
        .eq("run_id", run.id)
        .order("pass", { ascending: true }),
    ),
    mustData(
      supabase
        .from("agent_outputs")
        .select("*")
        .eq("run_id", run.id)
        .order("pass", { ascending: true }),
    ),
    mustData(supabase.from("verification_checks").select("*").eq("run_id", run.id)),
    mustData(supabase.from("audit_log").select("*").eq("run_id", run.id).order("ts")),
    mustData(
      supabase
        .from("candidate_pii")
        .select("name")
        .eq("candidate_id", run.candidate_id)
        .maybeSingle(),
    ),
    mustData(
      supabase
        .from("reviewer_decisions")
        .select("*")
        .eq("run_id", run.id)
        .maybeSingle(),
    ),
  ]);

  const rubricScores = (scores ?? []).map(
    (score: any): RubricScore => ({
      dimension: score.dimension,
      score: score.score,
      citation: score.citation,
      rationale: score.rationale,
      confidence: score.confidence,
    }),
  );
  const passes = [1, 2].map((pass) => ({
    pass: pass as 1 | 2,
    scores: rubricScoresForPass(scores ?? [], pass as 1 | 2),
  }));

  return {
    id: run.id,
    candidateId: run.candidate_id,
    candidateName: (pii as { name?: string } | null)?.name,
    status: run.status,
    model: run.model,
    pricingVersion: run.pricing_version,
    scorecard: {
      passes,
      divergence: calculateDivergence(passes),
      synthesis: (run.synthesis as EvaluationRun["scorecard"]["synthesis"]) ?? null,
    },
    agentOutputs: (outputs ?? []).map(
      (output: any): AgentOutputRecord => ({
        agent: output.agent,
        pass: output.pass,
        confidence: output.confidence,
        result: output.result,
      }),
    ),
    verificationChecks: (checks ?? []).map(
      (check: any): VerificationCheckRow => ({
        agent: check.agent,
        kind: check.kind,
        source: check.source,
        target: check.target,
        passed: check.passed,
        latencyMs: check.latency_ms ?? undefined,
        detail: check.detail,
      }),
    ),
    blindedPacket: (run.blinded_packet as EvaluationRun["blindedPacket"]) ?? null,
    tokenMap: (run.token_map as Record<string, string>) ?? {},
    auditLog: (audit ?? []).map(
      (entry: any): AuditEntry => ({
        ts: entry.ts,
        stage: entry.stage,
        kind: entry.kind,
        model: entry.model ?? undefined,
        usage:
          entry.input_tokens || entry.output_tokens
            ? {
                inputTokens: entry.input_tokens ?? 0,
                outputTokens: entry.output_tokens ?? 0,
                cacheReadTokens: entry.cache_read_tokens ?? 0,
                cacheWriteTokens: entry.cache_write_tokens ?? 0,
              }
            : undefined,
        costUsd: entry.cost_usd == null ? undefined : Number(entry.cost_usd),
        durationMs: entry.duration_ms ?? 0,
        inputDigest: entry.input_digest ?? undefined,
        summary: entry.summary,
      }),
    ),
    totalCostUsd: Number(run.total_cost_usd),
    startedAt: run.started_at,
    completedAt: run.completed_at ?? undefined,
    errorMessage: run.error_message ?? undefined,
    reviewerDecision: decision
      ? {
          runId: (decision as any).run_id,
          ts: (decision as any).created_at,
          decision: (decision as any).decision,
          rationale: (decision as any).rationale,
        }
      : undefined,
    transparencySummary: (run.transparency as EvaluationRun["transparencySummary"]) ?? undefined,
  };
}

async function insertVerificationChecks(
  runId: string,
  rows: VerificationCheckRow[],
): Promise<void> {
  if (!rows.length) return;
  await must(
    supabaseAdmin().from("verification_checks").insert(
      rows.map((row) => ({
        run_id: runId,
        agent: row.agent,
        kind: row.kind,
        source: row.source,
        target: row.target,
        passed: row.passed,
        latency_ms: row.latencyMs ?? null,
        detail: row.detail,
      })),
    ),
  );
}

async function insertAgentOutputs(runId: string, rows: AgentOutputRecord[]): Promise<void> {
  if (!rows.length) return;
  await must(
    supabaseAdmin().from("agent_outputs").insert(
      rows.map((row) => ({
        run_id: runId,
        agent: row.agent,
        pass: row.pass,
        confidence: row.confidence,
        result: row.result,
      })),
    ),
  );
}

async function insertScores(
  runId: string,
  passes: EvaluationRun["scorecard"]["passes"],
): Promise<void> {
  const rows = passes.flatMap((pass) =>
    pass.scores.map((score) => ({
      run_id: runId,
      pass: pass.pass,
      dimension: score.dimension,
      score: score.score,
      citation: score.citation,
      rationale: score.rationale,
      confidence: score.confidence,
    })),
  );
  if (!rows.length) return;
  await must(supabaseAdmin().from("scores").insert(rows));
}

async function insertAudit(runId: string, rows: AuditEntry[]): Promise<void> {
  if (!rows.length) return;
  await must(
    supabaseAdmin().from("audit_log").insert(
      rows.map((entry) => ({
        run_id: runId,
        ts: entry.ts,
        stage: entry.stage,
        kind: entry.kind,
        model: entry.model ?? null,
        input_tokens: entry.usage?.inputTokens ?? null,
        output_tokens: entry.usage?.outputTokens ?? null,
        cache_read_tokens: entry.usage?.cacheReadTokens ?? null,
        cache_write_tokens: entry.usage?.cacheWriteTokens ?? null,
        cost_usd: entry.costUsd ?? null,
        duration_ms: entry.durationMs,
        input_digest: entry.inputDigest ?? null,
        summary: entry.summary,
      })),
    ),
  );
}

async function getReviewerUserId(): Promise<string> {
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("users")
    .select("id")
    .eq("email", "connor.brewer@icloud.com")
    .maybeSingle<{ id: string }>();

  if (error) throw error;
  if (data?.id) return data.id;

  const inserted = await mustData(
    supabase
      .from("users")
      .insert({
        email: "connor.brewer@icloud.com",
        name: "Connor Brewer",
        role: "reviewer",
      })
      .select("id")
      .single(),
  );
  return (inserted as { id: string }).id;
}

function rubricScoresForPass(rows: any[], pass: 1 | 2): RubricScore[] {
  return rows
    .filter((row) => row.pass === pass)
    .map((row) => ({
      dimension: row.dimension,
      score: row.score,
      citation: row.citation,
      rationale: row.rationale,
      confidence: row.confidence,
    }));
}

function calculateDivergence(
  passes: { pass: 1 | 2; scores: RubricScore[] }[],
): DivergenceFlag[] {
  const first = passes.find((pass) => pass.pass === 1)?.scores ?? [];
  const second = passes.find((pass) => pass.pass === 2)?.scores ?? [];

  return first
    .map((score) => {
      const other = second.find((item) => item.dimension === score.dimension);
      const otherScore = other?.score ?? score.score;
      return {
        dimension: score.dimension,
        delta: Math.abs(score.score - otherScore),
        scores: [score.score, otherScore] as [number, number],
      };
    })
    .filter((flag) => flag.delta > 1);
}

async function must<T>(query: PromiseLike<{ error: unknown }>): Promise<void> {
  const { error } = await query;
  if (error) throw error;
}

async function mustData<T>(
  query: PromiseLike<{ data: T; error: unknown }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
