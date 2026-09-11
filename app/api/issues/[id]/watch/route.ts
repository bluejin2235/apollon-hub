import { NextRequest, NextResponse } from "next/server";
import { requireIssueUser } from "@/lib/issues/access";

export const runtime = "nodejs";

async function issueIdOf(
  admin: NonNullable<ReturnType<typeof import("@/lib/auth/get-api-user").getServiceSupabase>>,
  key: string
): Promise<string | null> {
  const numeric = /^\d+$/.test(key);
  const query = admin.from("issues").select("id");
  const { data } = numeric
    ? await query.eq("seq", Number(key)).maybeSingle()
    : await query.eq("id", key).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const gate = await requireIssueUser(request);
  if ("error" in gate) return gate.error;
  const { id } = await context.params;
  const issueId = await issueIdOf(gate.admin, id);
  if (!issueId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const { error } = await gate.admin.from("issue_watchers").upsert({
    issue_id: issueId,
    user_id: gate.user.id
  });
  if (error) {
    console.error("[issues] watch", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, watching: true });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const gate = await requireIssueUser(request);
  if ("error" in gate) return gate.error;
  const { id } = await context.params;
  const issueId = await issueIdOf(gate.admin, id);
  if (!issueId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const { error } = await gate.admin
    .from("issue_watchers")
    .delete()
    .eq("issue_id", issueId)
    .eq("user_id", gate.user.id);
  if (error) {
    console.error("[issues] unwatch", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, watching: false });
}
