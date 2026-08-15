/** 공급사 공식 단가 (USD / 1M tokens). 시장 스냅샷이 없을 때 비용 추정용. */

export type OfficialModelPrice = {
  input: number;
  output: number;
  /** cache hit / read */
  cache_read?: number;
};

/**
 * model_id 부분 문자열 매칭용. 긴 키를 먼저 검사한다.
 * 출처: Anthropic / OpenAI / Google 공개 가격표 (2025–2026).
 */
const OFFICIAL_PRICES: Array<{ match: string; price: OfficialModelPrice }> = [
  // Anthropic
  { match: "claude-opus-4", price: { input: 15, output: 75, cache_read: 1.5 } },
  { match: "claude-sonnet-4", price: { input: 3, output: 15, cache_read: 0.3 } },
  { match: "claude-haiku-4-5", price: { input: 1, output: 5, cache_read: 0.1 } },
  { match: "claude-3-5-haiku", price: { input: 0.8, output: 4, cache_read: 0.08 } },
  { match: "claude-3-5-sonnet", price: { input: 3, output: 15, cache_read: 0.3 } },
  { match: "claude-3-opus", price: { input: 15, output: 75, cache_read: 1.5 } },
  { match: "claude-3-haiku", price: { input: 0.25, output: 1.25, cache_read: 0.03 } },
  // OpenAI
  { match: "gpt-5.6-luna", price: { input: 0.35, output: 0.75, cache_read: 0.035 } },
  { match: "gpt-5-mini", price: { input: 0.25, output: 2, cache_read: 0.025 } },
  { match: "gpt-5-nano", price: { input: 0.05, output: 0.4, cache_read: 0.005 } },
  { match: "gpt-5", price: { input: 1.25, output: 10, cache_read: 0.125 } },
  { match: "gpt-4.1-mini", price: { input: 0.4, output: 1.6, cache_read: 0.1 } },
  { match: "gpt-4.1-nano", price: { input: 0.1, output: 0.4, cache_read: 0.025 } },
  { match: "gpt-4.1", price: { input: 2, output: 8, cache_read: 0.5 } },
  { match: "gpt-4o-mini", price: { input: 0.15, output: 0.6, cache_read: 0.075 } },
  { match: "gpt-4o", price: { input: 2.5, output: 10, cache_read: 1.25 } },
  { match: "o3-mini", price: { input: 1.1, output: 4.4, cache_read: 0.55 } },
  { match: "o3", price: { input: 2, output: 8, cache_read: 0.5 } },
  { match: "o4-mini", price: { input: 1.1, output: 4.4, cache_read: 0.275 } },
  // Google
  { match: "gemini-2.5-pro", price: { input: 1.25, output: 10, cache_read: 0.315 } },
  { match: "gemini-2.5-flash-lite", price: { input: 0.1, output: 0.4 } },
  { match: "gemini-2.5-flash", price: { input: 0.3, output: 2.5, cache_read: 0.075 } },
  { match: "gemini-2.0-flash", price: { input: 0.1, output: 0.4 } },
  { match: "gemini-1.5-pro", price: { input: 1.25, output: 5 } },
  { match: "gemini-1.5-flash", price: { input: 0.075, output: 0.3 } }
];

export function resolveOfficialPrice(
  modelId: string
): OfficialModelPrice | null {
  const key = modelId.toLowerCase().trim();
  if (!key) return null;
  for (const row of OFFICIAL_PRICES) {
    if (key.includes(row.match) || row.match.includes(key)) {
      return row.price;
    }
  }
  return null;
}

/** 입력:출력 = 3:1 가정 blended USD / 1M tokens */
export function blendedUsdFromOfficial(price: OfficialModelPrice): number {
  return (price.input * 3 + price.output) / 4;
}

export function estimateKrwFromTokens(
  modelId: string,
  tokens: number,
  usdKrw: number,
  marketUsdPerM: number | null
): { krw: number; usedOfficial: boolean } {
  if (!tokens || usdKrw <= 0) return { krw: 0, usedOfficial: false };
  if (marketUsdPerM != null && marketUsdPerM > 0) {
    return {
      krw: Math.round((tokens / 1_000_000) * marketUsdPerM * usdKrw),
      usedOfficial: false
    };
  }
  const official = resolveOfficialPrice(modelId);
  if (!official) return { krw: 0, usedOfficial: false };
  const blended = blendedUsdFromOfficial(official);
  return {
    krw: Math.round((tokens / 1_000_000) * blended * usdKrw),
    usedOfficial: true
  };
}
