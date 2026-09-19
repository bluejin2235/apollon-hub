/**
 * memo ↔ 용어사전 정규화
 * - 동의어·오타 → 정식 표기 (토큰 단위만. 부분 문자열 금지)
 * - memo 말버릇 줄임말 → 용어 후보
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createCandidate } from "@/lib/luna/candidates";
import { getSttHintPrompt } from "@/lib/luna/stt-prompt";

export type GlossaryCanon = {
  byKey: Map<string, string>;
  fuzzyOfficials: string[];
  officials: string[];
};

function normKey(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

/** 한글·영문 짧은 편집거리 (길이 차 ≤1) */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 1) return 99;
  const prev = new Array<number>(n + 1);
  const cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    cur[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j += 1) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(
        (prev[j] ?? 99) + 1,
        (cur[j - 1] ?? 99) + 1,
        (prev[j - 1] ?? 99) + cost
      );
    }
    for (let j = 0; j <= n; j += 1) prev[j] = cur[j] ?? 99;
  }
  return prev[n] ?? 99;
}

export async function loadGlossaryCanon(
  admin: SupabaseClient
): Promise<GlossaryCanon> {
  const { data, error } = await admin
    .from("glossary_terms")
    .select("term_ko, synonyms")
    .is("deleted_at", null)
    .limit(800);
  if (error) {
    console.error("[luna/memo-glossary] load", error);
    return { byKey: new Map(), fuzzyOfficials: [], officials: [] };
  }

  const byKey = new Map<string, string>();
  const officials: string[] = [];

  for (const row of data ?? []) {
    const official = typeof row.term_ko === "string" ? row.term_ko.trim() : "";
    if (!official || official.length < 2) continue;
    officials.push(official);
    byKey.set(normKey(official), official);
    const syns = Array.isArray(row.synonyms) ? row.synonyms : [];
    for (const s of syns) {
      if (typeof s !== "string") continue;
      const syn = s.trim();
      if (syn.length < 2) continue;
      // 짧은 동의어가 긴 정식어의 일부를 가로채지 않게: 동의어는 토큰 전체 일치만
      byKey.set(normKey(syn), official);
    }
  }
  officials.sort((a, b) => b.length - a.length);

  const fuzzyOfficials = officials.filter((o) => {
    const t = o.replace(/\s+/g, "");
    // 길이 4 미만·너무 흔한 일반어는 퍼지 금지
    if (t.length < 4) return false;
    if (/^(견적서|계약서|배치도|구조도|하중)$/.test(t)) return false;
    return true;
  });

  return { byKey, fuzzyOfficials, officials };
}

/** STT 와 같은 하루 캐시 용어 목록 (프롬프트용) */
export async function formalTermsForMemoPrompt(
  admin: SupabaseClient
): Promise<string> {
  return getSttHintPrompt(admin);
}

function bestFuzzyOfficial(
  token: string,
  fuzzyOfficials: string[]
): string | null {
  const t = token.replace(/\s+/g, "");
  if (t.length < 4) return null;
  let best: string | null = null;
  let bestDist = 99;
  for (const official of fuzzyOfficials) {
    const o = official.replace(/\s+/g, "");
    // 같은 길이만 — 한 글자 오타 (볼팰견적↔볼팍견적). 길이 다른 건 동의어 맵에 맡김
    if (o.length !== t.length) continue;
    const d = editDistance(t, o);
    if (d === 1 && d < bestDist) {
      bestDist = d;
      best = official;
    }
  }
  return best;
}

/**
 * memo 본문을 용어사전 정식 표기로 고친다. 토큰 단위만.
 *
 * 안전 규칙 (2026-09 테스트 후):
 * - 동의어·정식어 **정확 일치**만 치환한다.
 * - 편집거리 퍼지는 쓰지 않는다. 「프로그램」→「홀로그램」처럼
 *   사전 정식어로 잘못 끌어가는 오교정이 memo 에 박히기 때문이다.
 * - 퍼지 후보는 skippedFuzzy 로만 남겨 로그·점검에 쓴다.
 */
