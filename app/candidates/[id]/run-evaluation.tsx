"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ROLES, TARGET_ROLES } from "@/lib/rubric";
import type { EvaluationRun, StreamEvent, TargetRole } from "@/lib/types";

export default function RunEvaluation({ candidateId }: { candidateId: string }) {
  const router = useRouter();
  const [targetRole, setTargetRole] = useState<TargetRole>("senior-consultant");
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<EvaluationRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setRunning(true);
    setError(null);
    setEvents([]);
    setRun(null);

    const response = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId, targetRole }),
    });

    if (!response.ok || !response.body) {
      setRunning(false);
      setError("Evaluation failed to start.");
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completedRun: EvaluationRun | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as StreamEvent;
        setEvents((prev) => [...prev, event]);
        if (event.type === "run_complete") {
          completedRun = event.run;
          setRun(event.run);
        }
        if (event.type === "run_error") setError(event.error);
      }
    }

    setRunning(false);
    // The whole point of the run is the scorecard — take the reviewer there.
    if (completedRun) router.push(`/runs/${completedRun.id}`);
  }

  return (
    <aside className={`surface p-5 ${running ? "running-pulse" : ""}`}>
      <p className="label-caps">Run control</p>
      <h2 className="mt-2 text-base font-semibold">Evaluation pipeline</h2>
      <p className="mt-3 text-sm leading-6 text-text-2">
        Live checks, blinded scoring (two passes), synthesis, and audit entries stream below.
        Takes about a minute; you&apos;ll land on the scorecard when it completes.
      </p>
      <fieldset className="mt-5" disabled={running}>
        <legend className="label-caps">Target role</legend>
        <div className="mt-2 grid gap-2">
          {TARGET_ROLES.map((role) => (
            <label
              className={`flex cursor-pointer items-center justify-between gap-3 border p-3 text-sm ${
                targetRole === role ? "border-accent" : "border-border hover:border-border-strong"
              }`}
              key={role}
            >
              <span>
                {ROLES[role].label}
                <span className="ml-2 font-mono text-xs text-text-3">{ROLES[role].jdRef}</span>
              </span>
              <input
                checked={targetRole === role}
                className="accent-[var(--color-accent)]"
                name="target-role"
                onChange={() => setTargetRole(role)}
                type="radio"
                value={role}
              />
            </label>
          ))}
        </div>
      </fieldset>
      <button className="btn btn-primary mt-5 w-full" disabled={running} onClick={start}>
        {running ? "Running..." : `Run evaluation · ${ROLES[targetRole].label}`}
      </button>
      {error ? <p className="mt-4 text-sm text-err">{error}</p> : null}
      <div className="mt-5 max-h-[360px] overflow-auto border-t border-border pt-4">
        {events.length === 0 ? (
          <p className="text-sm text-text-3">No run started.</p>
        ) : (
          <ol className="grid gap-2">
            {events.map((event, index) => (
              <li className="font-mono text-xs text-text-2" key={`${event.type}-${index}`}>
                {event.type === "stage_complete"
                  ? `${event.stage}: ${event.summary}`
                  : event.type === "audit"
                    ? `audit: ${event.entry.stage} · ${event.entry.inputDigest?.slice(0, 10) ?? "no-digest"}`
                    : event.type}
              </li>
            ))}
          </ol>
        )}
      </div>
      {run ? (
        <a className="btn btn-secondary mt-5 block text-center" href={`/runs/${run.id}`}>
          Open scorecard
        </a>
      ) : null}
    </aside>
  );
}
