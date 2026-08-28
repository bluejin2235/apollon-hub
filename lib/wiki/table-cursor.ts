import type { KeyboardEvent } from "react";

function isTableLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|");
}

function isSeparatorLine(line: string): boolean {
  const t = line.trim();
  if (!isTableLine(t)) return false;
  return t
    .slice(1, -1)
    .split("|")
    .every((cell) => /^[\s:-]+$/.test(cell));
}

function cellCount(line: string): number {
  return line.trim().slice(1, -1).split("|").length;
}

function blankTableRow(columns: number): string {
  if (columns <= 0) return "|  |";
  return `| ${Array(columns).fill(" ").join(" | ")} |`;
}

export function handleWikiTableKeyDown(
  e: KeyboardEvent<HTMLTextAreaElement>,
  value: string,
  onApply: (next: string, cursor: number) => void
): boolean {
  if (e.key !== "Tab" && e.key !== "Enter") return false;

  const el = e.currentTarget;
  const pos = el.selectionStart;
  const selEnd = el.selectionEnd;
  if (pos !== selEnd) return false;

  const lineStart = value.lastIndexOf("\n", pos - 1) + 1;
  const lineEndIdx = value.indexOf("\n", pos);
  const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
  const line = value.slice(lineStart, lineEnd);

  if (!isTableLine(line) || isSeparatorLine(line)) return false;

  if (e.key === "Tab") {
    e.preventDefault();
    const rel = pos - lineStart;
    const nextPipe = line.indexOf("|", rel + 1);
    if (nextPipe >= 0) {
      let cursor = lineStart + nextPipe + 1;
      if (line[nextPipe + 1] === " ") cursor += 1;
      onApply(value, cursor);
      return true;
    }

    const rest = value.slice(lineEnd + 1);
    const nextBreak = rest.indexOf("\n");
    const nextLine = nextBreak === -1 ? rest : rest.slice(0, nextBreak);
    if (isTableLine(nextLine) && !isSeparatorLine(nextLine)) {
      let cursor = lineEnd + 1 + 1;
      if (nextLine.startsWith("| ")) cursor += 1;
      onApply(value, cursor);
      return true;
    }

    const cols = cellCount(line);
    const insert = `\n${blankTableRow(cols)}`;
    const next = value.slice(0, lineEnd) + insert + value.slice(lineEnd);
    onApply(next, lineEnd + 1 + 2);
    return true;
  }

  if (e.key === "Enter" && !e.shiftKey && pos === lineEnd) {
    e.preventDefault();
    const cols = cellCount(line);
    const insert = `\n${blankTableRow(cols)}`;
    const next = value.slice(0, lineEnd) + insert + value.slice(lineEnd);
    onApply(next, lineEnd + 1 + 2);
    return true;
  }

  return false;
}
