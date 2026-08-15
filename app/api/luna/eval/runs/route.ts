import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { LUNA_MODEL_LABEL } from "@/lib/luna/run-chat";

export const runtime = "nodejs";

const RUN_SELECT =
  "id, label, note, model_label, total, passed, failed, status, started_at, finished_at, created_by, tier, score_sum, score_max";

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

function formatRunLabel(date = new Date()): string {
  const yy = String(date.getFullYear()).slice(2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${yy}${mm}${dd} ${hh}:${mi}`;
}

export async function GET(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate;

  const { data, error } = await admin
    .from("luna_eval_runs")
    .select(RUN_SELECT)
    .order("started_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[luna/eval/runs] GET", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ runs: data ?? [] });
}

export async function POST(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { user, admin } = gate;

  let body: { note?: string } = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { count, error: countError } = await admin
    .from("luna_eval_cases")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  if (countError) {
    console.error("[luna/eval/runs] count", countError);
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }

  const total = count ?? 0;
  const now = new Date().toISOString();

  const { data, error } = await admin
    .from("luna_eval_runs")
    .insert({
      label: formatRunLabel(),
      note: typeof body.note === "string" ? body.note.trim() : null,
      model_label: LUNA_MODEL_LABEL,
      total,
      passed: 0,
      failed: 0,
      status: "running",
      started_at: now,
      finished_at: null,
      created_by: user.id
    })
    .select(RUN_SELECT)
    .single();

  if (error) {
    console.error("[luna/eval/runs] POST", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ run: data }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate;

  let body: {
    id?: string;
    status?: string;
    finished_at?: string | null;
    note?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.status === "running" || body.status === "done" || body.status === "stopped") {
    patch.status = body.status;
  }
  if ("finished_at" in body) {
    patch.finished_at =
      typeof body.finished_at === "string" ? body.finished_at : new Date().toISOString();
  } else if (body.status === "done" || body.status === "stopped") {
    patch.finished_at = new Date().toISOString();
  }
  if (typeof body.note === "string") patch.note = body.note.trim();

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no fields to update" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("luna_eval_runs")
    .update(patch)
    .eq("id", id)
    .select(RUN_SELECT)
    .maybeSingle();

  if (error) {
    console.error("[luna/eval/runs] PATCH", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ run: data });
}
