// The contracts everything codes against (ARCHITECTURE.md §5).

export type EvidenceKind = "code" | "demo" | "writeup" | "case-study";
export type LinkKind = "github" | "linkedin" | "portfolio" | "other";
export type Confidence = "high" | "medium" | "low";
export type Dimension =
  | "workflow-thinking"
  | "end-to-end-ownership"
  | "ambiguity"
  | "responsible-ai";

export type AgentName =
  | "intakeExtractor"
  | "projectVerifier"
  | "evidenceAssessor"
  | "identityVerifier"
  | "synthesizer";

// ---------------------------------------------------------------------------
// Candidate
// ---------------------------------------------------------------------------

export interface CandidatePII {
  name: string;
  email?: string;
  education: string[];
  resumePath?: string;
}

export interface CandidateLink {
  kind: LinkKind;
  url: string;
  claimedHandle: string;
}

export interface CandidateProject {
  title: string;
  description: string;
  url?: string;
  repoUrl?: string;
}

export interface CandidateEvidence {
  kind: EvidenceKind;
  title: string;
  body: string;
  url?: string;
}

export interface Candidate {
  id: string;
  mode: "live" | "synthetic";
  source: "resume" | "seed";
  // PII exists ONLY here — stripped by blind.ts before assessment.
  pii: CandidatePII;
  links: CandidateLink[];
  projects: CandidateProject[];
  evidence: CandidateEvidence[];
  fixtures?: FixtureBlock;
}

// ---------------------------------------------------------------------------
// Deterministic check facts (checks.ts output — never produced by an LLM)
// ---------------------------------------------------------------------------

export interface UrlCheck {
  url: string;
  live: boolean;
  status: number | null;
  latencyMs: number;
}

export interface RepoFacts {
  repoUrl: string;
  exists: boolean;
  description?: string;
  language?: string;
  recentCommitCount?: number;
  lastCommitIso?: string;
  readmePresent?: boolean;
  fileTree?: string[];
  sampleFiles?: { path: string; content: string }[];
}

export interface ProjectFacts {
  projectTitle: string;
  urlCheck?: UrlCheck;
  repo?: RepoFacts;
}

export interface IdentityFacts {
  kind: LinkKind;
  url: string;
  claimedHandle: string;
  resolves: boolean;
  status: number | null;
  domainMatchesKind: boolean;
  handleInUrl: boolean;
}

// Synthetic candidates carry pre-baked facts so fake URLs are never fetched.
export interface FixtureBlock {
  projectFacts: ProjectFacts[];
  identityFacts: IdentityFacts[];
}

// ---------------------------------------------------------------------------
// Blinding
// ---------------------------------------------------------------------------

// No PII fields exist on this type — unrepresentable, not just removed.
export interface BlindedEvidencePacket {
  candidateToken: string;
  projects: { token: string; description: string }[];
  evidence: { token: string; kind: EvidenceKind; title: string; body: string }[];
}

// ---------------------------------------------------------------------------
// Agent results (zod schemas live with each agent; these are the TS shapes)
// ---------------------------------------------------------------------------

export interface ProjectVerifierResult {
  projects: {
    projectTitle: string;
    liveStatus: "live" | "down" | "no-url";
    codeQualitySignals: string[];
    concerns: string[];
    summary: string;
  }[];
  overallSummary: string;
  confidence: Confidence;
}

export interface IdentityVerifierResult {
  links: {
    url: string;
    verdict: "verified" | "unverified" | "mismatch";
    note: string;
  }[];
  overallSummary: string;
  confidence: Confidence;
}

export interface RubricScore {
  dimension: Dimension;
  score: number; // 1–5, enforced by zod + DB CHECK
  citation: string; // verbatim quote from blinded evidence
  rationale: string;
  confidence: Confidence;
}

export interface AssessorResult {
  scores: RubricScore[];
  confidence: Confidence;
}

export interface SynthesizerBrief {
  brief: string;
  verified: string[];
  notChecked: string[];
  overallConfidence: Confidence;
  divergenceCount: number;
}

export interface DivergenceFlag {
  dimension: Dimension;
  delta: number;
  scores: [number, number]; // [pass1, pass2]
}

// ---------------------------------------------------------------------------
// Audit + run
// ---------------------------------------------------------------------------

export type AuditKind =
  | "llm_call"
  | "http_check"
  | "blinding"
  | "fixture"
  | "intake"
  | "reviewer_action";

export interface AuditEntry {
  ts: string;
  stage: string;
  kind: AuditKind;
  model?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  costUsd?: number;
  durationMs: number;
  inputDigest?: string; // sha256 of the exact input — reproducibility claim
  summary: string;
}

export interface VerificationCheckRow {
  agent: "projectVerifier" | "identityVerifier";
  kind: "url_liveness" | "github_repo" | "identity_link";
  source: "live" | "fixture";
  target: string;
  passed: boolean | null;
  latencyMs?: number;
  detail: unknown;
}

export interface AgentOutputRecord {
  agent: AgentName;
  pass: 1 | 2;
  confidence: Confidence;
  result: unknown;
}

export interface ReviewerDecision {
  runId: string;
  ts: string;
  decision: "advance" | "hold" | "decline";
  rationale: string;
  reviewerName?: string;
}

export interface TransparencySummary {
  checked: string[];
  notChecked: string[];
  howToContest: string;
}

export interface EvaluationRun {
  id: string;
  candidateId: string;
  candidateName?: string; // joined in by the API — blinding is model-facing only
  status: "running" | "complete" | "error";
  model: string;
  pricingVersion: string;
  scorecard: {
    passes: { pass: 1 | 2; scores: RubricScore[] }[];
    divergence: DivergenceFlag[];
    synthesis: SynthesizerBrief | null;
  };
  agentOutputs: AgentOutputRecord[];
  verificationChecks: VerificationCheckRow[];
  blindedPacket: BlindedEvidencePacket | null;
  tokenMap: Record<string, string>; // never enters any LLM input
  auditLog: AuditEntry[];
  totalCostUsd: number;
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
  reviewerDecision?: ReviewerDecision;
  transparencySummary?: TransparencySummary;
}

// ---------------------------------------------------------------------------
// NDJSON stream events (/api/evaluate)
// ---------------------------------------------------------------------------

export type StreamEvent =
  | { type: "run_started"; runId: string; candidateId: string }
  | { type: "stage_start"; stage: string }
  | { type: "stage_complete"; stage: string; summary: string }
  | { type: "audit"; entry: AuditEntry }
  | { type: "run_complete"; run: EvaluationRun }
  | { type: "run_error"; runId: string; error: string; auditLog: AuditEntry[] };
