import {
  containsPhrase,
  matchNamedEntities,
  NAMED_ENTITY_SEED,
  type NamedEntity
} from "@/lib/luna/named-entities";

/** 질문에서 뽑은 「무엇을」 — 유형(사례/찾기)이 아니라 프로젝트·종류·성격. */
export type AskedMaterial = "image" | "doc" | "explain" | "any";
export type AskedNature =
  | "kv"
  | "storyboard"
  | "reference"
  | "quote"
  | "any";

export type AskedWhat = {
  projectCanonical: string | null;
  /** 경로 필터에 쓰는 구. 질문에 나온 가장 긴 이름 우선. */
  projectPhrases: string[];
  displayProject: string | null;
  extraTokens: string[];
  material: AskedMaterial;
  nature: AskedNature;
  summary: string;
};

const GENERIC_TOPIC_RE =
  /^(미디어파사드|미디어아트|미디어폴|파사드|레퍼런스|스토리보드|아이데이션|시안|견적|사례|키비주얼|시뮬레이션|이미지|사진|콘티|자료|폴더|파일|프로젝트|모델하우스|시어터룸|글로벌|론칭|공공부지|공공부지사업|아트리움)$/i;

const ASK_STOP = new Set([
  "이미지",
  "사진",
  "비주얼",
  "보여줘",
  "보여",
  "찾아줘",
  "찾아",
  "알려줘",
  "알려",
  "있어",
  "있나",
  "있나요",
  "있을까",
  "좀",
  "자료",
  "파일",
  "폴더",
  "관련",
  "대한",
  "우리",
  "우리가",
  "한",
  "해준",
  "있는",
  "있나",
  "좀",
  "해줘",
  "주세요"
]);

const NATURE_WORDS = new Set([
  "kv",
  "키비주얼",
  "레퍼런스",
  "스토리보드",
  "콘티",
  "견적",
  "견적서",
  "사례",
  "참고"
]);

export function naturePathTokens(nature: AskedNature): string[] {
  if (nature === "kv") return ["KV"];
  if (nature === "storyboard") return ["스토리보드"];
  if (nature === "reference") return ["레퍼런스"];
  if (nature === "quote") return ["견적"];
  return [];
}

export function natureLabelKo(nature: AskedNature): string {
  if (nature === "kv") return "KV";
  if (nature === "storyboard") return "스토리보드";
  if (nature === "reference") return "레퍼런스";
  if (nature === "quote") return "견적";
  return "";
}

function detectNature(text: string): AskedNature {
  if (/\bkv\b|키비주얼|key\s*visual/i.test(text)) return "kv";
  if (/스토리보드|storyboard|콘티/i.test(text)) return "storyboard";
  if (/견적/i.test(text)) return "quote";
  if (/레퍼런스|참고\s*(?:사례|작|예)|사례/i.test(text)) return "reference";
  return "any";
}

function detectMaterial(text: string): AskedMaterial {
  if (/이미지|사진|비주얼|시안|보여줘|어떻게\s*생겼|\bkv\b|스토리보드/i.test(text)) {
    return "image";
  }
  if (/문서|pdf|ppt|pptx|기획서|제안서|수행계획/i.test(text)) return "doc";
  if (/뭐야|무엇입니까|설명해|어떻게\s*돼|진행\s*(?:상황|중)/i.test(text)) {
    return "explain";
  }
  return "any";
}

function phrasesOf(e: NamedEntity): string[] {
  return [e.canonical, ...e.aliases, ...e.searchPhrases]
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);
}

function longestPhraseInText(e: NamedEntity, text: string): string {
  const hits = phrasesOf(e)
    .filter((p) => containsPhrase(text, p))
    .sort((a, b) => b.length - a.length);
  return hits[0] || e.canonical;
}

function extractExtraTokens(text: string, used: Set<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/시즌\s*\d+|season\s*\d+/gi)) {
    const t = m[0].replace(/\s+/g, " ").trim();
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  for (const raw of text.split(/\s+/)) {
    const token = raw.replace(/[?!.，,]/g, "").trim();
    if (!token || token.length < 2) continue;
    if (ASK_STOP.has(token) || ASK_STOP.has(token.toLowerCase())) continue;
    if (NATURE_WORDS.has(token.toLowerCase())) continue;
    if (GENERIC_TOPIC_RE.test(token)) continue;
    const key = token.toLowerCase();
    if (seen.has(key) || used.has(key)) continue;
    if (/^[가-힣]{2,}$/.test(token) || /^[A-Za-z][A-Za-z0-9]{2,}$/.test(token) || /^\d{6}$/.test(token)) {
      seen.add(key);
      out.push(token);
    }
  }
  return out.slice(0, 6);
}

