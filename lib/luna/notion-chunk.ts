/**
 * 노션 블록 → heading 단위 청크.
 * 원본 블록(luna_notion_blocks)은 그대로 두고, 검색용 청크만 만든다.
 */
import { contentHash } from "@/lib/luna/embedding";
import { sha256, type IndexedBlock, type NotionBlock } from "@/lib/luna/notion-index";

export const NOTION_CHUNK_MAX_CHARS = 1500;
export const NOTION_CHUNK_MIN_CHARS = 15;

const HEADING_TYPES = new Set(["heading_1", "heading_2", "heading_3"]);
const BOUNDARY_TYPES = new Set(["heading_1", "heading_2", "heading_3", "divider"]);
const BODY_TYPES = new Set([
  "paragraph",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "toggle",
  "quote",
  "callout",
  "code"
]);
const CAPTION_TYPES = new Set(["image", "file", "embed", "video", "pdf"]);

export type IndexedChunk = {
  chunk_id: string;
  page_id: string;
  heading: string;
  text: string;
  block_ids: string[];
  position: number;
  content_hash: string;
};

type RawPiece = {
  block_id: string;
  block_type: string;
  text: string;
};

type Section = {
  heading: string;
  headingBlockId: string | null;
  pieces: Array<{ block_id: string; text: string }>;
};

function normalizeLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isHeading(type: string): boolean {
  return HEADING_TYPES.has(type);
}

function isBoundary(type: string): boolean {
  return BOUNDARY_TYPES.has(type);
}

function isBody(type: string): boolean {
  return BODY_TYPES.has(type);
}

function isCaption(type: string): boolean {
  return CAPTION_TYPES.has(type);
}

