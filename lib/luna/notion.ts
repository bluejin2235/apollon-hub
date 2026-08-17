import {
  matchNamedEntities,
  NAMED_ENTITY_SEED
} from "@/lib/luna/named-entities";
import { prepareSearchTerms } from "@/lib/luna/workserver";

export type NotionSource = {
  title: string;
  url: string;
  id: string;
  last_edited_time?: string | null;
  excerpt?: string | null;
  paths?: string[];
  dates?: string[];
  entities?: string[];
};

export type NotionSearchStatus = "ok" | "empty" | "skipped" | "error";

export type NotionSearchOutcome = {
  status: NotionSearchStatus;
  sources: NotionSource[];
  queries: string[];
  rounds: number;
  error?: string;
  httpStatus?: number;
};

type NotionSearchResult = {
  object?: string;
  id?: string;
  url?: string;
  title?: unknown;
  last_edited_time?: string | null;
  properties?: Record<string, unknown>;
};

const MAX_NOTION_QUERIES = 6;
const PAGE_SIZE = 15;
const CANDIDATE_LIMIT = 15;
const DISPLAY_LIMIT = 5;
const BODY_BUDGET_MS = 8_000;
const BODY_PAGE_SIZE = 100;
const EMPTY_TITLE = "(제목 없음)";
const NOTION_VERSION = "2022-06-28";
const DOC_TYPE_RE =
  /제안서|견적서|보고서|기획안|기획서|도면|착수|수행계획|계약서|발주/;
const EXCLUDE_RE = /삭제\s*예정|\bold\b/i;
const WORKSERVER_PATH_RE = /(?:T|P):\\[^\r\n]+/g;
const RICH_TEXT_BLOCK_TYPES = new Set([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "toggle",
  "quote",
  "callout",
  "code"
]);

function plainFromRichText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (part && typeof part === "object" && "plain_text" in part) {
        return String((part as { plain_text?: string }).plain_text ?? "");
      }
      return "";
    })
    .join("")
    .trim();
}

export function extractNotionPageTitle(result: NotionSearchResult): string {
  return extractTitleFromSearchResult(result);
}

function extractTitleFromSearchResult(result: NotionSearchResult): string {
  if (result.object === "database") {
    const text = plainFromRichText(result.title);
    return text || EMPTY_TITLE;
  }

  const props = result.properties;
  if (props && typeof props === "object") {
    for (const value of Object.values(props)) {
      if (!value || typeof value !== "object") continue;
      const prop = value as { type?: string; title?: unknown };
      if (prop.type === "title") {
        const text = plainFromRichText(prop.title);
        if (text) return text;
      }
    }
  }

  return EMPTY_TITLE;
}

