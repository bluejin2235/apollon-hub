import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import {
  normalizeThread,
  type CandidateSource,
  type ThreadTurn
} from "@/lib/luna/candidates";

export const runtime = "nodejs";

type Filter = "all" | "chat" | "selfstudy" | "question" | "mine";

type LearningRow = {
  id: string;
  content: string;
  category: string;
  status: string;
  source: string | null;
  origin: string;
  evidence: string | null;
  scope_suggestion: string | null;
  thread: unknown;
  author_id: string | null;
  assigned_to: string | null;
  source_conversation_id: string | null;
  created_at: string | null;
  meta: Record<string, unknown> | null;
};

export type CandidateItem = LearningRow & {
  author_name: string | null;
  assigned_name: string | null;
  thread: ThreadTurn[];
  source: CandidateSource;
};

function resolveSource(row: LearningRow): CandidateSource {
  const s = row.source;
  if (s === "chat" || s === "selfstudy" || s === "question" || s === "direct") {
    return s;
  }
  return row.origin === "direct" ? "direct" : "chat";
}

export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  const filterRaw = request.nextUrl.searchParams.get("filter") ?? "all";
  const filter: Filter =
    filterRaw === "chat" ||
    filterRaw === "selfstudy" ||
    filterRaw === "question" ||
    filterRaw === "mine"
      ? filterRaw
      : "all";

  let query = admin
    .from("luna_learnings")
    .select(
      "id, content, category, status, source, origin, evidence, scope_suggestion, thread, author_id, assigned_to, source_conversation_id, created_at, meta"
    )
    .eq("status", "candidate")
    .neq("category", "identity")
    .order("created_at", { ascending: false });

  if (filter === "chat" || filter === "selfstudy" || filter === "question") {
    query = query.eq("source", filter);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[luna/candidates] list", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let rows = (data ?? []) as LearningRow[];

  if (filter === "mine") {
    const myConvIds = new Set<string>();
    const { data: convs } = await admin
      .from("luna_conversations")
      .select("id")
      .eq("user_id", user.id);
    for (const c of convs ?? []) {
      if (typeof c.id === "string") myConvIds.add(c.id);
    }
    rows = rows.filter(
      (r) =>
        r.assigned_to === user.id ||
        r.author_id === user.id ||
        (r.source_conversation_id != null &&
          myConvIds.has(r.source_conversation_id))
    );
  }

  const nameIds = Array.from(
    new Set(
      rows
        .flatMap((r) => [r.author_id, r.assigned_to])
        .filter((id): id is string => Boolean(id))
    )
  );
  const nameMap = new Map<string, string>();
  if (nameIds.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, name")
      .in("id", nameIds);
    for (const p of profiles ?? []) {
      nameMap.set(
        p.id as string,
        ((p.name as string) || "").trim() || "이름 없음"
      );
    }
  }

  const items: CandidateItem[] = rows.map((r) => ({
    ...r,
    source: resolveSource(r),
    thread: normalizeThread(r.thread),
    author_name: r.author_id ? nameMap.get(r.author_id) ?? null : null,
    assigned_name: r.assigned_to ? nameMap.get(r.assigned_to) ?? null : null
  }));

  return NextResponse.json({ items, count: items.length });
}
