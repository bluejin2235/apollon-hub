import type { SupabaseClient } from "@supabase/supabase-js";

export type NamedEntityKind = "brand_group" | "client" | "project";

export type NamedEntity = {
  canonical: string;
  kind: NamedEntityKind;
  parentCanonical: string | null;
  aliases: string[];
  /** path OR 매칭에 쓰는 구. 상위 브랜드 단독(롯데)은 넣지 않는다. */
  searchPhrases: string[];
};

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function phrasesOf(e: NamedEntity): string[] {
  return [e.canonical, ...e.aliases, ...e.searchPhrases]
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);
}

/** 코드 시드. DB `luna_named_entities` 가 있으면 그 값이 우선한다. */
export const NAMED_ENTITY_SEED: NamedEntity[] = [
  {
    canonical: "롯데",
    kind: "brand_group",
    parentCanonical: null,
    aliases: ["롯데그룹", "lotte"],
    searchPhrases: []
  },
  {
    canonical: "롯데면세점",
    kind: "client",
    parentCanonical: "롯데",
    aliases: ["롯데 면세점", "LDF", "롯데면세"],
    searchPhrases: ["롯데면세점", "롯데 면세점"]
  },
  {
    canonical: "롯데월드",
    kind: "client",
    parentCanonical: "롯데",
    aliases: ["롯데월드몰", "롯데 월드"],
    searchPhrases: ["롯데월드", "롯데월드몰"]
  },
  {
    canonical: "롯데물산",
    kind: "client",
    parentCanonical: "롯데",
    aliases: ["롯데 물산"],
    searchPhrases: ["롯데물산"]
  },
  {
    canonical: "롯데타워",
    kind: "project",
    parentCanonical: "롯데",
    aliases: ["롯데 타워", "롯데월드타워"],
    searchPhrases: ["롯데타워", "롯데월드타워"]
  },
  {
    canonical: "스타에비뉴",
    kind: "project",
    parentCanonical: "롯데면세점",
    aliases: [
      "스타 에비뉴",
      "STAR AVENUE",
      "LDF STAR AVENUE",
      "롯데면세점 스타에비뉴",
      "롯데 면세점 스타에비뉴",
      "롯데면세점 명동 리뉴얼"
    ],
    searchPhrases: ["스타에비뉴", "star avenue", "스타 에비뉴"]
  },
  {
    canonical: "인스파이어",
    kind: "project",
    parentCanonical: null,
    aliases: ["INSPIRE", "인스파이어리조트"],
    searchPhrases: ["인스파이어"]
  },
  {
    canonical: "해운대",
    kind: "project",
    parentCanonical: null,
    aliases: ["해운대스퀘어", "해운대 스퀘어"],
    searchPhrases: ["해운대"]
  },
  {
    canonical: "더후",
    kind: "project",
    parentCanonical: null,
    aliases: ["THE WHOO"],
    searchPhrases: ["더후", "the whoo"]
  }
];

export function containsPhrase(haystack: string, phrase: string): boolean {
  const h = norm(haystack);
  const p = norm(phrase);
  if (!p) return false;
  return h.includes(p);
}

/** 가장 긴 구부터. brand_group 는 더 긴 하위 엔티티가 있으면 제외. */
export function matchNamedEntities(
  text: string,
  entities: NamedEntity[] = NAMED_ENTITY_SEED
): NamedEntity[] {
  const scored: { e: NamedEntity; len: number }[] = [];
  for (const e of entities) {
    const hit = phrasesOf(e).find((p) => containsPhrase(text, p));
    if (!hit) continue;
    scored.push({ e, len: norm(hit).length });
  }
  scored.sort((a, b) => b.len - a.len);

  const specific = scored.filter((s) => s.e.kind !== "brand_group").map((s) => s.e);
  if (specific.length > 0) return uniqueEntities(specific);

  return uniqueEntities(scored.map((s) => s.e));
}

function uniqueEntities(list: NamedEntity[]): NamedEntity[] {
  const seen = new Set<string>();
  const out: NamedEntity[] = [];
  for (const e of list) {
    if (seen.has(e.canonical)) continue;
    seen.add(e.canonical);
    out.push(e);
  }
  return out;
}

