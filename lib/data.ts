import { supabaseAdmin } from "./supabase";
import type {
  Candidate,
  CandidateEvidence,
  CandidateLink,
  CandidateProject,
  LinkKind,
} from "./types";

export const CANDIDATES: Candidate[] = [
  {
    id: "connor-brewer",
    mode: "live",
    source: "seed",
    pii: {
      name: "Connor Brewer",
      email: "connor.brewer@icloud.com",
      education: ["Resume-imported education quarantined from model scoring"],
    },
    links: [
      {
        kind: "github",
        url: "https://github.com/connorbrew",
        claimedHandle: "connorbrew",
      },
      {
        kind: "linkedin",
        url: "https://www.linkedin.com/in/connorbrewer",
        claimedHandle: "connorbrewer",
      },
    ],
    projects: [
      {
        title: "AI Builder Evaluator",
        description:
          "A multi-agent evaluator that separates identity checks, blinded evidence scoring, and human reviewer decision capture.",
        repoUrl: "https://github.com/connorbrew/ai-builder-evaluator",
      },
      {
        title: "Operational AI Workflow",
        description:
          "A prototype for moving ambiguous intake requests through extraction, validation, review, and audit logging.",
      },
    ],
    evidence: [
      {
        kind: "case-study",
        title: "Governance as product structure",
        body:
          "I designed the workflow so the model can recommend evidence but cannot record a decision. Reviewer rationale is required and stored separately from the scoring pipeline.",
      },
      {
        kind: "writeup",
        title: "Ambiguity handling",
        body:
          "The first step was narrowing a vague hiring brief into a rubric, explicit decision boundaries, and inspectable artifacts a reviewer could challenge.",
      },
      {
        kind: "code",
        title: "Blinded evidence packet",
        body:
          "PII is removed before assessment. The assessor receives opaque evidence tokens, project descriptions, and cited evidence only.",
      },
    ],
  },
  {
    id: "synth-designer",
    mode: "synthetic",
    source: "seed",
    pii: {
      name: "Maya Chen",
      education: ["Synthetic University"],
    },
    links: [
      {
        kind: "portfolio",
        url: "https://example.com/maya-ai-ops",
        claimedHandle: "maya-ai-ops",
      },
    ],
    projects: [
      {
        title: "Claims Intake Copilot",
        description:
          "A no-code workflow prototype that triages support claims, flags uncertainty, and routes edge cases to specialists.",
        url: "https://example.com/claims-copilot",
      },
    ],
    evidence: [
      {
        kind: "demo",
        title: "Human handoff demo",
        body:
          "The demo pauses automation when policy confidence drops below threshold and asks an adjuster to approve the next action.",
      },
      {
        kind: "case-study",
        title: "Pilot iteration",
        body:
          "After three pilot sessions, the intake form was rewritten because reviewers needed source excerpts beside each generated summary.",
      },
    ],
    fixtures: {
      projectFacts: [
        {
          projectTitle: "Claims Intake Copilot",
          urlCheck: {
            url: "https://example.com/claims-copilot",
            live: true,
            status: 200,
            latencyMs: 94,
          },
        },
      ],
      identityFacts: [
        {
          kind: "portfolio",
          url: "https://example.com/maya-ai-ops",
          claimedHandle: "maya-ai-ops",
          resolves: true,
          status: 200,
          domainMatchesKind: true,
          handleInUrl: true,
        },
      ],
    },
  },
  {
    id: "synth-weak",
    mode: "synthetic",
    source: "seed",
    pii: {
      name: "Jordan Lee",
      education: ["Synthetic College"],
    },
    links: [
      {
        kind: "github",
        url: "https://example.com/jordan-template",
        claimedHandle: "jordan-template",
      },
    ],
    projects: [
      {
        title: "Chatbot Tutorial",
        description:
          "A simple chatbot built from a starter tutorial with limited explanation of users, risks, or deployment.",
      },
    ],
    evidence: [
      {
        kind: "code",
        title: "Starter implementation",
        body:
          "I followed a tutorial to connect a chat UI to an LLM endpoint. Future work would add logging and evaluation.",
      },
    ],
    fixtures: {
      projectFacts: [
        {
          projectTitle: "Chatbot Tutorial",
          urlCheck: {
            url: "https://example.com/jordan-template",
            live: false,
            status: 404,
            latencyMs: 87,
          },
        },
      ],
      identityFacts: [
        {
          kind: "github",
          url: "https://example.com/jordan-template",
          claimedHandle: "jordan-template",
          resolves: false,
          status: 404,
          domainMatchesKind: false,
          handleInUrl: true,
        },
      ],
    },
  },
];

