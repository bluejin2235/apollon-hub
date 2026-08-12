"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Btn,
  ErrorLine,
  FieldInput,
  KnowledgeShell,
  LoadingLine,
  StatCard,
  StatGrid
} from "@/components/luna/knowledge/ui";
import { formatShortDate, K } from "@/lib/luna/knowledge-format";
import { supabase } from "@/lib/supabase/client";

type GlossaryStats = {
  total: number;
  week_updated: number;
  pending_candidates: number;
  by_category: {
    common: number | null;
    interior: number | null;
    hw: number | null;
  };
};

type TermListItem = {
  id: string;
  term_ko: string;
  term_en: string | null;
  term_zh: string | null;
  category: string;
};

type TermDetail = {
  id: string;
  term_ko: string;
  term_en: string | null;
  term_zh: string | null;
  term_zh_pron: string | null;
  category: string;
  definition: string | null;
  version: number;
};

type VersionRow = {
  id: string;
  version: number;
  editor_type: string;
  editor_name: string | null;
  change_note: string | null;
  created_at: string;
};

const TABS = [
  { key: "common", label: "공통" },
  { key: "interior", label: "인테리어" },
  { key: "hw", label: "하드웨어" }
] as const;

const INDEXES = [
  "ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
  "A", "B", "C", "S"
] as const;

