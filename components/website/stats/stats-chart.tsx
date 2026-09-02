"use client";

/**
 * 홈페이지 통계 그래프 — recharts 한 겹 감싼 것.
 * 목업(docs/mockups/website-stats-mockup-v2.html)의 색·축·격자가 기본값이다.
 * 축·격자·툴팁·범례 설정은 전부 이 파일 안에 있다. 화면에서 되풀이하지 않는다.
 */

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Label,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis
} from "recharts";

/** 계열 색 — 목업의 C */
export const STATS_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#9085e9"];
/** 격자 */
export const STATS_GRID = "#eef0f3";
/** 축·범례 글자 */
export const STATS_TEXT = "#8b9098";
/** 테두리 */
export const STATS_LINE = "#e6e8ec";
/** 값이 없거나 눌리지 않은 것 — 목업의 회색 막대 */
export const STATS_MUTED = "#cfd8e4";
/** 나쁜 값 — 목업의 연한 빨강 */
export const STATS_BAD = "#e3b3b1";

const TICK = { fontSize: 11, fill: STATS_TEXT } as const;
const DEFAULT_HEIGHT = 200;

function colorAt(index: number, color?: string): string {
  return color ?? STATS_COLORS[index % STATS_COLORS.length];
}

/** line · bar · hbar 계열 */
export type StatsSeries = {
  /** data 안의 키 */
  key: string;
  /** 툴팁·범례에 보일 이름. 없으면 key */
  name?: string;
  /** 없으면 STATS_COLORS 순서대로 */
  color?: string;
  /** line 전용 — 점선 */
  dashed?: boolean;
  /** bar·hbar 전용 — 같은 값이면 쌓인다 */
  stackId?: string;
  /** bar·hbar 전용 — 막대마다 색을 다르게 (data 순서) */
  colorByPoint?: string[];
};

/** doughnut 한 조각 */
export type StatsSlice = {
  name: string;
  value: number;
  color?: string;
};

/** scatter 점 하나. z 는 점 크기 */
export type StatsPoint = {
  x: number;
  y: number;
  z?: number;
};

export type StatsScatterGroup = {
  name: string;
  color?: string;
  points: StatsPoint[];
};

export type StatsRow = Record<string, string | number | null>;

type Common = {
  /** 그래프 높이(px). 목업 기본 200 */
  height?: number;
  /** 기본 끔 */
  legend?: boolean;
  className?: string;
  /** 축·툴팁 숫자 표기 */
  format?: (value: number) => string;
};

export type StatsChartProps = Common &
  (
    | {
        /** 선 그래프 */
        type: "line";
        data: StatsRow[];
        /** 가로축이 될 키 */
        xKey: string;
        series: StatsSeries[];
      }
    | {
        /** 세로 막대 */
        type: "bar";
        data: StatsRow[];
        xKey: string;
        series: StatsSeries[];
        /** 값축 최대. 없으면 데이터에 맞춘다 */
        max?: number;
      }
    | {
        /**
         * 막대와 선을 겹친다. 값 크기가 크게 다를 때 쓴다.
         * 노출 3,000 과 클릭 100 을 한 축에 두면 선이 바닥에 붙는다.
         */
        type: "combo";
        data: StatsRow[];
        xKey: string;
        /** 왼쪽 축 */
        bars: StatsSeries[];
        /** 오른쪽 축 */
        lines: StatsSeries[];
        leftLabel?: string;
        rightLabel?: string;
      }
    | {
        /** 가로 막대 — 이름이 세로축으로 간다 */
        type: "hbar";
        data: StatsRow[];
        xKey: string;
        series: StatsSeries[];
        max?: number;
        /** 이름 칸 너비(px). 긴 이름이면 늘린다 */
        labelWidth?: number;
      }
    | {
        /** 도넛 */
        type: "doughnut";
        data: StatsSlice[];
      }
    | {
        /** 점 그래프. z 를 주면 점 크기가 달라진다 (버블) */
        type: "scatter";
        groups: StatsScatterGroup[];
        xDomain?: [number, number];
        yDomain?: [number, number];
        /** 점 넓이 범위. z 가 있을 때만 쓴다 */
        sizeRange?: [number, number];
      }
    | {
        /** KPI 카드 안 작은 추이선. 축·격자·툴팁 없음 */
        type: "spark";
        data: StatsRow[];
        dataKey: string;
        color?: string;
      }
  );

function tooltip(format?: (value: number) => string) {
  return (
    <Tooltip
      contentStyle={{
        fontSize: 12,
        borderRadius: 8,
        border: `1px solid ${STATS_LINE}`,
        padding: "6px 10px"
      }}
      labelStyle={{ fontSize: 11, color: STATS_TEXT, marginBottom: 2 }}
      itemStyle={{ fontSize: 12, padding: 0 }}
      formatter={
        format
          ? (value) => (typeof value === "number" ? format(value) : String(value))
          : undefined
      }
    />
  );
}

/**
 * recharts 가 그리는 범례는 이름 순으로 늘어놓고 좁아지면 겹친다.
 * 목업 순서와 줄바꿈을 지키려고 직접 그린다.
 */
