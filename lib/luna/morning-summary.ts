import type { SupabaseClient } from "@supabase/supabase-js";
import { LUNA_LINKS, lunaNotify } from "@/lib/luna/notify";
import { getSelfstudyStatus } from "@/lib/luna/selfstudy";

export type MorningSummaryResult = {
  ok: boolean;
  skipped: boolean;
  notification_id?: string | null;
  message: string;
  parts?: string[];
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

function inWindow(iso: string | null | undefined, startIso: string, endIso: string): boolean {
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

/**
 * 매일 아침 08:00 KST — 밤사이 작업을 한 건의 알림으로 보고.
 * 아무 일도 없었으면 알림 없음. 지식후보 대기 건수는 여기에만 포함.
 */
export async function runMorningSummary(
  admin: SupabaseClient,
  now = new Date()
): Promise<MorningSummaryResult> {
  const { startIso, endIso, dateLabel } = morningWindow(now);
  const parts: string[] = [];

  const selfstudy = await getSelfstudyStatus(admin);
  const last = selfstudy.last_run;
  if (
    last &&
    !last.skipped &&
    last.submitted > 0 &&
    inWindow(last.finished_at, startIso, endIso)
  ) {
    parts.push(
      withLink(
        `자습 ${last.submitted}문답 제출`,
        LUNA_LINKS.selfstudyHistory
      )
    );
  }

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
    }
  }

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
  }

  if (parts.length === 0) {
    return {
      ok: true,
      skipped: true,
      message: "밤사이 보고할 작업 없음"
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
    message: id ? "아침 요약 알림 전송" : "아침 요약 스킵(설정 off 또는 삽입 실패)",
    parts
  };
}
