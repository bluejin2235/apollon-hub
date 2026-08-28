import {
  parseWikiBodyMarkdown,
  type WikiMdBlock
} from "@/lib/wiki/body-markdown";

const MAX_PREVIEW_CHARS = 600;

function blockHasContent(block: WikiMdBlock): boolean {
  switch (block.type) {
    case "paragraph":
      return block.lines.some((line) => line.trim().length > 0);
    case "heading":
      return block.text.trim().length > 0;
    case "ul":
    case "ol":
      return block.items.length > 0;
    case "table":
      return block.headers.length > 0 || block.rows.length > 0;
    case "hr":
      return true;
    default:
      return false;
  }
}

export function wikiBlocksToMarkdown(blocks: WikiMdBlock[]): string {
  const parts: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "paragraph":
        parts.push(block.lines.join("\n"));
        break;
      case "heading":
        parts.push(`## ${block.text}`);
        break;
      case "ul":
        parts.push(block.items.map((item) => `- ${item}`).join("\n"));
        break;
      case "ol":
        parts.push(block.items.map((item, i) => `${i + 1}. ${item}`).join("\n"));
        break;
      case "table": {
        const rows = [block.headers, ...block.rows];
        if (rows.length === 0) break;
        const lines = rows.map((row) => `| ${row.join(" | ")} |`);
        if (lines.length > 1) {
          lines.splice(
            1,
            0,
            `| ${block.headers.map(() => "---").join(" | ")} |`
          );
        }
        parts.push(lines.join("\n"));
        break;
      }
      case "hr":
        parts.push("---");
        break;
      default:
        break;
    }
  }

  return parts.join("\n\n").trim();
}

/** 팝오버 미리보기 — 첫 표 포함 · 없으면 첫 두 문단 · 600자 이하면 전체 */
export function truncateGuideSectionBody(
  body: string
): { body: string; truncated: boolean } {
  const normalized = body.replace(/\r\n/g, "\n").trim();
  if (!normalized) return { body: "", truncated: false };
  if (normalized.length <= MAX_PREVIEW_CHARS) {
    return { body: normalized, truncated: false };
  }

  const blocks = parseWikiBodyMarkdown(normalized).filter(blockHasContent);
  if (blocks.length === 0) return { body: "", truncated: false };

  const firstTableIndex = blocks.findIndex((block) => block.type === "table");
  let selected: WikiMdBlock[];

  if (firstTableIndex >= 0) {
    selected = blocks.slice(0, firstTableIndex + 1);
  } else {
    selected = [];
    let paragraphCount = 0;
    for (const block of blocks) {
      selected.push(block);
      if (block.type === "paragraph") {
        paragraphCount += 1;
        if (paragraphCount >= 2) break;
      }
    }
  }

  const preview = wikiBlocksToMarkdown(selected);
  const truncated =
    selected.length < blocks.length || preview.length < normalized.length;
  return { body: preview, truncated };
}

export function formatGuideSectionSubtitle(title: string): string {
  const match = title.match(/^(\d+(?:-\d+)?)\s/);
  if (match) return `${match[1]} · 제작 가이드`;
  return "제작 가이드";
}

export function formatGuideSectionDisplayTitle(title: string): string {
  return title.replace(/^(\d+(?:-\d+)?)\s+/, "").trim() || title;
}

export function guideSectionCategory(anchorId: string): string {
  if (anchorId.startsWith("image-")) {
    return anchorId === "image-blocks" ? "배치" : "이미지";
  }
  if (anchorId.startsWith("video-")) return "영상";
  if (anchorId.startsWith("text-")) return "텍스트";
  return "가이드";
}
