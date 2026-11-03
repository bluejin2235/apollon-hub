/**
 * DB 에 저장된 HTML 글자색·배경색 전수 조사 (읽기 전용 dry-run).
 *
 *   npx tsx scripts/audit-pasted-text-colors.ts
 *
 * 대상: work_sections.lead/headline, insight_blocks.body, content_blocks.body,
 *       content_published(is_current).snapshot
 * 수정·쓰기 없음.
 */
import { config, parse } from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.local") });
const websiteEnv = parse(
  readFileSync(resolve(process.cwd(), "../apollon-website/.env.local"), "utf8")
);

const CONTENT_URL = websiteEnv.NEXT_PUBLIC_SUPABASE_URL;
const CONTENT_SERVICE =
  websiteEnv.SUPABASE_SECRET_KEY ?? websiteEnv.SUPABASE_SERVICE_ROLE_KEY;

if (!CONTENT_URL || !CONTENT_SERVICE) {
  throw new Error("apollon-website/.env.local 에 SUPABASE URL·SERVICE KEY 가 필요합니다");
}

/** rich-text-editor.tsx LEAD_COLORS(5) + FONT_COLORS(32) */
const LEAD_COLORS = [
  "#0f172a",
  "#b0231e",
  "#a35a08",
  "#0f7a45",
  "#534ab7"
] as const;

const FONT_COLORS = [
  "#ffffff",
  "#f1f5f9",
  "#cbd5e1",
  "#94a3b8",
  "#64748b",
  "#475569",
  "#1e293b",
  "#000000",
  "#fecaca",
  "#fed7aa",
  "#fef08a",
  "#bbf7d0",
  "#a5f3fc",
  "#bfdbfe",
  "#ddd6fe",
  "#fbcfe8",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#991b1b",
  "#9a3412",
  "#854d0e",
  "#166534",
  "#155e75",
  "#1e40af",
  "#5b21b6",
  "#9d174d"
] as const;

const PALETTE = new Set<string>([...LEAD_COLORS, ...FONT_COLORS]);

type Hit = {
  color: string;
  prop: "color" | "background" | "background-color";
  inPalette: boolean;
  source: string;
  contentType: "work" | "insight" | "published";
  slug: string | null;
  contentId: string | null;
  sectionId: string | null;
  blockId: string | null;
  locale: string | null;
  field: string;
};

type ColorAgg = {
  color: string;
  prop: string;
  inPalette: boolean;
  count: number;
  samples: Hit[];
};

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** 비교용으로만 정규화. 실패하면 원문 소문자 trim */
function normalizeColor(raw: string): string {
  const value = raw.trim().toLowerCase().replace(/\s+/g, "");
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    let next = hex[1] ?? "";
    if (next.length === 3) {
      next = next
        .split("")
        .map((ch) => ch + ch)
        .join("");
    }
    return `#${next}`;
  }
  const rgb = value.match(/^rgba?\((\d+),(\d+),(\d+)(?:,[\d.]+)?\)$/);
  if (rgb) {
    const r = Number(rgb[1]);
    const g = Number(rgb[2]);
    const b = Number(rgb[3]);
    if ([r, g, b].every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      return rgbToHex(r, g, b);
    }
  }
  return value;
}

