import { isPreferredProvider, type MarketModelRow } from "@/lib/luna/model-market";
import { blendedUsd, slugMatchesModel, valuePerCost } from "@/lib/luna/model-modes";

const PROVIDERS = ["anthropic", "openai", "google"] as const;

function intel(row: MarketModelRow): number {
  return Number(row.intelligence_index) || 0;
}

function ttft(row: MarketModelRow): number {
  const v = row.median_time_to_first_token_seconds;
  if (v == null || !Number.isFinite(Number(v))) return Number.POSITIVE_INFINITY;
  return Number(v);
}

function providerKey(row: MarketModelRow): string {
  return (row.provider ?? "").toLowerCase();
}

function addUnique(
  selected: MarketModelRow[],
  seen: Set<string>,
  row: MarketModelRow | null | undefined
): void {
  if (!row) return;
  const key = row.model_slug.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  selected.push(row);
}

/**
 * 산점도·순위·가격 추이가 공유하는 표시용 15개.
 * - Claude/GPT/Gemini만
 * - 현재 사용 모델 무조건 포함
 * - 공급사별 최소 4 (지능·최저가·가성비·TTFT 1위, 중복 시 다음)
 * - 나머지는 전체 가성비 순
 */
export function buildCuratedDisplaySet(
  market: MarketModelRow[],
  ourModelIds: string[],
  limit = 15
): MarketModelRow[] {
  const pool = market.filter((r) => isPreferredProvider(r.provider));
  if (pool.length === 0) return [];

  const selected: MarketModelRow[] = [];
  const seen = new Set<string>();

  // 1) 우리가 쓰는 모델
  for (const id of ourModelIds) {
    if (!id) continue;
    const hit =
      pool.find((r) => slugMatchesModel(r.model_slug, id)) ?? null;
    addUnique(selected, seen, hit);
  }

  // 2) 공급사별 지능·최저가·가성비·TTFT
  for (const prov of PROVIDERS) {
    const group = pool
      .filter((r) => providerKey(r) === prov)
      .slice();
    if (group.length === 0) continue;

    const picks: MarketModelRow[] = [];
    const takeNext = (
      sorted: MarketModelRow[],
      already: Set<string>
    ): MarketModelRow | null => {
      for (const r of sorted) {
        const k = r.model_slug.toLowerCase();
        if (already.has(k) || seen.has(k)) continue;
        return r;
      }
      // 이미 선택된 것도 허용해 공급사 최소 개수 채우기용 — 호출부에서 seen 재검사
      for (const r of sorted) {
        if (already.has(r.model_slug.toLowerCase())) continue;
        return r;
      }
      return null;
    };

    const local = new Set<string>();
    const byIntel = [...group].sort((a, b) => intel(b) - intel(a));
    const byPrice = [...group].sort((a, b) => blendedUsd(a) - blendedUsd(b));
    const byValue = [...group].sort(
      (a, b) => valuePerCost(b) - valuePerCost(a)
    );
    const byTtft = [...group].sort((a, b) => ttft(a) - ttft(b));

    for (const sorted of [byIntel, byPrice, byValue, byTtft]) {
      const next = takeNext(sorted, local);
      if (next) {
        local.add(next.model_slug.toLowerCase());
        picks.push(next);
      }
    }

    // 공급사당 최소 4 — 가성비 순으로 보충
    for (const r of byValue) {
      if (picks.length >= 4) break;
      if (local.has(r.model_slug.toLowerCase())) continue;
      local.add(r.model_slug.toLowerCase());
      picks.push(r);
    }

    for (const r of picks) addUnique(selected, seen, r);
  }

  // 3) 나머지 가성비 순으로 15까지
  const byValueAll = [...pool].sort(
    (a, b) => valuePerCost(b) - valuePerCost(a)
  );
  for (const r of byValueAll) {
    if (selected.length >= limit) break;
    addUnique(selected, seen, r);
  }

  // 공급사 균형이 깨졌으면 limit 안에서 부족 공급사 우선 보충
  for (const prov of PROVIDERS) {
    const count = selected.filter((r) => providerKey(r) === prov).length;
    if (count >= 4) continue;
    const extras = pool
      .filter((r) => providerKey(r) === prov && !seen.has(r.model_slug.toLowerCase()))
      .sort((a, b) => valuePerCost(b) - valuePerCost(a));
    for (const r of extras) {
      if (selected.filter((x) => providerKey(x) === prov).length >= 4) break;
      if (selected.length >= limit) {
        // limit 가득이면 가성비 낮은 타 공급사 1개 교체
        let worstIdx = -1;
        let worstVal = Number.POSITIVE_INFINITY;
        for (let i = 0; i < selected.length; i++) {
          const s = selected[i]!;
          if (ourModelIds.some((id) => slugMatchesModel(s.model_slug, id))) {
            continue;
          }
          if (providerKey(s) === prov) continue;
          const pc = selected.filter((x) => providerKey(x) === providerKey(s))
            .length;
          if (pc <= 4) continue;
          const v = valuePerCost(s);
          if (v < worstVal) {
            worstVal = v;
            worstIdx = i;
          }
        }
        if (worstIdx < 0) break;
        const removed = selected[worstIdx]!;
        seen.delete(removed.model_slug.toLowerCase());
        selected.splice(worstIdx, 1);
      }
      addUnique(selected, seen, r);
    }
  }

  return selected.slice(0, limit);
}

export function brandCounts(
  rows: MarketModelRow[]
): { Claude: number; GPT: number; Gemini: number } {
  const out = { Claude: 0, GPT: 0, Gemini: 0 };
  for (const r of rows) {
    const p = providerKey(r);
    if (p === "anthropic") out.Claude += 1;
    else if (p === "openai") out.GPT += 1;
    else if (p === "google") out.Gemini += 1;
  }
  return out;
}

/** 가격 추이 기본 ON: 공급사별 가성비 1위 */
export function defaultHistoryVisibleSlugs(
  curated: MarketModelRow[]
): string[] {
  const slugs: string[] = [];
  for (const prov of PROVIDERS) {
    const best = curated
      .filter((r) => providerKey(r) === prov)
      .sort((a, b) => valuePerCost(b) - valuePerCost(a))[0];
    if (best) slugs.push(best.model_slug);
  }
  return slugs;
}
