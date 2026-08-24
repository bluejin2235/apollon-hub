import "server-only";

export async function websiteAdminFetch(
  path: string,
  init?: RequestInit
): Promise<{ status: number; body: unknown }> {
  const base = process.env.WEBSITE_API_URL?.trim();
  const secret = process.env.WEBSITE_ADMIN_SECRET?.trim();

  if (!base) {
    throw new Error("WEBSITE_API_URL 이 설정되지 않았습니다.");
  }
  if (!secret) {
    throw new Error("WEBSITE_ADMIN_SECRET 이 설정되지 않았습니다.");
  }

  const url = `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${secret}`);

  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (!isFormData && init?.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (isFormData) {
    headers.delete("Content-Type");
  }

  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }

  return { status: res.status, body };
}
