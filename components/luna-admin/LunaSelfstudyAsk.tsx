"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import { groupAnswerFlagsByQuestion } from "@/lib/luna/answer-flags-shared";
import {
  QA_DAILY_LIMIT,
  answerFlagIdFromRule,
  isAskableRuleCandidate,
  qaRuleQuestion
} from "@/lib/luna/rules-shared";
import type { TonightItem } from "@/lib/luna-admin/types";

type RuleRow = {
  id: string;
  pattern_type: string;
  pattern_value: string;
  signal_count: number;
  status: "candidate" | "active" | "dropped";
  evidence: Record<string, unknown>;
};

type FlagHit = { id: string; label: string };
type Metrics = {
  duration_ms?: number | null;
  total_docs?: number;
};
type FlagRow = {
  id: string;
  question: string;
  flags: FlagHit[];
  metrics: Metrics;
  status: string;
  created_at: string;
};

type Props = {
  onGo?: (href: string) => void;
};

type Filter = "all" | "rule" | "answer" | "skip";
const PAGE = 15;

type ListRow = {
  key: string;
  kind: "rule" | "answer" | "skip";
  title: string;
  detail: string;
  badge: string;
};

export function LunaSelfstudyAsk({ onGo }: Props) {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [skips, setSkips] = useState<TonightItem[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      setError("");
      const [ruleJson, flagJson, tonight] = await Promise.all([
        adminFetch<{ rows: RuleRow[] }>("/api/luna-admin/rules"),
        adminFetch<{ rows: FlagRow[] }>("/api/luna-admin/answer-flags?status=pending"),
        adminFetch<{ items: TonightItem[] }>("/api/luna-admin/tonight")
      ]);
      setRules((ruleJson.rows ?? []).filter((r) => r.status === "candidate"));
      setFlags(flagJson.rows ?? []);
      setSkips(
        (tonight.items ?? []).filter(
          (i) => !i.excluded && (i.when === "tomorrow" || i.verifiable === false)
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오기 실패");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => groupAnswerFlagsByQuestion(flags), [flags]);
  const askableRules = useMemo(
    () =>
      [...rules]
        .filter(isAskableRuleCandidate)
        .sort((a, b) => (b.signal_count ?? 0) - (a.signal_count ?? 0)),
    [rules]
  );
  const coveredFlags = useMemo(() => {
    const set = new Set<string>();
    for (const row of askableRules) {
      const id = answerFlagIdFromRule(row.pattern_value);
      if (id) set.add(id);
    }
    return set;
  }, [askableRules]);
  const rows = useMemo<ListRow[]>(() => {
    const ruleRows: ListRow[] = askableRules.map((row) => {
      const n = row.signal_count;
      const flag = answerFlagIdFromRule(row.pattern_value);
      return {
        key: `r-${row.id}`,
        kind: "rule",
        title: qaRuleQuestion(row),
        detail: flag
          ? `${n}번 있었어요 · 정하시면 앞으로 안 여쭤봐요`
          : `${n}건 근거`,
        badge: "확인"
      };
    });
    const ansRows: ListRow[] = grouped
      .filter((g) => !g.latest.flags.some((f) => coveredFlags.has(f.id)))
      .map((g) => {
        const m = g.latest.metrics ?? {};
        const docs = typeof m.total_docs === "number" ? `글 ${m.total_docs}개` : "";
        const ms =
          typeof m.duration_ms === "number"
            ? `${(m.duration_ms / 1000).toFixed(1)}초`
            : "";
        const flagsText = g.latest.flags.map((f) => f.label).join(" · ");
        const repeat = g.count > 1 ? `같은 질문 ${g.count}번` : "";
        return {
          key: `a-${g.latest.id}`,
          kind: "answer",
          title: `“${g.question}” — 도움이 됐나요?`,
          detail: [docs, ms, flagsText, repeat].filter(Boolean).join(" · "),
          badge: "답"
        };
      });
    const skipRows: ListRow[] = skips.map((item) => ({
      key: `s-${item.id}`,
      kind: "skip",
      title: item.title,
      detail: item.skip_reason ?? item.why,
      badge: "정답 없음"
    }));
    return [...ruleRows, ...ansRows, ...skipRows].slice(0, QA_DAILY_LIMIT);
  }, [askableRules, grouped, skips, coveredFlags]);

  const filtered = filter === "all" ? rows : rows.filter((r) => r.kind === filter);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const safePage = Math.min(page, pages);
  const slice = filtered.slice((safePage - 1) * PAGE, safePage * PAGE);
  const total = rows.length;
  const ruleN = rows.filter((r) => r.kind === "rule").length;
  const answerN = rows.filter((r) => r.kind === "answer").length;
  const skipN = rows.filter((r) => r.kind === "skip").length;

  useEffect(() => {
    setPage(1);
  }, [filter]);

  if (!loaded && rows.length === 0) {
    return <p className="empty">불러오는 중…</p>;
  }

  return (
    <>
      <div className="start">
        <div className="t">
          {total > 0 ? `🌙 ${total}건을 물어볼게요` : "지금은 여쭤볼 게 없어요"}
        </div>
        <div className="d">
          {total > 0
            ? "하나씩 보여드릴게요. 고르기만 하면 됩니다. 모르면 「모르겠어요」를 눌러 주세요."
            : "확인할 게 쌓이면 여기로 올게요."}
        </div>
        {total > 0 ? (
          <button type="button" className="bt" onClick={() => onGo?.("/q")}>
            답하기 시작 →
          </button>
        ) : (
          <button type="button" className="bt" onClick={() => onGo?.("/luna")}>
            루나와 대화하기
          </button>
        )}
        {ruleN > 0 ? (
          <div className="sub">확인 {ruleN}건을 먼저 물어봅니다</div>
        ) : null}
      </div>

      <div className="sum3">
        <button
          type="button"
          className={filter === "rule" || filter === "all" ? "on" : ""}
          onClick={() => setFilter((f) => (f === "rule" ? "all" : "rule"))}
        >
          <div className="t">🌙 확인</div>
          <div className="v">{ruleN}</div>
          <div className="d">하나로 여러 건 정리</div>
        </button>
        <button
          type="button"
          className={filter === "answer" ? "on" : ""}
          onClick={() => setFilter((f) => (f === "answer" ? "all" : "answer"))}
        >
          <div className="t">답 점검</div>
          <div className="v">{answerN}</div>
          <div className="d">어색했던 답</div>
        </button>
        <button
          type="button"
          className={filter === "skip" ? "on" : ""}
          onClick={() => setFilter((f) => (f === "skip" ? "all" : "skip"))}
        >
          <div className="t">정답 없어 못 함</div>
          <div className="v">{skipN}</div>
          <div className="d">사람이 봐야 함</div>
        </button>
      </div>

      {error ? <p className="empty">{error}</p> : null}

      <div className="sech">
        <span className="t">무엇을 묻나</span>
        <span className="n">{filtered.length}</span>
        <span className="sp" />
        {total > 0 ? (
          <button type="button" className="a" onClick={() => onGo?.("/q")}>
            전부 답하기 →
          </button>
        ) : null}
      </div>

      {slice.length === 0 ? (
        <p className="empty">해당 항목이 없습니다.</p>
      ) : (
        slice.map((row) => (
          <button
            type="button"
            className="askli"
            key={row.key}
            onClick={() => onGo?.("/q")}
          >
            <span className="ic">
              {row.kind === "rule" ? "🌙" : row.kind === "answer" ? "💬" : "—"}
            </span>
            <span className="c">
              <span className="t">{row.title}</span>
              <span className="d">{row.detail}</span>
            </span>
            <span className={`badge ${row.kind}`}>{row.badge}</span>
          </button>
        ))
      )}

      {filtered.length > PAGE ? (
        <div className="pager">
          <span className="info">
            <b>{(safePage - 1) * PAGE + 1}</b>–
            <b>{Math.min(safePage * PAGE, filtered.length)}</b> / {filtered.length}건
          </span>
          <span className="sp" />
          <div className="pg">
            <button
              type="button"
              className={safePage <= 1 ? "off" : ""}
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ‹
            </button>
            {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                className={n === safePage ? "on" : ""}
                onClick={() => setPage(n)}
              >
                {n}
              </button>
            ))}
            <button
              type="button"
              className={safePage >= pages ? "off" : ""}
              disabled={safePage >= pages}
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
            >
              ›
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
