import { runEvaluation } from "@/lib/pipeline";
import type { StreamEvent } from "@/lib/types";

export const maxDuration = 300;

export async function POST(request: Request) {
  const { candidateId } = (await request.json()) as { candidateId?: string };
  if (!candidateId) {
    return Response.json({ error: "candidateId is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        await runEvaluation(candidateId, send);
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
