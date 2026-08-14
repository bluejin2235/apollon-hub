"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { GlossaryFields } from "@/components/glossary/GlossaryFields";
import {
  GlossaryDuplicateDialog,
  type GlossaryDuplicatePayload
} from "@/components/glossary/GlossaryDuplicateDialog";
import { categoryTabFilter } from "@/lib/glossary/categories";
import type { GlossaryDupMatch, GlossaryDupTerm } from "@/lib/glossary/duplicate";
import {
  INDEX_GROUPS,
  buildIndexKeysForGroup,
  matchesIndexFilter,
  type IndexGroup
} from "@/lib/glossary/index-key";
import { extractInlineSynonyms } from "@/lib/glossary/synonyms";
import type {
  GlossaryCategory,
  GlossaryFieldValues,
  GlossaryListItem,
  GlossaryStats,
  GlossaryVersionItem
} from "@/lib/glossary/types";
import { GLOSSARY_CATEGORIES } from "@/lib/glossary/types";
import { supabase } from "@/lib/supabase/client";

type TermListItem = GlossaryListItem;
type VersionItem = GlossaryVersionItem;

type TermDetail = TermListItem & {
  definition: string | null;
  version: number;
  updated_at: string | null;
};

type Draft = GlossaryFieldValues & { change_note: string };

type TabKey = "전체" | GlossaryCategory;

const C = {
  line: "#e7e8ec",
  line2: "#eef0f3",
  ink: "#1c1d21",
  sub: "#6b6f76",
  faint: "#9aa0a8",
  chip: "#f1f2f5",
  luna: "#534AB7",
  lunaSoft: "#EEEDFE",
  lunaInk: "#3C3489",
  danger: "#A32D2D",
  dangerSoft: "#FAECE7"
};

function emptyDraft(): Draft {
  return {
    term_ko: "",
    term_en: "",
    term_zh: "",
    synonyms: [],
    definition: "",
    categories: ["공통"],
    change_note: "최초 등록"
  };
}

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function api<T>(
  url: string,
  init?: RequestInit
): Promise<
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      error: string;
      existing_id?: string;
      data?: T;
    }
> {
  const token = await getAccessToken();
  if (!token) return { ok: false, status: 401, error: "로그인이 필요합니다." };
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });
  const json = (await res.json().catch(() => null)) as
    | (T & { error?: string; existing_id?: string })
    | null;
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: json?.error ?? "요청에 실패했습니다.",
      existing_id: typeof json?.existing_id === "string" ? json.existing_id : undefined,
      data: (json as T) ?? undefined
    };
  }
  return { ok: true, data: json as T };
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function LangCard({
  label,
  value,
  bold
}: {
  label: string;
  value: string | null;
  bold?: boolean;
}) {
  return (
    <div
      className="rounded-[9px] border px-[13px] py-[11px]"
      style={{ borderColor: C.line }}
    >
      <div
        className="text-[10.5px] font-extrabold uppercase"
        style={{ color: C.faint }}
      >
        {label}
      </div>
      <div
        className={`mt-[3px] text-[15px] ${bold !== false && value ? "font-bold" : ""}`}
        style={{ color: value ? C.ink : C.faint }}
      >
        {value || "—"}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1.5 text-[10.5px] font-bold" style={{ color: C.faint }}>
      {children}
    </div>
  );
}

export type GlossaryBrowserMeta = {
  pendingCandidates: number;
  available: boolean;
  message: string;
  stats: GlossaryStats | null;
  canDelete: boolean;
};

type GlossaryBrowserProps = {
  includeStats?: boolean;
  onMeta?: (meta: GlossaryBrowserMeta) => void;
  topSlot?: ReactNode;
};

