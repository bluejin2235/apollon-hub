/**
 * Devnote 화면용 로더가 DB 행을 가져오는지 확인.
 * npx tsx --require ./scripts/stub-server-only.cjs --env-file=.env.local scripts/verify-devnote-screens.ts
 */
import { config as loadEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local" });
loadEnv();

import { loadDevnoteBlockers } from "../lib/devnote/blockers";
import { loadDevnoteDecisions } from "../lib/devnote/decisions";
import { loadDevnoteIdeas } from "../lib/devnote/ideas";
import { loadDevnoteNav } from "../lib/devnote/load-nav";
import { loadDevnoteOverview } from "../lib/devnote/overview";
import { loadDevnoteServiceNote } from "../lib/devnote/service";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`missing ${name}`);
  return v;
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim();
  if (!key) throw new Error("missing SUPABASE_SERVICE_ROLE_KEY");

  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const nav = await loadDevnoteNav(client);
  const overview = await loadDevnoteOverview(client);
  const blockers = await loadDevnoteBlockers(client);
  const decisions = await loadDevnoteDecisions(client);
  const ideas = await loadDevnoteIdeas(client);
  const luna = await loadDevnoteServiceNote(client, "luna");

  const open = blockers.filter((b) => !b.resolved_at);
  const out = {
    nav: nav
      ? {
          services: nav.services.length,
          decisionCount: nav.decisionCount,
          ideaCount: nav.ideaCount,
          openBlockerCount: nav.openBlockerCount
        }
      : null,
    overviewFilled: ["body", "env", "structure", "principles"].filter(
      (k) => overview[k as keyof typeof overview]
    ).length,
    blockers: { total: blockers.length, open: open.length },
    decisions: decisions.length,
    ideas: ideas.length,
    luna: luna
      ? {
          overviewChars: luna.service.overview.length,
          decisions: luna.decisions.length,
          todos: luna.todos.length,
          dataChars: luna.service.data_notes.length
        }
      : null,
    sampleOpen: open.slice(0, 3).map((b) => ({
      title: b.title,
      service: b.service_name,
      since: b.since
    })),
    sampleDecision: decisions.slice(0, 2).map((d) => ({
      what: d.what,
      service: d.service_name,
      is_key: d.is_key
    }))
  };

  console.log(JSON.stringify(out, null, 2));
  if (!nav) throw new Error("nav null");
  if (open.length === 0) throw new Error("expected open blockers");
  if (decisions.length === 0) throw new Error("expected decisions");
  if (!luna || luna.service.overview.length === 0) {
    throw new Error("expected luna overview");
  }
  console.log("verify-devnote-screens OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
