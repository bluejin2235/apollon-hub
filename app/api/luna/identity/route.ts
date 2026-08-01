import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { LUNA_DEFAULT_IDENTITY_PROMPT } from "@/lib/luna/constants";

export const runtime = "nodejs";

/** GET: category='identity' 최신 1건 (없으면 기본 프롬프트) */
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
    .from("luna_learnings")
    .select("id, content, category, created_at")
    .eq("category", "identity")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[luna/identity] GET", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    content: data?.content ?? LUNA_DEFAULT_IDENTITY_PROMPT,
    id: data?.id ?? null
  });
}

/** PUT: identity 저장 (기존 identity 삭제 후 1건 insert) — 슈퍼관리자 */
export async function PUT(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  if (!(await isSuperAdminUser(admin, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { content?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const { error: delError } = await admin
    .from("luna_learnings")
    .delete()
    .eq("category", "identity");

  if (delError) {
    console.error("[luna/identity] delete", delError);
    return NextResponse.json({ error: delError.message }, { status: 500 });
  }

  const { data, error } = await admin
    .from("luna_learnings")
    .insert({ category: "identity", content })
    .select("id, content, category, created_at")
    .single();

  if (error) {
    console.error("[luna/identity] insert", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ learning: data });
}
