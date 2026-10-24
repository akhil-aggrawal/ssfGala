import { connection } from "next/server";
import { checkHealth } from "@/lib/health";

export async function GET() {
  await connection(); // per request, never prerendered
  const { status, body } = await checkHealth(process.env);
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