function extractUrlSlug(url: string): string | null {
  const match = url.match(/\/p\/([^/?#]+)/i);
  if (!match) return null;

  let segment = decodeURIComponent(match[1]);
  segment = segment
    .replace(/-[a-f0-9]{32}$/i, "")
    .replace(
      /-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
      ""
    );
  return segment || null;
}

function slugToDisplayText(slug: string): string {
  return slug.replace(/-/g, " ").trim();
}

function normalizeTitleForCompare(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function titleMatchesUrlSlug(title: string, url: string): boolean {
  if (title === EMPTY_TITLE) return true;

  const slug = extractUrlSlug(url);
  if (!slug) return false;

  const slugDisplay = slugToDisplayText(slug);
  const normTitle = normalizeTitleForCompare(title);
  const normSlug = normalizeTitleForCompare(slugDisplay);

  if (normTitle === normSlug) return true;
  if (normSlug.startsWith(normTitle) && normTitle.length >= 6) return true;
  if (normTitle.startsWith(normSlug) && normSlug.length >= 6) return true;
  return false;
}

async function fetchNotionTitle(
  id: string,
  objectType: string | undefined,
  token: string
): Promise<string> {
  const endpoint =
    objectType === "database"
      ? `https://api.notion.com/v1/databases/${id}`
      : `https://api.notion.com/v1/pages/${id}`;

  const res = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION
    }
  });

  if (!res.ok) {
    console.error(
      "[luna/notion] enrich",
      res.status,
      id,
      (await res.text()).slice(0, 200)
    );
    return EMPTY_TITLE;
  }

  const data = (await res.json()) as NotionSearchResult;
  const title = extractTitleFromSearchResult(data);
  return title === EMPTY_TITLE ? EMPTY_TITLE : title;
}

function notionSourceKey(source: NotionSource): string {
  return source.id || source.url;
}

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

function koreanSpacingVariants(term: string): string[] {
  const variants = new Set<string>([term]);
  if (new RegExp("오피스라운지", "i").test(term)) {
    variants.add(term.replace(new RegExp("오피스라운지", "gi"), "오피스 라운지"));
  }
  if (new RegExp("([가-힣]+)라운지", "i").test(term) && !/\s/.test(term)) {
    variants.add(term.replace(new RegExp("([가-힣]+)(라운지)", "i"), "$1 $2"));
  }
  return [...variants];
}

function buildNotionQueries(keywords: string, queryContext?: string): string[] {
  const terms = prepareSearchTerms(keywords, queryContext);
  const queries = new Set<string>();

  if (terms.length > 0) {
    queries.add(terms.join(" "));

    if (terms.length >= 2) {
      queries.add(terms.slice(0, 2).join(" "));
    }

    const spacedTerms = terms.flatMap((t) => koreanSpacingVariants(t));
    const spacedJoin = [...new Set(spacedTerms)].join(" ");
    if (spacedJoin !== terms.join(" ")) {
      queries.add(spacedJoin);
    }

    for (const t of terms) {
      for (const v of koreanSpacingVariants(t)) {
        if (v.length >= 2) queries.add(v);
      }
    }
  } else if (keywords.trim()) {
    queries.add(keywords.trim().slice(0, 80));
  }

  return [...queries].slice(0, MAX_NOTION_QUERIES);
}

export function extractWorkserverPathsFromText(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const matches = text.match(WORKSERVER_PATH_RE) ?? [];
  for (const raw of matches) {
    const path = raw.replace(/[.,;:]+$/, "").trim();
    const key = path.toLowerCase();
    if (!path || seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
}

export function extractDatesFromText(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const iso = text.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  for (const d of iso) {
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  const compact = text.match(/(?:^|[^\d])(\d{6})(?=[^\d]|$)/g) ?? [];
  for (const m of compact) {
    const d = m.replace(/[^\d]/g, "");
    if (d.length !== 6 || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

function collectProperNouns(query: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const t = raw.trim();
    if (t.length < 2) return;
    if (DOC_TYPE_RE.test(t)) return;
    const key = normalizeForMatch(t);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  for (const e of matchNamedEntities(query, NAMED_ENTITY_SEED)) {
    if (e.kind === "brand_group") continue;
    push(e.canonical);
    for (const a of e.aliases) push(a);
    for (const p of e.searchPhrases) push(p);
  }
  return out;
}

function hayContainsNoun(hay: string, noun: string): boolean {
  const variants = koreanSpacingVariants(noun);
  const normHay = normalizeForMatch(hay);
  return variants.some((v) => normHay.includes(normalizeForMatch(v)));
}

function queryDocumentTypes(query: string): string[] {
  return [...new Set(query.match(new RegExp(DOC_TYPE_RE, "g")) ?? [])];
}

function isExcludedNotionText(text: string): boolean {
  return EXCLUDE_RE.test(text);
}

function isEditedWithinDays(iso: string | null | undefined, days: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= days * 24 * 60 * 60 * 1000;
}

export function scoreNotionHit(opts: {
  title: string;
  body: string;
  paths: string[];
  lastEditedTime?: string | null;
  properNouns: string[];
  documentTypes: string[];
}): number {
  let score = 0;
  const title = opts.title;
  const body = opts.body;
  if (opts.properNouns.some((n) => hayContainsNoun(title, n))) score += 3;
  if (opts.properNouns.some((n) => hayContainsNoun(body, n))) score += 2;
  if (opts.documentTypes.some((d) => title.includes(d))) score += 2;
  if (opts.paths.length > 0) score += 3;
  if (isEditedWithinDays(opts.lastEditedTime, 30)) score += 1;
  return score;
}

type NotionBlock = {
  type?: string;
  child_page?: { title?: string };
  child_database?: { title?: string };
  [key: string]: unknown;
};

function textFromBlock(block: NotionBlock): string {
  const type = typeof block.type === "string" ? block.type : "";
  if (type === "child_page") {
    return typeof block.child_page?.title === "string" ? block.child_page.title : "";
  }
  if (type === "child_database") {
    return typeof block.child_database?.title === "string"
      ? block.child_database.title
      : "";
  }
  if (!RICH_TEXT_BLOCK_TYPES.has(type)) return "";
  const payload = block[type];
  if (!payload || typeof payload !== "object") return "";
  return plainFromRichText((payload as { rich_text?: unknown }).rich_text);
}

export function flattenNotionBlocks(blocks: NotionBlock[]): string {
  return blocks
    .map((b) => textFromBlock(b))
    .filter(Boolean)
    .join("\n");
}

async function fetchNotionPageBody(
  id: string,
  token: string,
  signal: AbortSignal
): Promise<string | null> {
  const res = await fetch(
    `https://api.notion.com/v1/blocks/${id}/children?page_size=${BODY_PAGE_SIZE}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION
      },
      signal
    }
  );
  if (!res.ok) {
    console.error(
      "[luna/notion] body fail",
      res.status,
      id,
      (await res.text()).slice(0, 200)
    );
    return null;
  }
  const data = (await res.json()) as { results?: NotionBlock[] };
  return flattenNotionBlocks(data.results ?? []);
}

function attachBodyFields(
  source: NotionSource,
  body: string
): NotionSource & { body: string } {
  const hay = `${source.title}\n${body}`;
  if (!body) {
    const titlePaths = extractWorkserverPathsFromText(source.title);
    return {
      ...source,
      body: "",
      ...(titlePaths.length > 0 ? { paths: titlePaths } : {})
    };
  }
  const paths = extractWorkserverPathsFromText(hay);
  const dates = extractDatesFromText(hay);
  const entities = matchNamedEntities(hay, NAMED_ENTITY_SEED)
    .filter((e) => e.kind !== "brand_group")
    .map((e) => e.canonical);
  return {
    ...source,
    body,
    excerpt: body.replace(/\s+/g, " ").trim().slice(0, 280) || null,
    paths,
    dates,
    entities
  };
}

async function enrichSourcesWithBodies(
  sources: NotionSource[],
  token: string
): Promise<Array<NotionSource & { body: string }>> {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), BODY_BUDGET_MS);
  try {
    const results = await Promise.all(
      sources.map(async (source) => {
        if (!source.id) return attachBodyFields(source, "");
        if (ac.signal.aborted) {
          console.log("[luna/notion] body skipped timeout", source.id, source.title);
          return attachBodyFields(source, "");
        }
        try {
          const body = await fetchNotionPageBody(source.id, token, ac.signal);
          if (body === null) return attachBodyFields(source, "");
          return attachBodyFields(source, body);
        } catch (err) {
          const aborted =
            (err instanceof Error && err.name === "AbortError") ||
            ac.signal.aborted;
          console.error(
            "[luna/notion] body",
            aborted ? "timeout" : "error",
            source.id,
            source.title,
            err instanceof Error ? err.message : err
          );
          return attachBodyFields(source, "");
        }
      })
    );
    console.log("[luna/notion] body enrich", {
      pages: sources.length,
      withBody: results.filter((r) => r.body.length > 0).length,
      withPath: results.filter((r) => (r.paths?.length ?? 0) > 0).length,
      ms: Date.now() - started
    });
    return results;
  } finally {
    clearTimeout(timer);
  }
}

type NotionCandidate = NotionSource & { objectType?: string };

function mapNotionResults(results: NotionSearchResult[]): NotionCandidate[] {
  const sources: NotionCandidate[] = [];

  for (const r of results) {
    if (r.object !== "page" && r.object !== "database" && !r.url) continue;

    const url = typeof r.url === "string" ? r.url : "";
    if (!url) continue;

    const id = typeof r.id === "string" ? r.id : "";
    sources.push({
      title: extractTitleFromSearchResult(r),
      url,
      id,
      last_edited_time:
        typeof r.last_edited_time === "string" ? r.last_edited_time : null,
      objectType: typeof r.object === "string" ? r.object : undefined
    });
  }

  return sources;
}

async function enrichCandidateTitles(
  sources: NotionCandidate[],
  token: string
): Promise<NotionCandidate[]> {
  return Promise.all(
    sources.map(async (source) => {
      if (!source.id || !titleMatchesUrlSlug(source.title, source.url)) {
        return source;
      }
      const title = await fetchNotionTitle(source.id, source.objectType, token);
      return title && title !== EMPTY_TITLE ? { ...source, title } : source;
    })
  );
}

function titleHaystack(source: NotionSource): string {
  const slug = extractUrlSlug(source.url);
  const slugText = slug ? slugToDisplayText(slug) : "";
  return `${source.title}\n${slugText}`;
}

function toPublicSource(source: NotionSource): NotionSource {
  return {
    title: source.title,
    url: source.url,
    id: source.id,
    last_edited_time: source.last_edited_time,
    excerpt: source.excerpt,
    paths: source.paths,
    dates: source.dates,
    entities: source.entities
  };
}

function preferNotionSource(a: NotionSource, b: NotionSource): NotionSource {
  const ap = a.paths?.length ?? 0;
  const bp = b.paths?.length ?? 0;
  if (bp !== ap) return bp > ap ? b : a;
  if ((b.excerpt?.length ?? 0) > (a.excerpt?.length ?? 0)) return b;
  return a;
}

export function capNotionDisplaySources(sources: NotionSource[]): NotionSource[] {
  const byKey = new Map<string, NotionSource>();
  for (const s of sources) {
    const key = notionSourceKey(s);
    const existing = byKey.get(key);
    byKey.set(key, existing ? preferNotionSource(existing, s) : s);
  }
  return [...byKey.values()]
    .sort((x, y) => (y.paths?.length ?? 0) - (x.paths?.length ?? 0))
    .slice(0, DISPLAY_LIMIT);
}

async function searchNotionOnce(
  query: string,
  token: string
): Promise<{
  ok: boolean;
  sources: NotionCandidate[];
  httpStatus: number;
  error?: string;
}> {
  const res = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      query: query.trim(),
      page_size: PAGE_SIZE
    })
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(
      "[luna/notion] search",
      res.status,
      query,
      text.slice(0, 300)
    );
    return {
      ok: false,
      sources: [],
      httpStatus: res.status,
      error: text.slice(0, 200)
    };
  }

  const data = (await res.json()) as { results?: NotionSearchResult[] };
  const sources = mapNotionResults(data.results ?? []);
  return { ok: true, sources, httpStatus: res.status };
}

export function mergeNotionSearchOutcomes(
  a: NotionSearchOutcome,
  b: NotionSearchOutcome
): NotionSearchOutcome {
  const combinedSources = capNotionDisplaySources([...a.sources, ...b.sources]);
  const status: NotionSearchStatus =
    combinedSources.length > 0
      ? "ok"
      : a.status === "error" || b.status === "error"
        ? "error"
        : a.status === "empty" || b.status === "empty"
          ? "empty"
          : a.status;

  return {
    status,
    sources: combinedSources,
    queries: [...new Set([...a.queries, ...b.queries])],
    rounds: a.rounds + b.rounds,
    error: b.error ?? a.error,
    httpStatus: b.httpStatus ?? a.httpStatus
  };
}

export function formatNotionSourcesForPrompt(sources: NotionSource[]): string {
  return sources
    .map((s) => {
      const lines = [`- ${s.title} — ${s.url}`];
      for (const p of s.paths ?? []) {
        lines.push(`  기록된 경로: ${p}`);
      }
      if (s.dates?.length) {
        lines.push(`  날짜: ${s.dates.join(", ")}`);
      }
      if (s.excerpt) {
        lines.push(`  본문: ${s.excerpt}`);
      }
      return lines.join("\n");
    })
    .join("\n");
}

export function notionRecordedPaths(sources: NotionSource[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    for (const p of s.paths ?? []) {
      const key = p.replace(/\s+/g, " ").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

export function buildLocationAnswerRules(opts: {
  hasNotionSources: boolean;
  hasNotionPaths: boolean;
}): string {
  const lines = [
    "[답변 규칙]",
    "- 위치를 묻는 질문이면 노션과 Work서버를 따로 나열하지 말고 하나의 답으로 말한다.",
    "- 위에 제공된 검색 결과가 있으면 그것을 근거로 답하세요."
  ];
  if (opts.hasNotionPaths) {
    lines.push(
      "- [노션 검색 결과]의 '기록된 경로'가 1순위다. 사람이 노션에 적어 둔 경로이므로 Work서버 검색보다 정확하다."
    );
    lines.push(
      "- 그 경로를 먼저 제시하고, 근거가 된 노션 페이지 제목과 URL을 함께 단다."
    );
    lines.push(
      "- Work서버 검색 결과는 같은 위치를 보강하거나, 노션 경로가 가리키는 폴더의 실제 파일을 확인할 때만 덧붙인다."
    );
  } else if (opts.hasNotionSources) {
    lines.push(
      "- [노션 검색 결과]가 제공되면 각 페이지 제목과 URL을 답변 본문에 반드시 함께 쓴다."
    );
  }
  lines.push(
    "- 추측 경로 금지. 답에 쓸 수 있는 T:\\ 또는 P:\\ 는 (1) 노션의 '기록된 경로' (2) [Work서버 파일 위치]에 나온 경로 뿐이다."
  );
  lines.push(
    "- 노션·Work서버 둘 다 경로가 없고 페이지도 없으면 반드시 '찾지 못했다'고 명확히 답한다. '기능 준비 중/연동 안 됨' 같은 표현은 금지."
  );
  return lines.join("\n");
}

export async function searchNotionPages(
  keywords: string,
  queryContext?: string
): Promise<NotionSearchOutcome> {
  const token = process.env.NOTION_TOKEN;
  const queries = buildNotionQueries(keywords, queryContext);
  const terms = prepareSearchTerms(keywords, queryContext);
  const queryText = (queryContext?.trim() || keywords).trim();
  const properNouns = collectProperNouns(queryText);
  const documentTypes = queryDocumentTypes(queryText);

  if (!token) {
    console.log("[luna/notion] skipped", {
      reason: "no-token",
      keywords,
      queries
    });
    return {
      status: "skipped",
      sources: [],
      queries,
      rounds: 0,
      error: "no-token"
    };
  }

  if (queries.length === 0) {
    console.log("[luna/notion] skipped", {
      reason: "empty-query",
      keywords
    });
    return { status: "skipped", sources: [], queries: [], rounds: 0 };
  }

  const merged = new Map<
    string,
    NotionCandidate & { score: number; order: number }
  >();
  let rounds = 0;
  let hadError = false;
  let lastHttpStatus: number | undefined;
  let lastError: string | undefined;
  let order = 0;

  for (const q of queries) {
    rounds += 1;
    const result = await searchNotionOnce(q, token);
    console.log("[luna/notion] query", {
      q,
      status: result.httpStatus,
      results: result.sources.length
    });

    if (!result.ok) {
      hadError = true;
      lastHttpStatus = result.httpStatus;
      lastError = result.error;
      continue;
    }

    for (const s of result.sources) {
      if (isExcludedNotionText(s.title)) continue;
      const score = scoreNotionHit({
        title: titleHaystack(s),
        body: "",
        paths: [],
        lastEditedTime: s.last_edited_time,
        properNouns,
        documentTypes
      });
      const key = notionSourceKey(s);
      const existing = merged.get(key);
      if (!existing || existing.score < score) {
        merged.set(key, {
          ...s,
          score,
          order: existing?.order ?? order
        });
        if (!existing) order += 1;
      }
    }
  }

  const candidates = [...merged.values()]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, CANDIDATE_LIMIT);

  const titled = await enrichCandidateTitles(candidates, token);
  const orderByKey = new Map(
    candidates.map((c) => [notionSourceKey(c), c.order] as const)
  );
  const enriched = await enrichSourcesWithBodies(titled, token);

  const sources = enriched
    .map((s, i) => {
      const score = scoreNotionHit({
        title: s.title,
        body: s.body,
        paths: s.paths ?? [],
        lastEditedTime: s.last_edited_time,
        properNouns,
        documentTypes
      });
      return {
        ...s,
        score,
        order: orderByKey.get(notionSourceKey(s)) ?? i
      };
    })
    .filter((s) => {
      if (isExcludedNotionText(`${s.title}\n${s.body}`)) return false;
      if (properNouns.length === 0) return s.score > 0 || s.body.length > 0;
      const hay = `${s.title}\n${s.body}`;
      return properNouns.some((n) => hayContainsNoun(hay, n));
    })
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, DISPLAY_LIMIT)
    .map((s) => toPublicSource(s));

  console.log("[luna/notion] summary", {
    keywords,
    terms,
    properNouns: properNouns.slice(0, 8),
    queries,
    rounds,
    candidates: candidates.length,
    count: sources.length,
    withPath: sources.filter((s) => (s.paths?.length ?? 0) > 0).length,
    hadError
  });

  if (sources.length > 0) {
    return { status: "ok", sources, queries, rounds };
  }
  if (hadError) {
    return {
      status: "error",
      sources: [],
      queries,
      rounds,
      error: lastError,
      httpStatus: lastHttpStatus
    };
  }
  return { status: "empty", sources: [], queries, rounds };
}
