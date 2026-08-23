import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const { data, error } = await admin
    .from("luna_media_favorites")
    .select("path")
    .eq("user_id", user.id);

  if (error) {
    console.error("[luna/media/favorites] GET", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const paths = (data ?? [])
    .map((r) => String((r as { path?: string }).path ?? ""))
    .filter(Boolean);
  return NextResponse.json({ paths });
}

export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let body: { path?: unknown; favorited?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const path = typeof body.path === "string" ? body.path.trim() : "";
  if (!path) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  const favorited = body.favorited !== false;

  if (favorited) {
    const { error } = await admin.from("luna_media_favorites").upsert(
      { user_id: user.id, path, created_at: new Date().toISOString() },
      { onConflict: "user_id,path" }
    );
    if (error) {
      console.error("[luna/media/favorites] POST", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ path, favorited: true });
  }

  const { error } = await admin
    .from("luna_media_favorites")
    .delete()
    .eq("user_id", user.id)
    .eq("path", path);
  if (error) {
    console.error("[luna/media/favorites] DELETE", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ path, favorited: false });
}
