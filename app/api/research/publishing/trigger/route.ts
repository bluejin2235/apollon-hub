import { NextRequest, NextResponse } from "next/server";
import { isResearchManagerServer } from "@/lib/auth/check-research-manager";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  buildPublishingTriggerBody,
  type PublishingPeriod
} from "@/lib/research/publishing";

const N8N_WEBHOOK_URL = "https://apollonworks.app.n8n.cloud/webhook/trend-weekly-trigger";

type TriggerBody = {
  period?: PublishingPeriod;
  start_date?: string;
  end_date?: string;
};

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

    const period = body.period ?? "1week";
    if (period !== "1week" && period !== "2week" && period !== "custom") {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const startDate = body.start_date?.trim() ?? "";
    const endDate = body.end_date?.trim() ?? "";

    if (period === "custom" && (!startDate || !endDate)) {
      return NextResponse.json({ error: "기간설정 시 시작일과 종료일이 필요합니다." }, { status: 400 });
    }

    const webhookBody = buildPublishingTriggerBody(period, startDate, endDate);

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
