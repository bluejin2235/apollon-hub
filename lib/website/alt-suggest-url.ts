/** 홈페이지 Supabase 공개 스토리지만 허용 */

export const WEBSITE_STORAGE_HOST =
  process.env.WEBSITE_STORAGE_HOST?.trim() || "qvkpycyhgzqyujzjozyp.supabase.co";

const PUBLIC_OBJECT =
  /^\/storage\/v1\/object\/public\/(works|insights|site)\//i;

/** pathname 조각에 `..` 이 있으면 거절 */
export function pathnameHasDotDot(pathname: string): boolean {
  return pathname.split("/").some((seg) => seg === "..");
}

/** `.` / `..` / 빈 조각을 정리한 절대 경로 */
export function normalizePathname(pathname: string): string {
  const parts = pathname.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return "/" + out.join("/");
}

/** 디코드 실패 · `..` 조각 · 정규화 후 달라지면 거절, 아니면 디코드 경로 */
export function sanitizeWebsiteImagePathname(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (pathnameHasDotDot(decoded)) return null;
  const normalized = normalizePathname(decoded);
  if (normalized !== decoded) return null;
  return decoded;
}

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

  const path = sanitizeWebsiteImagePathname(url.pathname);
  if (!path) return false;
  if (!PUBLIC_OBJECT.test(path)) return false;
  return true;
}

export function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}
