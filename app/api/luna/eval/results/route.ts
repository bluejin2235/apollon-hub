import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";

export const runtime = "nodejs";

async function requireSuperAdmin(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return {
      error: NextResponse.json({ error: "Server configuration error" }, { status: 500 })
    };
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user, admin };
}

async function recomputeRunCounts(
  admin: NonNullable<ReturnType<typeof getServiceSupabase>>,
  runId: string
) {
  const { data: rows, error } = await admin
    .from("luna_eval_results")
    .select("auto_pass, verdict")
    .eq("run_id", runId);

  if (error) {
    console.error("[luna/eval/results] recount", error);
    return;
  }

  let passed = 0;
  let failed = 0;
  for (const row of rows ?? []) {
    if (typeof row.auto_pass === "boolean") {
      if (row.auto_pass) passed += 1;
      else failed += 1;
    } else if (row.verdict === "pass") {
      passed += 1;
    } else if (row.verdict === "fail") {
      failed += 1;
    }
  }

  const { error: updateError } = await admin
    .from("luna_eval_runs")
    .update({ passed, failed })
    .eq("id", runId);

  if (updateError) {
    console.error("[luna/eval/results] update run counts", updateError);
  }
}

export async function GET(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { user, admin } = gate;

  const runId = request.nextUrl.searchParams.get("run_id")?.trim() ?? "";
  if (!runId) {
    return NextResponse.json({ error: "run_id is required" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("luna_eval_results")
    .select(
      "id, run_id, case_id, answer, sources, verdict, memo, auto_pass, auto_reason, score, fail_kind, duration_ms, model_label, created_at, case:luna_eval_cases(id, question, expectation, category, connectors, sort_order, tier, must_pass, quality)"
    )
    .eq("run_id", runId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[luna/eval/results] GET", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = data ?? [];
  const resultIds = results.map((r) => r.id as string);

  const myScores = new Map<string, { score: number; comment: string | null }>();
  const avgByResult = new Map<string, number>();
  let humanAvg: number | null = null;

  if (resultIds.length > 0) {
    const { data: scores, error: scoreError } = await admin
      .from("luna_eval_human_scores")
      .select("result_id, scorer_id, score, comment")
      .in("result_id", resultIds);

    if (scoreError) {
      console.error("[luna/eval/results] scores", scoreError);
      return NextResponse.json({ error: scoreError.message }, { status: 500 });
    }

    const sumByResult = new Map<string, { sum: number; n: number }>();
    let allSum = 0;
    let allN = 0;
    for (const s of scores ?? []) {
      const rid = s.result_id as string;
      const score = s.score as number;
      if (s.scorer_id === user.id) {
        myScores.set(rid, {
          score,
          comment: (s.comment as string | null) ?? null
        });
      }
      const agg = sumByResult.get(rid) ?? { sum: 0, n: 0 };
      agg.sum += score;
      agg.n += 1;
      sumByResult.set(rid, agg);
      allSum += score;
      allN += 1;
    }
    for (const [rid, agg] of sumByResult) {
      avgByResult.set(rid, Math.round((agg.sum / agg.n) * 10) / 10);
    }
    if (allN > 0) {
      humanAvg = Math.round((allSum / allN) * 10) / 10;
    }
  }

  let autoPassed = 0;
  let autoTotal = 0;
  for (const r of results) {
    autoTotal += 1;
    if (r.auto_pass === true) autoPassed += 1;
  }

  const enriched = results.map((r) => {
    const id = r.id as string;
    const mine = myScores.get(id) ?? null;
    return {
      ...r,
      my_score: mine?.score ?? null,
      my_comment: mine?.comment ?? null,
      human_avg: avgByResult.get(id) ?? null
    };
  });

  return NextResponse.json({
    results: enriched,
    summary: {
      auto_passed: autoPassed,
      auto_total: autoTotal,
      human_avg: humanAvg
    }
  });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate;

  let body: { id?: string; verdict?: string | null; memo?: string | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if ("verdict" in body) {
    if (body.verdict === "pass" || body.verdict === "fail" || body.verdict === null) {
      patch.verdict = body.verdict;
    } else {
      return NextResponse.json({ error: "invalid verdict" }, { status: 400 });
    }
  }
  if ("memo" in body) {
    patch.memo = typeof body.memo === "string" ? body.memo : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("luna_eval_results")
    .update(patch)
    .eq("id", id)
    .select(
      "id, run_id, case_id, answer, sources, verdict, memo, auto_pass, auto_reason, duration_ms, model_label, created_at"
    )
    .maybeSingle();

  if (error) {
    console.error("[luna/eval/results] PATCH", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if ("verdict" in patch) {
    await recomputeRunCounts(admin, data.run_id as string);
  }

  return NextResponse.json({ result: data });
}
