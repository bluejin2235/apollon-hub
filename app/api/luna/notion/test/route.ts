import { NextRequest, NextResponse } from "next/server";
import { connectionAuth, connectionError } from "@/lib/luna/notion-live/api";
import { userMcp, validateTeamspace } from "@/lib/luna/notion-live/connection";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await connectionAuth(request, true);
  if (auth.response) return auth.response;
  try {
    const {mcp} = await userMcp(auth.admin, auth.user.id, request.signal);
    await validateTeamspace(mcp);
    return NextResponse.json({
      ok: true,
      connected: true,
      message: "본인 노션 연결·팀스페이스 참여 확인 (AI 검색 실증은 별도)",
      checked_at: new Date().toISOString()
    });
  } catch (err) {
    return connectionError(err);
  }
}
