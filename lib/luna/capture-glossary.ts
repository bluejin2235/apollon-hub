import { normalizeCategories } from "@/lib/glossary/categories";
import { sanitizeGlossaryField } from "@/lib/luna/candidate-format";
import { extractKeyNouns } from "@/lib/luna/reflect-guard";

export type CaptureKind = "term" | "knowledge" | "both";

export type RawCaptureItem = {
  content: string;
  evidence: string | null;
  scope_suggestion: "org" | "personal" | null;
  category: string;
  from_correction: boolean;
  capture_kind?: CaptureKind | null;
  term_ko?: string | null;
  term_en?: string | null;
  definition?: string | null;
  knowledge?: string | null;
};

export type ProcessedCaptureItem = RawCaptureItem & {
  category: string;
  meta: Record<string, unknown>;
};

export function parseCaptureKind(raw: unknown, category?: string): CaptureKind {
  if (raw === "term" || raw === "knowledge" || raw === "both") return raw;
  if (category === "term") return "term";
  return "knowledge";
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
  term_ko: string
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
  term_en: string | null,
  definition: string
): Record<string, unknown> {
  const categories = normalizeCategories(undefined, "common");
  const meta: Record<string, unknown> = {
    kind: "glossary",
    capture_kind: item.capture_kind ?? "term",
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

function toGlossaryItem(
  item: RawCaptureItem,
  transcript: string,
  existingTermKeys: Set<string>,
  glossaryByTerm: Map<string, ProcessedCaptureItem>
): ProcessedCaptureItem | null {
  const extracted = extractTermFromCapture(
    item.definition || item.content,
    item.evidence,
    transcript,
    item.term_ko,
    item.term_en
  );
  const term_ko = extracted?.term_ko?.trim() || "";
  const term_en = extracted?.term_en ?? null;
  if (!term_ko) {
    return {
      ...item,
      category: "term",
      content: (item.definition || item.content).trim(),
      meta: {
        kind: "glossary",
        capture_kind: item.capture_kind ?? "term",
        definition: (item.definition || item.content).trim(),
        ...(item.from_correction ? { from_correction: true } : {})
      }
    };
  }
  const key = termKey(term_ko);
  if (existingTermKeys.has(key) || glossaryByTerm.has(key)) return null;
  const definition = (
    item.definition?.trim() ||
    stripTermLeadFromDefinition(item.content, term_ko)
  ).trim();
  const row: ProcessedCaptureItem = {
    ...item,
    category: "term",
    content: definition,
    meta: buildGlossaryMeta(item, term_ko, term_en, definition)
  };
  glossaryByTerm.set(key, row);
  return row;
}

function toKnowledgeItem(item: RawCaptureItem, content: string): ProcessedCaptureItem {
  return {
    ...item,
    content: content.trim() || item.content,
    category: item.category === "term" ? "general" : item.category,
    meta: {
      capture_kind: item.capture_kind ?? "knowledge",
      ...(item.from_correction ? { from_correction: true } : {})
    }
  };
}

export function processCaptureItems(
  items: RawCaptureItem[],
  transcript: string,
  existingTermKeys: Set<string>
): ProcessedCaptureItem[] {
  const glossaryByTerm = new Map<string, ProcessedCaptureItem>();
  const knowledge: ProcessedCaptureItem[] = [];
  const glossary: ProcessedCaptureItem[] = [];

  for (const item of items) {
    const kind = parseCaptureKind(item.capture_kind, item.category);

    if (kind === "term" || kind === "both") {
      const g = toGlossaryItem(item, transcript, existingTermKeys, glossaryByTerm);
      if (g) glossary.push(g);
    }

    if (kind === "knowledge" || kind === "both") {
      const definition = item.definition?.trim() || "";
      const judgment =
        kind === "both"
          ? item.knowledge?.trim() ||
            (item.content.trim() && item.content.trim() !== definition
              ? item.content.trim()
              : "")
          : item.content;
      if (kind === "knowledge" || judgment) {
        knowledge.push(toKnowledgeItem(item, judgment || item.content));
      }
    }
  }

  const filteredKnowledge = knowledge.filter((k) => {
    if (k.meta.capture_kind === "both") return true;
    return !glossary.some((g) => {
      const ko = typeof g.meta.term_ko === "string" ? g.meta.term_ko : "";
      return ko && sharesTermWithContent(ko, k.content);
    });
  });

  return [...glossary, ...filteredKnowledge];
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
