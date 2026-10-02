import { NextRequest, NextResponse } from "next/server";
import { connectionAuth } from "@/lib/luna/notion-live/api";
import { finishConnection } from "@/lib/luna/notion-live/connection";
import { LUNA_ORIGIN, NotionConnectionError } from "@/lib/luna/notion-live/policy";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const auth = await connectionAuth(request);
  let status = "connected";
  try {
    if (auth.response) throw new Error("Unauthenticated callback");
    if (request.nextUrl.searchParams.has("error")) throw new NotionConnectionError("cancelled", "취소");
    await finishConnection(auth.admin, auth.user.id, request.nextUrl.searchParams.get("state") || "", request.cookies.get("__Host-luna-notion-oauth")?.value || "", request.nextUrl.searchParams.get("code") || "");
  } catch (error) { status = error instanceof NotionConnectionError ? error.code : "failed"; }
  const response = NextResponse.redirect(`${LUNA_ORIGIN}/luna?notion_connection=${encodeURIComponent(status)}`, 303);
  response.cookies.set("__Host-luna-notion-oauth", "", {httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0});
  response.headers.set("Cache-Control", "no-store"); response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
