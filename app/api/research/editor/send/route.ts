import { NextRequest, NextResponse } from "next/server";
import { isResearchManagerServer } from "@/lib/auth/check-research-manager";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";

const N8N_NEWSLETTER_WEBHOOK_URL =
  "https://apollonworks.app.n8n.cloud/webhook/trend-newsletter-trigger";

type SendBody = {
  batchId?: string;
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

    let body: SendBody;
    try {
      body = (await request.json()) as SendBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const batchId = body.batchId?.trim();
    if (!batchId) {
      return NextResponse.json({ error: "batchId is required" }, { status: 400 });
    }

    const response = await fetch(N8N_NEWSLETTER_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batch_id: batchId }),
      signal: AbortSignal.timeout(60_000)
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error(
        "[research/editor/send] webhook failed",
        response.status,
        detail.slice(0, 500)
      );
      return NextResponse.json(
        { error: `뉴스레터 발송 요청에 실패했습니다. (${response.status})` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[research/editor/send]", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
