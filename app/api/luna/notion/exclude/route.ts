import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  getNotionIndexExclude,
  normalizeNotionIndexExclude,
  saveNotionIndexExclude,
  type NotionIndexExclude
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
  const exclude = await getNotionIndexExclude(gate.admin);
  return NextResponse.json({ exclude });
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

  const current = await getNotionIndexExclude(gate.admin);
  const incoming =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  const merged: NotionIndexExclude = normalizeNotionIndexExclude({
    ...current,
    ...incoming,
    exclude_paths: Array.isArray(incoming.exclude_paths)
      ? incoming.exclude_paths
      : current.exclude_paths
  });

  try {
    const saved = await saveNotionIndexExclude(gate.admin, merged);
    return NextResponse.json({ exclude: saved, saved: true });
  } catch (err) {
    console.error("[luna/notion/exclude] PUT", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 500 }
    );
  }
}
