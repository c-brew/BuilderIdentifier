import Link from "next/link";
import { EST_COST_PER_RUN, MODEL_ID } from "@/lib/config";
import { listCandidates } from "@/lib/data";
import UploadResume from "./upload-resume";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const candidates = await listCandidates();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1100px] flex-col gap-8 px-6 py-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="label-caps">Candidate queue</p>
          <h1 className="mt-2 text-[28px] font-semibold tracking-normal">AI Builder Evaluator</h1>
        </div>
        <div className="flex gap-2">
          <Link className="btn btn-secondary" href="/rubric">
            View rubric
          </Link>
        </div>
      </header>

      <div className="governance">
        MODEL {MODEL_ID} · BLIND-SCORED · {EST_COST_PER_RUN}/RUN · RECOMMENDS, NEVER DECIDES
      </div>

      <UploadResume />

      <section className="flex flex-col gap-3">
        {candidates.map((candidate) => (
          <article className="surface flex items-center justify-between gap-5 p-5" key={candidate.id}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold">{candidate.pii.name}</h2>
                <span className={`badge ${candidate.mode === "live" ? "badge-ok" : "badge-warn"}`}>
                  {candidate.mode}
                </span>
                <span className="badge badge-accent">{candidate.source}</span>
              </div>
              <p className="mt-2 text-sm text-text-2">
                {candidate.projects.length} project{candidate.projects.length === 1 ? "" : "s"} ·{" "}
                {candidate.evidence.length} evidence item{candidate.evidence.length === 1 ? "" : "s"} ·{" "}
                {candidate.links.length} link{candidate.links.length === 1 ? "" : "s"}
              </p>
            </div>
            <Link className="btn btn-secondary shrink-0" href={`/candidates/${candidate.id}`}>
              Run evaluation
            </Link>
          </article>
        ))}
      </section>
    </main>
  );
}
