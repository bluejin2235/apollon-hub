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

import { PREV_REASON, type ChartMark } from "@/components/website/stats-v3/v3-data";

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

/**
 * 세로축 범위 — 그린 값 전체(이번·앞 기간)의 최솟값~최댓값에 맞춘다 (11-23 블루진 지시: 위가 비지 않게).
 * 위아래로 범위의 10%를 띄우고, 눈금 셋(아래·가운데·위)이 깔끔한 숫자가 되도록 간격을 1·2·2.5·5 × 10ⁿ 에서 고른다.
 * 값이 모두 0 이상이면 아래 끝은 0 밑으로 내려가지 않고, 값이 모두 정수면 간격도 정수로 잡는다.
 * format 을 주면 눈금 글자 셋이 서로 다를 때까지 단위를 키운다(예: 1.41·1.42 가 모두 「1.4」로 보이지 않게).
 * 어떤 경우든 lo < hi 인 유한한 범위를 돌려준다.
 */
export function yRange(values: number[], format?: (value: number) => string): { lo: number; hi: number } {
  let min = Infinity;
  let max = -Infinity;
  let whole = true;
  let any = false;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    any = true;
    if (v < min) min = v;
    if (v > max) max = v;
    if (!Number.isInteger(v)) whole = false;
  }
  if (!any) return { lo: 0, hi: 1 };

  const pad = max > min ? (max - min) * 0.1 : Math.abs(max) * 0.1 || 1;
  let lo0 = min - pad;
  const hi0 = max + pad;
  if (min >= 0) lo0 = Math.max(0, lo0);
  const spanOk = Number.isFinite(hi0 - lo0) && hi0 - lo0 > 0;

  // 단위 후보: 범위의 1/4 이상인 1·2·2.5·5 × 10ⁿ 를 작은 것부터 (정수 자료면 정수 단위만)
  const units: number[] = [];
  if (spanOk) {
    const quarter = (hi0 - lo0) / 4;
    let exp = 10 ** Math.floor(Math.log10(quarter));
    for (let k = 0; k < 6 && Number.isFinite(exp) && exp > 0; k++, exp *= 10) {
      for (const n of [1, 2, 2.5, 5]) {
        const step = n * exp;
        if (step < quarter * (1 - 1e-9)) continue;
        if (whole && (step < 1 || !Number.isInteger(step))) continue;
        units.push(step);
      }
    }
  }

  const tidy = (v: number) => Number(v.toPrecision(12));
  const valid = (r: { lo: number; hi: number }) =>
    Number.isFinite(r.lo) && Number.isFinite(r.hi) && r.hi > r.lo && Number.isFinite(r.hi - r.lo);
  const distinct = (r: { lo: number; hi: number }) =>
    !format || new Set([r.lo, (r.lo + r.hi) / 2, r.hi].map((v) => format(v))).size === 3;

  for (const unit of units) {
    const lo = tidy(Math.floor(lo0 / unit) * unit);
    let hi = tidy(Math.ceil(hi0 / unit) * unit);
    if (whole && (hi - lo) % 2 !== 0) hi = tidy(hi + unit); // 가운데 눈금도 정수가 되게
    const r = { lo, hi };
    if (valid(r) && distinct(r)) return r;
  }
  // 깔끔한 단위로 못 맞추면 여유 범위 그대로, 그것도 안 되면 값 ± 1
  const raw = { lo: lo0, hi: hi0 };
  if (valid(raw)) return raw;
  const mid = Number.isFinite(max) ? max : 0;
  const fallback = { lo: mid - 1, hi: mid + 1 };
  return valid(fallback) ? fallback : { lo: 0, hi: 1 };
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

/**
 * 값이 이어진 구간(점 번호 목록). 기록 없는 날(null)에서 선을 끊는다.
 * 빈 날을 건너 이어 그리면 그날도 값이 있는 것처럼 보이기 때문이다.
 */
