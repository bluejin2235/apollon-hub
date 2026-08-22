/**
 * 이미지 색인 비전 프롬프트 — 시범·모델 비교가 동일 문구를 쓴다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractInlineSynonyms,
  normalizeSynonyms
} from "@/lib/glossary/synonyms";
import {
  GLOSSARY_VISUAL_NEEDLES,
  type FolderCategory,
  type MediaPathParts
} from "./media-path-parse";

export type MediaGlossaryTerm = {
  term_ko: string;
  term_en: string | null;
  definition: string;
  synonyms: string[];
};

/** DB synonyms 미등록이지만 본문·검색에서 쓰는 표현 → term_ko */
const GLOSSARY_EXTRA_SYNONYMS: Record<string, string[]> = {
  "미디어 스컬프처": ["미디어 조형물"]
};

export type MediaVisionParsed = {
  description: string;
  purpose: string;
  author: string;
  ai_category: string;
  terms_used: string[];
};

export function formatGlossaryBlock(terms: MediaGlossaryTerm[]): string {
  if (terms.length === 0) return "(용어 없음)";
  return terms
    .map((t) => {
      const en = t.term_en ? ` (${t.term_en})` : "";
      return `- ${t.term_ko}${en} — ${t.definition}`;
    })
    .join("\n");
}

export async function loadVisualGlossary(
  admin: SupabaseClient
): Promise<MediaGlossaryTerm[]> {
  const needles = [...GLOSSARY_VISUAL_NEEDLES];
  const { data, error } = await admin
    .from("glossary_terms")
    .select("term_ko, term_en, definition, synonyms, deleted_at")
    .not("definition", "is", null)
    .limit(2000);
  if (error) {
    console.warn("[media-vision glossary]", error.message);
    return [];
  }
  const rows = (data ?? []).filter(
    (r) => !r.deleted_at && String(r.definition ?? "").trim()
  );
  const hit: MediaGlossaryTerm[] = [];
  for (const r of rows) {
    const hay = `${r.term_ko ?? ""} ${r.term_en ?? ""}`;
    if (needles.some((n) => hay.includes(n))) {
      const extracted = extractInlineSynonyms(
        String(r.definition),
        normalizeSynonyms(r.synonyms)
      );
      hit.push({
        term_ko: r.term_ko,
        term_en: r.term_en,
        definition: extracted.definition.slice(0, 120),
        synonyms: normalizeSynonyms([
          ...extracted.synonyms,
          ...(GLOSSARY_EXTRA_SYNONYMS[r.term_ko] ?? [])
        ])
      });
    }
  }
  return hit.slice(0, 50);
}

export async function loadNotionProjectContexts(
  admin: SupabaseClient,
  projectNeedle: string
): Promise<string | null> {
  const needle = projectNeedle.trim() || "삼성디스플레이";
  const { data: pages, error } = await admin
    .from("luna_notion_pages")
    .select("page_id, title, nas_path")
    .not("nas_path", "is", null)
    .ilike("nas_path", `%${needle}%`)
    .limit(40);
  if (error) {
    console.warn("[media-vision notion]", error.message);
    return null;
  }
  const blocks: string[] = [];
  for (const p of pages ?? []) {
    const { data: chunks } = await admin
      .from("luna_notion_chunks")
      .select("text, heading")
      .eq("page_id", p.page_id)
      .order("position", { ascending: true })
      .limit(4);
    const body = (chunks ?? [])
      .map(
        (c) =>
          `${c.heading ? `[${c.heading}] ` : ""}${(c.text ?? "").slice(0, 280)}`
      )
      .join("\n")
      .slice(0, 900);
    if (body.trim()) blocks.push(`「${p.title}」\n${body}`);
    if (blocks.length >= 2) break;
  }
  if (blocks.length === 0) return null;
  return blocks.join("\n---\n").slice(0, 1200);
}

export function buildMediaVisionPrompt(opts: {
  path: string;
  parts: MediaPathParts;
  folderCategory: FolderCategory;
  glossary: string;
  projectContext: string | null;
}): string {
  return `당신은 아폴론(미디어·공간 디자인) 아카이브 사서다. 이미지를 보고 JSON만 답한다.

[전체 경로]
${opts.path}

[경로 해석]
${opts.parts.summary}
- 최상위: ${opts.parts.rootClass ?? "-"}
- 연도: ${opts.parts.year ?? "-"}
- 프로젝트: ${opts.parts.project ?? "-"}
- 단계: ${opts.parts.stageCode ?? "-"} ${opts.parts.stageName ?? ""}
- 주체: ${opts.parts.actor ?? "-"} (${opts.parts.actorKind ?? "-"})
- 날짜/차수: ${opts.parts.dateToken ?? "-"} / ${opts.parts.variant ?? "-"}
- 작업: ${opts.parts.workKind ?? "-"}
- 폴더규칙 분류(참고): ${opts.folderCategory}

[프로젝트 노션 맥락 — 있으면 활용, 없으면 무시]
${opts.projectContext ?? "(없음)"}

[아폴론 용어 — 해당할 때만 쓰고 억지로 끼워넣지 마라]
${opts.glossary}

분류(ai_category) 후보: reference | provided | our_design | field_photo | field_test | unclassified
- 폴더에 「레퍼런스」가 있어도 홍보·포트폴리오·still cut 이면 field_photo 일 수 있다.

JSON 스키마:
{
  "description": "이미지 자체 설명 100~200자 한국어",
  "purpose": "용도 한 줄 (경로+이미지)",
  "author": "누가 (아폴론/협력사/이니셜)",
  "ai_category": "위 후보 중 하나",
  "terms_used": ["쓴 아폴론 용어 term_ko 배열, 없으면 []"]
}`;
}

export function parseMediaVisionJson(text: string): MediaVisionParsed {
  const t = text.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return {
      description: t.slice(0, 240),
      purpose: "",
      author: "",
      ai_category: "unclassified",
      terms_used: []
    };
  }
  try {
    const v = JSON.parse(t.slice(start, end + 1)) as Record<string, unknown>;
    return {
      description: String(v.description ?? "").slice(0, 400),
      purpose: String(v.purpose ?? "").slice(0, 200),
      author: String(v.author ?? "").slice(0, 80),
      ai_category: String(v.ai_category ?? "unclassified"),
      terms_used: Array.isArray(v.terms_used)
        ? v.terms_used
            .filter((x): x is string => typeof x === "string")
            .slice(0, 12)
        : []
    };
  } catch {
    return {
      description: t.slice(0, 240),
      purpose: "",
      author: "",
      ai_category: "unclassified",
      terms_used: []
    };
  }
}
