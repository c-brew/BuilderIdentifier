// The four evaluation agents (ARCHITECTURE.md §4). Each is a single stateless
// callAgent() invocation with its own system prompt — isolated contexts by
// construction. Agents interpret pre-fetched facts; they never fetch.

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { callAgent, type CallAgentResult } from "./anthropic";
import { EVIDENCE_AGING_NOTE, EVIDENCE_PARITY_NOTE, ROLES, rubricFor } from "./rubric";
import type {
  AssessorResult,
  BlindedEvidencePacket,
  IdentityFacts,
  IdentityVerifierResult,
  ProjectFacts,
  ProjectVerifierResult,
  SynthesizerBrief,
  TargetRole,
} from "./types";

const ConfidenceSchema = z.enum(["high", "medium", "low"]);

// ---------------------------------------------------------------------------
// Project Verifier — interprets deterministic project facts (checks.ts)
// ---------------------------------------------------------------------------

const ProjectVerifierSchema = z.object({
  projects: z.array(
    z.object({
      projectTitle: z.string(),
      liveStatus: z.enum(["live", "down", "no-url"]),
      codeQualitySignals: z.array(z.string()),
      concerns: z.array(z.string()),
      summary: z.string(),
    }),
  ),
  overallSummary: z.string(),
  confidence: ConfidenceSchema,
});

const PROJECT_VERIFIER_SYSTEM = `You are the Project Verifier in a candidate-evaluation pipeline.

You receive PRE-FETCHED facts about a candidate's listed projects: URL liveness results, GitHub repository metadata, file trees, and capped source-file samples. You did not fetch anything yourself. Do not assume facts that are not in the input.

The input's currentDateIso is the date the checks ran — treat it as "now" whenever you reason about any date in the input; never rely on your own sense of the current date. Repository facts may include a deterministic "activity" block (daysSinceLastCommit, commitsLast90Days, commitsLast365Days, activitySpanDays) computed at check time. Use those precomputed numbers as-is for any recency or iteration judgment. The commit windows cover only the fetched sample (fetchedCommitCount commits); when sampleCapped is true the window counts are lower bounds, not totals.

For each project report:
- liveStatus: "live" if a URL or repository verifiably responded; "down" if it was checked and failed; "no-url" if nothing was provided to check.
- codeQualitySignals: concrete, observable signals only — structure, tests present, README quality, commit activity and its age (cite the activity numbers), signs of real iteration vs tutorial-following. Quote or reference what you actually see in the samples.
- concerns: factual gaps or contradictions. A project with no repository is NOT inherently a concern — note "non-code evidence" neutrally. Stale activity is a factual observation to report with its numbers, not a character judgment.

You report facts and signals about artifacts. You never score or characterize the person.`;

export function runProjectVerifier(
  facts: ProjectFacts[],
): Promise<CallAgentResult<ProjectVerifierResult>> {
  return callAgent({
    stage: "projectVerifier",
    system: PROJECT_VERIFIER_SYSTEM,
    // currentDateIso anchors "now": without it the model would judge commit
    // ages against its training-era sense of the present.
    input: { currentDateIso: new Date().toISOString(), projects: facts },
    schema: ProjectVerifierSchema,
    summary: "Project artifacts interpreted from pre-fetched checks.",
  });
}

// ---------------------------------------------------------------------------
// Identity Verifier — verification only, no content scoring
// ---------------------------------------------------------------------------

const IdentityVerifierSchema = z.object({
  links: z.array(
    z.object({
      url: z.string(),
      verdict: z.enum(["verified", "unverified", "mismatch"]),
      note: z.string(),
    }),
  ),
  overallSummary: z.string(),
  confidence: ConfidenceSchema,
});

const IDENTITY_VERIFIER_SYSTEM = `You are the Identity Verifier in a candidate-evaluation pipeline.

VERIFICATION ONLY. You must not assess quality, skill, content, or suitability — only whether claimed links are legitimate and consistent with one identity.

You receive deterministic facts per link: whether the server responded, HTTP status, whether the domain matches the claimed platform, and whether the claimed handle appears in the URL.

Verdicts:
- "verified": resolves, domain matches the platform, handle is consistent.
- "unverified": cannot confirm — e.g. anti-bot responses (LinkedIn returns 999/403 to automated checks; that means "cannot confirm", NEVER "fake") or handle not visible.
- "mismatch": the facts contradict the claim (wrong domain, different handle).

Also judge cross-link consistency: do the handles across links plausibly belong to one person? Keep notes strictly factual.`;

export function runIdentityVerifier(
  facts: IdentityFacts[],
): Promise<CallAgentResult<IdentityVerifierResult>> {
  return callAgent({
    stage: "identityVerifier",
    system: IDENTITY_VERIFIER_SYSTEM,
    input: { links: facts },
    schema: IdentityVerifierSchema,
    summary: "Identity links verified for legitimacy and consistency only.",
  });
}

// ---------------------------------------------------------------------------
// Evidence Assessor — blinded input only; runs twice for consistency
// ---------------------------------------------------------------------------

const AssessorSchema = z.object({
  scores: z.array(
    z.object({
      dimension: z.enum([
        "workflow-thinking",
        "end-to-end-ownership",
        "ambiguity",
        "responsible-ai",
      ]),
      score: z.number().int().min(1).max(5),
      citation: z.string(),
      rationale: z.string(),
      confidence: ConfidenceSchema,
    }),
  ),
  confidence: ConfidenceSchema,
});

