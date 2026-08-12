import { clipText, formatShortDate, sourceLabel } from "@/lib/luna/knowledge-format";
import type { CandidateSource } from "@/lib/luna/candidates";

export type GlossaryDraft = {
  term_ko: string;
  term_en: string | null;
  term_zh: string | null;
  term_zh_pron: string | null;
  definition: string;
  category: "common" | "interior" | "hw";
};

export type CandidateCardKind = "glossary" | "selfstudy" | "dialogue" | "general";

export function isGlossaryCandidate(
  meta: Record<string, unknown> | null | undefined,
  category?: string | null
): boolean {
  if (meta?.kind === "glossary") return true;
  if (category === "term") return true;
  if (typeof meta?.term_ko === "string" && meta.term_ko.trim()) return true;
  return false;
}

export function parseGlossaryMeta(
  meta: Record<string, unknown> | null | undefined,
  content: string
): GlossaryDraft {
  const m = meta ?? {};
  const term_ko =
    (typeof m.term_ko === "string" && m.term_ko.trim()) ||
    content.split("\n")[0]?.trim() ||
    content.trim().slice(0, 80);
  const cat = m.category;
  const category: GlossaryDraft["category"] =
    cat === "interior" || cat === "hw" ? cat : "common";
  return {
    term_ko,
    term_en: typeof m.term_en === "string" && m.term_en.trim() ? m.term_en.trim() : null,
    term_zh: typeof m.term_zh === "string" && m.term_zh.trim() ? m.term_zh.trim() : null,
    term_zh_pron:
      typeof m.term_zh_pron === "string" && m.term_zh_pron.trim()
        ? m.term_zh_pron.trim()
        : null,
    definition:
      (typeof m.definition === "string" && m.definition.trim()) ||
      (typeof m.definition_draft === "string" && m.definition_draft.trim()) ||
      content.trim(),
    category
  };
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
  glossaryCategory?: GlossaryDraft["category"]
): string | null {
  if (scope === "org") return "조직 제안";
  if (scope === "personal") return "개인 제안";
  if (glossaryCategory === "common") return "공통 제안";
  if (glossaryCategory === "interior") return "인테리어 제안";
  if (glossaryCategory === "hw") return "HW 제안";
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
