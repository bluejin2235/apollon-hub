/**
 * Artificial Analysis model_slug ↔ 실제 공급사 API model id.
 *
 * AA 는 버전을 하이픈으로 쓰고(gpt-5-6-luna), OpenAI/Google 는 점(gpt-5.6-luna,
 * gemini-3.7-flash)을 쓰는 경우가 많다. -low/-medium 등은 AA 측정 설정 접미사라
 * API 모델명에 없을 수 있다.
 */

export type ApiProvider = "openai" | "google" | "anthropic";

/** 명시 매핑. null = 호출 불가(후보 제외) */
export const AA_API_MODEL_MAP: Record<string, string | null> = {
  // OpenAI — AA 하이픈 → API 점
  "gpt-5-6-luna": "gpt-5.6-luna",
  "gpt-5-6-luna-low": "gpt-5.6-luna",
  "gpt-5-6-luna-medium": "gpt-5.6-luna",
  "gpt-5-6-luna-high": "gpt-5.6-luna",
  "gpt-5-6-luna-xhigh": "gpt-5.6-luna",
  "gpt-5-6-sol": "gpt-5.6-sol",
  "gpt-5-6-terra": "gpt-5.6-terra",
  // OpenAI OSS — 현재 계정 models 목록에 없음 → 제외
  "gpt-oss-120b": null,
  "gpt-oss-120b-low": null,
  "gpt-oss-20b": null,
  // Google — AA 하이픈 → API 점, effort 접미사 제거
  "gemini-3-7-flash": "gemini-3.7-flash",
  "gemini-3-7-flash-low": "gemini-3.7-flash",
  "gemini-3-7-flash-medium": "gemini-3.7-flash",
  "gemini-3-6-flash": "gemini-3.6-flash",
  "gemini-3-5-flash": "gemini-3.5-flash",
  "gemini-3-5-flash-medium": "gemini-3.5-flash",
  "gemini-3-5-flash-minimal": "gemini-3.5-flash",
  "gemini-3-1-pro-preview": "gemini-3.1-pro-preview"
};

const EFFORT_SUFFIX =
  /-(low|medium|high|xhigh|minimal|non-reasoning|non-reasoning-low-effort|adaptive)$/i;

export type ProviderModelCatalog = {
  openai: Set<string>;
  google: Set<string>;
  fetched_at: string;
};

function dashVersionToDot(slug: string): string {
  // gpt-5-6-luna → gpt-5.6-luna / gemini-3-7-flash → gemini-3.7-flash
  return slug.replace(
    /^([a-z]+)-(\d+)-(\d+)(?=-|$)/i,
    (_, name: string, major: string, minor: string) =>
      `${name}-${major}.${minor}`
  );
}

/** AA slug 에서 시도할 API model id 후보 (우선순위 순) */
export function apiIdCandidates(slug: string): string[] {
  const out: string[] = [];
  const push = (s: string | null | undefined) => {
    if (!s) return;
    if (!out.includes(s)) out.push(s);
  };

  if (Object.prototype.hasOwnProperty.call(AA_API_MODEL_MAP, slug)) {
    push(AA_API_MODEL_MAP[slug] ?? undefined);
    // 명시 null 이면 후보 없음
    if (AA_API_MODEL_MAP[slug] === null) return [];
  }

  push(slug);
  push(dashVersionToDot(slug));
  const stripped = slug.replace(EFFORT_SUFFIX, "");
  if (stripped !== slug) {
    push(stripped);
    push(dashVersionToDot(stripped));
    if (Object.prototype.hasOwnProperty.call(AA_API_MODEL_MAP, stripped)) {
      push(AA_API_MODEL_MAP[stripped] ?? undefined);
    }
  }
  return out;
}

export function resolveApiModelId(
  provider: string | null | undefined,
  slug: string,
  catalog?: ProviderModelCatalog | null
): string | null {
  const p = (provider ?? "").toLowerCase();
  const candidates = apiIdCandidates(slug);
  if (candidates.length === 0) return null;

  if (p === "anthropic") {
    // Anthropic 은 models list API 를 쓰지 않음 — 매핑/휴리스틱만
    return candidates[0] ?? null;
  }

  if (!catalog) {
    // 카탈로그 없으면 매핑 테이블·휴리스틱 1순위 반환 (검증 전)
    return candidates[0] ?? null;
  }

  const set = p === "openai" ? catalog.openai : p === "google" ? catalog.google : null;
  if (!set || set.size === 0) {
    // 카탈로그 비어 있으면(키 없음·조회 실패) 매핑/휴리스틱 허용
    return candidates[0] ?? null;
  }

  for (const id of candidates) {
    if (set.has(id)) return id;
  }
  return null;
}

export function isSlugCallable(
  provider: string | null | undefined,
  slug: string,
  catalog?: ProviderModelCatalog | null
): boolean {
  return resolveApiModelId(provider, slug, catalog) != null;
}

export async function fetchProviderModelCatalog(): Promise<ProviderModelCatalog> {
  const openai = new Set<string>();
  const google = new Set<string>();
  const openaiKey = process.env.LUNA_OPENAI_API_KEY?.trim();
  const googleKey = process.env.LUNA_GOOGLE_API_KEY?.trim();

  if (openaiKey) {
    try {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${openaiKey}` },
        cache: "no-store"
      });
      if (res.ok) {
        const json = (await res.json()) as { data?: Array<{ id: string }> };
        for (const m of json.data ?? []) {
          if (m?.id) openai.add(m.id);
        }
      } else {
        console.warn("[luna/api-ids] openai models", res.status);
      }
    } catch (err) {
      console.warn("[luna/api-ids] openai models", err);
    }
  }

  if (googleKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(googleKey)}&pageSize=1000`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const json = (await res.json()) as {
          models?: Array<{ name?: string }>;
        };
        for (const m of json.models ?? []) {
          const id = String(m.name ?? "").replace(/^models\//, "");
          if (id) google.add(id);
        }
      } else {
        console.warn("[luna/api-ids] google models", res.status);
      }
    } catch (err) {
      console.warn("[luna/api-ids] google models", err);
    }
  }

  console.info(
    `[luna/api-ids] catalog openai=${openai.size} google=${google.size}`
  );
  return { openai, google, fetched_at: new Date().toISOString() };
}
