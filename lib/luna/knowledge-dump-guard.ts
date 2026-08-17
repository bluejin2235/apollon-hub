/**
 * 사내 확정 지식 대량 인출 차단 (프롬프트 의존 X — 응답 생성 단계 가드).
 */

export const MAX_KNOWLEDGE_LIST_ITEMS = 10;

export const KNOWLEDGE_DUMP_CLARIFY =
  "어떤 주제나 상황에 대한 지식이 필요하신가요? 범위가 너무 넓어서, 필요한 부분을 알려주시면 그걸로 답할게요.";

const BULK_INTENT_RE =
  /전부|전체|모두|다\s*알려|리스트로|목록으로|리스트\s*업|나열해|뽑아줘|다\s*뽑아|다\s*보여/;

const KNOWLEDGE_TARGET_RE =
  /지식|알고\s*있|배운\s*것|학습\s*내용|러닝|메모리|기억하|확정\s*지식|회사\s*지식|사내\s*지식/;

/** "전부/목록으로 … 지식" 류 — 나열 대신 되묻기 */
export function isKnowledgeDumpRequest(message: string): boolean {
  const t = message.trim();
  if (!t) return false;
  return BULK_INTENT_RE.test(t) && KNOWLEDGE_TARGET_RE.test(t);
}

export function selectLearningsForInject<T>(
  learnings: T[],
  message: string
): T[] {
  if (isKnowledgeDumpRequest(message)) return [];
  return learnings.slice(0, MAX_KNOWLEDGE_LIST_ITEMS);
}

/**
 * 답변에 확정 지식이 5건 넘게 나열된 경우 되묻기로 교체.
 * learnings 가 있으면 내용 매칭, 없으면 불릿/번호 목록 길이로 판정.
 */
export function sanitizeKnowledgeListAnswer(
  answer: string,
  learnings: Array<{ content: string }> = []
): string {
  const text = answer.trim();
  if (!text) return text;

  if (learnings.length > 0) {
    const hits = learnings.filter((l) => {
      const c = l.content.trim();
      return c.length >= 8 && text.includes(c.slice(0, Math.min(48, c.length)));
    }).length;
    if (hits > MAX_KNOWLEDGE_LIST_ITEMS) {
      return KNOWLEDGE_DUMP_CLARIFY;
    }
  }

  const listLines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s+\S+/.test(l) || /^\d+[.)]\s+\S+/.test(l));

  if (
    listLines.length > MAX_KNOWLEDGE_LIST_ITEMS &&
    KNOWLEDGE_TARGET_RE.test(text)
  ) {
    return KNOWLEDGE_DUMP_CLARIFY;
  }

  return answer;
}

export const KNOWLEDGE_LIST_HARD_RULE =
  "- 한 응답에서 확정 지식(학습/메모리)을 5건 넘게 그대로 나열하지 마세요. '전부·전체·모두·리스트·목록' 요청이면 나열하지 말고 무엇이 필요한지 되물으세요.";
