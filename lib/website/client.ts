import "server-only";

export async function websiteAdminFetch(
  path: string,
  init?: RequestInit
): Promise<{ status: number; body: unknown }> {
  const base = process.env.WEBSITE_API_URL?.trim();
  const secret = process.env.WEBSITE_ADMIN_SECRET?.trim();

  if (!base) {
    return { status: 500, body: { error: "WEBSITE_API_URL 이 설정되지 않았습니다." } };
  }
  if (!secret) {
    return { status: 500, body: { error: "WEBSITE_ADMIN_SECRET 이 설정되지 않았습니다." } };
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

  const controller = new AbortController();
  const timeoutMs = isFormData ? 120_000 : 20_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const incoming = init?.signal;
  const onIncomingAbort = () => controller.abort();
  if (incoming) {
    if (incoming.aborted) controller.abort();
    else incoming.addEventListener("abort", onIncomingAbort, { once: true });
  }

  try {
    const res = await fetch(url, { ...init, headers, signal: controller.signal });
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
  } catch (err) {
    if (controller.signal.aborted && !incoming?.aborted) {
      return {
        status: 504,
        body: {
          error: "website_timeout",
          details: {
            message: "홈페이지 서버가 응답하지 않습니다. 개발 서버가 떠 있는지 확인하세요."
          }
        }
      };
    }
    return {
      status: 502,
      body: {
        error: "website_unreachable",
        details: { message: err instanceof Error ? err.message : String(err) }
      }
    };
  } finally {
    clearTimeout(timer);
    incoming?.removeEventListener("abort", onIncomingAbort);
  }
}
