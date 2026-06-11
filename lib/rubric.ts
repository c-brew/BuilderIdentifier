// JD-mapped rubric (ARCHITECTURE.md §7). Data, not prose — each dimension
// carries its JD anchor so citations trace to source material. Rendered
// verbatim at /rubric: same instrument for candidates and reviewers.

import type { Dimension } from "./types";

export interface RubricDimension {
  dimension: Dimension;
  label: string;
  anchor: string; // quote from the AI Builder JD (Appendix A)
  levels: { 1: string; 3: string; 5: string };
}

export const RUBRIC: RubricDimension[] = [
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

// Equal-footing rule, included verbatim in the assessor's system prompt:
export const EVIDENCE_PARITY_NOTE =
  "Evidence kind must not affect scoring. Demos, writeups, and case studies score on equal footing with code: the dimensions measure thinking and ownership, not programming-language fluency. Score what the evidence demonstrates, not the format it arrives in.";
