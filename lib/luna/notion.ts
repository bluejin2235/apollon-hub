import { prepareSearchTerms } from "@/lib/luna/workserver";

export type NotionSource = {
  title: string;
  url: string;
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
  url?: string;
  properties?: Record<string, unknown>;
};

const MAX_NOTION_QUERIES = 6;
const PAGE_SIZE = 10;
const MAX_RESULTS = 5;

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
  const props = result.properties;
  if (!props || typeof props !== "object") return "Untitled";

  for (const value of Object.values(props)) {
    if (!value || typeof value !== "object") continue;
    const prop = value as { type?: string; title?: unknown; name?: unknown };
    if (prop.type === "title") {
      const text = plainFromRichText(prop.title);
      if (text) return text;
    }
  }

  for (const value of Object.values(props)) {
    if (!value || typeof value !== "object") continue;
    const prop = value as { title?: unknown };
    if ("title" in prop) {
      const text = plainFromRichText(prop.title);
      if (text) return text;
    }
  }

  return "Untitled";
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

function mapNotionResults(results: NotionSearchResult[]): NotionSource[] {
  return results
    .filter((r) => r.object === "page" || Boolean(r.url))
    .map((r) => ({
      title: extractNotionPageTitle(r),
      url: typeof r.url === "string" ? r.url : ""
    }))
    .filter((s) => Boolean(s.url));
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
  const sources = mapNotionResults(data.results ?? []);
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
      const existing = merged.get(s.url);
      if (!existing || existing.score < score) {
        merged.set(s.url, { ...s, score });
      }
    }

    if (merged.size >= MAX_RESULTS * 2) break;
  }

  const sources = [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map(({ title, url }) => ({ title, url }));

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
