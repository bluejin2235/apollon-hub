/**
 * 검색 2차 데이터 — luna_links 1홉 확장 · 관점 매칭
 * (무한 walk 금지. 상한·confidence 게이트.)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotionSource } from "@/lib/luna/notion";

export const LINK_EXPAND_TOP_N = 8;
export const LINK_EXPAND_MAX_ADD = 20;
export const LINK_EXPAND_MIN_CONF = 0.7;
/** 이보다 느리면 상한을 절반으로 */
export const LINK_EXPAND_MS_SOFT = 1000;

export type LinkExpandStats = {
  seed_count: number;
  links_followed: number;
  added: number;
  project_ids: string[];
  ms: number;
  max_add: number;
  capped: boolean;
};

export type PerspectiveMatchStats = {
  names: string[];
  boosted: number;
  injected: number;
  ms: number;
};

export type ProjectGroupSummary = {
  key: string;
  title: string;
  notion: number;
  meetings: number;
  ideation: number;
  proposals: number;
  work: number;
  images: number;
  page_ids: string[];
};

type LinkRow = {
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  kind: string;
  confidence: number;
  evidence: Record<string, unknown> | null;
  status: string;
};

type PageRow = {
  page_id: string;
  title: string;
  parent_id: string | null;
  path_titles: string[] | null;
  nas_path: string | null;
  url: string | null;
  last_edited_time: string | null;
};

function asPathTitles(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function pageToSource(
  page: PageRow,
  opts: {
    via_link?: string;
    project_key?: string | null;
    match_score?: number;
  }
): NotionSource {
  const pathTitles = asPathTitles(page.path_titles);
  return {
    id: page.page_id,
    title: page.title || "(제목 없음)",
    url: page.url || `https://notion.so/${page.page_id.replace(/-/g, "")}`,
    last_edited_time: page.last_edited_time,
    excerpt: null,
    paths: page.nas_path ? [page.nas_path] : [],
    nas_path: page.nas_path,
    parent_id: page.parent_id,
    path_titles: pathTitles,
    similarity: 0.35,
    match_score: opts.match_score ?? 3.5,
    match_via: "keyword",
    via_link: opts.via_link ?? "belongs",
    project_key: opts.project_key ?? null,
    link_expanded: true
  };
}

async function loadPagesByIds(
  admin: SupabaseClient,
  ids: string[]
): Promise<Map<string, PageRow>> {
  const out = new Map<string, PageRow>();
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 80) {
    const part = unique.slice(i, i + 80);
    const { data, error } = await admin
      .from("luna_notion_pages")
      .select(
        "page_id, title, parent_id, path_titles, nas_path, url, last_edited_time"
      )
      .in("page_id", part)
      .eq("archived", false);
    if (error) {
      console.error("[luna/search-secondary] pages", error.message);
      continue;
    }
    for (const row of data ?? []) {
      out.set(String(row.page_id), row as PageRow);
    }
  }
  return out;
}

