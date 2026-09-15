/**
 * 같은 것 · 루나의 질문 — 좌우 카드에 쓰는 이름·경로·근거.
 * 클라이언트에서도 import 하므로 server-only 없음.
 */

export type PairSideView = {
  typeLabel: string;
  title: string;
  path: string;
  facts: string;
};

export function typeLabel(
  type: string,
  extra?: { path?: string; db?: string }
): string {
  const path = extra?.path ?? "";
  if (type === "project" || type === "nas_path") {
    if (/01\s*사업개발/.test(path)) return "Work · 사업개발";
    if (/02\s*Project/i.test(path)) return "Work · 프로젝트";
    return type === "project" ? "Work · 프로젝트" : "Work";
  }
  if (type === "notion_page") {
    if (extra?.db) return `노션 · ${extra.db}`;
    if (extra?.path) {
      const db = notionDbLabel(extra.path.split(/\s*›\s*/));
      if (db && db !== "노션") return `노션 · ${db}`;
    }
    return "노션";
  }
  if (type === "image") return "이미지";
  if (type === "term") return "용어";
  if (type === "wiki") return "위키";
  return type;
}

export function notionDbLabel(pathTitles: string[] | null | undefined): string {
  const parts = (pathTitles ?? []).map((p) => p.trim()).filter(Boolean);
  const hit = parts.find((p) =>
    /프로젝트|사업개발|아이데이션|DB|Archive/i.test(p)
  );
  if (hit) return hit.replace(/\s+/g, " ");
  if (parts.length >= 2) return parts[parts.length - 2]!;
  return parts[0] || "노션";
}

export function notionBreadcrumb(
  pathTitles: string[] | null | undefined,
  title?: string
): string {
  const parts = (pathTitles ?? []).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return title?.trim() || "";
  return parts.join(" › ");
}

export function formatYm(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const m = String(iso).match(/^(\d{4})-(\d{2})/);
    if (!m) return "";
    return `${m[1]}.${m[2]}`;
  }
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}.${mo}`;
}

export function workFactsLine(opts: {
  fileCount?: number | null;
  lastModified?: string | null;
  folders?: string[] | null;
}): string {
  const parts: string[] = [];
  if (typeof opts.fileCount === "number" && opts.fileCount > 0) {
    parts.push(`파일 ${opts.fileCount}건`);
  }
  const ym = formatYm(opts.lastModified ?? undefined);
  if (ym) parts.push(`${ym} 마지막 수정`);
  const folders = (opts.folders ?? [])
    .map((f) => f.trim())
    .filter((f) => f && f !== "기타")
    .slice(0, 4);
  if (folders.length) parts.push(folders.join(", "));
  return parts.join(" · ");
}

export function notionFactsLine(opts: {
  status?: string | null;
  assignee?: string | null;
  registered?: string | null;
}): string {
  const parts: string[] = [];
  if (opts.status) parts.push(`상태 ${opts.status}`);
  if (opts.assignee) parts.push(`담당 ${opts.assignee}`);
  const ym = formatYm(opts.registered ?? undefined);
  if (ym) parts.push(`${ym} 등록`);
  return parts.join(" · ");
}

export function questionDedupeKey(opts: {
  from_id: string;
  to_id: string;
  to_type: string;
  to_title: string;
}): string {
  const title = opts.to_title.trim().toLowerCase().replace(/\s+/g, " ");
  if (opts.to_type === "notion_page" && title) {
    return `${opts.from_id}\tnotion\t${title}`;
  }
  return `${opts.from_id}\t${opts.to_id}`;
}

export function notionPathScore(path: string): number {
  const p = path.toLowerCase();
  let s = 0;
  if (/\[(완료|진행)/.test(path)) s += 3;
  if (/project archive/i.test(p)) s += 2;
  if (/링크드|linked\s*view|링크\s*뷰/.test(p)) s -= 8;
  s += Math.min(path.length, 120) / 120;
  return s;
}
