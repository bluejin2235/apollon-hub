import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { connectionRow } from "@/lib/luna/notion-live/connection";
import { bridgeConfig, getOriginalNotionAnswer } from "@/lib/luna/notion-answer/bridge";
import { AnswerBridgeError } from "@/lib/luna/notion-answer/protocol";

export const runtime = "nodejs";
export const maxDuration = 300;
const headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"};
export async function POST(request: NextRequest) {
  const user = await getApiUser(request), admin = getServiceSupabase();
  if (!user) return NextResponse.json({error: "로그인이 필요합니다."}, {status: 401, headers});
  if (!admin || !(await isSuperAdminUser(admin, user))) return NextResponse.json({error: "원본 연결 검증은 관리자 전용입니다."}, {status: 403, headers});
  try {
    bridgeConfig(user.id); // Disabled unless a real, scoped browser executor is ready.
    const body = await request.json().catch(() => null);
    if (!body || typeof body.question !== "string" || !body.question.trim() || body.question.length > 12000) {
      return NextResponse.json({error: "질문을 확인해 주세요."}, {status: 400, headers});
    }
    const connection = await connectionRow(admin, user.id);
    if (!connection) return NextResponse.json({code: "notion_connect", error: "내 노션 계정을 연결해 주세요."}, {status: 409, headers});
    const started = Date.now();
    const answer = await getOriginalNotionAnswer({userId: user.id, notionUserId: connection.notion_user_id,
      workspaceId: connection.workspace_id, connectionRevision: connection.revision}, body.question, request.signal);
    const current = await connectionRow(admin, user.id);
    request.signal.throwIfAborted();
    if (!current || current.revision !== connection.revision || current.notion_user_id !== connection.notion_user_id || current.workspace_id !== connection.workspace_id) {
      throw new AnswerBridgeError("connection_changed", "검색 중 노션 연결이 변경되어 답변을 사용하지 않았습니다.");
    }
    // No DB/index/LLM fallback; no shared conversation, learning or report writes.
    return NextResponse.json({source: answer.source, request_id: answer.requestId,
      original_text: answer.text, original_text_sha256: answer.textSha256,
      citations: answer.citations, notion_chat_url: answer.chatUrl,
      duration_ms: Date.now() - started, status: answer.status}, {headers});
  } catch (error) {
    if (request.signal.aborted) return new Response(null, {status: 499, headers});
    const known = error instanceof AnswerBridgeError;
    return NextResponse.json({code: known ? error.code : "unavailable",
      error: known ? error.message : "노션 AI 원본 답변을 가져오지 못했습니다. 대체 답변은 생성하지 않습니다."},
    {status: known && error.code === "not_ready" ? 503 : 502, headers});
  }
}
