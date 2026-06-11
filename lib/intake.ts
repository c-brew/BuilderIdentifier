import { createHash } from "crypto";
import { saveCandidate } from "./data";
import type {
  Candidate,
  CandidateEvidence,
  CandidateLink,
  CandidateProject,
  EvidenceKind,
  LinkKind,
} from "./types";

const URL_RE = /https?:\/\/[^\s)>,]+/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export async function ingestResume(file: File): Promise<Candidate> {
  const text = await extractDocumentText(file);
  if (text.length < 120) {
    throw new Error("Could not read enough text from the uploaded document.");
  }

  const candidate = candidateFromText(text, file.name);
  return saveCandidate(candidate);
}

async function extractDocumentText(file: File): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    // unpdf ships a serverless-friendly pdfjs build (no canvas, no external
    // worker files for Vercel's tracer to miss) — pdf-parse crashed in the
    // lambda reaching for @napi-rs/canvas even though it worked locally.
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return normalizeText(text);
  }

  if (
    file.type.startsWith("text/") ||
    name.endsWith(".txt") ||
    name.endsWith(".md")
  ) {
    return normalizeText(bytes.toString("utf8"));
  }

  throw new Error("Upload a readable PDF, TXT, or Markdown resume.");
}

function candidateFromText(text: string, filename: string): Candidate {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const email = text.match(EMAIL_RE)?.[0];
  const name = inferName(lines, filename);
  const urls = Array.from(new Set(text.match(URL_RE) ?? [])).slice(0, 8);
  const links = urls.map(urlToLink);
  const projects = inferProjects(lines, urls);
  const evidence = inferEvidence(text);
  const id = uniqueSlug(name, email ?? filename);

  return {
    id,
    mode: "live",
    source: "resume",
    pii: {
      name,
      email,
      education: inferEducation(lines),
      resumePath: filename,
    },
    links,
    projects,
    evidence,
  };
}

function inferName(lines: string[], filename: string): string {
  const candidate = lines.find((line) => {
    const words = line.split(/\s+/);
    return (
      words.length >= 2 &&
      words.length <= 5 &&
      !line.includes("@") &&
      !line.match(URL_RE) &&
      !/resume|curriculum|github|linkedin|portfolio/i.test(line)
    );
  });

  return candidate ?? titleCase(filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
}

function inferEducation(lines: string[]): string[] {
  const educationIndex = lines.findIndex((line) => /education/i.test(line));
  if (educationIndex === -1) return [];
  return lines.slice(educationIndex + 1, educationIndex + 5).filter((line) =>
    /university|college|school|bachelor|master|degree|diploma|cert/i.test(line),
  );
}

function inferProjects(lines: string[], urls: string[]): CandidateProject[] {
  const projectLines = lines.filter((line) =>
    /project|built|created|developed|launched|designed|implemented|prototype/i.test(line),
  );

  const projects = projectLines.slice(0, 4).map((line, index) => {
    const url = urls[index];
    return {
      title: inferProjectTitle(line, index + 1),
      description: truncate(line, 360),
      url,
      repoUrl: url && /github\.com/i.test(url) ? url : undefined,
    };
  });

  if (projects.length) return projects;

  return [
    {
      title: "Resume evidence",
      description: truncate(lines.slice(0, 8).join(" "), 360),
      url: urls[0],
      repoUrl: urls.find((url) => /github\.com/i.test(url)),
    },
  ];
}

function inferEvidence(text: string): CandidateEvidence[] {
  const sections = splitSections(text);
  const evidence = sections
    .filter((section) => section.body.length > 80)
    .slice(0, 6)
    .map((section): CandidateEvidence => ({
      kind: inferEvidenceKind(section.title, section.body),
      title: section.title,
      body: truncate(section.body, 720),
    }));

  if (evidence.length) return evidence;

  return [
    {
      kind: "writeup",
      title: "Resume excerpt",
      body: truncate(text, 720),
    },
  ];
}

function splitSections(text: string): { title: string; body: string }[] {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const sections: { title: string; body: string[] }[] = [];
  let current: { title: string; body: string[] } = { title: "Resume summary", body: [] };

  for (const line of lines) {
    const isHeading =
      line.length <= 48 &&
      /^[A-Za-z][A-Za-z &/+-]+$/.test(line) &&
      /experience|project|work|summary|skills|education|leadership|portfolio/i.test(line);

    if (isHeading && current.body.length) {
      sections.push(current);
      current = { title: titleCase(line), body: [] };
    } else {
      current.body.push(line);
    }
  }

  if (current.body.length) sections.push(current);
  return sections.map((section) => ({
    title: section.title,
    body: section.body.join(" "),
  }));
}

function inferEvidenceKind(title: string, body: string): EvidenceKind {
  const source = `${title} ${body}`;
  if (/github|repo|code|typescript|python|sql|api|component/i.test(source)) return "code";
  if (/demo|prototype|launched|deployed|user|pilot/i.test(source)) return "demo";
  if (/case|client|stakeholder|outcome|impact|workflow/i.test(source)) return "case-study";
  return "writeup";
}

function urlToLink(url: string): CandidateLink {
  const kind: LinkKind = /github\.com/i.test(url)
    ? "github"
    : /linkedin\.com/i.test(url)
      ? "linkedin"
      : /portfolio|vercel|netlify|github\.io/i.test(url)
        ? "portfolio"
        : "other";
  return {
    kind,
    url,
    claimedHandle: handleFromUrl(url),
  };
}

function handleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean)[0] ?? parsed.hostname;
  } catch {
    return url;
  }
}

function inferProjectTitle(line: string, fallback: number): string {
  const cleaned = line.replace(/^[-*•\d. ]+/, "").trim();
  const beforeDash = cleaned.split(/\s[-–—:]\s/)[0];
  return titleCase(truncate(beforeDash || `Project ${fallback}`, 64));
}

function uniqueSlug(name: string, seed: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const hash = createHash("sha1").update(seed).digest("hex").slice(0, 6);
  return `${base || "candidate"}-${hash}`;
}

function normalizeText(text: string): string {
  return text.replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trim()}...`;
}
