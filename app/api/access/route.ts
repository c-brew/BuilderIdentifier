import { cookies } from "next/headers";
import { ACCESS_COOKIE, isAllowedEmail } from "@/lib/access";

export async function POST(request: Request) {
  const { email } = (await request.json()) as { email?: string };

  if (!email || !isAllowedEmail(email)) {
    return Response.json(
      { error: "That email is not on the reviewer list for this demo." },
      { status: 403 },
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(ACCESS_COOKIE, email.trim().toLowerCase(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });

  return Response.json({ ok: true });
}