const CATEGORY_LABEL: Record<string, string> = {
  common: "공통",
  interior: "인테리어",
  hw: "하드웨어"
};

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export function LunaKnowledgeGlossary() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [available, setAvailable] = useState(false);
  const [notice, setNotice] = useState("");
  const [stats, setStats] = useState<GlossaryStats | null>(null);
  const [terms, setTerms] = useState<TermListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TermDetail | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("common");
  const [index, setIndex] = useState<string>("ㄱ");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");

  const loadList = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      setError("로그인이 필요합니다");
      return;
    }
    const params = new URLSearchParams({ category: tab, index });
    if (query) params.set("q", query);
    const res = await fetch(`/api/luna/glossary?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const json = (await res.json()) as {
      available?: boolean;
      message?: string;
      stats?: GlossaryStats | null;
      terms?: TermListItem[];
    };
    setAvailable(json.available === true);
    setNotice(json.message ?? "");
    setStats(json.stats ?? null);
    setTerms(json.terms ?? []);
    setLoading(false);
  }, [index, query, tab]);

  const loadDetail = useCallback(
    async (id: string | null) => {
      if (!id || !available) {
        setDetail(null);
        setVersions([]);
        return;
      }
      const token = await getAccessToken();
      if (!token) return;
      const res = await fetch(`/api/luna/glossary?id=${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = (await res.json()) as {
        term?: TermDetail | null;
        versions?: VersionRow[];
      };
      setDetail(json.term ?? null);
      setVersions(json.versions ?? []);
    },
    [available]
  );

  useEffect(() => {
    setLoading(true);
    void loadList();
  }, [loadList]);

  useEffect(() => {
    void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!terms.length) return;
    if (!selectedId || !terms.some((t) => t.id === selectedId)) {
      setSelectedId(terms[0]!.id);
    }
  }, [terms, selectedId]);

  const categoryLine = useMemo(() => {
    if (!stats?.by_category) return "—";
    const { common, interior, hw } = stats.by_category;
    if (common == null && interior == null && hw == null) return "—";
    return `${common ?? "—"} / ${interior ?? "—"} / ${hw ?? "—"}`;
  }, [stats]);

  return (
    <KnowledgeShell>
      <StatGrid>
        <StatCard label="전체 용어" value={stats ? stats.total : "—"} />
        <StatCard
          label="공통 / 인테리어 / HW"
          value={categoryLine}
          small
        />
        <StatCard
          label="이번 주 수정"
          value={stats ? stats.week_updated : "—"}
        />
        <StatCard
          label="확인 대기 후보"
          value={stats ? stats.pending_candidates : "—"}
          valueClassName={
            stats && stats.pending_candidates > 0 ? "text-[#993C1D]" : undefined
          }
        />
      </StatGrid>

      {!available ? (
        <div
          className="rounded-[12px] border px-4 py-8 text-center text-[13px]"
          style={{ background: K.panel, borderColor: K.line, color: K.sub }}
        >
          <p className="font-bold" style={{ color: K.ink }}>
            데이터 없음
          </p>
          <p className="mt-2 leading-relaxed">
            {notice ||
              "용어사전 테이블이 아직 없습니다. supabase/migrations/glossary_*.sql 마이그레이션을 적용한 뒤 다시 확인하세요."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 min-[901px]:grid-cols-[270px_1fr]">
          <div
            className="rounded-[12px] border px-2.5 py-3"
            style={{ background: K.panel, borderColor: K.line }}
          >
            <div
              className="mb-2.5 flex items-center gap-2 rounded-[9px] px-[11px] py-2"
              style={{ background: K.chip }}
            >
              <span className="text-[12px]">🔍</span>
              <FieldInput
                className="!border-0 !bg-transparent !p-0 text-[12.5px]"
                placeholder="용어 검색 (한·영·중)"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            <div className="mb-2.5 flex gap-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => {
                    setTab(t.key);
                    setSelectedId(null);
                  }}
                  className="flex-1 rounded-[8px] py-1.5 text-[11.5px] font-bold"
                  style={{
                    background: tab === t.key ? K.luna : K.chip,
                    color: tab === t.key ? "#fff" : K.sub
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div
              className="mb-1.5 flex flex-wrap gap-0.5 border-b pb-2.5"
              style={{ borderColor: K.line2 }}
            >
              {INDEXES.map((ix) => (
                <button
                  key={ix}
                  type="button"
                  onClick={() => setIndex(ix)}
                  className="grid h-[21px] w-[21px] place-items-center rounded-[5px] text-[11px]"
                  style={{
                    background: index === ix ? K.luna : "transparent",
                    color: index === ix ? "#fff" : K.sub,
                    fontWeight: index === ix ? 700 : 400
                  }}
                >
                  {ix}
                </button>
              ))}
            </div>

            {loading ? (
              <LoadingLine />
            ) : terms.length === 0 ? (
              <p className="px-2 py-3 text-[12px]" style={{ color: K.faint }}>
                용어가 없습니다.
              </p>
            ) : (
              terms.map((term) => {
                const on = selectedId === term.id;
                return (
                  <button
                    key={term.id}
                    type="button"
                    onClick={() => setSelectedId(term.id)}
                    className="mb-0.5 w-full rounded-[8px] px-2.5 py-2 text-left"
                    style={{ background: on ? K.lunaSoft : "transparent" }}
                  >
                    <div
                      className="text-[13px] font-bold"
                      style={{ color: on ? K.lunaInk : K.ink }}
                    >
                      {term.term_ko}
                    </div>
                    <div
                      className="text-[11.5px]"
                      style={{ color: on ? K.lunaInk : K.faint }}
                    >
                      {term.term_en || "—"}
                      {term.term_zh ? (
                        <>
                          {" · "}
                          <span
                            className="font-bold"
                            style={{ color: on ? K.lunaInk : K.sub }}
                          >
                            {term.term_zh}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div
            className="rounded-[12px] border px-5 py-5 min-[901px]:px-[22px]"
            style={{ background: K.panel, borderColor: K.line }}
          >
            {error ? <ErrorLine message={error} /> : null}
            {!detail ? (
              <p className="text-[13px]" style={{ color: K.faint }}>
                {loading ? "불러오는 중…" : "왼쪽에서 용어를 선택하세요."}
              </p>
            ) : (
              <>
                <div className="text-[24px] font-extrabold tracking-[-0.5px]">
                  {detail.term_ko}
                </div>
                <Badge kind="src" className="mt-1.5">
                  {CATEGORY_LABEL[detail.category] ?? detail.category} 용어
                </Badge>

                <div className="mt-4 grid grid-cols-1 gap-2.5 min-[901px]:grid-cols-3">
                  {(
                    [
                      ["한국어", detail.term_ko, null],
                      ["English", detail.term_en, null],
                      ["中文", detail.term_zh, detail.term_zh_pron]
                    ] as const
                  ).map(([label, value, pron]) => (
                    <div
                      key={label}
                      className="rounded-[9px] border px-[13px] py-[11px]"
                      style={{ borderColor: K.line }}
                    >
                      <div
                        className="text-[10.5px] font-extrabold uppercase"
                        style={{ color: K.faint }}
                      >
                        {label}
                      </div>
                      <div className="mt-0.5 text-[15px] font-bold">
                        {value || "—"}
                        {pron ? (
                          <small
                            className="ml-1.5 text-[11.5px] font-normal"
                            style={{ color: K.sub }}
                          >
                            {pron}
                          </small>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>

                <div
                  className="mt-3 rounded-[9px] border px-4 py-3.5"
                  style={{ borderColor: K.line }}
                >
                  <div
                    className="mb-1.5 text-[10.5px] font-extrabold uppercase"
                    style={{ color: K.faint }}
                  >
                    정의
                  </div>
                  <p className="text-[13.5px] leading-[1.75]">
                    {detail.definition?.trim() || "—"}
                  </p>
                </div>

                <div className="mt-3.5 flex flex-wrap items-center gap-2">
                  <Btn primary disabled>
                    수정하기
                  </Btn>
                  <Btn disabled>루나에게 물어보기</Btn>
                  <Btn disabled>이력 전체</Btn>
                </div>

                <div
                  className="mt-[18px] border-t pt-3"
                  style={{ borderColor: K.line2 }}
                >
                  <div
                    className="mb-2 text-[11px]"
                    style={{ color: K.faint }}
                  >
                    변경 이력
                  </div>
                  {versions.length === 0 ? (
                    <p className="text-[12px]" style={{ color: K.faint }}>
                      이력이 없습니다.
                    </p>
                  ) : (
                    versions.map((v, i) => {
                      const isLuna = v.editor_type === "luna";
                      const av = isLuna
                        ? "L"
                        : (v.editor_name ?? "?").slice(0, 2);
                      const verLabel =
                        i === 0
                          ? `v${v.version} · 현재`
                          : i === versions.length - 1
                            ? `v${v.version} · 최초`
                            : `v${v.version}`;
                      return (
                        <div
                          key={v.id}
                          className="flex gap-2.5 border-b py-2 text-[12.5px] last:border-b-0"
                          style={{ borderColor: K.line2 }}
                        >
                          <div
                            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-extrabold"
                            style={{
                              background: isLuna ? K.lunaSoft : K.chip,
                              color: isLuna ? K.lunaInk : K.sub
                            }}
                          >
                            {av}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold">
                              {isLuna ? "루나" : v.editor_name || "—"}{" "}
                              <span
                                className="rounded-[20px] px-1.5 py-px text-[10.5px] font-bold"
                                style={{ background: K.chip, color: K.sub }}
                              >
                                {verLabel}
                              </span>
                            </div>
                            <div className="mt-px text-[12px]" style={{ color: K.sub }}>
                              {v.change_note || "—"}
                            </div>
                          </div>
                          <div
                            className="shrink-0 text-[11.5px]"
                            style={{ color: K.faint }}
                          >
                            {formatShortDate(v.created_at)}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </KnowledgeShell>
  );
}
