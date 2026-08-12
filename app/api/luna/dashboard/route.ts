import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  buildLunaDashboard,
  type LunaDashboard
} from "@/lib/luna/dashboard";

export const runtime = "nodejs";
export const maxDuration = 60;

type CacheEntry = { at: number; data: LunaDashboard };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

export async function GET(request: NextRequest) {
  const user = await getApiUser(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
  }
  if (!(await isSuperAdminUser(admin, user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cached = cache.get(user.id);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json({
      ...cached.data,
      cached: true,
      cache_age_ms: Date.now() - cached.at
    });
  }

  try {
    const data = await buildLunaDashboard(admin, user.id);
    cache.set(user.id, { at: Date.now(), data });
    return NextResponse.json({ ...data, cached: false });
  } catch (err) {
    console.error("[luna/dashboard]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Dashboard failed" },
      { status: 500 }
    );
  }
}
