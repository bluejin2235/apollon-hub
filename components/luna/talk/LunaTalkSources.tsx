"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Btn,
  ErrorLine,
  FieldInput,
  FieldSelect,
  KnowledgeShell,
  LoadingLine,
  StatCard,
  StatGrid
} from "@/components/luna/knowledge/ui";
import { SupplyToast } from "@/components/supplies/toast";
import { clipText, K, scopeLabel } from "@/lib/luna/knowledge-format";
import {
  formatMonthLabel,
  formatSourceDate,
  groupTypeSummary,
  kstYmd,
  recentInputLabel,
  shiftMonth,
  sourceTypeLabel,
  type PeriodKey
} from "@/lib/luna/knowledge-sources";
import { buildLunaSettingsUrl } from "@/lib/luna/settings-nav";
import { supabase } from "@/lib/supabase/client";

type LearningItem = {
  id: string;
  content: string;
  status: string;
  scope_suggestion: string | null;
};

type TermItem = {
  id: string;
  term_ko: string;
  term_en: string | null;
  term_zh: string | null;
  definition: string | null;
};

type SourceItem = {
  id: string;
  title: string;
  body: string;
  source_type: string;
  spoken_by: string | null;
  spoken_at: string | null;
  source_ref: string | null;
  topic: string;
  learning_count: number;
  term_count: number | null;
  conflict_count: number;
  learnings: LearningItem[];
  terms: TermItem[] | null;
  terms_omitted_reason: string | null;
};

type FacetDate = { date: string; count: number };
type FacetTopic = { topic: string; label: string; count: number };
type FacetSpeaker = { spoken_by: string; label: string; count: number };

type Stats = {
  sources: number;
  learnings: number;
  terms: number | null;
  terms_omitted_reason: string | null;
  latest: { spoken_at: string | null; spoken_by: string | null } | null;
};

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "7", label: "7일" },
  { key: "30", label: "30일" },
  { key: "90", label: "90일" },
  { key: "all", label: "전체" },
  { key: "custom", label: "직접 지정" }
];

function Chip({
  on,
  children,
  onClick
}: {
  on?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-[20px] border px-[13px] py-[5px] text-[12px]"
      style={{
        background: on ? K.luna : K.panel,
        color: on ? "#fff" : K.sub,
        borderColor: on ? K.luna : K.line,
        fontWeight: on ? 700 : 400
      }}
    >
      {children}
    </button>
  );
}

function SideRow({
  on,
  label,
  count,
  onClick
}: {
  on?: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px]"
      style={{
        background: on ? K.lunaSoft : "transparent",
        color: on ? K.lunaInk : K.ink,
        fontWeight: on ? 700 : 400
      }}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span
        className="shrink-0 text-[11px]"
        style={{ color: on ? K.lunaInk : K.faint }}
      >
        {count}
      </span>
    </button>
  );
}

function SmBtn({
  children,
  onClick,
  disabled,
  ghost,
  primary,
  title
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  ghost?: boolean;
  primary?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="cursor-pointer rounded-[9px] border px-2.5 py-[5px] text-[11.5px] font-bold disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        background: primary ? K.luna : ghost ? "transparent" : K.panel,
        color: primary ? "#fff" : ghost ? K.sub : "#33363c",
        borderColor: primary ? K.luna : ghost ? "transparent" : K.line
      }}
    >
      {children}
    </button>
  );
}

function learningStatusBadge(status: string): {
  label: string;
  kind: "warn" | "ok" | "src";
} {
  if (status === "active") return { label: "확정", kind: "ok" };
  if (status === "archived") return { label: "폐기", kind: "src" };
  return { label: "후보 대기", kind: "warn" };
}