export function valueSegments(values: (number | null)[]): number[][] {
  const out: number[][] = [];
  let now: number[] = [];
  values.forEach((v, i) => {
    if (typeof v === "number") now.push(i);
    else if (now.length > 0) {
      out.push(now);
      now = [];
    }
  });
  if (now.length > 0) out.push(now);
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

function SeriesChart({ labels, series: rawSeries, mini, area, marks = [], format, ariaLabel, tip, initialActive }: SeriesChartProps) {
  // NaN·Infinity 는 기록 없는 날(null)과 같게 — 선을 그 자리에서 끊는다
  const series = rawSeries.map((s) => ({ ...s, values: s.values.map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null)) }));
  const [active, setActive] = useState<number | null>(initialActive ?? null);
  const h = mini ? 150 : 230;
  const base = h - 26;
  const top = mini ? 18 : marks.length > 0 ? 50 : 22;
  const count = labels.length;
  const values = series.flatMap((s) => s.values).filter((v): v is number => typeof v === "number");
  const { lo, hi } = yRange(values, format);
  const yOf = (v: number) => base - (base - top) * ((v - lo) / (hi - lo));
  const xs = labels.map((_, i) => xPercent(i, count));
  const ticks = tickIndexes(count, mini ? 5 : 7);
  const plotGuess = mini ? PLOT_GUESS.mini : PLOT_GUESS.full;

  const cur = series.find((s) => s.look === "current");
  const areaPath = area && cur ? valueSegments(cur.values).filter((seg) => seg.length > 1).map((seg) => {
    const pts = seg.map((i) => `${xs[i]} ${yOf(cur.values[i] as number)}`);
    return `M${xs[seg[0]]} ${base} L${pts.join(" L")} L${xs[seg[seg.length - 1]]} ${base}Z`;
  }).join(" ") || null : null;

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
              {format(lo + (hi - lo) * f)}
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
            {series.map((s) =>
              valueSegments(s.values).map((seg) => (
                <polyline
                  key={`${s.name}-${seg[0]}`}
                  points={seg.map((i) => `${xs[i]},${yOf(s.values[i] as number)}`).join(" ")}
                  className={lookClass(s.look)}
                  vectorEffect="non-scaling-stroke"
                />
              ))
            )}
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

/** 앞 기간 값이 빈 까닭: 그림 전체에 하나, 또는 점마다 하나(값이 있는 점은 null) */
export type PrevReason = string | null | (string | null)[];

/** 점 i 의 까닭 */
export function reasonAt(reason: PrevReason | undefined, i: number): string | null {
  if (reason == null) return null;
  return typeof reason === "string" ? reason : (reason[i] ?? null);
}

/**
 * 앞 기간 값이 없는 점의 상자 글.
 * 아직 받는 중이거나 받지 못했으면 「앞 기간 자료 없음」이라고 쓰지 않고 그 상태를 그대로 쓴다.
 * 그 밖의 까닭은 「앞 기간 자료 없음 (까닭)」, 까닭이 없으면 fallback.
 */
export function prevMissingText(reason: string | null, fallback: string): string {
  if (!reason) return fallback;
  if (reason === PREV_REASON.loading || reason === PREV_REASON.failed) return reason;
  return `앞 기간 자료 없음 (${reason})`;
}

/**
 * 앞 기간 선이 하나도 없을 때 범례 글. 마우스 상자와 같은 상태를 쓴다.
 * 어느 점이라도 받는 중이면 「앞 기간 불러오는 중」, 받지 못한 점이 있으면 「앞 기간 자료를 받지 못함」,
 * 자료가 준비됐는데 정말 없을 때만 「앞 기간 선 없음」.
 */
