import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";

export const runtime = "nodejs";

type Row = {
  id: string;
  content: string;
  status: string;
  origin: string | null;
  source: string | null;
  author_id: string | null;
  created_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  conflict_group: string | null;
  merged_from: unknown;
  review_reason: string | null;
};

function asIdList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
}

async function requireSuperAdmin(request: NextRequest) {
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
  if (!(await isSuperAdminUser(admin, user))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user, admin };
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  const { data: conflictRows, error } = await admin
    .from("luna_learnings")
    .select(
      "id, content, status, origin, source, author_id, created_at, resolved_at, resolved_by, conflict_group, merged_from, review_reason"
    )
    .eq("status", "conflict")
    .neq("category", "identity")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[luna/knowledge/conflicts] GET", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (conflictRows ?? []) as Row[];
  const authorIds = new Set<string>();
  const relatedIds = new Set<string>();

  for (const r of rows) {
    if (r.author_id) authorIds.add(r.author_id);
    for (const id of asIdList(r.merged_from)) relatedIds.add(id);
  }

  if (relatedIds.size > 0) {
    const { data: related } = await admin
      .from("luna_learnings")
      .select("id, author_id")
      .in("id", Array.from(relatedIds));
    for (const rel of related ?? []) {
      if (rel.author_id) authorIds.add(rel.author_id as string);
    }
  }

  const authorMap = new Map<string, string>();
  if (authorIds.size > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, name")
      .in("id", Array.from(authorIds));
    for (const p of profiles ?? []) {
      authorMap.set(p.id as string, ((p.name as string) || "").trim() || "—");
    }
  }

  const relatedMap = new Map<
    string,
    { id: string; content: string; source: string | null; origin: string | null; author_name: string | null; created_at: string | null }
  >();
  if (relatedIds.size > 0) {
    const { data: related } = await admin
      .from("luna_learnings")
      .select("id, content, source, origin, author_id, created_at")
      .in("id", Array.from(relatedIds));
    for (const rel of related ?? []) {
      relatedMap.set(rel.id as string, {
        id: rel.id as string,
        content: rel.content as string,
        source: (rel.source as string) ?? null,
        origin: (rel.origin as string) ?? null,
        author_name: rel.author_id
          ? authorMap.get(rel.author_id as string) ?? null
          : null,
        created_at: (rel.created_at as string) ?? null
      });
    }
  }

  const groupMap = new Map<string, Row[]>();
  const mergedConflicts: Array<{
    id: string;
    title: string;
    options: Array<{
      id: string;
      content: string;
      author_name: string | null;
      created_at: string | null;
      source: string | null;
      origin: string | null;
    }>;
    pending_days: number | null;
  }> = [];

  for (const row of rows) {
    const mergedIds = asIdList(row.merged_from);
    if (mergedIds.length > 0) {
      const options = mergedIds
        .map((id) => relatedMap.get(id))
        .filter((x): x is NonNullable<typeof x> => Boolean(x));
      const oldest = options
        .map((o) => o.created_at)
        .filter(Boolean)
        .sort()[0];
      const days = oldest
        ? Math.max(
            0,
            Math.floor((Date.now() - new Date(oldest).getTime()) / (24 * 60 * 60 * 1000))
          )
        : null;
      mergedConflicts.push({
        id: row.id,
        title: row.content.slice(0, 40) || "충돌",
        options,
        pending_days: days
      });
      continue;
    }

    const key = row.conflict_group?.trim();
    if (!key) continue;
    const list = groupMap.get(key) ?? [];
    list.push(row);
    groupMap.set(key, list);
  }

  const groups = Array.from(groupMap.entries())
    .map(([group, items]) => {
      const sorted = items.sort((a, b) =>
        (a.created_at ?? "").localeCompare(b.created_at ?? "")
      );
      const oldest = sorted[0]?.created_at;
      const days = oldest
        ? Math.max(
            0,
            Math.floor((Date.now() - new Date(oldest).getTime()) / (24 * 60 * 60 * 1000))
          )
        : null;
      return {
        group,
        kind: "group" as const,
        title: sorted[0]?.content.slice(0, 24) || "충돌",
        pending_days: days,
        options: sorted.map((item) => ({
          id: item.id,
          content: item.content,
          author_name: item.author_id
            ? authorMap.get(item.author_id) ?? null
            : null,
          created_at: item.created_at,
          source: item.source,
          origin: item.origin
        }))
      };
    })
    .sort((a, b) => (b.options[0]?.created_at ?? "").localeCompare(a.options[0]?.created_at ?? ""));

  const conflicts = [
    ...groups,
    ...mergedConflicts.map((c) => ({
      group: c.id,
      kind: "merged" as const,
      title: c.title,
      pending_days: c.pending_days,
      options: c.options
    }))
  ];

  const { data: historyRows } = await admin
    .from("luna_learnings")
    .select(
      "id, content, status, conflict_group, resolved_at, resolved_by, review_reason, merged_from"
    )
    .not("resolved_at", "is", null)
    .or("conflict_group.not.is.null,review_reason.eq.contradiction")
    .neq("category", "identity")
    .order("resolved_at", { ascending: false })
    .limit(30);

  const resolverIds = new Set<string>();
  for (const h of historyRows ?? []) {
    if (h.resolved_by) resolverIds.add(h.resolved_by as string);
  }
  const resolverMap = new Map<string, string>();
  if (resolverIds.size > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, name")
      .in("id", Array.from(resolverIds));
    for (const p of profiles ?? []) {
      resolverMap.set(p.id as string, ((p.name as string) || "").trim() || "—");
    }
  }

  const seenGroups = new Set<string>();
  const history: Array<{
    id: string;
    label: string;
    summary: string;
    resolved_at: string;
    resolver_name: string | null;
  }> = [];

  for (const h of historyRows ?? []) {
    const group = (h.conflict_group as string | null)?.trim();
    if (group) {
      if (seenGroups.has(group)) continue;
      seenGroups.add(group);
    }

    const status = h.status as string;
    const mergedCount = asIdList(h.merged_from).length;
    let label = "처리";
    if (status === "active" && mergedCount >= 2) label = "병합 확정";
    else if (status === "active") label = "확정";
    else if (status === "archived") label = "폐기";

    history.push({
      id: group ?? (h.id as string),
      label,
      summary: (h.content as string) || "—",
      resolved_at: h.resolved_at as string,
      resolver_name: h.resolved_by
        ? resolverMap.get(h.resolved_by as string) ?? null
        : null
    });
    if (history.length >= 10) break;
  }

  return NextResponse.json({ conflicts, history });
}
