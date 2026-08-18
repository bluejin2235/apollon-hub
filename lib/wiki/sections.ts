import type { WikiRelated, WikiSection } from "@/lib/wiki/types";

export function newSectionId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function emptySection(title = "새 절"): WikiSection {
  return { id: newSectionId(), title, body: "" };
}

export function parseSections(raw: unknown): WikiSection[] {
  if (!Array.isArray(raw)) return [];
  const out: WikiSection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const body = typeof row.body === "string" ? row.body : "";
    const id =
      typeof row.id === "string" && row.id.trim()
        ? row.id.trim()
        : `s${out.length + 1}`;
    out.push({ id, title: title || "절", body });
  }
  return out;
}

export function parseRelated(raw: unknown): WikiRelated[] {
  if (!Array.isArray(raw)) return [];
  const out: WikiRelated[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    if (!title) continue;
    const kind = row.kind === "term" ? "term" : "doc";
    const category =
      row.category === "forms" ||
      row.category === "standards" ||
      row.category === "rules"
        ? row.category
        : undefined;
    const slug = typeof row.slug === "string" ? row.slug.trim() : "";
    out.push({
      kind,
      title,
      category,
      slug: slug || undefined
    });
  }
  return out;
}

/** 마크다운 제목(# ~ ###)으로 나누고, 제목이 없으면 본문 한 절. */
export function contentToSections(content: string): WikiSection[] {
  const src = content.replace(/\r\n/g, "\n").trim();
  if (!src) return [];
  const headingRe = /^(#{1,3})\s+(.+)$/;
  const lines = src.split("\n");
  const hasHeading = lines.some((l) => headingRe.test(l));
  if (!hasHeading) {
    return [{ id: "s1", title: "본문", body: src }];
  }

  const sections: WikiSection[] = [];
  let title: string | null = null;
  let body: string[] = [];

  function flush() {
    if (title == null && body.every((l) => !l.trim())) return;
    sections.push({
      id: `s${sections.length + 1}`,
      title: title ?? "본문",
      body: body.join("\n").trim()
    });
    title = null;
    body = [];
  }

  for (const line of lines) {
    const m = line.match(headingRe);
    if (m) {
      flush();
      title = m[2]!.trim() || "절";
      continue;
    }
    body.push(line);
  }
  flush();
  return sections;
}

export function sectionsToContent(sections: WikiSection[]): string {
  return sections
    .map((s) => `## ${s.title.trim() || "절"}\n${s.body}`.trim())
    .join("\n\n")
    .trim();
}

export function sectionsPlain(sections: WikiSection[]): string {
  return sections
    .map((s) => `${s.title}\n${s.body}`)
    .join("\n\n")
    .trim();
}
