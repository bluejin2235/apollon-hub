"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import { buildLunaAdminUrl } from "@/lib/luna-admin/nav";
import {
  ANSWER_FLAG_IDS,
  ANSWER_FLAG_LABELS,
  groupAnswerFlagsByQuestion,
  type AnswerFlagId
} from "@/lib/luna/answer-flags-shared";
import { ruleQuestionText } from "@/lib/luna/rules-shared";
import {
  THUMBS_REASON_IDS,
  THUMBS_REASON_LABELS
} from "@/lib/luna/signals-shared";
import type { TonightItem } from "@/lib/luna-admin/types";

type RuleRow = {
  id: string;
  scope: string;
  pattern_type: string;
  pattern_value: string;
  signal_count: number;
  status: "candidate" | "active" | "dropped";
  evidence: Record<string, unknown>;
  created_at: string;
};

type FlagHit = { id: string; label: string; hint: string };
type Metrics = {
  intent_score?: number | null;
  confidence_score?: number | null;
  duration_ms?: number | null;
  search_ms?: number | null;
  total_docs?: number;
  notion_n?: number;
  wiki_n?: number;
};

type FlagRow = {
  id: string;
  message_id: string | null;
  question: string;
  flags: FlagHit[];
  severity: number;
  metrics: Metrics;
  status: string;
  human_verdict: string | null;
  source: string;
  created_at: string;
};

