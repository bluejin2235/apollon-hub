import type { SupabaseClient } from "@supabase/supabase-js";

export type LunaTier = "A" | "B" | "C";

export type LunaTierModel = {
  tier: LunaTier;
  provider: string;
  model_id: string;
  model_label: string;
  use_caching: boolean;
  use_batch: boolean;
  note: string | null;
};

const FALLBACK: Pick<LunaTierModel, "model_id" | "model_label" | "provider"> = {
  model_id: "claude-sonnet-4-6",
  model_label: "Claude Sonnet 4.6",
  provider: "anthropic"
};

export async function getTierModel(
  admin: SupabaseClient,
  tier: LunaTier
): Promise<LunaTierModel> {
  try {
    const { data, error } = await admin
      .from("luna_engine_tiers")
      .select(
        "tier, provider, model_id, model_label, use_caching, use_batch, note"
      )
      .eq("tier", tier)
      .maybeSingle();

    if (error) {
      console.error("[luna/engine] getTierModel", tier, error);
      return {
        tier,
        provider: FALLBACK.provider,
        model_id: FALLBACK.model_id,
        model_label: FALLBACK.model_label,
        use_caching: false,
        use_batch: false,
        note: null
      };
    }

    return {
      tier,
      provider:
        typeof data?.provider === "string" && data.provider.trim()
          ? data.provider.trim()
          : FALLBACK.provider,
      model_id:
        typeof data?.model_id === "string" && data.model_id.trim()
          ? data.model_id.trim()
          : FALLBACK.model_id,
      model_label:
        typeof data?.model_label === "string" && data.model_label.trim()
          ? data.model_label.trim()
          : FALLBACK.model_label,
      use_caching: data?.use_caching === true,
      use_batch: data?.use_batch === true,
      note: typeof data?.note === "string" ? data.note : null
    };
  } catch (err) {
    console.error("[luna/engine] getTierModel", tier, err);
    return {
      tier,
      provider: FALLBACK.provider,
      model_id: FALLBACK.model_id,
      model_label: FALLBACK.model_label,
      use_caching: false,
      use_batch: false,
      note: null
    };
  }
}

/** OpenAI/Gemini 분기는 미구현 — anthropic 외에는 fallback 모델 사용. */
export function resolveAnthropicModel(tier: LunaTierModel): {
  model_id: string;
  model_label: string;
} {
  if (tier.provider !== "anthropic") {
    console.warn(
      `[luna/engine] provider "${tier.provider}" not implemented; falling back to anthropic`
    );
    return {
      model_id: FALLBACK.model_id,
      model_label: FALLBACK.model_label
    };
  }
  return { model_id: tier.model_id, model_label: tier.model_label };
}

export type LunaUsageTokens = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

export function emptyUsage(): LunaUsageTokens {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0
  };
}

export function readUsage(raw: unknown): LunaUsageTokens {
  const u = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    input_tokens: typeof u.input_tokens === "number" ? u.input_tokens : 0,
    output_tokens: typeof u.output_tokens === "number" ? u.output_tokens : 0,
    cache_creation_input_tokens:
      typeof u.cache_creation_input_tokens === "number"
        ? u.cache_creation_input_tokens
        : 0,
    cache_read_input_tokens:
      typeof u.cache_read_input_tokens === "number" ? u.cache_read_input_tokens : 0
  };
}

/** fire-and-forget 일별 사용량 집계. 실패해도 throw 하지 않음. */
export function bumpUsageDaily(
  admin: SupabaseClient,
  opts: {
    tier: string;
    model_id: string;
    usage: LunaUsageTokens;
  }
): void {
  const today = new Date().toISOString().slice(0, 10);
  void (async () => {
    try {
      const { error } = await admin.rpc("luna_bump_usage", {
        p_date: today,
        p_tier: opts.tier,
        p_model_id: opts.model_id,
        p_in: opts.usage.input_tokens,
        p_out: opts.usage.output_tokens,
        p_cw: opts.usage.cache_creation_input_tokens,
        p_cr: opts.usage.cache_read_input_tokens
      });
      if (error) console.error("[luna/engine] bumpUsageDaily", error);
    } catch (err) {
      console.error("[luna/engine] bumpUsageDaily", err);
    }
  })();
}
