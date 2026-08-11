import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";

export const runtime = "nodejs";

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

  let body: { ids?: unknown };
  try {
    body = (await request.json()) as { ids?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
    : [];

  if (ids.length !== 2 || ids[0] === ids[1]) {
    return NextResponse.json({ error: "ids must be two distinct uuids" }, { status: 400 });
  }

  const { data: rows, error: fetchError } = await admin
    .from("luna_learnings")
    .select("id, status, origin")
    .in("id", ids);

  if (fetchError) {
    console.error("[luna/teach/conflict] fetch", fetchError);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if ((rows ?? []).length !== 2) {
    return NextResponse.json({ error: "Both learnings must exist" }, { status: 404 });
  }

  for (const row of rows ?? []) {
    if (row.origin !== "direct") {
      return NextResponse.json({ error: "Only direct learnings can conflict" }, { status: 400 });
    }
    if (row.status !== "active") {
      return NextResponse.json(
        { error: "Only active learnings can be marked as conflict" },
        { status: 400 }
      );
    }
  }

  const group = randomUUID();
  const { error: updateError } = await admin
    .from("luna_learnings")
    .update({ status: "conflict", conflict_group: group })
    .in("id", ids);

  if (updateError) {
    console.error("[luna/teach/conflict] update", updateError);
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, group, ids });
}
