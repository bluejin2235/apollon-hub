import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  getNotionIndexSchedule,
  normalizeNotionIndexSchedule,
  saveNotionIndexSchedule,
  type NotionIndexSchedule
} from "@/lib/luna/notion-index-settings";

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

export async function GET(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const schedule = await getNotionIndexSchedule(gate.admin);
  return NextResponse.json({ schedule });
}

export async function PUT(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const current = await getNotionIndexSchedule(gate.admin);
  const incoming =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const merged: NotionIndexSchedule = normalizeNotionIndexSchedule({
    full: {
      ...current.full,
      ...(incoming.full && typeof incoming.full === "object"
        ? (incoming.full as object)
        : {})
    },
    incremental: {
      ...current.incremental,
      ...(incoming.incremental && typeof incoming.incremental === "object"
        ? (incoming.incremental as object)
        : {})
    }
  });

  try {
    const saved = await saveNotionIndexSchedule(gate.admin, merged);
    return NextResponse.json({ schedule: saved, saved: true });
  } catch (err) {
    console.error("[luna/notion/schedule] PUT", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 500 }
    );
  }
}
