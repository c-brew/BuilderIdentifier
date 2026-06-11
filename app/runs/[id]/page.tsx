import { notFound } from "next/navigation";
import { getRun } from "@/lib/store";
import { ROLES, rubricFor } from "@/lib/rubric";
import DecisionForm from "./decision-form";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) notFound();
  const synthesis = run.scorecard.synthesis;
  const firstPass = run.scorecard.passes[0]?.scores ?? [];
  const rubric = rubricFor(run.targetRole);
  const role = ROLES[run.targetRole];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1100px] flex-col gap-8 px-6 py-8">
      <header>
        <p className="label-caps">Scorecard · {role.label}</p>
        <h1 className="mt-2 text-[28px] font-semibold">{run.candidateName}</h1>
        <p className="mt-2 font-mono text-xs text-text-3">
          {run.id} · {run.model} · scored against {role.label} ({role.jdRef}) · $
          {run.totalCostUsd.toFixed(4)}
        </p>
      </header>

      {synthesis ? (
        <section className="surface border-l-[3px] border-l-ai p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="label-caps text-ai">AI request · reviewer decision required</p>
            <span className="badge badge-ai">AI</span>
          </div>
          <p className="mt-5 leading-7 text-text">{synthesis.brief}</p>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <div>
              <h2 className="label-caps">What was verified</h2>
              <ul className="mt-3 grid gap-2 text-sm text-text-2">
                {synthesis.verified.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="label-caps">What was not checked</h2>
              <ul className="mt-3 grid gap-2 text-sm text-text-2">
                {synthesis.notChecked.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-6 border-t border-border pt-5">
            <DecisionForm initialRun={run} />
          </div>
        </section>
      ) : null}

      <section className="grid gap-4">
        {firstPass.map((score) => {
          const dimension = rubric.find((item) => item.dimension === score.dimension);
          const divergence = run.scorecard.divergence.find((item) => item.dimension === score.dimension);
          return (
            <article className="surface p-5" key={score.dimension}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{dimension?.label ?? score.dimension}</h2>
                  <p className="mt-2 text-sm italic text-text-2">{dimension?.anchor}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-xl">{score.score} / 5</p>
                  <p className="font-mono text-xs uppercase text-text-3">{score.confidence}</p>
                </div>
              </div>
              <blockquote className="mt-5 border-l-2 border-ai bg-surface-2 p-4 text-sm leading-6 text-text-2">
                {score.citation}
              </blockquote>
              <p className="mt-4 text-sm text-text-2">{score.rationale}</p>
              {divergence ? (
                <span className="badge badge-warn mt-4 inline-block">
                  divergent {divergence.scores[0]} / {divergence.scores[1]}
                </span>
              ) : null}
            </article>
          );
        })}
      </section>

      {run.blindedPacket ? (
        <section className="surface p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="label-caps text-ai">As the assessor saw it</h2>
            <span className="badge badge-ai">blinded input</span>
          </div>
          <p className="mt-3 max-w-[70ch] text-sm leading-6 text-text-2">
            The exact packet the Evidence Assessor received: no name, no contact details, no
            URLs — opaque tokens and scrubbed text only. The scorecard above shows the
            candidate&apos;s name because blinding is model-facing; the scorer never saw it.
          </p>
          <pre className="mt-4 max-h-[420px] overflow-auto bg-surface-2 p-4 font-mono text-xs leading-5 text-text-2">
            {JSON.stringify(run.blindedPacket, null, 2)}
          </pre>
        </section>
      ) : null}

      <section className="surface p-5">
        <h2 className="label-caps">Audit log</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse font-mono text-xs">
            <thead className="bg-surface-2 text-text-2">
              <tr>
                <th className="p-3 text-left font-medium">ts</th>
                <th className="p-3 text-left font-medium">stage</th>
                <th className="p-3 text-left font-medium">kind</th>
                <th className="p-3 text-right font-medium">cost</th>
                <th className="p-3 text-left font-medium">digest</th>
              </tr>
            </thead>
            <tbody>
              {run.auditLog.map((entry, index) => (
                <tr className="border-t border-border" key={`${entry.stage}-${index}`}>
                  <td className="p-3 text-text-3">{new Date(entry.ts).toLocaleTimeString()}</td>
                  <td className="p-3">{entry.stage}</td>
                  <td className="p-3 text-text-2">{entry.kind}</td>
                  <td className="p-3 text-right text-text-2">${(entry.costUsd ?? 0).toFixed(4)}</td>
                  <td className="p-3 text-text-3">{entry.inputDigest?.slice(0, 12) ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
