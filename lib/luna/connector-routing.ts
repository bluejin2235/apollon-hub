import type { LunaPromptRow } from "@/lib/luna/prompts";

export type ConnectorFlags = {
  notion: boolean;
  web: boolean;
  nas: boolean;
};

const SEARCH_INTENT_RE =
  /찾아|찾아줘|검색|알려줘|어디|위치|레퍼런스|사례|자료|파일|폴더|경로|보고서|견적|제안|트렌드|최신|뉴스|시장|외부|노션|Work/i;

const NAS_HINT_RE =
  /견적|보고서|착수|제안|폴더|파일|위치|Work|프로젝트|자료|경로|T:|P:|nas|견적서|사업/i;

const NOTION_HINT_RE =
  /트렌드|사례|내부|노션|아폴론|용어|지식|레퍼런스|리서치|벤치|아카이브/i;

const WEB_HINT_RE =
  /외부|최신|뉴스|시장|경쟁|벤치마크|글로벌|해외|업계|동향/i;

const MEMORY_ONLY_RE =
  /^(안녕|고마워|감사|ㅎㅎ|ㅋㅋ|네$|응$|ok$|okay$)/i;

/** L3-03 자료 찾기 규칙에 따른 커넥터 자동 선택 (수동 지정이 없을 때) */
export function resolveConnectorsAuto(
  message: string,
  opts: { hasAttachments: boolean; manual?: ConnectorFlags | null }
): ConnectorFlags {
  if (opts.hasAttachments) {
    return { notion: false, web: false, nas: false };
  }
  if (
    opts.manual &&
    (opts.manual.notion || opts.manual.web || opts.manual.nas)
  ) {
    return opts.manual;
  }

  const text = message.trim();
  if (!text || MEMORY_ONLY_RE.test(text)) {
    return { notion: false, web: false, nas: false };
  }
  if (!SEARCH_INTENT_RE.test(text)) {
    return { notion: false, web: false, nas: false };
  }

  const nas = NAS_HINT_RE.test(text);
  const notion = NOTION_HINT_RE.test(text);
  const web = WEB_HINT_RE.test(text);

  if (nas && !notion && !web) {
    return { notion: false, web: false, nas: true };
  }
  if (notion && !nas && !web) {
    return { notion: true, web: false, nas: false };
  }
  if (web && !nas && !notion) {
    return { notion: false, web: true, nas: false };
  }

  return {
    notion: notion || /사례|트렌드|내부|지식/i.test(text),
    web: web || /최신|외부|시장/i.test(text),
    nas: nas || /찾|어디|위치|프로젝트|견적|보고/i.test(text)
  };
}

export function hasManualConnectors(c?: ConnectorFlags | null): boolean {
  return Boolean(c && (c.notion || c.web || c.nas));
}

export function hasManualSkills(ids: {
  perspective_ids: string[];
  role_ids: string[];
  task_ids: string[];
}): boolean {
  return (
    ids.perspective_ids.length +
      ids.role_ids.length +
      ids.task_ids.length >
    0
  );
}

/** profiles.department → L2 관점 prompt id (제목 부분 일치) */
export function matchPerspectiveIdByDepartment(
  department: string | null | undefined,
  perspectives: Pick<LunaPromptRow, "id" | "title">[]
): string | null {
  const d = (department ?? "").trim();
  if (!d || perspectives.length === 0) return null;

  const exact = perspectives.find((p) => p.title === d);
  if (exact) return exact.id;

  const byInclude = perspectives.find(
    (p) => d.includes(p.title) || p.title.includes(d)
  );
  if (byInclude) return byInclude.id;

  const normalized = d.replace(/\s+/g, "");
  for (const p of perspectives) {
    const t = p.title.replace(/\s+/g, "");
    if (normalized.includes(t) || t.includes(normalized)) return p.id;
  }
  return null;
}
