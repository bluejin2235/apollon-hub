/**
 * 노션 블록 → heading(또는 페이지 제목) 단위 청크.
 * 원본 블록(luna_notion_blocks)은 그대로 두고, 검색용 청크만 만든다.
 */
import { contentHash } from "@/lib/luna/embedding";
import { sha256, type IndexedBlock, type NotionBlock } from "@/lib/luna/notion-index";

export const NOTION_CHUNK_MAX_CHARS = 1500;
export const NOTION_CHUNK_MIN_CHARS = 15;
/** heading 제외 본문이 이보다 짧으면 청크를 만들지 않고 제목만 다음에 넘긴다 */
export const NOTION_CHUNK_MIN_BODY_CHARS = 20;
/** heading 없는 문서: 문단 묶음 크기 */
export const NOTION_CHUNK_NO_HEADING_MIN_PARAS = 5;
export const NOTION_CHUNK_NO_HEADING_MAX_PARAS = 8;
export const NOTION_CHUNK_NO_HEADING_TARGET_PARAS = 6;

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

/** [p.10–12] / [p.10-12] 등 페이지 번호 표기 — 검색에 무용 */
const PAGE_REF_RE = /\[p\.\s*\d+\s*[–—\-]\s*\d+\]/gi;

export type IndexedChunk = {
  chunk_id: string;
  page_id: string;
  heading: string;
  text: string;
  block_ids: string[];
  position: number;
  content_hash: string;
};

export type ChunkBuildResult = {
  chunks: IndexedChunk[];
  /** 본문 20자 미만이라 스킵하고 제목만 다음에 넘긴 섹션 수 */
  skippedThin: number;
};

export type BlocksToChunksOpts = {
  minChars?: number;
  maxChars?: number;
  minBodyChars?: number;
  /** heading 없을 때 청크 첫 줄에 붙일 페이지 제목 */
  pageTitle?: string;
};

type RawPiece = {
  block_id: string;
  block_type: string;
  text: string;
  /** paragraph 인데 텍스트 0자 — heading 없는 문서의 빈 줄 경계용 */
  emptyParagraph?: boolean;
};

type Section = {
  heading: string;
  headingBlockId: string | null;
  pieces: Array<{ block_id: string; text: string }>;
};

function normalizeLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 페이지 번호 표기 제거 후 정규화 */
export function stripPageRefs(text: string): string {
  return normalizeLine(text.replace(PAGE_REF_RE, " "));
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

function bodyCharCount(lines: string[]): number {
  return lines.map(stripPageRefs).filter(Boolean).join("").replace(/\s+/g, "").length;
}

/** 문장 경계에서 자르기. 실패하면 공백. */
function splitOversizedLine(line: string, max: number): string[] {
  const t = stripPageRefs(line);
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
  const body = bodyLines.map(stripPageRefs).filter(Boolean).join("\n");
  const h = normalizeLine(heading);
  if (h && body) return `${h}\n${body}`;
  if (h) return h;
  return body;
}

/**
 * path_titles 끝에서 최대 2단계 — 임베딩 앞에 붙일 계층 한 줄.
 * 예: 롯데타워 서울스카이 리뉴얼 › 1st Ideation
 */
export function notionHierarchyLine(
  pathTitles: string[] | null | undefined
): string {
  const path = (pathTitles ?? [])
    .map((t) => normalizeLine(String(t ?? "")))
    .filter(Boolean);
  return path.slice(-2).join(" › ");
}

/** 청크 본문은 그대로 두고, 임베딩 입력에만 계층을 앞에 붙인다. */
export function formatNotionChunkEmbedText(
  pathTitles: string[] | null | undefined,
  chunkText: string
): string {
  const hierarchy = notionHierarchyLine(pathTitles);
  const body = chunkText.replace(/\s+$/g, "").replace(/^\s+/g, "");
  if (hierarchy && body) return `${hierarchy}\n${body}`;
  return hierarchy || body;
}

function makeChunk(
  pageId: string,
  heading: string,
  bodyLines: string[],
  blockIds: string[],
  position: number,
  minChars: number
): IndexedChunk | null {
  const text = formatChunkText(heading, bodyLines);
  if (text.replace(/\s+/g, "").length < minChars) return null;
  const hash = contentHash(text);
  return {
    chunk_id: sha256(`${pageId}:${position}:${hash}`),
    page_id: pageId,
    heading: normalizeLine(heading),
    text,
    block_ids: [...new Set(blockIds.filter(Boolean))],
    position,
    content_hash: hash
  };
}

function packSection(
  pageId: string,
  heading: string,
  pieces: Array<{ block_id: string; text: string }>,
  startPosition: number,
  minChars: number,
  maxChars: number,
  minBodyChars: number
): { chunks: IndexedChunk[]; thin: boolean } {
  const h = normalizeLine(heading);
  const cleaned = pieces
    .map((p) => ({ block_id: p.block_id, text: stripPageRefs(p.text) }))
    .filter((p) => p.text);

  if (bodyCharCount(cleaned.map((p) => p.text)) < minBodyChars) {
    return { chunks: [], thin: Boolean(h) || cleaned.length > 0 };
  }

  type Unit = { text: string; block_ids: string[] };
  const units: Unit[] = [];
  for (const p of cleaned) {
    for (const part of splitOversizedLine(
      p.text,
      Math.max(32, maxChars - (h ? h.length + 1 : 0))
    )) {
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
      groups.push(cur);
      cur = [];
    }
  }
  if (cur.length > 0) groups.push(cur);

  const out: IndexedChunk[] = [];
  let pos = startPosition;
  for (const g of groups) {
    const bodyLines = g.map((u) => u.text);
    if (bodyCharCount(bodyLines) < minBodyChars) continue;
    const chunk = makeChunk(
      pageId,
      h,
      bodyLines,
      g.flatMap((u) => u.block_ids),
      pos,
      minChars
    );
    if (!chunk) continue;
    out.push(chunk);
    pos += 1;
  }

  if (out.length === 0 && h) {
    return { chunks: [], thin: true };
  }
  return { chunks: out, thin: false };
}

/**
 * heading 없는 페이지: 문단 5~8개씩 + 빈 줄 연속 경계.
 * 각 청크 첫 줄에 pageTitle.
 */
function chunkWithoutHeadings(
  pageId: string,
  pieces: RawPiece[],
  pageTitle: string,
  startPosition: number,
  minChars: number,
  maxChars: number,
  minBodyChars: number
): { chunks: IndexedChunk[]; skippedThin: number } {
  const title = normalizeLine(pageTitle);
  const paragraphs: Array<{ block_id: string; text: string; empty: boolean }> = [];

  for (const p of pieces) {
    if (p.emptyParagraph) {
      paragraphs.push({ block_id: p.block_id, text: "", empty: true });
      continue;
    }
    if (isBoundary(p.block_type) && !isHeading(p.block_type)) {
      // divider → 강제 경계 (빈 줄 2개와 동일)
      paragraphs.push({ block_id: p.block_id, text: "", empty: true });
      paragraphs.push({ block_id: p.block_id, text: "", empty: true });
      continue;
    }
    const text = stripPageRefs(p.text);
    if (!text) continue;
    paragraphs.push({ block_id: p.block_id, text, empty: false });
  }

  type Group = Array<{ block_id: string; text: string }>;
  const groups: Group[] = [];
  let cur: Group = [];
  let emptyRun = 0;

  const flush = () => {
    if (cur.length === 0) return;
    groups.push(cur);
    cur = [];
  };

  for (const p of paragraphs) {
    if (p.empty) {
      emptyRun += 1;
      if (emptyRun >= 2 && cur.length > 0) {
        flush();
      }
      continue;
    }
    emptyRun = 0;
    cur.push({ block_id: p.block_id, text: p.text });
    if (cur.length >= NOTION_CHUNK_NO_HEADING_TARGET_PARAS) {
      flush();
    }
  }
  flush();

  // 5개 미만으로 끝난 꼬리는 직전과 합치되, 합친 결과가 max*1.5 이하면 OK
  const compacted: Group[] = [];
  for (const g of groups) {
    if (
      compacted.length > 0 &&
      g.length < NOTION_CHUNK_NO_HEADING_MIN_PARAS &&
      compacted[compacted.length - 1]!.length + g.length <=
        NOTION_CHUNK_NO_HEADING_MAX_PARAS
    ) {
      compacted[compacted.length - 1]!.push(...g);
    } else {
      compacted.push(g);
    }
  }

  const chunks: IndexedChunk[] = [];
  let skippedThin = 0;
  let pos = startPosition;
  for (const g of compacted) {
    // 1500자 초과 시 packSection과 동일하게 분할
    const packed = packSection(
      pageId,
      title,
      g,
      pos,
      minChars,
      maxChars,
      minBodyChars
    );
    if (packed.thin && packed.chunks.length === 0) {
      skippedThin += 1;
      continue;
    }
    for (const c of packed.chunks) {
      chunks.push({ ...c, position: pos, heading: title });
      pos += 1;
    }
  }
  return { chunks, skippedThin };
}

function collectPieces(
  blocks: Array<Pick<IndexedBlock, "block_id" | "block_type" | "text" | "position">>,
  keepEmptyParagraphs: boolean
): RawPiece[] {
  const sorted = [...blocks].sort((a, b) => a.position - b.position);
  const pieces: RawPiece[] = [];
  for (const b of sorted) {
    const type = b.block_type || "unknown";
    const raw = typeof b.text === "string" ? b.text : "";
    const text = normalizeLine(raw);

    if (type === "divider") {
      pieces.push({ block_id: b.block_id, block_type: type, text: "" });
      continue;
    }
    if (isHeading(type)) {
      pieces.push({ block_id: b.block_id, block_type: type, text });
      continue;
    }
    if (type === "paragraph" && keepEmptyParagraphs && !text) {
      pieces.push({
        block_id: b.block_id,
        block_type: type,
        text: "",
        emptyParagraph: true
      });
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
    if (text) {
      pieces.push({ block_id: b.block_id, block_type: type, text });
    }
  }
  return pieces;
}

function chunkWithHeadings(
  pageId: string,
  pieces: RawPiece[],
  minChars: number,
  maxChars: number,
  minBodyChars: number
): ChunkBuildResult {
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
      if (cur.heading || cur.pieces.length > 0) pushSection();
      if (isHeading(p.block_type)) {
        cur = {
          heading: p.text,
          headingBlockId: p.block_id,
          pieces: []
        };
      } else {
        cur = { heading: "", headingBlockId: null, pieces: [] };
      }
      continue;
    }
    if (p.emptyParagraph) continue;
    const text = stripPageRefs(p.text);
    if (!text) continue;
    cur.pieces.push({ block_id: p.block_id, text });
  }
  pushSection();

  // 본문 부족(thin) 섹션 → 제목만 다음에 붙임 (합체보다 제목 전달이 낫다)
  const merged: Section[] = [];
  let pendingHeadings: string[] = [];
  let pendingHeadingIds: string[] = [];
  let skippedThin = 0;

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

  const bodyLen = (s: Section) =>
    bodyCharCount(s.pieces.map((p) => stripPageRefs(p.text)));

  for (const s of sections) {
    const substantive = bodyLen(s) >= minBodyChars;
    if (!substantive) {
      if (s.heading) {
        pendingHeadings.push(s.heading);
        if (s.headingBlockId) pendingHeadingIds.push(s.headingBlockId);
        skippedThin += 1;
      } else if (s.pieces.some((p) => stripPageRefs(p.text))) {
        // heading 없는 thin 본문 — 버림
        skippedThin += 1;
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

  // 끝까지 thin heading만 남은 경우: 본문 없으므로 청크 미생성 (제목만으로는 검색 가치 낮음)
  if (pendingHeadings.length > 0) {
    skippedThin += 0; // 이미 카운트됨
    pendingHeadings = [];
    pendingHeadingIds = [];
  }

  const chunks: IndexedChunk[] = [];
  let position = 0;
  for (const s of merged) {
    const sectionPieces = [...s.pieces];
    if (
      s.headingBlockId &&
      !sectionPieces.some((p) => p.block_id === s.headingBlockId)
    ) {
      sectionPieces.unshift({ block_id: s.headingBlockId, text: "" });
    }
    const packed = packSection(
      pageId,
      s.heading,
      sectionPieces,
      position,
      minChars,
      maxChars,
      minBodyChars
    );
    if (packed.thin && packed.chunks.length === 0) {
      skippedThin += 1;
      continue;
    }
    for (const c of packed.chunks) {
      chunks.push({ ...c, position });
      position += 1;
    }
  }

  return { chunks, skippedThin };
}

export function buildNotionChunks(
  pageId: string,
  blocks: Array<Pick<IndexedBlock, "block_id" | "block_type" | "text" | "position">>,
  opts?: BlocksToChunksOpts
): ChunkBuildResult {
  const minChars = opts?.minChars ?? NOTION_CHUNK_MIN_CHARS;
  const maxChars = opts?.maxChars ?? NOTION_CHUNK_MAX_CHARS;
  const minBodyChars = opts?.minBodyChars ?? NOTION_CHUNK_MIN_BODY_CHARS;
  const pageTitle = opts?.pageTitle ?? "";

  const hasHeading = blocks.some((b) =>
    HEADING_TYPES.has(b.block_type || "")
  );

  if (!hasHeading) {
    const pieces = collectPieces(blocks, true);
    return chunkWithoutHeadings(
      pageId,
      pieces,
      pageTitle,
      0,
      minChars,
      maxChars,
      minBodyChars
    );
  }

  const pieces = collectPieces(blocks, false);
  return chunkWithHeadings(pageId, pieces, minChars, maxChars, minBodyChars);
}

/**
 * IndexedBlock[] → heading 청크.
 * pageTitle 을 넘기면 heading 없는 문서에서 청크 첫 줄로 쓴다.
 */
export function blocksToChunks(
  pageId: string,
  blocks: Array<Pick<IndexedBlock, "block_id" | "block_type" | "text" | "position">>,
  opts?: BlocksToChunksOpts
): IndexedChunk[] {
  return buildNotionChunks(pageId, blocks, opts).chunks;
}

/** Notion API 블록 → 청크 (테스트·드라이런용) */
export function notionBlocksToChunks(
  pageId: string,
  blocks: NotionBlock[],
  extractText: (b: NotionBlock) => string,
  opts?: BlocksToChunksOpts
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
