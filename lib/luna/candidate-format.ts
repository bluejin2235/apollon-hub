import { normalizeCategories } from "@/lib/glossary/categories";
import {
  extractInlineSynonyms,
  normalizeSynonyms
} from "@/lib/glossary/synonyms";
import type {
  GlossaryCategory,
  GlossaryFieldValues
} from "@/lib/glossary/types";
import { clipText, formatShortDate, sourceLabel } from "@/lib/luna/knowledge-format";
import type { CandidateSource } from "@/lib/luna/candidate-types";

export type GlossaryDraft = GlossaryFieldValues;

export type GlossaryMetaPatch = Omit<GlossaryDraft, "term_en" | "term_zh"> & {
  term_en: string | null;
  term_zh: string | null;
};

export type GlossaryEditDraft = GlossaryDraft & {
  movedFromTitle: boolean;
};

export type CandidateCardKind = "glossary" | "selfstudy" | "dialogue" | "general";

const GLOSSARY_FIELD_LABELS: Record<
  "term_ko" | "term_en" | "term_zh",
  readonly string[]
> = {
  term_ko: ["한국어", "용어명"],
  term_en: ["ENGLISH", "English", "english"],
  term_zh: ["中文"]
};

/** 라벨·placeholder 가 실제 값으로 저장된 경우 빈 값으로 취급 */
export function sanitizeGlossaryField(
  field: "term_ko" | "term_en" | "term_zh",
  value: string
): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (GLOSSARY_FIELD_LABELS[field].includes(trimmed)) return "";
  return trimmed;
}

export function isGlossaryCandidate(
  meta: Record<string, unknown> | null | undefined,
  category?: string | null
): boolean {
  if (meta?.kind === "glossary") return true;
  if (category === "term") return true;
  if (typeof meta?.term_ko === "string" && meta.term_ko.trim()) return true;
  return false;
}

/** 용어명 칸에 정의 문장이 들어온 경우 판별 */
export function looksLikeDefinitionSentence(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.length > 40) return true;
  if (/[.。]/.test(t) || /다\./.test(t)) return true;
  // 조사 + 공백 + 서술 — 단어 내부(이머시브 등) 오탐 방지
  if (/(?:는|은|이|가)\s+\S/.test(t)) return true;
  return false;
}

export function parseGlossaryMeta(
  meta: Record<string, unknown> | null | undefined,
  content: string
): GlossaryDraft {
  const m = meta ?? {};
  const hasTermKoKey = Object.prototype.hasOwnProperty.call(m, "term_ko");
  // meta.term_ko 키가 있으면(빈 문자열 포함) 명시값 우선 — 수정 저장 후 빈 용어명 유지
  let term_ko = hasTermKoKey
    ? typeof m.term_ko === "string"
      ? m.term_ko.trim()
      : ""
    : content.split("\n")[0]?.trim() || content.trim().slice(0, 80);
  const categories = normalizeCategories(m.categories, m.category);
  const definitionFromMeta =
    (typeof m.definition === "string" && m.definition.trim()) ||
    (typeof m.definition_draft === "string" && m.definition_draft.trim()) ||
    "";
  let definition = definitionFromMeta || content.trim();

  // meta.term_ko 키는 있으나 빈 문자열 — content 첫 줄에서 용어명 복원
  if (hasTermKoKey && !term_ko) {
    const fromContent =
      content.split("\n")[0]?.trim() || content.trim().slice(0, 80);
    if (fromContent && !looksLikeDefinitionSentence(fromContent)) {
      term_ko = fromContent;
    }
  }

  // 메타에 용어명이 없고 content 가 문장이면 용어명으로 쓰지 않음
  if (!hasTermKoKey && looksLikeDefinitionSentence(term_ko)) {
    definition = definitionFromMeta || term_ko || content.trim();
    term_ko = "";
  }

  term_ko = sanitizeGlossaryField("term_ko", term_ko);
  const term_en =
    typeof m.term_en === "string" && m.term_en.trim()
      ? sanitizeGlossaryField("term_en", m.term_en)
      : "";
  const term_zh =
    typeof m.term_zh === "string" && m.term_zh.trim()
      ? sanitizeGlossaryField("term_zh", m.term_zh)
      : "";

  return {
    term_ko,
    term_en,
    term_zh,
    synonyms: normalizeSynonyms(m.synonyms),
    definition,
    categories
  };
}

/** 카드 제목: 용어명만. 없거나 문장이면 정의 앞 30자 + 용어명 없음 표시 */

