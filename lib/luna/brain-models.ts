export type LunaTier = "S" | "A" | "B" | "C";

export type LunaModelOption = {
  provider: "anthropic" | "openai" | "google";
  model_id: string;
  model_label: string;
};

/**
 * 모델 지정 드롭다운에 쓰는 목록.
 * luna_engine_tiers 는 자유 문자열이라 선택지를 코드 상수로 고정한다.
 */
export const LUNA_MODEL_OPTIONS: LunaModelOption[] = [
  {
    provider: "anthropic",
    model_id: "claude-opus-4-6",
    model_label: "Claude Opus 4.6"
  },
  {
    provider: "anthropic",
    model_id: "claude-sonnet-4-6",
    model_label: "Claude Sonnet 4.6"
  },
  {
    provider: "anthropic",
    model_id: "claude-haiku-4-5-20251001",
    model_label: "Claude Haiku 4.5"
  },
  {
    provider: "anthropic",
    model_id: "claude-haiku-4-5",
    model_label: "Claude Haiku 4.5"
  },
  {
    provider: "openai",
    model_id: "gpt-5",
    model_label: "GPT-5"
  },
  {
    provider: "openai",
    model_id: "gpt-5-mini",
    model_label: "gpt-5-mini"
  },
  {
    provider: "openai",
    model_id: "gpt-4o",
    model_label: "GPT-4o"
  },
  {
    provider: "openai",
    model_id: "gpt-4o-mini",
    model_label: "GPT-4o mini"
  },
  {
    provider: "google",
    model_id: "gemini-2.5-pro",
    model_label: "Gemini 2.5 Pro"
  },
  {
    provider: "google",
    model_id: "gemini-2.5-flash",
    model_label: "Gemini 2.5 Flash"
  },
  {
    provider: "google",
    model_id: "gemini-2.0-flash",
    model_label: "Gemini 2.0 Flash"
  }
];

export type LunaTierMeta = {
  tier: LunaTier;
  name: string;
  desc: string;
};

export const LUNA_TIER_META: LunaTierMeta[] = [
  {
    tier: "S",
    name: "자기개선",
    desc: "프롬프트를 스스로 고치는 일 · 주 1회 · 실수하면 안 됨"
  },
  {
    tier: "A",
    name: "사람이 읽는 결과물",
    desc: "채팅 답변 · 후보 문답 · 주간 보고"
  },
  {
    tier: "B",
    name: "기계가 쓰는 실시간 판정",
    desc: "되묻기 판정 · 검색어 정제 · 대화 제목"
  },
  {
    tier: "C",
    name: "배치 · 사람 검토를 거침",
    desc: "배움 포착 · 자습 · 회귀 채점 · 기억 정리 · 용어 윤문"
  }
];

export const LUNA_TIER_ORDER: LunaTier[] = ["S", "A", "B", "C"];

export type LunaUsageFeature =
  | "chat_answer"
  | "candidate_dialogue"
  | "weekly_report"
  | "understand"
  | "search_terms"
  | "title"
  | "selfstudy"
  | "learn_capture"
  | "eval_grade"
  | "consolidate"
  | "glossary_polish"
  | "self_upgrade";

export const LUNA_FEATURE_LABEL: Record<LunaUsageFeature, string> = {
  chat_answer: "채팅 답변",
  candidate_dialogue: "후보 문답",
  weekly_report: "주간 보고",
  understand: "되묻기 판정",
  search_terms: "검색어 정제",
  title: "대화 제목",
  selfstudy: "자습",
  learn_capture: "배움 포착",
  eval_grade: "회귀 채점",
  consolidate: "기억 정리",
  glossary_polish: "용어 윤문",
  self_upgrade: "자기개선"
};

export type LunaUsageAlerts = {
  daily_limit: number;
  monthly_limit: number;
  spike_percent: number;
};

export const LUNA_USAGE_ALERTS_KEY = "usage_alerts";
export const LUNA_MODEL_COST_SETTINGS_KEY = "model_cost_settings";

export const LUNA_USAGE_ALERTS_DEFAULT: LunaUsageAlerts = {
  daily_limit: 3000,
  monthly_limit: 60_000,
  spike_percent: 200
};

export type LunaCostMode = "cheap" | "balanced" | "performance";

export type LunaModelCostSettings = {
  auto_swap: boolean;
  revert_on_drop: boolean;
  protect_s: boolean;
  last_inspect_at: string | null;
  next_inspect_at: string | null;
  /** Artificial Analysis 마지막 실패 사유 (성공 시 null) */
  last_market_error: string | null;
  /** cheap | balanced | performance */
  mode: LunaCostMode;
};

export const LUNA_MODEL_COST_SETTINGS_DEFAULT: LunaModelCostSettings = {
  auto_swap: true,
  revert_on_drop: true,
  protect_s: true,
  last_inspect_at: null,
  next_inspect_at: null,
  last_market_error: null,
  mode: "balanced"
};

export const LUNA_COST_MODE_META: Record<
  LunaCostMode,
  { label: string; desc: string }
> = {
  cheap: {
    label: "가격 우선",
    desc: "가장 저렴하게. 품질은 최소 기준만"
  },
  balanced: {
    label: "가성비",
    desc: "성능 대비 비용이 가장 좋은 선택"
  },
  performance: {
    label: "성능 우선",
    desc: "비용보다 품질. 지연 조건은 지킴"
  }
};

export function normalizeUsageAlerts(raw: unknown): LunaUsageAlerts {
  const value =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const pick = (key: keyof LunaUsageAlerts, min: number, max: number) => {
    const n = Number(value[key]);
    if (!Number.isFinite(n)) return LUNA_USAGE_ALERTS_DEFAULT[key];
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  return {
    daily_limit: pick("daily_limit", 0, 1_000_000_000),
    monthly_limit: pick("monthly_limit", 0, 10_000_000_000),
    spike_percent: pick("spike_percent", 0, 100_000)
  };
}

export function normalizeModelCostSettings(raw: unknown): LunaModelCostSettings {
  const value =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const modeRaw = value.mode;
  const mode: LunaCostMode =
    modeRaw === "cheap" || modeRaw === "balanced" || modeRaw === "performance"
      ? modeRaw
      : LUNA_MODEL_COST_SETTINGS_DEFAULT.mode;
  return {
    auto_swap:
      typeof value.auto_swap === "boolean"
        ? value.auto_swap
        : LUNA_MODEL_COST_SETTINGS_DEFAULT.auto_swap,
    revert_on_drop:
      typeof value.revert_on_drop === "boolean"
        ? value.revert_on_drop
        : LUNA_MODEL_COST_SETTINGS_DEFAULT.revert_on_drop,
    protect_s:
      typeof value.protect_s === "boolean"
        ? value.protect_s
        : LUNA_MODEL_COST_SETTINGS_DEFAULT.protect_s,
    last_inspect_at:
      typeof value.last_inspect_at === "string" ? value.last_inspect_at : null,
    next_inspect_at:
      typeof value.next_inspect_at === "string" ? value.next_inspect_at : null,
    last_market_error:
      typeof value.last_market_error === "string"
        ? value.last_market_error
        : null,
    mode
  };
}

export function providerConnectedFlags(): {
  anthropic: boolean;
  openai: boolean;
  google: boolean;
} {
  return {
    anthropic: Boolean(process.env.hubtrendchat_claude?.trim()),
    openai: Boolean(process.env.LUNA_OPENAI_API_KEY?.trim()),
    google: Boolean(process.env.LUNA_GOOGLE_API_KEY?.trim())
  };
}
