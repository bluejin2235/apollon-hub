import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";

export const runtime = "nodejs";

const PROMPT_SELECT =
  "id, level, kind, prompt_key, title, description, purpose, content, is_active, sort_order, owner_id, version, created_at, updated_at";

export async function POST(request: NextRequest) {
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

  let body: { id?: string; version?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const version =
    typeof body.version === "number" && Number.isFinite(body.version)
      ? Math.trunc(body.version)
      : NaN;
  if (!id || !Number.isFinite(version)) {
    return NextResponse.json({ error: "id and version are required" }, { status: 400 });
  }

  const { data: current, error: curError } = await admin
    .from("luna_prompts")
    .select(PROMPT_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (curError) {
    console.error("[luna/prompts/revert] load", curError);
    return NextResponse.json({ error: curError.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: snap, error: snapError } = await admin
    .from("luna_prompt_versions")
    .select("version, content")
    .eq("target_type", "prompt")
    .eq("target_id", id)
    .eq("version", version)
    .maybeSingle();

  if (snapError) {
    console.error("[luna/prompts/revert] version", snapError);
    return NextResponse.json({ error: snapError.message }, { status: 500 });
  }
  if (!snap?.content || typeof snap.content !== "object") {
    return NextResponse.json({ error: "Version not found" }, { status: 404 });
  }

  const c = snap.content as Record<string, unknown>;
  const title = typeof c.title === "string" ? c.title : (current.title as string);
  const description =
    typeof c.description === "string"
      ? c.description
      : ((current.description as string | null) ?? null);
  const purpose =
    typeof c.purpose === "string"
      ? c.purpose
      : ((current.purpose as string | null) ?? null);
  const content = typeof c.content === "string" ? c.content : (current.content as string);
  const owner_id =
    typeof c.owner_id === "string"
      ? c.owner_id
      : c.owner_id === null
        ? null
        : ((current.owner_id as string | null) ?? null);
  const sort_order =
    typeof c.sort_order === "number"
      ? Math.trunc(c.sort_order)
      : (current.sort_order as number);

  const nextVersion = (current.version as number) + 1;
  const now = new Date().toISOString();
  const changeSummary = `v${version}으로 되돌림`;

  const { data: updated, error: updateError } = await admin
    .from("luna_prompts")
    .update({
      title,
      description,
      purpose,
      content,
      owner_id,
      sort_order,
      version: nextVersion,
      updated_at: now
    })
    .eq("id", id)
    .select(PROMPT_SELECT)
    .maybeSingle();

  if (updateError) {
    console.error("[luna/prompts/revert] update", updateError);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { error: verInsertError } = await admin.from("luna_prompt_versions").insert({
    target_type: "prompt",
    target_id: id,
    version: nextVersion,
    content: {
      title,
      description,
      purpose,
      content,
      owner_id,
      sort_order
    },
    change_summary: changeSummary,
    changed_by: user.id,
    changed_by_luna: false
  });

  if (verInsertError) {
    console.error("[luna/prompts/revert] insert version", verInsertError);
    return NextResponse.json({ error: verInsertError.message }, { status: 500 });
  }

  return NextResponse.json({ prompt: updated });
}
