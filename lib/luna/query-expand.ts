/**
 * 검색 질의 표기 확장 — 날짜·숫자·층·용어사전 동의어.
 * 임베딩 문장은 바꾸지 않고, 키워드/ilike 토큰만 늘린다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeSynonyms } from "@/lib/glossary/synonyms";

export type QueryExpandGlossaryRow = {
  term_ko: string | null;
  term_en?: string | null;
  term_zh?: string | null;
  synonyms?: unknown;
};

export type QueryExpandResult = {
  extra: string[];
};

const KO_NUM: Record<string, number> = {
  일: 1,
  이: 2,
  삼: 3,
  사: 4,
  오: 5,
  육: 6,
  칠: 7,
  팔: 8,
  구: 9,
  십: 10
};
const NUM_KO: Record<number, string> = {
  1: "일",
  2: "이",
  3: "삼",
  4: "사",
  5: "오",
  6: "육",
  7: "칠",
  8: "팔",
  9: "구",
  10: "십"
};

/** 아폴론 프로젝트 코드에 쓰는 최근 연도. 질문에 연이 없으면 둘 다 넣는다. */
const PROJECT_YEARS = [2025, 2026] as const;

function compact(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function pushUnique(out: string[], seen: Set<string>, raw: string): void {
  const t = raw.trim();
  if (t.length < 2) return;
  const key = t.toLowerCase();
  if (key.length < 2 || seen.has(key)) return;
  seen.add(key);
  out.push(t);
}

function parseYmd(y: number | null, m: number, d: number): {
  y: number | null;
  m: number;
  d: number;
} | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y != null && (y < 1990 || y > 2040)) return null;
  return { y, m, d };
}

function dateVariants(y: number | null, m: number, d: number): string[] {
  const mm = pad2(m);
  const dd = pad2(d);
  const years = y != null ? [y] : [...PROJECT_YEARS];
  const projectCodes: string[] = [];
  for (const year of years) {
    const yy = String(year).slice(-2);
    projectCodes.push(`${yy}${mm}${dd}`);
  }
  return [
    `${m}/${d}`,
    `${mm}.${dd}`,
    ...projectCodes,
    `${mm}${dd}`
  ];
}

