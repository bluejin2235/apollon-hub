/** 동의어 배열 정규화 — trim, 빈값 제거, 중복 제거(순서 유지) */
export function normalizeSynonyms(raw: unknown): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v !== "string") return;
    const t = v.trim();
    if (!t) return;
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };

  if (Array.isArray(raw)) {
    for (const item of raw) push(item);
  } else if (typeof raw === "string" && raw.trim()) {
    const s = raw.trim().replace(/^\{|\}$/g, "");
    for (const part of s.split(/[,|，、]/)) push(part);
  }
  return out;
}

const INLINE_SYNONYM_RE =
  /(?:^|\n)\s*같은\s*뜻으로\s*쓰는\s*말\s*[:：]\s*(.+?)\s*$/;

/**
 * 정의 끝에 붙은 "같은 뜻으로 쓰는 말: A, B" 를 잘라 synonyms 로 옮긴다.
 * 편집 화면을 열 때만 쓰고, DB 일괄 변환은 하지 않는다.
 */
export function extractInlineSynonyms(
  definition: string | null | undefined,
  existing: string[] = []
): { definition: string; synonyms: string[] } {
  const def = (definition ?? "").replace(/\s+$/, "");
  const m = def.match(INLINE_SYNONYM_RE);
  if (!m) {
    return { definition: def, synonyms: normalizeSynonyms(existing) };
  }
  const fromInline = normalizeSynonyms(m[1]);
  const cleaned = def.slice(0, m.index).replace(/\s+$/, "");
  return {
    definition: cleaned,
    synonyms: normalizeSynonyms([...existing, ...fromInline])
  };
}

/** 태그 입력 한 줄에서 Enter/쉼표로 확정할 항목들 */
export function splitSynonymInput(raw: string): string[] {
  return normalizeSynonyms(raw.split(/[,，、]/));
}
