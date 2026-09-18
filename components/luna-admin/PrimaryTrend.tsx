"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "@/components/luna-admin/fetch";
import type { PrimaryTrendPayload } from "@/lib/luna-admin/types";

const RANGES: Array<PrimaryTrendPayload["range"]> = ["7", "30", "90", "all"];
const RANGE_LABEL: Record<PrimaryTrendPayload["range"], string> = {
  "7": "7일",
  "30": "30일",
  "90": "90일",
  all: "전체"
};

export function PrimaryTrend() {
  const [range, setRange] = useState<PrimaryTrendPayload["range"]>("30");
  const [data, setData] = useState<PrimaryTrendPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  const load = useCallback(async (next: PrimaryTrendPayload["range"]) => {
    setBusy(true);
    setError("");
    try {
      setData(await adminFetch<PrimaryTrendPayload>(`/api/luna-admin/primary/trend?range=${next}`));
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : "불러오지 못했습니다");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(range);
  }, [load, range]);

  const max = Math.max(1, ...(data?.bars.map((b) => b.work + b.notion + b.image) ?? [1]));
  const ticks = data?.bars ?? [];
  const tickEvery = Math.max(1, Math.floor(ticks.length / 4));

  return (
    <div className="chartbox">
      <div className="ch">
        <span className="t">기간별 쌓임</span>
        <span className="sp" />
        <div className="chips">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              className={range === r ? "on" : ""}
              onClick={() => setRange(r)}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>
      {busy ? <p className="empty">불러오는 중…</p> : null}
      {!busy && error ? <p className="empty">{error}</p> : null}
      {!busy && !error && data && data.bars.length === 0 ? (
        <p className="empty">지난 기록이 없어 오늘부터 쌓입니다.</p>
      ) : null}
      {!busy && data && data.bars.length > 0 ? (
        <>
          <div className="bars">
            {data.bars.map((b) => (
              <div className="col" key={b.date} title={`${b.label} Work ${b.work} 노션 ${b.notion} 이미지 ${b.image}`}>
                {b.image > 0 ? (
                  <i style={{ background: "var(--img)", height: `${Math.max(2, (b.image / max) * 92)}px` }} />
                ) : null}
                {b.notion > 0 ? (
                  <i style={{ background: "var(--notion)", height: `${Math.max(2, (b.notion / max) * 92)}px` }} />
                ) : null}
                {b.work > 0 ? (
                  <i style={{ background: "var(--work)", height: `${Math.max(2, (b.work / max) * 92)}px` }} />
                ) : null}
              </div>
            ))}
          </div>
          <div className="xax">
            {data.bars.map((b, i) => (
              <span key={b.date}>{i % tickEvery === 0 || i === data.bars.length - 1 ? b.label : ""}</span>
            ))}
          </div>
          <div className="lg">
            <span>
              <i style={{ background: "var(--work)" }} />
              Work
            </span>
            <span>
              <i style={{ background: "var(--notion)" }} />
              노션
            </span>
            <span>
              <i style={{ background: "var(--img)" }} />
              이미지
            </span>
          </div>
          <p className="cap">{data.caption}</p>
        </>
      ) : null}
    </div>
  );
}
