import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import {
  getSelfstudyStatus,
  runDailySelfstudy
} from "@/lib/luna/selfstudy";

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
  return { user, admin };
}

/** GET — 마지막 자습 실행·오늘 제출 수 (슈퍼관리자) */
export async function GET(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate;

  const status = await getSelfstudyStatus(admin);
  return NextResponse.json(status);
}

/** POST — 수동 자습 실행 (슈퍼관리자). body: { force?: boolean } */
export async function POST(request: NextRequest) {
  const gate = await requireSuperAdmin(request);
  if ("error" in gate && gate.error) return gate.error;
  const { admin } = gate;

  let force = true;
  try {
    const body = (await request.json()) as { force?: boolean };
    if (typeof body.force === "boolean") force = body.force;
  } catch {
    /* empty body ok — default force */
  }

  try {
    const result = await runDailySelfstudy(admin, { force, notify: true });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[luna/selfstudy] POST", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Selfstudy failed" },
      { status: 500 }
    );
  }
}
