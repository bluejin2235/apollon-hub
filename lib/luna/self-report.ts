import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getTierModel, resolveAnthropicModel } from "@/lib/luna/engine";
import {
  collectMorningSummaryParts,
  isKstMonday
} from "@/lib/luna/morning-summary";
import { LUNA_LINKS } from "@/lib/luna/notify";
import { getPrompt, LUNA_PROMPT_KEYS } from "@/lib/luna/prompts";
import { kstDayBounds } from "@/lib/luna/selfstudy";

const SETTINGS_LAST = "self_report_last";

const REPORT_FALLBACK = `매주 한 번 블루진에게 보고한다:
- 이번 주 확정된 지식 N건 (대표 3개)
- 가장 많이 정정받은 유형 (= 내 약점)
- 프롬프트 변경 내역과 결과 (예측 대비 실제)
- 후보함 유입 추이 (줄고 있으면 성장 신호, 늘면 원인 짚기)
- 다음 주에 스스로 개선하려는 것 한 가지

형식은 짧게. 숫자와 사례 중심. 잘한 척보다 약점을 정직하게.
본문만 출력 (제목 없이 문단).`;

export type SelfReportLast = {
  finished_at: string;
  title: string;
  body: string;
  notification_id: string | null;
  stats: Record<string, unknown>;
};

