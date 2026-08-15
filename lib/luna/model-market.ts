import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type MarketModelRow = {
  model_slug: string;
  creator: string | null;
  provider: string | null;
  intelligence_index: number | null;
  multilingual_index: number | null;
  agentic_index: number | null;
  price_input: number | null;
  price_output: number | null;
  price_blended: number | null;
  price_cache_read: number | null;
  median_output_tokens_per_second: number | null;
  median_time_to_first_token_seconds: number | null;
  is_reasoning: boolean | null;
  fetched_at: string;
};

const AA_BASE = "https://artificialanalysis.ai/api/v2";

const MARKET_SELECT =
  "model_slug, creator, provider, intelligence_index, multilingual_index, agentic_index, price_input, price_output, price_blended, price_cache_read, median_output_tokens_per_second, median_time_to_first_token_seconds, is_reasoning, fetched_at";

function mapCreatorToProvider(creator: string | null | undefined): string {
  const c = (creator ?? "").toLowerCase();
  if (c.includes("anthropic") || c.includes("claude")) return "anthropic";
  if (c.includes("openai") || c.includes("gpt")) return "openai";
  if (c.includes("google") || c.includes("gemini") || c.includes("deepmind"))
    return "google";
  return creator?.toLowerCase() || "other";
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

function statusReason(status: number): string {
  if (status === 401) return "401 인증 오류";
  if (status === 403) return "403 티어 권한 오류";
  if (status === 404) return "404 경로 오류";
  if (status === 429) return "429 요청 한도 초과";
  return `${status} 오류`;
}

function formatFetchError(status: number, body: string): string {
  return `Artificial Analysis 조회 실패 — ${statusReason(status)}${
    body ? `: ${body.slice(0, 120)}` : ""
  }`;
}

type AaPage = {
  data: unknown[];
  pagination?: {
    page?: number;
    page_size?: number;
    total_pages?: number;
    has_more?: boolean;
  };
};

async function fetchAaPage(
  apiKey: string,
  path: string,
  page: number
): Promise<
  { ok: true; json: AaPage } | { ok: false; status: number; body: string }
> {
  const url = `${AA_BASE}${path}${path.includes("?") ? "&" : "?"}page=${page}`;
  const res = await fetch(url, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(45_000)
  });
  const body = await res.text();
  if (!res.ok) {
    console.error("[luna/market] AA", path, res.status, body.slice(0, 300));
    return { ok: false, status: res.status, body };
  }
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const data = Array.isArray(json.data)
      ? json.data
      : Array.isArray(json.models)
        ? json.models
        : Array.isArray(json)
          ? json
          : [];
    return {
      ok: true,
      json: {
        data,
        pagination:
          json.pagination && typeof json.pagination === "object"
            ? (json.pagination as AaPage["pagination"])
            : undefined
      }
    };
  } catch {
    return { ok: false, status: res.status, body: "JSON 파싱 실패" };
  }
}

async function fetchAllAaModels(
  apiKey: string
): Promise<
  | { ok: true; list: unknown[]; endpoint: string }
  | { ok: false; message: string }
> {
  const endpoints = [
    "/language/models/free",
    "/language/models",
    "/data/llms/models"
  ];

  let lastError = "Artificial Analysis 조회 실패";

  for (const path of endpoints) {
    const first = await fetchAaPage(apiKey, path, 1);
    if (!first.ok) {
      lastError = formatFetchError(first.status, first.body);
      if (first.status === 401) {
        return { ok: false, message: lastError };
      }
      continue;
    }

    const list = [...first.json.data];
    const totalPages = Math.min(
      Number(first.json.pagination?.total_pages) || 1,
      8
    );
    for (let page = 2; page <= totalPages; page++) {
      if (first.json.pagination?.has_more === false && page > 1) break;
      const next = await fetchAaPage(apiKey, path, page);
      if (!next.ok) {
        console.warn("[luna/market] page fail", path, page, next.status);
        break;
      }
      list.push(...next.json.data);
      if (next.json.pagination?.has_more === false) break;
    }

    console.info(
      "[luna/market] AA ok",
      path,
      "models=",
      list.length,
      "pages=",
      totalPages
    );
    return { ok: true, list, endpoint: path };
  }

  return { ok: false, message: lastError };
}

