import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  dropOpenGoalsForWeek,
  ensureLunaGoal,
  isMetricKey,
  kstMondayDate,
  parseGoalDrafts,
  saveGoalsForWeek,
  snapshotMetrics,
  type GoalActionType,
  type GoalDraft,
  type GoalOwner
} from "@/lib/luna/weekly-goals";

export const runtime = "nodejs";

async function requireSuperAdmin(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return {
      error: NextResponse.json({ error: "Server configuration error" }, { status: 500 })
    };
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { admin };
}

export async function POST(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate;

  let body: {
    action?: string;
    goal?: string;
    reason?: string;
    owner?: string;
    metric_key?: string | null;
    metric_baseline?: number | null;
    metric_target?: number | null;
    action_type?: string;
    goals?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const monday = kstMondayDate();
  const action = body.action === "replace" ? "replace" : "confirm";

  if (action === "confirm") {
    return NextResponse.json({
      ok: true,
      message: "이번 주 목표를 확정했습니다."
    });
  }

  let drafts = parseGoalDrafts(body.goals);
  if (drafts.length === 0) {
    const goal = typeof body.goal === "string" ? body.goal.trim() : "";
    if (!goal) {
      return NextResponse.json({ error: "goal is required" }, { status: 400 });
    }
    const owner: GoalOwner = body.owner === "human" ? "human" : "luna";
    const metric_key = isMetricKey(body.metric_key) ? body.metric_key : null;
    const action_type: GoalActionType =
      body.action_type === "prompt" ||
      body.action_type === "selfstudy" ||
      body.action_type === "dev" ||
      body.action_type === "none"
        ? body.action_type
        : owner === "human"
          ? "dev"
          : "selfstudy";
    const draft: GoalDraft = {
      goal,
      reason: typeof body.reason === "string" ? body.reason.trim() : "",
      owner,
      metric_key,
      metric_baseline:
        typeof body.metric_baseline === "number" ? body.metric_baseline : null,
      metric_target:
        typeof body.metric_target === "number" ? body.metric_target : null,
      action_type
    };
    drafts = [draft];
  }

  const metrics = await snapshotMetrics(admin, monday);
  drafts = ensureLunaGoal(drafts, metrics);
  const dropped = await dropOpenGoalsForWeek(admin, monday);
  const saved = await saveGoalsForWeek(admin, monday, drafts, "human");

  return NextResponse.json({
    ok: true,
    message: "목표를 바꿨습니다.",
    dropped,
    goals: saved
  });
}
