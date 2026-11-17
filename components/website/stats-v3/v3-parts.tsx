/**
 * 통계 v3 — 목업(hub-stats-v3/index.html)의 작은 부품들.
 * 막대 폭은 인라인 style 을 쓰지 않고 SVG 의 width 속성으로 그린다.
 */

import type { ReactNode } from "react";

import type { DeltaView } from "@/components/website/stats/stats-data";

export const PREP = "준비 중";

export function Badge({ children, prep }: { children: ReactNode; prep?: boolean }) {
  return <span className={prep ? "v3-badge v3-prep" : "v3-badge"}>{children}</span>;
}

export function PrepBadge() {
  return <Badge prep>{PREP}</Badge>;
}

export function LangBadge({ lang }: { lang: "ko" | "en" }) {
  return <Badge>{lang === "en" ? "영문" : "국문"}</Badge>;
}

/** ▲ 11% · ▼ 3%p · +2. 비교할 수 없으면 「비교 불가」 */
export function Change({ delta }: { delta: DeltaView }) {
  if (delta.delta == null) return <Badge>비교 불가</Badge>;
  const tone = delta.tone === "flat" ? "flat" : delta.tone;
  return <span className={`v3-change ${tone}`}>{delta.delta}</span>;
}

/** 카드 아래 — 증감 + 「앞 기간 76명」 */
export function DeltaBlock({ delta, as = "div" }: { delta: DeltaView; as?: "div" | "p" }) {
  const Tag = as;
  return (
    <Tag className="v3-delta">
      <Change delta={delta} />
      <small>{delta.previous != null ? `앞 기간 ${delta.previous}` : "앞 기간 기록 없음"}</small>
    </Tag>
  );
}

export function Intro({ menu, question, answer }: { menu: string; question: string; answer: ReactNode }) {
  return (
    <>
      <div className="v3-eyebrow">홈페이지 통계 / {menu}</div>
      <h1>{question}</h1>
      <p className="v3-answer">{answer}</p>
      <p className="v3-intro-note">고른 기간과 앞 기간을 같은 기준으로 비교해요.</p>
    </>
  );
}

export type MetricProps = {
  label: ReactNode;
  value: string | null;
  unit: string;
  delta?: DeltaView | null;
  /** 데이터가 없는 칸 — 「준비 중」 배지 + 「—」 */
  prep?: boolean;
};

export function Metric({ label, value, unit, delta, prep }: MetricProps) {
  return (
    <div className="v3-metric">
      <div className="v3-metric-label">
        {label} {prep ? <PrepBadge /> : null}
      </div>
      <div className="v3-metric-value">
        {prep || value == null ? "—" : value}
        {!prep && value != null ? <span className="v3-unit">{unit}</span> : null}
      </div>
      {!prep && delta ? <DeltaBlock delta={delta} /> : null}
    </div>
  );
}

export type ListItem = { key: string; name: ReactNode; value: ReactNode; change?: DeltaView | null; tag?: ReactNode };

export function List({ items, empty }: { items: ListItem[]; empty?: string }) {
  if (items.length === 0) return <p className="v3-tiny">{empty ?? "이 기간에는 값이 없습니다."}</p>;
  return (
    <ul className="v3-list">
      {items.map((item) => (
        <li key={item.key}>
          <span>{item.name}</span>
          <span className="v3-val">
            {item.value} {item.tag ?? (item.change ? <Change delta={item.change} /> : null)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 0~100 으로 자른 폭 */
function share(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.min(100, (value / max) * 100);
}

/** 가는 막대 — 콘텐츠 표 조회 칸 */
export function Track({ value, max }: { value: number; max: number }) {
  return (
    <svg className="v3-track" viewBox="0 0 100 5" preserveAspectRatio="none" aria-hidden="true">
      <rect width="100" height="5" className="v3-track-bg" />
      <rect width={share(value, max)} height="5" className="v3-track-fill" />
    </svg>
  );
}

export type HBarRow = { name: string; value: number | null; change?: DeltaView | null };

/** 이름 · 막대 · 숫자 · 증감 한 줄 */
export function HBars({ rows, max }: { rows: HBarRow[]; max: number }) {
  return (
    <>
      {rows.map((row) => (
        <div className="v3-hbar" key={row.name}>
          <span>{row.name}</span>
          <svg className="v3-rail" viewBox="0 0 100 7" preserveAspectRatio="none" aria-hidden="true">
            <rect width="100" height="7" className="v3-rail-bg" />
            <rect width={share(row.value ?? 0, max)} height="7" className="v3-rail-fill" />
          </svg>
          <b>{row.value == null ? "—" : row.value.toLocaleString("ko-KR")}</b>
          {row.change ? <Change delta={row.change} /> : <span />}
        </div>
      ))}
    </>
  );
}

export const SOURCE_PARTS = ["검색", "AI", "직접 방문", "기타"] as const;

/** 누적 막대 4색 — 검색 · AI · 직접 방문 · 기타 (0~100) */
export function Stack({ parts }: { parts: [number, number, number, number] }) {
  const label = SOURCE_PARTS.map((name, i) => `${name} ${parts[i]}%`).join(", ");
  let x = 0;
  return (
    <svg className="v3-stack" viewBox="0 0 100 7" preserveAspectRatio="none" role="img" aria-label={label}>
      <title>{label}</title>
      <rect width="100" height="7" className="v3-stack-bg" />
      {parts.map((part, i) => {
        const rect = <rect key={SOURCE_PARTS[i]} x={x} width={part} height="7" className={`v3-stack-${i}`} />;
        x += part;
        return rect;
      })}
    </svg>
  );
}

export function SourceLegend() {
  return (
    <div className="v3-legend">
      <span>
        <i className="v3-swatch" />
        검색
      </span>
      <span>
        <i className="v3-swatch ai" />
        AI
      </span>
      <span>
        <i className="v3-swatch direct" />
        직접 방문
      </span>
      <span>
        <i className="v3-swatch other" />
        기타
      </span>
    </div>
  );
}

/** 불러오는 중 · 못 불러옴 · 값 없음 한 줄 */
export function StatusLine({ status, empty }: { status: "loading" | "ready" | "error"; empty?: string }) {
  if (status === "loading") return <p className="v3-tiny">불러오는 중입니다</p>;
  if (status === "error") return <p className="v3-tiny">불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</p>;
  return <p className="v3-tiny">{empty ?? "이 기간에는 값이 없습니다."}</p>;
}
