import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  getSelfUpgradeStatus,
  listLunaUpgradeHistory,
  runSelfUpgrade
} from "@/lib/luna/self-upgrade";

export const runtime = "nodejs";
export const maxDuration = 300;

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

  const [status, history] = await Promise.all([
    getSelfUpgradeStatus(admin),
    listLunaUpgradeHistory(admin, 30)
  ]);
  return NextResponse.json({ ...status, history });
}

export async function POST(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate;

  try {
    const result = await runSelfUpgrade(admin, { notify: true });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[luna/self-upgrade] POST", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Self-upgrade failed" },
      { status: 500 }
    );
  }
}
