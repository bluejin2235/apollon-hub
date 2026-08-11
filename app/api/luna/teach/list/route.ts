import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";

export const runtime = "nodejs";

type LearningRow = {
  id: string;
  content: string;
  category: string;
  status: string;
  origin: string;
  author_id: string | null;
  created_at: string | null;
  use_count: number | null;
  conflict_group: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  raw_input: string | null;
};

export type TeachItem = LearningRow & {
  author_name: string | null;
};

async function requireUser(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return {
      error: NextResponse.json({ error: "Server configuration error" }, { status: 500 })
    };
  }
  return { user, admin };
}

export async function GET(request: NextRequest) {
  const auth = await requireUser(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  const { data, error } = await admin
    .from("luna_learnings")
    .select(
      "id, content, category, status, origin, author_id, created_at, use_count, conflict_group, resolved_by, resolved_at, raw_input"
    )
    .eq("origin", "direct")
    .neq("category", "identity")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[luna/teach/list]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as LearningRow[];
  const authorIds = Array.from(
    new Set(rows.map((r) => r.author_id).filter((id): id is string => Boolean(id)))
  );
  const authorMap = new Map<string, string>();
  if (authorIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, name")
      .in("id", authorIds);
    for (const p of profiles ?? []) {
      authorMap.set(p.id as string, ((p.name as string) || "").trim() || "이름 없음");
    }
  }

  const withNames: TeachItem[] = rows.map((r) => ({
    ...r,
    author_name: r.author_id ? authorMap.get(r.author_id) ?? null : null
  }));

  const history = withNames.filter((r) => r.status === "active");
  const pending = withNames.filter((r) => r.status === "candidate");
  const conflictRows = withNames.filter((r) => r.status === "conflict");

  const groupMap = new Map<string, TeachItem[]>();
  for (const row of conflictRows) {
    const key = row.conflict_group?.trim();
    if (!key) continue;
    const list = groupMap.get(key) ?? [];
    list.push(row);
    groupMap.set(key, list);
  }

  const conflicts = Array.from(groupMap.entries())
    .map(([group, items]) => ({
      group,
      items: items.sort((a, b) =>
        (a.created_at ?? "").localeCompare(b.created_at ?? "")
      )
    }))
    .sort((a, b) => {
      const aAt = a.items[0]?.created_at ?? "";
      const bAt = b.items[0]?.created_at ?? "";
      return bAt.localeCompare(aAt);
    });

  const teachPending = conflicts.length + pending.length;

  return NextResponse.json({
    history,
    conflicts,
    pending,
    teachPending
  });
}
