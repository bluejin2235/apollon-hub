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
    model_id: "claude-haiku-4-5",
    model_label: "Claude Haiku 4.5"
  }
];

export type LunaTierMeta = {
  tier: "A" | "B" | "C";
  name: string;
  desc: string;
};

export const LUNA_TIER_META: LunaTierMeta[] = [
  { tier: "A", name: "답변·판단", desc: "대화 응답, 자료 찾기, 후보 문답" },
  { tier: "B", name: "분류·추출", desc: "배움 포착, 관련성 판단, 요약" },
  { tier: "C", name: "자습·배치", desc: "야간 자습, 자기개선, 주간 보고" }
];

export type LunaUsageAlerts = {
  daily_limit: number;
  monthly_limit: number;
  spike_percent: number;
};

export const LUNA_USAGE_ALERTS_KEY = "usage_alerts";

export const LUNA_USAGE_ALERTS_DEFAULT: LunaUsageAlerts = {
  daily_limit: 400_000,
  monthly_limit: 10_000_000,
  spike_percent: 200
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
