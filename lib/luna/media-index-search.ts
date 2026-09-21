import type { SupabaseClient } from "@supabase/supabase-js";
import { embeddingToSql } from "@/lib/luna/embedding";
import type { LunaCard } from "@/lib/luna/tavily";
import type { AskedWhat } from "@/lib/luna/ask-what";
import { naturePathTokens } from "@/lib/luna/ask-what";
import { isGarbage3dPath } from "@/lib/luna/media-index-rules";
import {
  haystackMatchesAsked
} from "@/lib/luna/search-filter";
import { pathVariantsForTerm } from "@/lib/luna/named-entities";

/** RPC 기본 필터 — 142장 실측 (verify-media-index-search.ts) */
export const MEDIA_MATCH_THRESHOLD = 0.33;
export const MEDIA_MATCH_OVERFETCH = 20;

/** 자료 카드 표시 계층 — 노션(0.42/0.33)보다 낮은 분포 */
export const MEDIA_PACK_RECOMMENDED = 0.4;
export const MEDIA_PACK_MID = 0.33;

const IMAGE_INTENT_RE =
  /이미지|사진|비주얼|시안|보여줘|어떻게\s*생겼|\bkv\b|스토리보드/i;

export type MediaIndexHit = {
  path: string;
  drive: string;
  file_name: string;
  similarity: number;
  project: string | null;
  ai_category: string | null;
  description: string | null;
  thumbnail_url: string | null;
  large_url: string | null;
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
      "path, drive, file_name, project, ai_category, description, thumbnail_url, large_url, embedding"
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
      thumbnail_url: (row.thumbnail_url as string | null) ?? null,
      large_url: (row.large_url as string | null) ?? null
    });
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  const out = scored.slice(0, limit);
  console.log("[luna/media-index] fallback", {
    threshold,
    scanned: data?.length ?? 0,
    hits: out.length,
    topSim: out[0]?.similarity ?? null
  });
  return out;
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
      console.log("[luna/media-index] rpc missing, fallback scan", {
        threshold,
        limit
      });
      return matchMediaEmbeddingsFallback(admin, queryEmbedding, opts);
    }
    console.error("[luna/media-index] rpc", error);
    return [];
  }
  if (!data?.length) {
    console.log("[luna/media-index] rpc", { threshold, hits: 0, topSim: null });
    return [];
  }
  console.log("[luna/media-index] rpc", {
    threshold,
    hits: data.length,
    topSim: Number((data[0] as Record<string, unknown>)?.similarity) || null
  });

  const paths = data.map((row: Record<string, unknown>) => String(row.path ?? ""));
  const { data: metaRows, error: metaErr } = await admin
    .from("luna_media_index")
    .select(
      "path, project, ai_category, description, thumbnail_url, large_url, drive, file_name"
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
        thumbnail_url: (meta?.thumbnail_url as string | null) ?? null,
        large_url: (meta?.large_url as string | null) ?? null
      };
    })
    .filter((h: MediaIndexHit) => h.path && h.similarity >= threshold);
}

function mediaHaystack(hit: MediaIndexHit): string {
  return [hit.path, hit.project, hit.file_name, hit.description]
    .filter(Boolean)
    .join("\n");
}

function applyAskedMediaFilter(
  hits: MediaIndexHit[],
  asked?: AskedWhat
): MediaIndexHit[] {
  const next = hits.filter((h) => !isGarbage3dPath(h.path));
  if (!asked || asked.projectPhrases.length === 0) return next;
  return next.filter((h) => haystackMatchesAsked(mediaHaystack(h), asked));
}

const MEDIA_PATH_SELECT =
  "path, drive, file_name, project, ai_category, description, thumbnail_url, large_url";

