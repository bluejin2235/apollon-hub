/**
 * 콘텐츠 화면 v3 — 「무엇을 많이, 오래 보나요?」
 *
 * 표의 조회 · 여기로 들어온 수 · 그냥 나간 비율 · 증감은 지금 콘텐츠 화면의
 * buildPages · pageDelta 를 그대로 쓴다. 여기서 새로 정하는 것은 팀장이 정한 세 가지뿐이다.
 *   · 「메뉴 페이지」 = 워크·인사이트 글이 아닌 모든 화면
 *   · 「새 글」 = 고른 기간 안에 공개된 글
 *   · 「주로 어디서」 = 검색 · AI · 직접 방문 · 기타 4갈래
 */

import {
  buildPages,
  buildPreviousPages,
  buildTitles,
  EMPTY_TITLES,
  pageDelta,
  type ContentPage,
  type PageDelta,
  type TitleMap
} from "@/components/website/stats/content-data";
import { readAiVisits } from "@/components/website/stats/ai-data";
import { readActualRange, type DeltaView } from "@/components/website/stats/stats-data";
import type { V3Catalog } from "@/components/website/stats-v3/v3-catalog";
import {
  articleEntriesOf,
  bounceOf,
  countDeltaOf,
  dailySumOf,
  durationText,
  dwellSecondsOf,
  durationParts,
  ga4,
  intKo,
  normalizePath,
  pctNumber,
  prevDateOf,
  prevGuard,
  ratioDelta,
  searchToArticleOf,
  type DaySeries
} from "@/components/website/stats-v3/v3-data";
import { makeDelta } from "@/components/website/stats/stats-data";
import type { StatsBundle, StatsPoint } from "@/lib/website/stats";

/* ─────────────────────── 카드 다섯 칸 ─────────────────────── */

export type ContentCardId = "views" | "dwell" | "articleEntries" | "searchToArticle" | "bounce";

export type ContentCard = {
  id: ContentCardId;
  label: string;
  /** 이 숫자가 무엇인지 쉬운 말 한 줄 */
  hint: string;
  value: string | null;
  unit: string;
  delta: DeltaView;
};

const withUnit = (unit: string) => (value: string | null) => (value == null ? null : `${value}${unit}`);

/** 앞 기간이 옛 사이트면 앞 기간 값과 증감을 비운다 — 요약 카드와 같은 기준 */
export function contentCards(bundle: StatsBundle | null): ContentCard[] {
  const prev = prevGuard(bundle);

  const views = { current: dailySumOf(bundle, "views", "current"), previous: prev(dailySumOf(bundle, "views", "previous")) };
  const dwell = { current: dwellSecondsOf(bundle, "current"), previous: prev(dwellSecondsOf(bundle, "previous")) };
  const entries = {
    current: articleEntriesOf(bundle, "current"),
    previous: prev(articleEntriesOf(bundle, "previous"))
  };
  const rate = {
    current: searchToArticleOf(bundle, "current"),
    previous: prev(searchToArticleOf(bundle, "previous"))
  };
  const bounce = { current: bounceOf(bundle, "current"), previous: prev(bounceOf(bundle, "previous")) };
  const dwellParts = durationParts(dwell.current);

  return [
    {
      id: "views",
      label: "페이지를 연 횟수",
      hint: "모든 페이지를 연 횟수를 더한 값이에요.",
      value: intKo(views.current),
      unit: "회",
      delta: ratioDelta(views, (v) => withUnit("회")(intKo(v)))
    },
    {
      id: "dwell",
      label: "한 번 와서 머문 시간",
      hint: "한 번 방문해서 사이트에 머문 평균 시간이에요.",
      value: dwellParts?.value ?? null,
      unit: dwellParts?.unit ?? "초",
      delta: ratioDelta(dwell, durationText)
    },
    {
      id: "articleEntries",
      label: "워크·인사이트 글로 바로 들어온 방문",
      hint: "첫 화면을 거치지 않고 글 페이지에서 바로 시작한 방문 수예요. 검색이나 공유 링크로 많이 생겨요.",
      value: intKo(entries.current),
      unit: "회",
      delta: countDeltaOf(entries, (v) => withUnit("회")(intKo(v)))
    },
    {
      id: "searchToArticle",
      label: "검색으로 와서 글로 바로 들어온 비율",
      hint: "구글 같은 검색으로 온 방문 중, 글 페이지에서 바로 시작한 비율이에요.",
      value: pctNumber(rate.current),
      unit: "%",
      delta: makeDelta(rate.current, rate.previous, "point", true, withUnit("%")(pctNumber(rate.previous)))
    },
    {
      id: "bounce",
      label: "금방 나간 비율",
      hint: "10초 안에, 다른 페이지도 안 보고 나간 방문의 비율이에요. 낮을수록 좋아요.",
      value: pctNumber(bounce.current),
      unit: "%",
      delta: makeDelta(bounce.current, bounce.previous, "point", false, withUnit("%")(pctNumber(bounce.previous)))
    }
  ];
}

/* ─────────────────────── 표 한 줄 ─────────────────────── */

