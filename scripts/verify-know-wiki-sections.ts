import { config } from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { LUNA_DEFAULT_IDENTITY_PROMPT } from "@/lib/luna/constants";
import {
  formatMatchedLearningsBlock,
  pickGlossaryForQuestion,
  pickLearningsForQuestion,
  splitKeywordQuery,
  type GlossaryMatchRow,
  type LearningMatchRow
} from "@/lib/luna/knowledge-match";
import { formatGlossaryBlock } from "@/lib/luna/prompt-cache";
import {
  KEYWORD_EXTRACT_FALLBACK,
  TYPE_KNOW_FALLBACK
} from "@/lib/luna/prompt-fallbacks";
import { getPrompts, LUNA_PROMPT_KEYS } from "@/lib/luna/prompts";
import {
  formatWikiSectionsBlock,
  matchWikiSections,
  type WikiSourceRef
} from "@/lib/luna/wiki-match";
import { loadWikiDocs } from "@/lib/wiki/store";

config({ path: ".env.local" });
config();

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase env");
  }

  const admin = createClient(url, key);
  const loadedPrompts = await getPrompts(admin, [
    LUNA_PROMPT_KEYS.identity,
    LUNA_PROMPT_KEYS.know,
    LUNA_PROMPT_KEYS.answer,
    LUNA_PROMPT_KEYS.keywordExtract
  ]);
  const identity =
    loadedPrompts[LUNA_PROMPT_KEYS.identity]?.trim() || LUNA_DEFAULT_IDENTITY_PROMPT;
  const knowPrompt = loadedPrompts[LUNA_PROMPT_KEYS.know]?.trim() || TYPE_KNOW_FALLBACK;
  const answerPrompt = loadedPrompts[LUNA_PROMPT_KEYS.answer]?.trim() || "";
  const keywordPrompt =
    loadedPrompts[LUNA_PROMPT_KEYS.keywordExtract]?.trim() || KEYWORD_EXTRACT_FALLBACK;
  const client = new Anthropic({ apiKey: process.env.hubtrendchat_claude ?? "" });

  const { data: learningsData } = await admin
    .from("luna_learnings")
    .select("id, content, category, importance, use_count, created_at")
    .eq("status", "active")
    .neq("category", "identity")
    .order("importance", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  const learningsRows = (learningsData ?? []) as LearningMatchRow[];

  let glossaryRows: GlossaryMatchRow[] = [];
  let gq = await admin
    .from("glossary_terms")
    .select("id, term_ko, term_en, synonyms, definition")
    .is("deleted_at", null);
  if (gq.error) {
    gq = await admin
      .from("glossary_terms")
      .select("id, term_ko, term_en, synonyms, definition");
  }
  if (!gq.error) glossaryRows = (gq.data ?? []) as GlossaryMatchRow[];
  const { items: wikiDocs } = await loadWikiDocs(admin, { activeOnly: true });

  const questions = [
    "RFP 분석 어떻게 해?",
    "RFP 볼 때 근거는 어떻게 써?",
    "감리가 뭐야"
  ];

  const results: Array<Record<string, unknown>> = [];
  for (const question of questions) {
    const startedAt = Date.now();
    const kwRes = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 64,
      system: keywordPrompt,
      messages: [{ role: "user", content: question }]
    });
    const keywordText =
      kwRes.content.find((p) => p.type === "text")?.text?.trim() ?? "";
    const injectKeywords = splitKeywordQuery(keywordText, question, glossaryRows);
    const wikiSources = matchWikiSections(wikiDocs, injectKeywords, question);
    const matchedTerms = pickGlossaryForQuestion(glossaryRows, injectKeywords);
    const knowledgeInject = pickLearningsForQuestion(learningsRows, injectKeywords);
    const system = [
      identity,
      knowPrompt,
      answerPrompt,
      formatGlossaryBlock(matchedTerms),
      formatWikiSectionsBlock(wikiSources),
      formatMatchedLearningsBlock({
        matched: knowledgeInject.matched,
        other: knowledgeInject.other
      })
    ]
      .filter(Boolean)
      .join("\n\n");
    const answerRes = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 500,
      system,
      messages: [{ role: "user", content: question }]
    });
    const answer = answerRes.content.find((p) => p.type === "text")?.text?.trim() ?? "";
    const durationMs = Date.now() - startedAt;
    results.push({
      question,
      duration_ms: durationMs,
      wiki_sources: wikiSources.map((w: WikiSourceRef) => ({
        doc: w.title,
        section: w.section_title,
        score: w.score,
        path: w.path
      })),
      answer
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