/** glossary meta 저장 — categories 배열만 유지, 레거시 category slug 제거 */
export function applyGlossaryMetaPatch(
  prevMeta: Record<string, unknown>,
  patch: GlossaryMetaPatch
): Record<string, unknown> {
  const { category: _legacy, ...rest } = prevMeta;
  return {
    ...rest,
    kind: "glossary",
    term_ko: patch.term_ko,
    term_en: patch.term_en || null,
    term_zh: patch.term_zh || null,
    definition: patch.definition,
    categories: patch.categories,
    synonyms: patch.synonyms
  };
}

/** 카드 제목: 용어명만. 없거나 문장이면 정의 앞 30자 + 용어명 없음 표시 */
export function glossaryCardTitle(draft: GlossaryDraft): {
  title: string;
  missingTerm: boolean;
} {
  const ko = draft.term_ko.trim();
  if (ko && !looksLikeDefinitionSentence(ko)) {
    return { title: ko, missingTerm: false };
  }
  const defSource =
    draft.definition.trim() ||
    (looksLikeDefinitionSentence(ko) ? ko : "");
  if (!defSource) {
    return { title: "—", missingTerm: true };
  }
  const title =
    defSource.length > 30 ? `${defSource.slice(0, 30)}…` : defSource;
  return { title, missingTerm: true };
}

/** 편집 모드 오픈 시 문장형 용어명을 정의로 이동 + 인라인 동의어 분리 */
export function openGlossaryEditDraft(draft: GlossaryDraft): GlossaryEditDraft {
  const extracted = extractInlineSynonyms(draft.definition, draft.synonyms);
  const base = { ...draft, ...extracted };

  if (looksLikeDefinitionSentence(base.term_ko)) {
    const moved = base.term_ko.trim();
    const definition = base.definition.trim() || moved;
    return {
      ...base,
      term_ko: "",
      definition,
      movedFromTitle: true
    };
  }
  // 용어명은 비어 있고 정의만 있는 경우(문장이 content 로만 들어온 데이터)
  if (!base.term_ko.trim() && base.definition.trim()) {
    return { ...base, movedFromTitle: true };
  }
  return { ...base, movedFromTitle: false };
}

export function getCandidateCardKind(input: {
  source: CandidateSource;
  category?: string | null;
  meta?: Record<string, unknown> | null;
  threadLength: number;
}): CandidateCardKind {
  if (isGlossaryCandidate(input.meta, input.category)) return "glossary";
  if (input.source === "selfstudy") return "selfstudy";
  if (input.threadLength > 0 || input.source === "question") return "dialogue";
  return "general";
}

export function scopeBadgeLabel(
  scope: string | null | undefined,
  glossaryCategories?: GlossaryCategory[] | GlossaryCategory
): string | null {
  if (scope === "org") return "조직 제안";
  if (scope === "personal") return "개인 제안";
  const cats = Array.isArray(glossaryCategories)
    ? glossaryCategories
    : glossaryCategories
      ? [glossaryCategories]
      : [];
  if (cats.length > 0) return `${cats[0]} 제안`;
  return null;
}

export function candidateMetaLine(input: {
  source: CandidateSource;
  origin?: string | null;
  author_name?: string | null;
  created_at?: string | null;
  evidence?: string | null;
  meta?: Record<string, unknown> | null;
}): string {
  const parts: string[] = [];
  if (input.source === "chat" && input.author_name) {
    parts.push(`${input.author_name}와의 대화`);
  } else if (input.source === "selfstudy") {
    const topic =
      typeof input.meta?.topic === "string" ? input.meta.topic.trim() : "";
    if (topic) parts.push(topic);
  }
  const when = formatShortDate(input.created_at);
  if (when !== "—") parts.push(when);
  if (input.source === "selfstudy" && input.evidence) {
    const hint = input.evidence.replace(/^출처:\s*/, "").trim();
    if (hint) parts.push(clipText(hint, 40));
  }
  return parts.length > 0 ? parts.join(" · ") : sourceLabel(input.source, input.origin);
}

export function dialogueTurnLabel(threadLength: number): string {
  const n = Math.max(1, Math.ceil(threadLength / 2));
  return `문답 ${n}번째`;
}

export function questionDeadlineLabel(
  created_at: string | null | undefined,
  days = 3
): string | null {
  if (!created_at) return null;
  const created = new Date(created_at);
  if (Number.isNaN(created.getTime())) return null;
  const due = new Date(created.getTime() + days * 24 * 60 * 60 * 1000);
  const left = Math.ceil((due.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (left <= 0) return "기한 지남";
  return `${left}일 남음`;
}

export function selfstudyQuestion(meta: Record<string, unknown> | null | undefined): string | null {
  const q = meta?.question;
  return typeof q === "string" && q.trim() ? q.trim() : null;
}

export const GLOSSARY_MIGRATION_HINT =
  "glossary_terms 테이블이 없습니다. supabase/migrations/glossary_schema.sql 마이그레이션을 적용하세요.";