async function fetchLinksTouching(
  admin: SupabaseClient,
  ids: string[],
  minConfidence: number
): Promise<LinkRow[]> {
  if (ids.length === 0) return [];
  const kinds = ["belongs", "same", "follows"];
  const out: LinkRow[] = [];
  const seen = new Set<string>();
  const push = (rows: LinkRow[]) => {
    for (const row of rows) {
      const k = `${row.from_type}|${row.from_id}|${row.to_type}|${row.to_id}|${row.kind}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(row);
    }
  };

  const chunk = 40;
  for (let i = 0; i < ids.length; i += chunk) {
    const part = ids.slice(i, i + chunk);
    const [fromRes, toRes] = await Promise.all([
      admin
        .from("luna_links")
        .select(
          "from_type, from_id, to_type, to_id, kind, confidence, evidence, status"
        )
        .in("kind", kinds)
        .gte("confidence", minConfidence)
        .eq("status", "active")
        .in("from_id", part)
        .limit(200),
      admin
        .from("luna_links")
        .select(
          "from_type, from_id, to_type, to_id, kind, confidence, evidence, status"
        )
        .in("kind", kinds)
        .gte("confidence", minConfidence)
        .eq("status", "active")
        .in("to_id", part)
        .limit(200)
    ]);
    if (fromRes.error) {
      console.error("[luna/search-secondary] links from", fromRes.error.message);
    } else {
      push((fromRes.data ?? []) as LinkRow[]);
    }
    if (toRes.error) {
      console.error("[luna/search-secondary] links to", toRes.error.message);
    } else {
      push((toRes.data ?? []) as LinkRow[]);
    }
  }
  return out;
}

async function fetchBelongsToProjects(
  admin: SupabaseClient,
  projectIds: string[],
  minConfidence: number
): Promise<LinkRow[]> {
  if (projectIds.length === 0) return [];
  const out: LinkRow[] = [];
  for (let i = 0; i < projectIds.length; i += 40) {
    const part = projectIds.slice(i, i + 40);
    const { data, error } = await admin
      .from("luna_links")
      .select(
        "from_type, from_id, to_type, to_id, kind, confidence, evidence, status"
      )
      .eq("kind", "belongs")
      .eq("to_type", "project")
      .in("to_id", part)
      .eq("from_type", "notion_page")
      .gte("confidence", minConfidence)
      .eq("status", "active")
      .limit(120);
    if (error) {
      console.error("[luna/search-secondary] project belongs", error.message);
      continue;
    }
    for (const row of data ?? []) out.push(row as LinkRow);
  }
  return out;
}

/**
 * 상위 검색 결과의 luna_links 를 1단계(프로젝트 소속 포함) 따라가 후보를 보탠다.
 */
export async function expandSourcesViaLinks(
  admin: SupabaseClient,
  seeds: NotionSource[],
  opts?: {
    topN?: number;
    maxAdd?: number;
    minConfidence?: number;
    query?: string;
  }
): Promise<{ sources: NotionSource[]; stats: LinkExpandStats }> {
  const started = Date.now();
  const topN = opts?.topN ?? LINK_EXPAND_TOP_N;
  let maxAdd = opts?.maxAdd ?? LINK_EXPAND_MAX_ADD;
  const minConfidence = opts?.minConfidence ?? LINK_EXPAND_MIN_CONF;
  const query = (opts?.query ?? "").trim();

  const seedSources = seeds.slice(0, topN);
  const relevantSeeds = seedSources.filter(
    (s) =>
      !query ||
      titleOverlapsQuery(s.title, query) ||
      titleOverlapsQuery(s.project_key ?? "", query)
  );
  const expandSeeds =
    relevantSeeds.length > 0 ? relevantSeeds : seedSources.slice(0, 3);

  const seedPageIds = seedSources.map((s) => s.id).filter(Boolean);
  const expandPageIds = new Set(expandSeeds.map((s) => s.id).filter(Boolean));
  const seedNas = seedSources
    .map((s) => s.nas_path)
    .filter((p): p is string => Boolean(p));
  const seedIds = [...new Set([...seedPageIds, ...seedNas])];

  const empty: LinkExpandStats = {
    seed_count: seedIds.length,
    links_followed: 0,
    added: 0,
    project_ids: [],
    ms: 0,
    max_add: maxAdd,
    capped: false
  };
  if (seedIds.length === 0) {
    empty.ms = Date.now() - started;
    return { sources: [], stats: empty };
  }

  const links = await fetchLinksTouching(admin, seedIds, minConfidence);
  const projectIds = new Set<string>();
  const candidatePageIds = new Map<
    string,
    { via: string; project_key: string | null; score: number }
  >();

  const bumpCandidate = (
    pageId: string,
    via: string,
    projectKey: string | null,
    score: number
  ) => {
    if (!pageId || seedPageIds.includes(pageId)) return;
    const prev = candidatePageIds.get(pageId);
    if (!prev || score > prev.score) {
      candidatePageIds.set(pageId, {
        via,
        project_key: projectKey ?? prev?.project_key ?? null,
        score
      });
    } else if (projectKey && !prev.project_key) {
      prev.project_key = projectKey;
    }
  };

  for (const link of links) {
    const fromIsSeed = seedIds.includes(link.from_id);
    const toIsSeed = seedIds.includes(link.to_id);
    if (!fromIsSeed && !toIsSeed) continue;

    if (link.kind === "belongs") {
      if (link.to_type === "project" && expandPageIds.has(link.from_id)) {
        const seedTitle =
          seeds.find((s) => s.id === link.from_id)?.title ?? "";
        if (
          !query ||
          titleOverlapsQuery(link.to_id, query) ||
          titleOverlapsQuery(seedTitle, query)
        ) {
          projectIds.add(link.to_id);
        }
      }
      if (link.from_type === "notion_page") {
        bumpCandidate(
          link.from_id,
          "belongs",
          link.to_type === "project" ? link.to_id : null,
          expandPageIds.has(link.to_id) || expandPageIds.has(link.from_id)
            ? 2
            : 0
        );
      }
      if (link.to_type === "notion_page") {
        bumpCandidate(
          link.to_id,
          "belongs",
          link.from_type === "project" ? link.from_id : null,
          1
        );
      }
    }

    if (link.kind === "same" || link.kind === "follows") {
      const otherType = fromIsSeed ? link.to_type : link.from_type;
      const otherId = fromIsSeed ? link.to_id : link.from_id;
      if (otherType === "notion_page") {
        bumpCandidate(otherId, link.kind, null, 3);
      }
      if (
        otherType === "project" &&
        (!query || titleOverlapsQuery(otherId, query))
      ) {
        projectIds.add(otherId);
      }
    }
  }

  const siblingLinks = await fetchBelongsToProjects(
    admin,
    [...projectIds],
    minConfidence
  );
  for (const link of siblingLinks) {
    if (link.from_type !== "notion_page") continue;
    bumpCandidate(link.from_id, "belongs", link.to_id, 1);
  }

  if (Date.now() - started > LINK_EXPAND_MS_SOFT) {
    maxAdd = Math.max(8, Math.floor(maxAdd / 2));
  }

  const wantIds = [...candidatePageIds.keys()].slice(0, maxAdd * 3);
  const pages = await loadPagesByIds(admin, wantIds);
  const scored: Array<{ id: string; score: number }> = [];
  for (const id of wantIds) {
    const page = pages.get(id);
    if (!page) continue;
    const meta = candidatePageIds.get(id)!;
    let score = meta.score;
    if (query && titleOverlapsQuery(page.title, query)) score += 5;
    if (query && titleOverlapsQuery(meta.project_key ?? "", query)) score += 3;
    const inRelevantProject =
      Boolean(meta.project_key) && projectIds.has(meta.project_key!);
    if (
      query &&
      !titleOverlapsQuery(page.title, query) &&
      !inRelevantProject &&
      score < 3
    ) {
      continue;
    }
    if (
      query &&
      meta.project_key &&
      !titleOverlapsQuery(meta.project_key, query) &&
      !titleOverlapsQuery(page.title, query) &&
      !inRelevantProject
    ) {
      continue;
    }
    scored.push({ id, score });
  }
  scored.sort((a, b) => b.score - a.score);

  const added: NotionSource[] = [];
  for (const row of scored.slice(0, maxAdd)) {
    const page = pages.get(row.id)!;
    const meta = candidatePageIds.get(row.id)!;
    const projectKey =
      meta.project_key && isRealProjectKey(meta.project_key)
        ? meta.project_key
        : null;
    added.push(
      pageToSource(page, {
        via_link: meta.via,
        project_key: projectKey,
        match_score: 3.2 + Math.min(2, row.score * 0.2)
      })
    );
  }

  return {
    sources: added,
    stats: {
      seed_count: seedIds.length,
      links_followed: links.length + siblingLinks.length,
      added: added.length,
      project_ids: [...projectIds].slice(0, 20),
      ms: Date.now() - started,
      max_add: maxAdd,
      capped: scored.length > maxAdd
    }
  };
}

const QUERY_STOP = new Set([
  "자료",
  "관련",
  "보여줘",
  "어떻게",
  "돼가",
  "되어",
  "가고",
  "있어",
  "있나",
  "좀",
  "다",
  "해주세요",
  "해줘",
  "요약",
  "알려줘"
]);

function titleOverlapsQuery(title: string, query: string): boolean {
  if (!title || !query) return false;
  const t = title.toLowerCase();
  const tokens =
    query
      .toLowerCase()
      .match(/[가-힣a-z0-9]{2,}/g)
      ?.filter((tok) => tok.length >= 2 && !QUERY_STOP.has(tok)) ?? [];
  return tokens.some((tok) => tok.length >= 3 && t.includes(tok));
}

function isRealProjectKey(key: string): boolean {
  const k = key.trim();
  if (k.length < 4) return false;
  if (/DB$/i.test(k)) return false;
  if (/^(프로젝트|영업|통합|캘린더|아이데이션|회의록)/.test(k)) return false;
  return true;
}

function sourceMentionsPerspective(source: NotionSource, name: string): boolean {
  const n = name.toLowerCase();
  const blob = [
    source.title,
    source.excerpt ?? "",
    ...(source.path_titles ?? []),
    source.section ?? "",
    source.hierarchy ?? ""
  ]
    .join(" ")
    .toLowerCase();
  return blob.includes(n);
}

/**
 * 질문에 관점 이름이 있으면 그 자료로 좁히고 used_count 를 올린다.
 */
export async function applyPerspectivesToSources(
  admin: SupabaseClient,
  query: string,
  sources: NotionSource[]
): Promise<{ sources: NotionSource[]; stats: PerspectiveMatchStats }> {
  const started = Date.now();
  const q = query.trim();
  const empty: PerspectiveMatchStats = {
    names: [],
    boosted: 0,
    injected: 0,
    ms: 0
  };
  if (q.length < 2) {
    empty.ms = Date.now() - started;
    return { sources, stats: empty };
  }

  const { data, error } = await admin
    .from("luna_perspectives")
    .select("id, name, used_count, status")
    .eq("status", "active")
    .order("hit_count", { ascending: false })
    .limit(200);
  if (error) {
    console.error("[luna/search-secondary] perspectives", error.message);
    empty.ms = Date.now() - started;
    return { sources, stats: empty };
  }

  const qLower = q.toLowerCase();
  const matched = (data ?? [])
    .filter((p) => {
      const name = String(p.name ?? "").trim();
      return name.length >= 2 && qLower.includes(name.toLowerCase());
    })
    .sort(
      (a, b) => String(b.name).length - String(a.name).length
    );

  if (matched.length === 0) {
    empty.ms = Date.now() - started;
    return { sources, stats: empty };
  }

  const names = matched.map((p) => String(p.name));
  const primary = names[0]!;

  let boosted = 0;
  const ranked = sources.map((s) => {
    const hit = names.some((n) => sourceMentionsPerspective(s, n));
    if (!hit) return s;
    boosted += 1;
    return {
      ...s,
      match_score: (s.match_score ?? (s.similarity ?? 0) * 10) + 4,
      perspective: primary
    };
  });
  ranked.sort(
    (a, b) =>
      (b.match_score ?? (b.similarity ?? 0) * 10) -
      (a.match_score ?? (a.similarity ?? 0) * 10)
  );

  let injected = 0;
  let next = ranked;
  // 관점 언급이 거의 없으면 제목·경로 키워드로 페이지를 보탠다
  if (boosted === 0 || (boosted < 3 && ranked.length < 5)) {
    const { data: pages } = await admin
      .from("luna_notion_pages")
      .select(
        "page_id, title, parent_id, path_titles, nas_path, url, last_edited_time"
      )
      .eq("archived", false)
      .ilike("title", `%${primary}%`)
      .limit(12);
    const have = new Set(ranked.map((s) => s.id));
    const extra: NotionSource[] = [];
    for (const row of pages ?? []) {
      const id = String(row.page_id);
      if (have.has(id)) continue;
      extra.push(
        pageToSource(row as PageRow, {
          via_link: "perspective",
          match_score: 6
        })
      );
      have.add(id);
      if (extra.length >= 8) break;
    }
    injected = extra.length;
    next = [...extra, ...ranked];
  }

  // used_count 증가 (검색에 쓰임)
  const now = new Date().toISOString();
  await Promise.all(
    matched.slice(0, 5).map(async (p) => {
      const id = String(p.id);
      const prev = typeof p.used_count === "number" ? p.used_count : 0;
      const { error: upErr } = await admin
        .from("luna_perspectives")
        .update({ used_count: prev + 1, last_used_at: now })
        .eq("id", id);
      if (upErr) {
        console.error("[luna/search-secondary] used_count", upErr.message);
      }
    })
  );

  return {
    sources: next,
    stats: {
      names,
      boosted,
      injected,
      ms: Date.now() - started
    }
  };
}

/** 시드+확장 결과를 프로젝트 키로 묶어 요약 */
export function summarizeProjectGroups(
  sources: NotionSource[]
): ProjectGroupSummary[] {
  const byKey = new Map<string, NotionSource[]>();
  for (const s of sources) {
    const key =
      s.project_key && isRealProjectKey(s.project_key) ? s.project_key : null;
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(s);
    byKey.set(key, list);
  }

  const groups: ProjectGroupSummary[] = [];
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    let meetings = 0;
    let ideation = 0;
    let proposals = 0;
    let work = 0;
    let images = 0;
    for (const s of list) {
      const t = s.title;
      if (/회의|미팅|meeting|워크숍|workshop/i.test(t)) meetings += 1;
      else if (/아이데이션|ideation/i.test(t)) ideation += 1;
      else if (/제안|기획안|report/i.test(t)) proposals += 1;
      if (s.nas_path || (s.paths?.length ?? 0) > 0) work += 1;
      if (/이미지|사진|render/i.test(t)) images += 1;
    }
    const title =
      list.find((s) => s.project_key === key)?.project_key ||
      list[0]?.path_titles?.slice(-2, -1)[0] ||
      key;
    groups.push({
      key,
      title: String(title),
      notion: list.length,
      meetings,
      ideation,
      proposals,
      work,
      images,
      page_ids: list.map((s) => s.id)
    });
  }
  groups.sort((a, b) => b.notion - a.notion);
  return groups.slice(0, 12);
}

export function mergeExpandedSources(
  base: NotionSource[],
  extra: NotionSource[]
): NotionSource[] {
  const byId = new Map<string, NotionSource>();
  for (const s of base) {
    if (s.id) byId.set(s.id, s);
  }
  for (const s of extra) {
    if (!s.id) continue;
    const prev = byId.get(s.id);
    if (!prev) {
      byId.set(s.id, s);
      continue;
    }
    byId.set(s.id, {
      ...prev,
      project_key: prev.project_key ?? s.project_key,
      via_link: prev.via_link ?? s.via_link,
      link_expanded: prev.link_expanded || s.link_expanded,
      match_score: Math.max(
        prev.match_score ?? 0,
        s.match_score ?? 0
      )
    });
  }
  return [...byId.values()].sort(
    (a, b) =>
      (b.match_score ?? (b.similarity ?? 0) * 10) -
      (a.match_score ?? (a.similarity ?? 0) * 10)
  );
}

/** 시드에 project_key 부착 (belongs → project) */
export async function annotateSeedsWithProjectKeys(
  admin: SupabaseClient,
  sources: NotionSource[]
): Promise<NotionSource[]> {
  const ids = sources.map((s) => s.id).filter(Boolean);
  if (ids.length === 0) return sources;
  const links = await fetchLinksTouching(admin, ids, LINK_EXPAND_MIN_CONF);
  const projectByPage = new Map<string, string>();
  for (const link of links) {
    if (link.kind !== "belongs") continue;
    if (link.from_type === "notion_page" && link.to_type === "project") {
      projectByPage.set(link.from_id, link.to_id);
    }
  }
  return sources.map((s) => ({
    ...s,
    project_key: s.project_key ?? projectByPage.get(s.id) ?? null
  }));
}

