import type { SupabaseClient } from "@supabase/supabase-js";
import {
  naturePathTokens,
  type AskedWhat
} from "@/lib/luna/ask-what";
import { isGarbage3dPath } from "@/lib/luna/media-index-rules";
import { pathVariantsForTerm } from "@/lib/luna/named-entities";

export type PeekFolder = {
  drive: string;
  path: string;
  name: string;
};

export type ProjectPeek = {
  projectRoots: PeekFolder[];
  natureFolders: PeekFolder[];
  childSplits: PeekFolder[];
  seenFolderLabels: string[];
  clarify: { question: string; options: string[] } | null;
};

function folderName(path: string): string {
  const parts = path.replace(/\//g, "\\").split("\\").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function parentPath(path: string): string {
  const n = path.replace(/\//g, "\\").replace(/\\+$/g, "");
  const i = n.lastIndexOf("\\");
  return i > 0 ? n.slice(0, i) : n;
}

function isProjectRootSeg(seg: string, phrases: string[]): boolean {
  if (!/^\d{6}\s+/.test(seg)) return false;
  const low = seg.toLowerCase();
  return phrases.some((p) => low.includes(p.toLowerCase()));
}

function natureFolderRe(asked: AskedWhat): RegExp | null {
  if (asked.nature === "kv") {
    return /(^|\\|\s)kv(\s|,|$|\\)|키비주얼|영상시뮬레이션/i;
  }
  if (asked.nature === "storyboard") {
    return /스토리보드|storyboard|(^|\\)[^\\]*콘티([^\\]|$)/i;
  }
  if (asked.nature === "reference") {
    return /(^|\\)(?:\d+\s*)?(?:reference|references|referecnces|referneces|refs?|레퍼런스|참고)(?:s)?(?:$|\\)/i;
  }
  if (asked.nature === "quote") return /견적/;
  return null;
}

const CHILD_SPLIT_RE = /render|소스|source|simulation|시뮬레이션/i;

function uniqueFolders(rows: PeekFolder[]): PeekFolder[] {
  const seen = new Set<string>();
  const out: PeekFolder[] = [];
  for (const row of rows) {
    const key = `${row.drive}:${row.path}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function emptyProjectPeek(): ProjectPeek {
  return {
    projectRoots: [],
    natureFolders: [],
    childSplits: [],
    seenFolderLabels: [],
    clarify: null
  };
}

/** 실제로 본 폴더 이름으로만 되묻기. 없는 선택지는 만들지 않는다. */
export function buildPeekClarify(opts: {
  displayProject: string | null;
  natureLabel: string;
  natureFolders: PeekFolder[];
  childSplits: PeekFolder[];
}): { question: string; options: string[] } | null {
  const name = opts.displayProject || "이 프로젝트";
  if (opts.natureFolders.length >= 2) {
    const options = opts.natureFolders.map((f) => f.name).slice(0, 5);
    if (options.length < 2) return null;
    const listed = options.join(" · ");
    const kind = opts.natureLabel || "자료";
    return {
      question: `${name}에 ${kind} 폴더가 둘 있어요. ${listed}. 어느 쪽이요?`,
      options
    };
  }
  if (opts.natureFolders.length === 1 && opts.childSplits.length >= 2) {
    const options = opts.childSplits.map((f) => f.name).slice(0, 5);
    if (options.length < 2) return null;
    return {
      question: `${opts.natureFolders[0]!.name} 안에 ${options.join(" · ")} 가 있어요. 어느 쪽이요?`,
      options
    };
  }
  return null;
}

function rowToFolder(row: { drive?: string | null; path: string }): PeekFolder {
  return {
    drive: (row.drive || "T").toUpperCase(),
    path: row.path,
    name: folderName(row.path)
  };
}

async function queryFolders(
  admin: SupabaseClient,
  phrases: string[],
  extra: string[],
  limit: number
): Promise<PeekFolder[]> {
  if (phrases.length === 0) return [];
  let query = admin
    .from("nas_directory")
    .select("drive, path, type")
    .eq("type", "folder")
    .order("importance", { ascending: false })
    .limit(limit);

  for (const phrase of [...phrases, ...extra]) {
    const variants = pathVariantsForTerm(phrase);
    if (variants.length === 1) {
      query = query.ilike("path", `%${variants[0]}%`);
    } else if (variants.length > 1) {
      const orClause = variants.map((v) => `path.ilike.%${v}%`).join(",");
      query = query.or(orClause);
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error("[luna/project-peek] folders", error);
    return [];
  }
  let rows = ((data ?? []) as Array<{ drive: string | null; path: string }>).map(
    rowToFolder
  );
  rows = rows.filter((r) => !isGarbage3dPath(r.path));
  if (extra.length > 0) {
    rows = rows.filter((r) =>
      extra.every((tok) => {
        const variants = pathVariantsForTerm(tok);
        const low = r.path.toLowerCase();
        return (
          variants.some((v) => low.includes(v.toLowerCase())) ||
          low.includes(tok.toLowerCase())
        );
      })
    );
  }
  return uniqueFolders(rows);
}

/**
 * 답하기 전에 DB 를 본다 — 그 프로젝트 폴더에 무엇이 있는지.
 */
export async function peekProjectFolders(
  admin: SupabaseClient,
  asked: AskedWhat
): Promise<ProjectPeek> {
  if (asked.projectPhrases.length === 0) return emptyProjectPeek();

  const extra = [...asked.extraTokens, ...naturePathTokens(asked.nature)].slice(
    0,
    4
  );
  const extraRows = await queryFolders(
    admin,
    asked.projectPhrases.slice(0, 2),
    extra,
    80
  );
  const rows =
    extraRows.length > 0
      ? extraRows
      : await queryFolders(admin, asked.projectPhrases.slice(0, 2), [], 80);

  const projectRoots = uniqueFolders(
    rows.filter((r) =>
      r.path.split("\\").some((seg) => isProjectRootSeg(seg, asked.projectPhrases))
    )
  ).filter((r) => {
    const segs = r.path.split("\\");
    const idx = segs.findIndex((s) => isProjectRootSeg(s, asked.projectPhrases));
    return idx >= 0 && segs.length <= idx + 1;
  });

  const rootsFallback = projectRoots.length > 0
    ? projectRoots
    : uniqueFolders(
        rows
          .map((r) => {
            const segs = r.path.split("\\");
            const idx = segs.findIndex((s) =>
              isProjectRootSeg(s, asked.projectPhrases)
            );
            if (idx < 0) return null;
            return {
              drive: r.drive,
              path: segs.slice(0, idx + 1).join("\\"),
              name: segs[idx]!
            };
          })
          .filter((x): x is PeekFolder => Boolean(x))
      );

  const natureRe = natureFolderRe(asked);
  let natureFolders = natureRe
    ? uniqueFolders(rows.filter((r) => natureRe.test(r.path)))
    : [];

  if (asked.extraTokens.length > 0) {
    const extraHits = uniqueFolders(
      rows.filter((r) =>
        asked.extraTokens.every((tok) => {
          const variants = pathVariantsForTerm(tok);
          const low = r.path.toLowerCase();
          return (
            variants.some((v) => low.includes(v.toLowerCase())) ||
            low.includes(tok.toLowerCase())
          );
        })
      )
    );
    if (extraHits.length > 0) {
      const named = extraHits.filter((f) =>
        asked.extraTokens.some((tok) =>
          f.name.toLowerCase().includes(tok.toLowerCase())
        )
      );
      const pick = named.length > 0 ? named : extraHits;
      pick.sort((a, b) => b.path.length - a.path.length);
      natureFolders = [pick[0]!];
    } else {
      natureFolders = [];
    }
  } else if (natureFolders.length > 1) {
    const shallow = natureFolders.filter((f) => {
      return !natureFolders.some(
        (o) => o.path !== f.path && f.path.startsWith(`${o.path}\\`)
      );
    });
    natureFolders = uniqueFolders(shallow).slice(0, 8);
    const dated = natureFolders.filter((f) => /^\d{6}/.test(f.name));
    if (dated.length >= 2) natureFolders = dated;
  }

  let childSplits: PeekFolder[] = [];
  if (natureFolders.length === 1) {
    const base = natureFolders[0]!.path;
    childSplits = uniqueFolders(
      rows.filter(
        (r) =>
          r.path.startsWith(`${base}\\`) &&
          parentPath(r.path) === base &&
          CHILD_SPLIT_RE.test(r.name)
      )
    );
  }

  const seenFolderLabels = [
    ...rootsFallback.map((r) => r.name),
    ...natureFolders.map((r) => r.name)
  ]
    .filter((n, i, arr) => arr.indexOf(n) === i)
    .slice(0, 6);

  const natureLabel =
    asked.nature === "kv"
      ? "KV"
      : asked.nature === "storyboard"
        ? "스토리보드"
        : asked.nature === "reference"
          ? "레퍼런스"
          : asked.nature === "quote"
            ? "견적"
            : "자료";

  const clarify = buildPeekClarify({
    displayProject: asked.displayProject,
    natureLabel,
    natureFolders,
    childSplits
  });

  console.log("[luna/project-peek]", {
    project: asked.displayProject,
    roots: rootsFallback.map((r) => r.name),
    nature: natureFolders.map((r) => r.name),
    childSplits: childSplits.map((r) => r.name),
    clarify: clarify?.question ?? null
  });

  return {
    projectRoots: rootsFallback,
    natureFolders,
    childSplits,
    seenFolderLabels,
    clarify
  };
}

/**
 * 폴더 이름으로 nas_directory 를 찾는다.
 * 임베딩이 없어도 「어벤저스」「Referecnces」가 경로에 있으면 잡힌다.
 */
export async function searchNasFoldersByName(
  admin: SupabaseClient,
  asked: AskedWhat,
  limit = 40
): Promise<Array<{ drive: string | null; path: string; type: string | null }>> {
  if (asked.projectPhrases.length === 0) return [];
  const terms = [
    asked.projectPhrases[0]!,
    ...asked.extraTokens,
    ...naturePathTokens(asked.nature)
  ].filter(Boolean);
  let query = admin
    .from("nas_directory")
    .select("drive, path, type, importance, file_summary, modified_at")
    .order("importance", { ascending: false })
    .limit(limit);

  for (const term of terms) {
    const variants = pathVariantsForTerm(term);
    if (variants.length === 0) continue;
    if (variants.length === 1) {
      query = query.ilike("path", `%${variants[0]}%`);
    } else {
      query = query.or(variants.map((v) => `path.ilike.%${v}%`).join(","));
    }
  }

  const { data, error } = await query;
  if (error) {
    console.error("[luna/project-peek] nas-by-name", error);
    return [];
  }
  return ((data ?? []) as Array<{
    drive: string | null;
    path: string;
    type: string | null;
  }>).filter((r) => !isGarbage3dPath(r.path));
}
