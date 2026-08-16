import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LunaTier, LunaUsageFeature } from "@/lib/luna/brain-models";

export type { LunaTier } from "@/lib/luna/brain-models";

export type LunaTierModel = {
  tier: LunaTier;
  provider: string;
  model_id: string;
  model_label: string;
  use_caching: boolean;
  use_batch: boolean;
  note: string | null;
};

export type ResolvedProviderModel = {
  provider: "anthropic" | "openai" | "google";
  model_id: string;
  model_label: string;
  fallback_from?: string;
};

const FALLBACK: Pick<LunaTierModel, "model_id" | "model_label" | "provider"> = {
  model_id: "claude-sonnet-4-6",
  model_label: "Claude Sonnet 4.6",
  provider: "anthropic"
};

function hasProviderKey(provider: string): boolean {
  if (provider === "anthropic") {
    return Boolean(process.env.hubtrendchat_claude?.trim());
  }
  if (provider === "openai") {
    return Boolean(process.env.LUNA_OPENAI_API_KEY?.trim());
  }
  if (provider === "google") {
    return Boolean(process.env.LUNA_GOOGLE_API_KEY?.trim());
  }
  return false;
}

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
        use_caching: tier === "A" || tier === "C",
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
      use_caching:
        data == null ? tier === "A" || tier === "C" : data.use_caching === true,
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
      use_caching: tier === "A" || tier === "C",
      use_batch: false,
      note: null
    };
  }
}

/**
 * 공급사 키 없으면 anthropic 으로 폴백하고 로그.
 * (예전 resolveAnthropicModel 의 무조건 anthropic 폴백을 대체)
 */
export function resolveProviderModel(
  tier: LunaTierModel
): ResolvedProviderModel {
  const raw = (tier.provider || "anthropic").toLowerCase().trim();
  const provider =
    raw === "openai" || raw === "google" || raw === "anthropic"
      ? raw
      : "anthropic";

  if (!hasProviderKey(provider)) {
    if (provider !== "anthropic") {
      console.warn(
        `[luna/engine] provider "${provider}" key missing; falling back to anthropic`
      );
    }
    if (!hasProviderKey("anthropic")) {
      console.error("[luna/engine] anthropic key also missing");
    }
    return {
      provider: "anthropic",
      model_id:
        provider === "anthropic" ? tier.model_id : FALLBACK.model_id,
      model_label:
        provider === "anthropic" ? tier.model_label : FALLBACK.model_label,
      fallback_from: provider !== "anthropic" ? provider : undefined
    };
  }

  return {
    provider,
    model_id: tier.model_id,
    model_label: tier.model_label
  };
}

/** @deprecated 호환용 — resolveProviderModel 사용 */
export function resolveAnthropicModel(tier: LunaTierModel): {
  model_id: string;
  model_label: string;
} {
  const resolved = resolveProviderModel(tier);
  return { model_id: resolved.model_id, model_label: resolved.model_label };
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
  const creationObj =
    u.cache_creation && typeof u.cache_creation === "object"
      ? (u.cache_creation as Record<string, unknown>)
      : null;
  const creationFromObj =
    (typeof creationObj?.ephemeral_5m_input_tokens === "number"
      ? creationObj.ephemeral_5m_input_tokens
      : 0) +
    (typeof creationObj?.ephemeral_1h_input_tokens === "number"
      ? creationObj.ephemeral_1h_input_tokens
      : 0);
  const cacheWrite =
    typeof u.cache_creation_input_tokens === "number"
      ? u.cache_creation_input_tokens
      : creationFromObj;
  return {
    input_tokens: typeof u.input_tokens === "number" ? u.input_tokens : 0,
    output_tokens: typeof u.output_tokens === "number" ? u.output_tokens : 0,
    cache_creation_input_tokens: cacheWrite,
    cache_read_input_tokens:
      typeof u.cache_read_input_tokens === "number"
        ? u.cache_read_input_tokens
        : 0
  };
}

export function readOpenAiUsage(raw: unknown): LunaUsageTokens {
  const u = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const prompt = typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0;
  const details =
    u.prompt_tokens_details && typeof u.prompt_tokens_details === "object"
      ? (u.prompt_tokens_details as Record<string, unknown>)
      : {};
  const cached = typeof details.cached_tokens === "number" ? details.cached_tokens : 0;
  return {
    input_tokens: Math.max(0, prompt - cached),
    output_tokens: typeof u.completion_tokens === "number" ? u.completion_tokens : 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached
  };
}

export function readGeminiUsage(raw: unknown): LunaUsageTokens {
  const u = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const prompt = typeof u.promptTokenCount === "number" ? u.promptTokenCount : 0;
  const cached =
    typeof u.cachedContentTokenCount === "number" ? u.cachedContentTokenCount : 0;
  return {
    input_tokens: Math.max(0, prompt - cached),
    output_tokens:
      typeof u.candidatesTokenCount === "number" ? u.candidatesTokenCount : 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached
  };
}

/** fire-and-forget 일별 사용량 집계. 실패해도 throw 하지 않음. */
export function bumpUsageDaily(
  admin: SupabaseClient,
  opts: {
    tier: string;
    model_id: string;
    usage: LunaUsageTokens;
    feature?: LunaUsageFeature | string | null;
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
        p_cr: opts.usage.cache_read_input_tokens,
        p_feature: opts.feature ?? null
      });
      if (error) {
        // feature 인자 없는 구버전 RPC 폴백
        const { error: err2 } = await admin.rpc("luna_bump_usage", {
          p_date: today,
          p_tier: opts.tier,
          p_model_id: opts.model_id,
          p_in: opts.usage.input_tokens,
          p_out: opts.usage.output_tokens,
          p_cw: opts.usage.cache_creation_input_tokens,
          p_cr: opts.usage.cache_read_input_tokens
        });
        if (err2) console.error("[luna/engine] bumpUsageDaily", err2);
      }
    } catch (err) {
      console.error("[luna/engine] bumpUsageDaily", err);
    }
  })();
}
