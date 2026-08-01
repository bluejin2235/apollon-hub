import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";

export const runtime = "nodejs";

const TIER_SELECT =
  "tier, provider, model_id, model_label, use_caching, use_batch, note, updated_at";

function envConnected(): Record<string, boolean> {
  return {
    anthropic: Boolean(process.env.hubtrendchat_claude?.trim()),
    openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
    gemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
    tavily: Boolean(process.env.TAVILY_API_KEY?.trim()),
    notion: Boolean(process.env.NOTION_TOKEN?.trim())
  };
}

function monthRange(now = new Date()): { start: string; end: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const start = new Date(y, m, 1);
  const end = new Date(y, m + 1, 0);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: tiers, error: tierError } = await admin
    .from("luna_engine_tiers")
    .select(TIER_SELECT)
    .order("tier", { ascending: true });

  if (tierError) {
    console.error("[luna/engine] GET tiers", tierError);
    return NextResponse.json({ error: tierError.message }, { status: 500 });
  }

  const { start, end } = monthRange();
  const { data: usageRows, error: usageError } = await admin
    .from("luna_usage_daily")
    .select(
      "date, tier, model_id, calls, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens"
    )
    .gte("date", start)
    .lte("date", end);

  if (usageError) {
    console.error("[luna/engine] GET usage", usageError);
    return NextResponse.json({ error: usageError.message }, { status: 500 });
  }

  let totalCalls = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  const byKey = new Map<
    string,
    {
      tier: string;
      model_id: string;
      calls: number;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
    }
  >();

  for (const row of usageRows ?? []) {
    const calls = Number(row.calls) || 0;
    const input = Number(row.input_tokens) || 0;
    const output = Number(row.output_tokens) || 0;
    const cacheRead = Number(row.cache_read_tokens) || 0;
    totalCalls += calls;
    totalInput += input;
    totalOutput += output;
    totalCacheRead += cacheRead;
    const key = `${row.tier}::${row.model_id}`;
    const prev = byKey.get(key) ?? {
      tier: String(row.tier),
      model_id: String(row.model_id),
      calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0
    };
    prev.calls += calls;
    prev.input_tokens += input;
    prev.output_tokens += output;
    prev.cache_read_tokens += cacheRead;
    byKey.set(key, prev);
  }

  const cachePct =
    totalInput > 0 ? Math.round((totalCacheRead / totalInput) * 1000) / 10 : 0;

  return NextResponse.json({
    connections: envConnected(),
    tiers: tiers ?? [],
    usage: {
      total_calls: totalCalls,
      total_input_tokens: totalInput,
      total_output_tokens: totalOutput,
      cache_read_tokens: totalCacheRead,
      cache_read_pct: cachePct,
      by_tier: Array.from(byKey.values()).sort((a, b) =>
        a.tier.localeCompare(b.tier)
      )
    }
  });
}

export async function PATCH(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    tier?: string;
    provider?: string;
    model_id?: string;
    model_label?: string;
    use_caching?: boolean;
    use_batch?: boolean;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tier = typeof body.tier === "string" ? body.tier.trim().toUpperCase() : "";
  if (tier !== "A" && tier !== "B" && tier !== "C") {
    return NextResponse.json({ error: "invalid tier" }, { status: 400 });
  }

  const provider =
    typeof body.provider === "string" ? body.provider.trim().toLowerCase() : "";
  if (provider !== "anthropic" && provider !== "openai" && provider !== "google") {
    return NextResponse.json({ error: "invalid provider" }, { status: 400 });
  }

  const model_id = typeof body.model_id === "string" ? body.model_id.trim() : "";
  const model_label =
    typeof body.model_label === "string" ? body.model_label.trim() : "";
  if (!model_id || !model_label) {
    return NextResponse.json(
      { error: "model_id and model_label are required" },
      { status: 400 }
    );
  }

  const { data, error } = await admin
    .from("luna_engine_tiers")
    .update({
      provider,
      model_id,
      model_label,
      use_caching: body.use_caching === true,
      use_batch: body.use_batch === true,
      updated_at: new Date().toISOString()
    })
    .eq("tier", tier)
    .select(TIER_SELECT)
    .maybeSingle();

  if (error) {
    console.error("[luna/engine] PATCH", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ tier: data });
}
