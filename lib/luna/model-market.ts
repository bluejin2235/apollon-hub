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
  fetched_at: string;
};

function mapCreatorToProvider(creator: string | null | undefined): string {
  const c = (creator ?? "").toLowerCase();
  if (c.includes("anthropic") || c.includes("claude")) return "anthropic";
  if (c.includes("openai") || c.includes("gpt")) return "openai";
  if (c.includes("google") || c.includes("gemini")) return "google";
  return creator?.toLowerCase() || "other";
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

/** Artificial Analysis → luna_model_market (상위 15, Claude/GPT/Gemini 우선) */
export async function fetchAndCacheMarketModels(
  admin: SupabaseClient
): Promise<{ ok: boolean; count: number; message: string }> {
  const apiKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      count: 0,
      message: "ARTIFICIAL_ANALYSIS_API_KEY 없음"
    };
  }

  const res = await fetch(
    "https://artificialanalysis.ai/api/v2/language/models",
    {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(30_000)
    }
  );
  if (!res.ok) {
    const body = await res.text();
    return {
      ok: false,
      count: 0,
      message: `AA API ${res.status}: ${body.slice(0, 200)}`
    };
  }

  const json = (await res.json()) as unknown;
  const list: unknown[] = Array.isArray(json)
    ? json
    : json &&
        typeof json === "object" &&
        Array.isArray((json as { data?: unknown }).data)
      ? ((json as { data: unknown[] }).data)
      : json &&
          typeof json === "object" &&
          Array.isArray((json as { models?: unknown }).models)
        ? ((json as { models: unknown[] }).models)
        : [];

  const fetchedAt = new Date().toISOString();
  const rows: MarketModelRow[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const slug =
      (typeof o.slug === "string" && o.slug) ||
      (typeof o.model_slug === "string" && o.model_slug) ||
      (typeof o.id === "string" && o.id) ||
      (typeof o.name === "string" && o.name) ||
      "";
    if (!slug) continue;

    const creator =
      (typeof o.creator === "string" && o.creator) ||
      (typeof o.organization === "string" && o.organization) ||
      (typeof o.vendor === "string" && o.vendor) ||
      null;
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

    rows.push({
      model_slug: slug,
      creator,
      provider,
      intelligence_index:
        num(evals.intelligence_index) ??
        num(o.intelligence_index) ??
        num(o.quality_index),
      multilingual_index:
        num(evals.multilingual_index) ?? num(o.multilingual_index),
      agentic_index: num(evals.agentic_index) ?? num(o.agentic_index),
      price_input: priceIn,
      price_output: priceOut,
      price_blended: blended,
      price_cache_read:
        num(pricing.price_1m_cache_read) ?? num(o.price_cache_read),
      fetched_at: fetchedAt
    });
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
    return { ok: false, count: 0, message: "파싱된 모델 없음" };
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
    return { ok: false, count: 0, message: error.message };
  }

  return { ok: true, count: top.length, message: `${top.length}개 캐시` };
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
