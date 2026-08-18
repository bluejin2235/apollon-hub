export type DiffLine = {
  type: "same" | "add" | "del";
  text: string;
};

function tokenizeLines(text: string): string[] {
  if (!text) return [];
  return text.replace(/\r\n/g, "\n").split("\n");
}

/** 줄 단위 LCS. 짧은 문서용. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = tokenizeLines(before);
  const b = tokenizeLines(after);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => 0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j]
          ? (dp[i + 1]![j + 1] ?? 0) + 1
          : Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: "same", text: a[i]! });
      i += 1;
      j += 1;
    } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      out.push({ type: "del", text: a[i]! });
      i += 1;
    } else {
      out.push({ type: "add", text: b[j]! });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ type: "del", text: a[i]! });
    i += 1;
  }
  while (j < m) {
    out.push({ type: "add", text: b[j]! });
    j += 1;
  }
  return out;
}

export function diffCounts(before: string, after: string): {
  added: number;
  removed: number;
} {
  const lines = diffLines(before, after);
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.type === "add") added += 1;
    if (line.type === "del") removed += 1;
  }
  return { added, removed };
}

export function formatDiffCounts(added: number, removed: number): string {
  return `+${added} −${removed}`;
}
