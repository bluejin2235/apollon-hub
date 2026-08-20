/**
 * 인스파이어 시즌3 — 노션 히트가 수행계획서인지 확인
 * npx tsx scripts/inspect-inspire-pack.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { searchNotionForLuna } from "../lib/luna/notion-index-search";
import {
  buildSourcePacks,
  tierSourcePacks
} from "../lib/luna/source-pack";
import type { LunaCard } from "../lib/luna/tavily";
import { searchNasLegacy } from "../lib/luna/workserver";

const q = "인스파이어 시즌3 수행계획서 어디 있어";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("missing env");
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const [notion, nas] = await Promise.all([
    searchNotionForLuna(admin, q.slice(0, 80), q),
    searchNasLegacy(admin, q.slice(0, 80), q)
  ]);

  console.log("=== NOTION ===");
  for (const s of notion.sources) {
    console.log({
      title: s.title,
      sim: Number((s.similarity ?? 0).toFixed(3)),
      nas_path: s.nas_path ?? null,
      path_titles: s.path_titles ?? null,
      excerpt: (s.excerpt || "").slice(0, 160)
    });
  }

  console.log("\n=== NAS ===");
  for (const r of nas) {
    console.log({
      path: r.path,
      type: r.type,
      drive: r.drive,
      imp: r.importance
    });
  }

  const cards: LunaCard[] = nas.map((row) => {
    const name =
      row.path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || row.path;
    const isFile =
      (row.type || "").toLowerCase() === "file" ||
      /\.[a-z0-9]{1,8}$/i.test(name);
    return {
      type: "nas",
      title: name,
      url: null,
      thumbnail: null,
      description: row.file_summary || row.path,
      drive: row.drive?.trim() || undefined,
      raw_path: row.path,
      is_file: isFile
    };
  });

  const views = buildSourcePacks(notion.sources, cards);
  const tiers = tierSourcePacks(views);
  console.log("\n=== PACKS ===");
  for (const v of views) {
    if (v.kind === "project") {
      console.log({
        kind: "project",
        title: v.title,
        score: Number(v.score.toFixed(3)),
        kids: v.children.length,
        hasNotion: Boolean(v.notion),
        onlySides: v.children.map((c) => `${c.title.slice(0, 40)}:${c.onlySide}`)
      });
    } else {
      console.log({
        kind: "item",
        title: v.title,
        score: Number(v.score.toFixed(3)),
        only: v.onlySide,
        hasNotion: Boolean(v.notion),
        files: v.files.map((f) => f.name)
      });
    }
  }

  console.log("\n=== TIERS ===", {
    rec: tiers.recommended
      ? {
          title: tiers.recommended.title,
          only: tiers.recommended.onlySide,
          score: Number(tiers.recommended.score.toFixed(3)),
          files: tiers.recommended.files.map((f) => f.name)
        }
      : null,
    mid: tiers.mid.map((m) => ({
      title: m.title,
      only: m.onlySide,
      score: Number(m.score.toFixed(3))
    })),
    weak: tiers.weak.length,
    max: Number(tiers.maxScore.toFixed(3))
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
