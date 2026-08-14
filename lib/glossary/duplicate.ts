import { normalizeCategories } from "@/lib/glossary/categories";
import { normalizeSynonyms } from "@/lib/glossary/synonyms";
import type {
  GlossaryCategory,
  GlossaryFieldValues
} from "@/lib/glossary/types";

export type GlossaryDupKind =
  | "term_ko"
  | "term_en"
  | "term_zh"
  | "new_name_is_synonym"
  | "new_synonym_is_name";

export type GlossaryDupTerm = {
  id: string;
  term_ko: string;
  term_en: string | null;
  term_zh: string | null;
  categories: GlossaryCategory[];
  synonyms: string[];
  definition: string | null;
  version: number;
  updated_at: string | null;
  updated_by: string | null;
  updated_by_name: string | null;
};

export type GlossaryDupMatch = {
  kind: GlossaryDupKind;
  message: string;
  value: string;
  existing_id: string;
  existing_term_ko: string;
};

export type GlossaryDupResult = {
  conflicts: boolean;
  primary: GlossaryDupMatch | null;
  others: GlossaryDupMatch[];
  existing: GlossaryDupTerm | null;
};

const KIND_RANK: Record<GlossaryDupKind, number> = {
  term_ko: 0,
  term_en: 1,
  term_zh: 2,
  new_name_is_synonym: 3,
  new_synonym_is_name: 4
};

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function display(s: string | null | undefined): string {
  return (s ?? "").trim();
}

export function toFieldValues(term: GlossaryDupTerm): GlossaryFieldValues {
  return {
    term_ko: term.term_ko ?? "",
    term_en: term.term_en ?? "",
    term_zh: term.term_zh ?? "",
    synonyms: [...(term.synonyms ?? [])],
    definition: term.definition ?? "",
    categories:
      term.categories?.length > 0 ? [...term.categories] : (["공통"] as GlossaryCategory[])
  };
}

export function mapGlossaryTermRow(row: Record<string, unknown>): GlossaryDupTerm {
  return {
    id: String(row.id),
    term_ko: typeof row.term_ko === "string" ? row.term_ko : "",
    term_en: typeof row.term_en === "string" ? row.term_en : null,
    term_zh: typeof row.term_zh === "string" ? row.term_zh : null,
    categories: normalizeCategories(row.categories, row.category),
    synonyms: normalizeSynonyms(row.synonyms),
    definition: typeof row.definition === "string" ? row.definition : null,
    version: Number(row.version) || 1,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
    updated_by: typeof row.updated_by === "string" ? row.updated_by : null,
    updated_by_name: null
  };
}

function matchMessage(
  kind: GlossaryDupKind,
  value: string,
  existingTermKo: string
): string {
  switch (kind) {
    case "term_ko":
      return `한국어 이름이 같습니다 — ${value}`;
    case "term_en":
      return `영문 이름이 같습니다 — ${value} (기존 용어: ${existingTermKo})`;
    case "term_zh":
      return `중문 이름이 같습니다 — ${value} (기존 용어: ${existingTermKo})`;
    case "new_name_is_synonym":
      return `새 용어명이 기존 용어의 동의어와 같습니다 — ${value} (기존 용어: ${existingTermKo})`;
    case "new_synonym_is_name":
      return `새 동의어가 다른 용어의 이름과 같습니다 — ${value} (기존 용어: ${existingTermKo})`;
  }
}

/**
 * 활성 용어(deleted_at is null) 목록에 대해 5가지 중복을 검사한다.
 * excludeId: 수정 중인 자기 자신은 제외.
 */
