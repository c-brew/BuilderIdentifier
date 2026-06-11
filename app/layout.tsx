import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { ACCESS_COOKIE, isAllowedEmail } from "@/lib/access";
import { EST_COST_PER_RUN, MODEL_ID } from "@/lib/config";
import AccessGate from "./access-gate";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Builder Evaluator",
  description: "Verdict-free candidate evidence evaluator.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const accessEmail = cookieStore.get(ACCESS_COOKIE)?.value;
  const authorized = accessEmail ? isAllowedEmail(accessEmail) : false;

  return (
    <html lang="en">
      <body>
        {authorized ? null : <AccessGate />}
        <header className="border-b border-border bg-surface">
          <div className="mx-auto flex w-full max-w-[1100px] items-center justify-between gap-4 px-6 py-3">
            <Link className="text-sm font-semibold" href="/">
              AI Builder Evaluator
            </Link>
            <nav className="flex items-center gap-4 text-sm text-text-2">
              <Link className="hover:text-text" href="/">
                Queue
              </Link>
              <Link className="hover:text-text" href="/rubric">
                Rubric
              </Link>
            </nav>
          </div>
          <div className="border-t border-border">
            <div className="mx-auto w-full max-w-[1100px] px-6 py-2 font-mono text-xs text-text-2">
              MODEL {MODEL_ID} · BLIND-SCORED · {EST_COST_PER_RUN}/RUN · RECOMMENDS, NEVER DECIDES
            </div>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
