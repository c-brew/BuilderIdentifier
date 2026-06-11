import { getRun, recordDecision } from "@/lib/store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  return Response.json(run);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json()) as {
    decision?: "advance" | "hold" | "decline";
    rationale?: string;
    reviewerName?: string;
  };

  if (!body.decision || !body.rationale || body.rationale.trim().length < 20) {
    return Response.json(
      { error: "Decision and rationale of at least 20 characters are required" },
      { status: 400 },
    );
  }

  const run = await recordDecision(id, {
    decision: body.decision,
    rationale: body.rationale.trim(),
    reviewerName: body.reviewerName,
  });

  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  return Response.json(run);
}
