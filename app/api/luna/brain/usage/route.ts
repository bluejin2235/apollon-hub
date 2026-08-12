import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  LUNA_USAGE_ALERTS_DEFAULT,
  LUNA_USAGE_ALERTS_KEY,
  normalizeUsageAlerts
} from "@/lib/luna/brain-models";

export const runtime = "nodejs";

export type UsageDailyPoint = {
  date: string;
  tokens: number;
};

/** KST 기준 YYYY-MM-DD (luna_usage_daily.date 와 같은 기준) */
function kstDate(offsetDays = 0): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCDate(kst.getUTCDate() + offsetDays);
  return kst.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
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

  const { data: tiers, error: tierError } = await admin
    .from("luna_engine_tiers")
    .select("tier, provider, model_id, model_label, use_caching, use_batch, updated_at")
    .order("tier", { ascending: true });
  if (tierError) {
    console.error("[luna/brain/usage] tiers", tierError);
    return NextResponse.json({ error: tierError.message }, { status: 500 });
  }

  const today = kstDate();
  const monthStart = `${today.slice(0, 7)}-01`;
  // 주간 증감 비교를 위해 14일치를 받는다
  const from = kstDate(-13) < monthStart ? kstDate(-13) : monthStart;
  const rangeStart = from < monthStart ? from : monthStart;

  const { data: usageRows, error: usageError } = await admin
    .from("luna_usage_daily")
    .select("date, tier, input_tokens, output_tokens")
    .gte("date", rangeStart)
    .lte("date", today);
  if (usageError) {
    console.error("[luna/brain/usage] usage", usageError);
    return NextResponse.json({ error: usageError.message }, { status: 500 });
  }

  const byDate = new Map<string, number>();
  let monthTotal = 0;
  let talkTokens = 0;
  let batchTokens = 0;

  for (const row of usageRows ?? []) {
    const date = String(row.date).slice(0, 10);
    const tokens =
      (Number(row.input_tokens) || 0) + (Number(row.output_tokens) || 0);
    byDate.set(date, (byDate.get(date) ?? 0) + tokens);
    if (date >= monthStart) {
      monthTotal += tokens;
      // A·B 는 대화 흐름에서, C 는 야간 배치에서 쓰인다
      if (String(row.tier).toUpperCase() === "C") batchTokens += tokens;
      else talkTokens += tokens;
    }
  }

  const daily: UsageDailyPoint[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = kstDate(-i);
    daily.push({ date, tokens: byDate.get(date) ?? 0 });
  }

  let weekTokens = 0;
  let prevWeekTokens = 0;
  for (let i = 0; i < 7; i += 1) weekTokens += byDate.get(kstDate(-i)) ?? 0;
  for (let i = 7; i < 14; i += 1) prevWeekTokens += byDate.get(kstDate(-i)) ?? 0;

  const weekChangePct =
    prevWeekTokens > 0
      ? Math.round(((weekTokens - prevWeekTokens) / prevWeekTokens) * 100)
      : null;

  const talkBatchTotal = talkTokens + batchTokens;
  const talkRatio =
    talkBatchTotal > 0 ? Math.round((talkTokens / talkBatchTotal) * 100) : null;

  const { data: alertRow } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", LUNA_USAGE_ALERTS_KEY)
    .maybeSingle();

  return NextResponse.json({
    tiers: tiers ?? [],
    daily,
    stats: {
      week_tokens: weekTokens,
      week_change_pct: weekChangePct,
      today_tokens: byDate.get(today) ?? 0,
      talk_ratio: talkRatio,
      month_tokens: monthTotal
    },
    alerts: alertRow?.value
      ? normalizeUsageAlerts(alertRow.value)
      : { ...LUNA_USAGE_ALERTS_DEFAULT }
  });
}

export async function PATCH(request: NextRequest) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const alerts = normalizeUsageAlerts(body);
  const { error } = await admin.from("luna_settings").upsert(
    {
      key: LUNA_USAGE_ALERTS_KEY,
      value: alerts,
      updated_at: new Date().toISOString()
    },
    { onConflict: "key" }
  );
  if (error) {
    console.error("[luna/brain/usage] PATCH", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ alerts });
}
