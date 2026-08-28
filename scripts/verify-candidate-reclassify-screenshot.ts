/**
 * 지식후보 7건 재분류 검증 — HTML 렌더 + 스크린샷
 * npx tsx scripts/verify-candidate-reclassify-screenshot.ts
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { chromium } from "playwright";

config({ path: ".env.local" });
config();

const IDS = [
  "cba0881e-4b60-4c0c-8854-f7f420a38bde",
  "a8bb7ca6-7633-404a-8c2d-3df238733a26",
  "0e23ed9f-cab0-4ec9-8190-020e5fe2181a",
  "a9c07423-e86f-474a-915b-f3adcdbf1aee",
  "87ae3b81-e2b1-4f41-844f-b4271ccda090",
  "6d22450f-af18-42cf-a6dc-c2436a5d2eaa",
  "0f4067e0-f544-4610-b7af-507c7cc4b1c1"
];

type Row = {
  id: string;
  content: string;
  category: string;
  meta: Record<string, unknown> | null;
  duplicate_of: string | null;
};

function isGlossary(row: Row): boolean {
  const m = row.meta ?? {};
  return m.kind === "glossary" || row.category === "term";
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function termCard(row: Row, matchDef: string | null): string {
  const m = row.meta ?? {};
  const term = String(m.term_ko ?? "용어");
  const def = String(m.definition ?? row.content);
  const mode = matchDef ? "기존 뜻을 이렇게 바꾸기" : "용어사전에 새로 추가";
  return `
  <article class="card term">
    <div class="card-head"><span class="chip-term">용어</span> 용어사전에 넣을까요?</div>
    <div class="card-body">
      <div class="compare">
        <div class="col old"><div class="lbl">이미 있는 뜻</div><div>${esc(matchDef ?? "아직 없는 용어예요")}</div></div>
        <div class="col new"><div class="lbl">새로 들은 뜻</div><div>${esc(def)}</div></div>
      </div>
      <div class="proposal"><div class="lbl-luna">🌙 이렇게 하려고 해요</div>
        <strong>${esc(term)}</strong><div>${esc(def)}</div>
        <div class="hint">→ ${mode}</div>
      </div>
      <div class="actions"><button class="primary">맞아요</button><button>아니에요</button><span class="sp"></span><button class="ghost">나중에</button></div>
    </div>
  </article>`;
}

function knowledgeCard(row: Row, existing: string | null): string {
  const dup = existing
    ? `<div class="compare">
        <div class="col old"><div class="lbl">이미 아는 것</div><div>${esc(existing)}</div></div>
        <div class="col new"><div class="lbl">새로 들은 것</div><div>${esc(row.content)}</div></div>
      </div>`
    : `<div class="solo">${esc(row.content)}</div>`;
  return `
  <article class="card know">
    <div class="card-head"><span class="chip-know">지식</span> 이렇게 이해했어요</div>
    <div class="card-body">${dup}
      <div class="proposal"><div class="lbl-luna">🌙 이렇게 하려고 해요</div><div>${esc(row.content.slice(0, 120))}…</div></div>
      <div class="actions"><button class="primary">맞아요</button><button>아니에요</button><span class="sp"></span><button class="ghost">나중에</button></div>
    </div>
  </article>`;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env");

  const admin = createClient(url, key);
  const { data: rows, error } = await admin
    .from("luna_learnings")
    .select("id, content, category, meta, duplicate_of")
    .in("id", IDS)
    .eq("status", "candidate");
  if (error) throw error;
  if (!rows?.length) throw new Error("No candidate rows");

  const glossaryCount = rows.filter(isGlossary).length;
  const knowledgeCount = rows.length - glossaryCount;

  const dupIds = rows.map((r) => r.duplicate_of).filter(Boolean) as string[];
  const activeMap = new Map<string, string>();
  if (dupIds.length) {
    const { data: actives } = await admin
      .from("luna_learnings")
      .select("id, content")
      .in("id", dupIds);
    for (const a of actives ?? []) activeMap.set(a.id, a.content);
  }

  const { data: terms } = await admin
    .from("glossary_terms")
    .select("term_ko, definition")
    .is("deleted_at", null);
  const termMap = new Map(
    (terms ?? []).map((t) => [String(t.term_ko).toLowerCase(), t.definition as string])
  );

  const termRows = rows.filter(isGlossary);
  const knowRows = rows.filter((r) => !isGlossary(r));

  const chips = `
    <div class="filters">
      <span class="f">전체 ${rows.length}</span>
      <span class="f">대화에서</span>
      <span class="f active">용어 ${glossaryCount}</span>
      <span class="f">알려주기</span>
    </div>`;

  const termHtml = termRows
    .map((r) => {
      const ko = String(r.meta?.term_ko ?? "").toLowerCase();
      return termCard(r, termMap.get(ko) ?? null);
    })
    .join("");

  const knowHtml = knowRows
    .map((r) => knowledgeCard(r, r.duplicate_of ? activeMap.get(r.duplicate_of) ?? null : null))
    .join("");

  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>
<title>지식후보 재분류 검증</title>
<style>
  *{box-sizing:border-box} body{font-family:system-ui,sans-serif;background:#f4f4f5;margin:0;padding:24px;color:#111}
  h1{font-size:18px;margin:0 0 8px} .sub{color:#666;font-size:13px;margin-bottom:20px}
  .filters{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
  .f{padding:6px 12px;border-radius:999px;border:1px solid #ddd;background:#fff;font-size:12px}
  .f.active{background:#faf3e2;border-color:#d4bc7a;font-weight:700;color:#8a6d2f}
  .section{margin-bottom:32px} .section h2{font-size:14px;margin:0 0 12px;color:#444}
  .card{border:1px solid #e5e5e5;border-radius:12px;background:#fff;margin-bottom:16px;overflow:hidden}
  .card-head{padding:11px 15px;background:#fbfbfd;border-bottom:1px solid #eee;font-size:12px;font-weight:600;display:flex;gap:8px;align-items:center}
  .chip-term,.chip-know{font-size:9.5px;font-weight:700;padding:2px 7px;border-radius:9px}
  .chip-term{background:#faf3e2;color:#8a6d2f} .chip-know{background:#eaf7f2;color:#0f6e56}
  .card-body{padding:15px} .compare{display:flex;border:1px solid #e5e5e5;border-radius:10px;overflow:hidden;margin-bottom:14px}
  .col{flex:1;padding:12px 14px;font-size:12.5px;line-height:1.75}
  .old{background:#faf7ee;border-right:1px solid #e5e5e5} .new{background:#eaf7f2}
  .lbl{font-size:10px;font-weight:700;margin-bottom:6px} .old .lbl{color:#8a6d2f} .new .lbl{color:#0f6e56}
  .proposal{border:1px solid #e8e0ff;background:#fcfaff;border-radius:10px;padding:13px 15px;margin-bottom:14px;font-size:13px;line-height:1.8}
  .lbl-luna{font-size:11px;font-weight:700;color:#5b4bb7;margin-bottom:6px}
  .hint{font-size:11px;color:#888;margin-top:8px}
  .solo{font-size:13px;line-height:1.75;margin-bottom:14px}
  .actions{display:flex;gap:7px;align-items:center} .sp{flex:1}
  button{border:1px solid #ddd;background:#fff;padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;cursor:default}
  button.primary{background:#111;color:#fff;border-color:#111}
  button.ghost{background:transparent;border:none;color:#999}
</style></head><body>
  <h1>지식후보 — 재분류 검증 (${new Date().toISOString().slice(0, 10)})</h1>
  <p class="sub">용어 ${glossaryCount} · 지식 ${knowledgeCount} · /settings?tab=luna&amp;luna=candidates</p>
  ${chips}
  <div class="section"><h2>용어 필터 (${glossaryCount}건) — TermReviewCard</h2>${termHtml || "<p>없음</p>"}</div>
  <div class="section"><h2>지식 후보 (${knowledgeCount}건) — KnowledgeReviewCard</h2>${knowHtml || "<p>없음</p>"}</div>
</body></html>`;

  const outDir = join(process.cwd(), "docs", "verification");
  mkdirSync(outDir, { recursive: true });
  const htmlPath = join(outDir, "candidate-reclassify-verify.html");
  writeFileSync(htmlPath, html, "utf8");

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 920, height: 1400 } });
  await page.goto(`file:///${htmlPath.replace(/\\/g, "/")}`, { waitUntil: "networkidle" });
  const shotAll = join(outDir, "candidate-reclassify-all.png");
  await page.screenshot({ path: shotAll, fullPage: true });

  await page.setViewportSize({ width: 920, height: 900 });
  const termSection = page.locator(".section").first();
  await termSection.screenshot({ path: join(outDir, "candidate-reclassify-terms.png") });
  const knowSection = page.locator(".section").nth(1);
  await knowSection.screenshot({ path: join(outDir, "candidate-reclassify-knowledge.png") });

  await browser.close();

  console.log(JSON.stringify({ glossaryCount, knowledgeCount, htmlPath, shotAll }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
