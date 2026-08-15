import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import { runEvalExam } from "@/lib/luna/eval-exam";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/luna-eval-light
 * 매일 03:40 KST (UTC 18:40) — tier=light 회귀 시험.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[luna-eval-light] CRON_SECRET is not configured");
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
      trigger: "cron_light",
      tier: "light",
      force: true,
      notify: true
    });
    console.log("[luna-eval-light] cron", result);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[luna-eval-light]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Eval light failed" },
      { status: 500 }
    );
  }
}
