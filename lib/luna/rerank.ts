/**
 * 검색 상위 후보 재정렬 — BGE reranker v2-m3 (오픈소스)
 *
 * 제공 방식 (하나면 됨, 없으면 건너뜀 · fused 순서 유지)
 *  1) LUNA_RERANK_URL  — TEI /rerank 호환 (query + texts)
 *  2) HF_TOKEN 등      — Hugging Face Inference (쌍 분류)
 *
 * 모델 기본: BAAI/bge-reranker-v2-m3
 * 한국어 특화: LUNA_RERANK_MODEL=dragonkue/bge-reranker-v2-m3-ko
 */
import "server-only";

export const RERANK_CANDIDATE_N = 50;
export const DEFAULT_RERANK_MODEL = "BAAI/bge-reranker-v2-m3";

export type RerankPassage = { id: string; text: string };

export type RerankResult = {
  orderedIds: string[];
  scores: number[];
  ms: number;
  used: boolean;
  provider: "tei" | "hf" | "none";
  error?: string;
};

function envTrim(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function rerankEndpointUrl(): string | null {
  const raw = envTrim("LUNA_RERANK_URL");
  return raw || null;
}

export function huggingfaceToken(): string | null {
  return (
    envTrim("HF_TOKEN") ||
    envTrim("HUGGINGFACE_API_KEY") ||
    envTrim("HUGGING_FACE_HUB_TOKEN") ||
    null
  );
}

export function rerankModelId(): string {
  return envTrim("LUNA_RERANK_MODEL") || DEFAULT_RERANK_MODEL;
}

export function isRerankConfigured(): boolean {
  const flag = envTrim("LUNA_RERANK").toLowerCase();
  if (flag === "0" || flag === "off" || flag === "false") return false;
  return Boolean(rerankEndpointUrl() || huggingfaceToken());
}

function passagePreview(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 1200);
}

async function callTeiRerank(opts: {
  url: string;
  query: string;
  texts: string[];
  timeoutMs: number;
}): Promise<Array<{ index: number; score: number }>> {
  const base = opts.url.replace(/\/$/, "");
  const endpoint = base.endsWith("/rerank") ? base : `${base}/rerank`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        query: opts.query,
        texts: opts.texts,
        truncate: true,
        truncation_direction: "right"
      }),
      signal: ctrl.signal
    });
    if (!res.ok) {
      throw new Error(`TEI rerank HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as unknown;
    if (!Array.isArray(json)) throw new Error("TEI rerank: expected array");
    return json.map((row) => {
      const r = row as { index?: number; score?: number };
      return {
        index: typeof r.index === "number" ? r.index : -1,
        score: typeof r.score === "number" ? r.score : Number.NEGATIVE_INFINITY
      };
    });
  } finally {
    clearTimeout(timer);
  }
}

async function callHfRerank(opts: {
  token: string;
  model: string;
  query: string;
  texts: string[];
  timeoutMs: number;
}): Promise<Array<{ index: number; score: number }>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  const pairs = opts.texts.map((t) => [opts.query, t] as [string, string]);
  try {
    const url = `https://api-inference.huggingface.co/models/${encodeURIComponent(opts.model)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({ inputs: pairs, options: { wait_for_model: true } }),
      signal: ctrl.signal
    });
    if (!res.ok) {
      throw new Error(`HF rerank HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as unknown;
    // [{label, score}] per pair, or [[...]], or flat scores
    if (Array.isArray(json) && json.length === opts.texts.length) {
      return json.map((row, index) => {
        if (typeof row === "number") return { index, score: row };
        if (Array.isArray(row)) {
          const best = row
            .map((x) =>
              x && typeof x === "object" && typeof (x as { score?: number }).score === "number"
                ? (x as { score: number }).score
                : Number.NEGATIVE_INFINITY
            )
            .sort((a, b) => b - a)[0];
          return { index, score: best ?? Number.NEGATIVE_INFINITY };
        }
        if (row && typeof row === "object" && typeof (row as { score?: number }).score === "number") {
          return { index, score: (row as { score: number }).score };
        }
        return { index, score: Number.NEGATIVE_INFINITY };
      });
    }
    throw new Error("HF rerank: unexpected response shape");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * passages 를 관련도 높은 순으로 재정렬.
 * 설정이 없거나 실패하면 입력 순서를 그대로 돌려준다 (used=false).
 */
export async function rerankPassages(opts: {
  query: string;
  passages: RerankPassage[];
  timeoutMs?: number;
}): Promise<RerankResult> {
  const started = Date.now();
  const query = opts.query.trim();
  const passages = opts.passages
    .map((p) => ({ id: p.id.trim(), text: passagePreview(p.text) }))
    .filter((p) => p.id && p.text);
  const identity = (): RerankResult => ({
    orderedIds: passages.map((p) => p.id),
    scores: passages.map(() => 0),
    ms: Date.now() - started,
    used: false,
    provider: "none"
  });

  if (!query || passages.length < 2 || !isRerankConfigured()) {
    return identity();
  }

  const timeoutMs = opts.timeoutMs ?? 8_000;
  const texts = passages.map((p) => p.text);
  const tei = rerankEndpointUrl();
  const token = huggingfaceToken();

  try {
    let ranked: Array<{ index: number; score: number }>;
    let provider: "tei" | "hf";
    if (tei) {
      ranked = await callTeiRerank({ url: tei, query, texts, timeoutMs });
      provider = "tei";
    } else if (token) {
      ranked = await callHfRerank({
        token,
        model: rerankModelId(),
        query,
        texts,
        timeoutMs
      });
      provider = "hf";
    } else {
      return identity();
    }

    const scored = ranked
      .filter((r) => r.index >= 0 && r.index < passages.length)
      .sort((a, b) => b.score - a.score);
    if (scored.length === 0) {
      return { ...identity(), error: "empty scores", provider };
    }
    const seen = new Set<number>();
    const orderedIds: string[] = [];
    const scores: number[] = [];
    for (const r of scored) {
      if (seen.has(r.index)) continue;
      seen.add(r.index);
      orderedIds.push(passages[r.index]!.id);
      scores.push(r.score);
    }
    for (let i = 0; i < passages.length; i += 1) {
      if (seen.has(i)) continue;
      orderedIds.push(passages[i]!.id);
      scores.push(Number.NEGATIVE_INFINITY);
    }
    return {
      orderedIds,
      scores,
      ms: Date.now() - started,
      used: true,
      provider
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[luna/rerank]", message);
    return { ...identity(), error: message };
  }
}
