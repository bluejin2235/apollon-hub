"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Btn,
  ErrorLine,
  FieldInput,
  FieldSelect,
  KnowledgeShell,
  ListCard,
  LoadingLine
} from "@/components/luna/knowledge/ui";
import {
  Avatar,
  BrainCard,
  brainFetch,
  CardTop,
  formatDateTime,
  formatMonthDay,
  RunBar,
  SectionTitle
} from "@/components/luna/brain/shared";
import { SafeMarkdown } from "@/components/luna/SafeMarkdown";
import { K } from "@/lib/luna/knowledge-format";

type ReportItem = {
  id: string;
  title: string;
  body: string;
  published_at: string;
  week_label: string;
  confirmed_count: number | null;
  inflow: number | null;
  inflow_confirmed: number | null;
  inflow_pending: number | null;
  inflow_archived: number | null;
  inflow_prev: number | null;
  correction_count: number | null;
  eval_score_line: string | null;
};

type GoalView = {
  id: string;
  week_start: string;
  goal: string;
  reason: string | null;
  owner: "luna" | "human";
  metric_key: string | null;
  metric_baseline: number | null;
  metric_target: number | null;
  action_type: string | null;
  action_ref: string | null;
  status: "open" | "achieved" | "missed" | "partial" | "dropped";
  result_value: number | null;
  result_note: string | null;
  verified_at: string | null;
  source: "luna" | "human";
  created_at: string;
  current_value?: number | null;
};

type ReportsResponse = {
  latest: ReportItem | null;
  past: ReportItem[];
  current_goals?: GoalView[];
  past_goals?: GoalView[];
  week_start?: string;
};

const METRIC_OPTIONS = [
  { key: "search_zero_count", label: "검색 0건" },
  { key: "correction_count", label: "정정받음" },
  { key: "thumbs_down_count", label: "싫어요" },
  { key: "candidate_confirm_rate", label: "후보 확정률" },
  { key: "eval_light_score", label: "light 시험" },
  { key: "clarify_unresolved", label: "되묻기 미해소" },
  { key: "selfstudy_confirmed", label: "자습 확정" }
] as const;