export function LunaTalkSources() {
  const searchParams = useSearchParams();
  const focusSourceId = searchParams.get("source");
  const focusAppliedRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const [period, setPeriod] = useState<PeriodKey>(() =>
    focusSourceId ? "all" : "30"
  );
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [month, setMonth] = useState(() => kstYmd().slice(0, 7));
  const [dateFilter, setDateFilter] = useState<string | null>(null);
  const [topicFilter, setTopicFilter] = useState("");
  const [speakerFilter, setSpeakerFilter] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "oldest">("recent");

  const [rangeLabel, setRangeLabel] = useState("—");
  const [rangeCount, setRangeCount] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [dates, setDates] = useState<FacetDate[]>([]);
  const [topics, setTopics] = useState<FacetTopic[]>([]);
  const [speakers, setSpeakers] = useState<FacetSpeaker[]>([]);
  const [items, setItems] = useState<SourceItem[]>([]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAllLearnings, setShowAllLearnings] = useState<Set<string>>(
    new Set()
  );
  const [showAllTerms, setShowAllTerms] = useState<Set<string>>(new Set());
  const [editingLearning, setEditingLearning] = useState<{
    sourceId: string;
    learningId: string;
    content: string;
    note: string;
  } | null>(null);
  const [editingSource, setEditingSource] = useState<{
    id: string;
    title: string;
    body: string;
    spoken_by: string;
    spoken_at: string;
    topic: string;
  } | null>(null);
  const [fullViewId, setFullViewId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({
    title: "",
    body: "",
    spoken_by: "",
    spoken_at: kstYmd(),
    topic: "",
    source_type: "interview"
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      setError("로그인이 필요합니다");
      return;
    }
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      period,
      month,
      sort
    });
    if (period === "custom") {
      if (customFrom) params.set("from", customFrom);
      if (customTo) params.set("to", customTo);
    }
    if (dateFilter) params.set("date", dateFilter);
    if (topicFilter) params.set("topic", topicFilter);
    if (speakerFilter) params.set("spoken_by", speakerFilter);
    if (query) params.set("q", query);

    const res = await fetch(`/api/luna/knowledge/sources?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setError(`불러오기 실패: ${await res.text()}`);
      setLoading(false);
      return;
    }
    const json = (await res.json()) as {
      range?: { label?: string; count?: number };
      stats?: Stats | null;
      facets?: {
        dates?: FacetDate[];
        topics?: FacetTopic[];
        speakers?: FacetSpeaker[];
      };
      items?: SourceItem[];
      notes?: string[];
    };
    setRangeLabel(json.range?.label ?? "—");
    setRangeCount(json.range?.count ?? 0);
    setStats(json.stats ?? null);
    setDates(json.facets?.dates ?? []);
    setTopics(json.facets?.topics ?? []);
    setSpeakers(json.facets?.speakers ?? []);
    setItems(json.items ?? []);
    setNotes(json.notes ?? []);
    setLoading(false);
  }, [
    period,
    customFrom,
    customTo,
    month,
    dateFilter,
    topicFilter,
    speakerFilter,
    query,
    sort
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!focusSourceId) return;
    if (focusAppliedRef.current === focusSourceId) return;
    setPeriod("all");
    setDateFilter(null);
    setTopicFilter("");
    setSpeakerFilter("");
  }, [focusSourceId]);

  useEffect(() => {
    if (!focusSourceId || loading) return;
    if (focusAppliedRef.current === focusSourceId) return;
    const found = items.some((i) => i.id === focusSourceId);
    if (!found) return;
    focusAppliedRef.current = focusSourceId;
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(focusSourceId);
      return next;
    });
    requestAnimationFrame(() => {
      document
        .getElementById(`luna-source-${focusSourceId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [focusSourceId, items, loading]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const groups = useMemo(() => {
    const map = new Map<string, SourceItem[]>();
    for (const item of items) {
      const key = item.spoken_at || "unknown";
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [items]);

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function patchLearning(payload: {
    id: string;
    status?: string;
    content?: string;
    change_note?: string;
  }) {
    const token = await getAccessToken();
    if (!token) return false;
    const res = await fetch("/api/luna/knowledge", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      setToast(`저장 실패: ${await res.text()}`);
      return false;
    }
    return true;
  }

  async function holdLearning(id: string) {
    if (busy) return;
    setBusy(true);
    const ok = await patchLearning({ id, status: "archived", change_note: "보류" });
    setBusy(false);
    if (ok) {
      setToast("보류했습니다. 변경 이력에 남았습니다.");
      void load();
    }
  }

  async function saveLearningEdit() {
    if (!editingLearning || busy) return;
    if (!editingLearning.content.trim() || !editingLearning.note.trim()) {
      setToast("본문과 변경사유를 입력하세요.");
      return;
    }
    setBusy(true);
    const ok = await patchLearning({
      id: editingLearning.learningId,
      content: editingLearning.content,
      change_note: editingLearning.note
    });
    setBusy(false);
    if (ok) {
      setEditingLearning(null);
      setToast("지식을 수정했습니다. 변경 이력에 남았습니다.");
      void load();
    }
  }

  async function saveSourceEdit() {
    if (!editingSource || busy) return;
    if (!editingSource.title.trim() || !editingSource.body.trim()) {
      setToast("제목과 본문을 입력하세요.");
      return;
    }
    const token = await getAccessToken();
    if (!token) return;
    setBusy(true);
    const res = await fetch("/api/luna/knowledge/sources", {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: editingSource.id,
        title: editingSource.title,
        body: editingSource.body,
        spoken_by: editingSource.spoken_by,
        spoken_at: editingSource.spoken_at || null,
        topic: editingSource.topic
      })
    });
    setBusy(false);
    if (!res.ok) {
      setToast(`원문 수정 실패: ${await res.text()}`);
      return;
    }
    setEditingSource(null);
    setToast("원문을 수정했습니다.");
    void load();
  }

  async function createSource() {
    if (busy) return;
    if (!addForm.title.trim() || !addForm.body.trim()) {
      setToast("제목과 본문을 입력하세요.");
      return;
    }
    const token = await getAccessToken();
    if (!token) return;
    setBusy(true);
    const res = await fetch("/api/luna/knowledge/sources", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(addForm)
    });
    setBusy(false);
    if (!res.ok) {
      setToast(`원문 추가 실패: ${await res.text()}`);
      return;
    }
    setShowAdd(false);
    setAddForm({
      title: "",
      body: "",
      spoken_by: "",
      spoken_at: kstYmd(),
      topic: "",
      source_type: "interview"
    });
    setToast("원문을 추가했습니다.");
    void load();
  }

  const fullViewItem = fullViewId
    ? items.find((i) => i.id === fullViewId) ?? null
    : null;

  return (
    <KnowledgeShell>
      <SupplyToast message={toast} onClose={() => setToast(null)} />

      <div className="mb-3.5">
        <h2 className="text-[17px] font-bold tracking-[-0.2px]">구술·문서</h2>
        <p className="mt-1 text-[12.5px]" style={{ color: K.sub }}>
          블루진 구술과 회사 문서 — 여기서 지식후보가 나옵니다
        </p>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {PERIODS.map((p) => (
          <Chip
            key={p.key}
            on={period === p.key}
            onClick={() => {
              setPeriod(p.key);
              setDateFilter(null);
            }}
          >
            {p.label}
          </Chip>
        ))}
        <span
          className="ml-auto text-[11.5px]"
          style={{ color: K.faint }}
        >
          {rangeLabel} · 원문 {rangeCount}편
        </span>
      </div>

      {period === "custom" ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <FieldInput
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
          />
          <span className="text-[12px]" style={{ color: K.faint }}>
            –
          </span>
          <FieldInput
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
          />
        </div>
      ) : null}

      <StatGrid>
        <StatCard label="원문" value={stats ? stats.sources : "—"} />
        <StatCard
          label="여기서 나온 지식"
          value={stats ? stats.learnings : "—"}
        />
        {stats?.terms_omitted_reason ? null : (
          <StatCard
            label="여기서 나온 용어"
            value={stats && stats.terms != null ? stats.terms : "—"}
          />
        )}
        <StatCard
          label="최근 입력"
          value={
            stats?.latest
              ? recentInputLabel(
                  stats.latest.spoken_at,
                  stats.latest.spoken_by
                )
              : "—"
          }
          small
        />
      </StatGrid>

      {stats?.terms_omitted_reason ? (
        <p className="mb-3 text-[11.5px]" style={{ color: K.faint }}>
          {stats.terms_omitted_reason}
        </p>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-3.5 min-[901px]:grid-cols-[230px_1fr]">
        <aside
          className="sticky top-4 max-h-[calc(100vh-60px)] overflow-auto rounded-xl border px-2.5 py-3 max-[900px]:static max-[900px]:max-h-none"
          style={{ background: K.panel, borderColor: K.line }}
        >
          <div className="mb-2 flex items-center gap-1.5 px-1">
            <button
              type="button"
              className="grid h-[22px] w-[22px] place-items-center rounded-md text-[12px]"
              style={{ color: K.sub }}
              onClick={() => {
                setMonth((m) => shiftMonth(m, -1));
                setDateFilter(null);
              }}
            >
              ‹
            </button>
            <div className="flex-1 text-center text-[12.5px] font-bold">
              {formatMonthLabel(month)}
            </div>
            <button
              type="button"
              className="grid h-[22px] w-[22px] place-items-center rounded-md text-[12px]"
              style={{ color: K.sub }}
              onClick={() => {
                setMonth((m) => shiftMonth(m, 1));
                setDateFilter(null);
              }}
            >
              ›
            </button>
          </div>

          <div
            className="mb-1.5 px-1.5 text-[11px] font-extrabold uppercase"
            style={{ color: K.faint }}
          >
            날짜
          </div>
          {dates.length === 0 ? (
            <p className="px-2 py-1 text-[12px]" style={{ color: K.faint }}>
              이 달에 원문 없음
            </p>
          ) : (
            dates.map((d) => (
              <SideRow
                key={d.date}
                on={dateFilter === d.date}
                label={formatSourceDate(d.date, "side")}
                count={d.count}
                onClick={() =>
                  setDateFilter((prev) => (prev === d.date ? null : d.date))
                }
              />
            ))
          )}

          <div
            className="mb-1.5 mt-3.5 border-t px-1.5 pt-3 text-[11px] font-extrabold uppercase"
            style={{ color: K.faint, borderColor: K.line2 }}
          >
            주제
          </div>
          {topics.map((t) => (
            <SideRow
              key={t.topic || "__all__"}
              on={topicFilter === t.topic}
              label={t.label}
              count={t.count}
              onClick={() => setTopicFilter(t.topic)}
            />
          ))}

          <div
            className="mb-1.5 mt-3.5 border-t px-1.5 pt-3 text-[11px] font-extrabold uppercase"
            style={{ color: K.faint, borderColor: K.line2 }}
          >
            구술자
          </div>
          {speakers.map((s) => (
            <SideRow
              key={s.spoken_by || "__all__"}
              on={speakerFilter === s.spoken_by}
              label={s.label}
              count={s.count}
              onClick={() => setSpeakerFilter(s.spoken_by)}
            />
          ))}
        </aside>

        <section>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <FieldInput
              className="min-w-[170px] flex-1"
              placeholder="원문 내용 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <FieldSelect
              className="w-[110px]"
              value={sort}
              onChange={(e) =>
                setSort(e.target.value === "oldest" ? "oldest" : "recent")
              }
            >
              <option value="recent">최근순</option>
              <option value="oldest">오래된순</option>
            </FieldSelect>
            <Btn type="button" onClick={() => setShowAdd(true)}>
              원문 추가
            </Btn>
          </div>

          {loading ? <LoadingLine /> : null}
          {error ? <ErrorLine message={error} /> : null}
          {!loading && !error && notes.length > 0 ? (
            <p className="mb-2 text-[11.5px]" style={{ color: K.faint }}>
              {notes.join(" · ")}
            </p>
          ) : null}

          {!loading && !error && items.length === 0 ? (
            <p className="py-8 text-center text-[13px]" style={{ color: K.sub }}>
              조건에 맞는 원문이 없습니다.
            </p>
          ) : null}

          {groups.map(([day, dayItems]) => (
            <div key={day} className="mb-2">
              <div
                className="mb-2 flex items-center gap-2 text-[12px]"
                style={{ color: K.sub }}
              >
                <b className="text-[13px] font-bold" style={{ color: K.ink }}>
                  {day === "unknown" ? "날짜 없음" : formatSourceDate(day, "full")}
                </b>
                <span style={{ color: K.faint }}>
                  · {groupTypeSummary(dayItems)}
                </span>
              </div>

              {dayItems.map((item) => {
                const open = expanded.has(item.id);
                const learningsOpen = showAllLearnings.has(item.id);
                const termsOpen = showAllTerms.has(item.id);
                const visibleLearnings = learningsOpen
                  ? item.learnings
                  : item.learnings.slice(0, 3);
                const hiddenLearningCount = Math.max(
                  0,
                  item.learnings.length - 3
                );
                const visibleTerms =
                  item.terms == null
                    ? []
                    : termsOpen
                      ? item.terms
                      : item.terms.slice(0, 2);
                const hiddenTerms =
                  item.terms && !termsOpen ? item.terms.slice(2) : [];

                return (
                  <div
                    key={item.id}
                    id={`luna-source-${item.id}`}
                    className="mb-2.5 scroll-mt-4 rounded-xl border"
                    style={{ background: K.panel, borderColor: K.line }}
                  >
                    <button
                      type="button"
                      className="flex w-full cursor-pointer flex-wrap items-center gap-2.5 px-4 py-3.5 text-left"
                      onClick={() => toggleExpanded(item.id)}
                    >
                      <span className="min-w-[180px] flex-1 text-[14.5px] font-bold">
                        {clipText(item.title, 80)}
                      </span>
                      <span
                        className="rounded-[20px] px-2 py-0.5 text-[10.5px] font-extrabold"
                        style={{ background: K.chip, color: K.sub }}
                      >
                        {sourceTypeLabel(item.source_type)}
                      </span>
                      <span
                        className="rounded-[20px] px-2 py-0.5 text-[10.5px] font-extrabold"
                        style={{ background: K.lunaSoft, color: K.lunaInk }}
                      >
                        지식 {item.learning_count}
                      </span>
                      <span
                        className="rounded-[20px] px-2 py-0.5 text-[10.5px] font-extrabold"
                        style={{ background: K.talkSoft, color: K.talk }}
                      >
                        용어 {item.term_count ?? "—"}
                      </span>
                      {item.conflict_count > 0 ? (
                        <span
                          className="rounded-[20px] px-2 py-0.5 text-[10.5px] font-extrabold"
                          style={{ background: K.candSoft, color: K.candInk }}
                        >
                          충돌 {item.conflict_count}
                        </span>
                      ) : null}
                      <span className="text-[11.5px]" style={{ color: K.faint }}>
                        {item.spoken_by
                          ? `${clipText(item.spoken_by, 24)} 구술`
                          : "—"}
                      </span>
                      <span className="text-[12px]" style={{ color: K.faint }}>
                        {open ? "▲" : "▼"}
                      </span>
                    </button>
                    {item.source_ref ? (
                      <div
                        className="px-4 pb-2 text-[11.5px]"
                        style={{ color: K.faint }}
                      >
                        출처: {clipText(item.source_ref, 60)}
                      </div>
                    ) : null}

                    {open ? (
                      <div
                        className="border-t px-4 py-4"
                        style={{ borderColor: K.line2 }}
                      >
                        {editingSource?.id === item.id ? (
                          <div
                            className="mb-4 rounded-[9px] border px-3.5 py-3"
                            style={{
                              borderColor: "#d9d2ff",
                              background: "#fbfaff"
                            }}
                          >
                            <div
                              className="mb-1 text-[11px]"
                              style={{ color: K.faint }}
                            >
                              원문 수정
                            </div>
                            <FieldInput
                              className="mb-2 w-full"
                              value={editingSource.title}
                              onChange={(e) =>
                                setEditingSource({
                                  ...editingSource,
                                  title: e.target.value
                                })
                              }
                              placeholder="제목"
                            />
                            <textarea
                              className="mb-2 w-full resize-y rounded-[9px] border px-[11px] py-2 text-[13px] leading-[1.7] outline-none focus:border-[#d9d2ff]"
                              style={{
                                borderColor: K.line,
                                background: K.panel,
                                color: K.ink,
                                minHeight: 120
                              }}
                              value={editingSource.body}
                              onChange={(e) =>
                                setEditingSource({
                                  ...editingSource,
                                  body: e.target.value
                                })
                              }
                            />
                            <div className="mb-2 flex flex-wrap gap-2">
                              <FieldInput
                                className="min-w-[120px] flex-1"
                                value={editingSource.spoken_by}
                                onChange={(e) =>
                                  setEditingSource({
                                    ...editingSource,
                                    spoken_by: e.target.value
                                  })
                                }
                                placeholder="구술자"
                              />
                              <FieldInput
                                type="date"
                                value={editingSource.spoken_at}
                                onChange={(e) =>
                                  setEditingSource({
                                    ...editingSource,
                                    spoken_at: e.target.value
                                  })
                                }
                              />
                              <FieldInput
                                className="min-w-[120px] flex-1"
                                value={editingSource.topic}
                                onChange={(e) =>
                                  setEditingSource({
                                    ...editingSource,
                                    topic: e.target.value
                                  })
                                }
                                placeholder="주제"
                              />
                            </div>
                            <div className="flex gap-1.5">
                              <SmBtn primary onClick={() => void saveSourceEdit()}>
                                저장
                              </SmBtn>
                              <SmBtn onClick={() => setEditingSource(null)}>
                                취소
                              </SmBtn>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div
                              className="mb-2 text-[11px] font-extrabold uppercase"
                              style={{ color: K.faint }}
                            >
                              원문
                            </div>
                            <div
                              className="max-h-[240px] overflow-auto whitespace-pre-wrap rounded-[9px] border px-4 py-3.5 text-[13px] leading-[1.8]"
                              style={{
                                background: "#fafbfc",
                                borderColor: K.line2
                              }}
                            >
                              {item.body || "—"}
                            </div>
                            <div className="mt-2.5 flex flex-wrap gap-2">
                              <SmBtn
                                onClick={() =>
                                  setEditingSource({
                                    id: item.id,
                                    title: item.title,
                                    body: item.body,
                                    spoken_by: item.spoken_by ?? "",
                                    spoken_at: item.spoken_at ?? "",
                                    topic: item.topic === "미분류" ? "" : item.topic
                                  })
                                }
                              >
                                원문 수정
                              </SmBtn>
                              <SmBtn onClick={() => setFullViewId(item.id)}>
                                전체 보기
                              </SmBtn>
                              <SmBtn ghost disabled title="준비 중">
                                요약 다시 만들기
                              </SmBtn>
                            </div>
                          </>
                        )}

                        <div className="mt-[18px]">
                          <div
                            className="mb-2 text-[11px] font-extrabold uppercase"
                            style={{ color: K.faint }}
                          >
                            여기서 나온 지식 {item.learning_count}
                          </div>
                          {item.learnings.length === 0 ? (
                            <p
                              className="text-[12.5px]"
                              style={{ color: K.faint }}
                            >
                              —
                            </p>
                          ) : (
                            visibleLearnings.map((l) => {
                              const scope = scopeLabel(l.scope_suggestion);
                              const st = learningStatusBadge(l.status);
                              return (
                                <div
                                  key={l.id}
                                  className="flex items-center gap-2.5 border-b py-[9px] last:border-b-0"
                                  style={{ borderColor: K.line2 }}
                                >
                                  <Badge kind={st.kind}>{st.label}</Badge>
                                  {scope ? (
                                    <Badge
                                      kind={
                                        scope.badge === "org" ? "org" : "me"
                                      }
                                    >
                                      {scope.label}
                                    </Badge>
                                  ) : null}
                                  <span className="min-w-0 flex-1 text-[13px] leading-[1.6]">
                                    {l.content}
                                  </span>
                                  {l.status !== "archived" ? (
                                    <span className="flex shrink-0 gap-1.5">
                                      <SmBtn
                                        onClick={() =>
                                          setEditingLearning({
                                            sourceId: item.id,
                                            learningId: l.id,
                                            content: l.content,
                                            note: ""
                                          })
                                        }
                                      >
                                        수정
                                      </SmBtn>
                                      <SmBtn
                                        onClick={() => void holdLearning(l.id)}
                                      >
                                        보류
                                      </SmBtn>
                                    </span>
                                  ) : null}
                                </div>
                              );
                            })
                          )}
                          {!learningsOpen && hiddenLearningCount > 0 ? (
                            <div
                              className="flex items-center justify-between py-[9px]"
                              style={{ color: K.faint }}
                            >
                              <span className="text-[13px]">
                                외 {hiddenLearningCount}건
                              </span>
                              <SmBtn
                                ghost
                                onClick={() =>
                                  setShowAllLearnings((prev) => {
                                    const next = new Set(prev);
                                    next.add(item.id);
                                    return next;
                                  })
                                }
                              >
                                모두 보기
                              </SmBtn>
                            </div>
                          ) : null}

                          {editingLearning?.sourceId === item.id ? (
                            <div
                              className="mt-2.5 rounded-[9px] border px-3.5 py-3"
                              style={{
                                borderColor: "#d9d2ff",
                                background: "#fbfaff"
                              }}
                            >
                              <div
                                className="mb-1 text-[11px]"
                                style={{ color: K.faint }}
                              >
                                지식 수정 — 편집 중
                              </div>
                              <textarea
                                className="mb-2 h-[76px] w-full resize-y rounded-[9px] border px-[11px] py-2 text-[13px] leading-[1.7] outline-none focus:border-[#d9d2ff]"
                                style={{
                                  borderColor: K.line,
                                  background: K.panel,
                                  color: K.ink
                                }}
                                value={editingLearning.content}
                                onChange={(e) =>
                                  setEditingLearning({
                                    ...editingLearning,
                                    content: e.target.value
                                  })
                                }
                              />
                              <div
                                className="mb-1 text-[11px]"
                                style={{ color: K.faint }}
                              >
                                무엇을 왜 바꿨나요
                              </div>
                              <FieldInput
                                className="mb-2 w-full"
                                placeholder="예: 표현 다듬음"
                                value={editingLearning.note}
                                onChange={(e) =>
                                  setEditingLearning({
                                    ...editingLearning,
                                    note: e.target.value
                                  })
                                }
                              />
                              <div className="flex gap-1.5">
                                <SmBtn
                                  primary
                                  onClick={() => void saveLearningEdit()}
                                >
                                  저장
                                </SmBtn>
                                <SmBtn onClick={() => setEditingLearning(null)}>
                                  취소
                                </SmBtn>
                              </div>
                            </div>
                          ) : null}
                        </div>

                        {item.terms_omitted_reason ? (
                          <div className="mt-[18px]">
                            <div
                              className="mb-2 text-[11px] font-extrabold uppercase"
                              style={{ color: K.faint }}
                            >
                              여기서 나온 용어
                            </div>
                            <p
                              className="text-[12.5px]"
                              style={{ color: K.faint }}
                            >
                              생략 · {item.terms_omitted_reason}
                            </p>
                          </div>
                        ) : (
                          <div className="mt-[18px]">
                            <div
                              className="mb-2 text-[11px] font-extrabold uppercase"
                              style={{ color: K.faint }}
                            >
                              여기서 나온 용어 {item.term_count ?? 0}
                            </div>
                            {visibleTerms.map((t) => (
                              <div
                                key={t.id}
                                className="flex items-center gap-2.5 border-b py-[9px] last:border-b-0"
                                style={{ borderColor: K.line2 }}
                              >
                                <span className="min-w-0 flex-1 text-[13px] leading-[1.6]">
                                  <b>{t.term_ko}</b>
                                  {t.term_en ? ` · ${t.term_en}` : ""}
                                  {t.term_zh ? (
                                    <>
                                      {" · "}
                                      <b>{t.term_zh}</b>
                                    </>
                                  ) : null}
                                  {t.definition
                                    ? ` — ${clipText(t.definition, 80)}`
                                    : ""}
                                </span>
                                <span className="shrink-0">
                                  <Link
                                    href={buildLunaSettingsUrl(
                                      "knowledge",
                                      "glossary"
                                    )}
                                    className="inline-block rounded-[9px] border px-2.5 py-[5px] text-[11.5px] font-bold"
                                    style={{
                                      background: K.panel,
                                      color: "#33363c",
                                      borderColor: K.line
                                    }}
                                  >
                                    용어사전에서 보기
                                  </Link>
                                </span>
                              </div>
                            ))}
                            {hiddenTerms.length > 0 ? (
                              <div
                                className="flex items-center justify-between py-[9px]"
                                style={{ color: K.faint }}
                              >
                                <span className="truncate text-[13px]">
                                  외 {hiddenTerms.length}건 —{" "}
                                  {hiddenTerms
                                    .map((t) => t.term_ko)
                                    .join(" · ")}
                                </span>
                                <SmBtn
                                  ghost
                                  onClick={() =>
                                    setShowAllTerms((prev) => {
                                      const next = new Set(prev);
                                      next.add(item.id);
                                      return next;
                                    })
                                  }
                                >
                                  모두 보기
                                </SmBtn>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      </div>

      {showAdd ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
          <div
            className="w-full max-w-[560px] rounded-xl border p-4"
            style={{ background: K.panel, borderColor: K.line }}
          >
            <h3 className="mb-3 text-[15px] font-bold">원문 추가</h3>
            <FieldInput
              className="mb-2 w-full"
              placeholder="제목"
              value={addForm.title}
              onChange={(e) =>
                setAddForm({ ...addForm, title: e.target.value })
              }
            />
            <textarea
              className="mb-2 w-full resize-y rounded-[9px] border px-[11px] py-2 text-[13px] leading-[1.7] outline-none focus:border-[#d9d2ff]"
              style={{
                borderColor: K.line,
                background: K.panel,
                color: K.ink,
                minHeight: 140
              }}
              placeholder="본문"
              value={addForm.body}
              onChange={(e) =>
                setAddForm({ ...addForm, body: e.target.value })
              }
            />
            <div className="mb-2 flex flex-wrap gap-2">
              <FieldInput
                className="min-w-[120px] flex-1"
                placeholder="구술자"
                value={addForm.spoken_by}
                onChange={(e) =>
                  setAddForm({ ...addForm, spoken_by: e.target.value })
                }
              />
              <FieldInput
                type="date"
                value={addForm.spoken_at}
                onChange={(e) =>
                  setAddForm({ ...addForm, spoken_at: e.target.value })
                }
              />
              <FieldInput
                className="min-w-[120px] flex-1"
                placeholder="주제"
                value={addForm.topic}
                onChange={(e) =>
                  setAddForm({ ...addForm, topic: e.target.value })
                }
              />
              <FieldSelect
                value={addForm.source_type}
                onChange={(e) =>
                  setAddForm({ ...addForm, source_type: e.target.value })
                }
              >
                <option value="interview">인터뷰</option>
                <option value="company_brief">회사소개서</option>
                <option value="service_intro">서비스소개서</option>
              </FieldSelect>
            </div>
            <div className="flex justify-end gap-2">
              <Btn type="button" onClick={() => setShowAdd(false)}>
                취소
              </Btn>
              <Btn type="button" primary onClick={() => void createSource()}>
                저장
              </Btn>
            </div>
          </div>
        </div>
      ) : null}

      {fullViewItem ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
          <div
            className="max-h-[85vh] w-full max-w-[720px] overflow-auto rounded-xl border p-4"
            style={{ background: K.panel, borderColor: K.line }}
          >
            <h3 className="mb-2 text-[15px] font-bold">{fullViewItem.title}</h3>
            <p className="mb-3 text-[12px]" style={{ color: K.faint }}>
              {fullViewItem.spoken_at
                ? formatSourceDate(fullViewItem.spoken_at, "full")
                : "—"}
              {fullViewItem.spoken_by
                ? ` · ${fullViewItem.spoken_by} 구술`
                : ""}
              {fullViewItem.source_ref
                ? ` · 출처: ${fullViewItem.source_ref}`
                : ""}
              {` · ${sourceTypeLabel(fullViewItem.source_type)}`}
            </p>
            <div className="whitespace-pre-wrap text-[13px] leading-[1.8]">
              {fullViewItem.body}
            </div>
            <div className="mt-4 flex justify-end">
              <Btn type="button" onClick={() => setFullViewId(null)}>
                닫기
              </Btn>
            </div>
          </div>
        </div>
      ) : null}
    </KnowledgeShell>
  );
}
