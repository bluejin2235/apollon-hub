"use client";

import type { ReactNode } from "react";
import type { StorageDashboardView } from "@/lib/luna-admin/types";

function formatBytes(bytes: number): string {
  const abs = Math.abs(bytes);
  if (abs >= 1024 * 1024 * 1024) {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
  }
  if (abs >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    if (mb >= 100) return `${Math.round(mb)} MB`;
    return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  }
  if (abs >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatDelta(delta: number | null): ReactNode {
  if (delta == null) return <span className="mut">—</span>;
  if (delta === 0) return <span className="mut">—</span>;
  const mb = delta / (1024 * 1024);
  const label =
    Math.abs(mb) >= 1
      ? `${mb > 0 ? "+" : ""}${mb >= 10 || mb <= -10 ? Math.round(mb) : mb.toFixed(0)}`
      : `${delta > 0 ? "+" : ""}${Math.round(delta / 1024)}K`;
  if (delta > 0) return <span className="up">{label}</span>;
  return <span className="dn">{label}</span>;
}

function platformValue(
  bytes: number | null,
  limit: number | null
): string {
  if (bytes == null) return "—";
  const left = formatBytes(bytes);
  if (limit == null) return left;
  return `${left} / ${formatBytes(limit)}`;
}

type Props = {
  data: StorageDashboardView;
};

export function LunaAdminStorage({ data }: Props) {
  const usedGb = data.used_bytes / (1024 * 1024 * 1024);
  const usedLabel =
    usedGb >= 1 ? usedGb.toFixed(2) : (data.used_bytes / (1024 * 1024)).toFixed(0);
  const usedUnit = usedGb >= 1 ? "GB" : "MB";
  const freeLabel = formatBytes(data.free_bytes);
  const pct = Math.round(data.used_pct);
  const warnDot =
    data.warn_level === "bad" ? "🔴" : data.warn_level === "warn" ? "🟡" : "🟢";

  const freePct = Math.max(0, 100 - data.groups.reduce((s, g) => s + g.pct_of_limit, 0));

  return (
    <div className={`stor ${data.warn_level === "bad" ? "bad" : data.warn_level === "warn" ? "warn" : ""}`}>
      <div className="sh">
        <span className="t">저장 공간</span>
        <span className="n">
          {warnDot} Supabase · {data.region_label} · {data.plan_label}
        </span>
        <span className="sp" />
        {data.supabase_url ? (
          <a className="a" href={data.supabase_url} target="_blank" rel="noreferrer">
            Supabase 열기 →
          </a>
        ) : (
          <span className="n">Supabase</span>
        )}
      </div>

      <div className="gauge">
        <div className="num">
          <div className="v">
            {usedLabel}
            <span>{usedUnit}</span>
          </div>
          <div className="d">
            / {data.limit_gb} GB · {pct}%
          </div>
        </div>
        <div className="barwrap">
          <div className="stack">
            {data.groups.map((g) => (
              <i
                key={g.grp}
                style={{
                  background: g.color,
                  width: `${Math.max(0.15, g.pct_of_limit)}%`
                }}
                title={`${g.grp} ${formatBytes(g.bytes)}`}
              />
            ))}
            <i className="free" style={{ width: `${Math.max(0, freePct)}%` }} />
          </div>
        </div>
        <div className="right">
          <div className="v">{freeLabel}</div>
          <div className="d">남음</div>
        </div>
      </div>

      <div className="legend">
        {data.groups.map((g) => (
          <div className="lg" key={g.grp}>
            <span className="dot" style={{ background: g.color }} />
            <span className="nm">{g.grp}</span>
            <span className="sz">{formatBytes(g.bytes)}</span>
          </div>
        ))}
      </div>

      <div className="g3">
        <div className="box">
          <div className="bt">무엇이 차지하나</div>
          <table>
            <thead>
              <tr>
                <th>테이블</th>
                <th className="num">크기</th>
                <th className="num">어제</th>
              </tr>
            </thead>
            <tbody>
              {data.tables.map((t) => (
                <tr key={t.table_name}>
                  <td>
                    {t.table_name}
                    {t.legacy ? <span className="mut"> 옛 블록</span> : null}
                  </td>
                  <td className="num">{formatBytes(t.bytes)}</td>
                  <td className="num">{formatDelta(t.yesterday_delta_bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="box">
          <div className="bt">앞으로 늘어날 것</div>
          <table>
            <thead>
              <tr>
                <th>무엇</th>
                <th className="num">예상</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.forecast.map((f) => (
                <tr key={f.id}>
                  <td>
                    {f.label}{" "}
                    {f.note ? <span className="mut">{f.note}</span> : null}
                  </td>
                  <td className="num">
                    {f.monthly
                      ? `+${formatBytes(f.estimated_bytes)}/월`
                      : `+${formatBytes(f.estimated_bytes)}`}
                  </td>
                  <td>
                    <span className={`tag ${f.status === "running" ? "g" : "y"}`}>
                      {f.status === "running" ? "진행" : f.status === "done" ? "완료" : "대기"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="fc tot">
            <span className="l">다 하면</span>
            <span className="v">
              {formatBytes(data.forecast_total_bytes)} · {Math.round(data.forecast_pct)}%
            </span>
          </div>
        </div>

        <div className="box">
          <div className="bt">그 밖에 쓰는 것</div>
          <div className="fc">
            <span className="l">
              Storage <span className="mut">썸네일·확대본</span>
            </span>
            <span className="v">
              {data.platform.storage_bytes == null ? (
                data.supabase_url ? (
                  <a href={data.supabase_url} target="_blank" rel="noreferrer">
                    Supabase 에서 확인
                  </a>
                ) : (
                  "—"
                )
              ) : (
                platformValue(
                  data.platform.storage_bytes,
                  data.platform.storage_limit_bytes
                )
              )}
            </span>
          </div>
          <div className="fc">
            <span className="l">
              Egress <span className="mut">이번 달</span>
            </span>
            <span className="v">
              {data.platform.egress_bytes == null ? (
                data.supabase_url ? (
                  <a href={data.supabase_url} target="_blank" rel="noreferrer">
                    Supabase 에서 확인
                  </a>
                ) : (
                  "—"
                )
              ) : (
                platformValue(
                  data.platform.egress_bytes,
                  data.platform.egress_limit_bytes
                )
              )}
            </span>
          </div>
          <div className="fc">
            <span className="l">Edge Function</span>
            <span className="v">
              {data.platform.edge_invocations == null
                ? "—"
                : `${data.platform.edge_invocations.toLocaleString("ko-KR")} / ${(data.platform.edge_limit ?? 0).toLocaleString("ko-KR")}`}
            </span>
          </div>
          <div className="fc">
            <span className="l">디스크 확장</span>
            <span className="v">
              {data.disk_expansions_used == null
                ? "—"
                : `${data.disk_expansions_used}/${data.disk_expansions_max ?? "—"}`}
            </span>
          </div>
          <div className="fc">
            <span className="l">초과 요금</span>
            <span className="v">GB당 월 ${data.overage_usd_per_gb}</span>
          </div>
          <div className="fc">
            <span className="l">한도까지</span>
            <span className="v">{data.years_to_limit_label}</span>
          </div>
        </div>
      </div>

      {data.legacy_embeddings ? (
        <div className="warn">
          <div className="c">
            <b>
              {data.legacy_embeddings.table_name}{" "}
              {formatBytes(data.legacy_embeddings.bytes)} · 확인 완료 · 코드 제거 후
              삭제 예정
            </b>{" "}
            8월에 청킹으로 넘어오며 폴백용으로 남겨둔 옛 블록 임베딩입니다. 지우면{" "}
            {formatBytes(data.used_bytes)} →{" "}
            {formatBytes(data.legacy_embeddings.after_delete_bytes)} 로 줄어듭니다.
          </div>
        </div>
      ) : null}
    </div>
  );
}
