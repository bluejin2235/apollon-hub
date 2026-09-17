/**
 * 아침 리포트 「내가 해야 할 것」 프롬프트 실측 — 메일 발송 없음.
 * 오늘 어긋난 항목이 없는 종류도 보려고 멈춘 상태를 흉내 낸 검사 행을 같이 만든다.
 *   npx tsx --require ./scripts/stub-server-only.cjs scripts/verify-report-prompts.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env.local") });

import { createClient } from "@supabase/supabase-js";
import type { LunaCheckResult } from "../lib/luna/checks";
import type { StudyRunReportCard } from "../lib/luna/study-report";
import {
  buildCheckPrompt,
  buildStudyBlockedPrompt,
  loadOpenDevnoteBlockers,
  PROMPT_ROOM_LABEL
} from "../lib/luna-admin/report-prompts";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("supabase env required");
  return createClient(url, key, { auth: { persistSession: false } });
}

function stalled(
  check: LunaCheckResult,
  days: number,
  lastLabel: string
): LunaCheckResult {
  const tail = (check.detail ?? "").split(/마지막 \d{2}\.\d{2} \d{2}:\d{2}/)[1] ?? "";
  return {
    ...check,
    status: "bad",
    light: "red",
    days_stale: days,
    last_label: lastLabel,
    detail: `${check.promise_label} · ${days}일째 멈춤 · 마지막 ${lastLabel}${tail}`
  };
}

const BLOCKED_CARD: StudyRunReportCard = {
  agenda: "오래된 1차 색인 범위를 갱신",
  why: "노션 색인 14일 이상 된 페이지 1477건 / 전체 2819",
  did: "오래된 색인 1건을 대기열에 넣었습니다",
  result: "200건 갱신 · 관계 변화 없음 · 남음 1476 · 대기열 pending 1477",
  learned: null,
  next: null,
  blocked:
    "자습은 목록만 만들고 색인 러너가 대기열을 안 봅니다. 이 연결은 사람이 만들어 주셔야 합니다.",
  outcome: "no_change",
  outcomeLabel: "변화 없음",
  cost_usd: 0,
  llm_calls: 0,
  started_at: new Date().toISOString(),
  finished_at: null
};

/** 검사 재실행 없이 마지막 스냅샷을 그대로 읽는다 (LLM 모듈 체인을 끌어오지 않는다) */
async function loadCheckSnapshot(
  admin: ReturnType<typeof adminClient>
): Promise<LunaCheckResult[]> {
  const { data, error } = await admin
    .from("luna_checks")
    .select("*")
    .eq("enabled", true)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const check = row as LunaCheckResult;
    const detail = check.detail ?? "";
    const match = detail.match(/마지막 (\d{2}\.\d{2} \d{2}:\d{2})/);
    return {
      ...check,
      light:
        check.status === "bad"
          ? "red"
          : check.status === "warn"
            ? "yellow"
            : "green",
      last_label: match?.[1] ?? "기록 없음"
    };
  });
}

async function main() {
  const admin = adminClient();
  const [checks, blockers] = await Promise.all([
    loadCheckSnapshot(admin),
    loadOpenDevnoteBlockers(admin)
  ]);
  const byId = new Map(checks.map((c) => [c.id, c]));

  const samples: { label: string; text: string; room: string }[] = [];

  const push = (label: string, prompt: { room: string; text: string }) => {
    samples.push({
      label,
      text: prompt.text,
      room: PROMPT_ROOM_LABEL[prompt.room as keyof typeof PROMPT_ROOM_LABEL]
    });
  };

  const fx = byId.get("fx_rates");
  if (fx) push("검사 · 환율(2일 멈춤 흉내)", buildCheckPrompt(stalled(fx, 2, "09.15 00:00"), blockers));

  const media = byId.get("image_index");
  if (media)
    push(
      "검사 · 이미지 색인(4일 멈춤 흉내)",
      buildCheckPrompt(stalled(media, 4, "09.13 03:23"), blockers)
    );

  for (const c of checks) {
    if (c.status === "bad" || c.status === "warn") {
      push(`검사 · ${c.label}(실제)`, buildCheckPrompt(c, blockers));
    }
  }

  push("자습 막힌 것(흉내)", buildStudyBlockedPrompt(BLOCKED_CARD, blockers));

  console.log(`개발노트 막힌 것 ${blockers.length}건 참조 가능\n`);
  for (const s of samples) {
    const lines = s.text.split("\n");
    console.log(`── ${s.label} · ${s.room} 방 · ${lines.length}줄`);
    console.log(s.text);
    console.log("");
    if (lines.length > 8) console.log(`!! 8줄 초과 (${lines.length})\n`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
