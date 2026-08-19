import { createHash } from "crypto";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMS = 1536;
/** 이 값 미만 유사도는 후보에서 제외 */
export const EMBEDDING_MIN_SIMILARITY = 0.35;
/** 키워드 점수와 더할 때 유사도 배율 (0.35→3.5, 1.0→10) */
export const EMBEDDING_SCORE_WEIGHT = 10;
/** 질문 임베딩이 이보다 느리면 키워드만 쓴다 (총 지연 1초 이내 목표) */
export const QUERY_EMBED_TIMEOUT_MS = 1200;

export type MatchVia = "keyword" | "embedding" | "both";

export function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function embeddingToSql(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

function openaiKey(): string | null {
  return process.env.LUNA_OPENAI_API_KEY?.trim() || null;
}

/** OpenAI text-embedding-3-small. 실패 시 null (검색은 키워드로 폴백). */
export async function createEmbedding(
  text: string,
  opts?: { timeoutMs?: number }
): Promise<number[] | null> {
  const key = openaiKey();
  const input = text.replace(/\s+/g, " ").trim().slice(0, 8000);
  if (!key || !input) return null;
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input
      }),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[luna/embedding] api", res.status, body.slice(0, 200));
      return null;
    }
    const json = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vec = json.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIMS) {
      console.error("[luna/embedding] bad dims", vec?.length);
      return null;
    }
    return vec;
  } catch (err) {
    console.error("[luna/embedding]", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function createQueryEmbedding(
  question: string,
  opts?: { timeoutMs?: number }
): Promise<number[] | null> {
  return createEmbedding(question, {
    timeoutMs: opts?.timeoutMs ?? QUERY_EMBED_TIMEOUT_MS
  });
}

export function wikiSectionEmbedText(opts: {
  docTitle: string;
  sectionTitle: string;
  body: string;
}): string {
  return [opts.docTitle.trim(), opts.sectionTitle.trim(), opts.body.trim()]
    .filter(Boolean)
    .join("\n");
}

export function glossaryEmbedText(opts: {
  term_ko?: string | null;
  term_en?: string | null;
  synonyms?: string[];
  definition?: string | null;
}): string {
  return [
    (opts.term_ko ?? "").trim(),
    (opts.term_en ?? "").trim(),
    ...(opts.synonyms ?? []).map((s) => s.trim()).filter(Boolean),
    (opts.definition ?? "").trim()
  ]
    .filter(Boolean)
    .join("\n");
}

export function learningEmbedText(content: string): string {
  return content.trim();
}

export function libraryDocEmbedText(opts: {
  title: string;
  kind: string;
  content: string;
}): string {
  return [opts.title.trim(), opts.kind.trim(), opts.content.trim()]
    .filter(Boolean)
    .join("\n")
    .slice(0, 8000);
}

export function fuseKeywordAndEmbedding(opts: {
  keywordScore: number;
  similarity: number | null | undefined;
}): { score: number; keyword_score: number; embedding_score: number; match_via: MatchVia } {
  const keyword_score = Math.max(0, opts.keywordScore);
  const sim =
    typeof opts.similarity === "number" && Number.isFinite(opts.similarity)
      ? opts.similarity
      : 0;
  const embedding_score =
    sim >= EMBEDDING_MIN_SIMILARITY ? sim * EMBEDDING_SCORE_WEIGHT : 0;
  const score = keyword_score + embedding_score;
  const match_via: MatchVia =
    keyword_score > 0 && embedding_score > 0
      ? "both"
      : embedding_score > 0
        ? "embedding"
        : "keyword";
  return { score, keyword_score, embedding_score, match_via };
}
