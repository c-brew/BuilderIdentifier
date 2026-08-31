// Deterministic verification (ARCHITECTURE.md §4, stage 1a/1b).
// Plain HTTP — no LLM ever fetches anything. Every result is a reproducible
// fact that gets row-logged in verification_checks and fed to the verifier
// agents as pre-fetched input.

import type {
  Candidate,
  CandidateLink,
  IdentityFacts,
  LinkKind,
  ProjectFacts,
  RepoActivity,
  RepoFacts,
  UrlCheck,
} from "./types";

const TIMEOUT_MS = 6000;
const COMMIT_SAMPLE_SIZE = 30; // GitHub /commits page size — bounds every window count
const SAMPLE_FILE_CAP = 6000; // chars per sampled source file
const BASE_HEADERS = {
  "User-Agent": "ai-builder-evaluator/0.1 (candidate-assessment demo)",
};

export async function checkUrlLiveness(url: string): Promise<UrlCheck> {
  const started = Date.now();
  try {
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: BASE_HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Some servers reject HEAD; retry once with GET before declaring it down.
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        headers: BASE_HEADERS,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    }
    return { url, live: res.ok, status: res.status, latencyMs: Date.now() - started };
  } catch {
    return { url, live: false, status: null, latencyMs: Date.now() - started };
  }
}

export async function fetchRepoFacts(repoUrl: string): Promise<RepoFacts> {
  const parsed = parseGithubUrl(repoUrl);
  if (!parsed) return { repoUrl, exists: false };

  const api = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
  const headers = { ...BASE_HEADERS, Accept: "application/vnd.github+json" };

  const meta = await getJson<{ description?: string; language?: string }>(api, headers);
  if (!meta) return { repoUrl, exists: false };

  const [commits, contents, readme] = await Promise.all([
    getJson<
      { commit?: { author?: { date?: string }; committer?: { date?: string } } }[]
    >(`${api}/commits?per_page=${COMMIT_SAMPLE_SIZE}`, headers),
    getJson<{ name: string; type: string; download_url: string | null }[]>(
      `${api}/contents`,
      headers,
    ),
    getJson<{ content?: string }>(`${api}/readme`, headers),
  ]);

  const fileTree = (contents ?? []).map((f) =>
    f.type === "dir" ? `${f.name}/` : f.name,
  );

  const sampleFiles: { path: string; content: string }[] = [];
  if (readme?.content) {
    sampleFiles.push({
      path: "README.md",
      content: cap(Buffer.from(readme.content, "base64").toString("utf8")),
    });
  }
  for (const file of pickSourceFiles(contents ?? [])) {
    const body = await getText(file.download_url!, headers);
    if (body) sampleFiles.push({ path: file.name, content: cap(body) });
  }

  // Committer date over author date: rebases preserve author dates, so only
  // the committer date says when a commit actually landed on the branch.
  const commitDatesIso = (commits ?? []).map(
    (c) => c.commit?.committer?.date ?? c.commit?.author?.date,
  );

  return {
    repoUrl,
    exists: true,
    description: meta.description ?? undefined,
    language: meta.language ?? undefined,
    activity:
      commits === null
        ? undefined // commits endpoint failed — absence of data, not zero activity
        : computeRepoActivity(commitDatesIso, new Date(), COMMIT_SAMPLE_SIZE),
    readmePresent: Boolean(readme?.content),
    fileTree,
    sampleFiles,
  };
}

