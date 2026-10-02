import { NextRequest, NextResponse } from "next/server";
import { connectionAuth, connectionError } from "@/lib/luna/notion-live/api";
import { connectionRow } from "@/lib/luna/notion-live/connection";
import { NOTION_TEAMSPACE_NAME } from "@/lib/luna/notion-live/policy";
export async function GET(request: NextRequest) {
  const auth = await connectionAuth(request); if (auth.response) return auth.response;
  try {
    const row = await connectionRow(auth.admin, auth.user.id);
    return NextResponse.json({connected: Boolean(row), teamspace: NOTION_TEAMSPACE_NAME, notion_user_id: row?.notion_user_id || null}, {headers: {"Cache-Control": "no-store"}});
  } catch (error) { return connectionError(error); }
}
export async function DELETE(request: NextRequest) {
  const auth = await connectionAuth(request, true); if (auth.response) return auth.response;
  const result = await auth.admin.from("luna_notion_connections").delete().eq("user_id", auth.user.id);
  const attempts = await auth.admin.from("luna_notion_oauth_attempts").delete().eq("user_id", auth.user.id);
  if (result.error || attempts.error) return connectionError(null);
  return NextResponse.json({connected: false}, {headers: {"Cache-Control": "no-store"}});
}
