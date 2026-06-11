import Link from "next/link";
import { notFound } from "next/navigation";
import { getCandidate } from "@/lib/data";
import RunEvaluation from "./run-evaluation";

export const dynamic = "force-dynamic";

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const candidate = await getCandidate(id);
  if (!candidate) notFound();

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
    </main>
  );
}
