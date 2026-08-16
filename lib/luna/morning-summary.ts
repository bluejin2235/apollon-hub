import type { SupabaseClient } from "@supabase/supabase-js";
import { LUNA_LINKS, lunaNotify } from "@/lib/luna/notify";
import { estimateUsageKrw } from "@/lib/luna/model-pricing";
import { getSelfUpgradeStatus } from "@/lib/luna/self-upgrade";
import { getSelfstudyStatus } from "@/lib/luna/selfstudy";

const USD_KRW_FALLBACK = 1350;

export type MorningSummaryResult = {
  ok: boolean;
  skipped: boolean;
  notification_id?: string | null;
  message: string;
  parts?: string[];
  reason?: string;
};

/** 직전 24시간(아침 cron 기준 밤사이) 구간 + 밤 날짜 라벨 */
export function morningWindow(now = new Date()): {
  startIso: string;
  endIso: string;
  dateLabel: string;
} {
  const end = now;
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const kst = new Date(start.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    dateLabel: `${y}.${m}.${d}`
  };
}

export function isKstMonday(now = new Date()): boolean {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.getUTCDay() === 1;
}

function inWindow(
  iso: string | null | undefined,
  startIso: string,
  endIso: string
): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return t >= start && t < end;
}

function withLink(text: string, link: string): string {
  return `${text} (${link})`;
}

function runScoreLabel(row: {
  score_sum?: number | null;
  score_max?: number | null;
  passed?: number | null;
  total?: number | null;
}): string | null {
  if (
    typeof row.score_sum === "number" &&
    typeof row.score_max === "number" &&
    row.score_max > 0
  ) {
    return `${row.score_sum}/${row.score_max}`;
  }
  if (
    typeof row.passed === "number" &&
    typeof row.total === "number" &&
    row.total > 0
  ) {
    return `${row.passed}/${row.total}`;
  }
  return null;
}

/**
 * 아침 요약에 넣을 한 줄들 수집.
 * cron이 돌았으면 결과가 0이어도 줄을 남긴다 (돌지 않은 항목은 생략).
 */
