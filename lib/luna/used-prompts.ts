import { formatPromptNumber, type LunaPromptRow } from "@/lib/luna/prompts";

export type UsedPromptRef = {
  key: string;
  step: string;
  number: string;
  title: string;
};

export type PromptUsageLog = {
  record: (entry: UsedPromptRef) => void;
  all: () => UsedPromptRef[];
};

const IDENTITY_KEYS = new Set(["identity.apollon"]);

export function isIdentityUsedPrompt(item: UsedPromptRef): boolean {
  if (IDENTITY_KEYS.has(item.key)) return true;
  return item.number === "L1" || item.number.startsWith("L1-");
}

export function createPromptUsageLog(): PromptUsageLog {
  const items: UsedPromptRef[] = [];
  const seen = new Set<string>();
  return {
    record(entry) {
      const key = entry.key.trim();
      const step = entry.step.trim();
      const title = entry.title.trim();
      if (!key || !step || !title) return;
      const id = `${step}::${key}`;
      if (seen.has(id)) return;
      seen.add(id);
      items.push({
        key,
        step,
        number: entry.number.trim(),
        title
      });
    },
    all: () => items.slice()
  };
}

export function recordPromptUse(
  log: PromptUsageLog,
  opts: {
    key: string;
    step: string;
    title: string;
    row?: Pick<LunaPromptRow, "level" | "sort_order" | "title" | "kind"> | null;
  }
) {
  log.record({
    key: opts.key,
    step: opts.step,
    number: opts.row ? formatPromptNumber(opts.row) : "",
    title: opts.row?.title?.trim() || opts.title
  });
}

/** 요약 줄: L1 identity 생략, 같은 key 는 한 번만. */
export function summarizeUsedPrompts(items: UsedPromptRef[]): UsedPromptRef[] {
  const out: UsedPromptRef[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (isIdentityUsedPrompt(item)) continue;
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item);
  }
  return out;
}
