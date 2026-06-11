"use client";

import { useState } from "react";
import type { EvaluationRun, ReviewerDecision } from "@/lib/types";

export default function DecisionForm({ initialRun }: { initialRun: EvaluationRun }) {
  const [decision, setDecision] = useState<ReviewerDecision | undefined>(initialRun.reviewerDecision);
  const [choice, setChoice] = useState<"advance" | "hold" | "decline">("hold");
  const [rationale, setRationale] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    const response = await fetch(`/api/runs/${initialRun.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: choice, rationale }),
    });
    const run = (await response.json()) as EvaluationRun;
    setDecision(run.reviewerDecision);
    setSaving(false);
  }

  if (decision) {
    return (
      <div>
        <p className="label-caps">Human decision recorded</p>
        <p className="mt-3 font-mono text-sm uppercase">{decision.decision}</p>
        <p className="mt-2 text-sm text-text-2">{decision.rationale}</p>
      </div>
    );
  }

  return (
    <div>
      <p className="label-caps">Your decision</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {(["advance", "hold", "decline"] as const).map((option) => (
          <button
            className={`btn ${choice === option ? "btn-primary" : "btn-secondary"}`}
            key={option}
            onClick={() => setChoice(option)}
            type="button"
          >
            {option}
          </button>
        ))}
      </div>
      <textarea
        className="mt-4 min-h-24 w-full resize-y border border-border bg-surface-2 p-3 text-sm text-text outline-none focus:border-accent"
        onChange={(event) => setRationale(event.target.value)}
        placeholder="Rationale required, minimum one sentence..."
        value={rationale}
      />
      <button
        className="btn btn-primary mt-3"
        disabled={saving || rationale.trim().length < 20}
        onClick={submit}
        type="button"
      >
        {saving ? "Recording..." : "Record decision"}
      </button>
    </div>
  );
}
