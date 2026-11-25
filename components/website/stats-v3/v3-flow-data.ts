/**
 * 방문 패턴 맨 위 흐름 그래프 — 들어온 방문 → 어디서 왔나 → 처음 본 페이지 → 다음에 본 페이지 → 그다음 페이지.
 * (11-26 블루진: 「어디로 들어와서 어딜 거쳐서 어디로 나가는지」를 산키 그래프로)
 *
 * 칸마다 출처가 다르다. 어림해서 맞추지 않고 센 값을 그대로 쓴다.
 *   1~3칸  landing_channel  방문 횟수(sessions). key=처음 본 페이지, key2=GA 기본 채널
 *   3~5칸  page_flow        페이지 사이 이동 횟수(조회 수). key=앞 페이지, key2=지금 페이지 (11-26 부터 모음)
 *          page_exit        그 페이지에서 사이트를 떠난 횟수 (11-19 부터 모음)
 * 그래서 3칸에 들어온 굵기와 나간 굵기는 같지 않다. 나가는 쪽은 「그 페이지를 본 모든 방문」의 다음 행동이다.
 * 국문·영문 같은 페이지는 하나로 합친다(/en 을 뗀다).
 */

import { channelLabel } from "@/components/website/stats/stats-labels";
import { pageTitleFromPath, type TitleMap } from "@/components/website/stats/content-data";
import { ga4, normalizePath } from "@/components/website/stats-v3/v3-data";
import type { StatsBundle } from "@/lib/website/stats";

export type FlowNodeKind = "root" | "channel" | "page" | "other" | "exit";

export type FlowNode = {
  name: string;
  /** 0~4 칸 */
  column: number;
  kind: FlowNodeKind;
  /** 칸 위에 적는 수 */
  count: number;
  color: string;
};

export type FlowLink = { source: number; target: number; value: number; unit: "회" | "번" };

export type FlowModel = { nodes: FlowNode[]; links: FlowLink[]; total: number; hasMoves: boolean };

/** 페이지 사이 이동을 모으기 시작한 날(홈페이지 kind=page_flow) */
export const PAGE_FLOW_SINCE = "2026-11-11";

const CHANNEL_LIMIT = 4;
const PAGE_LIMIT = 6;
const CHANNEL_COLORS = ["#477b9f", "#357f77", "#b88b40", "#8975aa"];
export const FLOW_ROOT_COLOR = "#7d838c";
export const FLOW_OTHER_COLOR = "#aab0b8";
export const FLOW_PAGE_COLOR = "#2a3340";
export const FLOW_EXIT_COLOR = "#b5473f";

/** /en/works → /works */
export function flowRoute(raw: string | null | undefined): string | null {
  const path = normalizePath(raw ?? null);
  if (!path) return null;
  if (path === "/en") return "/";
  return path.startsWith("/en/") ? path.slice(3) : path;
}

function add(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function topKeys(map: Map<string, number>, limit: number): string[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key]) => key);
}

function clip(text: string, max = 16): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const OTHER = "\0other";
const EXIT = "\0exit";

