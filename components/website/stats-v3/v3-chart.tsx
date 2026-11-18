"use client";

/**
 * 통계 v3 추이 그래프 — 실선 이번 기간 · 점선 앞 기간 · 흰 원 점 · 조치 기록 세로선.
 *
 * 글자 크기: 예전에는 viewBox 하나로 그림 전체를 늘여서, 넓은 칸에서는 날짜 글자도 함께 커졌다.
 * 이제 바깥 svg 는 viewBox 없이 실제 화면 픽셀로 그리고, 가로 위치만 % 로 준다.
 * 선과 면만 안쪽 svg(viewBox 가로 0~100, preserveAspectRatio none)에서 늘이고 선 굵기는 non-scaling-stroke 로 고정한다.
 * 그래서 칸이 넓든 좁든 글자는 늘 같은 크기다.
 *
 * 마우스를 올리거나(휴대폰은 누르거나) 그래프를 고른 뒤 키보드 ← → 로 점을 고르면 그날 값을 상자로 보여 준다.
 */

import { useState, type KeyboardEvent } from "react";

import type { ChartMark } from "@/components/website/stats-v3/v3-data";

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

/** 가로축 글자를 붙일 점 — 많아도 most 자리 */
export function tickIndexes(count: number, most = 7): number[] {
  if (count <= most) return Array.from({ length: count }, (_, i) => i);
  // 같은 간격으로 고르고, 마지막 날은 꼭 넣는다. 마지막 날이 앞 눈금과 너무 붙으면 앞 눈금을 뺀다(글자 겹침 방지)
  const step = Math.ceil((count - 1) / (most - 1));
  const out: number[] = [];
  for (let i = 0; i < count - 1; i += step) out.push(i);
  if (out.length > 1 && count - 1 - out[out.length - 1] < step * 0.6) out.pop();
  out.push(count - 1);
  return out;
}

/** 점 i 의 가로 위치(%) — 양 끝은 2% 띄운다 */
export function xPercent(i: number, count: number): number {
  if (count <= 1) return 50;
  return 2 + (96 * i) / (count - 1);
}

