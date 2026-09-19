import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { getUserMemory } from "@/lib/luna/user-memory";

export const runtime = "nodejs";

/** GET /api/luna/admin/personalization — 사람별 memo 요약 */
export async function GET(request: NextRequest) {
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

  const userId = request.nextUrl.searchParams.get("user_id");
  if (userId) {
    const memory = await getUserMemory(admin, userId);
    const { data: profile } = await admin
      .from("profiles")
      .select("id, name, department")
      .eq("id", userId)
      .maybeSingle();
    return NextResponse.json({
      profile,
      memory,
      promoted: [] as string[]
    });
  }

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, name, department")
    .order("name", { ascending: true })
    .limit(80);

  const rows = [];
  for (const p of profiles ?? []) {
    const memory = await getUserMemory(admin, p.id);
    const { count: convCount } = await admin
      .from("luna_conversations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", p.id);

    const { data: convs } = await admin
      .from("luna_conversations")
      .select("id")
      .eq("user_id", p.id)
      .limit(40);
    const convIds = (convs ?? []).map((c) => c.id as string);
    let thumbsDown = 0;
    let lastAt: string | null = null;
    if (convIds.length > 0) {
      const { data: msgs } = await admin
        .from("luna_messages")
        .select("metadata, created_at")
        .in("conversation_id", convIds)
        .eq("role", "assistant")
        .order("created_at", { ascending: false })
        .limit(80);
      for (const m of msgs ?? []) {
        if (!lastAt && typeof m.created_at === "string") lastAt = m.created_at;
        const meta =
          m.metadata && typeof m.metadata === "object"
            ? (m.metadata as Record<string, unknown>)
            : null;
        if (meta?.feedback === "bad") thumbsDown += 1;
      }
    }

    const memo = memory?.memo?.trim() ?? "";
    rows.push({
      user_id: p.id,
      name: p.name,
      department: p.department,
      memo_chars: memo.length,
      memo_preview: memo ? memo.replace(/\s+/g, " ").slice(0, 80) : "",
      has_memo: memo.length > 0,
      conversations: convCount ?? 0,
      thumbs_down: thumbsDown,
      last_at: lastAt ?? memory?.updated_at ?? null
    });
  }

  rows.sort((a, b) => {
    if (a.has_memo !== b.has_memo) return a.has_memo ? -1 : 1;
    return (b.conversations ?? 0) - (a.conversations ?? 0);
  });

  return NextResponse.json({ people: rows });
}
