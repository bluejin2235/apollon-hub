import type { DeltaTone } from "@/components/website/stats/stats-data";

/** 카드의 증감. 기호는 방향, 색은 좋고 나쁨. 앞 기간 값이 없으면 「비교 불가」만. */
export function DeltaMark({
  delta,
  tone,
  previous
}: {
  delta: string | null;
  tone: DeltaTone;
  previous: string | null;
}) {
  return (
    <div className="ws-delta">
      {delta == null ? (
        <span className="ws-stamp">비교 불가</span>
      ) : (
        <div className={tone === "flat" ? undefined : `ws-${tone}`}>{delta}</div>
      )}
      {previous != null ? <div className="ws-delta-prev">앞 기간 {previous}</div> : null}
    </div>
  );
}
