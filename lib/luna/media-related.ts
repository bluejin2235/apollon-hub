import type { SupabaseClient } from "@supabase/supabase-js";
import {
  matchMediaEmbeddings,
  type MediaIndexHit
} from "@/lib/luna/media-index-search";
import { parseMediaEmbedding } from "@/lib/luna/media-embedding";

function diversifyByProject(
  hits: MediaIndexHit[],
  maxPerProject: number,
  limit: number
): MediaIndexHit[] {
  const out: MediaIndexHit[] = [];
  const counts: Record<string, number> = {};
  for (const h of hits) {
    const proj = h.project?.trim() || "_";
    if ((counts[proj] ?? 0) >= maxPerProject) continue;
    out.push(h);
    counts[proj] = (counts[proj] ?? 0) + 1;
    if (out.length >= limit) break;
  }
  return out;
}

function rowToHit(
  row: Record<string, unknown>,
  similarity = 0
): MediaIndexHit | null {
  const path = String(row.path ?? "");
  if (!path) return null;
  return {
    path,
    drive: String(row.drive ?? ""),
    file_name: String(row.file_name ?? ""),
    similarity,
    project: (row.project as string | null) ?? null,
    ai_category: (row.ai_category as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    thumbnail_url: (row.thumbnail_url as string | null) ?? null,
    large_url: (row.large_url as string | null) ?? null
  };
}

/** 임베딩 유사도 위주 + 같은 프로젝트 보강 (프로젝트당 최대 3장) */
export async function fetchRelatedMedia(
  admin: SupabaseClient,
  path: string,
  limit = 8
): Promise<MediaIndexHit[]> {
  const { data: row, error } = await admin
    .from("luna_media_index")
    .select(
      "path, drive, file_name, project, ai_category, description, thumbnail_url, large_url, embedding"
    )
    .eq("path", path)
    .maybeSingle();

  if (error) {
    console.error("[luna/media-related] row", error);
    return [];
  }
  if (!row) return [];

  const embedding = parseMediaEmbedding(row.embedding);
  let similar: MediaIndexHit[] = [];
  if (embedding) {
    similar = await matchMediaEmbeddings(admin, embedding, {
      threshold: 0.25,
      limit: 25
    });
    similar = similar.filter((h) => h.path !== path);
  }

  let projectPeers: MediaIndexHit[] = [];
  const project = (row.project as string | null)?.trim();
  if (project) {
    const { data: peers, error: peerErr } = await admin
      .from("luna_media_index")
      .select(
        "path, drive, file_name, project, ai_category, description, thumbnail_url, large_url"
      )
      .eq("project", project)
      .neq("path", path)
      .limit(15);
    if (peerErr) console.error("[luna/media-related] peers", peerErr);
    projectPeers = (peers ?? [])
      .map((r) => rowToHit(r as Record<string, unknown>))
      .filter(Boolean) as MediaIndexHit[];
  }

  const seen = new Set<string>();
  const merged: MediaIndexHit[] = [];
  for (const h of similar) {
    if (seen.has(h.path)) continue;
    seen.add(h.path);
    merged.push(h);
  }
  for (const h of projectPeers) {
    if (seen.has(h.path)) continue;
    seen.add(h.path);
    merged.push(h);
  }

  return diversifyByProject(merged, 3, limit);
}