/** 2026-11-05 → 11월 5일 */
export function axisLabel(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}월 ${d}일`;
}

export type ChartSeries = {
  name: string;
  values: (number | null)[];
  /** current = 굵은 실선 + 흰 점 · previous = 회색 점선 · 0~5 = 갈래별 색 실선 */
  look: "current" | "previous" | number;
};

type SeriesChartProps = {
  labels: string[];
  series: ChartSeries[];
  mini?: boolean;
  /** 이번 기간 아래 면 채움 */
  area?: boolean;
  marks?: ChartMark[];
  format: (value: number) => string;
  ariaLabel: string;
  /** 점 i 를 골랐을 때 상자 안 글줄과 줄마다 선 모양(없으면 null) */
  tip: (i: number) => { lines: string[]; keys: (ChartSeries["look"] | null)[] };
  /** 처음부터 골라 둘 점(미리보기용). 보통은 없음 */
  initialActive?: number;
};

/** 세로선 글씨 폭 어림에 쓰는 그림 폭(px) */
const PLOT_GUESS = { mini: 430, full: 900 };

function lookClass(look: ChartSeries["look"]): string {
  return typeof look === "number" ? `v3-ser v3-ser-${look % 6}` : look === "previous" ? "v3-ser-prev" : "v3-ser-cur";
}

function SeriesChart({ labels, series, mini, area, marks = [], format, ariaLabel, tip, initialActive }: SeriesChartProps) {
  const [active, setActive] = useState<number | null>(initialActive ?? null);
  const h = mini ? 150 : 230;
  const base = h - 26;
  const top = mini ? 18 : marks.length > 0 ? 50 : 22;
  const count = labels.length;
  const values = series.flatMap((s) => s.values).filter((v): v is number => typeof v === "number");
  const max = niceMax(Math.max(0, ...values) * 1.15);
  const yOf = (v: number) => base - ((base - top) * v) / max;
  const xs = labels.map((_, i) => xPercent(i, count));
  const ticks = tickIndexes(count, mini ? 5 : 7);
  const plotGuess = mini ? PLOT_GUESS.mini : PLOT_GUESS.full;

  const pointsOf = (list: (number | null)[]) =>
    list
      .map((v, i) => (typeof v === "number" ? `${xs[i]},${yOf(v)}` : null))
      .filter(Boolean)
      .join(" ");
  const cur = series.find((s) => s.look === "current");
  const curPoints = cur
    ? cur.values
        .map((v, i) => (typeof v === "number" ? ([xs[i], yOf(v)] as const) : null))
        .filter((p): p is readonly [number, number] => p !== null)
    : [];
  const areaPath =
    area && curPoints.length > 1
      ? `M${curPoints[0][0]} ${base} L${curPoints.map((p) => `${p[0]} ${p[1]}`).join(" L")} L${curPoints[curPoints.length - 1][0]} ${base}Z`
      : null;

  // 마우스 칸 — 이웃 점 사이 가운데에서 나눈다
  const zones = xs.map((x, i) => {
    const left = i === 0 ? 0 : (xs[i - 1] + x) / 2;
    const right = i === count - 1 ? 100 : (x + xs[i + 1]) / 2;
    return { left, width: right - left };
  });

  function onKey(event: KeyboardEvent<SVGSVGElement>) {
    if (count === 0) return;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      setActive((now) => (now == null ? (step > 0 ? 0 : count - 1) : Math.min(count - 1, Math.max(0, now + step))));
    } else if (event.key === "Escape") setActive(null);
  }

  const tipNow = active != null ? tip(active) : null;
  const tipWidth = tipNow
    ? Math.max(...tipNow.lines.map((line) => labelWidth(line))) + (tipNow.keys.some((key) => key != null) ? 40 : 24)
    : 0;
  const tipHeight = tipNow ? tipNow.lines.length * 17 + 10 : 0;
  const tipLeft = active != null && xs[active] > 55 ? -tipWidth - 10 : 10;

  return (
    <div className="v3-time-chart">
      <div className="v3-chart-box">
        <svg className="v3-chart-y" height={h} aria-hidden="true">
          {[0, 0.5, 1].map((f) => (
            <text key={f} x="100%" dx="-6" y={base - (base - top) * f + 4} textAnchor="end">
              {format(max * f)}
            </text>
          ))}
        </svg>
        <svg
          className="v3-chart-plot"
          height={h}
          role="img"
          aria-label={`${ariaLabel}. 왼쪽 오른쪽 화살표로 날짜를 고르면 값을 읽어 줍니다.`}
          tabIndex={0}
          onKeyDown={onKey}
          onMouseLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
        >
          {[0, 0.5, 1].map((f) => {
            const y = base - (base - top) * f;
            return <line key={f} x1="0" x2="100%" y1={y} y2={y} className="v3-grid-line" />;
          })}
          <svg x="0" y="0" width="100%" height={h} viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" aria-hidden="true">
            {areaPath ? <path d={areaPath} className="v3-ser-area" /> : null}
            {series.map((s) => (
              <polyline key={s.name} points={pointsOf(s.values)} className={lookClass(s.look)} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          {!mini
            ? marks.map((mark, k) => {
                const x = xs[mark.index] ?? 50;
                const toRight = x < 50;
                const room = markRoom(
                  marks.map((m) => ((xs[m.index] ?? 50) / 100) * plotGuess),
                  k,
                  plotGuess,
                  plotGuess / 2
                );
                const [first, ...rest] = mark.labels;
                const second = rest.length === 0 ? null : rest.length === 1 ? rest[0] : `${rest[0]} 외 ${rest.length - 1}건`;
                return (
                  <g key={mark.index}>
                    <title>{mark.labels.join("\n")}</title>
                    <line x1={`${x}%`} x2={`${x}%`} y1={top - 10} y2={base} className="v3-mark-line" />
                    <svg x={`${x}%`} y="0" overflow="visible">
                      <text x={toRight ? 7 : -7} y={14} textAnchor={toRight ? "start" : "end"}>
                        {fitLabel(first, room)}
                      </text>
                      {second ? (
                        <text x={toRight ? 7 : -7} y={30} textAnchor={toRight ? "start" : "end"}>
                          {fitLabel(second, room)}
                        </text>
                      ) : null}
                    </svg>
                  </g>
                );
              })
            : null}
          {series
            .filter((s) => s.look !== "previous")
            .map((s) =>
              s.values.map((v, i) =>
                typeof v === "number" ? (
                  <circle
                    key={`${s.name}-${i}`}
                    cx={`${xs[i]}%`}
                    cy={yOf(v)}
                    r={active === i ? 4.5 : 3}
                    className={`v3-dot-pt ${lookClass(s.look)}`}
                  />
                ) : null
              )
            )}
          {ticks.map((i, k) => (
            <text
              key={i}
              x={`${xs[i]}%`}
              y={h - 7}
              textAnchor={count <= 1 ? "middle" : k === 0 ? "start" : k === ticks.length - 1 ? "end" : "middle"}
              className={active === i ? "v3-tick-on" : undefined}
            >
              {labels[i]}
            </text>
          ))}
          {active != null && tipNow ? (
            <g aria-hidden="true">
              <line x1={`${xs[active]}%`} x2={`${xs[active]}%`} y1={top - 6} y2={base} className="v3-tip-guide" />
              <svg x={`${xs[active]}%`} y="0" overflow="visible">
                <rect x={tipLeft} y={4} width={tipWidth} height={tipHeight} rx="6" className="v3-tip-box" />
                {tipNow.lines.map((line, n) => {
                  const key = tipNow.keys[n];
                  const left = tipLeft + 10;
                  return (
                    <g key={`${n}-${line}`}>
                      {key != null ? (
                        <line x1={left} x2={left + 12} y1={n * 17 + 18} y2={n * 17 + 18} className={lookClass(key)} />
                      ) : null}
                      <text x={left + (key != null ? 17 : 0)} y={n * 17 + 22} className={n === 0 ? "v3-tip-head" : "v3-tip-text"}>
                        {line}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </g>
          ) : null}
          {zones.map((zone, i) => (
            <rect
              key={i}
              x={`${zone.left}%`}
              y="0"
              width={`${zone.width}%`}
              height={h}
              className="v3-hit"
              onMouseEnter={() => setActive(i)}
              onClick={() => setActive(i)}
            />
          ))}
        </svg>
      </div>
      <p className="v3-sr" aria-live="polite">
        {tipNow ? tipNow.lines.join(", ") : ""}
      </p>
    </div>
  );
}

export type LineChartProps = {
  /** 점마다 가로축 글자 */
  labels: string[];
  current: (number | null)[];
  previous: (number | null)[];
  /** 점마다 실제 날짜(ISO). 주면 상자에 「11월 14일 · 이번 기간 12명」으로 쓴다 */
  dates?: string[];
  /** 같은 순번의 앞 기간 날짜 */
  prevDates?: (string | null)[];
  /** 상자 숫자 뒤 단위 — 명 · 회 · 개 */
  unit?: string;
  mini?: boolean;
  /** 면 채움 없이 선만 */
  two?: boolean;
  marks?: ChartMark[];
  format?: (value: number) => string;
  /** 상자 안 숫자 모양. 없으면 정수는 그대로, 아니면 format */
  tipFormat?: (value: number) => string;
  ariaLabel: string;
  initialActive?: number;
};

/** 이번 기간 실선 · 앞 기간 점선 */
export function LineChart(props: LineChartProps) {
  const { labels, current, previous, dates, prevDates, unit = "", mini, two, marks, format, tipFormat, ariaLabel, initialActive } = props;
  const fmt = format ?? ((v: number) => String(Math.round(v)));
  const tipFmt = (v: number) =>
    tipFormat ? tipFormat(v) : `${Number.isInteger(v) ? v.toLocaleString("ko-KR") : fmt(v)}${unit}`;
  const hasPrevious = previous.some((v) => typeof v === "number");
  const series: ChartSeries[] = [
    ...(hasPrevious ? [{ name: "앞 기간", values: previous, look: "previous" as const }] : []),
    { name: "이번 기간", values: current, look: "current" as const }
  ];
  const tip = (i: number) => {
    const day = dates?.[i] ? axisLabel(dates[i]) : labels[i];
    const now = current[i];
    const before = previous[i];
    const prevDay = prevDates?.[i] ? axisLabel(prevDates[i] as string) : null;
    const lines = [`${day} · 이번 기간 ${typeof now === "number" ? tipFmt(now) : "기록 없음"}`];
    lines.push(
      typeof before === "number"
        ? `${prevDay ?? "같은 순번 날"} · 앞 기간 ${tipFmt(before)}`
        : `${prevDay ? `${prevDay} · ` : ""}앞 기간 기록 없음`
    );
    return { lines, keys: ["current", "previous"] as ChartSeries["look"][] };
  };
  return (
    <>
      <SeriesChart
        labels={labels}
        series={series}
        mini={mini}
        area={!two}
        marks={marks}
        format={fmt}
        ariaLabel={ariaLabel}
        tip={tip}
        initialActive={initialActive}
      />
      <div className="v3-legend v3-period-legend">
        <span>
          <i className="v3-line-key" />
          이번 기간
        </span>
        {hasPrevious ? (
          <span>
            <i className="v3-line-key previous" />
            앞 기간
          </span>
        ) : (
          <span className="v3-muted">앞 기간 선 없음</span>
        )}
      </div>
    </>
  );
}

export type MultiLineChartProps = {
  dates: string[];
  /** 가로축 글자. 없으면 날짜 */
  labels?: string[];
  series: { name: string; values: (number | null)[] }[];
  unit?: string;
  mini?: boolean;
  format?: (value: number) => string;
  ariaLabel: string;
};

/** 여러 갈래를 한 그림에 — 회사별 · 회사 이름 vs 일반 명사 */
export function MultiLineChart({ dates, labels, series, unit = "", mini, format, ariaLabel }: MultiLineChartProps) {
  const fmt = format ?? ((v: number) => String(Math.round(v)));
  const looks: ChartSeries[] = series.map((s, i) => ({ name: s.name, values: s.values, look: i }));
  const axis = labels ?? dates.map(axisLabel);
  const tip = (i: number) => ({
    lines: [
      axis[i],
      ...looks.map(
        (s) => `${s.name} ${typeof s.values[i] === "number" ? `${(s.values[i] as number).toLocaleString("ko-KR")}${unit}` : "기록 없음"}`
      )
    ],
    keys: [null, ...looks.map((s) => s.look)]
  });
  return (
    <>
      <SeriesChart labels={axis} series={looks} mini={mini} format={fmt} ariaLabel={ariaLabel} tip={tip} />
      <div className="v3-legend v3-period-legend">
        {looks.map((s) => (
          <span key={s.name}>
            <i className={`v3-line-key v3-key-${(s.look as number) % 6}`} />
            {s.name}
          </span>
        ))}
      </div>
    </>
  );
}