function legendNode(show: boolean | undefined, items: { value: string; color: string }[]) {
  if (!show) return null;
  return (
    <Legend
      verticalAlign="bottom"
      height={26}
      content={() => (
        <ul className="ws-lg">
          {items.map((item) => (
            <li key={item.value}>
              <span className="ws-lg-dot" style={{ background: item.color }} />
              {item.value}
            </li>
          ))}
        </ul>
      )}
    />
  );
}

function seriesLegend(series: StatsSeries[]) {
  return series.map((item, index) => ({
    value: item.name ?? item.key,
    color: colorAt(index, item.color)
  }));
}

/** 목업의 B — x 격자 없음, y 격자만, 축선 없음 */
function verticalAxes(xKey: string, max?: number, format?: (value: number) => string) {
  return (
    <>
      <CartesianGrid vertical={false} stroke={STATS_GRID} />
      <XAxis dataKey={xKey} tick={TICK} tickLine={false} axisLine={{ stroke: STATS_GRID }} />
      <YAxis
        tick={TICK}
        tickLine={false}
        axisLine={false}
        width={44}
        domain={max === undefined ? undefined : [0, max]}
        tickFormatter={format ? (value: number) => format(value) : undefined}
      />
    </>
  );
}

/** 목업의 HB — 가로막대. x 격자만, 이름이 세로축 */
function horizontalAxes(
  xKey: string,
  labelWidth: number,
  max?: number,
  format?: (value: number) => string
) {
  return (
    <>
      <CartesianGrid horizontal={false} stroke={STATS_GRID} />
      <XAxis
        type="number"
        tick={TICK}
        tickLine={false}
        axisLine={false}
        domain={max === undefined ? undefined : [0, max]}
        tickFormatter={format ? (value: number) => format(value) : undefined}
      />
      <YAxis
        type="category"
        dataKey={xKey}
        tick={TICK}
        tickLine={false}
        axisLine={{ stroke: STATS_GRID }}
        width={labelWidth}
      />
    </>
  );
}

function barCells(rowCount: number, series: StatsSeries) {
  if (!series.colorByPoint) return null;
  const colors = series.colorByPoint;
  return Array.from({ length: rowCount }, (_, index) => (
    <Cell key={index} fill={colors[index % colors.length]} />
  ));
}

