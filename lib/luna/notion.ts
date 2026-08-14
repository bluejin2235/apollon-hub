import { prepareSearchTerms } from "@/lib/luna/workserver";

export type NotionSource = {
  title: string;
  url: string;
  id: string;
  last_edited_time?: string | null;
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
const PAGE_SIZE = 10;
const MAX_RESULTS = 5;
const EMPTY_TITLE = "(제목 없음)";

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
      "Notion-Version": "2022-06-28"
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

function scoreNotionSource(title: string, terms: string[]): number {
  const norm = normalizeForMatch(title);
  if (terms.length === 0) return 0;

  let score = 0;
  for (const term of terms) {
    const variants = koreanSpacingVariants(term);
    if (variants.some((v) => norm.includes(normalizeForMatch(v)))) {
      score += 2;
    }
  }
  return score;
}

async function mapNotionResults(
  results: NotionSearchResult[],
  token: string
): Promise<NotionSource[]> {
  const sources: NotionSource[] = [];

  for (const r of results) {
    if (r.object !== "page" && r.object !== "database" && !r.url) continue;

    const url = typeof r.url === "string" ? r.url : "";
    if (!url) continue;

    const id = typeof r.id === "string" ? r.id : "";
    let title = extractTitleFromSearchResult(r);

    if (titleMatchesUrlSlug(title, url) && id) {
      title = await fetchNotionTitle(id, r.object, token);
    }

    sources.push({
      title,
      url,
      id,
      last_edited_time:
        typeof r.last_edited_time === "string" ? r.last_edited_time : null
    });
  }

  return sources;
}

async function searchNotionOnce(
  query: string,
  token: string
): Promise<{
  ok: boolean;
  sources: NotionSource[];
  httpStatus: number;
  error?: string;
}> {
  const res = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
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
  const sources = await mapNotionResults(data.results ?? [], token);
  return { ok: true, sources, httpStatus: res.status };
}

export function mergeNotionSearchOutcomes(
  a: NotionSearchOutcome,
  b: NotionSearchOutcome
): NotionSearchOutcome {
  const combinedSources = [...a.sources, ...b.sources];
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

export async function searchNotionPages(
  keywords: string,
  queryContext?: string
): Promise<NotionSearchOutcome> {
  const token = process.env.NOTION_TOKEN;
  const queries = buildNotionQueries(keywords, queryContext);
  const terms = prepareSearchTerms(keywords, queryContext);

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

  const merged = new Map<string, NotionSource & { score: number }>();
  let rounds = 0;
  let hadError = false;
  let lastHttpStatus: number | undefined;
  let lastError: string | undefined;

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

    const rankTerms = terms.length > 0 ? terms : q.split(/\s+/).filter(Boolean);
    for (const s of result.sources) {
      const score = scoreNotionSource(s.title, rankTerms);
      const key = notionSourceKey(s);
      const existing = merged.get(key);
      if (!existing || existing.score < score) {
        merged.set(key, { ...s, score });
      }
    }

    if (merged.size >= MAX_RESULTS * 2) break;
  }

  const sources = [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map(({ title, url, id, last_edited_time }) => ({
      title,
      url,
      id,
      last_edited_time
    }));

  console.log("[luna/notion] summary", {
    keywords,
    terms,
    queries,
    rounds,
    count: sources.length,
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