export function expandDateTokens(text: string): string[] {
  const extra: string[] = [];
  const seen = new Set<string>();
  const parsed: Array<{ y: number | null; m: number; d: number }> = [];

  const add = (y: number | null, m: number, d: number) => {
    const p = parseYmd(y, m, d);
    if (!p) return;
    const key = `${p.y ?? 0}-${p.m}-${p.d}`;
    if (parsed.some((x) => `${x.y ?? 0}-${x.m}-${x.d}` === key)) return;
    parsed.push(p);
  };

  for (const m of text.matchAll(
    /(?:(20\d{2}|'\d{2}|`\d{2})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/g
  )) {
    let y: number | null = null;
    if (m[1]) {
      const raw = m[1].replace(/['`]/g, "");
      y = raw.length === 2 ? 2000 + Number(raw) : Number(raw);
    }
    add(y, Number(m[2]), Number(m[3]));
  }

  for (const m of text.matchAll(/\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/g)) {
    add(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  for (const m of text.matchAll(/(?<!\d)(\d{1,2})[./](\d{1,2})(?!\d)/g)) {
    add(null, Number(m[1]), Number(m[2]));
  }

  for (const m of text.matchAll(/(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/g)) {
    add(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  for (const m of text.matchAll(/(?<!\d)(\d{2})(\d{2})(\d{2})(?!\d)/g)) {
    const yy = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    if (yy < 20 || yy > 40) continue;
    add(2000 + yy, month, day);
  }

  const compactQ = compact(text);
  for (const p of parsed) {
    for (const v of dateVariants(p.y, p.m, p.d)) {
      if (compact(v) === compactQ) continue;
      if (compactQ.includes(compact(v)) && compact(v).length >= 4) continue;
      pushUnique(extra, seen, v);
    }
  }
  return extra.slice(0, 10);
}

export function expandNumberTokens(text: string): string[] {
  const extra: string[] = [];
  const seen = new Set<string>();
  const unitValue: Record<string, number> = { 억: 1e8, 만: 1e4, 천: 1e3 };

  for (const m of text.matchAll(/(\d{1,3}(?:,\d{3})+)(?:\s*(억|만|천))?/g)) {
    const raw = m[1] ?? "";
    const unit = m[2] ?? "";
    const n = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    pushUnique(extra, seen, `${n}${unit}`);
    if (unit && unitValue[unit]) {
      const full = Math.round(n * unitValue[unit]);
      if (full >= 1000) {
        pushUnique(extra, seen, String(full));
        pushUnique(extra, seen, full.toLocaleString("en-US"));
      }
    }
  }

  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*(억|만|천)/g)) {
    const n = Number(m[1]);
    const unit = m[2] ?? "";
    if (!Number.isFinite(n) || !unit) continue;
    const comma = n.toLocaleString("en-US");
    pushUnique(extra, seen, `${comma}${unit}`);
    const full = Math.round(n * (unitValue[unit] ?? 1));
    if (full >= 1000) {
      pushUnique(extra, seen, String(full));
      pushUnique(extra, seen, full.toLocaleString("en-US"));
    }
  }

  return extra.slice(0, 6);
}

export function expandFloorTokens(text: string): string[] {
  const extra: string[] = [];
  const seen = new Set<string>();

  const addFloor = (n: number) => {
    if (n < 1 || n > 200) return;
    pushUnique(extra, seen, `${n}층`);
    pushUnique(extra, seen, `${n}F`);
    pushUnique(extra, seen, `${n}f`);
    const ko = NUM_KO[n];
    if (ko) pushUnique(extra, seen, `${ko}층`);
  };

  for (const m of text.matchAll(/(\d{1,3})\s*[~～\-]\s*(\d{1,3})\s*층/g)) {
    addFloor(Number(m[1]));
    addFloor(Number(m[2]));
  }
  for (const m of text.matchAll(/(\d{1,3})\s*층/g)) addFloor(Number(m[1]));
  for (const m of text.matchAll(/(\d{1,3})\s*F\b/gi)) addFloor(Number(m[1]));
  for (const m of text.matchAll(/([일이삼사오육칠팔구십])\s*층/g)) {
    const n = KO_NUM[m[1] ?? ""];
    if (n) addFloor(n);
  }

  return extra.slice(0, 6);
}

function glossarySurfaces(row: QueryExpandGlossaryRow): string[] {
  const fields = [
    row.term_ko ?? "",
    row.term_en ?? "",
    row.term_zh ?? "",
    ...normalizeSynonyms(row.synonyms)
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    const t = f.trim();
    if (t.length < 2) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function surfaceUsable(surface: string): boolean {
  const c = compact(surface);
  if (c.length >= 3) return true;
  return c.length === 2 && /[a-z]/i.test(surface);
}

function queryHasSurface(query: string, surface: string): boolean {
  const c = compact(surface);
  if (!surfaceUsable(surface)) return false;
  if (/^[a-z0-9]+$/i.test(c) && c.length <= 3) {
    const re = new RegExp(`(^|[^a-z0-9])${c}([^a-z0-9]|$)`, "i");
    return re.test(query);
  }
  return compact(query).includes(c);
}

function spacingVariants(surface: string): string[] {
  const t = surface.trim();
  const nospace = t.replace(/\s+/g, "");
  const mixed = t
    .replace(/([가-힣])([A-Za-z])/g, "$1 $2")
    .replace(/([A-Za-z])([가-힣])/g, "$1 $2");
  return [t, nospace, mixed];
}

export function expandGlossaryTokens(
  text: string,
  glossary: QueryExpandGlossaryRow[]
): string[] {
  if (!text.trim() || glossary.length === 0) return [];
  const extra: string[] = [];
  const seen = new Set<string>();

  type Hit = { surfaces: string[]; matchedLen: number };
  const hits: Hit[] = [];
  for (const row of glossary) {
    const surfaces = glossarySurfaces(row);
    if (surfaces.length < 2) continue;
    let matchedLen = 0;
    for (const s of surfaces) {
      if (queryHasSurface(text, s)) {
        matchedLen = Math.max(matchedLen, compact(s).length);
      }
    }
    if (matchedLen === 0) continue;
    hits.push({ surfaces, matchedLen });
  }
  hits.sort((a, b) => b.matchedLen - a.matchedLen);

  for (const hit of hits) {
    for (const s of hit.surfaces) {
      if (!surfaceUsable(s)) continue;
      for (const v of spacingVariants(s)) {
        if (v.length < 2) continue;
        // 질문에 이미 그대로 있으면 ilike 가 그 토큰으로 찾는다
        if (text.toLowerCase().includes(v.toLowerCase())) continue;
        pushUnique(extra, seen, v);
      }
    }
    if (extra.length >= 8) break;
  }
  return extra.slice(0, 8);
}

export function expandQueryNotations(
  text: string,
  glossary: QueryExpandGlossaryRow[] = []
): QueryExpandResult {
  const extra: string[] = [];
  const seen = new Set<string>();
  const q = text.trim();
  if (!q) return { extra };

  for (const v of [
    ...expandDateTokens(q),
    ...expandNumberTokens(q),
    ...expandFloorTokens(q),
    ...expandGlossaryTokens(q, glossary)
  ]) {
    pushUnique(extra, seen, v);
  }
  return { extra: extra.slice(0, 14) };
}

let glossaryCache: { at: number; rows: QueryExpandGlossaryRow[] } | null = null;
const GLOSSARY_TTL_MS = 5 * 60 * 1000;

export async function loadQueryExpandGlossary(
  admin: SupabaseClient
): Promise<QueryExpandGlossaryRow[]> {
  if (glossaryCache && Date.now() - glossaryCache.at < GLOSSARY_TTL_MS) {
    return glossaryCache.rows;
  }
  let res = await admin
    .from("glossary_terms")
    .select("term_ko, term_en, term_zh, synonyms")
    .is("deleted_at", null)
    .limit(800);
  if (res.error) {
    res = await admin
      .from("glossary_terms")
      .select("term_ko, term_en, term_zh, synonyms")
      .limit(800);
  }
  if (res.error) {
    console.error("[luna/query-expand] glossary", res.error);
    return glossaryCache?.rows ?? [];
  }
  const rows = (res.data ?? []) as QueryExpandGlossaryRow[];
  glossaryCache = { at: Date.now(), rows };
  return rows;
}
