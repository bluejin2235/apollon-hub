import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";

export const runtime = "nodejs";

/**
 * GET /api/cron/luna-links
 * 매일 04:30 KST (UTC 19:30) — 2차 데이터 생성 그릇.
 * 생성 로직은 다음 작업. 1차가 일부 실패해도 성공한 것만으로 진행할 예정.
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

  return NextResponse.json({
    ok: true,
    skipped: true,
    reason: "2차 데이터 생성 로직은 다음 작업",
    policy: "1차 일부 실패 시에도 성공한 원천만으로 진행"
  });
}
