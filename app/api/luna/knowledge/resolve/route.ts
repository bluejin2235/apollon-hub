import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";

export const runtime = "nodejs";

type ResolveBody = {
  conflict_id?: string;
  action?: string;
  keep_id?: string;
};

function asIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim());
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
  if (!(await isSuperAdminUser(admin, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: ResolveBody;
  try {
    body = (await request.json()) as ResolveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const conflictId =
    typeof body.conflict_id === "string" ? body.conflict_id.trim() : "";
  const action = typeof body.action === "string" ? body.action.trim() : "";
  const keepId = typeof body.keep_id === "string" ? body.keep_id.trim() : "";

  if (!conflictId || !["keep_both", "keep_one", "discard"].includes(action)) {
    return NextResponse.json(
      { error: "conflict_id and valid action required" },
      { status: 400 }
    );
  }
  if (action === "keep_one" && !keepId) {
    return NextResponse.json({ error: "keep_id is required" }, { status: 400 });
  }

  const { data: conflict, error: fetchError } = await admin
    .from("luna_learnings")
    .select("id, status, merged_from")
    .eq("id", conflictId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!conflict || conflict.status !== "conflict") {
    return NextResponse.json({ error: "Conflict not found" }, { status: 404 });
  }

  const sourceIds = asIdList(conflict.merged_from);

  if (action === "keep_both") {
    if (sourceIds.length > 0) {
      const { error } = await admin
        .from("luna_learnings")
        .update({ status: "active" })
        .in("id", sourceIds);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    const { error } = await admin
      .from("luna_learnings")
      .update({ status: "archived" })
      .eq("id", conflictId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "keep_one") {
    if (!sourceIds.includes(keepId)) {
      return NextResponse.json(
        { error: "keep_id must be one of merged_from" },
        { status: 400 }
      );
    }
    const { error: keepError } = await admin
      .from("luna_learnings")
      .update({ status: "active" })
      .eq("id", keepId);
    if (keepError) {
      return NextResponse.json({ error: keepError.message }, { status: 500 });
    }
    const others = sourceIds.filter((id) => id !== keepId);
    if (others.length > 0) {
      const { error } = await admin
        .from("luna_learnings")
        .update({ status: "archived" })
        .in("id", others);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
    const { error } = await admin
      .from("luna_learnings")
      .update({ status: "archived" })
      .eq("id", conflictId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  // discard
  const allIds = Array.from(new Set([...sourceIds, conflictId]));
  const { error } = await admin
    .from("luna_learnings")
    .update({ status: "archived" })
    .in("id", allIds);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
