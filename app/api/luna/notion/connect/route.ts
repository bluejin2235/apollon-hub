import { NextRequest, NextResponse } from "next/server";
import { connectionAuth, connectionError } from "@/lib/luna/notion-live/api";
import { beginConnection } from "@/lib/luna/notion-live/connection";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const auth = await connectionAuth(request, true); if (auth.response) return auth.response;
  try {
    const {url, binding} = await beginConnection(auth.admin, auth.user.id);
    const response = NextResponse.json({url}, {headers: {"Cache-Control": "no-store"}});
    response.cookies.set("__Host-luna-notion-oauth", binding, {httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600});
    return response;
  } catch (error) { return connectionError(error); }
}