function rowToMediaHit(
  row: Record<string, unknown>,
  similarity = 0.5
): MediaIndexHit | null {
  const path = typeof row.path === "string" ? row.path : "";
  if (!path) return null;
  return {
    path,
    drive: typeof row.drive === "string" ? row.drive : "T",
    file_name: typeof row.file_name === "string" ? row.file_name : "",
    similarity,
    project: (row.project as string | null) ?? null,
    ai_category: (row.ai_category as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    thumbnail_url: (row.thumbnail_url as string | null) ?? null,
    large_url: (row.large_url as string | null) ?? null
  };
}

/** 폴더·프로젝트명으로 이미지 색인을 찾는다. 임베딩보다 프로젝트 일치가 우선. */
export async function searchMediaByPath(
  admin: SupabaseClient,
  asked: AskedWhat,
  limit = 20
): Promise<MediaIndexHit[]> {
  if (asked.projectPhrases.length === 0) return [];
  const phrase = asked.projectPhrases[0]!;
  let query = admin
    .from("luna_media_index")
    .select(MEDIA_PATH_SELECT)
    .or(`path.ilike.%${phrase}%,project.ilike.%${phrase}%`)
    .limit(Math.max(limit * 3, 40));

  const extras = [...asked.extraTokens, ...naturePathTokens(asked.nature)];
  for (const extra of extras) {
    const variants = pathVariantsForTerm(extra);
    if (variants.length === 1) {
      query = query.ilike("path", `%${variants[0]}%`);
    } else if (variants.length > 1) {
      query = query.or(variants.map((v) => `path.ilike.%${v}%`).join(","));
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error("[luna/media-index] path search", error);
    return [];
  }
  const hits: MediaIndexHit[] = [];
  for (const row of data ?? []) {
    const hit = rowToMediaHit(row as Record<string, unknown>, 0.72);
    if (!hit) continue;
    if (isGarbage3dPath(hit.path)) continue;
    if (!haystackMatchesAsked(mediaHaystack(hit), asked)) continue;
    hits.push(hit);
    if (hits.length >= limit) break;
  }
  console.log("[luna/media-index] path search", {
    phrase,
    extras,
    hits: hits.length
  });
  return hits;
}

function mergeMediaHits(primary: MediaIndexHit[], extra: MediaIndexHit[]): MediaIndexHit[] {
  const seen = new Set<string>();
  const out: MediaIndexHit[] = [];
  for (const hit of [...primary, ...extra]) {
    const key = hit.path.replace(/\//g, "\\").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
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
    url: hit.large_url?.trim() || null,
    thumbnail: hit.thumbnail_url?.trim() || null,
    description: descParts.join(" · ") || hit.path,
    drive: hit.drive?.trim() || undefined,
    raw_path: hit.path,
    is_file: true,
    project: hit.project ?? undefined,
    ai_category: hit.ai_category ?? undefined,
    similarity: hit.similarity,
    image_description: hit.description?.trim() || undefined
  };
}

export function mediaHitsToCards(hits: MediaIndexHit[]): LunaCard[] {
  return hits.map(mediaHitToCard);
}

/** 질문 임베딩 + 폴더명. 프로젝트가 명시되면 그 밖은 버리지 않고 안 돌려준다. */
export async function searchMediaForLuna(
  admin: SupabaseClient,
  queryEmbedding: number[] | null,
  question: string,
  opts?: { threshold?: number; limit?: number; asked?: AskedWhat }
): Promise<{ hits: MediaIndexHit[]; cards: LunaCard[] }> {
  const asked = opts?.asked;
  const pathHits =
    asked && asked.projectPhrases.length > 0
      ? await searchMediaByPath(admin, asked, opts?.limit ?? MEDIA_MATCH_OVERFETCH)
      : [];

  let embeddingHits: MediaIndexHit[] = [];
  if (queryEmbedding?.length) {
    embeddingHits = await matchMediaEmbeddings(admin, queryEmbedding, {
      threshold: opts?.threshold,
      limit: opts?.limit
    });
  } else if (pathHits.length === 0) {
    console.log("[luna/media-index] search skipped (no embedding)", {
      q: question.slice(0, 80)
    });
    return { hits: [], cards: [] };
  }

  const scoped = applyAskedMediaFilter(embeddingHits, asked);
  const hits =
    asked && asked.projectPhrases.length > 0
      ? mergeMediaHits(pathHits, scoped)
      : applyAskedMediaFilter(embeddingHits, asked);
  let cards = mediaHitsToCards(hits);
  if (hasImageSearchIntent(question) || hits.length > 0) {
    console.log("[luna/media-index] search", {
      q: question.slice(0, 80),
      hits: hits.length,
      pathHits: pathHits.length,
      embeddingHits: embeddingHits.length,
      scoped: scoped.length,
      topSim: hits[0]?.similarity ?? null,
      topProject: hits[0]?.project ?? null
    });
  }
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
