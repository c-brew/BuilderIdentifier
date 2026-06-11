import Link from "next/link";
import { RUBRIC } from "@/lib/rubric";

export default function RubricPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1100px] flex-col gap-8 px-6 py-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="label-caps">Shared instrument</p>
          <h1 className="mt-2 text-[28px] font-semibold">Rubric</h1>
        </div>
        <Link className="btn btn-secondary" href="/">
          Back
        </Link>
      </header>
      <section className="grid gap-4">
        {RUBRIC.map((item) => (
          <article className="surface p-5" key={item.dimension}>
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-base font-semibold">{item.label}</h2>
              <span className="font-mono text-xs text-text-3">{item.dimension}</span>
            </div>
            <p className="mt-3 border-l-2 border-ai pl-3 text-sm text-text-2">{item.anchor}</p>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {[1, 3, 5].map((level) => (
                <div className="bg-surface-2 p-4" key={level}>
                  <p className="font-mono text-sm text-text">{level} / 5</p>
                  <p className="mt-2 text-sm text-text-2">{item.levels[level as 1 | 3 | 5]}</p>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
