import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { executeEvalCase } from "@/lib/luna/eval-exam";

export const runtime = "nodejs";
export const maxDuration = 300;

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

  let body: { run_id?: string; case_id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const runId = typeof body.run_id === "string" ? body.run_id.trim() : "";
  const caseId = typeof body.case_id === "string" ? body.case_id.trim() : "";
  if (!runId || !caseId) {
    return NextResponse.json({ error: "run_id and case_id are required" }, { status: 400 });
  }

  const { data: run, error: runError } = await admin
    .from("luna_eval_runs")
    .select("id, status")
    .eq("id", runId)
    .maybeSingle();

  if (runError) {
    console.error("[luna/eval/run-one] run", runError);
    return NextResponse.json({ error: runError.message }, { status: 500 });
  }
  if (!run) {
    return NextResponse.json({ error: "Run not found" }, { status: 404 });
  }

  try {
    const result = await executeEvalCase(admin, runId, caseId);
    return NextResponse.json({
      case_id: caseId,
      answer: result.answer,
      duration_ms: result.duration_ms,
      result: {
        id: result.id,
        case_id: result.case_id,
        answer: result.answer,
        auto_pass: result.auto_pass,
        auto_reason: result.auto_reason,
        duration_ms: result.duration_ms,
        model_label: result.model_label,
        verdict: result.auto_pass ? "pass" : "fail",
        memo: null,
        sources: null
      }
    });
  } catch (err) {
    console.error("[luna/eval/run-one]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Run failed" },
      { status: 500 }
    );
  }
}
