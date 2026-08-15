import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import { runEvalExam } from "@/lib/luna/eval-exam";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/luna-eval-heavy
 * 매주 일요일 03:50 KST (UTC 토 18:50) — tier=heavy 회귀 시험.
 * 자기개선(일 04:00 KST / UTC 토 19:00) 직전.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[luna-eval-heavy] CRON_SECRET is not configured");
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }

  try {
    const result = await runEvalExam(admin, {
      trigger: "cron_heavy",
      tier: "heavy",
      force: true,
      notify: true
    });
    console.log("[luna-eval-heavy] cron", result);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[luna-eval-heavy]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Eval heavy failed" },
      { status: 500 }
    );
  }
}