function getAnthropicClient(): Anthropic | null {
  const apiKey = process.env.hubtrendchat_claude;
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

/** 이번 주(월~일 KST) UTC 구간 */
export function kstWeekBounds(now = new Date()): {
  startIso: string;
  endIso: string;
  prevStartIso: string;
  prevEndIso: string;
} {
  const kstMs = now.getTime() + 9 * 60 * 60 * 1000;
  const kst = new Date(kstMs);
  const day = kst.getUTCDay(); // 0 Sun .. 6 Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate() + mondayOffset;
  const weekStartUtc = Date.UTC(y, m, d) - 9 * 60 * 60 * 1000;
  const weekEndUtc = weekStartUtc + 7 * 24 * 60 * 60 * 1000;
  return {
    startIso: new Date(weekStartUtc).toISOString(),
    endIso: new Date(weekEndUtc).toISOString(),
    prevStartIso: new Date(weekStartUtc - 7 * 24 * 60 * 60 * 1000).toISOString(),
    prevEndIso: new Date(weekStartUtc).toISOString()
  };
}

async function countCandidatesInRange(
  admin: SupabaseClient,
  startIso: string,
  endIso: string
): Promise<number> {
  const { count, error } = await admin
    .from("luna_learnings")
    .select("id", { count: "exact", head: true })
    .gte("created_at", startIso)
    .lt("created_at", endIso)
    .neq("category", "identity");
  if (error) {
    console.error("[luna/self-report] candidate count", error);
    return 0;
  }
  return count ?? 0;
}

export async function getSelfReportStatus(
  admin: SupabaseClient
): Promise<{ last_report: SelfReportLast | null }> {
  const { data, error } = await admin
    .from("luna_settings")
    .select("value")
    .eq("key", SETTINGS_LAST)
    .maybeSingle();
  if (error) {
    console.error("[luna/self-report] status", error);
    return { last_report: null };
  }
  if (!data?.value || typeof data.value !== "object" || Array.isArray(data.value)) {
    return { last_report: null };
  }
  return { last_report: data.value as SelfReportLast };
}

/**
 * 주간 성장 보고 → hub_notifications (category=luna_report, scope=admin).
 */
export async function runWeeklySelfReport(
  admin: SupabaseClient
): Promise<{
  ok: true;
  skipped: boolean;
  message: string;
  notification_id?: string | null;
  body?: string;
}> {
  const week = kstWeekBounds();
  const today = kstDayBounds();

  const [
    { data: confirmedRows },
    { data: correctionRows },
    { data: lunaVersions },
    thisWeekInflow,
    prevWeekInflow
  ] = await Promise.all([
    admin
      .from("luna_learnings")
      .select("content, category, resolved_at")
      .eq("status", "active")
      .gte("resolved_at", week.startIso)
      .lt("resolved_at", week.endIso)
      .neq("category", "identity")
      .order("resolved_at", { ascending: false })
      .limit(50),
    admin
      .from("luna_learnings")
      .select("content, category, meta, thread, updated_at")
      .gte("updated_at", week.startIso)
      .lt("updated_at", week.endIso)
      .neq("category", "identity")
      .limit(300),
    admin
      .from("luna_prompt_versions")
      .select(
        "version, change_summary, prediction, verify_result, verify_note, created_at, target_id, changed_by_luna"
      )
      .eq("target_type", "prompt")
      .eq("changed_by_luna", true)
      .gte("created_at", week.startIso)
      .lt("created_at", week.endIso)
      .order("created_at", { ascending: false })
      .limit(20),
    countCandidatesInRange(admin, week.startIso, week.endIso),
    countCandidatesInRange(admin, week.prevStartIso, week.prevEndIso)
  ]);

  const confirmed = (confirmedRows ?? []).map((r) => ({
    content: typeof r.content === "string" ? r.content : "",
    category: typeof r.category === "string" ? r.category : "general"
  }));
  const confirmedCount = confirmed.length;
  const top3 = confirmed.slice(0, 3);

  const catCount = new Map<string, number>();
  for (const row of correctionRows ?? []) {
    const meta =
      row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
        ? (row.meta as Record<string, unknown>)
        : {};
    const thread = Array.isArray(row.thread) ? row.thread : [];
    const hasHuman = thread.some(
      (t) =>
        t &&
        typeof t === "object" &&
        (t as { role?: string }).role === "human"
    );
    if (meta.from_correction === true || hasHuman) {
      const cat =
        typeof row.category === "string" && row.category.trim()
          ? row.category.trim()
          : "general";
      catCount.set(cat, (catCount.get(cat) ?? 0) + 1);
    }
  }
  let topCorrection = "없음";
  let topCorrectionCount = 0;
  for (const [cat, n] of catCount) {
    if (n > topCorrectionCount) {
      topCorrection = cat;
      topCorrectionCount = n;
    }
  }

  const promptChanges = (lunaVersions ?? []).map((v) => ({
    summary: v.change_summary,
    prediction: v.prediction,
    result: v.verify_result,
    note: v.verify_note
  }));

  const stats = {
    confirmed_count: confirmedCount,
    top3,
    top_correction_type: topCorrection,
    top_correction_count: topCorrectionCount,
    prompt_changes: promptChanges,
    candidate_inflow_this_week: thisWeekInflow,
    candidate_inflow_prev_week: prevWeekInflow,
    week_start: week.startIso,
    week_end: week.endIso,
    generated_at: today.startIso
  };

  const client = getAnthropicClient();
  const system =
    (await getPrompt(admin, LUNA_PROMPT_KEYS.report)).trim() || REPORT_FALLBACK;

  let bodyText = "";
  if (client) {
    const tierA = resolveAnthropicModel(await getTierModel(admin, "A"));
    try {
      const res = await client.messages.create({
        model: tierA.model_id,
        max_tokens: 1200,
        system,
        messages: [
          {
            role: "user",
            content: `아래 주간 집계로 성장 보고 본문을 작성하세요.\n\n${JSON.stringify(stats, null, 2)}`
          }
        ]
      });
      bodyText =
        res.content.find((p) => p.type === "text")?.text?.trim() ?? "";
    } catch (err) {
      console.error("[luna/self-report] claude", err);
    }
  }

  if (!bodyText) {
    bodyText = [
      `이번 주 확정 지식 ${confirmedCount}건.`,
      top3.length
        ? `대표: ${top3.map((t) => t.content).join(" / ")}`
        : "대표 사례 없음.",
      `정정 최다 유형: ${topCorrection} (${topCorrectionCount}건).`,
      `후보함 유입 ${prevWeekInflow}→${thisWeekInflow}.`,
      promptChanges.length
        ? `프롬프트 자율 변경 ${promptChanges.length}건.`
        : "프롬프트 자율 변경 없음.",
      "다음 주 목표: 반복 정정 유형을 한 가지 줄이기."
    ].join("\n");
  }

  // 월요일 08:00 — 아침 요약과 시각이 겹치므로 밤사이 요약을 본문에 합친다
  let morningParts: string[] = [];
  if (isKstMonday()) {
    try {
      const morning = await collectMorningSummaryParts(admin);
      morningParts = morning.parts;
      if (morningParts.length > 0) {
        bodyText = [
          "[밤사이]",
          morningParts.join("\n"),
          "",
          "[주간 보고]",
          bodyText
        ].join("\n");
      }
    } catch (err) {
      console.error("[luna/self-report] morning merge", err);
    }
  }

  const title = "루나 주간 성장 보고";
  const { data: notif, error: notifErr } = await admin
    .from("hub_notifications")
    .insert({
      category: "luna_report",
      title,
      body: bodyText.slice(0, 4000),
      link: LUNA_LINKS.brainReport,
      level: "info",
      scope: "admin",
      meta: {
        event: "self_report",
        morning_parts: morningParts,
        ...stats
      }
    })
    .select("id")
    .maybeSingle();

  if (notifErr) {
    console.error("[luna/self-report] notify", notifErr);
    return {
      ok: true,
      skipped: true,
      message: `알림 저장 실패: ${notifErr.message}`
    };
  }

  const last: SelfReportLast = {
    finished_at: new Date().toISOString(),
    title,
    body: bodyText,
    notification_id: (notif?.id as string) ?? null,
    stats
  };

  const { error: saveErr } = await admin.from("luna_settings").upsert(
    {
      key: SETTINGS_LAST,
      value: last,
      updated_at: new Date().toISOString()
    },
    { onConflict: "key" }
  );
  if (saveErr) console.error("[luna/self-report] save", saveErr);

  return {
    ok: true,
    skipped: false,
    message: "주간 보고 제출",
    notification_id: last.notification_id,
    body: bodyText
  };
}
