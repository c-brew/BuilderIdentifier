"use client";

import { useState } from "react";
import type { EvaluationRun, StreamEvent } from "@/lib/types";

export default function RunEvaluation({ candidateId }: { candidateId: string }) {
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
      body: JSON.stringify({ candidateId }),
    });

    if (!response.ok || !response.body) {
      setRunning(false);
      setError("Evaluation failed to start.");
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

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
        if (event.type === "run_complete") setRun(event.run);
        if (event.type === "run_error") setError(event.error);
      }
    }

    setRunning(false);
  }

  return (
    <aside className={`surface p-5 ${running ? "running-pulse" : ""}`}>
      <p className="label-caps">Run control</p>
      <h2 className="mt-2 text-base font-semibold">Evaluation pipeline</h2>
      <p className="mt-3 text-sm leading-6 text-text-2">
        Streams blinded scoring, verification, synthesis, and audit entries. Demo mode uses local fixture logic.
      </p>
      <button className="btn btn-primary mt-5 w-full" disabled={running} onClick={start}>
        {running ? "Running..." : "Run evaluation"}
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