export function normalizeMemoAgainstGlossary(
  memo: string,
  canon: GlossaryCanon
): {
  text: string;
  fixes: Array<{ from: string; to: string }>;
  skippedFuzzy: Array<{ from: string; would: string }>;
} {
  if (!memo.trim() || canon.officials.length === 0) {
    return { text: memo, fixes: [], skippedFuzzy: [] };
  }

  const fixes: Array<{ from: string; to: string }> = [];
  const skippedFuzzy: Array<{ from: string; would: string }> = [];
  const seenFix = new Set<string>();
  const seenFuzzy = new Set<string>();

  const record = (from: string, to: string) => {
    if (from === to) return;
    const fk = `${from}→${to}`;
    if (seenFix.has(fk)) return;
    seenFix.add(fk);
    fixes.push({ from, to });
  };

  const text = memo.replace(/[가-힣A-Za-z][가-힣A-Za-z0-9]*/g, (token) => {
    const exact = canon.byKey.get(normKey(token));
    if (exact && exact !== token) {
      record(token, exact);
      return exact;
    }
    // 퍼지 후보는 적용하지 않고 기록만
    const fuzzy = bestFuzzyOfficial(token, canon.fuzzyOfficials);
    if (fuzzy && fuzzy !== token) {
      const fk = `${token}→${fuzzy}`;
      if (!seenFuzzy.has(fk)) {
        seenFuzzy.add(fk);
        skippedFuzzy.push({ from: token, would: fuzzy });
      }
    }
    return token;
  });

  return { text, fixes, skippedFuzzy };
}

/**
 * memo 「말버릇」의 따옴표 줄임말만 — 용어사전에 없으면 후보
 */
export function findMemoShorthandCandidates(
  memo: string,
  canon: GlossaryCanon
): string[] {
  const found = new Set<string>();
  const habit =
    memo
      .split(/\n(?=하는 일|답할 때|말버릇|자주 찾는 것)/)
      .find((s) => s.trim().startsWith("말버릇")) ?? "";
  const focus = habit || memo;

  for (const m of focus.matchAll(/[「『“"]([^」』”"]{1,16})[」』”"]/g)) {
    const raw = (m[1] ?? "").trim();
    // 문장·요청문은 제외. 공백 없는 짧은 별칭만 (볼팍 · 전주 · 시즌4)
    if (/\s/.test(raw)) continue;
    const term = raw.replace(/\s+/g, "");
    if (term.length < 2 || term.length > 12) continue;
    if (!/^[가-힣A-Za-z0-9]+$/.test(term)) continue;
    if (canon.byKey.has(normKey(term))) continue;
    found.add(term);
  }

  // 「X」는 Y / X = Y
  for (const m of focus.matchAll(
    /[「『“"]([가-힣A-Za-z0-9]{2,12})[」』”"]\s*(?:는|=|→)/g
  )) {
    const short = (m[1] ?? "").trim();
    if (!short) continue;
    if (canon.byKey.has(normKey(short))) continue;
    found.add(short);
  }

  return [...found].slice(0, 8);
}

export async function promoteMemoShorthandsAsGlossaryCandidates(
  admin: SupabaseClient,
  opts: {
    userId: string;
    memo: string;
    canon: GlossaryCanon;
  }
): Promise<number> {
  const terms = findMemoShorthandCandidates(opts.memo, opts.canon);
  let created = 0;
  for (const term of terms) {
    const row = await createCandidate(admin, {
      content: `개인 memo 말버릇 「${term}」 — 정식 표기를 정해 주세요.`,
      source: "selfstudy",
      category: "term",
      author_id: opts.userId,
      meta: {
        kind: "glossary",
        term_ko: term,
        definition:
          "루나 개인 memo 에서 나온 줄임말/별칭. 정식 표기를 정해 주세요.",
        from_user_memory: true
      },
      evidence: opts.memo.slice(0, 400)
    });
    if (row) created += 1;
  }
  return created;
}
