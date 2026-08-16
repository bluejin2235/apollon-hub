import {
  hasSpecificNamedEntity,
  NAMED_ENTITY_SEED,
  type NamedEntity
} from "@/lib/luna/named-entities";

/** 누가/언제/어떻게형 개념·프로세스 질문 */
const CONCEPT_PROCESS_RE =
  /누가|언제|어떻게|주관|참여해|참여하|역할이|절차|프로세스|게이트|뭐가 달라|차이가|무슨 뜻|무엇인가/;

const PROJECT_PICKER_RE = /인스파이어|해운대|더후/;

export function isConceptProcessQuestion(text: string): boolean {
  return CONCEPT_PROCESS_RE.test(text.trim());
}

export function shouldSkipProjectClarify(
  text: string,
  entities: NamedEntity[] = NAMED_ENTITY_SEED
): boolean {
  const t = text.trim();
  if (!t) return false;
  if (hasSpecificNamedEntity(t, entities)) return false;
  return isConceptProcessQuestion(t);
}

/** 질문에 프로젝트명이 없는데 선택지가 인스파이어/해운대/더후인 경우 */
export function isSpuriousProjectClarify(
  text: string,
  options: string[],
  entities: NamedEntity[] = NAMED_ENTITY_SEED
): boolean {
  if (hasSpecificNamedEntity(text, entities)) return false;
  const joined = options.join(" ");
  return PROJECT_PICKER_RE.test(joined);
}

export const CLARIFY_CONCEPT_GUARD = `
프로젝트명이 문장에 없으면 인스파이어·해운대·더후 같은 프로젝트 선택지를 만들지 마라.
누가/언제/어떻게 형태의 개념·프로세스 질문(주관, 참여, 역할, 절차)은 파일 검색이 아니라 일반 지식으로 먼저 답한다. needs_clarify=false.
`.trim();
