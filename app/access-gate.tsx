"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function AccessGate() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setChecking(true);
    setError(null);

    const response = await fetch("/api/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    if (response.ok) {
      router.refresh();
    } else {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Access check failed.");
      setChecking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/90 px-6 backdrop-blur-sm">
      <div className="surface w-full max-w-[420px] p-6">
        <p className="label-caps">Reviewer access</p>
        <h1 className="mt-2 text-xl font-semibold">AI Builder Evaluator</h1>
        <p className="mt-3 text-sm leading-6 text-text-2">
          This demo is limited to the hiring team. Enter your work email to continue.
        </p>
        <form className="mt-5 grid gap-3" onSubmit={submit}>
          <input
            autoFocus
            className="w-full border border-border bg-surface-2 p-3 text-sm text-text outline-none focus:border-accent"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            type="email"
            value={email}
          />
          <button className="btn btn-primary" disabled={checking || !email} type="submit">
            {checking ? "Checking..." : "Continue"}
          </button>
        </form>
        {error ? <p className="mt-3 text-sm text-err">{error}</p> : null}
        <p className="mt-5 font-mono text-xs text-text-3">
          Access check only — no account is created and the email is stored in a browser cookie.
        </p>
      </div>
    </div>
  );
}
