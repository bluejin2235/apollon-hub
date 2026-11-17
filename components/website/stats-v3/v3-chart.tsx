/**
 * 통계 v3 추이 그래프 — 목업 chart() 의 SVG 를 그대로 옮겼다.
 * 실선 이번 기간 · 점선 앞 기간 · 흰 원 점 · 조치 기록 세로선(같은 날은 한 선, 글씨 위·아래 두 단).
 */

import type { ChartMark } from "@/components/website/stats-v3/v3-data";

export type LineChartProps = {
  /** 점마다 가로축 글자. 7개 안쪽으로 골라 쓴다 */
  labels: string[];
  current: (number | null)[];
  previous: (number | null)[];
  mini?: boolean;
  /** 면 채움 없이 선만 */
  two?: boolean;
  marks?: ChartMark[];
  format?: (value: number) => string;
  ariaLabel: string;
};

/** 11px 글자 폭 어림 — 한글은 글자 높이만큼, 그 밖은 절반 남짓 */
function labelWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += /[ㄱ-힣]/.test(ch) ? 11 : 6.2;
  return width;
}

/** 세로선 글씨가 그래프 밖으로 나가지 않게 넘치면 줄이고 「…」. 전체 글은 마우스를 올리면 보인다 */
export function fitLabel(text: string, room: number): string {
  if (labelWidth(text) <= room) return text;
  const chars = [...text];
  while (chars.length > 1 && labelWidth(`${chars.join("")}…`) > room) chars.pop();
  return `${chars.join("")}…`;
}

/**
 * 세로선 글씨가 쓸 수 있는 폭. 가운데 왼쪽 선은 오른쪽으로, 오른쪽 선은 왼쪽으로 쓴다.
 * 옆 선이 같은 쪽으로 쓰면 그 선까지, 마주 보고 쓰면 사이의 절반까지만.
 */
export function markRoom(xs: number[], k: number, width: number, middle: number): number {
  const x = xs[k];
  const toRight = x < middle;
  const pad = 7;
  if (toRight) {
    const next = xs[k + 1];
    if (next == null) return width - x - pad;
    const gap = next - x;
    return (next < middle ? gap : gap / 2) - pad * 2;
  }
  const prev = xs[k - 1];
  if (prev == null) return x - pad;
  const gap = x - prev;
  return (prev >= middle ? gap : gap / 2) - pad * 2;
}

/** 1 · 2 · 5 × 10ⁿ 으로 올린다 */
function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((n) => n * exp >= value) ?? 10;
  return step * exp;
}

/** 가로축 글자를 붙일 점 — 많아도 일곱 자리 */
function tickIndexes(count: number): number[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i);
  const set = new Set<number>();
  for (let k = 0; k <= 6; k++) set.add(Math.round(((count - 1) * k) / 6));
  return [...set];
}

export function LineChart({ labels, current, previous, mini, two, marks = [], format, ariaLabel }: LineChartProps) {
  const w = mini ? 460 : 1000;
  const h = mini ? 145 : 225;
  const left = mini ? 28 : 40;
  const right = w - 23;
  const base = h - 30;
  const top = mini ? 44 : 55;
  const count = labels.length;
  const values = [...current, ...previous].filter((v): v is number => typeof v === "number");
  const max = niceMax(Math.max(0, ...values) * 1.2);
  const xOf = (i: number) => (count <= 1 ? (left + right) / 2 : left + ((right - left) * i) / (count - 1));
  const yOf = (v: number) => base - ((base - top) * v) / max;
  const fmt = format ?? ((v: number) => String(Math.round(v)));

  const line = (list: (number | null)[]) =>
    list
      .map((v, i) => (typeof v === "number" ? `${xOf(i)},${yOf(v)}` : null))
      .filter(Boolean)
      .join(" ");
  const currentPoints = current
    .map((v, i) => (typeof v === "number" ? ([xOf(i), yOf(v)] as const) : null))
    .filter((p): p is readonly [number, number] => p !== null);
  const area =
    !two && currentPoints.length > 1
      ? `M${currentPoints[0][0]} ${base} L${currentPoints.map((p) => `${p[0]} ${p[1]}`).join(" L")} L${currentPoints[currentPoints.length - 1][0]} ${base}Z`
      : null;
  const ticks = tickIndexes(count);

  return (
    <div className="v3-time-chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={ariaLabel}>
        {[0, 0.5, 1].map((f) => {
          const y = base - (base - top) * f;
          return (
            <g key={f}>
              <line x1={left} y1={y} x2={right} y2={y} stroke="#edf0f3" />
              <text x={left - 8} y={y + 4} textAnchor="end">
                {fmt(max * f)}
              </text>
            </g>
          );
        })}
        {area ? <path d={area} fill="#edf3f5" /> : null}
        {!mini
          ? marks.map((mark, k) => {
              const x = xOf(mark.index);
              // 왼쪽 절반은 선 오른쪽에, 오른쪽 절반은 선 왼쪽에 붙여 두 줄 모두 그래프 안에 둔다
              const toRight = x < (left + right) / 2;
              const room = markRoom(marks.map((m) => xOf(m.index)), k, w, (left + right) / 2);
              const [first, ...rest] = mark.labels;
              const second = rest.length === 0 ? null : rest.length === 1 ? rest[0] : `${rest[0]} 외 ${rest.length - 1}건`;
              const tx = toRight ? x + 7 : x - 7;
              const anchor = toRight ? "start" : "end";
              return (
                <g key={mark.index}>
                  <title>{mark.labels.join("\n")}</title>
                  <line x1={x} y1={top - 10} x2={x} y2={base} stroke="#a2abb4" strokeDasharray="4 4" />
                  <text x={tx} y={16} textAnchor={anchor}>
                    {fitLabel(first, room)}
                  </text>
                  {second ? (
                    <text x={tx} y={33} textAnchor={anchor}>
                      {fitLabel(second, room)}
                    </text>
                  ) : null}
                </g>
              );
            })
          : null}
        <polyline
          points={line(previous)}
          fill="none"
          stroke="#a2aab5"
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />
        <polyline
          points={line(current)}
          fill="none"
          stroke="#477b9f"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {currentPoints.map((p) => (
          <circle key={`${p[0]}-${p[1]}`} cx={p[0]} cy={p[1]} r="3" fill="#fff" stroke="#477b9f" strokeWidth="1.7" />
        ))}
        {ticks.map((i, k) => (
          <text
            key={i}
            x={xOf(i)}
            y={h - 9}
            textAnchor={count <= 1 ? "middle" : k === 0 ? "start" : k === ticks.length - 1 ? "end" : "middle"}
          >
            {labels[i]}
          </text>
        ))}
      </svg>
      <div className="v3-legend v3-period-legend">
        <span>
          <i className="v3-line-key" />
          이번 기간
        </span>
        <span>
          <i className="v3-line-key previous" />
          앞 기간
        </span>
      </div>
    </div>
  );
}

/** 2026-11-05 → 11월 5일 */
export function axisLabel(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}월 ${d}일`;
}
