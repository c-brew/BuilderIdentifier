// Orchestrator (ARCHITECTURE.md §4). Deterministic where possible, LLM only
// for judgment: checks.ts fetches facts, agents.ts interprets them, and every
// consequential step lands in the audit log with real token usage and cost.

import { createHash, randomUUID } from "crypto";
import {
  runEvidenceAssessor,
  runIdentityVerifier,
  runProjectVerifier,
  runSynthesizer,
  type BlindedVerifierFindings,
} from "./agents";
import { redactCandidate } from "./blind";
import { gatherIdentityFacts, gatherProjectFacts } from "./checks";
import { MODEL_ID, PRICING_VERSION } from "./config";
import { totalCost } from "./cost";
import { getCandidate } from "./data";
import { RUBRIC } from "./rubric";
import { saveRun } from "./store";
import type {
  AgentOutputRecord,
  AssessorResult,
  AuditEntry,
  Candidate,
  DivergenceFlag,
  EvaluationRun,
  IdentityFacts,
  ProjectFacts,
  RubricScore,
  StreamEvent,
  VerificationCheckRow,
} from "./types";

type Emit = (event: StreamEvent) => void;

export async function runEvaluation(
  candidateId: string,
  emit?: Emit,
): Promise<EvaluationRun> {
  const candidate = await getCandidate(candidateId);
  if (!candidate) {
    throw new Error(`Candidate not found: ${candidateId}`);
  }

  const runId = `run_${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const auditLog: AuditEntry[] = [];
  const agentOutputs: AgentOutputRecord[] = [];
  const verificationChecks: VerificationCheckRow[] = [];

  const record = (entry: AuditEntry) => {
    auditLog.push(entry);
    emit?.({ type: "audit", entry });
  };

  emit?.({ type: "run_started", runId, candidateId });

  // Stage 0 — blind (pure code, no LLM)
  emit?.({ type: "stage_start", stage: "blind" });
  const blindStarted = Date.now();
  const blinded = redactCandidate(candidate);
  record({
    ts: new Date().toISOString(),
    stage: "blind",
    kind: "blinding",
    durationMs: Date.now() - blindStarted,
    inputDigest: blinded.inputDigest,
    summary:
      "Name, contact, education, URLs and in-text PII stripped before assessment.",
  });
  emit?.({ type: "stage_complete", stage: "blind", summary: "Candidate packet redacted." });

  // Stage 1a/1b — deterministic checks, then verifier agents (parallel)
  emit?.({ type: "stage_start", stage: "projectVerifier" });
  emit?.({ type: "stage_start", stage: "identityVerifier" });

  const [projectFacts, identityFacts] = await Promise.all([
    collectProjectFacts(candidate, verificationChecks, record),
    collectIdentityFacts(candidate, verificationChecks, record),
  ]);

  const [projectCall, identityCall] = await Promise.all([
    runProjectVerifier(projectFacts),
    runIdentityVerifier(identityFacts),
  ]);

  const project = projectCall.result;
  record(projectCall.entry);
  agentOutputs.push({
    agent: "projectVerifier",
    pass: 1,
    confidence: project.confidence,
    result: project,
  });
  emit?.({ type: "stage_complete", stage: "projectVerifier", summary: project.overallSummary });

  const identity = identityCall.result;
  record(identityCall.entry);
  agentOutputs.push({
    agent: "identityVerifier",
    pass: 1,
    confidence: identity.confidence,
    result: identity,
  });
  emit?.({ type: "stage_complete", stage: "identityVerifier", summary: identity.overallSummary });

  // Stage 2 — Evidence Assessor on blinded input only, twice (consistency).
  // Sequential on an identical prompt so pass 2 reads the prompt cache.
  const findings = blindVerifierFindings(blinded.packet, project, identity);
  const assessorPasses: AssessorResult[] = [];
  for (const pass of [1, 2] as const) {
    emit?.({ type: "stage_start", stage: `evidenceAssessor:${pass}` });
    const call = await runEvidenceAssessor(blinded.packet, findings, pass);
    const assessor = normalizeAssessor(call.result, pass);
    assessorPasses.push(assessor);
    record(call.entry);
    agentOutputs.push({
      agent: "evidenceAssessor",
      pass,
      confidence: assessor.confidence,
      result: assessor,
    });
    emit?.({
      type: "stage_complete",
      stage: `evidenceAssessor:${pass}`,
      summary: `Pass ${pass} produced ${assessor.scores.length} cited scores.`,
    });
  }

  const divergence = calculateDivergence(assessorPasses);

  // Stage 3 — Synthesizer
  emit?.({ type: "stage_start", stage: "synthesizer" });
  const synthCall = await runSynthesizer({
    candidateToken: blinded.packet.candidateToken,
    evidenceCount: blinded.packet.evidence.length,
    projectVerifier: project,
    identityVerifier: identity,
    assessorPasses,
    divergenceCount: divergence.length,
  });
  const synthesis = synthCall.result;
  record(synthCall.entry);
  agentOutputs.push({
    agent: "synthesizer",
    pass: 1,
    confidence: synthesis.overallConfidence,
    result: synthesis,
  });
  emit?.({ type: "stage_complete", stage: "synthesizer", summary: "Brief ready for reviewer." });

  const run: EvaluationRun = {
    id: runId,
    candidateId,
    candidateName: candidate.pii.name,
    status: "complete",
    model: MODEL_ID,
    pricingVersion: PRICING_VERSION,
    scorecard: {
      passes: [
        { pass: 1, scores: assessorPasses[0].scores },
        { pass: 2, scores: assessorPasses[1].scores },
      ],
      divergence,
      synthesis,
    },
    agentOutputs,
    verificationChecks,
    blindedPacket: blinded.packet,
    tokenMap: blinded.tokenMap,
    auditLog,
    totalCostUsd: totalCost(auditLog),
    startedAt,
    completedAt: new Date().toISOString(),
    transparencySummary: {
      checked: synthesis.verified,
      notChecked: synthesis.notChecked,
      howToContest:
        "A reviewer can challenge any citation, rerun evaluation with corrected evidence, or inspect the blinded packet shown to the assessor.",
    },
  };

  await saveRun(run);
  emit?.({ type: "run_complete", run });
  return run;
}

// ---------------------------------------------------------------------------
// Fact collection — live HTTP for real candidates, fixtures for synthetic.
// Every fact lands as a verification_checks row tagged with its source.
// ---------------------------------------------------------------------------

async function collectProjectFacts(
  candidate: Candidate,
  rows: VerificationCheckRow[],
  record: (entry: AuditEntry) => void,
): Promise<ProjectFacts[]> {
  const started = Date.now();
  let facts: ProjectFacts[];
  let source: "live" | "fixture";

  if (candidate.mode === "synthetic" && candidate.fixtures) {
    facts = candidate.fixtures.projectFacts;
    source = "fixture";
    record({
      ts: new Date().toISOString(),
      stage: "projectVerifier",
      kind: "fixture",
      durationMs: Date.now() - started,
      inputDigest: digest(facts),
      summary: `Synthetic candidate: ${facts.length} pre-baked project fact(s) substituted for live checks.`,
    });
  } else {
    facts = await gatherProjectFacts(candidate);
    source = "live";
    record({
      ts: new Date().toISOString(),
      stage: "projectVerifier",
      kind: "http_check",
      durationMs: Date.now() - started,
      inputDigest: digest(facts),
      summary: `Live checks: ${facts.length} project(s) — HEAD requests + GitHub API.`,
    });
  }

  for (const fact of facts) {
    if (fact.urlCheck) {
      rows.push({
        agent: "projectVerifier",
        kind: "url_liveness",
        source,
        target: fact.urlCheck.url,
        passed: fact.urlCheck.live,
        latencyMs: fact.urlCheck.latencyMs,
        detail: fact.urlCheck,
      });
    }
    if (fact.repo) {
      rows.push({
        agent: "projectVerifier",
        kind: "github_repo",
        source,
        target: fact.repo.repoUrl,
        passed: fact.repo.exists,
        detail: stripSamples(fact.repo),
      });
    }
    if (!fact.urlCheck && !fact.repo) {
      rows.push({
        agent: "projectVerifier",
        kind: "url_liveness",
        source,
        target: fact.projectTitle,
        passed: null,
        detail: { note: "No URL or repository provided to check." },
      });
    }
  }

  return facts;
}

async function collectIdentityFacts(
  candidate: Candidate,
  rows: VerificationCheckRow[],
  record: (entry: AuditEntry) => void,
): Promise<IdentityFacts[]> {
  const started = Date.now();
  let facts: IdentityFacts[];
  let source: "live" | "fixture";

  if (candidate.mode === "synthetic" && candidate.fixtures) {
    facts = candidate.fixtures.identityFacts;
    source = "fixture";
    record({
      ts: new Date().toISOString(),
      stage: "identityVerifier",
      kind: "fixture",
      durationMs: Date.now() - started,
      inputDigest: digest(facts),
      summary: `Synthetic candidate: ${facts.length} pre-baked identity fact(s) substituted for live checks.`,
    });
  } else {
    facts = await gatherIdentityFacts(candidate);
    source = "live";
    record({
      ts: new Date().toISOString(),
      stage: "identityVerifier",
      kind: "http_check",
      durationMs: Date.now() - started,
      inputDigest: digest(facts),
      summary: `Live checks: ${facts.length} identity link(s) resolved and pattern-matched.`,
    });
  }

  for (const fact of facts) {
    rows.push({
      agent: "identityVerifier",
      kind: "identity_link",
      source,
      target: fact.url,
      passed: fact.resolves && fact.domainMatchesKind && fact.handleInUrl,
      detail: fact,
    });
  }

  return facts;
}

// ---------------------------------------------------------------------------

// What the assessor may see of verifier output: token-keyed, no URLs/titles.
function blindVerifierFindings(
  packet: EvaluationRun["blindedPacket"] & object,
  project: Awaited<ReturnType<typeof runProjectVerifier>>["result"],
  identity: Awaited<ReturnType<typeof runIdentityVerifier>>["result"],
): BlindedVerifierFindings {
  return {
    projects: packet.projects.map((blindedProject, index) => {
      const verified = project.projects[index];
      return {
        token: blindedProject.token,
        liveStatus: verified?.liveStatus ?? "no-url",
        codeQualitySignals: verified?.codeQualitySignals ?? [],
        concerns: verified?.concerns ?? [],
      };
    }),
    identitySummary: `${identity.links.filter((l) => l.verdict === "verified").length}/${identity.links.length} candidate links verified as consistent with one identity.`,
  };
}

// Guarantee exactly one score per rubric dimension, in rubric order.
function normalizeAssessor(result: AssessorResult, pass: 1 | 2): AssessorResult {
  const scores: RubricScore[] = RUBRIC.map(({ dimension }) => {
    const score = result.scores.find((item) => item.dimension === dimension);
    if (!score) {
      throw new Error(`evidenceAssessor:${pass} returned no score for ${dimension}`);
    }
    return score;
  });
  return { scores, confidence: result.confidence };
}

function calculateDivergence(passes: AssessorResult[]): DivergenceFlag[] {
  return RUBRIC.map(({ dimension }) => {
    const scoreA = passes[0].scores.find((s) => s.dimension === dimension)?.score ?? 0;
    const scoreB = passes[1].scores.find((s) => s.dimension === dimension)?.score ?? 0;
    return {
      dimension,
      delta: Math.abs(scoreA - scoreB),
      scores: [scoreA, scoreB] as [number, number],
    };
  }).filter((flag) => flag.delta > 1);
}

// Keep verification rows readable — sampled file contents live in the
// agent input, not in the row detail.
function stripSamples(repo: NonNullable<ProjectFacts["repo"]>) {
  const { sampleFiles, ...rest } = repo;
  return { ...rest, sampleFileCount: sampleFiles?.length ?? 0 };
}

function digest(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
