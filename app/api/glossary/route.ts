import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { normalizeCategories } from "@/lib/glossary/categories";
import {
  GLOSSARY_CATEGORIES,
  type GlossaryCategory,
  type GlossaryStats,
  type GlossaryVersionItem
} from "@/lib/glossary/types";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { isGlossaryCandidate } from "@/lib/luna/candidate-format";
import { kstWeekBounds } from "@/lib/luna/self-report";

export const runtime = "nodejs";

export type {
  GlossaryCategory,
  GlossaryListItem,
  GlossaryStats,
  GlossaryVersionItem
} from "@/lib/glossary/types";

const TERM_SELECT =
  "id, term_ko, term_en, term_zh, categories, definition, version, updated_at, updated_by";

const LIST_SELECT = "id, term_ko, term_en, term_zh, categories";

function text(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t ? t : null;
}

function mapTermRow(row: Record<string, unknown>) {
  return {
    ...row,
    categories: normalizeCategories(row.categories)
  };
}

/** 지식후보함에 쌓인 용어형 후보 수 — 상단 "확인 필요 N" */
async function countTermCandidates(
  admin: NonNullable<ReturnType<typeof getServiceSupabase>>
): Promise<number> {
  const { data, error } = await admin
    .from("luna_learnings")
    .select("category, meta, snoozed_until")
    .eq("status", "candidate")
    .neq("category", "identity");
  if (error) {
    console.error("[glossary] candidate count", error);
    return 0;
  }
  const now = Date.now();
  return (data ?? []).filter((row) => {
    const until = row.snoozed_until
      ? new Date(String(row.snoozed_until)).getTime()
      : null;
    if (until && Number.isFinite(until) && until > now) return false;
    const meta =
      row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : null;
    return isGlossaryCandidate(meta, row.category as string | null);
  }).length;
}

/** 설정 화면용 관리 지표 — ?stats=1 일 때만 계산 */
async function buildGlossaryStats(
  admin: NonNullable<ReturnType<typeof getServiceSupabase>>,
  pendingCandidates: number
): Promise<GlossaryStats> {
  const week = kstWeekBounds();

  const countContaining = async (cat: GlossaryCategory) => {
    const { count, error } = await admin
      .from("glossary_terms")
      .select("id", { count: "exact", head: true })
      .contains("categories", [cat]);
    if (error) {
      console.error("[glossary] count category", cat, error);
      return null;
    }
    return count ?? 0;
  };

  const [totalRes, weekRes, ...catCounts] = await Promise.all([
    admin.from("glossary_terms").select("id", { count: "exact", head: true }),
    admin
      .from("glossary_terms")
      .select("id", { count: "exact", head: true })
      .gte("updated_at", week.startIso)
      .lt("updated_at", week.endIso),
    ...GLOSSARY_CATEGORIES.map((c) => countContaining(c))
  ]);

  const by_category = {} as Record<GlossaryCategory, number | null>;
  GLOSSARY_CATEGORIES.forEach((cat, i) => {
    by_category[cat] = catCounts[i] ?? null;
  });

  return {
    total: totalRes.count ?? 0,
    week_updated: weekRes.error ? 0 : (weekRes.count ?? 0),
    pending_candidates: pendingCandidates,
    by_category
  };
}

/** 편집자 표시 이름은 profiles 기준 */
async function resolveEditorNames(
  admin: NonNullable<ReturnType<typeof getServiceSupabase>>,
  ids: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const { data } = await admin.from("profiles").select("id, name").in("id", ids);
  for (const row of data ?? []) {
    const name = ((row.name as string) || "").trim();
    if (name) map.set(row.id as string, name);
  }
  return map;
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

  const canDelete = await isSuperAdminUser(admin, user);
  const id = request.nextUrl.searchParams.get("id");

  if (id) {
    const { data: term, error } = await admin
      .from("glossary_terms")
      .select(TERM_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error) {
      console.error("[glossary] GET detail", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!term) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: versionRows } = await admin
      .from("glossary_versions")
      .select("id, version, editor_type, editor_name, edited_by, change_note, created_at")
      .eq("term_id", id)
      .order("version", { ascending: false })
      .limit(20);

    const editorIds = Array.from(
      new Set(
        (versionRows ?? [])
          .map((v) => v.edited_by)
          .filter((v): v is string => typeof v === "string" && Boolean(v))
      )
    );
    const nameById = await resolveEditorNames(admin, editorIds);

    const versions: GlossaryVersionItem[] = (versionRows ?? []).map((v) => ({
      id: v.id as string,
      version: Number(v.version) || 0,
      editor_type: v.editor_type === "luna" ? "luna" : "human",
      editor_name:
        (typeof v.edited_by === "string" ? nameById.get(v.edited_by) : null) ??
        text(v.editor_name),
      change_note: text(v.change_note),
      created_at: v.created_at as string
    }));

    return NextResponse.json({
      term: mapTermRow(term as Record<string, unknown>),
      versions,
      can_delete: canDelete
    });
  }

  // 이 목록은 루나 사이드바가 모든 화면에서 부른다.
  // 용어 테이블이 없거나 조회에 실패해도 사이드바가 죽지 않도록 빈 목록으로 되돌린다.
  const wantStats = request.nextUrl.searchParams.get("stats") === "1";
  const { data: terms, error } = await admin
    .from("glossary_terms")
    .select(LIST_SELECT)
    .order("term_ko", { ascending: true });

  if (error) {
    console.error("[glossary] GET list", error);
    return NextResponse.json({
      terms: [],
      pending_candidates: 0,
      available: false,
      can_delete: canDelete,
      message: "용어사전 테이블을 읽지 못했습니다.",
      ...(wantStats ? { stats: null } : {})
    });
  }

  const pending_candidates = await countTermCandidates(admin);
  return NextResponse.json({
    terms: (terms ?? []).map((t) => mapTermRow(t as Record<string, unknown>)),
    pending_candidates,
    available: true,
    can_delete: canDelete,
    ...(wantStats
      ? { stats: await buildGlossaryStats(admin, pending_candidates) }
      : {})
  });
}

