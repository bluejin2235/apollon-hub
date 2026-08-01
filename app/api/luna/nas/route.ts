import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";

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
  return { user, admin };
}

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  const [settingsRes, markedRes, totalRes] = await Promise.all([
    admin.from("nas_scan_settings").select("*").eq("id", 1).maybeSingle(),
    admin
      .from("nas_directory")
      .select("id", { count: "exact", head: true })
      .gt("importance", 0),
    admin.from("nas_directory").select("id", { count: "exact", head: true })
  ]);

  if (settingsRes.error) {
    console.error("[luna/nas] GET settings", settingsRes.error);
    return NextResponse.json({ error: settingsRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    settings: settingsRes.data ?? null,
    marked_count: markedRes.count ?? 0,
    total_count: totalRes.count ?? 0
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireSuperAdmin(request);
  if ("error" in auth) return auth.error;
  const { admin } = auth;

  let body: {
    enabled?: boolean;
    scan_hour?: number;
    scan_minute?: number;
    drives?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString()
  };

  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;

  if (typeof body.scan_hour === "number") {
    const h = Math.round(body.scan_hour);
    if (h < 0 || h > 23) {
      return NextResponse.json({ error: "scan_hour must be 0-23" }, { status: 400 });
    }
    patch.scan_hour = h;
  }

  if (typeof body.scan_minute === "number") {
    const m = Math.round(body.scan_minute);
    if (![0, 10, 20, 30, 40, 50].includes(m)) {
      return NextResponse.json(
        { error: "scan_minute must be 0/10/20/30/40/50" },
        { status: 400 }
      );
    }
    patch.scan_minute = m;
  }

  if (typeof body.drives === "string") {
    patch.drives = body.drives.trim() || "T,P";
  }

  const { data, error } = await admin
    .from("nas_scan_settings")
    .update(patch)
    .eq("id", 1)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("[luna/nas] PATCH", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ settings: data });
}