function parseCreator(o: Record<string, unknown>): string | null {
  if (typeof o.creator === "string" && o.creator) return o.creator;
  if (typeof o.organization === "string" && o.organization)
    return o.organization;
  if (typeof o.vendor === "string" && o.vendor) return o.vendor;
  const mc = o.model_creator;
  if (mc && typeof mc === "object") {
    const c = mc as Record<string, unknown>;
    if (typeof c.name === "string" && c.name) return c.name;
    if (typeof c.slug === "string" && c.slug) return c.slug;
    if (typeof c.id === "string" && c.id) return c.id;
  }
  return null;
}

function inferReasoning(
  o: Record<string, unknown>,
  slug: string,
  name: string,
  ttft: number | null
): boolean {
  // Free 티어에는 보통 없음. 있으면 신뢰.
  if (typeof o.reasoning_model === "boolean") return o.reasoning_model;
  if (typeof o.is_reasoning === "boolean") return o.is_reasoning;

  const slugL = slug.toLowerCase();
  const nameL = name.toLowerCase();
  const combined = `${slugL} ${nameL}`;

  // false 를 먼저 (non-reasoning 이 reasoning 부분문자열을 포함)
  if (
    /non[\s_-]?reasoning/.test(combined) ||
    /\bminimal\b/.test(combined) ||
    /(^|-)low(-|$)/.test(slugL)
  ) {
    return false;
  }

  if (
    /(^|[^a-z])reasoning([^a-z]|$)/.test(combined) ||
    /thinking|adaptive/.test(combined) ||
    /(^|-)(high|xhigh|max)(-|$)/.test(slugL) ||
    /(?:^|[^a-z])(o1|o3|o4)(?:[^a-z]|$)/.test(slugL)
  ) {
    return true;
  }

  if (ttft != null && Number.isFinite(ttft) && ttft > 5) return true;
  return false;
}

function parseMarketItem(
  item: unknown,
  fetchedAt: string
): MarketModelRow | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const slug =
    (typeof o.slug === "string" && o.slug) ||
    (typeof o.model_slug === "string" && o.model_slug) ||
    (typeof o.id === "string" && o.id) ||
    "";
  const name = typeof o.name === "string" ? o.name : "";
  if (!slug && !name) return null;
  const modelSlug = slug || name;

  const creator = parseCreator(o);
  const provider = mapCreatorToProvider(creator);
  const pricing =
    o.pricing && typeof o.pricing === "object"
      ? (o.pricing as Record<string, unknown>)
      : {};
  const evals =
    o.evaluations && typeof o.evaluations === "object"
      ? (o.evaluations as Record<string, unknown>)
      : {};
  const perf =
    o.performance && typeof o.performance === "object"
      ? (o.performance as Record<string, unknown>)
      : {};

  const priceIn =
    num(pricing.price_1m_input_tokens) ??
    num(pricing.input) ??
    num(o.price_input);
  const priceOut =
    num(pricing.price_1m_output_tokens) ??
    num(pricing.output) ??
    num(o.price_output);
  // 응답 blended 우선. 없으면 입력 3:출력 1 = 0.75·in + 0.25·out
  const blendedFromApi =
    num(pricing.price_1m_blended_3_to_1) ?? num(o.price_blended);
  const blended =
    blendedFromApi ??
    (priceIn != null && priceOut != null
      ? priceIn * 0.75 + priceOut * 0.25
      : null);

  const intelligence =
    num(evals.artificial_analysis_intelligence_index) ??
    num(evals.intelligence_index) ??
    num(o.intelligence_index) ??
    num(o.quality_index);
  // 다국어: Free 카탈로그에 없음. coding 으로 대체하지 않음.
  const multilingual =
    num(evals.multilingual_index) ??
    num(evals.global_mmlu_lite) ??
    num(evals["global_mmlu"]) ??
    num(o.multilingual_index);
  // Free: artificial_analysis_agentic_index
  const agentic =
    num(evals.artificial_analysis_agentic_index) ??
    num(evals.agentic_index) ??
    num(o.agentic_index);

  const ttft =
    num(perf.median_time_to_first_token_seconds) ??
    num(o.median_time_to_first_token_seconds);
  const tps =
    num(perf.median_output_tokens_per_second) ??
    num(o.median_output_tokens_per_second);

  return {
    model_slug: modelSlug,
    creator,
    provider,
    intelligence_index: intelligence,
    multilingual_index: multilingual,
    agentic_index: agentic,
    price_input: priceIn,
    price_output: priceOut,
    price_blended: blended,
    price_cache_read:
      num(pricing.price_1m_cache_hit_tokens) ??
      num(pricing.price_1m_cache_read) ??
      num(o.price_cache_read),
    median_output_tokens_per_second: tps,
    median_time_to_first_token_seconds: ttft,
    is_reasoning: inferReasoning(o, modelSlug, name, ttft),
    fetched_at: fetchedAt
  };
}

