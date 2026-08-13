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
import { buildIndexKeys, indexKeyOf } from "@/lib/glossary/index-key";
import type {
  GlossaryCategory,
  GlossaryListItem,
  GlossaryStats,
  GlossaryVersionItem
} from "@/lib/glossary/types";
import { supabase } from "@/lib/supabase/client";

type Category = GlossaryCategory;
type TermListItem = GlossaryListItem;
type VersionItem = GlossaryVersionItem;

type TermDetail = TermListItem & {
  definition: string | null;
  version: number;
  updated_at: string | null;
};

type Draft = {
  term_ko: string;
  term_en: string;
  term_zh: string;
  term_zh_pron: string;
  definition: string;
  change_note: string;
};

const TABS: Array<{ key: Category; label: string }> = [
  { key: "common", label: "공통" },
  { key: "interior", label: "인테리어" },
  { key: "hw", label: "하드웨어" }
];

const CATEGORY_LABEL: Record<Category, string> = {
  common: "공통 용어",
  interior: "인테리어 용어",
  hw: "하드웨어 용어"
};

const C = {
  line: "#e7e8ec",
  line2: "#eef0f3",
  ink: "#1c1d21",
  sub: "#6b6f76",
  faint: "#9aa0a8",
  chip: "#f1f2f5",
  luna: "#534AB7",
  lunaSoft: "#EEEDFE",
  lunaInk: "#3C3489"
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
  pron,
  bold
}: {
  label: string;
  value: string | null;
  pron?: string | null;
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
        {pron ? (
          <small className="ml-[5px] text-[11.5px] font-normal" style={{ color: C.sub }}>
            {pron}
          </small>
        ) : null}
      </div>
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <div className="mb-1 text-[11px]" style={{ color: C.faint }}>
        {label}
      </div>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mb-2.5 w-full rounded-lg border bg-white px-2.5 py-2 text-[13px] outline-none focus:border-[#d9d2ff]"
        style={{ borderColor: C.line, color: C.ink }}
      />
    </div>
  );
}

export type GlossaryBrowserMeta = {
  pendingCandidates: number;
  available: boolean;
  message: string;
  stats: GlossaryStats | null;
};

