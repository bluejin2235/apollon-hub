import { isValidWikiHexColor, normalizeWikiHexColor } from "@/lib/wiki/text-color";

export type WikiMdBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "hr" }
  | { type: "table"; headers: string[]; rows: string[][] };

export type WikiInlinePart =
  | { type: "text"; value: string }
  | { type: "bold"; children: WikiInlinePart[] }
  | { type: "italic"; children: WikiInlinePart[] }
  | { type: "code"; value: string }
  | { type: "link"; text: string; href: string }
  | { type: "color"; color: string; children: WikiInlinePart[] };

type ParseInlineOptions = {
  allowColor?: boolean;
};

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|");
}

function isTableSeparator(line: string): boolean {
  const t = line.trim();
  if (!isTableRow(t)) return false;
  return t
    .slice(1, -1)
    .split("|")
    .every((cell) => /^[\s:-]+$/.test(cell));
}

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function pushText(parts: WikiInlinePart[], value: string) {
  if (!value) return;
  const last = parts[parts.length - 1];
  if (last?.type === "text") {
    last.value += value;
    return;
  }
  parts.push({ type: "text", value });
}

function findNextInlineSpecial(text: string, from: number, allowColor: boolean): number {
  const found = -1;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === "*" || ch === "`") {
      return i;
    }
    if (ch === "[") {
      if (allowColor && text.startsWith("[color=", i)) return i;
      return i;
    }
  }
  return found;
}

/** 본문 마크다운 — 표 · ## · 굵게 · 기울임 · 목록 · --- · `코드` · 링크 · 줄바꿈 */
export function parseWikiBodyMarkdown(text: string): WikiMdBlock[] {
  const src = text.replace(/\r\n/g, "\n");
  if (!src) return [];

  const lines = src.split("\n");
  const blocks: WikiMdBlock[] = [];
  let para: string[] = [];
  let i = 0;

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ type: "paragraph", lines: [...para] });
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === "") {
      flushPara();
      i += 1;
      continue;
    }

    const heading = line.match(/^\s*##\s+(.+?)\s*$/);
    if (heading) {
      flushPara();
      blocks.push({ type: "heading", text: heading[1]!.trim() });
      i += 1;
      continue;
    }

    if (/^\s*---\s*$/.test(line)) {
      flushPara();
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    const bullet = line.match(/^\s*(?:-\s+|·\s+)(.+)$/);
    if (bullet) {
      flushPara();
      const items: string[] = [bullet[1]!.trim()];
      i += 1;
      while (i < lines.length) {
        const next = lines[i]!;
        const m = next.match(/^\s*(?:-\s+|·\s+)(.+)$/);
        if (!m) break;
        items.push(m[1]!.trim());
        i += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (ordered) {
      flushPara();
      const items: string[] = [ordered[1]!.trim()];
      i += 1;
      while (i < lines.length) {
        const next = lines[i]!;
        const m = next.match(/^\s*\d+\.\s+(.+)$/);
        if (!m) break;
        items.push(m[1]!.trim());
        i += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    if (isTableRow(line)) {
      flushPara();
      const tableLines: string[] = [];
      while (i < lines.length && isTableRow(lines[i]!)) {
        tableLines.push(lines[i]!);
        i += 1;
      }
      const dataRows = tableLines.filter((row) => !isTableSeparator(row));
      const headers = dataRows[0] ? parseTableRow(dataRows[0]) : [];
      const rows = dataRows.slice(1).map(parseTableRow);
      blocks.push({ type: "table", headers, rows });
      continue;
    }

    para.push(line);
    i += 1;
  }

  flushPara();
  return blocks;
}

/** 인라인 **굵게** · *기울임* · `코드` · [링크](url) · [color=#rrggbb]…[/color] */
export function parseWikiInline(
  text: string,
  options: ParseInlineOptions = {}
): WikiInlinePart[] {
  const allowColor = options.allowColor !== false;
  const parts: WikiInlinePart[] = [];
  let pos = 0;

  while (pos < text.length) {
    const slice = text.slice(pos);

    if (allowColor) {
      const colorMatch = slice.match(/^\[color=(#[0-9a-fA-F]{6})\]([\s\S]*?)\[\/color\]/);
      if (colorMatch && isValidWikiHexColor(colorMatch[1]!)) {
        parts.push({
          type: "color",
          color: normalizeWikiHexColor(colorMatch[1]!),
          children: parseWikiInline(colorMatch[2]!, { allowColor: false })
        });
        pos += colorMatch[0].length;
        continue;
      }
      if (slice.startsWith("[color=")) {
        pushText(parts, "[");
        pos += 1;
        continue;
      }
    }

    const linkMatch = slice.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      parts.push({ type: "link", text: linkMatch[1]!, href: linkMatch[2]! });
      pos += linkMatch[0].length;
      continue;
    }

    const boldMatch = slice.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      parts.push({
        type: "bold",
        children: parseWikiInline(boldMatch[1]!, { allowColor })
      });
      pos += boldMatch[0].length;
      continue;
    }

    const italicMatch = slice.match(/^\*([^*\n]+?)\*/);
    if (italicMatch) {
      parts.push({
        type: "italic",
        children: parseWikiInline(italicMatch[1]!, { allowColor })
      });
      pos += italicMatch[0].length;
      continue;
    }

    const codeMatch = slice.match(/^`([^`\n]+)`/);
    if (codeMatch) {
      parts.push({ type: "code", value: codeMatch[1]! });
      pos += codeMatch[0].length;
      continue;
    }

    const next = findNextInlineSpecial(text, pos, allowColor);
    if (next === -1) {
      pushText(parts, text.slice(pos));
      break;
    }
    if (next > pos) {
      pushText(parts, text.slice(pos, next));
    }
    pos = next === pos ? pos + 1 : next;
  }

  if (parts.length === 0) {
    parts.push({ type: "text", value: text });
  }
  return parts;
}

export const WIKI_TABLE_TEMPLATE = `| 항목 | 값 |
| --- | --- |
|  |  |
`;
