"use client";

import { formatKstShort } from "@/lib/luna-admin/period";
import type { PrimaryStatsMeta } from "@/lib/luna-admin/types";

export function StatsBanner({
  stats,
  queryMs
}: {
  stats?: PrimaryStatsMeta | null;
  queryMs?: number;
}) {
  if (!stats) return null;
  const when = formatKstShort(stats.computed_at);
  return (
    <div className={`speed${stats.from_snapshot ? "" : " live"}`}>
      <div className="c">
        {stats.from_snapshot ? (
          <>
            <b>어젯밤 03:30 에 계산해 둔 값입니다.</b> 무거운 집계는 매일 밤 미리 재고
            화면은 읽기만 합니다. 목록·미리보기는 누를 때 실시간으로 가져옵니다.
          </>
        ) : (
          <>
            <b>방금 계산해 표를 채웠습니다.</b> 내일부터는 어젯밤 03:30 값을 읽습니다.
            목록·미리보기는 누를 때 실시간으로 가져옵니다.
          </>
        )}
        <span className="when">계산 {when}</span>
      </div>
      {queryMs != null ? <span className="t">{queryMs}ms</span> : null}
    </div>
  );
}
