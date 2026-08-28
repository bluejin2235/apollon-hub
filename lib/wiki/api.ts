import { NextRequest, NextResponse } from "next/server";
import { getApiUser, getServiceSupabase } from "@/lib/auth/get-api-user";
import { getProfileRole, isWebsiteTesterRole } from "@/lib/auth/website-tester";
import { isSuperAdminUser } from "@/lib/luna/auth";
import { hasLunaAccess } from "@/lib/luna/beta-access";
import type { User } from "@supabase/supabase-js";

// TODO(홈페이지 오픈 후 삭제) 개발 기간 한정 테스트 계정 권한

export async function requireWikiUser(request: NextRequest): Promise<
  | {
      user: User;
      admin: NonNullable<ReturnType<typeof getServiceSupabase>>;
      isAdmin: boolean;
      isWebsiteTester: boolean;
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

  const role = await getProfileRole(admin, user.id);
  const isWebsiteTester = isWebsiteTesterRole(role);

  if (!(await hasLunaAccess(admin, user.id, role)) && !isWebsiteTester) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const isAdmin = await isSuperAdminUser(admin, user);
  return { user, admin, isAdmin, isWebsiteTester };
}

export function wikiWriteForbiddenForWebsiteTester(gate: { isWebsiteTester: boolean }) {
  if (gate.isWebsiteTester) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
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
