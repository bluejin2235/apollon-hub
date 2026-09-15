import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import { buildLinks } from "@/lib/luna-admin/build-links";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * GET /api/cron/luna-links
 * 매일 04:30 KST (UTC 19:30) — 2차 데이터. 이미 만든 링크는 건너뛴다.
 * 최근 연도부터. 1차가 일부 실패해도 성공한 원천만으로 진행.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  try {
    const report = await buildLinks(admin, {
      log: (msg) => console.log(msg)
    });
    return NextResponse.json({
      ok: true,
      skipped: false,
      llm_calls: report.llm_calls,
      llm_usd: report.llm_usd,
      llm_aborted: report.llm_aborted,
      elapsed_ms: report.elapsed_ms,
      belongs: report.belongs.inserted,
      follows: report.follows.inserted,
      same: report.same.inserted,
      questions: report.questions,
      perspectives: report.perspectives.inserted
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "luna-links failed";
    console.error("[luna-links]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
