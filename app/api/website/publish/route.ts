import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { canAccessWebsiteAdmin } from "@/lib/auth/website-tester";
import { websiteAdminFetch } from "@/lib/website/client";
import { applyHubActorHeaders, getHubActor } from "@/lib/website/hub-actor";

export const runtime = "nodejs";

/**
 * POST /api/website/publish
 * publish/history 폴더가 생기면서 catch-all 이 이 경로를 못 받습니다.
 */
export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const actor = await getHubActor(admin, user.id);
  if (!canAccessWebsiteAdmin(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const text = await request.text();
  let body = text;
  if (text) {
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      if (!json.publishedBy) json.publishedBy = user.id;
      body = JSON.stringify(json);
    } catch {
      body = text;
    }
  }

  const headers = new Headers({ "Content-Type": "application/json" });
  applyHubActorHeaders(headers, user.id, actor.name);
  const { status, body: responseBody } = await websiteAdminFetch("/api/admin/publish", {
    method: "POST",
    headers,
    body
  });
  return NextResponse.json(responseBody, { status });
}
