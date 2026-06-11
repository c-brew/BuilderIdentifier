import { createHash, randomBytes } from "crypto";
import type { BlindedEvidencePacket, Candidate } from "./types";

export interface BlindingResult {
  packet: BlindedEvidencePacket;
  tokenMap: Record<string, string>;
  inputDigest: string;
}

// Pure function: Candidate → packet with no PII fields. The type makes
// identity unrepresentable; this scrubber additionally removes PII that
// appears INSIDE free text (resume-extracted evidence bodies contain the
// candidate's name, email, and handles).
export function redactCandidate(candidate: Candidate): BlindingResult {
  const scrub = buildScrubber(candidate);
  const suffix = randomBytes(2).toString("hex").toUpperCase();

  const packet: BlindedEvidencePacket = {
    candidateToken: `CAND-${suffix}`,
    projects: candidate.projects.map((project, index) => ({
      token: `project-${index + 1}`,
      description: scrub(project.description),
    })),
    evidence: candidate.evidence.map((evidence, index) => ({
      token: `evidence-${index + 1}`,
      kind: evidence.kind,
      title: scrub(evidence.title),
      body: scrub(evidence.body),
    })),
  };

  const tokenMap: Record<string, string> = {
    [`CAND-${suffix}`]: candidate.pii.name,
  };
  candidate.projects.forEach((project, index) => {
    tokenMap[`project-${index + 1}`] = project.title;
  });
  candidate.evidence.forEach((evidence, index) => {
    tokenMap[`evidence-${index + 1}`] = evidence.title;
  });

  return {
    packet,
    tokenMap,
    inputDigest: createHash("sha256").update(JSON.stringify(packet)).digest("hex"),
  };
}

// Replaces every occurrence of the candidate's name (full + individual parts),
// email (full + local part), and claimed handles with [redacted].
// Longest terms first so "Connor Brewer" is consumed before "Connor".
function buildScrubber(candidate: Candidate): (text: string) => string {
  const terms = new Set<string>();

  const name = candidate.pii.name.trim();
  if (name) terms.add(name);
  for (const part of name.split(/\s+/)) {
    if (part.length >= 3) terms.add(part);
  }

  const email = candidate.pii.email?.trim();
  if (email) {
    terms.add(email);
    const local = email.split("@")[0];
    if (local && local.length >= 3) terms.add(local);
  }

  for (const link of candidate.links) {
    if (link.claimedHandle.length >= 3) terms.add(link.claimedHandle);
  }

  const patterns = [...terms]
    .sort((a, b) => b.length - a.length)
    .map((term) => new RegExp(escapeRegExp(term), "gi"));

  return (text: string) => {
    let out = text;
    for (const pattern of patterns) {
      out = out.replace(pattern, "[redacted]");
    }
    return out;
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