export function hasSpecificNamedEntity(
  text: string,
  entities: NamedEntity[] = NAMED_ENTITY_SEED
): boolean {
  return matchNamedEntities(text, entities).some((e) => e.kind !== "brand_group");
}

export function pathVariantsForTerm(
  term: string,
  entities: NamedEntity[] = NAMED_ENTITY_SEED
): string[] {
  const cleaned = term.toLowerCase().replace(/[%_,]/g, "").trim();
  if (!cleaned) return [];
  const variants = new Set<string>([cleaned]);
  if (/[가-힣]{2,}서$/.test(cleaned)) {
    variants.add(cleaned.slice(0, -1));
  }

  const matched = entities.find((e) =>
    phrasesOf(e).some((p) => norm(p) === norm(term) || norm(p) === cleaned)
  );
  if (matched && matched.kind !== "brand_group") {
    for (const p of [matched.canonical, ...matched.aliases, ...matched.searchPhrases]) {
      const n = norm(p);
      if (n.length >= 3) variants.add(n);
    }
  }

  return [...variants].filter((v) => v.length >= 2 || /^\d+$/.test(v));
}

/**
 * 질의에 하위 고유명사가 있으면 상위 브랜드 토큰(롯데)을 검색어에서 뺀다.
 * 별칭이 잡히면 canonical 을 검색어에 넣는다.
 */
export function applyNamedEntitiesToTerms(
  terms: string[],
  queryText: string,
  entities: NamedEntity[] = NAMED_ENTITY_SEED
): string[] {
  const hay = `${queryText} ${terms.join(" ")}`;
  const matched = matchNamedEntities(hay, entities);
  const specific = matched.filter((e) => e.kind !== "brand_group");
  let next = [...terms];

  if (specific.length > 0) {
    const drop = new Set<string>();
    for (const e of entities) {
      if (e.kind !== "brand_group") continue;
      const usedAsParent = specific.some(
        (s) =>
          s.parentCanonical === e.canonical ||
          containsPhrase(s.canonical, e.canonical)
      );
      if (usedAsParent) drop.add(norm(e.canonical));
    }
    next = next.filter((t) => !drop.has(norm(t)));

    for (const e of specific) {
      const already = next.some((t) =>
        phrasesOf(e).some((p) => norm(p) === norm(t))
      );
      if (!already) next.unshift(e.canonical);
    }
  }

  return next;
}

type EntityRow = {
  canonical: string;
  kind: string;
  parent_canonical: string | null;
  aliases: unknown;
  search_phrases: unknown;
};

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

export function parseNamedEntityRows(rows: EntityRow[]): NamedEntity[] {
  const out: NamedEntity[] = [];
  for (const row of rows) {
    const canonical = row.canonical?.trim();
    const kind = row.kind;
    if (!canonical) continue;
    if (kind !== "brand_group" && kind !== "client" && kind !== "project") continue;
    out.push({
      canonical,
      kind,
      parentCanonical: row.parent_canonical?.trim() || null,
      aliases: asStringArray(row.aliases),
      searchPhrases: asStringArray(row.search_phrases)
    });
  }
  return out;
}

/** DB 행이 있으면 DB, 없으면 시드. 같은 canonical 은 DB가 덮어씀. */
export function mergeNamedEntities(dbRows: NamedEntity[]): NamedEntity[] {
  if (dbRows.length === 0) return NAMED_ENTITY_SEED;
  const byCanon = new Map<string, NamedEntity>();
  for (const e of NAMED_ENTITY_SEED) byCanon.set(e.canonical, e);
  for (const e of dbRows) byCanon.set(e.canonical, e);
  return [...byCanon.values()];
}

export async function loadNamedEntities(admin: SupabaseClient): Promise<NamedEntity[]> {
  const { data, error } = await admin
    .from("luna_named_entities")
    .select("canonical, kind, parent_canonical, aliases, search_phrases");
  if (error || !data) return NAMED_ENTITY_SEED;
  return mergeNamedEntities(parseNamedEntityRows(data as EntityRow[]));
}