/** 테스트/검증용 — parseMarketItem 래퍼 */
export function parseMarketItemForTest(
  item: unknown,
  fetchedAt: string
): MarketModelRow | null {
  return parseMarketItem(item, fetchedAt);
}

export function isPreferredProvider(
  provider: string | null | undefined
): boolean {
  return ["anthropic", "openai", "google"].includes(
    (provider ?? "").toLowerCase()
  );
}

/** Artificial Analysis → luna_model_market (Claude/GPT/Gemini 전체, 개수 제한 없음) */
export async function fetchAndCacheMarketModels(
  admin: SupabaseClient
): Promise<{ ok: boolean; count: number; message: string }> {
  const apiKey = process.env.LUNA_ARTIFICIAL_ANALYSIS_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      count: 0,
      message:
        "Artificial Analysis 조회 실패 — LUNA_ARTIFICIAL_ANALYSIS_API_KEY 없음"
    };
  }

  const fetched = await fetchAllAaModels(apiKey);
  if (!fetched.ok) {
    return { ok: false, count: 0, message: fetched.message };
  }

  const fetchedAt = new Date().toISOString();
  const preferred: MarketModelRow[] = [];
  let loggedSample = false;
  for (const item of fetched.list) {
    if (!loggedSample && item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const evals =
        o.evaluations && typeof o.evaluations === "object"
          ? (o.evaluations as Record<string, unknown>)
          : {};
      const pricing =
        o.pricing && typeof o.pricing === "object"
          ? (o.pricing as Record<string, unknown>)
          : {};
      const perf =
        o.performance && typeof o.performance === "object"
          ? (o.performance as Record<string, unknown>)
          : {};
      console.info(
        "[luna/market] AA sample field keys",
        JSON.stringify({
          top_keys: Object.keys(o).sort(),
          evaluation_keys: Object.keys(evals).sort(),
          pricing_keys: Object.keys(pricing).sort(),
          performance_keys: Object.keys(perf).sort(),
          has_reasoning_model: "reasoning_model" in o,
          has_is_reasoning: "is_reasoning" in o
        })
      );
      loggedSample = true;
    }
    const row = parseMarketItem(item, fetchedAt);
    if (row && isPreferredProvider(row.provider)) preferred.push(row);
  }

  if (preferred.length === 0) {
    return {
      ok: false,
      count: 0,
      message: `Artificial Analysis 조회 실패 — Claude/GPT/Gemini 모델 없음 (${fetched.endpoint})`
    };
  }

  preferred.sort(
    (a, b) => (b.intelligence_index ?? 0) - (a.intelligence_index ?? 0)
  );

  const withMulti = preferred.filter((r) => r.multilingual_index != null).length;
  const withAgent = preferred.filter((r) => r.agentic_index != null).length;
  console.info(
    `[luna/market] index coverage preferred=${preferred.length} multilingual=${withMulti} agentic=${withAgent}`
  );

  // 대량 insert — 500건 단위 (마이그레이션 전이면 성능 컬럼 제외 재시도)
  const basePayload = preferred.map((r) => ({
    model_slug: r.model_slug,
    creator: r.creator,
    provider: r.provider,
    intelligence_index: r.intelligence_index,
    multilingual_index: r.multilingual_index,
    agentic_index: r.agentic_index,
    price_input: r.price_input,
    price_output: r.price_output,
    price_blended: r.price_blended,
    price_cache_read: r.price_cache_read,
    fetched_at: r.fetched_at
  }));
  const fullPayload = preferred.map((r, i) => ({
    ...basePayload[i]!,
    median_output_tokens_per_second: r.median_output_tokens_per_second,
    median_time_to_first_token_seconds: r.median_time_to_first_token_seconds,
    is_reasoning: r.is_reasoning
  }));

  let useFull = true;
  for (let i = 0; i < preferred.length; i += 500) {
    const chunk = (useFull ? fullPayload : basePayload).slice(i, i + 500);
    const { error } = await admin.from("luna_model_market").insert(chunk);
    if (error) {
      if (
        useFull &&
        /median_|is_reasoning|column/i.test(error.message)
      ) {
        console.warn(
          "[luna/market] perf columns missing — inserting without TTFT/reasoning"
        );
        useFull = false;
        i -= 500;
        continue;
      }
      console.error("[luna/market] insert", error);
      return {
        ok: false,
        count: 0,
        message: `Artificial Analysis 조회 실패 — DB 저장 오류: ${error.message}`
      };
    }
  }

  return {
    ok: true,
    count: preferred.length,
    message: `${preferred.length}개 캐시 (${fetched.endpoint})`
  };
}

