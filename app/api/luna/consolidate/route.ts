import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  getConsolidationStatus,
  loadConsolidationSettings,
  runConsolidation
} from "@/lib/luna/consolidate";

export const runtime = "nodejs";
export const maxDuration = 300;

function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

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
  return { user, admin };
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  try {
    const status = await getConsolidationStatus(admin);
    return NextResponse.json(status);
  } catch (err) {
    console.error("[luna/consolidate] GET", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load status" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  let body: {
    volume_threshold?: unknown;
    backstop_days?: unknown;
    notify_events?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const current = await loadConsolidationSettings(admin);
  const now = new Date().toISOString();
  const rows: Array<{ key: string; value: unknown; updated_at: string }> = [];

  if (body.volume_threshold !== undefined) {
    rows.push({
      key: "consolidation_volume_threshold",
      value: clampInt(Number(body.volume_threshold), 5, 500, current.volume_threshold),
      updated_at: now
    });
  }
  if (body.backstop_days !== undefined) {
    rows.push({
      key: "consolidation_backstop_days",
      value: clampInt(Number(body.backstop_days), 1, 90, current.backstop_days),
      updated_at: now
    });
  }
  if (body.notify_events !== undefined) {
    if (
      !body.notify_events ||
      typeof body.notify_events !== "object" ||
      Array.isArray(body.notify_events)
    ) {
      return NextResponse.json({ error: "notify_events must be an object" }, { status: 400 });
    }
    const incoming = body.notify_events as Record<string, unknown>;
    const merged = {
      consolidation:
        typeof incoming.consolidation === "boolean"
          ? incoming.consolidation
          : current.notify_events.consolidation,
      study:
        typeof incoming.study === "boolean"
          ? incoming.study
          : current.notify_events.study,
      reflect:
        typeof incoming.reflect === "boolean"
          ? incoming.reflect
          : current.notify_events.reflect,
      conflict:
        typeof incoming.conflict === "boolean"
          ? incoming.conflict
          : current.notify_events.conflict,
      prompt_change:
        typeof incoming.prompt_change === "boolean"
          ? incoming.prompt_change
          : current.notify_events.prompt_change,
      exam:
        typeof incoming.exam === "boolean"
          ? incoming.exam
          : current.notify_events.exam,
      morning:
        typeof incoming.morning === "boolean"
          ? incoming.morning
          : current.notify_events.morning
    };
    rows.push({
      key: "notify_events",
      value: merged,
      updated_at: now
    });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "No settings to update" }, { status: 400 });
  }

  const { error } = await admin.from("luna_settings").upsert(rows, {
    onConflict: "key"
  });
  if (error) {
    console.error("[luna/consolidate] PATCH", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const status = await getConsolidationStatus(admin);
  return NextResponse.json(status);
}

export async function POST(request: NextRequest) {
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  let force = false;
  if (isCronAuthorized(request)) {
    try {
      const text = await request.text();
      if (text.trim()) {
        const body = JSON.parse(text) as { force?: unknown };
        force = body.force === true;
      }
    } catch {
      force = false;
    }
  } else {
    const user = await getApiUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isSuperAdminUser(admin, user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    try {
      const body = (await request.json()) as { force?: unknown };
      force = body.force === true;
    } catch {
      force = false;
    }
  }

  try {
    const result = await runConsolidation(admin, { force });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[luna/consolidate] POST", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Consolidation failed" },
      { status: 500 }
    );
  }
}
