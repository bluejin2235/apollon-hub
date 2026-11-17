import type { AltSuggestContext, AltSuggestKind } from "@/lib/website/alt-suggest-types";

/** 글 정보 칸 하나당 최대 글자 수 — 긴 입력으로 AI 비용이 커지지 않게 자른다 */
export const MAX_CONTEXT_FIELD_CHARS = 200;

function field(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  const chars = [...trimmed];
  if (chars.length <= MAX_CONTEXT_FIELD_CHARS) return trimmed;
  return chars.slice(0, MAX_CONTEXT_FIELD_CHARS).join("");
}

/** 요청 본문의 context 를 읽는다. kind 가 work·insight 가 아니면 null */
export function readAltSuggestContext(raw: unknown): AltSuggestContext | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const kind = typeof o.kind === "string" ? o.kind.trim() : "";
  if (kind !== "work" && kind !== "insight") return null;
  return {
    kind: kind as AltSuggestKind,
    titleKo: field(o.titleKo),
    titleEn: field(o.titleEn),
    category: field(o.category),
    locationCity: field(o.locationCity),
    locationCountry: field(o.locationCountry),
    sectionTitle: field(o.sectionTitle),
    fileName: field(o.fileName)
  };
}
