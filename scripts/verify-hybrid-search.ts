/**
 * 하이브리드 검색 검증 (키워드+임베딩).
 * 마이그레이션·백필 전에는 schema_missing / 빈 임베딩으로 키워드만 나온다.
 *
 *   npx tsx scripts/verify-hybrid-search.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { createClient } from "@supabase/supabase-js";
import { retrieveKnowledgeEmbeddings } from "../lib/luna/embedding-retrieve";
import { splitKeywordQuery } from "../lib/luna/knowledge-match";
import {
  pickGlossaryForQuestion,
  pickLearningsForQuestion,
  type GlossaryMatchRow,
  type LearningMatchRow
} from "../lib/luna/knowledge-match";
import { matchWikiSections } from "../lib/luna/wiki-match";
import { loadWikiDocs } from "../lib/wiki/store";

const CASES = [
  {
    q: "병가규정 알려줘",
    expectSlug: "leave-guide",
    expectSection: /병가휴가/
  },
  {
    q: "미디어조형물 인허가 프로세스",
    expectSlug: "media-sculpture",
    expectSection: /심의/
  },
  {
    q: "KCC 프로젝트 알려줘",
    expectSlug: "gwangan-kcc-switzen",
    expectSection: /./
  },
  {
    q: "견적서 어떻게 써",
    expectSection: /견적/
  },
  {
    q: "RFP 볼 때 근거는",
    expectSection: /근거/
  },
  {
    q: "감리가 뭐야",
    expectGlossary: /감리/
  }
] as const;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) {
    console.error("env missing");
    process.exit(1);
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { items: wikiDocs } = await loadWikiDocs(admin, { activeOnly: true });
  const { data: learningsData } = await admin
    .from("luna_learnings")
    .select("id, content, category, importance, use_count, created_at")
    .eq("status", "active")
    .neq("category", "identity")
    .limit(200);
  let glossaryRows: GlossaryMatchRow[] = [];
  {
    const gq = await admin
      .from("glossary_terms")
      .select("id, term_ko, term_en, synonyms, definition")
      .is("deleted_at", null);
    if (!gq.error) glossaryRows = (gq.data ?? []) as GlossaryMatchRow[];
  }

  console.log(
    [
      "질문",
      "선택",
      "keyword",
      "embedding",
      "final",
      "via",
      "판정"
    ].join("\t")
  );

  for (const c of CASES) {
    const emb = await retrieveKnowledgeEmbeddings(admin, c.q, {
      timeoutMs: 12_000
    });
    const keywords = splitKeywordQuery(c.q, c.q, glossaryRows);
    const wiki = matchWikiSections(wikiDocs, keywords, c.q, emb.wiki);
    const gloss = pickGlossaryForQuestion(glossaryRows, keywords, emb.glossary);
    const learn = pickLearningsForQuestion(
      (learningsData ?? []) as LearningMatchRow[],
      keywords,
      { embeddingHits: emb.learning }
    );

    if ("expectGlossary" in c && c.expectGlossary) {
      const top = gloss[0];
      const ok = top && c.expectGlossary.test(top.term_ko ?? "");
      console.log(
        [
          c.q,
          top ? `용어:${top.term_ko}` : "(없음)",
          (top?.keyword_score ?? 0).toFixed(2),
          (top?.embedding_score ?? 0).toFixed(2),
          ((top?.keyword_score ?? 0) + (top?.embedding_score ?? 0)).toFixed(2),
          top?.match_via ?? "-",
          ok ? "OK" : "FAIL",
          learn.matched[0] ? `+지식` : ""
        ].join("\t")
      );
      continue;
    }

    const top = wiki[0];
    const label = top
      ? `${top.slug} / ${top.section_title}`
      : "(없음)";
    let ok = Boolean(top);
    if (top && "expectSlug" in c && c.expectSlug) {
      ok = top.slug === c.expectSlug;
    }
    if (top && "expectSection" in c && c.expectSection) {
      ok = ok && c.expectSection.test(top.section_title);
    }
    console.log(
      [
        c.q,
        label,
        (top?.keyword_score ?? 0).toFixed(2),
        (top?.embedding_score ?? 0).toFixed(2),
        (top?.score ?? 0).toFixed(2),
        top?.match_via ?? "-",
        ok ? "OK" : "FAIL"
      ].join("\t")
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