function chartBody(props: StatsChartProps) {
  if (props.type === "spark") {
    const color = props.color ?? STATS_COLORS[0];
    return (
      <AreaChart data={props.data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
        {/* 값이 전부 0 이면 위끝을 1 로 올려 밑선이 보이게 한다 */}
        <YAxis hide domain={["dataMin", (max: number) => (max === 0 ? 1 : max)]} />
        <Area
          type="monotone"
          dataKey={props.dataKey}
          stroke={color}
          strokeWidth={1.5}
          fill={color}
          fillOpacity={0.1}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    );
  }

  if (props.type === "line") {
    return (
      <LineChart data={props.data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        {verticalAxes(props.xKey, undefined, props.format)}
        {tooltip(props.format)}
        {legendNode(props.legend, seriesLegend(props.series))}
        {props.series.map((series, index) => (
          <Line
            key={series.key}
            type="monotone"
            dataKey={series.key}
            name={series.name ?? series.key}
            stroke={colorAt(index, series.color)}
            strokeWidth={2}
            strokeDasharray={series.dashed ? "5 4" : undefined}
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    );
  }

  if (props.type === "bar") {
    return (
      <BarChart data={props.data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        {verticalAxes(props.xKey, props.max, props.format)}
        {tooltip(props.format)}
        {legendNode(props.legend, seriesLegend(props.series))}
        {props.series.map((series, index) => (
          <Bar
            key={series.key}
            dataKey={series.key}
            name={series.name ?? series.key}
            fill={colorAt(index, series.color)}
            stackId={series.stackId}
            radius={[4, 4, 0, 0]}
            maxBarSize={26}
            isAnimationActive={false}
          >
            {barCells(props.data.length, series)}
          </Bar>
        ))}
      </BarChart>
    );
  }

  if (props.type === "combo") {
    const axisLabel = (text: string | undefined, side: "left" | "right") =>
      text ? (
        <Label
          value={text}
          position={side === "left" ? "insideTopLeft" : "insideTopRight"}
          offset={-2}
          style={{ fontSize: 10, fill: STATS_TEXT }}
        />
      ) : null;

    return (
      <ComposedChart data={props.data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={STATS_GRID} />
        <XAxis
          dataKey={props.xKey}
          tick={TICK}
          tickLine={false}
          axisLine={{ stroke: STATS_GRID }}
        />
        <YAxis yAxisId="left" tick={TICK} tickLine={false} axisLine={false} width={48}>
          {axisLabel(props.leftLabel, "left")}
        </YAxis>
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={TICK}
          tickLine={false}
          axisLine={false}
          width={40}
        >
          {axisLabel(props.rightLabel, "right")}
        </YAxis>
        {tooltip(props.format)}
        {legendNode(props.legend, seriesLegend([...props.bars, ...props.lines]))}
        {props.bars.map((series, index) => (
          <Bar
            key={series.key}
            yAxisId="left"
            dataKey={series.key}
            name={series.name ?? series.key}
            fill={colorAt(index, series.color)}
            stackId={series.stackId}
            radius={[3, 3, 0, 0]}
            maxBarSize={20}
            isAnimationActive={false}
          />
        ))}
        {props.lines.map((series, index) => (
          <Line
            key={series.key}
            yAxisId="right"
            type="monotone"
            dataKey={series.key}
            name={series.name ?? series.key}
            stroke={colorAt(props.bars.length + index, series.color)}
            strokeWidth={2}
            strokeDasharray={series.dashed ? "5 4" : undefined}
            dot={false}
            activeDot={{ r: 3 }}
            isAnimationActive={false}
          />
        ))}
      </ComposedChart>
    );
  }

  if (props.type === "hbar") {
    return (
      <BarChart
        data={props.data}
        layout="vertical"
        margin={{ top: 6, right: 12, left: 0, bottom: 0 }}
      >
        {horizontalAxes(props.xKey, props.labelWidth ?? 120, props.max, props.format)}
        {tooltip(props.format)}
        {legendNode(props.legend, seriesLegend(props.series))}
        {props.series.map((series, index) => (
          <Bar
            key={series.key}
            dataKey={series.key}
            name={series.name ?? series.key}
            fill={colorAt(index, series.color)}
            stackId={series.stackId}
            radius={[0, 4, 4, 0]}
            maxBarSize={16}
            isAnimationActive={false}
          >
            {barCells(props.data.length, series)}
          </Bar>
        ))}
      </BarChart>
    );
  }

  if (props.type === "doughnut") {
    return (
      <PieChart margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
        {tooltip(props.format)}
        {legendNode(
          props.legend,
          props.data.map((slice, index) => ({
            value: slice.name,
            color: colorAt(index, slice.color)
          }))
        )}
        <Pie
          data={props.data}
          dataKey="value"
          nameKey="name"
          innerRadius="58%"
          outerRadius="82%"
          stroke="#fff"
          strokeWidth={2}
          isAnimationActive={false}
        >
          {props.data.map((slice, index) => (
            <Cell key={slice.name} fill={colorAt(index, slice.color)} />
          ))}
        </Pie>
      </PieChart>
    );
  }

  const sizeRange = props.sizeRange ?? [80, 600];
  return (
    <ScatterChart margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
      <CartesianGrid stroke={STATS_GRID} />
      <XAxis
        type="number"
        dataKey="x"
        tick={TICK}
        tickLine={false}
        axisLine={{ stroke: STATS_GRID }}
        domain={props.xDomain}
      />
      <YAxis
        type="number"
        dataKey="y"
        tick={TICK}
        tickLine={false}
        axisLine={false}
        width={36}
        domain={props.yDomain}
      />
      {/* z 로 점 넓이를 정한다. 없으면 모두 같은 크기 */}
      <ZAxis type="number" dataKey="z" range={sizeRange} />
      {tooltip(props.format)}
      {legendNode(
        props.legend,
        props.groups.map((group, index) => ({
          value: group.name,
          color: colorAt(index, group.color)
        }))
      )}
      {props.groups.map((group, index) => (
        <Scatter
          key={group.name}
          name={group.name}
          data={group.points}
          fill={colorAt(index, group.color)}
          fillOpacity={0.8}
          isAnimationActive={false}
        />
      ))}
    </ScatterChart>
  );
}

/**
 * 그래프 자리에 값이 없을 때. 축도 범례도 그리지 않는다.
 * 0 을 그린 그래프와 헷갈리지 않게 글로만 말한다.
 */
export function StatsEmpty({
  height = DEFAULT_HEIGHT,
  title = "아직 데이터가 없습니다",
  hint
}: {
  height?: number;
  title?: string;
  hint?: string;
}) {
  return (
    <div
      className="ws-chart"
      style={{
        height,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        textAlign: "center",
        color: STATS_TEXT,
        fontSize: 12.5,
        lineHeight: 1.6
      }}
    >
      <span>{title}</span>
      {hint ? <span style={{ fontSize: 11.5, opacity: 0.8 }}>{hint}</span> : null}
    </div>
  );
}

export function StatsChart(props: StatsChartProps) {
  const { height = DEFAULT_HEIGHT, className } = props;

  return (
    <div className={className ? `ws-chart ${className}` : "ws-chart"} style={{ height }}>
      {/*
        Recharts 3 ResponsiveContainer 는 첫 렌더에서 크기를 -1 로 두고
        ResizeObserver 측정 후에야 선·도넛을 그린다. 부모(.ws-chart)는
        height 가 이미 정해져 있어도 같은 현상이 난다. initialDimension 으로
        첫 프레임부터 그리게 한다.
      */}
      <ResponsiveContainer
        width="100%"
        height="100%"
        initialDimension={{ width: 320, height }}
      >
        {chartBody(props)}
      </ResponsiveContainer>
    </div>
  );
}
