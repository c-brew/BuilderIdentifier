// JD-mapped rubric (ARCHITECTURE.md §7), anchored to the two roles in the
// assignment brief: Senior Consultant (Appendix A) and Manager (Appendix B).
// Same four dimensions for both roles — what changes per role is the JD
// anchor quote and what a 1/3/5 looks like. The reviewer picks the target
// role at run time; the run records which instrument was used. Rendered
// verbatim at /rubric: same instrument for candidates and reviewers.

import type { Dimension, TargetRole } from "./types";

export interface RubricDimension {
  dimension: Dimension;
  label: string;
  anchor: string; // verbatim quote from the role's JD appendix
  levels: { 1: string; 3: string; 5: string };
}

export const ROLES: Record<TargetRole, { label: string; jdRef: string; framing: string }> = {
  "senior-consultant": {
    label: "Senior Consultant",
    jdRef: "Appendix A",
    framing:
      "A hands-on AI Builder who takes ownership of well-scoped internal problems and contributes to building real, agentic solutions end to end.",
  },
  manager: {
    label: "Manager",
    jdRef: "Appendix B",
    framing:
      "Leads the delivery of internal agentic AI initiatives, taking ownership of complex problems and guiding work from experimentation through validated outcomes.",
  },
};

const SENIOR_CONSULTANT_RUBRIC: RubricDimension[] = [
  {
    dimension: "workflow-thinking",
    label: "Workflow thinking",
    anchor:
      "You think in workflows, not just models, designing multi-step processes that account for human-AI handoffs, decision boundaries, and appropriate levels of autonomy.",
    levels: {
      1: "Evidence describes isolated model calls or features; no consideration of how work flows around them.",
      3: "Evidence shows multi-step processes with some attention to where humans intervene or where automation should stop.",
      5: "Evidence demonstrates deliberately designed workflows: explicit handoffs, decision boundaries, and autonomy levels justified against the problem.",
    },
  },
  {
    dimension: "end-to-end-ownership",
    label: "End-to-end ownership",
    anchor:
      "You take end-to-end ownership, from problem definition through to a working system that people actually use.",
    levels: {
      1: "Evidence shows fragments — prototypes or ideas without follow-through to anything used.",
      3: "Evidence shows at least one effort carried from definition to a working state, with gaps in deployment or adoption.",
      5: "Evidence shows full arcs: problem framed, built, shipped, used, and iterated based on real usage.",
    },
  },
  {
    dimension: "ambiguity",
    label: "Operating in ambiguity",
    anchor:
      "You're comfortable operating in ambiguity and understand that enterprise transformation is rarely linear.",
    levels: {
      1: "Evidence only shows execution against fully specified tasks.",
      3: "Evidence shows reasonable assumptions made under unclear requirements, with some justification.",
      5: "Evidence shows the candidate framing the problem itself — deciding what was worth building and adapting as understanding changed.",
    },
  },
  {
    dimension: "responsible-ai",
    label: "Responsible AI",
    anchor:
      "You apply sound judgment, treating risk, governance, ethics, and trust as core design constraints rather than afterthoughts.",
    levels: {
      1: "No evidence that risk, fairness, or trust were considered.",
      3: "Evidence mentions governance or safety considerations, applied after the fact.",
      5: "Evidence shows risk, governance, and trust shaping design decisions from the start, with tradeoffs articulated.",
    },
  },
];

const MANAGER_RUBRIC: RubricDimension[] = [
  {
    dimension: "workflow-thinking",
    label: "Systems & workflow thinking",
    anchor:
      "You think in systems and workflows, not just models, designing and overseeing multi-step processes that incorporate human-AI collaboration, governance boundaries, and appropriate levels of autonomy.",
    levels: {
      1: "Evidence describes isolated model calls or features; no process or system design.",
      3: "Evidence shows well-designed multi-step processes the candidate built themselves, with some governance boundaries.",
      5: "Evidence shows the candidate designing systems others build and operate to: governance boundaries and autonomy levels set deliberately, overseen across more than one workstream.",
    },
  },
  {
    dimension: "end-to-end-ownership",
    label: "End-to-end ownership at scale",
    anchor:
      "You take end-to-end ownership at scale, from shaping problem statements and solution design through to deployment, adoption, and continuous improvement.",
    levels: {
      1: "Evidence shows fragments — contributions to phases of someone else's arc.",
      3: "Evidence shows full ownership of at least one build through deployment, with gaps in adoption, change management, or reuse.",
      5: "Evidence shows shaping the problem statement through deployment, adoption, and continuous improvement — including packaging work so downstream teams start further ahead.",
    },
  },
  {
    dimension: "ambiguity",
    label: "Leading through ambiguity",
    anchor:
      "You are comfortable operating in ambiguity and leading through it, guiding teams and clients through evolving problem spaces while maintaining momentum and clarity on outcomes.",
    levels: {
      1: "Evidence only shows execution against fully specified tasks.",
      3: "Evidence shows sound personal judgment under unclear requirements, with assumptions made explicit.",
      5: "Evidence shows framing evolving problem spaces and carrying others through them — keeping momentum and clarity on outcomes while the ground shifts.",
    },
  },
  {
    dimension: "responsible-ai",
    label: "Responsible AI by design",
    anchor:
      "You embed responsible AI practices by design, ensuring that risk, governance, ethics, and trust are integral to every solution — not afterthoughts.",
    levels: {
      1: "No evidence that risk, fairness, or trust were considered.",
      3: "Evidence shows governance and trust applied to the candidate's own work, sometimes after the fact.",
      5: "Evidence shows risk, governance, and trust built into how solutions are designed AND into how others are coached to build — tradeoffs articulated and taught, appropriate to prototype maturity.",
    },
  },
];

const RUBRIC_BY_ROLE: Record<TargetRole, RubricDimension[]> = {
  "senior-consultant": SENIOR_CONSULTANT_RUBRIC,
  manager: MANAGER_RUBRIC,
};

export function rubricFor(role: TargetRole): RubricDimension[] {
  return RUBRIC_BY_ROLE[role];
}

export const TARGET_ROLES = Object.keys(ROLES) as TargetRole[];

// Equal-footing rule, included verbatim in the assessor's system prompt:
export const EVIDENCE_PARITY_NOTE =
  "Evidence kind must not affect scoring. Demos, writeups, and case studies score on equal footing with code: the dimensions measure thinking and ownership, not programming-language fluency. Score what the evidence demonstrates, not the format it arrives in.";
