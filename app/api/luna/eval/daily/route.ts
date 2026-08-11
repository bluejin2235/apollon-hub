import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const { data: assignment, error } = await admin
    .from("luna_eval_daily")
    .select("id, user_id, result_id, assigned_at, answered_at")
    .eq("user_id", user.id)
    .is("answered_at", null)
    .order("assigned_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[luna/eval/daily] GET", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!assignment) {
    return NextResponse.json({ assignment: null });
  }

  const { data: result, error: resError } = await admin
    .from("luna_eval_results")
    .select(
      "id, answer, case_id, case:luna_eval_cases(id, question, expectation)"
    )
    .eq("id", assignment.result_id as string)
    .maybeSingle();

  if (resError) {
    console.error("[luna/eval/daily] result", resError);
    return NextResponse.json({ error: resError.message }, { status: 500 });
  }

  const caseRaw = result?.case as
    | { question?: string }
    | Array<{ question?: string }>
    | null
    | undefined;
  const caseObj = Array.isArray(caseRaw) ? caseRaw[0] : caseRaw;

  return NextResponse.json({
    assignment: {
      id: assignment.id,
      result_id: assignment.result_id,
      assigned_at: assignment.assigned_at,
      question: caseObj?.question ?? "",
      answer: (result?.answer as string | null) ?? "",
      case_id: (result?.case_id as string | null) ?? null
    }
  });
}

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let body: {
    id?: string;
    score?: unknown;
    comment?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const score = Number(body.score);
  const comment =
    typeof body.comment === "string" ? body.comment.trim() || null : null;

  if (!id || !Number.isInteger(score) || score < 1 || score > 10) {
    return NextResponse.json(
      { error: "id and score (1-10) are required" },
      { status: 400 }
    );
  }

  const { data: assignment, error: fetchError } = await admin
    .from("luna_eval_daily")
    .select("id, user_id, result_id, answered_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchError) {
    console.error("[luna/eval/daily] fetch", fetchError);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!assignment) {
    return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
  }
  if (assignment.answered_at) {
    return NextResponse.json({ error: "Already answered" }, { status: 400 });
  }

  const { data: result, error: resError } = await admin
    .from("luna_eval_results")
    .select("id, case_id, answer, case:luna_eval_cases(question)")
    .eq("id", assignment.result_id as string)
    .maybeSingle();

  if (resError || !result) {
    return NextResponse.json(
      { error: resError?.message || "Result not found" },
      { status: 404 }
    );
  }

  const now = new Date().toISOString();

  const { error: scoreError } = await admin.from("luna_eval_human_scores").upsert(
    {
      result_id: result.id as string,
      case_id: result.case_id as string,
      scorer_id: user.id,
      score,
      comment
    },
    { onConflict: "result_id,scorer_id" }
  );

  if (scoreError) {
    console.error("[luna/eval/daily] score", scoreError);
    return NextResponse.json({ error: scoreError.message }, { status: 500 });
  }

  const { error: markError } = await admin
    .from("luna_eval_daily")
    .update({ answered_at: now })
    .eq("id", id)
    .eq("user_id", user.id);

  if (markError) {
    console.error("[luna/eval/daily] mark", markError);
    return NextResponse.json({ error: markError.message }, { status: 500 });
  }

  if (comment) {
    const caseRaw = result.case as
      | { question?: string }
      | Array<{ question?: string }>
      | null;
    const question = (Array.isArray(caseRaw) ? caseRaw[0] : caseRaw)?.question ?? "";
    const learningContent = [
      `시험 피드백 (점수 ${score}/10)`,
      question ? `질문: ${question}` : null,
      `코멘트: ${comment}`
    ]
      .filter(Boolean)
      .join("\n");

    const { error: learnError } = await admin.from("luna_learnings").insert({
      category: "general",
      content: learningContent,
      status: "candidate",
      origin: "eval_feedback",
      author_id: user.id,
      raw_input: comment
    });
    if (learnError) {
      console.error("[luna/eval/daily] learning", learnError);
    }
  }

  return NextResponse.json({ ok: true });
}