export async function collectMorningSummaryParts(
  admin: SupabaseClient,
  now = new Date()
): Promise<{ parts: string[]; dateLabel: string; startIso: string; endIso: string }> {
  const { startIso, endIso, dateLabel } = morningWindow(now);
  const parts: string[] = [];

  // 1) light 회귀 시험
  const { data: lightRuns, error: lightErr } = await admin
    .from("luna_eval_runs")
    .select(
      "id, finished_at, score_sum, score_max, passed, total, status, tier"
    )
    .eq("tier", "light")
    .eq("status", "done")
    .gte("finished_at", startIso)
    .lt("finished_at", endIso)
    .order("finished_at", { ascending: false })
    .limit(1);

  if (lightErr) {
    console.error("[luna/morning] light eval", lightErr);
  } else if (lightRuns && lightRuns.length > 0) {
    const curr = lightRuns[0]!;
    const currLabel = runScoreLabel(curr) ?? "?/?";
    const { data: prevLight } = await admin
      .from("luna_eval_runs")
      .select("score_sum, score_max, passed, total")
      .eq("tier", "light")
      .eq("status", "done")
      .neq("id", curr.id as string)
      .order("finished_at", { ascending: false })
      .limit(1);
    const prevLabel = prevLight?.[0] ? runScoreLabel(prevLight[0]) : null;
    const line = prevLabel
      ? `회귀 시험 light ${currLabel} (어제 ${prevLabel})`
      : `회귀 시험 light ${currLabel}`;
    parts.push(withLink(line, LUNA_LINKS.brainEval));
  }

  // 2) 자습 — 돌았으면 0건이어도 한 줄
  const selfstudy = await getSelfstudyStatus(admin);
  const last = selfstudy.last_run;
  if (last && inWindow(last.finished_at, startIso, endIso)) {
    if (last.submitted > 0) {
      parts.push(
        withLink(`자습 ${last.submitted}문답 제출`, LUNA_LINKS.selfstudyHistory)
      );
    } else {
      parts.push(
        withLink(
          "자습 — 어제는 막힌 것이 없어 건너뛰었어요",
          LUNA_LINKS.selfstudyHistory
        )
      );
    }
  }

  // 3) 정리
  const { data: runs, error: runsErr } = await admin
    .from("luna_consolidation_runs")
    .select(
      "finished_at, merged_candidates, stale_candidates, conflict_candidates, status"
    )
    .eq("status", "done")
    .gte("finished_at", startIso)
    .lt("finished_at", endIso);

  if (runsErr) {
    console.error("[luna/morning] consolidation", runsErr);
  } else {
    let merged = 0;
    let stale = 0;
    let conflict = 0;
    for (const r of runs ?? []) {
      merged += Number(r.merged_candidates) || 0;
      stale += Number(r.stale_candidates) || 0;
      conflict += Number(r.conflict_candidates) || 0;
    }
    const total = merged + stale + conflict;
    if (total > 0) {
      const label =
        merged > 0
          ? `정리 ${merged}건 병합 제안`
          : `정리 ${total}건 검토 제안`;
      parts.push(withLink(label, LUNA_LINKS.candidatesPending));
    } else if ((runs ?? []).length > 0) {
      parts.push(
        withLink("정리 — 밤사이 병합·검토 제안 없음", LUNA_LINKS.candidatesPending)
      );
    }
  }

  // 4) 지식후보 대기 (누적)
  const { count: pendingCount, error: pendingErr } = await admin
    .from("luna_learnings")
    .select("id", { count: "exact", head: true })
    .eq("status", "candidate");

  if (pendingErr) {
    console.error("[luna/morning] pending", pendingErr);
  } else if ((pendingCount ?? 0) > 0) {
    parts.push(
      withLink(
        `지식후보 ${pendingCount}건 대기`,
        LUNA_LINKS.candidatesPending
      )
    );
  }

  // 5) 자기개선 — 개선함(버전) 또는 개선할 것 없음(last_run skip)
  const { data: upgrades, error: upErr } = await admin
    .from("luna_prompt_versions")
    .select("id, verify_note, verify_result, change_summary")
    .eq("changed_by_luna", true)
    .eq("target_type", "prompt")
    .gte("created_at", startIso)
    .lt("created_at", endIso);

  if (upErr) {
    console.error("[luna/morning] upgrades", upErr);
  } else if ((upgrades?.length ?? 0) > 0) {
    const n = upgrades!.length;
    let examBit = "";
    const note = upgrades!.find(
      (u) => typeof u.verify_note === "string" && u.verify_note.includes("→")
    )?.verify_note;
    if (typeof note === "string") {
      const m = note.match(/(\d+)\s*\/\s*(\d+)\s*→\s*(\d+)\s*\/\s*(\d+)/);
      if (m) {
        examBit = ` (시험 ${m[1]}→${m[3]})`;
      } else {
        const m2 = note.match(/(\d+)\s*→\s*(\d+)/);
        if (m2) examBit = ` (시험 ${m2[1]}→${m2[2]})`;
      }
    }
    parts.push(
      withLink(
        `프롬프트 자기개선 ${n}건${examBit}`,
        LUNA_LINKS.brainUpgrade
      )
    );
  } else {
    const upgradeStatus = await getSelfUpgradeStatus(admin);
    const upLast = upgradeStatus.last_run;
    if (
      upLast &&
      upLast.skipped === true &&
      inWindow(upLast.finished_at ?? null, startIso, endIso)
    ) {
      parts.push(
        withLink(
          "자기개선 — 이번 주는 고칠 근거가 없었어요 (정정 3회 반복 없음)",
          LUNA_LINKS.brainUpgrade
        )
      );
    }
  }

  // 6) C등급 GPT 시험 운영 지표
  const cTrial = await collectCTrialParts(admin, startIso, endIso);
  parts.push(...cTrial);

  return { parts, dateLabel, startIso, endIso };
}

function kstDateOffset(days: number, now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  kst.setUTCDate(kst.getUTCDate() + days);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function loadUsdKrw(admin: SupabaseClient): Promise<number> {
  const { data } = await admin
    .from("fx_daily_rates")
    .select("usd_krw")
    .not("usd_krw", "is", null)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.usd_krw != null && Number.isFinite(Number(data.usd_krw))) {
    return Number(data.usd_krw);
  }
  return USD_KRW_FALLBACK;
}

async function tierCostKrwForDate(
  admin: SupabaseClient,
  tier: string,
  date: string,
  usdKrw: number
): Promise<number> {
  const { data, error } = await admin
    .from("luna_usage_daily")
    .select("model_id, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens")
    .eq("tier", tier)
    .eq("date", date);
  if (error) {
    console.error("[luna/morning] C cost", error);
    return 0;
  }
  let total = 0;
  for (const row of data ?? []) {
    total += estimateUsageKrw(
      String(row.model_id ?? ""),
      {
        inputTokens: Number(row.input_tokens) || 0,
        outputTokens: Number(row.output_tokens) || 0,
        cacheWriteTokens: Number(row.cache_write_tokens) || 0,
        cacheReadTokens: Number(row.cache_read_tokens) || 0
      },
      usdKrw,
      null
    ).krw;
  }
  return total;
}