function Stat({
  label,
  value,
  delta,
  suffix,
  display
}: {
  label: string;
  value?: number | null;
  delta?: number | null;
  suffix?: string;
  display?: string | null;
}) {
  const showNumber = display == null;
  return (
    <div className="rounded-[9px] px-3 py-2.5" style={{ background: K.chip }}>
      <div className="text-[11.5px]" style={{ color: K.sub }}>
        {label}
      </div>
      <div
        className={`mt-0.5 font-bold ${display ? "text-[13.5px] leading-[1.45]" : "text-[19px]"}`}
      >
        {showNumber ? (value == null ? "—" : value) : display}
        {showNumber && value != null && suffix ? (
          <span className="text-[12px]" style={{ color: K.faint }}>
            {suffix}
          </span>
        ) : null}
        {showNumber && delta != null && delta !== 0 ? (
          <small
            className="ml-1 text-[12px] font-bold"
            style={{ color: delta > 0 ? K.talk : K.candInk }}
          >
            {delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`}
          </small>
        ) : null}
      </div>
    </div>
  );
}

function inflowCaption(item: ReportItem): string | null {
  if (item.inflow == null) return null;
  const m = item.inflow_confirmed ?? 0;
  const k = item.inflow_pending ?? 0;
  const p = item.inflow_archived ?? 0;
  return `이번 주 신규 후보 ${item.inflow}건 (확정 ${m} · 대기 ${k} · 폐기 ${p})`;
}

function pastMetaLine(item: ReportItem): string {
  const parts: string[] = [];
  if (item.confirmed_count != null) parts.push(`확정 ${item.confirmed_count}`);
  if (item.inflow != null) parts.push(`유입 ${item.inflow}`);
  if (item.eval_score_line) parts.push(item.eval_score_line);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function statusLabel(status: GoalView["status"], owner: GoalView["owner"]): string {
  if (status === "open") return owner === "human" ? "대기 중" : "진행 중";
  if (status === "achieved") return "달성";
  if (status === "missed") return "미달";
  if (status === "partial") return "부분달성";
  return "바꿈";
}

function formatMetric(value: number | null | undefined, key: string | null): string {
  if (value == null) return "—";
  if (key === "candidate_confirm_rate") return `${value}%`;
  return `${value}건`;
}

export function LunaBrainReport() {
  const [data, setData] = useState<ReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [formGoal, setFormGoal] = useState("");
  const [formReason, setFormReason] = useState("");
  const [formOwner, setFormOwner] = useState<"luna" | "human">("luna");
  const [formMetric, setFormMetric] = useState("search_zero_count");
  const [formTarget, setFormTarget] = useState("");
  const [formAction, setFormAction] = useState("selfstudy");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await brainFetch<ReportsResponse>("/api/luna/brain/reports"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate() {
    setBusy(true);
    setNotice("");
    try {
      const res = await brainFetch<{ skipped: boolean; message: string }>(
        "/api/luna/self-report",
        { method: "POST" }
      );
      setNotice(res.message || "보고를 생성했습니다.");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "생성하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmGoals() {
    setBusy(true);
    setNotice("");
    try {
      const res = await brainFetch<{ message?: string }>("/api/luna/brain/goals", {
        method: "POST",
        body: JSON.stringify({ action: "confirm" })
      });
      setNotice(res.message || "목표를 확정했습니다.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "확정하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function replaceGoals() {
    const goal = formGoal.trim();
    if (!goal) {
      setNotice("바꿀 목표를 입력해 주세요.");
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      const target = formTarget.trim() === "" ? null : Number(formTarget);
      const res = await brainFetch<{ message?: string }>("/api/luna/brain/goals", {
        method: "POST",
        body: JSON.stringify({
          action: "replace",
          goal,
          reason: formReason.trim(),
          owner: formOwner,
          metric_key: formMetric || null,
          metric_target: target != null && Number.isFinite(target) ? target : null,
          action_type: formAction
        })
      });
      setNotice(res.message || "목표를 바꿨습니다.");
      setReplaceOpen(false);
      setFormGoal("");
      setFormReason("");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "바꾸지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const latest = data?.latest ?? null;
  const past = data?.past ?? [];
  const currentGoals = data?.current_goals ?? [];
  const pastGoals = data?.past_goals ?? [];
  const inflowLine = latest ? inflowCaption(latest) : null;

  return (
    <KnowledgeShell>
      {notice ? (
        <p className="mb-2.5 text-[12px]" style={{ color: K.luna }}>
          {notice}
        </p>
      ) : null}
      {error ? <ErrorLine message={error} /> : null}
      {loading ? <LoadingLine /> : null}

      {!loading && !error ? (
        <>
          <SectionTitle>이번 주 목표</SectionTitle>
          {currentGoals.length === 0 ? (
            <BrainCard>
              <p className="text-[13px]" style={{ color: K.sub }}>
                아직 이번 주 목표가 없습니다. 아래 [지금 생성]으로 루프를 시작하세요.
              </p>
            </BrainCard>
          ) : (
            <BrainCard>
              {currentGoals.map((g) => (
                <div
                  key={g.id}
                  className="mb-2.5 border-b pb-2.5 last:mb-0 last:border-b-0 last:pb-0"
                  style={{ borderColor: K.line2 }}
                >
                  <div className="flex flex-wrap items-start gap-2">
                    <span className="text-[16px] leading-none">
                      {g.owner === "human" ? "👤" : "🎯"}
                    </span>
                    <div className="min-w-0 flex-1 text-[13.5px] font-bold">
                      {g.goal}
                    </div>
                    <Badge kind={g.status === "open" ? "wait" : "ok"}>
                      {statusLabel(g.status, g.owner)}
                      {g.status === "open" && g.owner === "luna"
                        ? ` · 현재 ${formatMetric(g.current_value ?? null, g.metric_key)}`
                        : ""}
                    </Badge>
                  </div>
                  {g.owner === "human" ? (
                    <p className="mt-1 text-[12px]" style={{ color: K.faint }}>
                      블루진에게 요청
                    </p>
                  ) : null}
                </div>
              ))}
            </BrainCard>
          )}

          {latest ? (
            <BrainCard>
              <CardTop>
                <Avatar />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-bold">
                    {latest.week_label}
                  </div>
                  <div className="text-[11.5px]" style={{ color: K.faint }}>
                    {formatDateTime(latest.published_at)} 발행
                  </div>
                </div>
                <Badge kind="ok">최신</Badge>
              </CardTop>

              <div className="mb-2 grid grid-cols-2 gap-2.5 min-[901px]:grid-cols-4">
                <Stat label="확정 지식" value={latest.confirmed_count} />
                <Stat
                  label="후보 유입"
                  value={latest.inflow}
                  delta={
                    latest.inflow != null && latest.inflow_prev != null
                      ? latest.inflow - latest.inflow_prev
                      : null
                  }
                />
                <Stat label="정정받음" value={latest.correction_count} />
                <Stat
                  label="시험 점수"
                  display={latest.eval_score_line ?? "light — · heavy —"}
                />
              </div>
              {inflowLine ? (
                <p className="mb-3.5 text-[12px]" style={{ color: K.sub }}>
                  {inflowLine}
                </p>
              ) : (
                <div className="mb-3.5" />
              )}

              <div className="text-[13.5px] leading-[1.8]">
                {latest.body.trim() ? (
                  <SafeMarkdown content={latest.body} variant="luna" />
                ) : (
                  <p style={{ color: K.faint }}>본문이 없습니다.</p>
                )}
              </div>

              {currentGoals.length > 0 ? (
                <div className="mt-3.5 flex flex-wrap gap-2">
                  <Btn primary disabled={busy} onClick={() => void confirmGoals()}>
                    맞아요
                  </Btn>
                  <Btn
                    disabled={busy}
                    onClick={() => setReplaceOpen((v) => !v)}
                  >
                    아니에요, 이게 더 중요해요
                  </Btn>
                </div>
              ) : null}

              {replaceOpen ? (
                <div
                  className="mt-3 space-y-2 rounded-[9px] p-3"
                  style={{ background: K.chip }}
                >
                  <FieldInput
                    className="w-full"
                    placeholder="측정 가능한 목표 한 문장"
                    value={formGoal}
                    onChange={(e) => setFormGoal(e.target.value)}
                  />
                  <FieldInput
                    className="w-full"
                    placeholder="왜 이 목표인가 (선택)"
                    value={formReason}
                    onChange={(e) => setFormReason(e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <FieldSelect
                      value={formOwner}
                      onChange={(e) => {
                        const owner =
                          e.target.value === "human" ? "human" : "luna";
                        setFormOwner(owner);
                        setFormAction(owner === "human" ? "dev" : "selfstudy");
                      }}
                    >
                      <option value="luna">루나가 할 일</option>
                      <option value="human">블루진에게 요청</option>
                    </FieldSelect>
                    <FieldSelect
                      value={formMetric}
                      onChange={(e) => setFormMetric(e.target.value)}
                    >
                      {METRIC_OPTIONS.map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.label}
                        </option>
                      ))}
                    </FieldSelect>
                    <FieldInput
                      placeholder="목표 값"
                      value={formTarget}
                      onChange={(e) => setFormTarget(e.target.value)}
                    />
                    <FieldSelect
                      value={formAction}
                      onChange={(e) => setFormAction(e.target.value)}
                    >
                      <option value="selfstudy">자습으로 전환</option>
                      <option value="prompt">자기개선 대기열</option>
                      <option value="dev">개발 과제·알림</option>
                      <option value="none">전환 없음</option>
                    </FieldSelect>
                  </div>
                  <Btn primary disabled={busy} onClick={() => void replaceGoals()}>
                    {busy ? "저장 중…" : "이 목표로 바꾸기"}
                  </Btn>
                </div>
              ) : null}
            </BrainCard>
          ) : (
            <BrainCard>
              <p className="text-[13px]" style={{ color: K.sub }}>
                아직 발행된 성장 루프가 없습니다. 매주 월요일 08:00에 자동
                발행됩니다.
              </p>
            </BrainCard>
          )}

          {pastGoals.length > 0 ? (
            <>
              <SectionTitle className="mt-4">지난 목표</SectionTitle>
              <ListCard>
                {pastGoals.map((g) => (
                  <div
                    key={g.id}
                    className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 last:border-b-0"
                    style={{ borderColor: K.line2 }}
                  >
                    <span className="text-[13px]">
                      {g.owner === "human" ? "👤" : "🎯"} {g.goal}
                    </span>
                    <Badge
                      kind={
                        g.status === "achieved"
                          ? "ok"
                          : g.status === "missed"
                            ? "red"
                            : "src"
                      }
                    >
                      {statusLabel(g.status, g.owner)}
                      {g.result_value != null
                        ? ` · ${formatMetric(g.result_value, g.metric_key)}`
                        : ""}
                    </Badge>
                    <span
                      className="ml-auto text-[11.5px]"
                      style={{ color: K.faint }}
                    >
                      {g.week_start}
                    </span>
                  </div>
                ))}
              </ListCard>
            </>
          ) : null}

          {past.length > 0 ? (
            <>
              <SectionTitle className="mt-4">지난 보고</SectionTitle>
              <ListCard>
                {past.map((item) => (
                  <div key={item.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenId((prev) => (prev === item.id ? null : item.id))
                      }
                      className="flex w-full cursor-pointer items-center gap-2.5 border-b px-4 py-2.5 text-left last:border-b-0"
                      style={{ borderColor: K.line2 }}
                    >
                      <span className="min-w-0 flex-1 truncate text-[13.5px]">
                        {item.week_label}
                      </span>
                      <span
                        className="hidden shrink-0 text-[11.5px] min-[901px]:inline"
                        style={{ color: K.faint }}
                      >
                        {pastMetaLine(item)}
                      </span>
                      <span
                        className="w-[78px] shrink-0 text-right text-[11.5px]"
                        style={{ color: K.faint }}
                      >
                        {formatMonthDay(item.published_at)}
                      </span>
                    </button>
                    {openId === item.id ? (
                      <div
                        className="border-b px-4 py-3 text-[13px] leading-[1.8]"
                        style={{ borderColor: K.line2, background: "#fbfbfd" }}
                      >
                        {item.body.trim() ? (
                          <SafeMarkdown content={item.body} compact />
                        ) : (
                          <p style={{ color: K.faint }}>본문이 없습니다.</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))}
              </ListCard>
            </>
          ) : null}

          <RunBar text="매주 월요일 08:00 발행 · 목표를 세우고 다음 주에 검증">
            <Btn disabled={busy} onClick={() => void generate()}>
              {busy ? "생성 중…" : "지금 생성"}
            </Btn>
          </RunBar>
        </>
      ) : null}
    </KnowledgeShell>
  );
}
