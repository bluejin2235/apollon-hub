"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Btn,
  ErrorLine,
  FieldInput,
  FieldSelect,
  Hint,
  KnowledgeShell,
  ListCard,
  ListItem,
  LoadingLine
} from "@/components/luna/knowledge/ui";
import { K } from "@/lib/luna/knowledge-format";
import { supabase } from "@/lib/supabase/client";

type PeriodKey = "7" | "30" | "90" | "custom";

type HistoryItem = {
  id: string;
  user_name: string;
  av: string;
  when: string;
  message_count: number;
  summary: string;
  corrections: Array<{ text: string; status: string }>;
  candidate_count: number;
  thumbs_up: number;
  thumbs_down: number;
  has_unapplied: boolean;
  search_zero: boolean;
  can_teach: boolean;
};

type HistoryPayload = {
  range: { start: string; end: string };
  trend: {
    weeks: Array<{ label: string; values: Record<string, number> }>;
    users: Array<{ key: string; name: string; color: string }>;
  };
  ranking: Array<{
    rank: number;
    name: string;
    count: number;
    av: string;
    unused?: boolean;
  }>;
  filter_counts: {
    good: number;
    bad: number;
    correction: number;
    unapplied: number;
    search_zero: number;
  };
  users: Array<{ id: string; name: string }>;
  items: HistoryItem[];
  total: number;
  page: number;
};

const AV_STYLES = [
  { bg: K.lunaSoft, color: K.lunaInk },
  { bg: K.talkSoft, color: K.talk },
  { bg: K.candSoft, color: K.candInk },
  { bg: K.chip, color: K.sub }
];

