import { NextRequest, NextResponse } from "next/server";
import { isResearchManagerServer } from "@/lib/auth/check-research-manager";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  normalizePublishingPeriod,
  publishingPeriodToDays
} from "@/lib/research/publishing";

const N8N_WEBHOOK_URL = "https://apollonworks.app.n8n.cloud/webhook/trend-weekly-trigger";

type TriggerBody = {
  days?: number;
  period?: string;
  start_date?: string;
  end_date?: string;
};

function resolveTriggerDays(body: TriggerBody): number | null {
  if (typeof body.days === "number" && Number.isInteger(body.days) && body.days > 0) {
    return body.days;
  }

  const period = normalizePublishingPeriod(body.period);
  return publishingPeriodToDays(
    period,
    body.start_date?.trim() ?? "",
    body.end_date?.trim() ?? ""
  );
}

export async function POST(request: NextRequest) {
  try {
    const user = await getApiUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = getServiceSupabase();
    if (!admin) {
      return NextResponse.json({ error: "Supabase environment variables missing" }, { status: 500 });
    }

    const canManage = await isResearchManagerServer(admin, user.id);
    if (!canManage) {
      return NextResponse.json({ error: "트렌드 레이더 관리 권한이 없습니다." }, { status: 403 });
    }

    let body: TriggerBody;
    try {
      body = (await request.json()) as TriggerBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const days = resolveTriggerDays(body);
    if (days === null) {
      return NextResponse.json({ error: "유효하지 않은 수집기간입니다." }, { status: 400 });
    }

    const webhookBody = { days };

    const response = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(webhookBody),
      signal: AbortSignal.timeout(60_000)
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error("[research/publishing/trigger] webhook failed", response.status, detail.slice(0, 500));
      return NextResponse.json({ error: `Publishing 실행에 실패했습니다. (${response.status})` }, { status: 502 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[research/publishing/trigger]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
