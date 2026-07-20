import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  PUBLISHING_SCHEDULE_KEY,
  parsePublishingSchedule,
  publishingPeriodToDays
} from "@/lib/research/publishing";
import { KST_OFFSET_MS } from "@/lib/mail/hub-email";

const N8N_WEBHOOK_URL = "https://apollonworks.app.n8n.cloud/webhook/trend-weekly-trigger";

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6
};

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[publishing-trigger] CRON_SECRET is not configured");
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Supabase environment variables missing" }, { status: 500 });
  }

  const { data } = await admin
    .from("trend_settings")
    .select("value")
    .eq("key", PUBLISHING_SCHEDULE_KEY)
    .maybeSingle();

  const schedule = parsePublishingSchedule(data?.value ?? null);

  const nowKst = new Date(Date.now() + KST_OFFSET_MS);
  const currentDay = nowKst.getUTCDay();
  const currentHour = nowKst.getUTCHours();

  if (currentDay !== WEEKDAY_INDEX[schedule.day] || currentHour !== schedule.hour) {
    return NextResponse.json({ skipped: true, reason: "scheduled time not matched" });
  }

  const days = publishingPeriodToDays(
    schedule.period,
    schedule.start_date ?? "",
    schedule.end_date ?? ""
  );

  if (days === null) {
    console.error("[publishing-trigger] invalid schedule period", schedule);
    return NextResponse.json({ error: "Invalid schedule period" }, { status: 400 });
  }

  try {
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
      signal: AbortSignal.timeout(60_000)
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("[publishing-trigger] webhook failed", response.status, detail.slice(0, 500));
      return NextResponse.json({ error: `Webhook failed (${response.status})` }, { status: 502 });
    }

    return NextResponse.json({ success: true, days });
  } catch (error) {
    console.error("[publishing-trigger]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
