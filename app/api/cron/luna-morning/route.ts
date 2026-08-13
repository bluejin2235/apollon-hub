import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import { runMorningSummary } from "@/lib/luna/morning-summary";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/luna-morning
 * 매일 08:00 KST (UTC 23:00) — 밤사이 작업 한 건 요약 알림.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[luna-morning] CRON_SECRET is not configured");
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
    const result = await runMorningSummary(admin);
    console.log("[luna-morning] cron", result);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[luna-morning]", err);
    const message = err instanceof Error ? err.message : "Morning summary failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