export async function listCandidates(): Promise<Candidate[]> {
  const stored = await listStoredCandidates();
  const knownIds = new Set(stored.map((candidate) => candidate.id));
  return [...stored, ...CANDIDATES.filter((candidate) => !knownIds.has(candidate.id))];
}

export async function getCandidate(id: string): Promise<Candidate | undefined> {
  return (await getStoredCandidate(id)) ?? CANDIDATES.find((candidate) => candidate.id === id);
}

export async function saveCandidate(candidate: Candidate): Promise<Candidate> {
  const supabase = supabaseAdmin();

  await must(
    supabase.from("candidates").upsert({
      id: candidate.id,
      mode: candidate.mode,
      source: candidate.source,
    }),
  );
  await must(
    supabase.from("candidate_pii").upsert({
      candidate_id: candidate.id,
      name: candidate.pii.name,
      email: candidate.pii.email ?? null,
      education: candidate.pii.education,
      resume_path: candidate.pii.resumePath ?? null,
    }),
  );

  await Promise.all([
    must(supabase.from("candidate_links").delete().eq("candidate_id", candidate.id)),
    must(supabase.from("candidate_projects").delete().eq("candidate_id", candidate.id)),
    must(supabase.from("candidate_evidence").delete().eq("candidate_id", candidate.id)),
  ]);

  if (candidate.links.length) {
    await must(
      supabase.from("candidate_links").insert(
        candidate.links.map((link) => ({
          candidate_id: candidate.id,
          kind: link.kind,
          url: link.url,
          claimed_handle: link.claimedHandle,
        })),
      ),
    );
  }

  if (candidate.projects.length) {
    await must(
      supabase.from("candidate_projects").insert(
        candidate.projects.map((project) => ({
          candidate_id: candidate.id,
          title: project.title,
          description: project.description,
          url: project.url ?? null,
          repo_url: project.repoUrl ?? null,
        })),
      ),
    );
  }

  if (candidate.evidence.length) {
    await must(
      supabase.from("candidate_evidence").insert(
        candidate.evidence.map((evidence) => ({
          candidate_id: candidate.id,
          kind: evidence.kind,
          title: evidence.title,
          body: evidence.body,
          url: evidence.url ?? null,
        })),
      ),
    );
  }

  return candidate;
}

async function listStoredCandidates(): Promise<Candidate[]> {
  try {
    const supabase = supabaseAdmin();
    const { data, error } = await supabase
      .from("candidates")
      .select("id")
      .order("created_at", { ascending: false });
    if (error) throw error;
    const candidates = await Promise.all(
      (data ?? []).map((row: { id: string }) => getStoredCandidate(row.id)),
    );
    return candidates.filter(Boolean) as Candidate[];
  } catch {
    return [];
  }
}

async function getStoredCandidate(id: string): Promise<Candidate | undefined> {
  try {
    const supabase = supabaseAdmin();
    const [candidate, pii, links, projects, evidence] = await Promise.all([
      mustData(
        supabase
          .from("candidates")
          .select("id, mode, source")
          .eq("id", id)
          .maybeSingle(),
      ),
      mustData(
        supabase
          .from("candidate_pii")
          .select("name, email, education, resume_path")
          .eq("candidate_id", id)
          .maybeSingle(),
      ),
      mustData(supabase.from("candidate_links").select("*").eq("candidate_id", id)),
      mustData(supabase.from("candidate_projects").select("*").eq("candidate_id", id)),
      mustData(supabase.from("candidate_evidence").select("*").eq("candidate_id", id)),
    ]);

    if (!candidate || !pii) return undefined;

    return {
      id: (candidate as any).id,
      mode: (candidate as any).mode,
      source: (candidate as any).source,
      pii: {
        name: (pii as any).name,
        email: (pii as any).email ?? undefined,
        education: Array.isArray((pii as any).education) ? (pii as any).education : [],
        resumePath: (pii as any).resume_path ?? undefined,
      },
      links: ((links ?? []) as any[]).map(
        (link): CandidateLink => ({
          kind: link.kind as LinkKind,
          url: link.url,
          claimedHandle: link.claimed_handle,
        }),
      ),
      projects: ((projects ?? []) as any[]).map(
        (project): CandidateProject => ({
          title: project.title,
          description: project.description,
          url: project.url ?? undefined,
          repoUrl: project.repo_url ?? undefined,
        }),
      ),
      evidence: ((evidence ?? []) as any[]).map(
        (item): CandidateEvidence => ({
          kind: item.kind,
          title: item.title,
          body: item.body,
          url: item.url ?? undefined,
        }),
      ),
    };
  } catch {
    return undefined;
  }
}

async function must(query: PromiseLike<{ error: unknown }>): Promise<void> {
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
