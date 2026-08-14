import { formatPromptNumber, type LunaPromptRow } from "@/lib/luna/prompts";

export type UsedPromptRef = {
  number: string;
  title: string;
};

export function buildUsedPromptRefs(opts: {
  clarifyRan: boolean;
  searchRan: boolean;
  answerRan: boolean;
  l3Rows: Pick<LunaPromptRow, "prompt_key" | "title" | "level" | "sort_order">[];
  l2Skills: Pick<LunaPromptRow, "title" | "level" | "sort_order" | "kind">[];
}): UsedPromptRef[] {
  const out: UsedPromptRef[] = [];
  const l3ByKey = new Map(
    opts.l3Rows
      .filter((r) => r.prompt_key)
      .map((r) => [r.prompt_key!, r])
  );

  const pushL3 = (key: string, fallbackTitle: string) => {
    const row = l3ByKey.get(key);
    if (row) {
      out.push({
        number: formatPromptNumber(row),
        title: row.title
      });
    } else {
      out.push({ number: "", title: fallbackTitle });
    }
  };

  if (opts.clarifyRan) {
    pushL3("talk.understand", "질문 이해");
  }
  if (opts.searchRan) {
    pushL3("talk.search", "자료 찾기");
  }
  pushL3("talk.assume", "가정 확인");
  if (opts.answerRan) {
    pushL3("talk.answer", "답변 원칙");
  }

  for (const skill of opts.l2Skills) {
    const suffix =
      skill.kind === "perspective"
        ? " 관점"
        : skill.kind === "role"
          ? " 역할"
          : skill.kind === "task"
            ? ""
            : "";
    out.push({
      number: formatPromptNumber(skill),
      title: `${skill.title}${suffix}`.trim()
    });
  }

  const seen = new Set<string>();
  return out.filter((item) => {
    const key = `${item.number}::${item.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return item.title.length > 0;
  });
}