async function collectCTrialParts(
  admin: SupabaseClient,
  startIso: string,
  endIso: string
): Promise<string[]> {
  const { data: tierC } = await admin
    .from("luna_engine_tiers")
    .select("provider, model_id, model_label")
    .eq("tier", "C")
    .maybeSingle();

  const isGptTrial =
    String(tierC?.provider ?? "").toLowerCase() === "openai" ||
    String(tierC?.model_id ?? "").includes("gpt-5.6-luna");
  if (!isGptTrial) return [];

  const parts: string[] = [];
  const label = String(tierC?.model_label || tierC?.model_id || "GPT");

  const selfstudy = await getSelfstudyStatus(admin);
  const last = selfstudy.last_run;
  const qaCount =
    last && inWindow(last.finished_at, startIso, endIso)
      ? Number(last.submitted) || 0
      : 0;

  const { count: candidateCount, error: candErr } = await admin
    .from("luna_learnings")
    .select("id", { count: "exact", head: true })
    .eq("status", "candidate")
    .gte("created_at", startIso)
    .lt("created_at", endIso);
  if (candErr) console.error("[luna/morning] C candidates", candErr);
  const submitted = candidateCount ?? 0;

  const { data: lightRuns } = await admin
    .from("luna_eval_runs")
    .select("score_sum, score_max, passed, total, finished_at")
    .eq("tier", "light")
    .eq("status", "done")
    .gte("finished_at", startIso)
    .lt("finished_at", endIso)
    .order("finished_at", { ascending: false })
    .limit(1);
  const lightLabel = lightRuns?.[0] ? runScoreLabel(lightRuns[0]) : null;

  const { data: notifs, error: notifErr } = await admin
    .from("hub_notifications")
    .select("id, meta, created_at")
    .eq("category", "luna_prompt")
    .gte("created_at", startIso)
    .lt("created_at", endIso);
  if (notifErr) console.error("[luna/morning] C fallbacks", notifErr);
  let fallbacks = 0;
  for (const n of notifs ?? []) {
    const meta =
      n.meta && typeof n.meta === "object" && !Array.isArray(n.meta)
        ? (n.meta as Record<string, unknown>)
        : {};
    if (meta.c_tier_fallback === true) fallbacks += 1;
  }

  const usdKrw = await loadUsdKrw(admin);
  const yesterday = kstDateOffset(-1);
  const dayBefore = kstDateOffset(-2);
  const costY = await tierCostKrwForDate(admin, "C", yesterday, usdKrw);
  const costPrev = await tierCostKrwForDate(admin, "C", dayBefore, usdKrw);
  const costBit =
    costPrev > 0
      ? `₩${costY.toLocaleString("ko-KR")} (전날 ₩${costPrev.toLocaleString("ko-KR")})`
      : `₩${costY.toLocaleString("ko-KR")}`;

  parts.push(
    withLink(
      `C등급 ${label} 시험 — 자습 ${qaCount}문답 · 지식후보 ${submitted}건 · 폴백 ${fallbacks}회 · 비용 ${costBit}${
        lightLabel ? ` · light ${lightLabel}` : ""
      }`,
      LUNA_LINKS.brainModel
    )
  );

  return parts;
}

/**
 * 매일 아침 08:00 KST — 밤사이 작업을 한 건의 알림으로 보고.
 * cron이 돌았으면 결과가 없어도 보낸다. 월요일은 주간 보고에 합치므로 스킵.
 */
export async function runMorningSummary(
  admin: SupabaseClient,
  now = new Date()
): Promise<MorningSummaryResult> {
  if (isKstMonday(now)) {
    return {
      ok: true,
      skipped: true,
      reason: "monday_merged_into_self_report",
      message: "월요일 — 주간 보고에 아침 요약을 합칩니다"
    };
  }

  const { parts, dateLabel, startIso, endIso } =
    await collectMorningSummaryParts(admin, now);

  if (parts.length === 0) {
    return {
      ok: true,
      skipped: true,
      message: "밤사이 실행된 cron 보고 없음"
    };
  }

  const body = parts.join(" · ");
  const id = await lunaNotify(
    admin,
    "morning",
    `루나의 밤 — ${dateLabel}`,
    body,
    {
      level: "info",
      link: LUNA_LINKS.dashboard,
      meta: {
        start: startIso,
        end: endIso,
        parts
      }
    }
  );

  return {
    ok: true,
    skipped: false,
    notification_id: id,
    message: id
      ? "아침 요약 알림 전송"
      : "아침 요약 스킵(설정 off 또는 삽입 실패)",
    parts
  };
}
