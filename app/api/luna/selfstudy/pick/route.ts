import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { pickSelfstudyTopics } from "@/lib/luna/selfstudy";

export const runtime = "nodejs";
export const maxDuration = 120;

function isCronAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  const admin = getServiceSupabase();
  if (!admin) {
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500 }
    );
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
    const result = await pickSelfstudyTopics(admin);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[luna/selfstudy/pick]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Pick failed" },
      { status: 500 }
    );
  }
}
