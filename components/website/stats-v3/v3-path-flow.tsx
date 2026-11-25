"use client";

/**
 * 방문 패턴 맨 위 — 들어와서 · 거쳐서 · 나가는 흐름 (산키 그래프).
 * 칸 위에 이름과 수를 적고, 칸 사이 띠 굵기가 횟수다. 띠에 마우스를 올리면 정확한 수가 나온다.
 */

import { Sankey } from "recharts";

import {
  FLOW_EXIT_COLOR,
  FLOW_ROOT_COLOR,
  type FlowLink,
  type FlowModel,
  type FlowNode
} from "@/components/website/stats-v3/v3-flow-data";

const WIDTH = 1080;
const HEIGHT = 520;
const NODE_WIDTH = 8;
const MARGIN = { top: 8, right: 140, bottom: 30, left: 8 };

const COLUMN_TITLES = ["들어온 방문", "어디서 왔나", "처음 본 페이지", "다음에 본 페이지", "그다음 페이지"];

type NodeArgs = { x: number; y: number; width: number; height: number; payload: FlowNode & { depth?: number } };
type LinkArgs = {
  sourceX: number;
  targetX: number;
  sourceY: number;
  targetY: number;
  sourceControlX: number;
  targetControlX: number;
  linkWidth: number;
  payload: FlowLink & { source: FlowNode; target: FlowNode };
};

function FlowNodeShape({ x, y, width, height, payload }: NodeArgs) {
  const tx = x + width + 8;
  const anchor = "start";
  return (
    <g>
      <rect x={x} y={y} width={width} height={Math.max(2, height)} fill={payload.color} rx={1} />
      <text x={tx} y={y + 11} textAnchor={anchor} className="v3-pf-name">
        {payload.name}
      </text>
      <text x={tx} y={y + 28} textAnchor={anchor} className="v3-pf-count">
        {payload.count.toLocaleString("ko-KR")}
      </text>
      <title>{`${payload.name} ${payload.count.toLocaleString("ko-KR")}${payload.column <= 2 ? "회 (방문)" : "번"}`}</title>
    </g>
  );
}

function linkColor(link: LinkArgs["payload"]): { stroke: string; opacity: number } {
  if (link.target.kind === "exit") return { stroke: FLOW_EXIT_COLOR, opacity: 0.22 };
  if (link.source.kind === "root") return { stroke: FLOW_ROOT_COLOR, opacity: 0.16 };
  if (link.source.kind === "channel" || link.source.kind === "other") return { stroke: link.source.color, opacity: 0.24 };
  return { stroke: "#477b9f", opacity: 0.16 };
}

function FlowLinkShape({ sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload }: LinkArgs) {
  const { stroke, opacity } = linkColor(payload);
  const d = `M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`;
  const label = payload.unit === "회" ? "방문" : "이동";
  return (
    <path d={d} fill="none" stroke={stroke} strokeOpacity={opacity} strokeWidth={Math.max(1, linkWidth)} className="v3-pf-link">
      <title>{`${payload.source.name} → ${payload.target.name}: ${payload.value.toLocaleString("ko-KR")}${payload.unit} ${label}`}</title>
    </path>
  );
}

export function PathFlow({ model }: { model: FlowModel }) {
  const columns = Math.max(...model.nodes.map((node) => node.column)) + 1;
  // recharts 는 칸을 왼쪽 여백부터 같은 간격으로 놓는다. 제목도 같은 자리에 둔다
  const step = columns > 1 ? (WIDTH - MARGIN.left - MARGIN.right - NODE_WIDTH) / (columns - 1) : 0;
  return (
    <div className="v3-pf-scroll">
      <div className="v3-pf">
        <svg width={WIDTH} height={22} className="v3-pf-heads" aria-hidden="true">
          {COLUMN_TITLES.slice(0, columns).map((title, i) => (
            <text key={title} x={MARGIN.left + i * step} y={15}>
              {title}
            </text>
          ))}
        </svg>
        <Sankey
          width={WIDTH}
          height={HEIGHT}
          data={model}
          align="left"
          nodePadding={34}
          nodeWidth={NODE_WIDTH}
          iterations={64}
          linkCurvature={0.5}
          margin={MARGIN}
          node={(props) => <FlowNodeShape {...(props as unknown as NodeArgs)} />}
          link={(props) => <FlowLinkShape {...(props as unknown as LinkArgs)} />}
        />
      </div>
    </div>
  );
}
