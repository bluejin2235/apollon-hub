import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { hasLunaAccess } from "@/lib/luna/beta-access";
import type { User } from "@supabase/supabase-js";

export async function requireWikiUser(request: NextRequest): Promise<
  | {
      user: User;
      admin: NonNullable<ReturnType<typeof getServiceSupabase>>;
      isAdmin: boolean;
    }
  | { error: NextResponse }
> {
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
  if (!(await hasLunaAccess(admin, user.id))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const isAdmin = await isSuperAdminUser(admin, user);
  return { user, admin, isAdmin };
}

export function wikiMissingResponse() {
  return NextResponse.json(
    {
      error: "위키 컬럼이 없습니다. supabase/migrations/wiki_library_columns.sql 부터 실행하세요.",
      wiki_ready: false
    },
    { status: 503 }
  );
}