function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}초`;
  return `${Math.round(ms)}ms`;
}

type Props = {
  onGo?: (href: string) => void;
};

function skipHref(item: TonightItem): string {
  if (
    item.kind === "materialize_secondary" ||
    /2차|같은 것/.test(item.title)
  ) {
    return buildLunaAdminUrl("knowledge", "secondary");
  }
  if (item.failure_ids.length > 0 || /실패|되묻|의도|분류/.test(item.title)) {
    return buildLunaAdminUrl("failures", "causes");
  }
  return buildLunaAdminUrl("candidates", "pending");
}

export function LunaSelfstudyAsk({ onGo }: Props) {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [skips, setSkips] = useState<TonightItem[]>([]);
  const [status, setStatus] = useState<"pending" | "reviewed" | "ignored">("pending");
  const [flagFilter, setFlagFilter] = useState<AnswerFlagId | "">("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [badReason, setBadReason] = useState<Record<string, string>>({});
  const [showAllRules, setShowAllRules] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      setError("");
      const qs = new URLSearchParams({ status });
      if (flagFilter) qs.set("flag", flagFilter);
      const [ruleJson, flagJson, tonight] = await Promise.all([
        adminFetch<{ rows: RuleRow[] }>("/api/luna-admin/rules"),
        adminFetch<{ rows: FlagRow[] }>(`/api/luna-admin/answer-flags?${qs}`),
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
  }, [status, flagFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => groupAnswerFlagsByQuestion(flags), [flags]);
  const shownRules = showAllRules ? rules : rules.slice(0, 2);
  const total = rules.length + grouped.length + skips.length;

  if (!loaded && flags.length === 0 && rules.length === 0) {
    return <p className="empty">불러오는 중…</p>;
  }

  async function answerRule(id: string, accept: boolean) {
    setBusy(id);
    try {
      await adminFetch("/api/luna-admin/rules", {
        method: "POST",
        body: JSON.stringify({ id, accept })
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setBusy(null);
    }
  }

  async function reviewGroup(ids: string[], verdict: "good" | "bad" | "unclear") {
    setBusy(ids[0] ?? "group");
    try {
      await adminFetch("/api/luna-admin/answer-flags", {
        method: "POST",
        body: JSON.stringify({
          ids,
          verdict,
          reason: verdict === "bad" ? badReason[ids[0] ?? ""] || "wrong_answer" : null
        })
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="alert p">
        <div className="c">
          <div className="t">
            {total}건 · 규칙 {rules.length} · 답 {grouped.length}
          </div>
          <div className="d">
            <b>규칙부터 보시면 좋습니다.</b> 하나 정하면 여러 건이 한 번에 정리됩니다.
          </div>
        </div>
      </div>
      {error ? <p className="empty">{error}</p> : null}

      <div className="sech">
        <span className="t">🌙 규칙을 물어봅니다</span>
        <span className="n">{rules.length}</span>
        <span className="sp" />
        <span className="n">파급이 큰 순</span>
      </div>
      {rules.length === 0 ? (
        <p className="empty">확인할 규칙 후보가 없습니다.</p>
      ) : (
        shownRules.map((row) => (
          <div className="rule cand" key={row.id}>
            <div className="q">{ruleQuestionText(row)}</div>
            <div className="ev">
              근거 신호 <b>{row.signal_count}건</b>
            </div>
            <div className="meta">
              {row.scope} · {row.pattern_type} · {row.pattern_value}
              {typeof row.evidence?.impact === "number"
                ? ` · 정하면 ${row.evidence.impact}건 정리`
                : ""}
            </div>
            <div className="acts">
              <button
                type="button"
                className="btn sm p"
                disabled={busy === row.id}
                onClick={() => void answerRule(row.id, true)}
              >
                맞아요
              </button>
              <button
                type="button"
                className="btn sm"
                disabled={busy === row.id}
                onClick={() => void answerRule(row.id, false)}
              >
                아니요
              </button>
            </div>
          </div>
        ))
      )}
      {rules.length > 2 && !showAllRules ? (
        <p style={{ fontSize: 11, color: "var(--faint)", margin: "6px 0 0" }}>
          나머지 {rules.length - 2}건 ·{" "}
          <button type="button" className="a" onClick={() => setShowAllRules(true)}>
            더 보기
          </button>
        </p>
      ) : null}

      <div className="sech">
        <span className="t">답을 봐주세요</span>
        <span className="n">
          {grouped.length}
          {flags.length > grouped.length ? ` · ${flags.length}건을 묶음` : ""}
        </span>
        <span className="sp" />
        <div className="chips subchips">
          {(
            [
              ["pending", "대기"],
              ["reviewed", "봤음"],
              ["ignored", "무시함"]
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={status === v ? "on" : ""}
              onClick={() => setStatus(v)}
            >
              {v === "pending" && status === "pending"
                ? `${label} ${grouped.length}`
                : label}
            </button>
          ))}
          {ANSWER_FLAG_IDS.map((id) => (
            <button
              key={id}
              type="button"
              className={flagFilter === id ? "on" : ""}
              onClick={() => setFlagFilter((cur) => (cur === id ? "" : id))}
            >
              {ANSWER_FLAG_LABELS[id]}
            </button>
          ))}
        </div>
      </div>
      <p style={{ fontSize: 11.5, color: "var(--sub)", marginBottom: 11, lineHeight: 1.8 }}>
        지표가 어긋난 답입니다. <b>답이 맞는지는 제가 판단할 수 없어 여쭙습니다.</b>
        같은 질문은 하나로 묶었습니다.
      </p>
      {grouped.length === 0 ? (
        <p className="empty">해당 조건의 항목이 없습니다.</p>
      ) : (
        grouped.map((g) => {
          const row = g.latest;
          const m = row.metrics ?? {};
          const ids = g.items.map((x) => x.id);
          return (
            <div className="ans" key={g.question + row.id}>
              <div className="q">“{g.question}”</div>
              <div className="m">
                <div>
                  문서 <b>{m.total_docs ?? "—"}</b>
                  {m.notion_n != null ? ` (노션 ${m.notion_n}` : ""}
                  {m.wiki_n != null ? ` · 위키 ${m.wiki_n})` : m.notion_n != null ? ")" : ""}
                </div>
                <div>
                  자신감 <b>{m.confidence_score ?? "—"}</b>
                </div>
                {m.intent_score != null ? (
                  <div>
                    의도 <b>{m.intent_score}</b>
                  </div>
                ) : null}
                <div>
                  <b>{formatMs(m.duration_ms)}</b>
                  {m.search_ms != null ? ` (검색 ${formatMs(m.search_ms)})` : ""}
                </div>
                {g.count > 1 ? (
                  <div className="rep">
                    같은 질문 <b>{g.count}번</b>
                  </div>
                ) : null}
              </div>
              <div className="flags">
                {row.flags.map((f) => (
                  <span key={f.id}>{f.label}</span>
                ))}
              </div>
              {status === "pending" ? (
                <div className="acts">
                  {row.message_id ? (
                    <a
                      className="btn sm"
                      href={`/luna?message=${row.message_id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      답 보기
                    </a>
                  ) : null}
                  <button
                    type="button"
                    className="btn sm g"
                    disabled={busy !== null}
                    onClick={() => void reviewGroup(ids, "good")}
                  >
                    맞아요
                  </button>
                  <select
                    value={badReason[ids[0] ?? ""] ?? "wrong_answer"}
                    onChange={(e) =>
                      setBadReason((prev) => ({
                        ...prev,
                        [ids[0] ?? ""]: e.target.value
                      }))
                    }
                  >
                    {THUMBS_REASON_IDS.map((id) => (
                      <option key={id} value={id}>
                        {THUMBS_REASON_LABELS[id]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn sm"
                    disabled={busy !== null}
                    onClick={() => void reviewGroup(ids, "bad")}
                  >
                    틀려요
                  </button>
                  <span className="sp" />
                  <button
                    type="button"
                    className="btn sm"
                    disabled={busy !== null}
                    onClick={() => void reviewGroup(ids, "unclear")}
                  >
                    무시
                  </button>
                </div>
              ) : (
                <div className="mut" style={{ fontSize: 11, color: "var(--faint)" }}>
                  {row.status}
                  {row.human_verdict ? ` · ${row.human_verdict}` : ""}
                </div>
              )}
            </div>
          );
        })
      )}

      <div className="sech">
        <span className="t">정답이 없어 못 한 것</span>
        <span className="n">{skips.length}</span>
      </div>
      {skips.length === 0 ? (
        <p className="empty">정답 없어 건너뛴 일이 없습니다.</p>
      ) : (
        skips.map((item) => (
          <div className="skip" key={item.id}>
            <span className="ic">—</span>
            <div className="c">
              <div className="t">{item.title}</div>
              <div className="d">{item.skip_reason ?? item.why}</div>
            </div>
            <button
              type="button"
              className="btn sm"
              onClick={() => onGo?.(skipHref(item))}
            >
              보기 →
            </button>
          </div>
        ))
      )}
    </>
  );
}
