// Lightweight access gate — a demo courtesy check, not authentication.
// ALLOWED_EMAILS is comma-separated; entries starting with "@" match the
// domain, anything else matches exactly. Re-validated on every render, so
// changing the env var revokes existing cookies.

const DEFAULT_ALLOWED = "connor.brewer@icloud.com,@kpmg.ca";

export const ACCESS_COOKIE = "evaluator_access";

export function allowedPatterns(): string[] {
  return (process.env.ALLOWED_EMAILS ?? DEFAULT_ALLOWED)
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254) return false;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) return false;
  return allowedPatterns().some((pattern) =>
    pattern.startsWith("@") ? normalized.endsWith(pattern) : normalized === pattern,
  );
}

// Guard for routes that spend money (LLM calls). Returns a 403 Response if
// the access cookie is missing or no longer allowed, otherwise null.
export async function requireAccess(): Promise<Response | null> {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const email = cookieStore.get(ACCESS_COOKIE)?.value;
  if (email && isAllowedEmail(email)) return null;
  return Response.json(
    { error: "Reviewer access required. Enter your email on the app first." },
    { status: 403 },
  );
}
