import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  getSelfReportStatus,
  runWeeklySelfReport
} from "@/lib/luna/self-report";

export const runtime = "nodejs";
export const maxDuration = 120;

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
  return { admin };
}

export async function GET(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate;
  const status = await getSelfReportStatus(admin);
  return NextResponse.json(status);
}

export async function POST(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate;

  try {
    const result = await runWeeklySelfReport(admin);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[luna/self-report] POST", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Self-report failed" },
      { status: 500 }
    );
  }
}