type GlossaryBrowserProps = {
  /** true면 GET /api/glossary?stats=1 로 관리 지표도 함께 받는다 */
  includeStats?: boolean;
  onMeta?: (meta: GlossaryBrowserMeta) => void;
  /** 목록 위쪽에 붙일 슬롯 (설정 화면 관리 지표 등) */
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [tab, setTab] = useState<Category>("common");
  const [query, setQuery] = useState("");
  const [indexKey, setIndexKey] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TermDetail | null>(null);
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
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
      }>(url);
      const nextAvailable = json.available !== false;
      setTerms(json.terms ?? []);
      setAvailable(nextAvailable);
      if (!nextAvailable) {
        setError(json.message ?? "용어사전 테이블을 읽지 못했습니다.");
      }
      onMetaRef.current?.({
        pendingCandidates: json.pending_candidates ?? 0,
        available: nextAvailable,
        message: json.message ?? "",
        stats: json.stats ?? null
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
      setAvailable(false);
      onMetaRef.current?.({
        pendingCandidates: 0,
        available: false,
        message: err instanceof Error ? err.message : "불러오지 못했습니다.",
        stats: null
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
      const json = await api<{ term: TermDetail; versions: VersionItem[] }>(
        `/api/glossary?id=${id}`
      );
      setDetail(json.term);
      setVersions(json.versions ?? []);
    } catch (err) {
      setDetail(null);
      setVersions([]);
      setDetailError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const tabTerms = useMemo(
    () => terms.filter((t) => t.category === tab),
    [terms, tab]
  );

  const indexKeys = useMemo(() => buildIndexKeys(tabTerms), [tabTerms]);

  const visibleTerms = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      return tabTerms.filter((t) =>
        [t.term_ko, t.term_en, t.term_zh]
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(q))
      );
    }
    if (!indexKey) return tabTerms;
    return tabTerms.filter((t) => indexKeyOf(t.term_ko) === indexKey);
  }, [tabTerms, query, indexKey]);

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
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  function startEdit() {
    if (!detail) return;
    setNotice("");
    setDraft({
      term_ko: detail.term_ko ?? "",
      term_en: detail.term_en ?? "",
      term_zh: detail.term_zh ?? "",
      term_zh_pron: detail.term_zh_pron ?? "",
      definition: detail.definition ?? "",
      change_note: ""
    });
  }

  async function save() {
    if (!detail || !draft) return;
    if (!draft.term_ko.trim()) {
      setNotice("한국어 용어는 반드시 있어야 합니다.");
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
          term_zh_pron: draft.term_zh_pron.trim(),
          category: detail.category,
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
        <p className="mb-3 text-[12.5px]" style={{ color: "#A32D2D" }}>
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

          <div className="mb-2.5 flex gap-[5px]">
            {TABS.map((t) => {
              const on = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setTab(t.key);
                    setIndexKey(null);
                  }}
                  className="flex-1 rounded-lg py-1.5 text-center text-[11.5px] font-bold"
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

          {indexKeys.length > 0 ? (
            <div
              className="mb-1.5 flex flex-wrap gap-0.5 border-b pb-2.5"
              style={{ borderColor: C.line2 }}
            >
              <button
                type="button"
                onClick={() => setIndexKey(null)}
                className="grid h-[21px] place-items-center rounded-[5px] px-1.5 text-[11px]"
                style={
                  indexKey === null
                    ? { background: C.luna, color: "#fff", fontWeight: 700 }
                    : { color: C.sub }
                }
              >
                전체
              </button>
              {indexKeys.map((key) => {
                const on = indexKey === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setIndexKey(on ? null : key)}
                    className="grid h-[21px] w-[21px] place-items-center rounded-[5px] text-[11px]"
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
            <p className="text-[12.5px]" style={{ color: "#A32D2D" }}>
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
              <span
                className="mt-1.5 inline-block rounded-[20px] px-[9px] py-0.5 text-[10.5px] font-extrabold"
                style={{ background: C.chip, color: C.sub }}
              >
                {CATEGORY_LABEL[detail.category]}
              </span>

              <div className="mt-4 grid grid-cols-1 gap-2.5 min-[901px]:grid-cols-3">
                <LangCard label="한국어" value={detail.term_ko} />
                <LangCard label="English" value={detail.term_en} />
                <LangCard
                  label="中文"
                  value={detail.term_zh}
                  pron={detail.term_zh_pron}
                />
              </div>

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
                  <div className="mb-1 text-[11px]" style={{ color: C.faint }}>
                    수정 — 편집 중
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 min-[901px]:grid-cols-4">
                    <EditField
                      label="한국어"
                      value={draft.term_ko}
                      onChange={(v) => setDraft({ ...draft, term_ko: v })}
                    />
                    <EditField
                      label="English"
                      value={draft.term_en}
                      onChange={(v) => setDraft({ ...draft, term_en: v })}
                    />
                    <EditField
                      label="中文"
                      value={draft.term_zh}
                      onChange={(v) => setDraft({ ...draft, term_zh: v })}
                    />
                    <EditField
                      label="중문 발음"
                      value={draft.term_zh_pron}
                      onChange={(v) => setDraft({ ...draft, term_zh_pron: v })}
                      placeholder="예: 지엔리"
                    />
                  </div>
                  <div className="mb-1 text-[11px]" style={{ color: C.faint }}>
                    정의
                  </div>
                  <textarea
                    value={draft.definition}
                    onChange={(e) => setDraft({ ...draft, definition: e.target.value })}
                    className="mb-2.5 h-[120px] w-full resize-y rounded-lg border bg-white px-2.5 py-2 text-[13px] leading-[1.7] outline-none focus:border-[#d9d2ff]"
                    style={{ borderColor: C.line, color: C.ink }}
                  />
                  <EditField
                    label="무엇을 왜 바꿨나요"
                    value={draft.change_note}
                    onChange={(v) => setDraft({ ...draft, change_note: v })}
                    placeholder="예: 오타 수정 · 중문 발음 추가"
                  />
                  <div className="flex flex-wrap gap-2">
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
