import { supabase } from "@/lib/supabase/client";

export class WikiApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "WikiApiError";
    this.status = status;
  }
}

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
  if (!token) throw new WikiApiError("로그인이 필요합니다.", 401);
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
    throw new WikiApiError(json?.error ?? "요청에 실패했습니다.", res.status);
  }
  return json as T;
}

export async function wikiUploadFile(
  file: File,
  slug: string
): Promise<{ url: string; path: string }> {
  const token = await wikiToken();
  if (!token) throw new WikiApiError("로그인이 필요합니다.", 401);
  const fd = new FormData();
  fd.append("file", file);
  fd.append("slug", slug);
  const res = await fetch("/api/wiki/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd
  });
  const json = (await res.json().catch(() => null)) as {
    url?: string;
    path?: string;
    error?: string;
  } | null;
  if (!res.ok || !json?.url) {
    throw new WikiApiError(json?.error ?? "업로드에 실패했습니다.", res.status);
  }
  return { url: json.url, path: json.path ?? "" };
}
