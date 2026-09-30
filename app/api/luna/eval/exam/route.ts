import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { runEvalExam, continueEvalExam } from "@/lib/luna/eval-exam";

export const runtime = "nodejs";
export const maxDuration = 800;

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

  let resumeId:string|null=null;
  let categories:string[]|null=null;
  let force = true;
  let startOnly = false;
  let tier: "light" | "heavy" | null = null;
  try {
    const body = (await request.json()) as {
      force?: unknown;
      tier?: unknown;
      run_id?:unknown;
      categories?:unknown;
      start_only?:unknown;
    };
    if(typeof body.run_id==='string' && /^[0-9a-f-]{36}$/i.test(body.run_id)) resumeId=body.run_id;
    if(Array.isArray(body.categories) && body.categories.every(c=>typeof c==='string')) categories=body.categories as string[];
    if (body.force === false) force = false;
    startOnly = body.start_only === true;
    if (body.tier === "light" || body.tier === "heavy") tier = body.tier;
    // tier 생략·"all" → 활성 전체(light+heavy)
  } catch {
    force = true;
  }

  try {
    if(resumeId) return NextResponse.json(await continueEvalExam(admin,resumeId));
    const result = await runEvalExam(admin, {
      trigger: "manual",
      createdBy: user.id,
      force,
      tier,
      categories,
      ...(startOnly ? { budgetMs: 0 } : {}),
      notify: false
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[luna/eval/exam]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Exam failed" },
      { status: 500 }
    );
  }
}
