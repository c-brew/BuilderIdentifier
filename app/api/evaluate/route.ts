import { runEvaluation } from "@/lib/pipeline";
import type { StreamEvent, TargetRole } from "@/lib/types";

export const maxDuration = 300;

const VALID_ROLES: TargetRole[] = ["senior-consultant", "manager"];

export async function POST(request: Request) {
  const { requireAccess } = await import("@/lib/access");
  const denied = await requireAccess();
  if (denied) return denied;

  const { candidateId, targetRole } = (await request.json()) as {
    candidateId?: string;
    targetRole?: string;
  };
  if (!candidateId) {
    return Response.json({ error: "candidateId is required" }, { status: 400 });
  }
  const role: TargetRole = VALID_ROLES.includes(targetRole as TargetRole)
    ? (targetRole as TargetRole)
    : "senior-consultant";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        await runEvaluation(candidateId, role, send);
      } catch (error) {
        send({
          type: "run_error",
          runId: "unknown",
          error: error instanceof Error ? error.message : "Unknown evaluation error",
          auditLog: [],
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
    },
  });
}