export function GlossaryBrowser({
  includeStats = false,
  onMeta,
  topSlot
}: GlossaryBrowserProps) {
  const router = useRouter();
  const onMetaRef = useRef(onMeta);
  onMetaRef.current = onMeta;

  const [terms, setTerms] = useState<TermListItem[]>([]);
  const [available, setAvailable] = useState(true);
  const [canDelete, setCanDelete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [tab, setTab] = useState<TabKey>("전체");
  const [query, setQuery] = useState("");
  const [indexGroup, setIndexGroup] = useState<IndexGroup>("all");
  const [indexLetter, setIndexLetter] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TermDetail | null>(null);
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState("");
  const [dupPayload, setDupPayload] = useState<GlossaryDuplicatePayload | null>(
    null
  );
  const [dupBusy, setDupBusy] = useState(false);

  const loadTerms = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const url = includeStats ? "/api/glossary?stats=1" : "/api/glossary";
      const res = await api<{
        terms: TermListItem[];
        pending_candidates: number;
        available?: boolean;
        message?: string;
        stats?: GlossaryStats | null;
        can_delete?: boolean;
      }>(url);
      if (!res.ok) throw new Error(res.error);
      const json = res.data;
      const nextAvailable = json.available !== false;
      const nextCanDelete = json.can_delete === true;
      setTerms(json.terms ?? []);
      setAvailable(nextAvailable);
      setCanDelete(nextCanDelete);
      if (!nextAvailable) {
        setError(json.message ?? "용어사전 테이블을 읽지 못했습니다.");
      }
      onMetaRef.current?.({
        pendingCandidates: json.pending_candidates ?? 0,
        available: nextAvailable,
        message: json.message ?? "",
        stats: json.stats ?? null,
        canDelete: nextCanDelete
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
      setAvailable(false);
      setCanDelete(false);
      onMetaRef.current?.({
        pendingCandidates: 0,
        available: false,
        message: err instanceof Error ? err.message : "불러오지 못했습니다.",
        stats: null,
        canDelete: false
      });
    } finally {
      setLoading(false);
    }
  }, [includeStats]);

  useEffect(() => {
    void loadTerms();
  }, [loadTerms]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError("");
    try {
      const res = await api<{
        term: TermDetail;
        versions: VersionItem[];
        can_delete?: boolean;
      }>(`/api/glossary?id=${id}`);
      if (!res.ok) throw new Error(res.error);
      setDetail(res.data.term);
      setVersions(res.data.versions ?? []);
      if (typeof res.data.can_delete === "boolean") setCanDelete(res.data.can_delete);
    } catch (err) {
      setDetail(null);
      setVersions([]);
      setDetailError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const categoryCounts = useMemo(() => {
    const counts: Record<TabKey, number> = {
      전체: terms.length,
      공통: 0,
      공간: 0,
      HW: 0,
      콘텐츠: 0,
      기타: 0
    };
    for (const t of terms) {
      for (const c of t.categories ?? []) {
        if (c in counts) counts[c as GlossaryCategory] += 1;
      }
    }
    return counts;
  }, [terms]);

  const tabTerms = useMemo(
    () => terms.filter((t) => categoryTabFilter(t.categories, tab)),
    [terms, tab]
  );

  const indexLetters = useMemo(
    () => buildIndexKeysForGroup(tabTerms, indexGroup),
    [tabTerms, indexGroup]
  );

  const visibleTerms = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = tabTerms.filter((t) =>
      matchesIndexFilter(t, indexGroup, indexLetter)
    );
    if (q) {
      list = list.filter((t) => {
        const fields = [t.term_ko, t.term_en, t.term_zh, ...(t.synonyms ?? [])];
        return fields
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(q));
      });
    }
    return list;
  }, [tabTerms, query, indexGroup, indexLetter]);

  const listCaption = useMemo(() => {
    const n = visibleTerms.length;
    if (indexLetter) return `${indexLetter} · ${n}개`;
    if (indexGroup === "all") return `전체 · ${n}개`;
    const label = INDEX_GROUPS.find((g) => g.key === indexGroup)?.label ?? "";
    return `${label} · ${n}개`;
  }, [visibleTerms.length, indexLetter, indexGroup]);

  useEffect(() => {
    if (creating) return;
    if (visibleTerms.length === 0) {
      setSelectedId(null);
      setDetail(null);
      setVersions([]);
      return;
    }
    if (visibleTerms.some((t) => t.id === selectedId)) return;
    setSelectedId(visibleTerms[0]!.id);
  }, [visibleTerms, selectedId, creating]);

  useEffect(() => {
    if (creating || !selectedId) return;
    setDraft(null);
    setNotice("");
    setConfirmDelete(false);
    void loadDetail(selectedId);
  }, [selectedId, loadDetail, creating]);

  function startCreate() {
    setCreating(true);
    setSelectedId(null);
    setDetail(null);
    setVersions([]);
    setConfirmDelete(false);
    setNotice("");
    setDraft(emptyDraft());
  }

  function cancelCreate() {
    setCreating(false);
    setDraft(null);
    setNotice("");
    if (visibleTerms[0]) setSelectedId(visibleTerms[0].id);
  }

  function selectTerm(id: string) {
    setCreating(false);
    setDraft(null);
    setConfirmDelete(false);
    setNotice("");
    setSelectedId(id);
  }

  function startEdit() {
    if (!detail) return;
    setNotice("");
    setConfirmDelete(false);
    const extracted = extractInlineSynonyms(
      detail.definition,
      detail.synonyms ?? []
    );
    setDraft({
      term_ko: detail.term_ko ?? "",
      term_en: detail.term_en ?? "",
      term_zh: detail.term_zh ?? "",
      synonyms: extracted.synonyms,
      definition: extracted.definition,
      categories:
        detail.categories?.length > 0 ? [...detail.categories] : ["공통"],
      change_note: ""
    });
  }

  async function save() {
    if (!draft) return;
    if (!draft.term_ko.trim() && !draft.term_en.trim()) {
      setNotice("한국어 또는 영문 중 하나 이상 있어야 합니다.");
      return;
    }
    if (draft.categories.length === 0) {
      setNotice("분류를 하나 이상 선택해 주세요.");
      return;
    }
    setSaving(true);
    setNotice("");
    const isNew = creating || !detail;
    const excludeId = isNew ? null : detail!.id;
    try {
      const check = await api<{
        conflicts: boolean;
        primary?: GlossaryDupMatch;
        others?: GlossaryDupMatch[];
        existing?: GlossaryDupTerm;
        incoming?: GlossaryFieldValues;
        merge_draft?: GlossaryFieldValues | null;
      }>("/api/glossary/check-duplicate", {
        method: "POST",
        body: JSON.stringify({
          term_ko: draft.term_ko.trim(),
          term_en: draft.term_en.trim(),
          term_zh: draft.term_zh.trim(),
          synonyms: draft.synonyms,
          categories: draft.categories,
          definition: draft.definition.trim(),
          exclude_id: excludeId,
          with_merge_draft: true
        })
      });
      if (!check.ok) throw new Error(check.error);
      if (
        check.data.conflicts &&
        check.data.primary &&
        check.data.existing &&
        check.data.incoming
      ) {
        setDupPayload({
          primary: check.data.primary,
          others: check.data.others ?? [],
          existing: check.data.existing,
          incoming: check.data.incoming,
          merge_draft: check.data.merge_draft ?? null,
          source_label: isNew ? "신규 등록" : "용어 수정",
          exclude_id: excludeId
        });
        return;
      }

      await saveDirect(isNew, excludeId);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function saveDirect(isNew: boolean, excludeId: string | null) {
    if (!draft) return;
    const res = await api<{ term: { id: string; version: number } }>(
      "/api/glossary",
      {
        method: "POST",
        body: JSON.stringify({
          id: isNew ? null : excludeId,
          term_ko: draft.term_ko.trim(),
          term_en: draft.term_en.trim(),
          term_zh: draft.term_zh.trim(),
          synonyms: draft.synonyms,
          categories: draft.categories,
          definition: draft.definition.trim(),
          change_note: draft.change_note.trim() || (isNew ? "최초 등록" : "")
        })
      }
    );
    if (!res.ok) {
      if (res.status === 409) {
        setNotice("이미 있는 용어입니다");
        return;
      }
      throw new Error(res.error);
    }
    const savedId = res.data.term.id;
    setCreating(false);
    setDraft(null);
    setNotice(
      isNew
        ? "새 용어를 등록했습니다."
        : "저장했습니다. 변경 이력에 남았습니다."
    );
    await loadTerms();
    setSelectedId(savedId);
    await loadDetail(savedId);
  }

  async function resolveDuplicate(args: {
    action: "merge" | "replace" | "keep" | "register";
    merged: GlossaryFieldValues;
    incoming: GlossaryFieldValues;
  }) {
    if (!dupPayload) return;
    setDupBusy(true);
    try {
      const res = await api<{
        ok: boolean;
        message?: string;
        term?: { id: string };
        conflicts?: boolean;
        primary?: GlossaryDupMatch;
        others?: GlossaryDupMatch[];
        existing?: GlossaryDupTerm;
        incoming?: GlossaryFieldValues;
      }>("/api/glossary/resolve-duplicate", {
        method: "POST",
        body: JSON.stringify({
          action: args.action,
          existing_id: dupPayload.existing.id,
          incoming: args.incoming,
          merged: args.merged,
          exclude_id: dupPayload.exclude_id,
          candidate_id: null
        })
      });
      if (!res.ok) {
        if (res.status === 409 && res.data?.conflicts && res.data.primary && res.data.existing) {
          setDupPayload({
            ...dupPayload,
            primary: res.data.primary,
            others: res.data.others ?? [],
            existing: res.data.existing,
            incoming: res.data.incoming ?? args.incoming,
            merge_draft: null
          });
          setNotice("바꾼 이름도 겹칩니다. 다시 확인해 주세요.");
          return;
        }
        throw new Error(res.error);
      }
      setDupPayload(null);
      setCreating(false);
      setDraft(null);
      setNotice(res.data.message ?? "처리했습니다.");
      await loadTerms();
      const nextId = res.data.term?.id ?? dupPayload.existing.id;
      if (args.action !== "keep") {
        setSelectedId(nextId);
        await loadDetail(nextId);
      } else if (dupPayload.exclude_id) {
        setSelectedId(dupPayload.exclude_id);
        await loadDetail(dupPayload.exclude_id);
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "처리에 실패했습니다.");
    } finally {
      setDupBusy(false);
    }
  }

  async function removeTerm() {
    if (!detail || !canDelete) return;
    const removedId = detail.id;
    setDeleting(true);
    setNotice("");
    try {
      const res = await api("/api/glossary", {
        method: "DELETE",
        body: JSON.stringify({ id: removedId })
      });
      if (!res.ok) throw new Error(res.error);
      setConfirmDelete(false);
      setDraft(null);
      setDetail(null);
      setVersions([]);
      setSelectedId(null);
      setTerms((prev) => prev.filter((t) => t.id !== removedId));
      setNotice("용어를 삭제했습니다.");
      await loadTerms();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "삭제하지 못했습니다.");
    } finally {
      setDeleting(false);
    }
  }

  function searchSynonym(syn: string) {
    setQuery(syn);
    setIndexGroup("all");
    setIndexLetter(null);
    setTab("전체");
  }

  const currentVersion = versions[0]?.version ?? detail?.version ?? null;
  const showCreateForm = creating && draft;
  const showEditForm = !creating && !!draft && !!detail;

  if (!available && !loading) {
    return (
      <div>
        {topSlot}
        <div
          className="rounded-[12px] border bg-white px-4 py-8 text-center text-[13px]"
          style={{ borderColor: C.line, color: C.sub }}
        >
          <p className="font-bold" style={{ color: C.ink }}>
            데이터 없음
          </p>
          <p className="mt-2 leading-relaxed">
            {error ||
              "용어사전 테이블이 아직 없습니다. supabase/migrations/glossary_*.sql 마이그레이션을 적용한 뒤 다시 확인하세요."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {topSlot}
      {error ? (
        <p className="mb-3 text-[12.5px]" style={{ color: C.danger }}>
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-3 min-[901px]:grid-cols-[270px_1fr]">
        <section
          className="self-start rounded-[12px] border bg-white px-2.5 py-3"
          style={{ borderColor: C.line }}
        >
          <div className="mb-3 flex items-center gap-1.5">
            <div
              className="flex min-w-0 flex-1 items-center gap-2 rounded-[9px] px-2.5 py-2"
              style={{ background: C.chip }}
            >
              <Search className="h-3.5 w-3.5 shrink-0" style={{ color: C.faint }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="용어·동의어 검색"
                className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-slate-400"
                style={{ color: C.ink }}
              />
            </div>
            <button
              type="button"
              onClick={startCreate}
              title="용어 추가"
              className="flex h-[36px] shrink-0 items-center gap-0.5 rounded-[9px] px-2.5 text-[11.5px] font-bold text-white"
              style={{ background: C.luna }}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              추가
            </button>
          </div>

          <SectionLabel>분류</SectionLabel>
          <div className="mb-3 flex flex-wrap gap-1">
            {(["전체", ...GLOSSARY_CATEGORIES] as TabKey[]).map((key) => {
              const on = tab === key;
              const count = categoryCounts[key] ?? 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setTab(key);
                    setIndexLetter(null);
                  }}
                  className="rounded-[20px] px-2.5 py-1 text-[11px] font-bold"
                  style={{
                    background: on ? C.luna : C.chip,
                    color: on ? "#fff" : C.sub
                  }}
                >
                  {key} {count}
                </button>
              );
            })}
          </div>

          <div className="mb-3 border-t" style={{ borderColor: C.line2 }} />

          <SectionLabel>색인</SectionLabel>
          <div className="mb-2 flex gap-1">
            {INDEX_GROUPS.map((g) => {
              const on = indexGroup === g.key;
              return (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => {
                    setIndexGroup(g.key);
                    setIndexLetter(null);
                  }}
                  className="flex-1 rounded-[7px] py-1.5 text-center text-[11px] font-bold"
                  style={{
                    background: on ? C.luna : C.chip,
                    color: on ? "#fff" : C.sub
                  }}
                >
                  {g.label}
                </button>
              );
            })}
          </div>

          {indexGroup !== "all" && indexLetters.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-1">
              {indexLetters.map((key) => {
                const on = indexLetter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setIndexLetter(on ? null : key)}
                    className="grid h-6 w-6 place-items-center rounded-[6px] text-[11px] font-bold"
                    style={
                      on
                        ? { background: C.luna, color: "#fff" }
                        : { background: C.chip, color: C.sub }
                    }
                  >
                    {key}
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="mb-2 border-t" style={{ borderColor: C.line2 }} />

          <div className="mb-1.5 text-[10.5px]" style={{ color: C.faint }}>
            {listCaption}
          </div>

          <div className="max-h-[min(56vh,520px)] overflow-y-auto">
            {loading ? (
              <p className="px-2.5 py-3 text-[12px]" style={{ color: C.faint }}>
                불러오는 중…
              </p>
            ) : visibleTerms.length === 0 ? (
              <p className="px-2.5 py-3 text-[12px]" style={{ color: C.faint }}>
                찾는 용어가 없습니다.
              </p>
            ) : (
              visibleTerms.map((t) => {
                const on = !creating && selectedId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => selectTerm(t.id)}
                    className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-[#f7f7f9]"
                    style={on ? { background: C.lunaSoft } : undefined}
                  >
                    <div
                      className="truncate text-[13px] font-bold"
                      style={{ color: on ? C.lunaInk : C.ink }}
                    >
                      {t.term_ko || t.term_en || t.term_zh || "—"}
                    </div>
                    <div
                      className="truncate text-[11.5px]"
                      style={{ color: on ? C.lunaInk : C.faint }}
                    >
                      {t.term_en || "—"}
                      {t.term_zh ? (
                        <>
                          {" · "}
                          <span
                            className="font-bold"
                            style={{ color: on ? C.lunaInk : C.sub }}
                          >
                            {t.term_zh}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section
          className="rounded-[12px] border bg-white px-6 py-[22px]"
          style={{ borderColor: C.line }}
        >
          {showCreateForm ? (
            <>
              <div className="text-[20px] font-extrabold tracking-[-0.4px]">
                새 용어 등록
              </div>
              <p className="mt-1 text-[12px]" style={{ color: C.sub }}>
                한국어 또는 영문 중 하나 이상 · 분류 최소 1개
              </p>
              <div
                className="mt-4 rounded-[9px] border px-4 py-3.5"
                style={{ borderColor: "#d9d2ff", background: "#fbfaff" }}
              >
                <GlossaryFields
                  value={draft}
                  onChange={(next) =>
                    setDraft({ ...next, change_note: draft.change_note })
                  }
                  changeNote={draft.change_note}
                  onChangeNote={(note) =>
                    setDraft({ ...draft, change_note: note })
                  }
                />
                {notice ? (
                  <p className="mb-2 text-[12px]" style={{ color: C.luna }}>
                    {notice}
                  </p>
                ) : null}
                <div className="mt-1 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void save()}
                    className="rounded-[9px] border px-3.5 py-2 text-[12.5px] font-bold text-white disabled:opacity-50"
                    style={{ background: C.luna, borderColor: C.luna }}
                  >
                    {saving ? "저장 중…" : "등록"}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={cancelCreate}
                    className="rounded-[9px] border bg-white px-3.5 py-2 text-[12.5px] font-bold disabled:opacity-50"
                    style={{ borderColor: C.line, color: "#33363c" }}
                  >
                    취소
                  </button>
                </div>
              </div>
            </>
          ) : detailLoading && !detail ? (
            <p className="text-[12px]" style={{ color: C.faint }}>
              불러오는 중…
            </p>
          ) : detailError ? (
            <p className="text-[12.5px]" style={{ color: C.danger }}>
              {detailError}
            </p>
          ) : !detail ? (
            <p className="text-[13px]" style={{ color: C.sub }}>
              왼쪽에서 용어를 고르거나 [추가]로 새 용어를 등록하세요.
            </p>
          ) : (
            <>
              <div className="text-[24px] font-extrabold tracking-[-0.5px]">
                {detail.term_ko || detail.term_en || "—"}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(detail.categories?.length ? detail.categories : ["공통"]).map(
                  (cat) => (
                    <span
                      key={cat}
                      className="inline-block rounded-[20px] px-[9px] py-0.5 text-[10.5px] font-extrabold"
                      style={{ background: C.chip, color: C.sub }}
                    >
                      {cat}
                    </span>
                  )
                )}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2.5 min-[901px]:grid-cols-3">
                <LangCard label="한국어" value={detail.term_ko} />
                <LangCard label="ENGLISH" value={detail.term_en} />
                <LangCard label="中文" value={detail.term_zh} />
              </div>

              {detail.synonyms?.length ? (
                <div className="mt-3">
                  <div
                    className="mb-1.5 text-[10.5px] font-bold"
                    style={{ color: C.faint }}
                  >
                    같은 뜻으로 쓰는 말
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.synonyms.map((syn) => (
                      <button
                        key={syn}
                        type="button"
                        onClick={() => searchSynonym(syn)}
                        className="rounded-[20px] px-2.5 py-1 text-[12px] font-bold"
                        style={{ background: C.chip, color: C.sub }}
                        title={`'${syn}'로 검색`}
                      >
                        {syn}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div
                className="mt-3 rounded-[9px] border px-4 py-3.5"
                style={{ borderColor: C.line }}
              >
                <div
                  className="mb-1.5 text-[10.5px] font-extrabold uppercase"
                  style={{ color: C.faint }}
                >
                  정의
                </div>
                {detail.definition?.trim() ? (
                  <p className="whitespace-pre-wrap text-[13.5px] leading-[1.75]">
                    {detail.definition}
                  </p>
                ) : (
                  <p className="text-[13px]" style={{ color: C.faint }}>
                    정의가 아직 없습니다. 아는 분이 채워 주세요.
                  </p>
                )}
              </div>

              {showEditForm ? null : (
                <>
                  <div className="mt-3.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={startEdit}
                      className="rounded-[9px] border px-3.5 py-2 text-[12.5px] font-bold text-white"
                      style={{ background: C.luna, borderColor: C.luna }}
                    >
                      수정하기
                    </button>
                    {canDelete ? (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDelete(true);
                          setNotice("");
                        }}
                        className="rounded-[9px] border px-3.5 py-2 text-[12.5px] font-bold"
                        style={{
                          background: C.dangerSoft,
                          borderColor: "#f3d9cf",
                          color: C.danger
                        }}
                      >
                        삭제
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        router.push(
                          `/luna?ask=${encodeURIComponent(
                            `${detail.term_ko || detail.term_en}가 무슨 뜻이야?`
                          )}`
                        )
                      }
                      className="rounded-[9px] border bg-white px-3.5 py-2 text-[12.5px] font-bold"
                      style={{ borderColor: C.line, color: "#33363c" }}
                    >
                      루나에게 물어보기
                    </button>
                  </div>
                  <div className="mt-1 text-[11.5px]" style={{ color: C.faint }}>
                    수정은 검토 없이 바로 반영되고, 모든 변경은 이력으로 남습니다
                  </div>
                </>
              )}

              {confirmDelete ? (
                <div
                  className="mt-3 rounded-[9px] border px-4 py-3.5"
                  style={{ borderColor: "#f3d9cf", background: C.dangerSoft }}
                >
                  <p className="text-[13px] font-bold" style={{ color: C.danger }}>
                    이 용어를 삭제하면 루나가 더 이상 사용하지 않습니다
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => void removeTerm()}
                      className="rounded-[9px] border px-3.5 py-2 text-[12.5px] font-bold text-white disabled:opacity-50"
                      style={{ background: C.danger, borderColor: C.danger }}
                    >
                      {deleting ? "삭제 중…" : "삭제 확인"}
                    </button>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => setConfirmDelete(false)}
                      className="rounded-[9px] border bg-white px-3.5 py-2 text-[12.5px] font-bold disabled:opacity-50"
                      style={{ borderColor: C.line, color: "#33363c" }}
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : null}

              {notice ? (
                <p className="mt-2 text-[12px]" style={{ color: C.luna }}>
                  {notice}
                </p>
              ) : null}

              {showEditForm ? (
                <div
                  className="mt-3 rounded-[9px] border px-4 py-3.5"
                  style={{ borderColor: "#d9d2ff", background: "#fbfaff" }}
                >
                  <div className="mb-2 text-[11px]" style={{ color: C.faint }}>
                    수정 — 편집 중
                  </div>
                  <GlossaryFields
                    value={draft}
                    onChange={(next) =>
                      setDraft({ ...next, change_note: draft.change_note })
                    }
                    changeNote={draft.change_note}
                    onChangeNote={(note) =>
                      setDraft({ ...draft, change_note: note })
                    }
                  />
                  <div className="mt-1 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void save()}
                      className="rounded-[9px] border px-3.5 py-2 text-[12.5px] font-bold text-white disabled:opacity-50"
                      style={{ background: C.luna, borderColor: C.luna }}
                    >
                      {saving ? "저장 중…" : "저장"}
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setDraft(null)}
                      className="rounded-[9px] border bg-white px-3.5 py-2 text-[12.5px] font-bold disabled:opacity-50"
                      style={{ borderColor: C.line, color: "#33363c" }}
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : null}

              <div
                className="mt-5 border-t pt-3"
                style={{ borderColor: C.line2 }}
              >
                <div className="mb-2 text-[11px]" style={{ color: C.faint }}>
                  변경 이력
                </div>
                {versions.length === 0 ? (
                  <p className="text-[12px]" style={{ color: C.faint }}>
                    기록된 변경이 없습니다.
                  </p>
                ) : (
                  versions.map((v) => {
                    const luna = v.editor_type === "luna";
                    const name = luna ? "루나" : v.editor_name ?? "알 수 없음";
                    return (
                      <div
                        key={v.id}
                        className="flex gap-2.5 border-b py-2 text-[12.5px] last:border-b-0"
                        style={{ borderColor: C.line2 }}
                      >
                        <div
                          className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-extrabold"
                          style={{
                            background: luna ? C.lunaSoft : C.chip,
                            color: luna ? C.lunaInk : C.sub
                          }}
                        >
                          {luna ? "L" : name.slice(0, 2)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-bold">
                            {name}{" "}
                            <span
                              className="ml-0.5 rounded-[20px] px-[7px] py-px text-[10.5px] font-bold"
                              style={{ background: C.chip, color: C.sub }}
                            >
                              v{v.version}
                              {v.version === currentVersion ? " · 현재" : ""}
                            </span>
                          </div>
                          {v.change_note ? (
                            <div className="mt-px text-[12px]" style={{ color: C.sub }}>
                              {v.change_note}
                            </div>
                          ) : null}
                        </div>
                        <div
                          className="ml-auto shrink-0 text-[11.5px]"
                          style={{ color: C.faint }}
                        >
                          {shortDate(v.created_at)}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <GlossaryDuplicateDialog
        open={!!dupPayload}
        payload={dupPayload}
        busy={dupBusy}
        onCancel={() => setDupPayload(null)}
        onResolve={(args) => void resolveDuplicate(args)}
      />
    </div>
  );
}
