import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  getProfileRole,
  isWebsiteTesterPathAllowed,
  isWebsiteTesterRole
} from "@/lib/auth/website-tester";

// TODO(홈페이지 오픈 후 삭제) 개발 기간 한정 테스트 계정 권한

async function fetchWebsiteTesterRole(userId: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return null;

  const admin = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return getProfileRole(admin, userId);
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (user) {
    const role = await fetchWebsiteTesterRole(user.id);
    if (isWebsiteTesterRole(role)) {
      const { pathname } = request.nextUrl;
      if (!isWebsiteTesterPathAllowed(pathname)) {
        const redirectUrl = request.nextUrl.clone();
        redirectUrl.pathname = "/website";
        redirectUrl.search = "";
        return NextResponse.redirect(redirectUrl);
      }
    }
  }

  return supabaseResponse;
}
