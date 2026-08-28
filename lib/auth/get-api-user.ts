import { createClient, type User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { createRouteHandlerSupabaseClient } from "@/lib/supabase/route-handler";

/** 쿠키(또는 Authorization Bearer)로 Supabase Auth 사용자 검증 */
export async function getApiUser(request: NextRequest): Promise<User | null> {
  try {
    const supabase = createRouteHandlerSupabaseClient(request);
    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user) {
      return data.user;
    }
  } catch (e) {
    console.warn("[getApiUser] cookie session lookup failed", e);
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!token) return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !anonKey) return null;

  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

export function getServiceSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) return null;
  return createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
