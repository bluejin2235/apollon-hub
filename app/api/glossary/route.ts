import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { normalizeCategories } from "@/lib/glossary/categories";
import { toFieldValues } from "@/lib/glossary/duplicate";
import {
  buildGlossaryMergeDraft,
  checkGlossaryDuplicate,
  normalizeIncomingFields
} from "@/lib/glossary/duplicate-service";
import { normalizeSynonyms } from "@/lib/glossary/synonyms";
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
  "id, term_ko, term_en, term_zh, categories, synonyms, definition, version, updated_at, updated_by";

const LIST_SELECT = "id, term_ko, term_en, term_zh, categories, synonyms";

function text(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t ? t : null;
}

function mapTermRow(row: Record<string, unknown>) {
  return {
    ...row,
    categories: normalizeCategories(row.categories),
    synonyms: normalizeSynonyms(row.synonyms)
  };
}

function isMissingColumnError(err: { message?: string; code?: string } | null): boolean {
  if (!err) return false;
  const msg = err.message ?? "";
  return (
    err.code === "PGRST204" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
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
    const first = await admin
      .from("glossary_terms")
      .select("id", { count: "exact", head: true })
      .contains("categories", [cat])
      .is("deleted_at", null);
    if (!first.error) return first.count ?? 0;
    if (isMissingColumnError(first.error)) {
      const retry = await admin
        .from("glossary_terms")
        .select("id", { count: "exact", head: true })
        .contains("categories", [cat]);
      return retry.error ? null : (retry.count ?? 0);
    }
    console.error("[glossary] count category", cat, first.error);
    return null;
  };

  let totalRes = await admin
    .from("glossary_terms")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);
  let weekRes = await admin
    .from("glossary_terms")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .gte("updated_at", week.startIso)
    .lt("updated_at", week.endIso);

  if (isMissingColumnError(totalRes.error)) {
    totalRes = await admin
      .from("glossary_terms")
      .select("id", { count: "exact", head: true });
    weekRes = await admin
      .from("glossary_terms")
      .select("id", { count: "exact", head: true })
      .gte("updated_at", week.startIso)
      .lt("updated_at", week.endIso);
  }

  const catCounts = await Promise.all(
    GLOSSARY_CATEGORIES.map((c) => countContaining(c))
  );

  const total = totalRes.count ?? 0;
  const weekUpdated = weekRes.error ? 0 : (weekRes.count ?? 0);

  const by_category = {} as Record<GlossaryCategory, number | null>;
  GLOSSARY_CATEGORIES.forEach((cat, i) => {
    by_category[cat] = catCounts[i] ?? null;
  });

  return {
    total,
    week_updated: weekUpdated,
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

async function insertVersion(
  admin: NonNullable<ReturnType<typeof getServiceSupabase>>,
  row: {
    term_id: string;
    version: number;
    term_ko: string | null;
    term_en: string | null;
    term_zh: string | null;
    definition: string | null;
    synonyms: string[];
    editor_type: "human" | "luna";
    editor_id: string | null;
    editor_name: string | null;
    change_note: string | null;
  }
) {
  // 실제 컬럼명은 editor_id (edited_by 아님)
  const { error } = await admin.from("glossary_versions").insert({
    term_id: row.term_id,
    version: row.version,
    term_ko: row.term_ko,
    term_en: row.term_en,
    term_zh: row.term_zh,
    definition: row.definition,
    synonyms: row.synonyms,
    editor_type: row.editor_type,
    editor_id: row.editor_id,
    editor_name: row.editor_name,
    change_note: row.change_note
  });
  return error;
}

async function getHighlightTerms(
  admin: NonNullable<ReturnType<typeof getServiceSupabase>>
) {
  const select =
    "id, term_ko, term_en, term_zh, categories, synonyms, definition, version, updated_at, updated_by";
  let q = await admin
    .from("glossary_terms")
    .select(select)
    .is("deleted_at", null)
    .order("term_ko", { ascending: true });
  if (q.error && isMissingColumnError(q.error)) {
    q = await admin.from("glossary_terms").select(select).order("term_ko", { ascending: true });
  }
  if (q.error) {
    console.error("[glossary] GET highlight", q.error);
    return NextResponse.json({ terms: [] });
  }
  return NextResponse.json({
    terms: (q.data ?? []).map((t) => mapTermRow(t as Record<string, unknown>))
  });
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

  if (request.nextUrl.searchParams.get("highlight") === "1") {
    return getHighlightTerms(admin);
  }

  const canDelete = await isSuperAdminUser(admin, user);
  const id = request.nextUrl.searchParams.get("id");

  if (id) {
    const detailQ = admin
      .from("glossary_terms")
      .select(TERM_SELECT)
      .eq("id", id)
      .is("deleted_at", null);
    let { data: term, error } = await detailQ.maybeSingle();

    if (error && isMissingColumnError(error)) {
      const retry = await admin
        .from("glossary_terms")
        .select(TERM_SELECT)
        .eq("id", id)
        .maybeSingle();
      term = retry.data;
      error = retry.error;
    }

    if (error) {
      console.error("[glossary] GET detail", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!term) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: versionRows, error: verErr } = await admin
      .from("glossary_versions")
      .select(
        "id, version, editor_type, editor_name, editor_id, change_note, created_at"
      )
      .eq("term_id", id)
      .order("version", { ascending: false })
      .limit(40);

    if (verErr) {
      console.error("[glossary] GET versions", verErr);
    }

    const editorIds = Array.from(
      new Set(
        (versionRows ?? [])
          .map((v) => v.editor_id)
          .filter((v): v is string => typeof v === "string" && Boolean(v))
      )
    );
    const nameById = await resolveEditorNames(admin, editorIds);

    const versions: GlossaryVersionItem[] = (versionRows ?? []).map((v) => ({
      id: v.id as string,
      version: Number(v.version) || 0,
      editor_type: v.editor_type === "luna" ? "luna" : "human",
      editor_name:
        (typeof v.editor_id === "string" ? nameById.get(v.editor_id) : null) ??
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
  const listQ = admin
    .from("glossary_terms")
    .select(LIST_SELECT)
    .is("deleted_at", null)
    .order("term_ko", { ascending: true });
  let { data: terms, error } = await listQ;

  if (error && isMissingColumnError(error)) {
    const retry = await admin
      .from("glossary_terms")
      .select(LIST_SELECT)
      .order("term_ko", { ascending: true });
    terms = retry.data;
    error = retry.error;
  }

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
    synonyms?: unknown;
    definition?: string | null;
    change_note?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rawKo = typeof body.term_ko === "string" ? body.term_ko.trim() : "";
  const rawEn = typeof body.term_en === "string" ? body.term_en.trim() : "";
  if (!rawKo && !rawEn) {
    return NextResponse.json(
      { error: "한국어 또는 영문 중 하나 이상 있어야 합니다." },
      { status: 400 }
    );
  }
  // term_ko 는 NOT NULL — 한국어가 비면 영문으로 채운다
  const termKo = rawKo || rawEn;

  const categories = normalizeCategories(body.categories, body.category);
  if (categories.length === 0) {
    return NextResponse.json({ error: "분류를 하나 이상 선택해 주세요." }, { status: 400 });
  }

  const synonyms = normalizeSynonyms(body.synonyms);
  const termId = typeof body.id === "string" && body.id ? body.id : null;
  const payload = {
    term_ko: termKo,
    term_en: text(rawEn),
    term_zh: text(body.term_zh),
    categories,
    synonyms,
    definition: text(body.definition)
  };
  const changeNote = text(body.change_note) ?? (termId ? null : "최초 등록");

  // 서버측 5종 중복 검사 (클라이언트 팝업과 동일 기준)
  const incomingFields = normalizeIncomingFields({
    term_ko: payload.term_ko,
    term_en: payload.term_en,
    term_zh: payload.term_zh,
    definition: payload.definition,
    categories: payload.categories,
    synonyms: payload.synonyms
  });
  const dup = await checkGlossaryDuplicate(admin, incomingFields, termId);
  if (dup.conflicts && dup.primary && dup.existing) {
    const merge_draft = await buildGlossaryMergeDraft(
      toFieldValues(dup.existing),
      incomingFields
    );
    return NextResponse.json(
      {
        error: "glossary_duplicate",
        conflicts: true,
        primary: dup.primary,
        others: dup.others,
        existing: dup.existing,
        incoming: incomingFields,
        merge_draft,
        existing_id: dup.existing.id
      },
      { status: 409 }
    );
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("name")
    .eq("id", user.id)
    .maybeSingle();
  const editorName = ((profile?.name as string) || "").trim() || null;

  let saved: { id: string; version: number } | null = null;
  if (termId) {
    const readQ = admin
      .from("glossary_terms")
      .select("version")
      .eq("id", termId)
      .is("deleted_at", null);
    let { data: current, error: readError } = await readQ.maybeSingle();
    if (readError && isMissingColumnError(readError)) {
      const retry = await admin
        .from("glossary_terms")
        .select("version")
        .eq("id", termId)
        .maybeSingle();
      current = retry.data;
      readError = retry.error;
    }
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
      const msg = error?.message ?? "저장하지 못했습니다.";
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return NextResponse.json(
          { error: "이미 있는 용어입니다" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    saved = { id: data.id as string, version: 1 };
  }

  const versionError = await insertVersion(admin, {
    term_id: saved.id,
    version: saved.version,
    term_ko: payload.term_ko,
    term_en: payload.term_en,
    term_zh: payload.term_zh,
    definition: payload.definition,
    synonyms: payload.synonyms,
    editor_type: "human",
    editor_id: user.id,
    editor_name: editorName,
    change_note: changeNote
  });
  if (versionError) {
    console.error("[glossary] version insert", versionError);
    return NextResponse.json(
      {
        error: `용어는 저장됐지만 이력을 남기지 못했습니다: ${versionError.message}`
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ term: saved });
}

/**
 * 슈퍼관리자 전용 소프트 삭제.
 * deleted_at 컬럼이 있으면 soft delete, 없으면(마이그레이션 전) hard delete 폴백.
 */
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

  const readQ = admin
    .from("glossary_terms")
    .select("id, term_ko, term_en, term_zh, definition, synonyms, version")
    .eq("id", termId)
    .is("deleted_at", null);
  let { data: term, error: readError } = await readQ.maybeSingle();
  if (readError && isMissingColumnError(readError)) {
    const retry = await admin
      .from("glossary_terms")
      .select("id, term_ko, term_en, term_zh, definition, synonyms, version")
      .eq("id", termId)
      .maybeSingle();
    term = retry.data;
    readError = retry.error;
  }
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

  const versionError = await insertVersion(admin, {
    term_id: term.id as string,
    version: nextVersion,
    term_ko: term.term_ko as string,
    term_en: (term.term_en as string | null) ?? null,
    term_zh: (term.term_zh as string | null) ?? null,
    definition: (term.definition as string | null) ?? null,
    synonyms: normalizeSynonyms(term.synonyms),
    editor_type: "human",
    editor_id: user.id,
    editor_name: editorName,
    change_note: "삭제 — 루나 사용 중단"
  });
  if (versionError) {
    console.error("[glossary] DELETE version", versionError);
    return NextResponse.json({ error: versionError.message }, { status: 500 });
  }

  const now = new Date().toISOString();
  const { error: softError } = await admin
    .from("glossary_terms")
    .update({
      deleted_at: now,
      deleted_by: user.id,
      version: nextVersion,
      updated_by: user.id,
      updated_at: now
    })
    .eq("id", termId);

  if (!softError) {
    return NextResponse.json({ ok: true, id: termId, soft: true });
  }

  if (!isMissingColumnError(softError)) {
    console.error("[glossary] DELETE soft", softError);
    return NextResponse.json({ error: softError.message }, { status: 500 });
  }

  // 마이그레이션 전 폴백: hard delete (versions 는 cascade)
  const { error: deleteError } = await admin
    .from("glossary_terms")
    .delete()
    .eq("id", termId);
  if (deleteError) {
    console.error("[glossary] DELETE hard", deleteError);
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    id: termId,
    soft: false,
    notice:
      "deleted_at 컬럼이 없어 하드 삭제했습니다. supabase/migrations/glossary_soft_delete.sql 을 적용하세요."
  });
}