export async function loadLatestMarketSnapshot(
  admin: SupabaseClient
): Promise<{ rows: MarketModelRow[]; fetched_at: string | null }> {
  const { data: latestRow, error: latestErr } = await admin
    .from("luna_model_market")
    .select("fetched_at")
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestErr) {
    console.error("[luna/market] load latest", latestErr);
    return { rows: [], fetched_at: null };
  }

  const latest = latestRow?.fetched_at as string | undefined;
  if (!latest) return { rows: [], fetched_at: null };

  const { data, error } = await admin
    .from("luna_model_market")
    .select(MARKET_SELECT)
    .eq("fetched_at", latest)
    .order("intelligence_index", { ascending: false })
    .limit(2000);

  if (error) {
    // 마이그레이션 전: 구 컬럼만
    const legacy = await admin
      .from("luna_model_market")
      .select(
        "model_slug, creator, provider, intelligence_index, multilingual_index, agentic_index, price_input, price_output, price_blended, price_cache_read, fetched_at"
      )
      .eq("fetched_at", latest)
      .order("intelligence_index", { ascending: false })
      .limit(2000);
    if (legacy.error) {
      console.error("[luna/market] load", error, legacy.error);
      return { rows: [], fetched_at: null };
    }
    return {
      rows: (legacy.data ?? []).map((r) => ({
        ...r,
        median_output_tokens_per_second: null,
        median_time_to_first_token_seconds: null,
        is_reasoning: null
      })) as MarketModelRow[],
      fetched_at: latest
    };
  }

  return { rows: (data ?? []) as MarketModelRow[], fetched_at: latest };
}

export async function loadMarketHistory(
  admin: SupabaseClient,
  modelSlugs: string[],
  weeks = 12
): Promise<MarketModelRow[]> {
  if (modelSlugs.length === 0) return [];
  const since = new Date(
    Date.now() - weeks * 7 * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data, error } = await admin
    .from("luna_model_market")
    .select(MARKET_SELECT)
    .in("model_slug", modelSlugs)
    .gte("fetched_at", since)
    .order("fetched_at", { ascending: true });
  if (error) {
    console.error("[luna/market] history", error);
    return [];
  }
  return (data ?? []) as MarketModelRow[];
}