export type ContentKind = "워크" | "인사이트" | "메뉴 페이지";

export function contentKindOf(page: Pick<ContentPage, "typeId">): ContentKind {
  if (page.typeId === "work") return "워크";
  if (page.typeId === "insight") return "인사이트";
  return "메뉴 페이지";
}

/** 검색 · AI · 직접 방문 · 기타 (0~100, 합 100) */
export type SourceShare = [number, number, number, number];

export type ContentRow = {
  path: string;
  title: string;
  kind: ContentKind;
  locale: "ko" | "en";
  views: number | null;
  entries: number | null;
  bounce: number | null;
  /** 들어온 방문이 없으면 null */
  sources: SourceShare | null;
  delta: PageDelta;
  /** 고른 기간 안에 공개된 글 */
  isNew: boolean;
};

/** 경로 끝 slug — /works/abc · /en/insight/abc → abc */
function slugOf(path: string): { kind: "work" | "insight"; slug: string } | null {
  const route = path.startsWith("/en/") ? path.slice(3) : path;
  const match = /^\/(works|insight)\/([^/]+)$/.exec(route);
  if (!match) return null;
  return { kind: match[1] === "works" ? "work" : "insight", slug: match[2] };
}

/** 공개 시각 → 서울 날짜 */
function seoulDate(iso: string | null): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return new Date(time + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 고른 기간 안에 공개된 글의 경로 slug 모음 */
export function newArticleSlugs(
  catalog: V3Catalog | null,
  from: string,
  to: string
): { work: Set<string>; insight: Set<string> } {
  const inRange = (item: { published_at: string | null; status: string }) => {
    if (item.status !== "published") return false;
    const day = seoulDate(item.published_at);
    return Boolean(day && day >= from && day <= to);
  };
  return {
    work: new Set((catalog?.works ?? []).filter(inRange).map((item) => item.slug)),
    insight: new Set((catalog?.insights ?? []).filter(inRange).map((item) => item.slug))
  };
}

const SEARCH_CHANNEL = "Organic Search";
const DIRECT_CHANNEL = "Direct";

/**
 * 들어온 페이지별 출처 4갈래.
 * 검색 = GA 채널 Organic Search, 직접 방문 = Direct, 나머지는 기타.
 * AI 는 GA 채널에서 따로 나오지 않아(대개 Referral) kind=ai_visits 의 도착 페이지 세션을
 * 기타에서 덜어 AI 로 옮긴다. 홈페이지가 주는 도착 페이지 목록 밖은 AI 0 으로 본다.
 */
export function sourceShares(bundle: StatsBundle | null): Map<string, SourceShare> {
  const acc = new Map<string, [number, number, number, number]>();
  const at = (path: string) => {
    let item = acc.get(path);
    if (!item) {
      item = [0, 0, 0, 0];
      acc.set(path, item);
    }
    return item;
  };
  for (const row of ga4(bundle, "landing_channel", "current")) {
    const path = normalizePath(row.key);
    if (!path || typeof row.sessions !== "number" || row.sessions <= 0) continue;
    const channel = row.key2?.trim();
    const item = at(path);
    if (channel === SEARCH_CHANNEL) item[0] += row.sessions;
    else if (channel === DIRECT_CHANNEL) item[2] += row.sessions;
    else item[3] += row.sessions;
  }
  for (const page of readAiVisits(bundle)?.current.top_pages ?? []) {
    const path = normalizePath(page.path);
    if (!path) continue;
    const item = acc.get(path);
    if (!item) continue;
    const moved = Math.min(page.sessions, item[3]);
    item[1] += moved;
    item[3] -= moved;
  }

  const out = new Map<string, SourceShare>();
  for (const [path, parts] of acc) {
    const total = parts.reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    out.set(path, roundShares(parts.map((part) => (part / total) * 100) as SourceShare));
  }
  return out;
}

/** 반올림해도 합이 100 이 되게 — 소수점이 큰 칸부터 1씩 더한다 */
export function roundShares(parts: SourceShare): SourceShare {
  const floor = parts.map(Math.floor);
  let left = 100 - floor.reduce((a, b) => a + b, 0);
  const order = parts
    .map((part, index) => ({ index, rest: part - Math.floor(part) }))
    .sort((a, b) => b.rest - a.rest);
  for (const { index } of order) {
    if (left <= 0) break;
    floor[index] += 1;
    left -= 1;
  }
  return floor as SourceShare;
}

export function titlesOf(catalog: V3Catalog | null): TitleMap {
  return catalog ? buildTitles(catalog.works, catalog.insights) : EMPTY_TITLES;
}

/** 공개 전 미리보기 주소(/preview/…, 영문 /en/preview/…) — 방문자가 보는 화면이 아니라 표에서 뺀다 */
export function isPreviewPath(path: string): boolean {
  return /^(\/en)?\/preview(\/|$)/i.test(path);
}

/** 표 전체 — 조회 많은 순(buildPages 순서). 미리보기 주소는 뺀다 */
export function contentRows(
  bundle: StatsBundle | null,
  catalog: V3Catalog | null,
  from: string,
  to: string
): ContentRow[] {
  const range = readActualRange(bundle);
  const fresh = newArticleSlugs(catalog, range?.actualFrom ?? from, range?.actualTo ?? to);
  const previous = prevGuard(bundle)(buildPreviousPages(bundle));
  const sources = sourceShares(bundle);
  return buildPages(bundle, titlesOf(catalog))
    .filter((page) => !isPreviewPath(page.path))
    .map((page) => {
      const slug = slugOf(page.path);
      return {
        path: page.path,
        title: page.title,
        kind: contentKindOf(page),
        locale: page.locale,
        views: page.views,
        entries: page.entries,
        bounce: page.bounce,
        sources: sources.get(page.path) ?? null,
        delta: pageDelta(page, previous),
        isNew: slug ? fresh[slug.kind].has(slug.slug) : false
      };
    });
}

/* ─────────────────────── 거르기 · 순서 ─────────────────────── */

export type KindFilter = "전체" | ContentKind;
export type LocaleFilter = "ko" | "en" | null;
export type SortKey = "views" | "entries" | "bounce";

export function filterAndSort(
  rows: ContentRow[],
  kind: KindFilter,
  locale: LocaleFilter,
  sortKey: SortKey,
  ascending: boolean
): ContentRow[] {
  const value = (row: ContentRow) => row[sortKey] ?? (ascending ? Number.POSITIVE_INFINITY : -1);
  return rows
    .filter((row) => (kind === "전체" || row.kind === kind) && (!locale || row.locale === locale))
    .sort((a, b) => (ascending ? value(a) - value(b) : value(b) - value(a)));
}

/* ─────────────────────── 오른 · 내린 콘텐츠 ─────────────────────── */

export type MoveRow = { path: string; title: string; locale: "ko" | "en"; delta: DeltaView; change: number };

/**
 * 조회 증감(%)이 나오는 페이지만 — 증감 칸과 같은 값.
 * 오른 쪽은 늘어난 순, 내린 쪽은 줄어든 순으로 세 줄.
 */
export function contentMoves(rows: ContentRow[], bundle: StatsBundle | null): { up: MoveRow[]; down: MoveRow[] } {
  const previous = prevGuard(bundle)(buildPreviousPages(bundle));
  if (!previous) return { up: [], down: [] };
  const moves: MoveRow[] = [];
  for (const row of rows) {
    if (row.delta.views.delta == null || row.views == null) continue;
    const before = previous.get(row.path)?.views ?? 0;
    if (!(before > 0)) continue;
    moves.push({
      path: row.path,
      title: row.title,
      locale: row.locale,
      delta: row.delta.views,
      change: (row.views - before) / before
    });
  }
  return {
    up: moves.filter((m) => m.change > 0).sort((a, b) => b.change - a.change).slice(0, 3),
    down: moves.filter((m) => m.change < 0).sort((a, b) => a.change - b.change).slice(0, 3)
  };
}

/* ─────────────────────── 펼침 — 이 글 날짜별 조회 ─────────────────────── */

/**
 * 이 경로의 날짜별 조회. 날짜 칸은 사이트 전체 날짜(daily)에 맞추고, 사이트 자료는 있는데 이 글 행이 없는 날은 0.
 * 앞 기간은 비교 날짜(prevDateOf)로 찾고, 그 날 사이트 자료가 없으면 null(기록 없음).
 */
export function pageDaySeries(bundle: StatsBundle | null, path: string): DaySeries {
  const sumBy = (rows: StatsPoint[]) => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (normalizePath(row.key) !== path || typeof row.views !== "number" || !row.date) continue;
      map.set(row.date, (map.get(row.date) ?? 0) + row.views);
    }
    return map;
  };
  const days = (when: "current" | "previous") =>
    [...new Set(ga4(bundle, "daily", when).map((row) => row.date).filter(Boolean))].sort();
  const cur = sumBy(ga4(bundle, "page", "current"));
  const prev = sumBy(ga4(bundle, "page", "previous"));
  const dates = days("current");
  const prevDays = new Set(prevGuard(bundle)(days("previous")) ?? []);
  const prevDate = prevDateOf(bundle);
  return {
    dates,
    current: dates.map((date) => cur.get(date) ?? 0),
    previous: dates.map((date) => {
      const before = prevDate(date);
      return before && prevDays.has(before) ? (prev.get(before) ?? 0) : null;
    })
  };
}

/* ─────────────────────── 맨 위 답 문장 ─────────────────────── */

/** 「<em>제목</em> 조회가 가장 많았고, 글로 바로 들어온 방문은 N회예요.」 */
export function contentAnswer(
  rows: ContentRow[],
  bundle: StatsBundle | null
): { em: string; tail: string } | null {
  const top = rows.find((row) => typeof row.views === "number" && row.views > 0);
  if (!top) return null;
  const entries = articleEntriesOf(bundle, "current");
  const tail =
    entries == null
      ? " 페이지가 가장 많이 열렸어요."
      : ` 페이지가 가장 많이 열렸어요. 워크·인사이트 글로 바로 들어온 방문은 ${entries.toLocaleString("ko-KR")}회예요.`;
  return { em: top.title, tail };
}
