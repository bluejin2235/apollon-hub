import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { hasLunaAccess } from "@/lib/luna/beta-access";

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
  if (!(await hasLunaAccess(admin, user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { result_id?: string; score?: unknown; comment?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const resultId = typeof body.result_id === "string" ? body.result_id.trim() : "";
  const score = Number(body.score);
  const comment =
    typeof body.comment === "string" ? body.comment.trim() || null : null;

  if (!resultId || !Number.isInteger(score) || score < 1 || score > 10) {
    return NextResponse.json(
      { error: "result_id and score (1-10) are required" },
      { status: 400 }
    );
  }

  const { data: result, error: fetchError } = await admin
    .from("luna_eval_results")
    .select("id, case_id")
    .eq("id", resultId)
    .maybeSingle();

  if (fetchError) {
    console.error("[luna/eval/human-score] fetch", fetchError);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!result) {
    return NextResponse.json({ error: "Result not found" }, { status: 404 });
  }

  const { data, error } = await admin
    .from("luna_eval_human_scores")
    .upsert(
      {
        result_id: resultId,
        case_id: result.case_id as string,
        scorer_id: user.id,
        score,
        comment
      },
      { onConflict: "result_id,scorer_id" }
    )
    .select("id, result_id, case_id, scorer_id, score, comment, created_at")
    .single();

  if (error) {
    console.error("[luna/eval/human-score] upsert", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ score: data });
}
