import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  LUNA_MODEL_COST_SETTINGS_DEFAULT,
  LUNA_MODEL_COST_SETTINGS_KEY,
  normalizeModelCostSettings
} from "@/lib/luna/brain-models";
import { runModelInspect } from "@/lib/luna/model-auto-swap";
import {
  alreadyInspectedTodayKst,
  shouldRunInspectNow
} from "@/lib/luna/model-inspect-schedule";

export const runtime = "nodejs";
export const maxDuration = 120;

/** 10분마다 호출. inspect_schedule 시각 ±10분에만 실행 */
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
    const { data: settingsRow } = await admin
      .from("luna_settings")
      .select("value")
      .eq("key", LUNA_MODEL_COST_SETTINGS_KEY)
      .maybeSingle();
    const settings = settingsRow?.value
      ? normalizeModelCostSettings(settingsRow.value)
      : { ...LUNA_MODEL_COST_SETTINGS_DEFAULT };
    const schedule = settings.inspect_schedule;

    // period=off → 스킵 / daily·weekly → 설정 시각 ±10분 / 같은 날 중복 방지
    if (!shouldRunInspectNow(schedule)) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: schedule.period === "off" ? "disabled" : "not due",
        schedule
      });
    }
    if (alreadyInspectedTodayKst(settings.last_inspect_at)) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: "already ran today",
        schedule
      });
    }

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
    return NextResponse.json({ ...result, schedule });
  } catch (err) {
    console.error("[luna-model-inspect]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "inspect failed" },
      { status: 500 }
    );
  }
}