export function findGlossaryDuplicates(
  incoming: GlossaryFieldValues,
  existingTerms: GlossaryDupTerm[],
  opts?: { excludeId?: string | null }
): GlossaryDupResult {
  const excludeId = opts?.excludeId ?? null;
  const ko = display(incoming.term_ko);
  const en = display(incoming.term_en);
  const zh = display(incoming.term_zh);
  const synonyms = normalizeSynonyms(incoming.synonyms);
  const nKo = norm(ko);
  const nEn = norm(en);
  const nZh = norm(zh);
  const incomingNameDisplays = [
    ko ? { n: nKo, d: ko } : null,
    en ? { n: nEn, d: en } : null,
    zh ? { n: nZh, d: zh } : null
  ].filter((x): x is { n: string; d: string } => Boolean(x));

  const matches: GlossaryDupMatch[] = [];
  const seen = new Set<string>(); // kind|existing_id|value

  const push = (
    kind: GlossaryDupKind,
    value: string,
    term: GlossaryDupTerm
  ) => {
    const key = `${kind}|${term.id}|${norm(value)}`;
    if (seen.has(key)) return;
    seen.add(key);
    matches.push({
      kind,
      value,
      existing_id: term.id,
      existing_term_ko: term.term_ko,
      message: matchMessage(kind, value, term.term_ko)
    });
  };

  for (const term of existingTerms) {
    if (excludeId && String(term.id) === String(excludeId)) continue;

    const tKo = display(term.term_ko);
    const tEn = display(term.term_en);
    const tZh = display(term.term_zh);
    const tSyn = normalizeSynonyms(term.synonyms);

    if (nKo && nKo === norm(tKo)) push("term_ko", ko, term);
    if (nEn && tEn && nEn === norm(tEn)) push("term_en", en, term);
    if (nZh && tZh && nZh === norm(tZh)) push("term_zh", zh, term);

    for (const name of incomingNameDisplays) {
      for (const syn of tSyn) {
        if (name.n === norm(syn)) {
          push("new_name_is_synonym", name.d, term);
        }
      }
    }

    for (const syn of synonyms) {
      const ns = norm(syn);
      if (!ns) continue;
      if (ns === norm(tKo) || (tEn && ns === norm(tEn)) || (tZh && ns === norm(tZh))) {
        push("new_synonym_is_name", syn, term);
      }
    }
  }

  if (matches.length === 0) {
    return { conflicts: false, primary: null, others: [], existing: null };
  }

  matches.sort((a, b) => {
    const r = KIND_RANK[a.kind] - KIND_RANK[b.kind];
    if (r !== 0) return r;
    return a.message.localeCompare(b.message, "ko");
  });

  const primary = matches[0]!;
  const others = matches.slice(1);
  const existing =
    existingTerms.find((t) => t.id === primary.existing_id) ?? null;

  return { conflicts: true, primary, others, existing };
}

/** 후보 목록 뱃지용 — 겹침 여부만 */
export function hasAnyGlossaryOverlap(
  incoming: GlossaryFieldValues,
  existingTerms: GlossaryDupTerm[]
): boolean {
  return findGlossaryDuplicates(incoming, existingTerms).conflicts;
}

/** LLM 없을 때 병합 초안 */
export function fallbackMergeDraft(
  existing: GlossaryFieldValues,
  incoming: GlossaryFieldValues
): GlossaryFieldValues {
  const term_ko = display(existing.term_ko) || display(incoming.term_ko);
  const term_en = display(existing.term_en) || display(incoming.term_en);
  const term_zh = display(existing.term_zh) || display(incoming.term_zh);
  const synonyms = normalizeSynonyms([
    ...existing.synonyms,
    ...incoming.synonyms,
    // 서로 다른 이름이면 동의어로 흡수
    ...(display(incoming.term_ko) &&
    norm(incoming.term_ko) !== norm(existing.term_ko)
      ? [incoming.term_ko]
      : []),
    ...(display(incoming.term_en) &&
    norm(incoming.term_en) !== norm(existing.term_en)
      ? [incoming.term_en]
      : []),
    ...(display(incoming.term_zh) &&
    norm(incoming.term_zh) !== norm(existing.term_zh)
      ? [incoming.term_zh]
      : [])
  ]).filter(
    (s) =>
      norm(s) !== norm(term_ko) &&
      norm(s) !== norm(term_en) &&
      norm(s) !== norm(term_zh)
  );

  const a = display(existing.definition);
  const b = display(incoming.definition);
  let definition = a;
  if (b && norm(b) !== norm(a)) {
    definition = a ? `${a}\n\n${b}` : b;
  }

  const categories = normalizeCategories([
    ...existing.categories,
    ...incoming.categories
  ]);

  return {
    term_ko,
    term_en,
    term_zh,
    synonyms,
    definition,
    categories: categories.length > 0 ? categories : (["공통"] as GlossaryCategory[])
  };
}
