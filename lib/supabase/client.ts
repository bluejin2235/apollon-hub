import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error("Supabase 환경 변수가 설정되지 않았습니다.");
}

const SUPABASE_URL: string = supabaseUrl;
const SUPABASE_PUBLISHABLE_KEY: string = supabasePublishableKey;

/** 브라우저 Supabase 클라이언트 — @supabase/ssr 이 세션을 쿠키에 저장한다. */
export const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
