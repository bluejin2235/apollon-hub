import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { hasLunaAccess } from "@/lib/luna/beta-access";
import { LUNA_ORIGIN, NotionConnectionError } from "./policy";
export async function connectionAuth(request: NextRequest, mutation = false) {
  if (mutation && request.headers.get("origin") !== LUNA_ORIGIN) return {response: NextResponse.json({error: "Forbidden"}, {status: 403})};
  const user = await getApiUser(request), admin = getServiceSupabase();
  if (!user) return {response: NextResponse.json({error: "로그인이 필요합니다."}, {status: 401})};
  if (!admin || !(await hasLunaAccess(admin, user.id))) return {response: NextResponse.json({error: "접근 권한이 없습니다."}, {status: 403})};
  return {user, admin};
}
export function connectionError(error: unknown) {
  return NextResponse.json({error: error instanceof NotionConnectionError ? error.message : "노션 연결 요청을 완료하지 못했습니다.", code: error instanceof NotionConnectionError ? error.code : "unavailable"}, {status: 400, headers: {"Cache-Control": "no-store"}});
}
