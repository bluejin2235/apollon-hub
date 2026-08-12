"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Box,
  ErrorLine,
  KnowledgeShell,
  LoadingLine
} from "@/components/luna/knowledge/ui";
import { K } from "@/lib/luna/knowledge-format";
import { supabase } from "@/lib/supabase/client";

type PeriodKey = "4w" | "7d" | "all";

type MetricCard = {
  key: string;
  title: string;
  value: string;
  delta: { text: string; tone: "up" | "down" | "flat" } | null;
  desc: string;
  barClass: string;
  bars: number[];
};

type MetricsPayload = {
  metrics: MetricCard[];
  weekly_summary: Array<{
    label: string;
    conversations: number;
    clarify: number;
    search_zero: number;
    requery: number;
    assume: number;
  }>;
};

const BAR_CLASS: Record<string, string[]> = {
  g: ["bg-[#9FE1CB]", "bg-[#5DCAA5]", "bg-[#0F6E56]"],
  c: ["bg-[#F5C4B3]", "bg-[#F0997B]", "bg-[#D85A30]"],
  p: ["bg-[#CECBF6]", "bg-[#AFA9EC]", "bg-[#7F77DD]"],
  a: ["bg-[#FAC775]", "bg-[#EF9F27]", "bg-[#BA7517]"]
};

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

function deltaColor(tone: "up" | "down" | "flat"): string {
  if (tone === "flat") return K.faint;
  return K.talk;
}

export function LunaTalkMetrics() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<PeriodKey>("4w");
  const [data, setData] = useState<MetricsPayload | null>(null);

  const load = useCallback(async () => {
    const token = await getAccessToken();
    if (!token) {
      setLoading(false);
      setError("로그인이 필요합니다");
      return;
    }
    setLoading(true);
    setError("");
    const res = await fetch(`/api/luna/talk/metrics?period=${period}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setError(`불러오기 실패: ${await res.text()}`);
      setLoading(false);
      return;
    }
    setData((await res.json()) as MetricsPayload);
    setLoading(false);
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <KnowledgeShell>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <PeriodChip on={period === "4w"} onClick={() => setPeriod("4w")}>
          최근 4주
        </PeriodChip>
        <PeriodChip on={period === "7d"} onClick={() => setPeriod("7d")}>
          최근 7일
        </PeriodChip>
        <PeriodChip on={period === "all"} onClick={() => setPeriod("all")}>
          전체
        </PeriodChip>
      </div>

      {loading ? <LoadingLine /> : null}
      {error ? <ErrorLine message={error} /> : null}

      {!loading && data ? (
        <>
          <div className="mb-3.5 grid grid-cols-1 gap-3 min-[901px]:grid-cols-2">
            {data.metrics.length === 0 ? (
              <p className="text-[13px]" style={{ color: K.faint }}>
                집계할 관측 데이터가 없습니다.
              </p>
            ) : (
              data.metrics.map((m) => {
                const palette = BAR_CLASS[m.barClass] ?? BAR_CLASS.g!;
                return (
                  <div
                    key={m.key}
                    className="rounded-[12px] border px-4 py-3.5"
                    style={{ background: K.panel, borderColor: K.line }}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="flex-1 text-[13px] font-bold">{m.title}</span>
                      <span className="text-[20px] font-bold tracking-[-0.4px]">
                        {m.value}
                      </span>
                      {m.delta ? (
                        <span
                          className="text-[11.5px] font-bold"
                          style={{ color: deltaColor(m.delta.tone) }}
                        >
                          {m.delta.text}
                        </span>
                      ) : null}
                    </div>
                    <p className="my-0.5 mb-2.5 text-[11.5px]" style={{ color: K.sub }}>
                      {m.desc}
                    </p>
                    <div className="flex h-11 items-end gap-1.5">
                      {m.bars.map((h, i) => (
                        <span
                          key={i}
                          className={`block flex-1 rounded-[2px] ${palette[Math.min(i, palette.length - 1)]}`}
                          style={{ height: `${h}%` }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <Box title="주 단위 요약">
            {data.weekly_summary.length === 0 ? (
              <p className="text-[12px]" style={{ color: K.faint }}>
                —
              </p>
            ) : (
              <div className="text-[12.5px] leading-[2.05]" style={{ color: K.sub }}>
                <div
                  className="flex gap-2.5 border-b pb-1 text-[11.5px]"
                  style={{ borderColor: K.line2, color: K.faint }}
                >
                  <span className="w-[70px] shrink-0">주</span>
                  <span className="flex-1">대화</span>
                  <span className="flex-1">되물음</span>
                  <span className="flex-1">검색 0건</span>
                  <span className="flex-1">재검색</span>
                  <span className="flex-1">가정 확인</span>
                </div>
                {data.weekly_summary.map((row, i) => (
                  <div key={row.label} className="flex gap-2.5">
                    <span className="w-[70px] shrink-0">{row.label}</span>
                    <span className="flex-1">
                      <b style={{ color: i === 0 ? K.ink : K.sub }}>{row.conversations}</b>
                    </span>
                    <span className="flex-1">
                      <b style={{ color: i === 0 ? K.ink : K.sub }}>{row.clarify}</b>
                    </span>
                    <span className="flex-1">
                      <b style={{ color: i === 0 ? K.ink : K.sub }}>{row.search_zero}</b>
                    </span>
                    <span className="flex-1">
                      <b style={{ color: i === 0 ? K.ink : K.sub }}>{row.requery}</b>
                    </span>
                    <span className="flex-1">
                      <b style={{ color: i === 0 ? K.ink : K.sub }}>{row.assume}</b>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Box>
        </>
      ) : null}
    </KnowledgeShell>
  );
}
