/**
 * Work 본문 키워드 검색 (플랜 A) — 임베딩 없이 trigram + 순위
 *
 * 순위: 파일명·경로 일치 · 본문 일치 · 중요 경로 · 최근 수정 · 프로젝트 소속(링크)
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type NasTextKeywordHit = {
  path: string;
  drive: string | null;
  seq: number;
  snippet: string;
  score: number;
  reasons: string[];
  modified_at: string | null;
  important: boolean;
};

function escapeIlike(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function pathBasename(path: string): string {
  const norm = path.replace(/\//g, "\\");
  const i = norm.lastIndexOf("\\");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

function projectPrefix(path: string): string | null {
  const parts = path.replace(/\//g, "\\").split("\\").filter(Boolean);
  if (parts.length < 2) return null;
  // "06 롯데 …" 같은 프로젝트 루트
  return parts[0] ?? null;
}

function tokenizeQuery(q: string): string[] {
  return q
    .split(/[\s,/|]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 8);
}

function recentBoost(iso: string | null, now = Date.now()): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  const days = (now - t) / (24 * 60 * 60 * 1000);
  if (days <= 90) return 4;
  if (days <= 365) return 2;
  if (days <= 365 * 3) return 1;
  return 0;
}

/**
 * nas_file_chunks.content trigram ILIKE + 경로·중요·최근 가중 순위.
 * 임베딩 불필요.
 */
export async function searchNasTextKeyword(
  admin: SupabaseClient,
  query: string,
  opts?: { limit?: number }
): Promise<NasTextKeywordHit[]> {
  const limit = opts?.limit ?? 24;
  const terms = tokenizeQuery(query);
  if (terms.length === 0) return [];

  // 본문 trigram — 가장 긴 토큰 우선
  const bodyTerms = [...terms].sort((a, b) => b.length - a.length).slice(0, 4);
  const chunkByPath = new Map<
    string,
    { seq: number; content: string; score: number }
  >();

  await Promise.all(
    bodyTerms.map(async (term) => {
      const pattern = `%${escapeIlike(term)}%`;
      const { data, error } = await admin
        .from("nas_file_chunks")
        .select("path, seq, content")
        .ilike("content", pattern)
        .limit(80);
      if (error) {
        console.error("[luna/nas-text-kw] chunks", term, error);
        return;
      }
      for (const row of (data ?? []) as {
        path: string;
        seq: number;
        content: string;
      }[]) {
        if (!row.path) continue;
        const prev = chunkByPath.get(row.path);
        const bodyScore = 3 + Math.min(4, Math.floor(term.length / 4));
        if (!prev || bodyScore > prev.score) {
          chunkByPath.set(row.path, {
            seq: row.seq,
            content: row.content ?? "",
            score: bodyScore
          });
        }
      }
    })
  );

  // 경로 후보 (본문에 없어도 파일명·폴더명 일치)
  const pathHits = new Map<string, { drive: string | null; modified_at: string | null }>();
  await Promise.all(
    terms.slice(0, 6).map(async (term) => {
      const pattern = `%${escapeIlike(term)}%`;
      const { data, error } = await admin
        .from("nas_directory")
        .select("path, drive, modified_at")
        .ilike("path", pattern)
        .limit(60);
      if (error) {
        console.error("[luna/nas-text-kw] path", term, error);
        return;
      }
      for (const row of (data ?? []) as {
        path: string;
        drive: string | null;
        modified_at: string | null;
      }[]) {
        if (!row.path) continue;
        pathHits.set(row.path, {
          drive: row.drive ?? null,
          modified_at: row.modified_at ?? null
        });
      }
    })
  );

  const allPaths = new Set([...chunkByPath.keys(), ...pathHits.keys()]);
  if (allPaths.size === 0) return [];

  const pathList = [...allPaths].slice(0, 200);

  const [{ data: dirRows }, { data: impRows }, { data: textRows }] =
    await Promise.all([
      admin
        .from("nas_directory")
        .select("path, drive, modified_at, importance")
        .in("path", pathList),
      admin.from("nas_important_paths").select("path").limit(2000),
      admin
        .from("nas_file_text")
        .select("path, drive, modified_at")
        .in("path", pathList)
    ]);

  const dirByPath = new Map(
    ((dirRows ?? []) as {
      path: string;
      drive: string | null;
      modified_at: string | null;
      importance: number | null;
    }[]).map((r) => [r.path, r])
  );
  const textByPath = new Map(
    ((textRows ?? []) as {
      path: string;
      drive: string | null;
      modified_at: string | null;
    }[]).map((r) => [r.path, r])
  );

  const important = new Set<string>();
  for (const row of (impRows ?? []) as { path: string }[]) {
    const p = (row.path ?? "").replace(/\//g, "\\").toLowerCase();
    if (p) important.add(p);
  }

  // 질문 토큰이 프로젝트 루트와 겹치면 같은 프로젝트 가산
  const qLower = query.toLowerCase();
  const hits: NasTextKeywordHit[] = [];

  for (const path of pathList) {
    const chunk = chunkByPath.get(path);
    const dir = dirByPath.get(path);
    const meta = textByPath.get(path) ?? pathHits.get(path);
    const drive = dir?.drive ?? meta?.drive ?? null;
    const modified_at = dir?.modified_at ?? meta?.modified_at ?? null;
    const base = pathBasename(path);
    const pathNorm = path.replace(/\//g, "\\");
    const pathLower = pathNorm.toLowerCase();
    const baseLower = base.toLowerCase();

    let score = chunk?.score ?? 0;
    const reasons: string[] = [];
    if (chunk) reasons.push("본문");

    let pathHit = false;
    let nameHit = false;
    for (const term of terms) {
      const t = term.toLowerCase();
      if (baseLower.includes(t)) {
        nameHit = true;
        score += 10;
      } else if (pathLower.includes(t)) {
        pathHit = true;
        score += 6;
      }
    }
    if (nameHit) reasons.push("파일명");
    else if (pathHit) reasons.push("경로");

    const isImp = [...important].some(
      (ip) => pathLower === ip || pathLower.startsWith(ip + "\\")
    );
    if (isImp) {
      score += 5;
      reasons.push("중요경로");
    }
    if ((dir?.importance ?? 0) > 0) {
      score += Math.min(4, dir!.importance!);
      reasons.push("importance");
    }

    const recent = recentBoost(modified_at);
    if (recent > 0) {
      score += recent;
      reasons.push("최근");
    }

    const prefix = projectPrefix(pathNorm);
    if (prefix && qLower.includes(prefix.slice(0, 8).toLowerCase())) {
      score += 3;
      reasons.push("프로젝트");
    }

    if (score <= 0) continue;

    const snippet = (chunk?.content ?? base).replace(/\s+/g, " ").slice(0, 160);
    hits.push({
      path,
      drive,
      seq: chunk?.seq ?? 0,
      snippet,
      score,
      reasons,
      modified_at,
      important: isImp
    });
  }

  hits.sort((a, b) => b.score - a.score || (b.modified_at ?? "").localeCompare(a.modified_at ?? ""));
  return hits.slice(0, limit);
}
