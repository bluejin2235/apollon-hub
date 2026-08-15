import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { runEvalExam } from "@/lib/luna/eval-exam";

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

  let force = true;
  let tier: "light" | "heavy" | null = null;
  try {
    const body = (await request.json()) as {
      force?: unknown;
      tier?: unknown;
    };
    if (body.force === false) force = false;
    if (body.tier === "light" || body.tier === "heavy") tier = body.tier;
  } catch {
    force = true;
  }

  try {
    const result = await runEvalExam(admin, {
      trigger: "manual",
      createdBy: user.id,
      force,
      tier,
      notify: true
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
