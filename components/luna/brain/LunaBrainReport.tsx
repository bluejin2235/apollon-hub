"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Btn,
  ErrorLine,
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

type ReportsResponse = {
  latest: ReportItem | null;
  past: ReportItem[];
};

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

export function LunaBrainReport() {
  const [data, setData] = useState<ReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

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

  const latest = data?.latest ?? null;
  const past = data?.past ?? [];
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
            </BrainCard>
          ) : (
            <BrainCard>
              <p className="text-[13px]" style={{ color: K.sub }}>
                아직 발행된 성장 보고가 없습니다. 매주 월요일 08:00에 자동
                발행됩니다.
              </p>
            </BrainCard>
          )}

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

          <RunBar text="매주 월요일 08:00 발행 · 알림으로도 전달">
            <Btn disabled={busy} onClick={() => void generate()}>
              {busy ? "생성 중…" : "지금 생성"}
            </Btn>
          </RunBar>
        </>
      ) : null}
    </KnowledgeShell>
  );
}