/** 문장 경계에서 자르기. 실패하면 공백. */
function splitOversizedLine(line: string, max: number): string[] {
  const t = line.trim();
  if (t.length <= max) return t ? [t] : [];
  const out: string[] = [];
  let rest = t;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = -1;
    for (const sep of ["。", ". ", "! ", "? ", "…", ".\n", "\n"]) {
      const idx = window.lastIndexOf(sep);
      if (idx > max * 0.4) cut = Math.max(cut, idx + sep.length);
    }
    if (cut <= 0) {
      const sp = window.lastIndexOf(" ");
      cut = sp > max * 0.4 ? sp + 1 : max;
    }
    const part = rest.slice(0, cut).trim();
    if (part) out.push(part);
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export function formatChunkText(heading: string, bodyLines: string[]): string {
  const body = bodyLines.map(normalizeLine).filter(Boolean).join("\n");
  const h = normalizeLine(heading);
  if (h && body) return `${h}\n${body}`;
  if (h) return h;
  return body;
}

function packSection(
  pageId: string,
  heading: string,
  pieces: Array<{ block_id: string; text: string }>,
  startPosition: number,
  minChars: number,
  maxChars: number
): IndexedChunk[] {
  const h = normalizeLine(heading);
  const bodyPieces = pieces.filter((p) => p.text.trim());
  const allIds = [...new Set(pieces.map((p) => p.block_id).filter(Boolean))];

  if (bodyPieces.length === 0) {
    if (h.replace(/\s+/g, "").length < minChars) return [];
    const text = h;
    const hash = contentHash(text);
    return [
      {
        chunk_id: sha256(`${pageId}:${startPosition}:${hash}`),
        page_id: pageId,
        heading: h,
        text,
        block_ids: allIds,
        position: startPosition,
        content_hash: hash
      }
    ];
  }

  // 문단 단위 확장 (한 문단이 max 초과면 문장 경계로 분할)
  type Unit = { text: string; block_ids: string[] };
  const units: Unit[] = [];
  for (const p of bodyPieces) {
    for (const part of splitOversizedLine(p.text, Math.max(32, maxChars - (h ? h.length + 1 : 0)))) {
      units.push({ text: part, block_ids: [p.block_id] });
    }
  }

  const groups: Unit[][] = [];
  let cur: Unit[] = [];

  const curText = () => formatChunkText(h, cur.map((u) => u.text));

  for (const u of units) {
    const trial = formatChunkText(h, [...cur.map((x) => x.text), u.text]);
    if (trial.length > maxChars && cur.length > 0) {
      groups.push(cur);
      cur = [];
    }
    cur.push(u);
    if (curText().length > maxChars && cur.length === 1) {
      // 단일 유닛이 여전히 크면 그대로 emit
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length > 0) groups.push(cur);

  const out: IndexedChunk[] = [];
  let pos = startPosition;
  for (const g of groups) {
    const text = formatChunkText(
      h,
      g.map((u) => u.text)
    );
    if (text.replace(/\s+/g, "").length < minChars) continue;
    const hash = contentHash(text);
    const block_ids = [...new Set(g.flatMap((u) => u.block_ids))];
    if (h && !block_ids.length) block_ids.push(...allIds);
    out.push({
      chunk_id: sha256(`${pageId}:${pos}:${hash}`),
      page_id: pageId,
      heading: h,
      text,
      block_ids,
      position: pos,
      content_hash: hash
    });
    pos += 1;
  }
  return out;
}

/**
 * IndexedBlock[] (원본 순서) → heading 청크.
 * heading 없는 연속 본문은 heading="" 한 덩어리.
 * 빈 heading 섹션은 다음 섹션과 합친다.
 */
export function blocksToChunks(
  pageId: string,
  blocks: Array<Pick<IndexedBlock, "block_id" | "block_type" | "text" | "position">>,
  opts?: { minChars?: number; maxChars?: number }
): IndexedChunk[] {
  const minChars = opts?.minChars ?? NOTION_CHUNK_MIN_CHARS;
  const maxChars = opts?.maxChars ?? NOTION_CHUNK_MAX_CHARS;

  const sorted = [...blocks].sort((a, b) => a.position - b.position);
  const pieces: RawPiece[] = [];
  for (const b of sorted) {
    const type = b.block_type || "unknown";
    const text = normalizeLine(b.text);
    if (type === "divider") {
      pieces.push({ block_id: b.block_id, block_type: type, text: "" });
      continue;
    }
    if (isHeading(type)) {
      pieces.push({ block_id: b.block_id, block_type: type, text });
      continue;
    }
    if (isBody(type)) {
      if (!text) continue;
      pieces.push({ block_id: b.block_id, block_type: type, text });
      continue;
    }
    if (isCaption(type)) {
      if (!text) continue;
      pieces.push({ block_id: b.block_id, block_type: type, text });
      continue;
    }
    // child_page 등: 제목 텍스트가 있으면 본문으로
    if (text) {
      pieces.push({ block_id: b.block_id, block_type: type, text });
    }
  }

  // 섹션 분할
  const sections: Section[] = [];
  let cur: Section = { heading: "", headingBlockId: null, pieces: [] };

  const pushSection = () => {
    if (cur.heading || cur.pieces.length > 0 || cur.headingBlockId) {
      sections.push(cur);
    }
    cur = { heading: "", headingBlockId: null, pieces: [] };
  };

  for (const p of pieces) {
    if (isBoundary(p.block_type)) {
      // 새 경계 → 이전 섹션 마감
      if (cur.heading || cur.pieces.length > 0) pushSection();
      if (isHeading(p.block_type)) {
        cur = {
          heading: p.text,
          headingBlockId: p.block_id,
          pieces: []
        };
      } else {
        // divider: 빈 경계 (다음 본문은 heading 없는 섹션)
        cur = { heading: "", headingBlockId: null, pieces: [] };
      }
      continue;
    }
    cur.pieces.push({ block_id: p.block_id, text: p.text });
  }
  pushSection();

  // 빈 heading(본문 없음) → 다음 본문 있는 섹션까지 합침
  const merged: Section[] = [];
  let pendingHeadings: string[] = [];
  let pendingHeadingIds: string[] = [];

  const takePendingHeading = (
    nextHeading: string
  ): { heading: string; ids: string[] } => {
    if (pendingHeadings.length === 0) {
      return { heading: nextHeading, ids: [] };
    }
    const prefix = pendingHeadings.join(" › ");
    const ids = [...pendingHeadingIds];
    pendingHeadings = [];
    pendingHeadingIds = [];
    return {
      heading: nextHeading ? `${prefix} › ${nextHeading}` : prefix,
      ids
    };
  };

  for (const s of sections) {
    const hasBody = s.pieces.some((p) => p.text.trim());
    if (!hasBody) {
      if (s.heading) {
        pendingHeadings.push(s.heading);
        if (s.headingBlockId) pendingHeadingIds.push(s.headingBlockId);
      }
      continue;
    }
    const pending = takePendingHeading(s.heading);
    merged.push({
      heading: pending.heading,
      headingBlockId: s.headingBlockId ?? pending.ids[0] ?? null,
      pieces: [
        ...pending.ids.map((id) => ({ block_id: id, text: "" })),
        ...s.pieces
      ]
    });
  }

  // 끝까지 본문 없이 heading만 남은 경우
  if (pendingHeadings.length > 0) {
    const heading = pendingHeadings.join(" › ");
    if (heading.replace(/\s+/g, "").length >= minChars) {
      merged.push({
        heading,
        headingBlockId: pendingHeadingIds[0] ?? null,
        pieces: pendingHeadingIds.map((id) => ({ block_id: id, text: "" }))
      });
    }
  }

  const chunks: IndexedChunk[] = [];
  let position = 0;
  for (const s of merged) {
    const pieces = [...s.pieces];
    if (s.headingBlockId && !pieces.some((p) => p.block_id === s.headingBlockId)) {
      pieces.unshift({ block_id: s.headingBlockId, text: "" });
    }
    const packed = packSection(
      pageId,
      s.heading,
      pieces,
      position,
      minChars,
      maxChars
    );
    for (const c of packed) {
      chunks.push({ ...c, position });
      position += 1;
    }
  }
  return chunks;
}

/** Notion API 블록 → 청크 (테스트·드라이런용) */
export function notionBlocksToChunks(
  pageId: string,
  blocks: NotionBlock[],
  extractText: (b: NotionBlock) => string,
  opts?: { minChars?: number; maxChars?: number }
): IndexedChunk[] {
  const indexed = blocks.map((block, position) => ({
    block_id: block.id,
    page_id: pageId,
    block_type: typeof block.type === "string" ? block.type : "unknown",
    text: extractText(block),
    position,
    content_hash: contentHash(extractText(block))
  }));
  return blocksToChunks(pageId, indexed, opts);
}
