import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { finalizeEvalExam } from "@/lib/luna/eval-exam";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { run_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const runId = typeof body.run_id === "string" ? body.run_id.trim() : "";
  if (!runId) {
    return NextResponse.json({ error: "run_id is required" }, { status: 400 });
  }

  try {
    const result = await finalizeEvalExam(admin, runId, "manual");
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[luna/eval/finalize]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Finalize failed" },
      { status: 500 }
    );
  }
}
