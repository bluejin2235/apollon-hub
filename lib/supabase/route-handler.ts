import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";

function requireSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return null;
  }
  return { url, key };
}

/** Route Handler — request 쿠키에서 세션을 읽는다. */
export function createRouteHandlerSupabaseClient(request: NextRequest) {
  const env = requireSupabaseEnv();
  if (!env) {
    throw new Error("Supabase 환경 변수가 설정되지 않았습니다.");
  }

  return createServerClient(env.url, env.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll() {
        // Route Handler 는 middleware 가 갱신한 쿠키를 request 에 실어 보낸다.
      }
    }
  });
}
