export type UploadBucket = "works" | "insights" | "site";

const TOKEN_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomToken(len = 6) {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += TOKEN_CHARS[Math.floor(Math.random() * TOKEN_CHARS.length)];
  }
  return out;
}

export function workFolderPrefix(slug: string | null | undefined, workId: string) {
  const trimmed = slug?.trim();
  return trimmed || workId.slice(0, 8);
}

export function extFromNameOrMime(original: string, mime?: string) {
  const lastDot = original.lastIndexOf(".");
  const rawExt = lastDot >= 0 ? original.slice(lastDot + 1) : "";
  const fromName = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (fromName) {
    if (fromName === "jpeg") return "jpg";
    return fromName;
  }
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/avif") return "avif";
  if (mime === "image/gif") return "gif";
  if (mime === "video/mp4") return "mp4";
  return "bin";
}

/** 원본 이름은 쓰지 않는다. 시스템 토큰만. */
export function newStoredFilename(ext: string, used: Iterable<string> = []) {
  const usedSet = new Set(
    [...used].map((name) => name.trim().toLowerCase()).filter(Boolean)
  );
  const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const file = () => `i${Date.now().toString(36)}${randomToken(8)}.${safeExt}`;
  let name = file();
  while (usedSet.has(name.toLowerCase())) name = file();
  return name;
}

export function sanitizeUploadFilename(original: string, used: Iterable<string> = [], mime?: string) {
  return newStoredFilename(extFromNameOrMime(original, mime), used);
}

export function uploadObjectPath(folder: string, filename: string) {
  return `${folder.replace(/\/$/, "")}/${filename}`;
}
