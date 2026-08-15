import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  activeCaseCountsByTier,
  findScheduleConflicts,
  formatNextRunLabel,
  formatTimeHm,
  getEvalSchedule,
  loadTierLastRuns,
  nextHeavyRunAt,
  nextLightRunAt,
  normalizeEvalSchedule,
  saveEvalSchedule,
  weekdayLabel,
  type EvalSchedule
} from "@/lib/luna/eval-schedule";

export const runtime = "nodejs";

async function requireSuperAdmin(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return {
      error: NextResponse.json(
        { error: "Server configuration error" },
        { status: 500 }
      )
    };
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user, admin };
}

function scheduleView(schedule: EvalSchedule) {
  const lightNext = nextLightRunAt(schedule);
  const heavyNext = nextHeavyRunAt(schedule);
  return {
    schedule,
    light: {
      ...schedule.light,
      time_label: formatTimeHm(schedule.light.hour, schedule.light.minute),
      cadence_label: "매일",
      next_label: lightNext
        ? formatNextRunLabel(lightNext)
        : "사용 안 함",
      search_label: "검색 없음"
    },
    heavy: {
      ...schedule.heavy,
      time_label: formatTimeHm(schedule.heavy.hour, schedule.heavy.minute),
      weekday_label: weekdayLabel(schedule.heavy.weekday),
      cadence_label: `매주 ${weekdayLabel(schedule.heavy.weekday)}요일`,
      next_label: heavyNext
        ? formatNextRunLabel(heavyNext)
        : "사용 안 함",
      search_label: "검색 포함"
    },
    conflicts: findScheduleConflicts(schedule),
    /** cron은 10분마다 돌고, 라우트가 luna_settings 시각을 확인 */
    cron_note:
      "vercel cron은 10분마다 호출되며, 설정된 시각(±10분)에만 실제 실행합니다."
  };
}

export async function GET(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate;

  const [schedule, lastRuns, { data: cases }] = await Promise.all([
    getEvalSchedule(admin),
    loadTierLastRuns(admin),
    admin
      .from("luna_eval_cases")
      .select("tier, is_active")
      .eq("is_active", true)
  ]);

  const counts = activeCaseCountsByTier(cases ?? []);

  return NextResponse.json({
    ...scheduleView(schedule),
    last_runs: lastRuns,
    case_counts: counts
  });
}

export async function PUT(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const current = await getEvalSchedule(admin);
  const incoming =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const merged = normalizeEvalSchedule({
    light: {
      ...current.light,
      ...(incoming.light && typeof incoming.light === "object"
        ? (incoming.light as object)
        : {})
    },
    heavy: {
      ...current.heavy,
      ...(incoming.heavy && typeof incoming.heavy === "object"
        ? (incoming.heavy as object)
        : {})
    }
  });

  const conflicts = findScheduleConflicts(merged);
  const force = incoming.force === true;
  if (conflicts.length > 0 && !force) {
    return NextResponse.json(
      {
        error: "schedule_conflict",
        message: conflicts.map((c) => c.message).join(" · "),
        conflicts,
        schedule: merged
      },
      { status: 409 }
    );
  }

  try {
    const saved = await saveEvalSchedule(admin, merged);
    const lastRuns = await loadTierLastRuns(admin);
    const { data: cases } = await admin
      .from("luna_eval_cases")
      .select("tier, is_active")
      .eq("is_active", true);
    return NextResponse.json({
      ...scheduleView(saved),
      last_runs: lastRuns,
      case_counts: activeCaseCountsByTier(cases ?? []),
      saved: true
    });
  } catch (err) {
    console.error("[luna/eval/schedule] PUT", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 500 }
    );
  }
}
