import Link from "next/link";
import { notFound } from "next/navigation";
import { getCandidate } from "@/lib/data";
import { listRuns } from "@/lib/store";
import RunEvaluation from "./run-evaluation";

export const dynamic = "force-dynamic";

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const candidate = await getCandidate(id);
  if (!candidate) notFound();
  const runs = await listRuns(id);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1100px] flex-col gap-8 px-6 py-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="label-caps">Candidate detail</p>
          <h1 className="mt-2 text-[28px] font-semibold">{candidate.pii.name}</h1>
        </div>
        <Link className="btn btn-secondary" href="/">
          Queue
        </Link>
      </header>

      <section className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="surface p-5">
          <div className="flex gap-2">
            <span className={`badge ${candidate.mode === "live" ? "badge-ok" : "badge-warn"}`}>
              {candidate.mode}
            </span>
            <span className="badge badge-accent">blind-scored</span>
          </div>
          <h2 className="mt-5 text-base font-semibold">Evidence submitted</h2>
          <div className="mt-4 grid gap-3">
            {candidate.evidence.map((item) => (
              <article className="bg-surface-2 p-4" key={item.title}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium">{item.title}</h3>
                  <span className="font-mono text-xs uppercase text-text-3">{item.kind}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-text-2">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
        <RunEvaluation candidateId={candidate.id} />
      </section>

      <section className="surface p-5">
        <h2 className="label-caps">Past runs</h2>
        {runs.length === 0 ? (
          <p className="mt-3 text-sm text-text-3">No evaluations yet.</p>
        ) : (
          <div className="mt-4 grid gap-2">
            {runs.map((run) => (
              <Link
                className="flex items-center justify-between gap-4 border border-border p-3 hover:border-border-strong"
                href={`/runs/${run.id}`}
                key={run.id}
              >
                <span className="font-mono text-xs">{run.id}</span>
                <span className="text-xs text-text-2">
                  {new Date(run.startedAt).toLocaleString()}
                </span>
                <span className="flex items-center gap-3">
                  {run.reviewerDecision ? (
                    <span className="badge badge-accent">decided</span>
                  ) : (
                    <span className="badge badge-warn">awaiting decision</span>
                  )}
                  <span className="font-mono text-xs text-text-2">
                    ${run.totalCostUsd.toFixed(4)}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
