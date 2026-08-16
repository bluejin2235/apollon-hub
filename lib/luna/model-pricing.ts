/** 공급사 공식 단가 (USD / 1M tokens). 시장 스냅샷이 없을 때 비용 추정용. */

export type OfficialModelPrice = {
  input: number;
  output: number;
  /** cache hit / read */
  cache_read?: number;
  /** cache write. 없으면 Claude 는 input×1.25, 그 외는 input */
  cache_write?: number;
};

export type UsageTokenParts = {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
};

export type MarketTokenRates = {
  input?: number | null;
  output?: number | null;
  cache_read?: number | null;
  blended?: number | null;
};

function isClaudeModel(modelId: string): boolean {
  return modelId.toLowerCase().includes("claude");
}

export function cacheWriteUsdPerM(
  price: OfficialModelPrice,
  modelId: string
): number {
  if (typeof price.cache_write === "number") return price.cache_write;
  return isClaudeModel(modelId) ? price.input * 1.25 : price.input;
}

export function cacheReadUsdPerM(
  price: OfficialModelPrice,
  modelId: string
): number {
  if (typeof price.cache_read === "number") return price.cache_read;
  return isClaudeModel(modelId) ? price.input * 0.1 : price.input * 0.5;
}

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

function usdToKrw(usdPerM: number, tokens: number, usdKrw: number): number {
  if (!tokens || usdPerM <= 0 || usdKrw <= 0) return 0;
  return (tokens / 1_000_000) * usdPerM * usdKrw;
}

/** 캐시 쓰기·읽기 단가를 반영한 사용량 비용. */
export function estimateUsageKrw(
  modelId: string,
  parts: UsageTokenParts,
  usdKrw: number,
  market?: MarketTokenRates | null
): { krw: number; usedOfficial: boolean } {
  const input = Math.max(0, parts.inputTokens || 0);
  const output = Math.max(0, parts.outputTokens || 0);
  const cacheWrite = Math.max(0, parts.cacheWriteTokens || 0);
  const cacheRead = Math.max(0, parts.cacheReadTokens || 0);
  if (input + output + cacheWrite + cacheRead === 0 || usdKrw <= 0) {
    return { krw: 0, usedOfficial: false };
  }

  const official = resolveOfficialPrice(modelId);
  const mIn = market?.input;
  const mOut = market?.output;
  const mRead = market?.cache_read;
  const hasSplit =
    (typeof mIn === "number" && mIn > 0) ||
    (typeof mOut === "number" && mOut > 0) ||
    official != null;

  if (hasSplit) {
    const inRate = (typeof mIn === "number" && mIn > 0 ? mIn : null) ?? official?.input ?? 0;
    const outRate =
      (typeof mOut === "number" && mOut > 0 ? mOut : null) ?? official?.output ?? 0;
    const readRate =
      (typeof mRead === "number" && mRead > 0 ? mRead : null) ??
      (official ? cacheReadUsdPerM(official, modelId) : inRate * (isClaudeModel(modelId) ? 0.1 : 0.5));
    const writeRate = official
      ? cacheWriteUsdPerM(official, modelId)
      : isClaudeModel(modelId)
        ? inRate * 1.25
        : inRate;
    const usd =
      usdToKrw(inRate, input, usdKrw) +
      usdToKrw(outRate, output, usdKrw) +
      usdToKrw(writeRate, cacheWrite, usdKrw) +
      usdToKrw(readRate, cacheRead, usdKrw);
    return {
      krw: Math.round(usd),
      usedOfficial: official != null && !(typeof mIn === "number" && mIn > 0)
    };
  }

  const blended = market?.blended ?? null;
  const all = input + output + cacheWrite + cacheRead;
  return estimateKrwFromTokens(modelId, all, usdKrw, blended ?? null);
}

export function cacheHitRate(inputNoCache: number, cacheRead: number): number {
  const den = Math.max(0, inputNoCache) + Math.max(0, cacheRead);
  if (den <= 0) return 0;
  return Math.round((cacheRead / den) * 1000) / 10;
}
