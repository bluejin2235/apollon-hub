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

  let body: { id?: string; action?: string };
  try {
    body = (await request.json()) as { id?: string; action?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const action = typeof body.action === "string" ? body.action.trim() : "";
  if (!id || (action !== "approve" && action !== "reject")) {
    return NextResponse.json(
      { error: "id and action ('approve'|'reject') required" },
      { status: 400 }
    );
  }

  const nextStatus = action === "approve" ? "active" : "archived";
  const nowIso = new Date().toISOString();

  const { data, error } = await admin
    .from("luna_learnings")
    .update({
      status: nextStatus,
      resolved_by: user.id,
      resolved_at: nowIso
    })
    .eq("id", id)
    .eq("status", "candidate")
    .eq("origin", "direct")
    .select("id, status")
    .maybeSingle();

  if (error) {
    console.error("[luna/teach/review]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Pending learning not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id: data.id, status: data.status });
}