export function buildPathFlow(bundle: StatsBundle | null, titles: TitleMap): FlowModel | null {
  /* 1~3칸: 방문 */
  const channelTotals = new Map<string, number>();
  const pageTotals = new Map<string, number>();
  const pairs = new Map<string, number>();
  let total = 0;
  for (const row of ga4(bundle, "landing_channel", "current")) {
    if (typeof row.sessions !== "number" || row.sessions <= 0) continue;
    const route = flowRoute(row.key);
    const channel = row.key2?.trim() || "(other)";
    if (!route) continue;
    total += row.sessions;
    add(channelTotals, channel, row.sessions);
    add(pageTotals, route, row.sessions);
    add(pairs, `${channel}\0${route}`, row.sessions);
  }
  if (total === 0) return null;

  const channels = topKeys(channelTotals, CHANNEL_LIMIT);
  const pages = topKeys(pageTotals, PAGE_LIMIT);
  const channelOf = (c: string) => (channels.includes(c) ? c : OTHER);
  const pageOf = (p: string) => (pages.includes(p) ? p : OTHER);

  /* 3~5칸: 페이지 사이 이동 · 나감 */
  const moves = new Map<string, Map<string, number>>();
  let moveCount = 0;
  for (const row of ga4(bundle, "page_flow", "current")) {
    if (typeof row.events !== "number" || row.events <= 0) continue;
    const from = row.key?.startsWith("/") ? flowRoute(row.key) : null;
    const to = flowRoute(row.key2);
    if (!from || !to || from === to) continue;
    let out = moves.get(from);
    if (!out) moves.set(from, (out = new Map()));
    add(out, to, row.events);
    moveCount += row.events;
  }
  const exits = new Map<string, number>();
  for (const row of ga4(bundle, "page_exit", "current")) {
    if (typeof row.events !== "number" || row.events <= 0) continue;
    const route = flowRoute(row.key);
    if (route) add(exits, route, row.events);
  }

  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];
  const index = new Map<string, number>();
  const node = (column: number, key: string, make: () => Omit<FlowNode, "column" | "count">) => {
    const id = `${column}\0${key}`;
    let at = index.get(id);
    if (at == null) {
      at = nodes.length;
      nodes.push({ ...make(), column, count: 0 });
      index.set(id, at);
    }
    return at;
  };
  const pageNode = (column: number, route: string) =>
    route === OTHER
      ? node(column, OTHER, () => ({ name: "그 밖의 페이지", kind: "other", color: FLOW_OTHER_COLOR }))
      : route === EXIT
        ? node(column, EXIT, () => ({ name: "여기서 나감", kind: "exit", color: FLOW_EXIT_COLOR }))
        : node(column, route, () => ({ name: clip(pageTitleFromPath(route, titles)), kind: "page", color: FLOW_PAGE_COLOR }));
  const link = (source: number, target: number, value: number, unit: FlowLink["unit"]) => {
    if (value <= 0) return;
    const hit = links.find((item) => item.source === source && item.target === target);
    if (hit) hit.value += value;
    else links.push({ source, target, value, unit });
  };

  const root = node(0, "root", () => ({ name: "들어온 방문", kind: "root", color: FLOW_ROOT_COLOR }));
  nodes[root].count = total;

  // 어디서 왔나 — 많은 순으로 먼저 만들어 위에서부터 놓이게 한다
  for (const channel of [...channels, OTHER]) {
    const sum = channel === OTHER
      ? [...channelTotals.entries()].filter(([c]) => !channels.includes(c)).reduce((a, [, v]) => a + v, 0)
      : (channelTotals.get(channel) ?? 0);
    if (sum <= 0) continue;
    const at = node(1, channel, () =>
      channel === OTHER
        ? { name: "그 밖의 경로", kind: "other", color: FLOW_OTHER_COLOR }
        : { name: channelLabel(channel), kind: "channel", color: CHANNEL_COLORS[channels.indexOf(channel)] }
    );
    nodes[at].count = sum;
    link(root, at, sum, "회");
  }
  for (const page of [...pages, OTHER]) {
    const sum = page === OTHER
      ? [...pageTotals.entries()].filter(([p]) => !pages.includes(p)).reduce((a, [, v]) => a + v, 0)
      : (pageTotals.get(page) ?? 0);
    if (sum <= 0) continue;
    nodes[pageNode(2, page)].count = sum;
  }
  for (const [id, value] of pairs) {
    const [channel, route] = id.split("\0");
    link(index.get(`1\0${channelOf(channel)}`)!, index.get(`2\0${pageOf(route)}`)!, value, "회");
  }

  // 다음 칸: 앞 칸의 페이지(그 밖의 페이지는 묶음이라 잇지 않는다)에서 옮겨 간 곳 + 나감
  const step = (fromColumn: number, sources: string[]) => {
    const totals = new Map<string, number>();
    for (const from of sources) for (const [to, v] of moves.get(from) ?? []) add(totals, to, v);
    const keep = topKeys(totals, PAGE_LIMIT);
    const next: string[] = [];
    for (const from of sources) {
      const at = index.get(`${fromColumn}\0${from}`);
      if (at == null) continue;
      for (const [to, v] of moves.get(from) ?? []) {
        const key = keep.includes(to) ? to : OTHER;
        const target = pageNode(fromColumn + 1, key);
        nodes[target].count += v;
        link(at, target, v, "번");
      }
      const gone = exits.get(from) ?? 0;
      if (gone > 0) {
        const target = pageNode(fromColumn + 1, EXIT);
        nodes[target].count += gone;
        link(at, target, gone, "번");
      }
    }
    for (const key of keep) next.push(key);
    return next;
  };
  if (moveCount > 0 || exits.size > 0) {
    const third = step(2, pages);
    step(3, third);
  }

  return { nodes, links, total, hasMoves: moveCount > 0 };
}