/** 위키 방식 저장 — 검토 없이 즉시 반영, 버전 증가, 이력 기록 */
export async function POST(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let body: {
    id?: string | null;
    term_ko?: string;
    term_en?: string | null;
    term_zh?: string | null;
    categories?: unknown;
    category?: unknown;
    definition?: string | null;
    change_note?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const termKo = typeof body.term_ko === "string" ? body.term_ko.trim() : "";
  if (!termKo) {
    return NextResponse.json({ error: "한국어 용어는 반드시 있어야 합니다." }, { status: 400 });
  }

  const categories = normalizeCategories(body.categories, body.category);
  if (categories.length === 0) {
    return NextResponse.json({ error: "분류를 하나 이상 선택해 주세요." }, { status: 400 });
  }

  const termId = typeof body.id === "string" && body.id ? body.id : null;
  const payload = {
    term_ko: termKo,
    term_en: text(body.term_en),
    term_zh: text(body.term_zh),
    categories,
    definition: text(body.definition)
  };
  const changeNote = text(body.change_note);

  const { data: profile } = await admin
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .maybeSingle();
  const editorName = ((profile?.name as string) || "").trim() || null;

  let saved: { id: string; version: number } | null = null;
  if (termId) {
    const { data: current, error: readError } = await admin
      .from("glossary_terms")
      .select("version")
      .eq("id", termId)
      .maybeSingle();
    if (readError || !current) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const nextVersion = (Number(current.version) || 1) + 1;
    const { data, error } = await admin
      .from("glossary_terms")
      .update({
        ...payload,
        version: nextVersion,
        updated_by: user.id,
        updated_at: new Date().toISOString()
      })
      .eq("id", termId)
      .select("id, version")
      .maybeSingle();
    if (error || !data) {
      console.error("[glossary] update", error);
      return NextResponse.json(
        { error: error?.message ?? "저장하지 못했습니다." },
        { status: 500 }
      );
    }
    saved = { id: data.id as string, version: Number(data.version) || nextVersion };
  } else {
    const { data, error } = await admin
      .from("glossary_terms")
      .insert({ ...payload, version: 1, created_by: user.id, updated_by: user.id })
      .select("id, version")
      .maybeSingle();
    if (error || !data) {
      console.error("[glossary] insert", error);
      return NextResponse.json(
        { error: error?.message ?? "저장하지 못했습니다." },
        { status: 500 }
      );
    }
    saved = { id: data.id as string, version: 1 };
  }

  const { error: versionError } = await admin.from("glossary_versions").insert({
    term_id: saved.id,
    version: saved.version,
    term_ko: payload.term_ko,
    term_en: payload.term_en,
    term_zh: payload.term_zh,
    definition: payload.definition,
    editor_type: "human",
    edited_by: user.id,
    editor_name: editorName,
    change_note: changeNote
  });
  if (versionError) {
    console.error("[glossary] version insert", versionError);
  }

  return NextResponse.json({ term: saved });
}

/** 슈퍼관리자 전용 삭제 — 이력 남긴 뒤 용어 제거 */
export async function DELETE(request: NextRequest) {
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

  let termId = (request.nextUrl.searchParams.get("id") ?? "").trim();
  if (!termId) {
    try {
      const body = (await request.json()) as { id?: string };
      termId = typeof body.id === "string" ? body.id.trim() : "";
    } catch {
      termId = "";
    }
  }
  if (!termId) {
    return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
  }

  const { data: term, error: readError } = await admin
    .from("glossary_terms")
    .select("id, term_ko, term_en, term_zh, definition, version")
    .eq("id", termId)
    .maybeSingle();
  if (readError) {
    console.error("[glossary] DELETE read", readError);
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }
  if (!term) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .maybeSingle();
  const editorName = ((profile?.name as string) || "").trim() || null;
  const nextVersion = (Number(term.version) || 1) + 1;

  const { error: versionError } = await admin.from("glossary_versions").insert({
    term_id: term.id,
    version: nextVersion,
    term_ko: term.term_ko,
    term_en: term.term_en,
    term_zh: term.term_zh,
    definition: term.definition,
    editor_type: "human",
    edited_by: user.id,
    editor_name: editorName,
    change_note: "삭제 — 루나 사용 중단"
  });
  if (versionError) {
    console.error("[glossary] DELETE version", versionError);
    return NextResponse.json({ error: versionError.message }, { status: 500 });
  }

  const { error: deleteError } = await admin
    .from("glossary_terms")
    .delete()
    .eq("id", termId);
  if (deleteError) {
    console.error("[glossary] DELETE term", deleteError);
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: termId });
}
