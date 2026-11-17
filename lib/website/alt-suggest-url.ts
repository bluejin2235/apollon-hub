/** 홈페이지 Supabase 공개 스토리지만 허용 */

export const WEBSITE_STORAGE_HOST =
  process.env.WEBSITE_STORAGE_HOST?.trim() || "qvkpycyhgzqyujzjozyp.supabase.co";

const PUBLIC_OBJECT =
  /^\/storage\/v1\/object\/public\/(works|insights|site)\//i;

/** https + 홈페이지 스토리지 호스트 + works|insights|site 공개 경로만 */
export function isAllowedWebsiteImageUrl(imageUrl: string): boolean {
  const raw = imageUrl.trim();
  if (!raw) return false;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.hostname.toLowerCase() !== WEBSITE_STORAGE_HOST.toLowerCase()) return false;
  if (!PUBLIC_OBJECT.test(url.pathname)) return false;
  return true;
}

export function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}
