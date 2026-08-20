import { isListingQuestion } from "@/lib/luna/listing-question";

/** 되묻기 직후 턴: 짧은 답을 원래 질문과 합쳐 다시 판정·검색한다. */

export const CLARIFY_FOLLOWUP_RULE = `[되묻기 후 재검색]
앞 턴은 의도 확인만 했다. 검색·위키 조회는 하지 않았다.
이번 턴에서 원래 질문과 확인된 조건을 합쳐 새로 찾는다.
앞 턴에 목록이 없었다고 해서 '없다'고 하지 마라.
검색을 돌리지 않았으면 '검색 결과가 없다'고 말하지 마라. 안 한 것과 없는 것은 다르다.
이번에 주입된 위키·지식으로 답하라.`;

export function parseClarifyOptions(meta: unknown): string[] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return [];
  const clarify = (meta as { clarify?: unknown }).clarify;
  if (!clarify || typeof clarify !== "object" || Array.isArray(clarify)) {
    return [];
  }
  const raw = (clarify as { options?: unknown }).options;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
    .map((o) => o.trim());
}

/** "1", "1·2 모두", 선택지 문구를 검색에 쓸 조건 문장으로 푼다. */
export function resolveClarifyAnswer(
  answer: string,
  options: string[]
): string {
  const trimmed = answer.trim();
  if (!trimmed) return "";
  if (options.length === 0) return trimmed;

  const numbered = options.map((opt, i) => ({
    n: i + 1,
    text: opt.replace(/^\d+[\.\)\s·]+/, "").trim() || opt
  }));

  const picked = new Set<string>();
  const nums = [...trimmed.matchAll(/\d+/g)]
    .map((m) => Number(m[0]))
    .filter((n) => n >= 1 && n <= numbered.length);

  if (/모두|전부|둘\s*다/.test(trimmed) && (nums.length >= 1 || numbered.length >= 2)) {
    for (const row of numbered) {
      if (/기타|직접|모두|전부/.test(row.text)) continue;
      picked.add(row.text);
    }
  } else if (nums.length > 0) {
    for (const n of nums) picked.add(numbered[n - 1]!.text);
  }

  const hit = numbered.find(
    (row) =>
      row.text === trimmed ||
      trimmed.includes(row.text) ||
      row.text.includes(trimmed)
  );
  if (hit && !/모두|전부/.test(hit.text)) picked.add(hit.text);

  if (picked.size > 0) return [...picked].join(", ");
  return trimmed;
}

export function combineClarifyFollowup(
  originalQuestion: string | null | undefined,
  answer: string,
  options: string[] = []
): string | null {
  const original = originalQuestion?.trim() ?? "";
  const resolved = resolveClarifyAnswer(answer, options);
  if (!original || !resolved) return null;
  return `${original}\n조건: ${resolved}`;
}

/** 대화에서 첫 되묻기 직전 user — 연속 되묻기에도 최초 질문을 유지한다. */
export function findClarifyRootUser(
  recent: Array<{ role: string; content?: string; metadata?: unknown }>
): string | null {
  for (let i = 0; i < recent.length; i += 1) {
    const m = recent[i]!;
    if (m.role !== "assistant") continue;
    const meta = m.metadata;
    if (!meta || typeof meta !== "object" || !(meta as { clarify?: unknown }).clarify) {
      continue;
    }
    for (let j = i - 1; j >= 0; j -= 1) {
      if (recent[j]!.role === "user") {
        return recent[j]!.content?.trim() || null;
      }
    }
  }
  return null;
}

/** 이미 한 번이라도 되묻기가 나갔으면 true (마지막 턴만이 아님). */
export function conversationHadClarify(
  recent: Array<{ role: string; metadata?: unknown }>
): boolean {
  return recent.some(
    (m) =>
      m.role === "assistant" &&
      m.metadata &&
      typeof m.metadata === "object" &&
      Boolean((m.metadata as { clarify?: unknown }).clarify)
  );
}

/** 목록형: 최초 질문·대화 기록·현재 문장 순으로 판정한다. */
export function resolveListingQuestion(
  recent: Array<{ role: string; content?: string; metadata?: unknown }>,
  searchIntentText: string
): { listing: boolean; rootText: string } {
  const rootFromClarify = findClarifyRootUser(recent);
  const firstUser =
    recent.find((m) => m.role === "user")?.content?.trim() ?? "";
  const rootText =
    rootFromClarify ||
    firstUser ||
    searchIntentText.split("\n")[0]?.trim() ||
    searchIntentText;

  const persisted = recent.some(
    (m) =>
      m.metadata &&
      typeof m.metadata === "object" &&
      (m.metadata as { listing_question?: boolean }).listing_question === true
  );

  const listing =
    persisted ||
    isListingQuestion(rootText) ||
    isListingQuestion(searchIntentText.split("\n")[0] ?? "") ||
    isListingQuestion(searchIntentText);

  return { listing, rootText };
}

export function typesNeedWikiLookup(types: string[]): boolean {
  return types.includes("know") || types.includes("find");
}

/** 짧은 답이 인사·빈 유형으로 떨어지면 원래 질문 맥락의 알기로 되돌린다. */
export function ensureClarifyFollowupTypes(
  types: string[],
  originalQuestion?: string | null
): {
  types: string[];
  switched: boolean;
} {
  const next = types.filter((t) => t !== "smalltalk");
  const switched = next.length !== types.length;
  if (isListingQuestion(originalQuestion ?? "")) {
    const knowOnly = next.filter((t) => t !== "find");
    if (!knowOnly.includes("know")) knowOnly.unshift("know");
    return { types: knowOnly, switched: true };
  }
  if (typesNeedWikiLookup(next) || next.includes("make")) {
    return { types: next, switched };
  }
  if (!next.includes("know")) next.push("know");
  return { types: next, switched: true };
}