function isGenericTopicToken(token: string): boolean {
  return GENERIC_TOPIC_RE.test(token.trim());
}

/**
 * 질문에 프로젝트(또는 그에 준하는 고유명)가 있는지.
 * 「미디어파사드 사례」처럼 유형만 있는 경우는 false.
 */
export function hasNamedProject(
  text: string,
  entities: NamedEntity[] = NAMED_ENTITY_SEED
): boolean {
  return parseAskedWhat(text, entities).projectPhrases.length > 0;
}

/** Correct only one-edit, unambiguous long Hangul names from the supplied registry. */
export function correctRegisteredProjectTypos(text: string, entities: NamedEntity[]): string {
  const phrases = [...new Set(entities.filter(e => e.kind === "project" || e.kind === "client")
    .flatMap(phrasesOf).filter(p => /^[가-힣]{4,}$/.test(p)))];
  const oneEdit = (a: string, b: string): boolean => {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length >= b.length) i++;
      if (b.length >= a.length) j++;
    }
    return edits + (a.length - i) + (b.length - j) === 1;
  };
  return text.replace(/[가-힣A-Za-z0-9]+/g, token => {
    if (!/^[가-힣]{4,}$/.test(token) || phrases.includes(token)) return token;
    // Keep exact registered names with particles/suffixes; no speculative rewrite.
    if (phrases.some(p => token.includes(p))) return token;
    const candidates = phrases.filter(p => p.slice(0, 2) === token.slice(0, 2) && oneEdit(token, p));
    return candidates.length === 1 ? candidates[0]! : token;
  });
}

export function parseAskedWhat(
  text: string,
  entities: NamedEntity[] = NAMED_ENTITY_SEED
): AskedWhat {
  const t = correctRegisteredProjectTypos(text, entities).replace(/\s+/g, " ").trim();
  const nature = detectNature(t);
  const material = detectMaterial(t);
  const matched = matchNamedEntities(t, entities).filter(
    (e) => e.kind === "project" || e.kind === "client"
  );
  const projectPhrases: string[] = [];
  const used = new Set<string>();
  let projectCanonical: string | null = null;
  let displayProject: string | null = null;

  for (const e of matched) {
    const longest = longestPhraseInText(e, t);
    if (!projectCanonical) projectCanonical = e.canonical;
    if (!displayProject) displayProject = longest;
    if (!projectPhrases.includes(longest)) projectPhrases.push(longest);
    used.add(longest.toLowerCase());
    used.add(e.canonical.toLowerCase());
    for (const p of phrasesOf(e)) used.add(p.toLowerCase());
  }

  if (projectPhrases.length === 0 && !/뭐야|무엇입니까|무슨\s*뜻|의미(?:가|는|야)?/.test(t)) {
    for (const raw of t.split(/\s+/)) {
      const token = raw.replace(/[?!.]/g, "").trim();
      if (token.length < 4) continue;
      if (!/^[가-힣]{4,}$/.test(token)) continue;
      if (isGenericTopicToken(token) || NATURE_WORDS.has(token.toLowerCase())) {
        continue;
      }
      if (/견적|정의|의미|제도|규정|지원금$/.test(token)) continue;
      if (ASK_STOP.has(token)) continue;
      projectPhrases.push(token);
      projectCanonical = token;
      displayProject = token;
      used.add(token.toLowerCase());
      break;
    }
  }

  const extraTokens = extractExtraTokens(t, used).filter((tok) => {
    const low = tok.toLowerCase();
    return !projectPhrases.some((p) => p.toLowerCase() === low);
  });

  const bits = [
    displayProject,
    ...extraTokens.slice(0, 3),
    natureLabelKo(nature),
    material === "image" ? "이미지" : material === "doc" ? "문서" : ""
  ].filter((s) => s && s.length > 0);

  return {
    projectCanonical,
    projectPhrases,
    displayProject,
    extraTokens,
    material,
    nature,
    summary: bits.join(" ")
  };
}

