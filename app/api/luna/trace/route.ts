import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  listTraceWeekly,
  runWeeklyTraceAggregation
} from "@/lib/luna/trace-weekly";

export const runtime = "nodejs";

function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
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
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate;

  try {
    const weeks = await listTraceWeekly(admin, 8);
    return NextResponse.json({ weeks });
  } catch (err) {
    console.error("[luna/trace] GET", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json({ error: "Server configuration error" }, { status: 500 });
  }

  if (!isCronAuthorized(request)) {
    const user = await getApiUser(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isSuperAdminUser(admin, user))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const week = await runWeeklyTraceAggregation(admin);
    return NextResponse.json({ week });
  } catch (err) {
    console.error("[luna/trace] POST", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Aggregation failed" },
      { status: 500 }
    );
  }
}