const REACTIONS = [
  { key: "all", label: "전체" },
  { key: "good", countKey: "good" as const, label: "좋아요" },
  { key: "bad", countKey: "bad" as const, label: "싫어요" },
  { key: "correction", countKey: "correction" as const, label: "정정" },
  { key: "unapplied", countKey: "unapplied" as const, label: "미반영" },
  { key: "search_zero", countKey: "search_zero" as const, label: "검색 0건" }
];

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function PeriodChip({
  on,
  children,
  onClick
}: {
  on: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[20px] border px-[13px] py-[5px] text-[12px]"
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

function TrendChart({
  weeks,
  users
}: {
  weeks: HistoryPayload["trend"]["weeks"];
  users: HistoryPayload["trend"]["users"];
}) {
  const points = useMemo(() => {
    if (!weeks.length) return null;
    const keys = users.map((u) => u.key);
    const maxVal = Math.max(
      1,
      ...weeks.flatMap((w) => keys.map((k) => w.values[k] ?? 0))
    );
    const xStep = weeks.length > 1 ? 270 / (weeks.length - 1) : 0;
    const lines = users.map((u) => {
      const pts = weeks.map((w, i) => {
        const v = w.values[u.key] ?? 0;
        const x = 70 + i * xStep;
        const y = 150 - (v / maxVal) * 110;
        return `${x},${y}`;
      });
      return { color: u.color, pts: pts.join(" "), dashed: u.key === "__others__" };
    });
    return { lines, labels: weeks.map((w, i) => ({ x: 70 + i * xStep, label: w.label })), maxVal };
  }, [weeks, users]);

  if (!points || weeks.length === 0) {
    return (
      <p className="py-8 text-center text-[12px]" style={{ color: K.faint }}>
        이 기간에 대화 데이터가 없습니다.
      </p>
    );
  }

  return (
    <div>
      <svg viewBox="0 0 420 180" className="h-auto w-full">
        <line x1="34" y1="150" x2="410" y2="150" stroke="#B4B2A9" strokeWidth="0.5" />
        {[110, 70, 30].map((y) => (
          <line
            key={y}
            x1="34"
            y1={y}
            x2="410"
            y2={y}
            stroke="#D3D1C7"
            strokeWidth="0.5"
            strokeDasharray="3 3"
          />
        ))}
        {points.lines.map((line) => (
          <polyline
            key={line.color + line.pts}
            points={line.pts}
            fill="none"
            stroke={line.color}
            strokeWidth={line.dashed ? 1.5 : 2}
            strokeDasharray={line.dashed ? "4 3" : undefined}
          />
        ))}
        {points.labels.map((l) => (
          <text key={l.label} x={l.x} y="166" textAnchor="middle" fontSize="9" fill={K.faint}>
            {l.label.replace(" 주", "")}
          </text>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3.5 text-[11.5px]" style={{ color: K.sub }}>
        {users.map((u) => (
          <span key={u.key} className="inline-flex items-center gap-1">
            <i
              className="inline-block h-0.5 w-2.5"
              style={{ background: u.color }}
            />
            {u.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export function LunaTalkHistory() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<PeriodKey>("30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [userId, setUserId] = useState("");
  const [reaction, setReaction] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [teaching, setTeaching] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      setError("로그인이 필요합니다");
      return;
    }
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page) });
    if (period === "custom" && customFrom && customTo) {
      params.set("from", customFrom);
      params.set("to", customTo);
    } else {
      params.set("days", period);
    }
    if (query) params.set("q", query);
    if (userId) params.set("user_id", userId);
    if (reaction !== "all") params.set("reaction", reaction);

    const res = await fetch(`/api/luna/talk/history?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setError(`불러오기 실패: ${await res.text()}`);
      setLoading(false);
      return;
    }
    setData((await res.json()) as HistoryPayload);
    setLoading(false);
  }, [customFrom, customTo, page, period, query, reaction, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setQuery(q.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function teach(conversationId: string) {
    const token = await getAccessToken();
    if (!token || teaching) return;
    setTeaching(conversationId);
    try {
      const res = await fetch("/api/luna/talk/teach", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ conversation_id: conversationId })
      });
      const json = (await res.json()) as { redirect?: string; error?: string };
      if (!res.ok) {
        setError(json.error || "가르치기 실패");
        return;
      }
      router.push(json.redirect ?? "/settings?tab=luna&luna=candidates&sub=pending");
    } finally {
      setTeaching(null);
    }
  }

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / 20));

  return (
    <KnowledgeShell>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {(["7", "30", "90"] as const).map((d) => (
          <PeriodChip
            key={d}
            on={period === d}
            onClick={() => {
              setPeriod(d);
              setPage(1);
            }}
          >
            {d}일
          </PeriodChip>
        ))}
        <PeriodChip
          on={period === "custom"}
          onClick={() => setPeriod("custom")}
        >
          직접 지정
        </PeriodChip>
        {period === "custom" ? (
          <>
            <FieldInput
              type="date"
              className="!py-1.5 text-[12px]"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
            <span style={{ color: K.faint }}>–</span>
            <FieldInput
              type="date"
              className="!py-1.5 text-[12px]"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
            <Btn onClick={() => void load()}>적용</Btn>
          </>
        ) : null}
        {data ? (
          <span className="ml-auto text-[11.5px]" style={{ color: K.faint }}>
            {data.range.start} – {data.range.end}
          </span>
        ) : null}
      </div>

      {loading ? <LoadingLine /> : null}
      {error ? <ErrorLine message={error} /> : null}

      {!loading && data ? (
        <>
          <div className="mb-3.5 grid grid-cols-1 gap-3.5 min-[901px]:grid-cols-[1.6fr_1fr]">
            <div
              className="rounded-[12px] border px-4 py-3.5"
              style={{ background: K.panel, borderColor: K.line }}
            >
              <h4 className="mb-2.5 text-[13px] font-bold">
                사용자별 대화 추이{" "}
                <span className="float-right text-[11.5px] font-normal" style={{ color: K.faint }}>
                  주간 합계
                </span>
              </h4>
              <TrendChart weeks={data.trend.weeks} users={data.trend.users} />
            </div>

            <div
              className="rounded-[12px] border px-4 py-3.5"
              style={{ background: K.panel, borderColor: K.line }}
            >
              <h4 className="mb-2.5 text-[13px] font-bold">
                사용자 순위{" "}
                <span className="float-right text-[11.5px] font-normal" style={{ color: K.faint }}>
                  {period === "custom" ? "기간" : `${period}일`}
                </span>
              </h4>
              {data.ranking.length === 0 ? (
                <p className="text-[12px]" style={{ color: K.faint }}>
                  —
                </p>
              ) : (
                data.ranking.map((r, i) => {
                  const style = AV_STYLES[Math.min(i, 3)]!;
                  return (
                    <div
                      key={`${r.rank}-${r.name}`}
                      className="flex items-center gap-2 border-t py-1.5 text-[12.5px] first:border-t-0"
                      style={{
                        borderColor: K.line2,
                        color: r.unused ? K.faint : K.ink
                      }}
                    >
                      <span className="w-3.5" style={{ color: K.faint }}>
                        {r.unused ? "" : r.rank}
                      </span>
                      {!r.unused ? (
                        <span
                          className="grid h-5 w-5 place-items-center rounded-full text-[9.5px] font-bold"
                          style={{ background: style.bg, color: style.color }}
                        >
                          {r.av}
                        </span>
                      ) : null}
                      <span className="flex-1">{r.name}</span>
                      <b className="font-bold">{r.unused ? 0 : r.count}</b>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-2">
            <FieldInput
              className="min-w-[170px] flex-1"
              placeholder="대화 내용 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <FieldSelect
              className="w-[130px]"
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">전체 사용자</option>
              {data.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </FieldSelect>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-[11.5px]" style={{ color: K.faint }}>
              반응
            </span>
            {REACTIONS.map((r) => {
              const count =
                r.key === "all"
                  ? null
                  : data.filter_counts[r.countKey!];
              const label =
                count != null && count > 0 ? `${r.label} ${count}` : r.label;
              return (
                <PeriodChip
                  key={r.key}
                  on={reaction === r.key}
                  onClick={() => {
                    setReaction(r.key);
                    setPage(1);
                  }}
                >
                  {label}
                </PeriodChip>
              );
            })}
          </div>

          <ListCard>
            {data.items.length === 0 ? (
              <ListItem>
                <p className="text-[13px]" style={{ color: K.faint }}>
                  대화가 없습니다.
                </p>
              </ListItem>
            ) : (
              data.items.map((item, idx) => {
                const avStyle = AV_STYLES[Math.min(idx, 3)]!;
                return (
                  <ListItem key={item.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="grid h-[22px] w-[22px] place-items-center rounded-full text-[10.5px] font-bold"
                        style={{ background: avStyle.bg, color: avStyle.color }}
                      >
                        {item.av}
                      </span>
                      <span className="text-[13.5px] font-bold">{item.user_name}</span>
                      <span className="text-[11.5px]" style={{ color: K.faint }}>
                        {item.when} · {item.message_count}메시지
                      </span>
                      <span className="ml-auto flex flex-wrap items-center gap-1.5">
                        {item.thumbs_up > 0 ? (
                          <Badge kind="ok">좋아요 {item.thumbs_up}</Badge>
                        ) : null}
                        {item.thumbs_down > 0 ? (
                          <Badge kind="red">싫어요 {item.thumbs_down}</Badge>
                        ) : null}
                        {item.corrections.length > 0 ? (
                          <Badge kind="warn">정정 {item.corrections.length}</Badge>
                        ) : null}
                        {item.has_unapplied ? (
                          <Badge kind="src">미반영</Badge>
                        ) : null}
                        {item.candidate_count > 0 ? (
                          <Badge kind="org">후보 {item.candidate_count}건</Badge>
                        ) : null}
                      </span>
                    </div>
                    <p
                      className="mt-2 line-clamp-2 text-[13px] leading-[1.55]"
                      style={{ color: K.sub }}
                      title={item.summary}
                    >
                      {item.summary}
                    </p>
                    {item.corrections[0] ? (
                      <p className="mt-1 text-[12.5px] leading-[1.55]" style={{ color: K.ink }}>
                        정정: &quot;{item.corrections[0].text}&quot;
                        {item.corrections[0].status === "active" ? (
                          <Badge kind="ok" className="ml-1">
                            기억 확정
                          </Badge>
                        ) : null}
                      </p>
                    ) : null}
                    {item.can_teach ? (
                      <Btn
                        className="mt-2"
                        disabled={teaching === item.id}
                        onClick={() => void teach(item.id)}
                      >
                        {teaching === item.id ? "처리 중…" : "이 건으로 가르치기"}
                      </Btn>
                    ) : null}
                  </ListItem>
                );
              })
            )}
          </ListCard>

          {pageCount > 1 ? (
            <div
              className="mt-3 flex items-center justify-center gap-2 text-[12px]"
              style={{ color: K.sub }}
            >
              <button
                type="button"
                disabled={page <= 1}
                className="rounded-[9px] border px-2 py-1 disabled:opacity-40"
                style={{ borderColor: K.line, background: K.panel }}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                이전
              </button>
              <span>
                {page} / {pageCount}
              </span>
              <button
                type="button"
                disabled={page >= pageCount}
                className="rounded-[9px] border px-2 py-1 disabled:opacity-40"
                style={{ borderColor: K.line, background: K.panel }}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                다음
              </button>
            </div>
          ) : null}

          <Hint>
            행 클릭 시 대화 원문 — 되묻기·가정·출처·반응이 그대로 표시
          </Hint>
        </>
      ) : null}
    </KnowledgeShell>
  );
}
