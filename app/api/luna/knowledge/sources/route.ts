import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  asTermIds,
  asTopic,
  formatRangeLabel,
  kstYmd,
  resolvePeriodRange,
  type PeriodKey
} from "@/lib/luna/knowledge-sources";

export const runtime = "nodejs";

type SourceRow = {
  id: string;
  title: string;
  body: string;
  source_type: string;
  spoken_by: string | null;
  spoken_at: string | null;
  source_ref: string | null;
  meta: unknown;
  created_at: string;
  updated_at: string;
};

type LearningRow = {
  id: string;
  content: string;
  status: string;
  scope_suggestion: string | null;
  source_id: string | null;
};

type TermRow = {
  id: string;
  term_ko: string;
  term_en: string | null;
  term_zh: string | null;
  definition: string | null;
};

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

function parsePeriod(raw: string | null): PeriodKey {
  if (raw === "7" || raw === "30" || raw === "90" || raw === "all" || raw === "custom") {
    return raw;
  }
  return "30";
}

function inRange(
  spokenAt: string | null,
  from: string | null,
  to: string | null
): boolean {
  if (!from && !to) return true;
  if (!spokenAt) return false;
  if (from && spokenAt < from) return false;
  if (to && spokenAt > to) return false;
  return true;
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  const url = request.nextUrl;
  const period = parsePeriod(url.searchParams.get("period"));
  const range = resolvePeriodRange(
    period,
    url.searchParams.get("from"),
    url.searchParams.get("to")
  );
  const month =
    url.searchParams.get("month") ||
    (range.to ?? kstYmd()).slice(0, 7);
  const dateFilter = url.searchParams.get("date");
  const topicFilter = url.searchParams.get("topic");
  const speakerFilter = url.searchParams.get("spoken_by");
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const sort = url.searchParams.get("sort") === "oldest" ? "oldest" : "recent";

  const { data, error } = await admin
    .from("luna_knowledge_sources")
    .select(
      "id, title, body, source_type, spoken_by, spoken_at, source_ref, meta, created_at, updated_at"
    )
    .order("spoken_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[luna/knowledge/sources] GET", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const all = (data ?? []) as SourceRow[];
  const inPeriod = all.filter((s) => inRange(s.spoken_at, range.from, range.to));

  const dateFacetMap = new Map<string, number>();
  const topicFacetMap = new Map<string, number>();
  const speakerFacetMap = new Map<string, number>();

  for (const s of inPeriod) {
    if (s.spoken_at) {
      const ym = s.spoken_at.slice(0, 7);
      if (ym === month) {
        dateFacetMap.set(s.spoken_at, (dateFacetMap.get(s.spoken_at) ?? 0) + 1);
      }
    }
    const topic = asTopic(s.meta);
    topicFacetMap.set(topic, (topicFacetMap.get(topic) ?? 0) + 1);
    const speaker = s.spoken_by?.trim() || "—";
    speakerFacetMap.set(speaker, (speakerFacetMap.get(speaker) ?? 0) + 1);
  }

  let filtered = inPeriod;
  if (dateFilter && /^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) {
    filtered = filtered.filter((s) => s.spoken_at === dateFilter);
  }
  if (topicFilter) {
    filtered = filtered.filter((s) => asTopic(s.meta) === topicFilter);
  }
  if (speakerFilter) {
    filtered = filtered.filter(
      (s) => (s.spoken_by?.trim() || "—") === speakerFilter
    );
  }
  if (q) {
    filtered = filtered.filter((s) => {
      const hay = `${s.title}\n${s.body}\n${s.spoken_by ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }

  filtered = [...filtered].sort((a, b) => {
    const aKey = a.spoken_at || a.created_at.slice(0, 10);
    const bKey = b.spoken_at || b.created_at.slice(0, 10);
    if (aKey === bKey) {
      return sort === "oldest"
        ? a.created_at.localeCompare(b.created_at)
        : b.created_at.localeCompare(a.created_at);
    }
    return sort === "oldest" ? aKey.localeCompare(bKey) : bKey.localeCompare(aKey);
  });

  const sourceIds = filtered.map((s) => s.id);
  const learningBySource = new Map<string, LearningRow[]>();
  if (sourceIds.length > 0) {
    const { data: learnings, error: learnErr } = await admin
      .from("luna_learnings")
      .select("id, content, status, scope_suggestion, source_id")
      .in("source_id", sourceIds)
      .neq("category", "identity");
    if (learnErr) {
      console.error("[luna/knowledge/sources] learnings", learnErr);
      return NextResponse.json({ error: learnErr.message }, { status: 500 });
    }
    for (const row of (learnings ?? []) as LearningRow[]) {
      if (!row.source_id) continue;
      const list = learningBySource.get(row.source_id) ?? [];
      list.push(row);
      learningBySource.set(row.source_id, list);
    }
  }

  const allTermIds = new Set<string>();
  let anyTermIds = false;
  for (const s of filtered) {
    const ids = asTermIds(s.meta);
    if (ids) {
      anyTermIds = true;
      for (const id of ids) allTermIds.add(id);
    }
  }

  const termMap = new Map<string, TermRow>();
  if (allTermIds.size > 0) {
    const { data: terms, error: termErr } = await admin
      .from("glossary_terms")
      .select("id, term_ko, term_en, term_zh, definition")
      .in("id", Array.from(allTermIds));
    if (termErr) {
      console.error("[luna/knowledge/sources] terms", termErr);
    } else {
      for (const t of (terms ?? []) as TermRow[]) {
        termMap.set(t.id, t);
      }
    }
  }

  // Period-wide learning/term stats (not list-filter scoped)
  const periodIds = inPeriod.map((s) => s.id);
  let periodLearningCount = 0;
  let periodConflictCount = 0;
  if (periodIds.length > 0) {
    const { data: periodLearnings } = await admin
      .from("luna_learnings")
      .select("id, status, source_id")
      .in("source_id", periodIds)
      .neq("category", "identity");
    for (const row of periodLearnings ?? []) {
      periodLearningCount += 1;
      if (row.status === "conflict") periodConflictCount += 1;
    }
  }

  let periodTermCount: number | null = null;
  let termsStatOmittedReason: string | null = null;
  const periodTermIds = new Set<string>();
  let periodHasTermIds = false;
  for (const s of inPeriod) {
    const ids = asTermIds(s.meta);
    if (ids) {
      periodHasTermIds = true;
      for (const id of ids) periodTermIds.add(id);
    }
  }
  if (!periodHasTermIds) {
    termsStatOmittedReason =
      "meta.term_ids 가 없어 여기서 나온 용어 수를 집계할 수 없습니다.";
  } else {
    periodTermCount = periodTermIds.size;
  }

  const latest = inPeriod
    .filter((s) => s.spoken_at || s.created_at)
    .sort((a, b) => {
      const aKey = a.spoken_at || a.created_at;
      const bKey = b.spoken_at || b.created_at;
      return bKey.localeCompare(aKey);
    })[0];

  const notes: string[] = [];
  if (!anyTermIds && filtered.length > 0) {
    notes.push(
      "연결된 원문에 meta.term_ids 가 없어 용어 섹션을 생략했습니다."
    );
  }
  if (periodConflictCount === 0) {
    // no note needed
  }

  const items = filtered.map((s) => {
    const learnings = learningBySource.get(s.id) ?? [];
    const conflictCount = learnings.filter((l) => l.status === "conflict").length;
    const termIds = asTermIds(s.meta);
    let terms: TermRow[] | null = null;
    let termsOmittedReason: string | null = null;
    if (!termIds) {
      termsOmittedReason = "meta.term_ids 없음";
    } else {
      terms = termIds
        .map((id) => termMap.get(id))
        .filter((t): t is TermRow => Boolean(t));
    }
    return {
      id: s.id,
      title: s.title,
      body: s.body,
      source_type: s.source_type,
      spoken_by: s.spoken_by,
      spoken_at: s.spoken_at,
      source_ref: s.source_ref,
      topic: asTopic(s.meta),
      meta: s.meta,
      created_at: s.created_at,
      updated_at: s.updated_at,
      learning_count: learnings.length,
      term_count: terms ? terms.length : null,
      conflict_count: conflictCount,
      learnings: learnings.map((l) => ({
        id: l.id,
        content: l.content,
        status: l.status,
        scope_suggestion: l.scope_suggestion
      })),
      terms,
      terms_omitted_reason: termsOmittedReason
    };
  });

  return NextResponse.json({
    range: {
      from: range.from,
      to: range.to,
      label: formatRangeLabel(range.from, range.to),
      count: inPeriod.length
    },
    month,
    stats: {
      sources: inPeriod.length,
      learnings: periodLearningCount,
      terms: periodTermCount,
      terms_omitted_reason: termsStatOmittedReason,
      latest: latest
        ? {
            spoken_at: latest.spoken_at,
            spoken_by: latest.spoken_by
          }
        : null
    },
    facets: {
      dates: Array.from(dateFacetMap.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => b.date.localeCompare(a.date)),
      topics: [
        { topic: "", label: "전체", count: inPeriod.length },
        ...Array.from(topicFacetMap.entries())
          .map(([topic, count]) => ({ topic, label: topic, count }))
          .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
      ],
      speakers: [
        { spoken_by: "", label: "전체", count: inPeriod.length },
        ...Array.from(speakerFacetMap.entries())
          .map(([spoken_by, count]) => ({
            spoken_by,
            label: spoken_by,
            count
          }))
          .sort((a, b) => b.count - a.count || a.spoken_by.localeCompare(b.spoken_by))
      ]
    },
    items,
    notes
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  let body: {
    title?: string;
    body?: string;
    spoken_by?: string;
    spoken_at?: string;
    topic?: string;
    source_type?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!title || !text) {
    return NextResponse.json(
      { error: "title and body are required" },
      { status: 400 }
    );
  }

  const spokenBy =
    typeof body.spoken_by === "string" ? body.spoken_by.trim() || null : null;
  const spokenAt =
    typeof body.spoken_at === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.spoken_at.trim())
      ? body.spoken_at.trim()
      : null;
  const topic =
    typeof body.topic === "string" ? body.topic.trim() : "";
  const sourceType =
    typeof body.source_type === "string" && body.source_type.trim()
      ? body.source_type.trim()
      : "interview";

  const meta: Record<string, unknown> = {};
  if (topic) meta.topic = topic;

  const { data, error } = await admin
    .from("luna_knowledge_sources")
    .insert({
      title,
      body: text,
      spoken_by: spokenBy,
      spoken_at: spokenAt,
      source_type: sourceType,
      meta
    })
    .select("id")
    .single();

  if (error) {
    console.error("[luna/knowledge/sources] POST", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  let body: {
    id?: string;
    title?: string;
    body?: string;
    spoken_by?: string;
    spoken_at?: string | null;
    topic?: string;
    source_type?: string;
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

  const { data: existing, error: fetchErr } = await admin
    .from("luna_knowledge_sources")
    .select("id, meta")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.title === "string") patch.title = body.title.trim();
  if (typeof body.body === "string") patch.body = body.body.trim();
  if (typeof body.spoken_by === "string") {
    patch.spoken_by = body.spoken_by.trim() || null;
  }
  if (body.spoken_at === null) patch.spoken_at = null;
  else if (
    typeof body.spoken_at === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.spoken_at.trim())
  ) {
    patch.spoken_at = body.spoken_at.trim();
  }
  if (typeof body.source_type === "string" && body.source_type.trim()) {
    patch.source_type = body.source_type.trim();
  }
  if (typeof body.topic === "string") {
    const prev =
      existing.meta && typeof existing.meta === "object"
        ? { ...(existing.meta as Record<string, unknown>) }
        : {};
    const topic = body.topic.trim();
    if (topic) prev.topic = topic;
    else delete prev.topic;
    patch.meta = prev;
  }

  if (typeof patch.title === "string" && !patch.title) {
    return NextResponse.json({ error: "title cannot be empty" }, { status: 400 });
  }
  if (typeof patch.body === "string" && !patch.body) {
    return NextResponse.json({ error: "body cannot be empty" }, { status: 400 });
  }

  const { error } = await admin
    .from("luna_knowledge_sources")
    .update(patch)
    .eq("id", id);

  if (error) {
    console.error("[luna/knowledge/sources] PATCH", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