// Pure and order-independent: ages come from max/min over the parsed dates,
// never from assuming the API returned newest-first. Future-dated commits
// (clock skew, imported history) clamp to age 0 rather than going negative.
export function computeRepoActivity(
  commitDatesIso: (string | undefined)[],
  checkedAt: Date,
  sampleCap: number,
): RepoActivity {
  const times = commitDatesIso
    .map((iso) => (iso ? new Date(iso).getTime() : NaN))
    .filter((t) => Number.isFinite(t));

  const now = checkedAt.getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const inWindow = (t: number, days: number) => t >= now - days * DAY_MS && t <= now;

  const activity: RepoActivity = {
    checkedAtIso: checkedAt.toISOString(),
    fetchedCommitCount: commitDatesIso.length,
    sampleCapped: commitDatesIso.length >= sampleCap,
    commitsLast90Days: times.filter((t) => inWindow(t, 90)).length,
    commitsLast365Days: times.filter((t) => inWindow(t, 365)).length,
  };

  if (times.length > 0) {
    const newest = Math.max(...times);
    const oldest = Math.min(...times);
    activity.lastCommitIso = new Date(newest).toISOString();
    activity.oldestFetchedCommitIso = new Date(oldest).toISOString();
    activity.daysSinceLastCommit = Math.max(0, Math.floor((now - newest) / DAY_MS));
    activity.activitySpanDays = Math.floor((newest - oldest) / DAY_MS);
  }

  return activity;
}

export async function gatherProjectFacts(candidate: Candidate): Promise<ProjectFacts[]> {
  return Promise.all(
    candidate.projects.map(async (project): Promise<ProjectFacts> => {
      const [urlCheck, repo] = await Promise.all([
        project.url ? checkUrlLiveness(project.url) : Promise.resolve(undefined),
        project.repoUrl ? fetchRepoFacts(project.repoUrl) : Promise.resolve(undefined),
      ]);
      return { projectTitle: project.title, urlCheck, repo };
    }),
  );
}

const PLATFORM_HOSTS: Record<LinkKind, RegExp | null> = {
  github: /(^|\.)github\.com$/i,
  linkedin: /(^|\.)linkedin\.com$/i,
  portfolio: null, // any host can be a portfolio
  other: null,
};

export async function checkIdentityLink(link: CandidateLink): Promise<IdentityFacts> {
  const check = await checkUrlLiveness(link.url);
  let domainMatchesKind = true;
  let handleInUrl = false;
  try {
    const parsed = new URL(link.url);
    const pattern = PLATFORM_HOSTS[link.kind];
    domainMatchesKind = pattern ? pattern.test(parsed.hostname) : true;
    handleInUrl = parsed.href.toLowerCase().includes(link.claimedHandle.toLowerCase());
  } catch {
    domainMatchesKind = false;
  }
  return {
    kind: link.kind,
    url: link.url,
    claimedHandle: link.claimedHandle,
    // "resolves" = the server answered. Anti-bot responses (LinkedIn 999/403)
    // count as resolving but not as a verified profile — the verifier agent
    // is instructed to read them as "cannot confirm", never "fake".
    resolves: check.status !== null && check.status < 500,
    status: check.status,
    domainMatchesKind,
    handleInUrl,
  };
}

export async function gatherIdentityFacts(candidate: Candidate): Promise<IdentityFacts[]> {
  return Promise.all(candidate.links.map(checkIdentityLink));
}

// ---------------------------------------------------------------------------

function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)github\.com$/i.test(parsed.hostname)) return null;
    const [owner, repo] = parsed.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return null;
    return { owner, repo: repo.replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

function pickSourceFiles(
  contents: { name: string; type: string; download_url: string | null }[],
): { name: string; download_url: string | null }[] {
  const SOURCE_EXT = /\.(ts|tsx|js|jsx|py|go|rs|java|rb|sql|sh)$/i;
  return contents
    .filter((f) => f.type === "file" && SOURCE_EXT.test(f.name) && f.download_url)
    .slice(0, 2);
}

async function getJson<T>(url: string, headers: Record<string, string>): Promise<T | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function getText(
  url: string,
  headers: Record<string, string>,
): Promise<string | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function cap(text: string): string {
  return text.length <= SAMPLE_FILE_CAP ? text : `${text.slice(0, SAMPLE_FILE_CAP)}\n…[truncated]`;
}
