import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { kstWeekBounds } from "@/lib/luna/self-report";

export const runtime = "nodejs";

const PAGE_SIZE = 20;
const STATUSES = new Set(["active", "candidate", "conflict", "archived"]);

type LearningRow = {
  id: string;
  content: string;
  category: string;
  status: string;
  confidence: number | null;
  use_count: number | null;
  last_used_at: string | null;
  created_at: string;
  resolved_at: string | null;
  author_id: string | null;
  merged_from: unknown;
  importance: number | null;
  origin: string | null;
  source: string | null;
  scope_suggestion: string | null;
  evidence: string | null;
  source_conversation_id: string | null;
};

const SELECT_FIELDS =
  "id, content, category, status, confidence, use_count, last_used_at, created_at, resolved_at, author_id, merged_from, importance, origin, source, scope_suggestion, evidence, source_conversation_id";

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

async function countByStatus(
  admin: NonNullable<ReturnType<typeof getServiceSupabase>>
) {
  const statuses = ["active", "conflict", "candidate", "archived"] as const;
  const counts: Record<(typeof statuses)[number], number> = {
    active: 0,
    conflict: 0,
    candidate: 0,
    archived: 0
  };
  await Promise.all(
    statuses.map(async (status) => {
      const { count, error } = await admin
        .from("luna_learnings")
        .select("id", { count: "exact", head: true })
        .eq("status", status)
        .neq("category", "identity");
      if (error) {
        console.error("[luna/knowledge] count", status, error);
        return;
      }
      counts[status] = count ?? 0;
    })
  );
  return counts;
}

async function activeStats(admin: NonNullable<ReturnType<typeof getServiceSupabase>>) {
  const week = kstWeekBounds();
  const base = () =>
    admin
      .from("luna_learnings")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .neq("category", "identity");

  const [total, weekNew, org, personal] = await Promise.all([
    base(),
    base()
      .gte("resolved_at", week.startIso)
      .lt("resolved_at", week.endIso),
    base().eq("scope_suggestion", "org"),
    base().eq("scope_suggestion", "personal")
  ]);

  return {
    total: total.count ?? 0,
    week_new: weekNew.count ?? 0,
    org: org.count ?? 0,
    personal: personal.count ?? 0
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  const url = request.nextUrl;
  const statusRaw = url.searchParams.get("status") ?? "active";
  const status = STATUSES.has(statusRaw) ? statusRaw : "active";
  const sort = url.searchParams.get("sort") ?? "recent";
  const scope = url.searchParams.get("scope");
  const q = (url.searchParams.get("q") ?? "").trim();
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = admin
    .from("luna_learnings")
    .select(SELECT_FIELDS, { count: "exact" })
    .eq("status", status)
    .neq("category", "identity");

  if (scope === "org" || scope === "personal") {
    query = query.eq("scope_suggestion", scope);
  }

  if (q) {
    query = query.ilike("content", `%${q.replace(/[%_]/g, "")}%`);
  }

  if (sort === "most_used") {
    query = query
      .order("use_count", { ascending: false })
      .order("created_at", { ascending: false });
  } else if (sort === "oldest") {
    query = query.order("created_at", { ascending: true });
  } else if (sort === "unused") {
    query = query
      .order("use_count", { ascending: true })
      .order("created_at", { ascending: true });
  } else if (status === "active") {
    query = query
      .order("resolved_at", { ascending: false })
      .order("created_at", { ascending: false });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  const { data, error, count } = await query.range(from, to);
  if (error) {
    console.error("[luna/knowledge] GET", error);
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
      authorMap.set(p.id as string, (p.name as string) || "");
    }
  }

  const relatedIds = new Set<string>();
  if (status === "conflict") {
    for (const r of rows) {
      const from = Array.isArray(r.merged_from) ? r.merged_from : [];
      for (const id of from) {
        if (typeof id === "string" && id.trim()) relatedIds.add(id.trim());
      }
    }
  }

  const relatedMap = new Map<string, { id: string; content: string; category: string }>();
  if (relatedIds.size > 0) {
    const { data: related } = await admin
      .from("luna_learnings")
      .select("id, content, category")
      .in("id", Array.from(relatedIds));
    for (const r of related ?? []) {
      relatedMap.set(r.id as string, {
        id: r.id as string,
        content: r.content as string,
        category: r.category as string
      });
    }
  }

  const items = rows.map((r) => {
    const from = Array.isArray(r.merged_from) ? r.merged_from : [];
    const related = from
      .filter((id): id is string => typeof id === "string")
      .map((id) => relatedMap.get(id))
      .filter((x): x is { id: string; content: string; category: string } => Boolean(x));
    return {
      ...r,
      author_name: r.author_id ? authorMap.get(r.author_id) || null : null,
      related
    };
  });

  const [counts, stats] = await Promise.all([
    countByStatus(admin),
    status === "active" ? activeStats(admin) : Promise.resolve(null)
  ]);

  return NextResponse.json({
    items,
    page,
    page_size: PAGE_SIZE,
    total: count ?? 0,
    counts,
    stats
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  let body: { id?: string; status?: string };
  try {
    body = (await request.json()) as { id?: string; status?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const status = typeof body.status === "string" ? body.status.trim() : "";
  if (!id || !STATUSES.has(status)) {
    return NextResponse.json({ error: "id and valid status required" }, { status: 400 });
  }

  const { error } = await admin
    .from("luna_learnings")
    .update({ status })
    .eq("id", id)
    .neq("category", "identity");

  if (error) {
    console.error("[luna/knowledge] PATCH", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  let body: { id?: string };
  try {
    body = (await request.json()) as { id?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const { data: row, error: fetchError } = await admin
    .from("luna_learnings")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (row.status !== "archived") {
    return NextResponse.json(
      { error: "Only archived knowledge can be deleted" },
      { status: 400 }
    );
  }

  const { error } = await admin.from("luna_learnings").delete().eq("id", id);
  if (error) {
    console.error("[luna/knowledge] DELETE", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