function extractFromHtml(html: string): Array<{ prop: Hit["prop"]; color: string }> {
  const out: Array<{ prop: Hit["prop"]; color: string }> = [];
  if (!html || typeof html !== "string") return out;
  if (!/style\s*=/i.test(html)) return out;

  const styleRe = /style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let styleMatch: RegExpExecArray | null = styleRe.exec(html);
  while (styleMatch) {
    const style = styleMatch[1] ?? styleMatch[2] ?? "";
    const declRe = /(?:^|;)\s*(color|background-color|background)\s*:\s*([^;]+)/gi;
    let decl: RegExpExecArray | null = declRe.exec(style);
    while (decl) {
      const prop = decl[1]!.toLowerCase() as Hit["prop"];
      const color = normalizeColor(decl[2] ?? "");
      if (color && color !== "transparent" && color !== "inherit" && color !== "initial") {
        // background:url(...) 등은 색이 아님 — 단색만 집계
        if (prop === "background" && /url\(|gradient|none/i.test(color)) {
          decl = declRe.exec(style);
          continue;
        }
        out.push({ prop, color });
      }
      decl = declRe.exec(style);
    }
    styleMatch = styleRe.exec(html);
  }
  return out;
}

function walkLocalized(
  value: unknown,
  onHtml: (html: string, locale: string | null) => void
): void {
  if (value == null) return;
  if (typeof value === "string") {
    onHtml(value, null);
    return;
  }
  if (typeof value !== "object" || Array.isArray(value)) return;
  const rec = value as Record<string, unknown>;
  if (typeof rec.ko === "string" || typeof rec.en === "string") {
    if (typeof rec.ko === "string") onHtml(rec.ko, "ko");
    if (typeof rec.en === "string") onHtml(rec.en, "en");
    return;
  }
  if (Array.isArray(rec.columns)) {
    for (const col of rec.columns) walkLocalized(col, onHtml);
  }
}

function pushHits(
  hits: Hit[],
  html: string,
  meta: Omit<Hit, "color" | "prop" | "inPalette">
): void {
  for (const { prop, color } of extractFromHtml(html)) {
    hits.push({
      ...meta,
      prop,
      color,
      inPalette: PALETTE.has(color)
    });
  }
}

async function fetchAll(
  client: SupabaseClient,
  table: string,
  select: string,
  pageSize = 500
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await client.from(table).select(select).range(from, to);
    if (error) throw new Error(`${table}: ${error.message}`);
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

function walkSnapshotStrings(
  node: unknown,
  path: string[],
  onHtml: (html: string, path: string) => void
): void {
  if (node == null) return;
  if (typeof node === "string") {
    if (/style\s*=/i.test(node) && /(color|background)/i.test(node)) {
      onHtml(node, path.join("."));
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => walkSnapshotStrings(item, [...path, String(i)], onHtml));
    return;
  }
  if (typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      walkSnapshotStrings(value, [...path, key], onHtml);
    }
  }
}

function aggregate(hits: Hit[]): ColorAgg[] {
  const map = new Map<string, ColorAgg>();
  for (const hit of hits) {
    const key = `${hit.prop}|${hit.color}`;
    let agg = map.get(key);
    if (!agg) {
      agg = {
        color: hit.color,
        prop: hit.prop,
        inPalette: hit.inPalette,
        count: 0,
        samples: []
      };
      map.set(key, agg);
    }
    agg.count += 1;
    if (agg.samples.length < 12) agg.samples.push(hit);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.color.localeCompare(b.color));
}

function formatTable(rows: ColorAgg[], title: string): string {
  const lines = [`## ${title}`, "", `| 속성 | 색 | 건수 | 팔레트 | 예시 |`, `|---|---|---:|---|---|`];
  for (const row of rows) {
    const example = row.samples
      .slice(0, 3)
      .map((s) => {
        const slug = s.slug ?? s.contentId?.slice(0, 8) ?? "?";
        const loc = s.locale ? `/${s.locale}` : "";
        const id = s.blockId
          ? `block:${s.blockId.slice(0, 8)}`
          : s.sectionId
            ? `sec:${s.sectionId.slice(0, 8)}`
            : s.field;
        return `${s.contentType}:${slug}${loc} ${id}`;
      })
      .join("; ");
    lines.push(
      `| ${row.prop} | \`${row.color}\` | ${row.count} | ${row.inPalette ? "예" : "아니오"} | ${example} |`
    );
  }
  if (rows.length === 0) lines.push("| — | — | 0 | — | — |");
  return lines.join("\n");
}

async function main() {
  const client = createClient(CONTENT_URL!, CONTENT_SERVICE!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const hits: Hit[] = [];

  const works = await fetchAll(client, "works", "id, slug");
  const workSlug = new Map(
    works.map((w) => [String(w.id), typeof w.slug === "string" ? w.slug : null])
  );

  const insights = await fetchAll(client, "insights", "id, slug");
  const insightSlug = new Map(
    insights.map((w) => [String(w.id), typeof w.slug === "string" ? w.slug : null])
  );

  const sections = await fetchAll(
    client,
    "work_sections",
    "id, work_id, lead, headline"
  );
  const sectionWork = new Map(
    sections.map((s) => [String(s.id), String(s.work_id)])
  );

  for (const section of sections) {
    const workId = String(section.work_id);
    const slug = workSlug.get(workId) ?? null;
    const base = {
      source: "work_sections",
      contentType: "work" as const,
      slug,
      contentId: workId,
      sectionId: String(section.id),
      blockId: null as string | null
    };
    walkLocalized(section.lead, (html, locale) =>
      pushHits(hits, html, { ...base, locale, field: "lead" })
    );
    walkLocalized(section.headline, (html, locale) =>
      pushHits(hits, html, { ...base, locale, field: "headline" })
    );
  }

  const contentBlocks = await fetchAll(
    client,
    "content_blocks",
    "id, section_id, body"
  );
  for (const block of contentBlocks) {
    const sectionId = String(block.section_id);
    const workId = sectionWork.get(sectionId) ?? null;
    const slug = workId ? workSlug.get(workId) ?? null : null;
    walkLocalized(block.body, (html, locale) =>
      pushHits(hits, html, {
        source: "content_blocks",
        contentType: "work",
        slug,
        contentId: workId,
        sectionId,
        blockId: String(block.id),
        locale,
        field: "body"
      })
    );
  }

  const insightBlocks = await fetchAll(
    client,
    "insight_blocks",
    "id, insight_id, section_id, body"
  );
  for (const block of insightBlocks) {
    const insightId = String(block.insight_id);
    const slug = insightSlug.get(insightId) ?? null;
    walkLocalized(block.body, (html, locale) =>
      pushHits(hits, html, {
        source: "insight_blocks",
        contentType: "insight",
        slug,
        contentId: insightId,
        sectionId: block.section_id ? String(block.section_id) : null,
        blockId: String(block.id),
        locale,
        field: "body"
      })
    );
  }

  {
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 200) {
      const to = from + 199;
      const { data, error } = await client
        .from("content_published")
        .select("id, content_type, content_id, slug, snapshot")
        .eq("is_current", true)
        .range(from, to);
      if (error) throw new Error(`content_published: ${error.message}`);
      const batch = (data ?? []) as Record<string, unknown>[];
      rows.push(...batch);
      if (batch.length < 200) break;
    }

    for (const row of rows) {
      const contentId = typeof row.content_id === "string" ? row.content_id : null;
      const slug = typeof row.slug === "string" ? row.slug : null;
      walkSnapshotStrings(row.snapshot, ["snapshot"], (html, path) => {
        const locale = /\.ko(?:\.|$)/.test(path)
          ? "ko"
          : /\.en(?:\.|$)/.test(path)
            ? "en"
            : null;
        pushHits(hits, html, {
          source: "content_published.snapshot",
          contentType: "published",
          slug,
          contentId,
          sectionId: null,
          blockId: null,
          locale,
          field: path
        });
      });
    }
  }

  const colorHits = hits.filter((h) => h.prop === "color");
  const bgHits = hits.filter((h) => h.prop !== "color");
  const off = aggregate(colorHits.filter((h) => !h.inPalette));
  const on = aggregate(colorHits.filter((h) => h.inPalette));
  const bgAgg = aggregate(bgHits);

  const publishedOffSlugs = [
    ...new Set(
      colorHits
        .filter((h) => h.contentType === "published" && !h.inPalette && h.prop === "color")
        .map((h) => `${h.slug ?? h.contentId}`)
    )
  ].sort();

  const draftOffUnique = [
    ...new Map(
      colorHits
        .filter((h) => h.contentType !== "published" && !h.inPalette && h.prop === "color")
        .map((h) => [
          `${h.contentType}:${h.slug ?? h.contentId}`,
          { type: h.contentType, slug: h.slug, id: h.contentId }
        ])
    ).values()
  ];

  const outDir = resolve(process.cwd(), "scripts/out-audit-pasted-colors");
  mkdirSync(outDir, { recursive: true });
  const reportPath = resolve(outDir, "report.md");
  const jsonPath = resolve(outDir, "hits.json");

  const report = [
    `# 붙여넣기 글자색 전수 조사 (dry-run)`,
    ``,
    `- 시각: ${new Date().toISOString()}`,
    `- 팔레트: LEAD_COLORS ${LEAD_COLORS.length} + FONT_COLORS ${FONT_COLORS.length} = ${PALETTE.size}색`,
    `- 총 히트: ${hits.length} (color ${colorHits.length} · background류 ${bgHits.length})`,
    `- 팔레트 밖 color: ${off.reduce((n, r) => n + r.count, 0)}건 / ${off.length}색`,
    `- 팔레트 안 color: ${on.reduce((n, r) => n + r.count, 0)}건 / ${on.length}색`,
    ``,
    formatTable(off, "팔레트 밖 색 (붙여넣기 의심)"),
    ``,
    formatTable(on, "팔레트 색 (편집기에서 고른 색일 가능성)"),
    ``,
    formatTable(bgAgg, "background / background-color (참고)"),
    ``,
    `## 정리 방안 제안 (실행하지 않음)`,
    ``,
    `1. 원본 테이블에서 팔레트 밖 \`style\` 의 \`color:\` 만 제거(또는 style 전체에서 color 선언만 삭제). span·글자는 유지.`,
    `2. 배경색(\`background\`/\`background-color\`)은 별도 판단 — 편집기가 넣지 않는 값이므로 붙여넣기·잔여일 가능성.`,
    `3. 공개 반영: \`content_published\` 스냅샷은 원본 수정만으로 안 바뀜. 아래 공개 글을 다시 공개해야 사이트에 반영.`,
    ``,
    `### 팔레트 밖 색이 있는 공개 스냅샷 (${publishedOffSlugs.length})`,
    ``,
    ...publishedOffSlugs.map((s) => `- ${s}`),
    ``,
    `### 원본(워크/인사이트)에서 팔레트 밖 색이 있는 콘텐츠 (${draftOffUnique.length})`,
    ``,
    ...draftOffUnique.map(
      (d) => `- ${d.type} ${d.slug ?? "(no slug)"} \`${d.id}\``
    ),
    ``
  ].join("\n");

  writeFileSync(reportPath, report, "utf8");
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        paletteSize: PALETTE.size,
        hitCount: hits.length,
        offPaletteColors: off,
        inPaletteColors: on,
        backgrounds: bgAgg,
        publishedOffSlugs,
        draftOffUnique,
        hits
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(report);
  console.log(`\nwrote ${reportPath}`);
  console.log(`wrote ${jsonPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
