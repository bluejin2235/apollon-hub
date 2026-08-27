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

export function sanitizeUploadFilename(original: string, used: Iterable<string> = []) {
  const usedSet = new Set(
    [...used].map((name) => name.trim().toLowerCase()).filter(Boolean)
  );
  const lastDot = original.lastIndexOf(".");
  const rawExt = lastDot >= 0 ? original.slice(lastDot + 1) : "";
  const rawStem = lastDot >= 0 ? original.slice(0, lastDot) : original;
  const ext = rawExt.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const hasHangul = /[\uAC00-\uD7A3]/.test(original);
  let stem = rawStem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (hasHangul) {
    stem = stem ? `${randomToken()}-${stem}` : randomToken();
  }
  if (!stem) stem = randomToken();

  const file = (n?: number) => (n ? `${stem}-${n}.${ext}` : `${stem}.${ext}`);
  if (!usedSet.has(file())) return file();
  let n = 2;
  while (usedSet.has(file(n))) n += 1;
  return file(n);
}

export function uploadObjectPath(folder: string, filename: string) {
  return `${folder.replace(/\/$/, "")}/${filename}`;
}
