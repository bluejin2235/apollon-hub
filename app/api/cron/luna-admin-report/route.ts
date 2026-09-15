import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import { sendAdminMorningReport } from "@/lib/luna-admin/report";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/luna-admin-report
 * 매일 07:00 KST (UTC 22:00) — 아침 리포트 메일.
 * 수신 hub@apollonworks.com · Resend.
 * 아무 일 없어도 한 줄로 보낸다.
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
    const result = await sendAdminMorningReport(admin);
    console.log("[luna-admin-report]", result);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "report failed";
    console.error("[luna-admin-report]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
