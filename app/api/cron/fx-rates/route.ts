import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import { fetchDailyFxRate } from "@/lib/fx/fetch-rates";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/cron/fx-rates
 * 매일 09:15 KST (UTC 00:15) — 어제 확정 USD/KRW 1건 수집.
 * 06:00 으로 앞당겨도 당일 ECB 환율은 없고(16:00 CET ≈ 23:00~00:00 KST),
 * 리포트(07:00)는 created_at 기준 어제 09:15 를 정상으로 본다.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[fx-rates] CRON_SECRET is not configured");
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }
  if ((request.headers.get("authorization") ?? "") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  try {
    const result = await fetchDailyFxRate(admin);
    console.log("[fx-rates] cron", result);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[fx-rates]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "fx fetch failed" },
      { status: 500 }
    );
  }
}