// What the assessor sees of the verifier outputs: token-keyed findings only,
// no URLs, no titles — nothing that could de-anonymize the packet.
// Activity is the numeric subset of RepoActivity: relative ages and counts
// only, no ISO timestamps — a number can't be searched; a commit date could.
export interface BlindedRepoActivity {
  daysSinceLastCommit?: number;
  commitsLast90Days: number;
  commitsLast365Days: number;
  activitySpanDays?: number;
  sampleCapped: boolean; // window counts are lower bounds when true
}

export interface BlindedVerifierFindings {
  projects: {
    token: string;
    liveStatus: "live" | "down" | "no-url";
    codeQualitySignals: string[];
    concerns: string[];
    // null = no repository was checked for this project (e.g. non-code
    // evidence) — the absence of activity data, never zero activity.
    activity: BlindedRepoActivity | null;
  }[];
  identitySummary: string;
}

// Role-specific system prompt with that role's rubric, marked as a cache
// breakpoint — the consistency re-run (pass 2) reuses the identical prefix.
function assessorSystem(role: TargetRole): Anthropic.Messages.TextBlockParam[] {
  const roleInfo = ROLES[role];
  return [
    {
      type: "text",
      text: `You are the Evidence Assessor in a candidate-evaluation pipeline for the KPMG AI Builder role.

TARGET ROLE: ${roleInfo.label} (${roleInfo.jdRef} of the job description). ${roleInfo.framing}
Calibrate every score to this role's bar — the same evidence can merit different scores against different role expectations.

You receive an ANONYMIZED evidence packet. Names, contact details, schools, and URLs have been removed before you see it; items are referenced by opaque tokens (evidence-1, project-2). This is intentional — do not speculate about identity, and treat [redacted] markers as deliberately removed PII.

Score the evidence against this role's rubric (1–5 per dimension):

${JSON.stringify(rubricFor(role), null, 2)}

${EVIDENCE_PARITY_NOTE}

${EVIDENCE_AGING_NOTE}

The verification findings may include a per-project "activity" block — deterministic commit-recency numbers (daysSinceLastCommit, commit counts over 90/365-day windows) computed in plain code at check time. A null activity block means no repository was checked for that project (common for non-code evidence) and says nothing about the candidate.

Rules:
- Score ONLY from the evidence packet and the verification findings provided. No outside knowledge, no assumptions about what the candidate "probably" did.
- Every score MUST include a citation: a verbatim quote copied exactly from the evidence text (not paraphrased), so a human can find and challenge it.
- Score all four dimensions, each exactly once.
- State per-dimension confidence honestly: thin or ambiguous evidence means low confidence and a middling score, not a generous guess.`,
      cache_control: { type: "ephemeral" },
    },
  ];
}

export function runEvidenceAssessor(
  packet: BlindedEvidencePacket,
  findings: BlindedVerifierFindings,
  pass: 1 | 2,
  role: TargetRole,
): Promise<CallAgentResult<AssessorResult>> {
  return callAgent({
    stage: `evidenceAssessor:${pass}`,
    system: assessorSystem(role),
    input: { evidencePacket: packet, verificationFindings: findings },
    schema: AssessorSchema,
    summary: `Blind evidence scored against the ${ROLES[role].label} rubric (pass ${pass}).`,
    thinking: true,
    maxTokens: 6000,
  });
}

// ---------------------------------------------------------------------------
// Synthesizer — compiles outputs into a reviewer brief; no verdict field exists
// ---------------------------------------------------------------------------

const SynthesizerSchema = z.object({
  brief: z.string(),
  verified: z.array(z.string()),
  notChecked: z.array(z.string()),
  overallConfidence: ConfidenceSchema,
  divergenceCount: z.number().int(),
});

const SYNTHESIZER_SYSTEM = `You compile agent outputs into a brief for a human reviewer who makes the actual decision. The input tells you which target role this evaluation was scored against (Senior Consultant or Manager) — frame the brief against that role's bar and name the role once in the brief.

You MUST NOT produce a hire/no-hire recommendation, a verdict, a ranking, or advice to advance, hold, or decline. Your output is evidence and confidence — the human decides. Refer to the candidate only as "the candidate" (the evaluation is anonymized end to end).

Produce:
- brief: 3–5 sentences. The strongest evidence (reference tokens like [evidence-2] inline), the weakest area, and overall confidence with the reason for it. If the two assessor passes diverged, say so plainly.
- verified: short factual list of what this evaluation actually checked (from the verifier outputs).
- notChecked: what it could not check — at minimum consider: references, education claims, anything behind a login, interview performance. Be honest; this list is shown to the candidate.
- overallConfidence: high only if verification and assessment both support it.
- divergenceCount: copy the divergence count you were given.`;

export interface SynthesizerInput {
  candidateToken: string;
  targetRole: string; // role label + JD reference, e.g. "Manager (Appendix B)"
  roleFraming: string;
  evidenceCount: number;
  projectVerifier: ProjectVerifierResult;
  identityVerifier: IdentityVerifierResult;
  assessorPasses: AssessorResult[];
  divergenceCount: number;
}

export function runSynthesizer(
  input: SynthesizerInput,
): Promise<CallAgentResult<SynthesizerBrief>> {
  return callAgent({
    stage: "synthesizer",
    system: SYNTHESIZER_SYSTEM,
    input,
    schema: SynthesizerSchema,
    summary: "Reviewer-facing brief compiled; schema has no verdict field.",
    thinking: true,
    maxTokens: 4096,
  });
}
