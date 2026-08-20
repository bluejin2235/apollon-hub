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
  let switched = next.length !== types.length;
  const listing = /어떤게|알려줘|사례|뭐가 있/.test(originalQuestion ?? "");
  if (listing && !next.includes("know")) {
    next.push("know");
    switched = true;
  }
  if (typesNeedWikiLookup(next) || next.includes("make")) {
    return { types: next, switched };
  }
  if (!next.includes("know")) next.push("know");
  return { types: next, switched: true };
}
