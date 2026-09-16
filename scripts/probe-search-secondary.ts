/**
 * 검색 2차 데이터 전/후 비교
 * NODE_OPTIONS="--require ./scripts/stub-server-only.cjs" npx tsx scripts/probe-search-secondary.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { searchNotionForLuna } from "@/lib/luna/notion-index-search";
import { buildSourcePacks } from "@/lib/luna/source-pack";

const QUESTIONS = [
  "인스파이어 시즌4 어떻게 돼가?",
  "성수동2가 자료 다 보여줘",
  "더후 글로벌 론칭 관련 자료"
];

async function runOne(
  admin: ReturnType<typeof createClient>,
  q: string,
  useSecondary: boolean
) {
  const t0 = Date.now();
  const outcome = await searchNotionForLuna(admin, q, q, {
    skipLive: true,
    useSecondary
  });
  const ms = Date.now() - t0;
  const views = buildSourcePacks(outcome.sources, []);
  const projects = views.filter((v) => v.kind === "project");
  return {
    ms,
    sources: outcome.sources.length,
    link_added: outcome.secondary?.link_added ?? 0,
    link_ms: outcome.secondary?.link_ms ?? 0,
    perspectives: outcome.secondary?.perspectives ?? [],
    groups: outcome.secondary?.project_groups ?? [],
    ui_projects: projects.map((p) =>
      p.kind === "project"
        ? { title: p.title, subtitle: p.subtitle, children: p.children.length }
        : null
    ),
    titles: outcome.sources.slice(0, 8).map((s) => ({
      title: s.title,
      via: s.via_link ?? (s.link_expanded ? "link" : "search"),
      project_key: s.project_key
    }))
  };
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  for (const q of QUESTIONS) {
    console.log(`\n======== ${q} ========`);
    const before = await runOne(admin, q, false);
    const after = await runOne(admin, q, true);
    console.log(
      JSON.stringify(
        {
          before: {
            sources: before.sources,
            ms: before.ms,
            titles: before.titles
          },
          after: {
            sources: after.sources,
            ms: after.ms,
            link_added: after.link_added,
            link_ms: after.link_ms,
            delta_ms: after.ms - before.ms,
            perspectives: after.perspectives,
            groups: after.groups,
            ui_projects: after.ui_projects,
            titles: after.titles
          }
        },
        null,
        2
      )
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
