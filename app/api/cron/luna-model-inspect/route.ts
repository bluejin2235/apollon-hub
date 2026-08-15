import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import { runModelInspect } from "@/lib/luna/model-auto-swap";

export const runtime = "nodejs";
export const maxDuration = 120;

/** 일요일 04:00 KST 직전 — UTC 토 18:50 권장. vercel.json 에 등록 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 }
    );
  }
  if ((request.headers.get("authorization") ?? "") !== `Bearer ${cronSecret}`) {
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
    const { data: fx } = await admin
      .from("fx_daily_rates")
      .select("usd_krw")
      .order("date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const usdKrw =
      fx?.usd_krw != null && Number.isFinite(Number(fx.usd_krw))
        ? Number(fx.usd_krw)
        : 1380;
    const result = await runModelInspect(admin, { usdKrw });
    console.log("[luna-model-inspect] cron", result);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[luna-model-inspect]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "inspect failed" },
      { status: 500 }
    );
  }
}
