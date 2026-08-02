import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";

export const runtime = "nodejs";

type SettingsRow = {
  id: number;
  merge_threshold: number;
  max_wait_days: number;
  last_merge_at: string | null;
  last_merge_count: number | null;
  last_merge_trigger: string | null;
};

const DEFAULTS = {
  merge_threshold: 15,
  max_wait_days: 7,
  last_merge_at: null as string | null,
  last_merge_count: null as number | null,
  last_merge_trigger: null as string | null
};

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

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function daysSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  const { data: settingsData, error: settingsError } = await admin
    .from("luna_learning_settings")
    .select(
      "id, merge_threshold, max_wait_days, last_merge_at, last_merge_count, last_merge_trigger"
    )
    .eq("id", 1)
    .maybeSingle();

  if (settingsError) {
    console.error("[luna/knowledge/settings] GET", settingsError);
    return NextResponse.json({ error: settingsError.message }, { status: 500 });
  }

  const settings = (settingsData as SettingsRow | null) ?? {
    id: 1,
    ...DEFAULTS
  };

  const { count: candidateCount, error: countError } = await admin
    .from("luna_learnings")
    .select("id", { count: "exact", head: true })
    .eq("status", "candidate")
    .neq("category", "identity");

  if (countError) {
    console.error("[luna/knowledge/settings] count", countError);
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }

  const { data: oldestRow, error: oldestError } = await admin
    .from("luna_learnings")
    .select("created_at")
    .eq("status", "candidate")
    .neq("category", "identity")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (oldestError) {
    console.error("[luna/knowledge/settings] oldest", oldestError);
    return NextResponse.json({ error: oldestError.message }, { status: 500 });
  }

  const count = candidateCount ?? 0;
  const oldestCreatedAt =
    oldestRow && typeof oldestRow.created_at === "string"
      ? oldestRow.created_at
      : null;
  const oldestDays = oldestCreatedAt ? daysSince(oldestCreatedAt) : 0;
  const threshold = clampInt(
    Number(settings.merge_threshold),
    3,
    100,
    DEFAULTS.merge_threshold
  );
  const maxWait = clampInt(
    Number(settings.max_wait_days),
    1,
    30,
    DEFAULTS.max_wait_days
  );
  const wouldRun =
    count >= threshold || (count > 0 && oldestDays >= maxWait);

  return NextResponse.json({
    merge_threshold: threshold,
    max_wait_days: maxWait,
    last_merge_at: settings.last_merge_at,
    last_merge_count: settings.last_merge_count,
    last_merge_trigger: settings.last_merge_trigger,
    candidate_count: count,
    oldest_days: oldestDays,
    next_midnight_action: wouldRun ? "실행됨" : "건너뜀"
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  let body: { merge_threshold?: unknown; max_wait_days?: unknown };
  try {
    body = (await request.json()) as {
      merge_threshold?: unknown;
      max_wait_days?: unknown;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const merge_threshold = clampInt(
    Number(body.merge_threshold),
    3,
    100,
    DEFAULTS.merge_threshold
  );
  const max_wait_days = clampInt(
    Number(body.max_wait_days),
    1,
    30,
    DEFAULTS.max_wait_days
  );

  const { data, error } = await admin
    .from("luna_learning_settings")
    .upsert(
      {
        id: 1,
        merge_threshold,
        max_wait_days
      },
      { onConflict: "id" }
    )
    .select(
      "merge_threshold, max_wait_days, last_merge_at, last_merge_count, last_merge_trigger"
    )
    .single();

  if (error) {
    console.error("[luna/knowledge/settings] PATCH", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
