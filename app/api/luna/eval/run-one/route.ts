import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { runLunaTurn, type LunaConnectors } from "@/lib/luna/run-chat";

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

  const { data: evalCase, error: caseError } = await admin
    .from("luna_eval_cases")
    .select("id, question, connectors, is_active")
    .eq("id", caseId)
    .maybeSingle();

  if (caseError) {
    console.error("[luna/eval/run-one] case", caseError);
    return NextResponse.json({ error: caseError.message }, { status: 500 });
  }
  if (!evalCase) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }

  const connectorsRaw =
    evalCase.connectors && typeof evalCase.connectors === "object"
      ? (evalCase.connectors as Record<string, unknown>)
      : {};
  const connectors: LunaConnectors = {
    notion: connectorsRaw.notion === true,
    web: connectorsRaw.web === true,
    nas: connectorsRaw.nas === true
  };

  let result;
  try {
    result = await runLunaTurn(admin, evalCase.question as string, connectors);
  } catch (err) {
    console.error("[luna/eval/run-one] runLunaTurn", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Run failed" },
      { status: 500 }
    );
  }

  const { data: inserted, error: insertError } = await admin
    .from("luna_eval_results")
    .upsert(
      {
        run_id: runId,
        case_id: caseId,
        answer: result.answer,
        sources: result.sources,
        verdict: null,
        memo: null,
        duration_ms: result.durationMs,
        model_label: result.modelLabel
      },
      { onConflict: "run_id,case_id" }
    )
    .select("id, case_id, answer, duration_ms, model_label, sources, verdict, memo")
    .single();

  if (insertError) {
    console.error("[luna/eval/run-one] insert", insertError);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({
    case_id: caseId,
    answer: result.answer,
    duration_ms: result.durationMs,
    result: inserted
  });
}
