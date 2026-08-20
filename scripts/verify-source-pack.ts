/**
 * 자료 카드 묶기 검증
 * 실행: npx tsx scripts/verify-source-pack.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import { searchNotionForLuna } from "../lib/luna/notion-index-search";
import {
  buildSourcePacks,
  countSourcePackMaterials,
  tierSourcePacks,
  type SourcePackView
} from "../lib/luna/source-pack";
import type { LunaCard } from "../lib/luna/tavily";
import type { NotionSource } from "../lib/luna/notion";

const QUESTIONS = [
  "롯데타워 1차 아이데이션 자료 찾아줘",
  "롯데타워 서울스카이 제안 어떻게 했어",
  "스타에비뉴 제안서 어디 있어",
  "260513 WTCS 무역센터"
];

function summarize(view: SourcePackView): string {
  if (view.kind === "project") {
    const kids = view.children
      .map(
        (c) =>
          `    · ${c.title} [${c.onlySide ?? `노션${c.files.length ? "·파일" : ""}`}]`
      )
      .join("\n");
    return `PROJECT ${view.title} (${view.children.length}건)\n${kids}`;
  }
  const bits = [
    view.onlySide === "notion"
      ? "노션에만"
      : view.onlySide === "nas"
        ? "Work만"
        : "묶음",
    view.files.length ? `파일 ${view.files.length}` : null,
    view.folder ? "폴더" : null
  ].filter(Boolean);
  return `ITEM ${view.title} (${bits.join(" · ")})`;
}

function cardsFromNotionPaths(sources: NotionSource[]): LunaCard[] {
  const cards: LunaCard[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    const p = s.nas_path?.trim();
    if (!p) continue;
    const m = p.match(/^([A-Za-z]):\\(.+)$/);
    const drive = m ? m[1] : "P";
    const raw = m ? m[2] : p.replace(/^[A-Za-z]:\\/, "");
    const leaf = raw.split("\\").pop() || raw;
    const key = `${drive}:${raw}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({
      type: "nas",
      title: leaf,
      url: null,
      thumbnail: null,
      description: raw,
      drive,
      raw_path: raw,
      is_file: false
    });
    cards.push({
      type: "nas",
      title: `${leaf}_1팀_FIN.pdf`,
      url: null,
      thumbnail: null,
      description: `${raw}\\${leaf}_1팀_FIN.pdf`,
      drive,
      raw_path: `${raw}\\${leaf}_1팀_FIN.pdf`,
      is_file: true
    });
    // 상위 폴더 — 묶이면 안 됨
    const parent = raw.includes("\\") ? raw.slice(0, raw.lastIndexOf("\\")) : "";
    if (parent) {
      const pkey = `${drive}:${parent}`.toLowerCase();
      if (!seen.has(pkey)) {
        seen.add(pkey);
        cards.push({
          type: "nas",
          title: parent.split("\\").pop() || parent,
          url: null,
          thumbnail: null,
          description: parent,
          drive,
          raw_path: parent,
          is_file: false
        });
      }
    }
  }
  return cards;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing supabase env");
    process.exit(1);
  }
  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  console.log("=== Source pack verification ===\n");

  {
    const high: NotionSource[] = [
      {
        id: "a",
        title: "추천",
        url: "https://notion.so/a",
        similarity: 0.86,
        excerpt: "본문"
      },
      {
        id: "b",
        title: "중간1",
        url: "https://notion.so/b",
        similarity: 0.62
      },
      {
        id: "c",
        title: "중간2",
        url: "https://notion.so/c",
        similarity: 0.55
      },
      {
        id: "d",
        title: "약함",
        url: "https://notion.so/d",
        similarity: 0.41
      }
    ];
    const t = tierSourcePacks(buildSourcePacks(high, []));
    console.log(
      `TIER high: rec=${t.recommended?.title ?? "-"} mid=${t.mid.length} weak=${t.weak.length} low=${t.lowConfidence}`
    );
    const low = high.map((s, i) => ({ ...s, similarity: 0.3 - i * 0.02 }));
    const tLow = tierSourcePacks(buildSourcePacks(low, []));
    console.log(
      `TIER low: rec=${tLow.recommended ? "YES" : "no"} mid=${tLow.mid.length} weak=${tLow.weak.length} low=${tLow.lowConfidence}`
    );
    const nasOnly = tierSourcePacks(
      buildSourcePacks([], [
        {
          type: "nas",
          title: "수행계획서_v2.pptx",
          url: null,
          thumbnail: null,
          description: "",
          drive: "T",
          raw_path: "02 Project\\인스파이어\\수행계획서_v2.pptx",
          is_file: true
        }
      ])
    );
    console.log(
      `TIER nas-only: rec=${nasOnly.recommended?.title ?? "-"} only=${nasOnly.recommended?.onlySide ?? "-"} score=${nasOnly.recommended?.score.toFixed(2) ?? "-"}`
    );
    const notionOnly = tierSourcePacks(
      buildSourcePacks(
        [
          {
            id: "wtcs",
            title: "WTCS 무역센터",
            url: "https://notion.so/wtcs",
            similarity: 0.81,
            nas_path: null,
            excerpt: "진행 중"
          }
        ],
        []
      )
    );
    console.log(
      `TIER notion-only: rec=${notionOnly.recommended?.title ?? "-"} only=${notionOnly.recommended?.onlySide ?? "-"}`
    );
    console.log("");
  }

  {
    const t0 = Date.now();
    const notion: NotionSource[] = [
      {
        id: "n1",
        title: "251209 롯데타워 서울스카이 리뉴얼 _ 1st Ideation",
        url: "https://notion.so/n1",
        nas_path:
          "P:\\01 사업개발\\251202 롯데타워 서울스카이 리뉴얼\\01 Document\\251208 1st Ideation",
        path_titles: [
          "2025(완료)",
          "251202 롯데타워 서울스카이 리뉴얼(EB 완료)",
          "251209 롯데타워 서울스카이 리뉴얼 _ 1st Ideation"
        ],
        parent_id: "parent-lotte",
        excerpt: "랜드마크 리뉴얼을 통한 새로운 경험."
      }
    ];
    const nas: LunaCard[] = [
      {
        type: "nas",
        title: "251209 롯데타워_1st Ideation_1팀_FIN.pdf",
        url: null,
        thumbnail: null,
        description: "",
        drive: "P",
        raw_path:
          "01 사업개발\\251202 롯데타워 서울스카이 리뉴얼\\01 Document\\251208 1st Ideation\\251209 롯데타워_1st Ideation_1팀_FIN.pdf",
        is_file: true
      },
      {
        type: "nas",
        title: "251208 1st Ideation",
        url: null,
        thumbnail: null,
        description: "",
        drive: "P",
        raw_path:
          "01 사업개발\\251202 롯데타워 서울스카이 리뉴얼\\01 Document\\251208 1st Ideation",
        is_file: false
      },
      {
        type: "nas",
        title: "01 Document",
        url: null,
        thumbnail: null,
        description: "",
        drive: "P",
        raw_path: "01 사업개발\\251202 롯데타워 서울스카이 리뉴얼\\01 Document",
        is_file: false
      }
    ];
    const views = buildSourcePacks(notion, nas);
    console.log(
      `UNIT 1차 아이데이션: ${Date.now() - t0}ms  자료 ${countSourcePackMaterials(views)}건`
    );
    for (const v of views) console.log("  " + summarize(v).replace(/\n/g, "\n  "));

    const wtcs = buildSourcePacks(
      [
        {
          id: "wtcs",
          title: "260513 WTCS 무역센터 미디어 구축 컨설팅",
          url: "https://notion.so/wtcs",
          nas_path: null,
          path_titles: ["[진행 중] 사업개발", "260513 WTCS 무역센터 미디어 구축 컨설팅"],
          parent_id: "biz",
          excerpt: "무역센터 외벽 미디어 구축 컨설팅. 아직 Work서버에 폴더가 없다."
        }
      ],
      []
    );
    console.log(
      `UNIT WTCS: 자료 ${countSourcePackMaterials(wtcs)}건  only=${wtcs[0] && wtcs[0].kind === "item" ? wtcs[0].onlySide : "?"}`
    );
    console.log("");
  }

  for (const q of QUESTIONS) {
    const t0 = Date.now();
    const outcome = await searchNotionForLuna(admin, q, q);
    const searchMs = Date.now() - t0;
    const synthetic = cardsFromNotionPaths(outcome.sources);
    const t1 = Date.now();
    const views = buildSourcePacks(outcome.sources, synthetic);
    const packMs = Date.now() - t1;
    const n = countSourcePackMaterials(views);
    console.log(`Q: ${q}`);
    console.log(
      `  search ${searchMs}ms  pack ${packMs}ms  자료 ${n}건  (노션 ${outcome.sources.length} · 합성 nas ${synthetic.length})`
    );
    for (const v of views) console.log("  " + summarize(v).replace(/\n/g, "\n  "));
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
