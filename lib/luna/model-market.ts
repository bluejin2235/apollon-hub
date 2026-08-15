import type { SupabaseClient } from "@supabase/supabase-js";

export type MarketModelRow = {
  model_slug: string;
  creator: string | null;
  provider: string | null;
  intelligence_index: number | null;
  /** Free API: artificial_analysis_coding_index (UI 라벨: 코딩) */
  multilingual_index: number | null;
  agentic_index: number | null;
  price_input: number | null;
  price_output: number | null;
  price_blended: number | null;
  price_cache_read: number | null;
  fetched_at: string;
};

const AA_BASE = "https://artificialanalysis.ai/api/v2";

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
): Promise<{ ok: true; json: AaPage } | { ok: false; status: number; body: string }> {
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

/** Free → Pro → legacy 순으로 시도. Free 키가 Pro 경로면 403. */
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
      // 403 on Pro path → try next; 401 is fatal for all
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
  if (typeof o.organization === "string" && o.organization) return o.organization;
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
    (typeof o.name === "string" && o.name) ||
    "";
  if (!slug) return null;

  const creator = parseCreator(o);
  const provider = mapCreatorToProvider(creator);
  const pricing =
    o.pricing && typeof o.pricing === "object"
      ? (o.pricing as Record<string, unknown>)
      : o;
  const evals =
    o.evaluations && typeof o.evaluations === "object"
      ? (o.evaluations as Record<string, unknown>)
      : o;

  const priceIn =
    num(pricing.price_1m_input_tokens) ??
    num(pricing.input) ??
    num(o.price_input);
  const priceOut =
    num(pricing.price_1m_output_tokens) ??
    num(pricing.output) ??
    num(o.price_output);
  const blended =
    num(pricing.price_1m_blended_3_to_1) ??
    num(o.price_blended) ??
    (priceIn != null && priceOut != null
      ? (priceIn * 3 + priceOut) / 4
      : null);

  // Free catalog keys (docs):
  // artificial_analysis_intelligence_index / coding_index / agentic_index
  const intelligence =
    num(evals.artificial_analysis_intelligence_index) ??
    num(evals.intelligence_index) ??
    num(o.intelligence_index) ??
    num(o.quality_index);
  const codingOrMulti =
    num(evals.artificial_analysis_coding_index) ??
    num(evals.multilingual_index) ??
    num(evals.global_mmlu_lite) ??
    num(o.multilingual_index) ??
    num(o.coding_index);
  const agentic =
    num(evals.artificial_analysis_agentic_index) ??
    num(evals.agentic_index) ??
    num(o.agentic_index);

  return {
    model_slug: slug,
    creator,
    provider,
    intelligence_index: intelligence,
    multilingual_index: codingOrMulti,
    agentic_index: agentic,
    price_input: priceIn,
    price_output: priceOut,
    price_blended: blended,
    price_cache_read:
      num(pricing.price_1m_cache_hit_tokens) ??
      num(pricing.price_1m_cache_read) ??
      num(o.price_cache_read),
    fetched_at: fetchedAt
  };
}

/** Artificial Analysis → luna_model_market (상위 15, Claude/GPT/Gemini 우선) */
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
  const rows: MarketModelRow[] = [];
  for (const item of fetched.list) {
    const row = parseMarketItem(item, fetchedAt);
    if (row) rows.push(row);
  }

  // Claude / GPT / Gemini 우선 후 상위 15
  const preferred = rows.filter((r) =>
    ["anthropic", "openai", "google"].includes(r.provider ?? "")
  );
  const rest = rows.filter(
    (r) => !["anthropic", "openai", "google"].includes(r.provider ?? "")
  );
  preferred.sort(
    (a, b) => (b.intelligence_index ?? 0) - (a.intelligence_index ?? 0)
  );
  const top = [...preferred, ...rest].slice(0, 15);

  if (top.length === 0) {
    return {
      ok: false,
      count: 0,
      message: `Artificial Analysis 조회 실패 — 파싱된 모델 없음 (${fetched.endpoint})`
    };
  }

  const { error } = await admin.from("luna_model_market").insert(
    top.map((r) => ({
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
    }))
  );

  if (error) {
    console.error("[luna/market] insert", error);
    return {
      ok: false,
      count: 0,
      message: `Artificial Analysis 조회 실패 — DB 저장 오류: ${error.message}`
    };
  }

  return {
    ok: true,
    count: top.length,
    message: `${top.length}개 캐시 (${fetched.endpoint})`
  };
}

export async function loadLatestMarketSnapshot(
  admin: SupabaseClient
): Promise<{ rows: MarketModelRow[]; fetched_at: string | null }> {
  const { data, error } = await admin
    .from("luna_model_market")
    .select(
      "model_slug, creator, provider, intelligence_index, multilingual_index, agentic_index, price_input, price_output, price_blended, price_cache_read, fetched_at"
    )
    .order("fetched_at", { ascending: false })
    .limit(60);

  if (error) {
    console.error("[luna/market] load", error);
    return { rows: [], fetched_at: null };
  }

  const latest = data?.[0]?.fetched_at as string | undefined;
  if (!latest) return { rows: [], fetched_at: null };

  const rows = (data ?? []).filter((r) => r.fetched_at === latest);
  return { rows: rows as MarketModelRow[], fetched_at: latest };
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
    .select(
      "model_slug, creator, provider, intelligence_index, multilingual_index, agentic_index, price_input, price_output, price_blended, price_cache_read, fetched_at"
    )
    .in("model_slug", modelSlugs)
    .gte("fetched_at", since)
    .order("fetched_at", { ascending: true });
  if (error) {
    console.error("[luna/market] history", error);
    return [];
  }
  return (data ?? []) as MarketModelRow[];
}
