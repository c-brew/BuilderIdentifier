import { ingestResume } from "@/lib/intake";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("resume");

  if (!(file instanceof File)) {
    return Response.json({ error: "Upload a resume file." }, { status: 400 });
  }

  try {
    const candidate = await ingestResume(file);
    return Response.json({ candidate });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Resume intake failed." },
      { status: 400 },
    );
  }
}
