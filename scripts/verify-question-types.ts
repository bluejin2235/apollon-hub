/**
 * 유형 판정 6문 검증. 실행: npx tsx scripts/verify-question-types.ts
 */
import { readFileSync } from "fs";
import { TYPE_CLASSIFY_FALLBACK } from "../lib/luna/prompt-fallbacks";
import {
  QUESTION_TYPE_SEED,
  classifiedRows,
  formatTypeCatalog,
  parseClassificationJson,
  resolveClassification,
  typesNeedSearch
} from "../lib/luna/question-types";

function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i < 0) continue;
      let v = line.slice(i + 1);
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      const k = line.slice(0, i);
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    /* no .env.local */
  }
}
loadEnv();

const CASES: Array<{ q: string; expect: string[] }> = [
  { q: "감리가 뭐야", expect: ["know"] },
  { q: "스타에비뉴 제안서 어디 있어?", expect: ["find"] },
  { q: "OT 체크리스트 만들어줘", expect: ["make"] },
  { q: "우리는 착수보고서를 수행계획서라고도 불러", expect: ["learn"] },
  { q: "안녕", expect: ["smalltalk"] },
  { q: "감리가 뭐고 감리 관련 자료도 찾아줘", expect: ["know", "find"] }
];

async function classifyOnce(system: string, user: string): Promise<string> {
  const key = process.env.hubtrendchat_claude?.trim();
  if (!key) throw new Error("hubtrendchat_claude missing");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system,
      messages: [{ role: "user", content: user }]
    })
  });
  if (!res.ok) {
    throw new Error(`anthropic ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  return data.content?.find((p) => p.type === "text")?.text ?? "";
}

async function main() {
  const catalog = QUESTION_TYPE_SEED.filter((t) => t.is_active);
  const system = `${TYPE_CLASSIFY_FALLBACK}\n\n[유형 목록]\n${formatTypeCatalog(catalog)}`;
  console.log("=== 유형 판정 검증 ===");
  console.log("model: claude-haiku-4-5-20251001");
  console.log("types:", catalog.map((t) => t.slug).join(", "));

  for (const c of CASES) {
    const t0 = Date.now();
    const text = await classifyOnce(system, c.q);
    const ms = Date.now() - t0;
    const parsed = parseClassificationJson(text);
    const resolved = resolveClassification(parsed, catalog);
    const rows = classifiedRows(catalog, resolved.types);
    const search = typesNeedSearch(rows);
    console.log("\nQ:", c.q);
    console.log("expect:", c.expect.join("+"), "| got:", resolved.types.join("+") || "(empty)");
    console.log("search:", search ? "있음" : "없음", "| classify_ms:", ms);
    console.log(
      "json:",
      JSON.stringify({
        types: resolved.types,
        reason: resolved.reason,
        confidence: resolved.confidence
      })
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
