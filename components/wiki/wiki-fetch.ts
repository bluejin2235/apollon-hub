import { supabase } from "@/lib/supabase/client";

export async function wikiToken(): Promise<string | null> {
  const {
    data: { session }
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export async function wikiFetch<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const token = await wikiToken();
  if (!token) throw new Error("로그인이 필요합니다.");
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });
  const json = (await res.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!res.ok) {
    throw new Error(json?.error ?? "요청에 실패했습니다.");
  }
  return json as T;
}
