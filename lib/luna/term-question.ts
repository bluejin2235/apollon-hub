import { compactKey } from "@/lib/glossary/highlight";
import { normalizeSynonyms } from "@/lib/glossary/synonyms";

const REJECT_IN_TERM =
  /어떻게|알려|프로세스|방법|기준|절차|해줘|주세요|관련|대해|대한/;

const MEANING_TAIL =
  /(?:무슨\s*(?:뜻|의미)(?:이야|인가요|인지|인지요|입니까)?|뜻이\s*(?:뭐|뭔|무엇)|의미가\s*(?:뭐|뭔|무엇)|뭐야|뭐예요|뭐에요|뭔가요|뭔지|뭐지|무엇인지|무엇이야|무엇인가요|무엇이지)(?:요|까|지)?/;

const PARTICLE = /(?:이라는|라는|이란|이|가|은|는|란)/;

/** 한 단어(또는 짧은 복합어)의 뜻을 묻는 질문에서 용어를 뽑는다. */
export function parseTermMeaningQuestion(raw: string): string | null {
  const text = raw
    .trim()
    .replace(/^[`'"]+|[`'"]+$/g, "")
    .replace(/[?？.。!！]+$/g, "")
    .trim();
  if (!text || text.length > 48) return null;

  const quoted = text.match(
    /^[「『“"'"](.+?)[」』”"'"]\s*(?:이라는|라는|이란|이|가|은|는|란)?\s*(?:무슨\s*(?:뜻|의미)|뜻이|의미가|뭐야|뭐예요|뭐에요|뭔가요|뭔지|뭐지)/
  );
  if (quoted?.[1]) return sanitizeAskedTerm(quoted[1]);

  const withParticle = text.match(
    new RegExp(`^(.+?)${PARTICLE.source}\\s*${MEANING_TAIL.source}$`)
  );
  if (withParticle?.[1]) return sanitizeAskedTerm(withParticle[1]);

  const noParticle = text.match(
    new RegExp(`^(.+?)\\s+${MEANING_TAIL.source}$`)
  );
  if (noParticle?.[1]) return sanitizeAskedTerm(noParticle[1]);

  const en = text.match(/^(?:what(?:'s| is)|meaning of)\s+(.+)$/i);
  if (en?.[1]) return sanitizeAskedTerm(en[1]);

  return null;
}

function sanitizeAskedTerm(raw: string): string | null {
  const term = raw
    .trim()
    .replace(/^[「『“"'"]+|[」』”"'"]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!term) return null;
  if (REJECT_IN_TERM.test(term)) return null;
  if (/[?？]/.test(term)) return null;
  const tokens = term.split(" ").filter(Boolean);
  if (tokens.length > 2) return null;
  const key = compactKey(term);
  if (key.length < 2 || key.length > 24) return null;
  if (/^(그거|이거|저거|그것|이것|저것|뭐|무엇)$/.test(term)) return null;
  return term;
}

export function glossaryHasFilledDefinition(
  askedTerm: string,
  terms: Array<{
    term_ko?: string | null;
    term_en?: string | null;
    synonyms?: unknown;
    definition?: string | null;
  }>
): boolean {
  const key = compactKey(askedTerm);
  if (key.length < 2) return false;
  for (const term of terms) {
    const names = [
      term.term_ko ?? "",
      term.term_en ?? "",
      ...normalizeSynonyms(term.synonyms)
    ];
    if (!names.some((n) => compactKey(n) === key)) continue;
    if ((term.definition ?? "").trim()) return true;
  }
  return false;
}

export function draftDefinitionFromAnswer(answer: string): string {
  const cleaned = answer
    .replace(/\r\n/g, "\n")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/^[ \t]*[-*]\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) return "";
  return cleaned.length > 800 ? `${cleaned.slice(0, 800).trim()}…` : cleaned;
}

export function askedTermKeyFromMeta(
  meta: Record<string, unknown> | null | undefined,
  content?: string | null
): string {
  const asked =
    typeof meta?.asked_term === "string" ? meta.asked_term.trim() : "";
  if (asked) return compactKey(asked);
  const ko = typeof meta?.term_ko === "string" ? meta.term_ko.trim() : "";
  if (ko) return compactKey(ko);
  const line = (content ?? "").split("\n")[0]?.trim() ?? "";
  return compactKey(line);
}
