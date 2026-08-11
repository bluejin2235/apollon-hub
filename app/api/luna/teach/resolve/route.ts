import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { lunaNotify } from "@/lib/luna/notify";

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

  let body: { group?: string; winner_id?: string; merged_content?: string };
  try {
    body = (await request.json()) as {
      group?: string;
      winner_id?: string;
      merged_content?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const group = typeof body.group === "string" ? body.group.trim() : "";
  const winnerId = typeof body.winner_id === "string" ? body.winner_id.trim() : "";
  const mergedContent =
    typeof body.merged_content === "string" ? body.merged_content.trim() : "";

  if (!group || !winnerId) {
    return NextResponse.json({ error: "group and winner_id are required" }, { status: 400 });
  }

  const { data: rows, error: fetchError } = await admin
    .from("luna_learnings")
    .select("id, status, conflict_group")
    .eq("conflict_group", group)
    .eq("status", "conflict");

  if (fetchError) {
    console.error("[luna/teach/resolve] fetch", fetchError);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const members = rows ?? [];
  if (members.length < 2) {
    return NextResponse.json({ error: "Conflict group not found" }, { status: 404 });
  }
  if (!members.some((r) => r.id === winnerId)) {
    return NextResponse.json({ error: "winner_id must belong to the group" }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const winnerUpdate: Record<string, unknown> = {
    status: "active",
    resolved_by: user.id,
    resolved_at: nowIso
  };
  if (mergedContent) {
    winnerUpdate.content = mergedContent;
  }

  const { error: winnerError } = await admin
    .from("luna_learnings")
    .update(winnerUpdate)
    .eq("id", winnerId)
    .eq("conflict_group", group);

  if (winnerError) {
    console.error("[luna/teach/resolve] winner", winnerError);
    return NextResponse.json({ error: winnerError.message }, { status: 500 });
  }

  const loserIds = members.map((r) => r.id as string).filter((id) => id !== winnerId);
  if (loserIds.length > 0) {
    const { error: loserError } = await admin
      .from("luna_learnings")
      .update({
        status: "archived",
        resolved_by: user.id,
        resolved_at: nowIso
      })
      .in("id", loserIds)
      .eq("conflict_group", group);

    if (loserError) {
      console.error("[luna/teach/resolve] losers", loserError);
      return NextResponse.json({ error: loserError.message }, { status: 500 });
    }
  }

  await lunaNotify(
    admin,
    "conflict",
    "충돌 판정 완료",
    "의견 충돌 1건이 판정·정리되었습니다.",
    { level: "success", meta: { group, winner_id: winnerId } }
  );

  return NextResponse.json({ ok: true, group, winner_id: winnerId });
}
