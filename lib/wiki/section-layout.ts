import type { WikiSection } from "@/lib/wiki/types";

export type WikiSectionNode = {
  section: WikiSection;
  children: WikiSectionNode[];
};

/** 상위 절 — 「02 이미지」 */
export function parseWikiParentSectionNum(title: string): string | null {
  const m = title.trim().match(/^(\d+)\s/);
  return m ? m[1]! : null;
}

/** 하위 절 — 「02-1 대표 이미지」 */
export function parseWikiChildSectionPrefix(
  title: string
): { parent: string; child: string } | null {
  const m = title.trim().match(/^(\d+)-(\d+)\s/);
  return m ? { parent: m[1]!, child: m[2]! } : null;
}

export function isWikiSubSectionTitle(title: string): boolean {
  return parseWikiChildSectionPrefix(title) !== null;
}

/** 번호 규칙으로 상위·하위 절 트리를 만든다. 번호 없는 절은 평평한 루트다. */
export function buildWikiSectionTree(sections: WikiSection[]): WikiSectionNode[] {
  const roots: WikiSectionNode[] = [];
  const parentByNum = new Map<string, WikiSectionNode>();

  for (const section of sections) {
    const child = parseWikiChildSectionPrefix(section.title);
    if (child) {
      const parent = parentByNum.get(child.parent);
      if (parent) {
        parent.children.push({ section, children: [] });
      } else {
        roots.push({ section, children: [] });
      }
      continue;
    }

    const node: WikiSectionNode = { section, children: [] };
    roots.push(node);

    const parentNum = parseWikiParentSectionNum(section.title);
    if (parentNum) {
      parentByNum.set(parentNum, node);
    }
  }

  return roots;
}
