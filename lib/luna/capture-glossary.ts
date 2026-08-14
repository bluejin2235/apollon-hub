import { normalizeCategories } from "@/lib/glossary/categories";
import { sanitizeGlossaryField } from "@/lib/luna/candidate-format";
import { extractKeyNouns } from "@/lib/luna/reflect-guard";

export type RawCaptureItem = {
  content: string;
  evidence: string | null;
  scope_suggestion: "org" | "personal" | null;
  category: string;
  from_correction: boolean;
  term_ko?: string | null;
  term_en?: string | null;
};

export type ProcessedCaptureItem = RawCaptureItem & {
  category: string;
  meta: Record<string, unknown>;
};

const KNOWLEDGE_NOT_TERM =
  /(?:선금|수금|착수|절차|순서|먼저|다음에|후에|~면|으면|줄면|늘면|판단|기준|조정|\d+\s*개(?:다|이다|예요|입니다))/;

const TERM_DEFINITION =
  /(?:는|은|이)\s+(?:[^。]{0,40}(?:아니(?:라|다|며|고|죠|요|습니다)|동일|같은\s+(?:사람|역할|뜻|의미)|의미(?:하|로)|뜻(?:이|은|은)|역할|오너|담당|단계|범위|정의|맡(?:는|음|기)|포함|해당))/;

const TERM_CONTRAST = /(?:와|과)\s+[A-Za-z가-힣]{1,20}(?:의\s+)?차이/;
const TERM_NOT_X_BUT_Y = /(?:가|이)\s+아니(?:라|고)/;

export function isTermDefinitionContent(content: string, category?: string): boolean {
  const t = content.trim();
  if (!t) return false;
  if (category === "term") return !KNOWLEDGE_NOT_TERM.test(t);
  if (KNOWLEDGE_NOT_TERM.test(t)) return false;
  return TERM_DEFINITION.test(t) || TERM_CONTRAST.test(t) || TERM_NOT_X_BUT_Y.test(t);
}

function findEnglishForAbbrev(text: string, abbrev: string): string | null {
  const re = new RegExp(
    `\\b${abbrev.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*\\(\\s*([A-Za-z][A-Za-z\\s\\-]{1,40})\\s*\\)`
  );
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

export function extractTermFromCapture(
  content: string,
  evidence: string | null,
  transcript?: string,
  llmTermKo?: string | null,
  llmTermEn?: string | null
): { term_ko: string; term_en: string | null } | null {
  const llmKo =
    typeof llmTermKo === "string" ? sanitizeGlossaryField("term_ko", llmTermKo) : "";
  const llmEn =
    typeof llmTermEn === "string" ? sanitizeGlossaryField("term_en", llmTermEn) : "";
  if (llmKo) {
    return { term_ko: llmKo, term_en: llmEn || findEnglishForAbbrev(content, llmKo) };
  }

  const blob = [content, evidence ?? "", transcript ?? ""].join("\n");
  const paren = blob.match(/\b([A-Z]{2,10})\s*\(\s*([A-Za-z][A-Za-z\s\-]{1,40})\s*\)/);
  if (paren) return { term_ko: paren[1], term_en: paren[2].trim() };

  if (transcript) {
    const qm = transcript.match(
      /(?:User|사용자)[^:\n]*:\s*[^?\n]*?([A-Za-z]{2,10}|[가-힣]{2,15})(?:가|은|는|이)\s*(?:뭐|무엇|뭔|어떤|무슨)/i
    );
    if (qm) {
      const ko = qm[1].trim();
      return { term_ko: ko, term_en: findEnglishForAbbrev(blob, ko) };
    }
  }

  for (const s of [content, evidence ?? ""]) {
    if (!s.trim()) continue;
    const enLead = s.match(
      /(?:^|[.。]\s*|\s에서\s+)([A-Z]{2,10})(?:\([^)]+\))?\s*(?:는|은|이)\s/
    );
    if (enLead) {
      const ko = enLead[1];
      return { term_ko: ko, term_en: findEnglishForAbbrev(s, ko) };
    }
    const koLead = s.match(/(?:^|[.。]\s*)([가-힣]{2,20})(?:는|은|이)\s+(?:[^。]{4,})/);
    if (koLead) return { term_ko: koLead[1].trim(), term_en: null };
  }

  return null;
}

export function stripTermLeadFromDefinition(
  content: string,
  term_ko: string,
  term_en: string | null
): string {
  let def = content.trim();
  const esc = term_ko.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
  def = def.replace(
    new RegExp(`^(?:[^.。]{0,30}(?:에서\\s+)?)?${esc}(?:\\s*\\([^)]+\\))?\\s*(?:는|은|이)\\s*`, "i"),
    ""
  );
  return def.trim() || content.trim();
}

function termKey(term_ko: string): string {
  return term_ko.trim().toLowerCase();
}

function sharesTermWithContent(term_ko: string, text: string): boolean {
  const key = termKey(term_ko);
  if (!key) return false;
  if (text.toLowerCase().includes(key)) return true;
  return extractKeyNouns(text).has(key);
}

function buildGlossaryMeta(
  item: RawCaptureItem,
  term_ko: string,
  term_en: string | null
): Record<string, unknown> {
  const definition = stripTermLeadFromDefinition(item.content, term_ko, term_en);
  const categories = normalizeCategories(undefined, "common");
  const meta: Record<string, unknown> = {
    kind: "glossary",
    term_ko,
    term_en: term_en || null,
    term_zh: null,
    definition,
    categories,
    synonyms: []
  };
  if (item.from_correction) meta.from_correction = true;
  return meta;
}

export function processCaptureItems(
  items: RawCaptureItem[],
  transcript: string,
  existingTermKeys: Set<string>
): ProcessedCaptureItem[] {
  const glossaryByTerm = new Map<string, ProcessedCaptureItem>();
  const knowledge: ProcessedCaptureItem[] = [];

  for (const item of items) {
    const asTerm =
      item.category === "term" || isTermDefinitionContent(item.content, item.category);

    if (asTerm) {
      const extracted = extractTermFromCapture(
        item.content,
        item.evidence,
        transcript,
        item.term_ko,
        item.term_en
      );
      if (!extracted?.term_ko) {
        knowledge.push({
          ...item,
          category: item.category === "term" ? "general" : item.category,
          meta: item.from_correction ? { from_correction: true } : {}
        });
        continue;
      }

      const key = termKey(extracted.term_ko);
      if (existingTermKeys.has(key) || glossaryByTerm.has(key)) continue;

      glossaryByTerm.set(key, {
        ...item,
        category: "term",
        content: stripTermLeadFromDefinition(
          item.content,
          extracted.term_ko,
          extracted.term_en
        ),
        meta: buildGlossaryMeta(item, extracted.term_ko, extracted.term_en)
      });
      continue;
    }

    knowledge.push({
      ...item,
      meta: item.from_correction ? { from_correction: true } : {}
    });
  }

  const glossaryTerms = [...glossaryByTerm.values()];
  const filteredKnowledge = knowledge.filter((k) =>
    !glossaryTerms.some((g) => {
      const ko = typeof g.meta.term_ko === "string" ? g.meta.term_ko : "";
      return ko && sharesTermWithContent(ko, k.content);
    })
  );

  return [...glossaryTerms, ...filteredKnowledge];
}

export function collectExistingTermKeys(
  rows: Array<{ meta?: unknown; category?: string | null }>
): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    const meta =
      row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : {};
    const ko =
      typeof meta.term_ko === "string"
        ? sanitizeGlossaryField("term_ko", meta.term_ko)
        : "";
    if (ko) keys.add(termKey(ko));
  }
  return keys;
}
