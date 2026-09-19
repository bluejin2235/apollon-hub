type Slot<T> = { at: number; value: T };

const slots = new Map<string, Slot<unknown>>();

/** 질문마다 안 바뀌는 준비 데이터. 용어사전은 하루, 나머지는 10분. */
export const PREP_TTL_MS = {
  wiki: 10 * 60 * 1000,
  glossary: 24 * 60 * 60 * 1000,
  learnings: 10 * 60 * 1000,
  prompts: 10 * 60 * 1000,
  types: 10 * 60 * 1000,
  perspectives: 10 * 60 * 1000,
  tiers: 10 * 60 * 1000,
  profile: 10 * 60 * 1000,
  lens: 10 * 60 * 1000,
  web: 10 * 60 * 1000
} as const;

export type PrepCacheHit<T> = { value: T; ms: number; hit: boolean };

/**
 * 프로세스 메모리 캐시. 실패 결과는 store 가 false 를 돌려 넣지 않는다.
 * 인스턴스가 식으면 다음 요청이 다시 읽는다.
 */
export async function withPrepCache<T>(
  key: string,
  ttlMs: number,
  load: () => PromiseLike<T>,
  store: (value: T) => boolean = () => true
): Promise<PrepCacheHit<T>> {
  const now = Date.now();
  const prev = slots.get(key) as Slot<T> | undefined;
  if (prev && now - prev.at < ttlMs) {
    return { value: prev.value, ms: 0, hit: true };
  }
  const t0 = Date.now();
  const value = await load();
  if (store(value)) slots.set(key, { at: Date.now(), value });
  return { value, ms: Date.now() - t0, hit: false };
}
