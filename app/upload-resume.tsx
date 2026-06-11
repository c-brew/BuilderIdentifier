"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function UploadResume() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;

    setUploading(true);
    setError(null);

    const body = new FormData();
    body.append("resume", file);

    const response = await fetch("/api/candidates", {
      method: "POST",
      body,
    });
    const payload = (await response.json()) as {
      candidate?: { id: string };
      error?: string;
    };

    setUploading(false);

    if (!response.ok || !payload.candidate) {
      setError(payload.error ?? "Upload failed.");
      return;
    }

    router.push(`/candidates/${payload.candidate.id}`);
    router.refresh();
  }

  return (
    <form className="surface p-5" onSubmit={submit}>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="label-caps">Upload resume</p>
          <h2 className="mt-2 text-base font-semibold">Read a document into a scoreable candidate</h2>
          <p className="mt-2 text-sm text-text-2">
            PDF, TXT, or Markdown. The extracted text becomes blinded evidence before scoring.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            className="max-w-[280px] text-sm text-text-2 file:mr-3 file:rounded file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:text-text"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            type="file"
          />
          <button className="btn btn-primary" disabled={!file || uploading} type="submit">
            {uploading ? "Reading..." : "Upload"}
          </button>
        </div>
      </div>
      {error ? <p className="mt-4 text-sm text-err">{error}</p> : null}
    </form>
  );
}
