import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { NOTION_VERSION } from "@/lib/luna/notion-index";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const token = process.env.NOTION_TOKEN?.trim();
  if (!token) {
    return NextResponse.json({
      ok: false,
      connected: false,
      message: "NOTION_TOKEN 환경 변수가 설정되지 않았습니다."
    });
  }

  try {
    const res = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query: "", page_size: 1 })
    });
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200);
      return NextResponse.json({
        ok: false,
        connected: true,
        message: `노션 API 오류 ${res.status}: ${text}`
      });
    }
    return NextResponse.json({
      ok: true,
      connected: true,
      message: "통합 토큰 정상",
      checked_at: new Date().toISOString()
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      connected: true,
      message: err instanceof Error ? err.message : "연결 테스트 실패"
    });
  }
}
