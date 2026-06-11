import { listRuns } from "@/lib/store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  return Response.json(await listRuns(searchParams.get("candidateId") ?? undefined));
}
