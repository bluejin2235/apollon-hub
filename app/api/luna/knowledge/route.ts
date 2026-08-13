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
  source_id: string | null;
};

const SELECT_FIELDS =
  "id, content, category, status, confidence, use_count, last_used_at, created_at, resolved_at, author_id, merged_from, importance, origin, source, scope_suggestion, evidence, source_conversation_id, source_id";

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

  // 단건 상세 + 변경 이력
  const detailId = (url.searchParams.get("id") ?? "").trim();
  if (detailId) {
    const { data: row, error } = await admin
      .from("luna_learnings")
      .select(SELECT_FIELDS)
      .eq("id", detailId)
      .neq("category", "identity")
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let source_title: string | null = null;
    const sourceId =
      typeof row.source_id === "string" ? row.source_id : null;
    if (sourceId) {
      const { data: src } = await admin
        .from("luna_knowledge_sources")
        .select("title")
        .eq("id", sourceId)
        .maybeSingle();
      if (typeof src?.title === "string" && src.title.trim()) {
        source_title = src.title.trim();
      }
    }

    const { data: versions, error: verError } = await admin
      .from("luna_learning_versions")
      .select(
        "id, version, content, status, change_note, edited_by, editor_name, created_at"
      )
      .eq("learning_id", detailId)
      .order("version", { ascending: false })
      .limit(50);
    if (verError) {
      console.error("[luna/knowledge] versions", verError);
    }

    return NextResponse.json({
      item: { ...row, source_title },
      versions: versions ?? [],
      can_manage: true
    });
  }

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

  const sourceIds = Array.from(
    new Set(
      rows
        .map((r) => r.source_id)
        .filter((id): id is string => typeof id === "string" && Boolean(id))
    )
  );
  const sourceTitleMap = new Map<string, string>();
  if (sourceIds.length > 0) {
    const { data: sources } = await admin
      .from("luna_knowledge_sources")
      .select("id, title")
      .in("id", sourceIds);
    for (const s of sources ?? []) {
      const title = typeof s.title === "string" ? s.title.trim() : "";
      if (title) sourceTitleMap.set(s.id as string, title);
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
      source_title: r.source_id ? sourceTitleMap.get(r.source_id) ?? null : null,
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
    stats,
    can_manage: true
  });
}

async function appendLearningVersion(
  admin: NonNullable<ReturnType<typeof getServiceSupabase>>,
  opts: {
    learningId: string;
    content: string;
    status: string | null;
    changeNote: string | null;
    editedBy: string;
    editorName: string | null;
  }
) {
  const { data: last } = await admin
    .from("luna_learning_versions")
    .select("version")
    .eq("learning_id", opts.learningId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion =
    typeof last?.version === "number" && Number.isFinite(last.version)
      ? last.version + 1
      : 1;

  const { error } = await admin.from("luna_learning_versions").insert({
    learning_id: opts.learningId,
    version: nextVersion,
    content: opts.content,
    status: opts.status,
    change_note: opts.changeNote,
    edited_by: opts.editedBy,
    editor_name: opts.editorName
  });

  if (error) {
    console.error("[luna/knowledge] version insert", error);
    throw error;
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin, user } = auth;

  let body: {
    id?: string;
    status?: string;
    content?: string;
    scope_suggestion?: string | null;
    change_note?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const nextStatus =
    typeof body.status === "string" ? body.status.trim() : "";
  const nextContent =
    typeof body.content === "string" ? body.content.trim() : "";
  const changeNote =
    typeof body.change_note === "string" ? body.change_note.trim() : "";
  const hasScope =
    Object.prototype.hasOwnProperty.call(body, "scope_suggestion");
  const nextScopeRaw = body.scope_suggestion;
  const nextScope =
    nextScopeRaw === "org" || nextScopeRaw === "personal"
      ? nextScopeRaw
      : nextScopeRaw === null || nextScopeRaw === ""
        ? null
        : undefined;

  if (!nextStatus && !nextContent && !hasScope) {
    return NextResponse.json(
      { error: "status, content, or scope_suggestion required" },
      { status: 400 }
    );
  }
  if (nextStatus && !STATUSES.has(nextStatus)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }
  if ((nextContent || nextStatus || hasScope) && !changeNote) {
    return NextResponse.json(
      { error: "change_note is required" },
      { status: 400 }
    );
  }

  const { data: row, error: fetchError } = await admin
    .from("luna_learnings")
    .select("id, content, status, category, scope_suggestion")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!row || row.category === "identity") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const patch: Record<string, unknown> = {};
  if (nextStatus && nextStatus !== row.status) patch.status = nextStatus;
  if (nextContent && nextContent !== row.content) patch.content = nextContent;
  if (hasScope && nextScope !== undefined) {
    const prevScope =
      row.scope_suggestion === "org" || row.scope_suggestion === "personal"
        ? row.scope_suggestion
        : null;
    if (nextScope !== prevScope) patch.scope_suggestion = nextScope;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .maybeSingle();
  const editorName =
    typeof profile?.name === "string" && profile.name.trim()
      ? profile.name.trim()
      : null;

  const note =
    changeNote ||
    (nextStatus === "conflict"
      ? "보류"
      : nextStatus === "archived"
        ? "폐기"
        : nextStatus
          ? `상태 변경 → ${nextStatus}`
          : null);

  try {
    await appendLearningVersion(admin, {
      learningId: id,
      content: row.content as string,
      status: row.status as string,
      changeNote: note,
      editedBy: user.id,
      editorName
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "version history failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const { error } = await admin
    .from("luna_learnings")
    .update(patch)
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
