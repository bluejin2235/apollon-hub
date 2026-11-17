/** 클라이언트·서버·시험이 공유하는 이미지 URL 허용 규칙 */

export function isAllowedWebsiteImageUrl(imageUrl: string): boolean {
  const raw = imageUrl.trim();
  if (!raw) return false;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  const path = url.pathname;

  const siteOrigin = process.env.NEXT_PUBLIC_WEBSITE_ORIGIN?.trim();
  if (siteOrigin) {
    try {
      const originHost = new URL(siteOrigin).hostname.toLowerCase();
      if (host === originHost) return true;
    } catch {
      /* ignore */
    }
  }

  if (
    host.endsWith(".supabase.co") &&
    /\/storage\/v1\/object\/public\/(works|insights|site)\//i.test(path)
  ) {
    return true;
  }

  if (
    /\/(works|insights|site)\//i.test(path) &&
    (host.includes("apollonworks") || host === "localhost")
  ) {
    return true;
  }

  return false;
}
