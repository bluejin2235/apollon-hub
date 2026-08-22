import type { SupabaseClient } from "@supabase/supabase-js";
import { embeddingToSql } from "@/lib/luna/embedding";
import type { LunaCard } from "@/lib/luna/tavily";

/** RPC 기본 필터 — 142장 실측 (verify-media-index-search.ts) */
export const MEDIA_MATCH_THRESHOLD = 0.33;
export const MEDIA_MATCH_OVERFETCH = 20;

/** 자료 카드 표시 계층 — 노션(0.42/0.33)보다 낮은 분포 */
export const MEDIA_PACK_RECOMMENDED = 0.4;
export const MEDIA_PACK_MID = 0.33;

const IMAGE_INTENT_RE =
  /이미지|사진|비주얼|레퍼런스|시안|보여줘|어떻게\s*생겼/i;

export type MediaIndexHit = {
  path: string;
  drive: string;
  file_name: string;
  similarity: number;
  project: string | null;
  ai_category: string | null;
  description: string | null;
  thumbnail_url: string | null;
};

function isMissingRpc(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: string }).code) : "";
  const msg =
    "message" in error ? String((error as { message?: string }).message) : "";
  return (
    code === "PGRST202" ||
    code === "42883" ||
    msg.includes("Could not find the function") ||
    msg.includes("does not exist")
  );
}

function parseEmbedding(raw: unknown): number[] | null {
  if (Array.isArray(raw)) {
    const vec = raw.map(Number).filter((n) => Number.isFinite(n));
    return vec.length > 0 ? vec : null;
  }
  if (typeof raw !== "string" || !raw.trim()) return null;
  const inner = raw.replace(/^\[/, "").replace(/\]$/, "");
  if (!inner.trim()) return null;
  const vec = inner.split(",").map((s) => Number(s.trim()));
  if (vec.some((n) => !Number.isFinite(n))) return null;
  return vec;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function matchMediaEmbeddingsFallback(
  admin: SupabaseClient,
  queryEmbedding: number[],
  opts?: { threshold?: number; limit?: number }
): Promise<MediaIndexHit[]> {
  const threshold = opts?.threshold ?? MEDIA_MATCH_THRESHOLD;
  const limit = opts?.limit ?? MEDIA_MATCH_OVERFETCH;
  const { data, error } = await admin
    .from("luna_media_index")
    .select(
      "path, drive, file_name, project, ai_category, description, thumbnail_url, embedding"
    )
    .not("embedding", "is", null);
  if (error) {
    console.error("[luna/media-index] fallback select", error);
    return [];
  }
  const scored: MediaIndexHit[] = [];
  for (const row of data ?? []) {
    const vec = parseEmbedding(row.embedding);
    if (!vec) continue;
    const similarity = cosineSimilarity(queryEmbedding, vec);
    if (similarity < threshold) continue;
    scored.push({
      path: String(row.path ?? ""),
      drive: String(row.drive ?? ""),
      file_name: String(row.file_name ?? ""),
      similarity,
      project: (row.project as string | null) ?? null,
      ai_category: (row.ai_category as string | null) ?? null,
      description: (row.description as string | null) ?? null,
      thumbnail_url: (row.thumbnail_url as string | null) ?? null
    });
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}

export async function matchMediaEmbeddings(
  admin: SupabaseClient,
  queryEmbedding: number[],
  opts?: { threshold?: number; limit?: number }
): Promise<MediaIndexHit[]> {
  const threshold = opts?.threshold ?? MEDIA_MATCH_THRESHOLD;
  const limit = opts?.limit ?? MEDIA_MATCH_OVERFETCH;
  const { data, error } = await admin.rpc("luna_match_media", {
    query_embedding: embeddingToSql(queryEmbedding),
    match_threshold: threshold,
    match_count: limit
  });
  if (error) {
    if (isMissingRpc(error)) {
      return matchMediaEmbeddingsFallback(admin, queryEmbedding, opts);
    }
    console.error("[luna/media-index] rpc", error);
    return [];
  }
  if (!data?.length) return [];

  const paths = data.map((row: Record<string, unknown>) => String(row.path ?? ""));
  const { data: metaRows, error: metaErr } = await admin
    .from("luna_media_index")
    .select(
      "path, project, ai_category, description, thumbnail_url, drive, file_name"
    )
    .in("path", paths);
  if (metaErr) console.error("[luna/media-index] meta", metaErr);
  const metaByPath = new Map(
    (metaRows ?? []).map((r: Record<string, unknown>) => [String(r.path), r])
  );

  return data
    .map((row: Record<string, unknown>) => {
      const path = String(row.path ?? "");
      const meta = metaByPath.get(path);
      return {
        path,
        drive: String(row.drive ?? meta?.drive ?? ""),
        file_name: String(row.file_name ?? meta?.file_name ?? ""),
        similarity: Number(row.similarity) || 0,
        project: (meta?.project as string | null) ?? null,
        ai_category: (meta?.ai_category as string | null) ?? null,
        description: (meta?.description as string | null) ?? null,
        thumbnail_url: (meta?.thumbnail_url as string | null) ?? null
      };
    })
    .filter((h: MediaIndexHit) => h.path && h.similarity >= threshold);
}

export function hasImageSearchIntent(question: string): boolean {
  return IMAGE_INTENT_RE.test(question);
}

export function mediaHitToCard(hit: MediaIndexHit): LunaCard {
  const title = hit.file_name || hit.path.split(/[/\\]/).pop() || hit.path;
  const descParts = [hit.description?.trim(), hit.project?.trim()].filter(
    Boolean
  ) as string[];
  return {
    type: "image",
    title,
    url: null,
    thumbnail: hit.thumbnail_url?.trim() || null,
    description: descParts.join(" · ") || hit.path,
    drive: hit.drive?.trim() || undefined,
    raw_path: hit.path,
    is_file: true,
    project: hit.project ?? undefined,
    ai_category: hit.ai_category ?? undefined,
    similarity: hit.similarity
  };
}

export function mediaHitsToCards(hits: MediaIndexHit[]): LunaCard[] {
  return hits.map(mediaHitToCard);
}

/** 질문 임베딩으로 이미지 검색 — LLM 없음 */
export async function searchMediaForLuna(
  admin: SupabaseClient,
  queryEmbedding: number[] | null,
  question: string,
  opts?: { threshold?: number; limit?: number }
): Promise<{ hits: MediaIndexHit[]; cards: LunaCard[] }> {
  if (!queryEmbedding?.length) return { hits: [], cards: [] };
  const hits = await matchMediaEmbeddings(admin, queryEmbedding, opts);
  let cards = mediaHitsToCards(hits);
  if (hasImageSearchIntent(question)) {
    cards = [...cards].sort(
      (a, b) => (b.similarity ?? 0) - (a.similarity ?? 0)
    );
  }
  return { hits, cards };
}

export function orderCardsWithImagePriority(
  cards: LunaCard[],
  question: string
): LunaCard[] {
  if (!hasImageSearchIntent(question)) return cards;
  const images = cards.filter((c) => c.type === "image");
  if (images.length === 0) return cards;
  const rest = cards.filter((c) => c.type !== "image");
  return [...images, ...rest];
}
