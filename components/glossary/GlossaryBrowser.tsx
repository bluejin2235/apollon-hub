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
import { Search } from "lucide-react";
import { GlossaryFields } from "@/components/glossary/GlossaryFields";
import { categoryTabFilter } from "@/lib/glossary/categories";
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

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "전체", label: "전체" },
  ...GLOSSARY_CATEGORIES.map((c) => ({ key: c as TabKey, label: c }))
];

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

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  if (!token) throw new Error("로그인이 필요합니다.");
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(json?.error ?? "요청에 실패했습니다.");
  return json as T;
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

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState("");

  const loadTerms = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const url = includeStats ? "/api/glossary?stats=1" : "/api/glossary";
      const json = await api<{
        terms: TermListItem[];
        pending_candidates: number;
        available?: boolean;
        message?: string;
        stats?: GlossaryStats | null;
        can_delete?: boolean;
      }>(url);
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
      const json = await api<{
        term: TermDetail;
        versions: VersionItem[];
        can_delete?: boolean;
      }>(`/api/glossary?id=${id}`);
      setDetail(json.term);
      setVersions(json.versions ?? []);
      if (typeof json.can_delete === "boolean") setCanDelete(json.can_delete);
    } catch (err) {
      setDetail(null);
      setVersions([]);
      setDetailError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

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
      matchesIndexFilter(t.term_ko, indexGroup, indexLetter)
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

  useEffect(() => {
    if (visibleTerms.length === 0) {
      setSelectedId(null);
      setDetail(null);
      setVersions([]);
      return;
    }
    if (visibleTerms.some((t) => t.id === selectedId)) return;
    setSelectedId(visibleTerms[0]!.id);
  }, [visibleTerms, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    setDraft(null);
    setNotice("");
    setConfirmDelete(false);
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

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
    if (!detail || !draft) return;
    if (!draft.term_ko.trim()) {
      setNotice("한국어 용어는 반드시 있어야 합니다.");
      return;
    }
    if (draft.categories.length === 0) {
      setNotice("분류를 하나 이상 선택해 주세요.");
      return;
    }
    setSaving(true);
    setNotice("");
    try {
      await api("/api/glossary", {
        method: "POST",
        body: JSON.stringify({
          id: detail.id,
          term_ko: draft.term_ko.trim(),
          term_en: draft.term_en.trim(),
          term_zh: draft.term_zh.trim(),
          synonyms: draft.synonyms,
          categories: draft.categories,
          definition: draft.definition.trim(),
          change_note: draft.change_note.trim()
        })
      });
      setDraft(null);
      setNotice("저장했습니다. 변경 이력에 남았습니다.");
      await Promise.all([loadTerms(), loadDetail(detail.id)]);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function removeTerm() {
    if (!detail || !canDelete) return;
    const removedId = detail.id;
    setDeleting(true);
    setNotice("");
    try {
      await api("/api/glossary", {
        method: "DELETE",
        body: JSON.stringify({ id: removedId })
      });
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

  const currentVersion = versions[0]?.version ?? detail?.version ?? null;

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
          <div
            className="mb-2.5 flex items-center gap-2 rounded-[9px] px-2.5 py-2"
            style={{ background: C.chip }}
          >
            <Search className="h-3.5 w-3.5 shrink-0" style={{ color: C.faint }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="용어 검색 (한·영·중)"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-slate-400"
              style={{ color: C.ink }}
            />
          </div>

          <div className="mb-2.5 flex flex-wrap gap-[5px]">
            {TABS.map((t) => {
              const on = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setTab(t.key);
                    setIndexLetter(null);
                  }}
                  className="rounded-lg px-2 py-1.5 text-center text-[11px] font-bold"
                  style={{
                    background: on ? C.luna : C.chip,
                    color: on ? "#fff" : C.sub
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div
            className="mb-1.5 flex flex-wrap gap-1 border-b pb-2"
            style={{ borderColor: C.line2 }}
          >
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
                  className="rounded-[6px] px-2 py-1 text-[11px] font-bold"
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
            <div
              className="mb-1.5 flex flex-wrap gap-0.5 border-b pb-2.5"
              style={{ borderColor: C.line2 }}
            >
              {indexLetters.map((key) => {
                const on = indexLetter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setIndexLetter(on ? null : key)}
                    className="grid h-[21px] min-w-[21px] place-items-center rounded-[5px] px-1 text-[11px]"
                    style={
                      on
                        ? { background: C.luna, color: "#fff", fontWeight: 700 }
                        : { color: C.sub }
                    }
                  >
                    {key}
                  </button>
                );
              })}
            </div>
          ) : null}

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
                const on = selectedId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    className="block w-full rounded-lg px-2.5 py-2 text-left hover:bg-[#f7f7f9]"
                    style={on ? { background: C.lunaSoft } : undefined}
                  >
                    <div
                      className="truncate text-[13px] font-bold"
                      style={{ color: on ? C.lunaInk : C.ink }}
                    >
                      {t.term_ko}
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
          {detailLoading && !detail ? (
            <p className="text-[12px]" style={{ color: C.faint }}>
              불러오는 중…
            </p>
          ) : detailError ? (
            <p className="text-[12.5px]" style={{ color: C.danger }}>
              {detailError}
            </p>
          ) : !detail ? (
            <p className="text-[13px]" style={{ color: C.sub }}>
              왼쪽에서 용어를 고르면 뜻과 변경 이력을 볼 수 있습니다.
            </p>
          ) : (
            <>
              <div className="text-[24px] font-extrabold tracking-[-0.5px]">
                {detail.term_ko}
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
                <div className="mt-3 text-[13px]" style={{ color: C.sub }}>
                  <span style={{ color: C.faint }}>같은 뜻으로 쓰는 말</span>
                  <span className="mx-1.5" style={{ color: C.faint }}>
                    ·
                  </span>
                  {detail.synonyms.join(", ")}
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

              {draft ? null : (
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
                          `/luna?ask=${encodeURIComponent(`${detail.term_ko}가 무슨 뜻이야?`)}`
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

              {draft ? (
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
    </div>
  );
}