export function prevLegendText(reason: PrevReason | undefined, count: number): string {
  const reasons = Array.from({ length: Math.max(1, count) }, (_, i) => reasonAt(reason, i));
  if (reasons.includes(PREV_REASON.loading)) return PREV_REASON.loading;
  if (reasons.includes(PREV_REASON.failed)) return PREV_REASON.failed;
  return "앞 기간 선 없음";
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
  /** 상자 첫 줄 날짜 글. 며칠 묶음이면 「11월 1일~11월 7일 (7일)」처럼 두 날짜를 다 쓴다 */
  tipHeads?: string[];
  /** 상자 앞 기간 줄의 날짜 글(묶음이면 두 날짜). 없으면 prevDates */
  prevTipHeads?: (string | null)[];
  /** 앞 기간 값이 없는 점에서 상자에 쓰는 까닭. 없으면 「앞 기간 기록 없음」 */
  prevReason?: PrevReason;
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
  const {
    labels,
    current,
    previous,
    dates,
    prevDates,
    tipHeads,
    prevTipHeads,
    prevReason,
    unit = "",
    mini,
    two,
    marks,
    format,
    tipFormat,
    ariaLabel,
    initialActive
  } = props;
  const fmt = format ?? ((v: number) => String(Math.round(v)));
  const tipFmt = (v: number) =>
    tipFormat ? tipFormat(v) : `${Number.isInteger(v) ? v.toLocaleString("ko-KR") : fmt(v)}${unit}`;
  const hasPrevious = previous.some((v) => typeof v === "number");
  const series: ChartSeries[] = [
    ...(hasPrevious ? [{ name: "앞 기간", values: previous, look: "previous" as const }] : []),
    { name: "이번 기간", values: current, look: "current" as const }
  ];
  const tip = (i: number) => {
    const day = tipHeads?.[i] ?? (dates?.[i] ? axisLabel(dates[i]) : labels[i]);
    const now = current[i];
    const before = previous[i];
    const prevDay = prevTipHeads?.[i] ?? (prevDates?.[i] ? axisLabel(prevDates[i] as string) : null);
    const lines = [`${day} · 이번 기간 ${typeof now === "number" ? tipFmt(now) : "기록 없음"}`];
    lines.push(
      typeof before === "number"
        ? `${prevDay ?? "같은 순번 날"} · 앞 기간 ${tipFmt(before)}`
        : `${prevDay ? `${prevDay} · ` : ""}${prevMissingText(reasonAt(prevReason, i), "앞 기간 기록 없음")}`
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
          <span className="v3-muted">{prevLegendText(prevReason, current.length)}</span>
        )}
      </div>
    </>
  );
}

export type MultiLineChartProps = {
  dates: string[];
  /** 가로축 글자. 없으면 날짜 */
  labels?: string[];
  /** previous = 같은 자리 앞 기간 값(선은 그리지 않고 상자에만 쓴다). 그 날 자료가 없으면 null */
  series: { name: string; values: (number | null)[]; previous?: (number | null)[] | null }[];
  /** 상자 첫 줄 날짜 글. 없으면 가로축 글 */
  tipHeads?: string[];
  /** 상자 앞 기간 줄의 날짜 글(같은 자리 앞 기간 날) */
  prevTipHeads?: (string | null)[];
  /** 앞 기간 값이 하나도 없는 점에서 상자에 쓰는 까닭: 「앞 기간 자료 없음 (까닭)」 */
  prevReason?: PrevReason;
  unit?: string;
  mini?: boolean;
  format?: (value: number) => string;
  ariaLabel: string;
};

/**
 * 여러 갈래를 한 그림에: 회사별 · 회사 이름 vs 일반 명사.
 * 선은 이번 기간만 그린다(갈래마다 점선을 더하면 읽을 수 없다). 앞 기간 값은 마우스 상자에 갈래마다 붙인다.
 */
export function MultiLineChart({
  dates,
  labels,
  series,
  tipHeads,
  prevTipHeads,
  prevReason,
  unit = "",
  mini,
  format,
  ariaLabel
}: MultiLineChartProps) {
  const fmt = format ?? ((v: number) => String(Math.round(v)));
  const looks: ChartSeries[] = series.map((s, i) => ({ name: s.name, values: s.values, look: i }));
  const axis = labels ?? dates.map(axisLabel);
  const num = (value: number | null | undefined) =>
    typeof value === "number" ? `${value.toLocaleString("ko-KR")}${unit}` : null;
  // 앞 기간 이야기를 상자에 쓸지: 갈래에 앞 기간 배열이 있거나, 없는 까닭을 받았을 때
  const prevTold = prevReason != null || series.some((s) => s.previous != null);
  const tip = (i: number) => {
    const anyPrev = series.some((s) => typeof s.previous?.[i] === "number");
    const head = tipHeads?.[i] ?? axis[i];
    const prevHead = prevTipHeads?.[i] ?? null;
    const lines: string[] = [head];
    const keys: (ChartSeries["look"] | null)[] = [null];
    if (prevTold) {
      lines.push(
        anyPrev
          ? `앞 기간 견준 날 ${prevHead ?? "같은 자리 날"}`
          : `${prevHead ? `${prevHead} · ` : ""}${prevMissingText(reasonAt(prevReason, i), "앞 기간 자료 없음")}`
      );
      keys.push(null);
    }
    series.forEach((s, k) => {
      const now = num(s.values[i]) ?? "기록 없음";
      const before = anyPrev ? ` · 앞 기간 ${num(s.previous?.[i]) ?? "자료 없음"}` : "";
      lines.push(`${s.name} ${now}${before}`);
      keys.push(looks[k].look);
    });
    return { lines, keys };
  };
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
