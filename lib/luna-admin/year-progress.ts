import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countLinks } from "@/lib/luna-admin/links";
import { countQuestions } from "@/lib/luna-admin/questions";
import type { LinkProgressPayload, YearProgressRow } from "@/lib/luna-admin/types";

export type { YearProgressRow, LinkProgressPayload };

function yearFromPath(path: string): string | null {
  const m = path.match(/(?:^|[\\/])(20\d{2})(?:[\\/]|$)/);
  if (m) return m[1]!;
  const code = path.match(/(?:^|[\\/_\s])(\d{2})\d{4}(?:[_\s]|$)/);
  if (code) {
    const yy = Number(code[1]);
    if (yy >= 10 && yy <= 40) return `20${code[1]}`;
  }
  return null;
}

function bucketYear(year: string): string {
  const n = Number(year);
  if (!Number.isFinite(n) || n <= 2022) return "2022 이전";
  return year;
}

export async function buildLinkProgress(
  admin: SupabaseClient
): Promise<LinkProgressPayload> {
  const [pathsRes, notionRes, imageRes, auto, ask, hold] = await Promise.all([
    admin.from("nas_important_paths").select("path").limit(2000),
    admin.from("luna_notion_pages").select("title").limit(3000),
    admin.from("luna_media_index").select("path").limit(3000),
    countLinks(admin, { status: "active" }),
    countQuestions(admin, "pending"),
    countLinks(admin, { status: "pending" })
  ]);

  const projectYears = new Map<string, number>();
  for (const row of pathsRes.data ?? []) {
    const y = yearFromPath(String(row.path ?? ""));
    const b = bucketYear(y ?? "2022");
    projectYears.set(b, (projectYears.get(b) ?? 0) + 1);
  }

  const notionYears = new Map<string, number>();
  for (const row of notionRes.data ?? []) {
    const title = String(row.title ?? "");
    const y = yearFromPath(title) ?? yearFromPath(`/${title}`);
    const code = title.match(/^(\d{2})\d{4}/);
    let year = y;
    if (!year && code) year = `20${code[1]}`;
    const b = bucketYear(year ?? "2022");
    notionYears.set(b, (notionYears.get(b) ?? 0) + 1);
  }

  const imageYears = new Map<string, number>();
  for (const row of imageRes.data ?? []) {
    const y = yearFromPath(String(row.path ?? ""));
    const b = bucketYear(y ?? "2022");
    imageYears.set(b, (imageYears.get(b) ?? 0) + 1);
  }

  const order = ["2026", "2025", "2024", "2023", "2022 이전"];
  const years: YearProgressRow[] = order.map((year, index) => {
    const projects = projectYears.get(year) ?? 0;
    const notion = year === "2022 이전" ? 0 : (notionYears.get(year) ?? 0);
    const images = imageYears.get(year) ?? 0;
    const hasWork = projects + notion + images > 0;
    let status: YearProgressRow["status"] = "wait";
    let progress_pct = 0;
    if (index === 0 && auto > 0 && ask === 0) {
      status = "done";
      progress_pct = 100;
    } else if (index === 0 || (index === 1 && auto > 0)) {
      status = auto > 0 ? "tonight" : "wait";
      progress_pct = hasWork && auto > 0 ? Math.min(99, Math.round((auto / Math.max(1, projects + 10)) * 100)) : 0;
    }
    return {
      year,
      projects,
      notion: year.startsWith("2022") ? 0 : notion,
      images,
      progress_pct,
      status,
      status_label: status === "done" ? "완료" : status === "tonight" ? "오늘 밤" : "대기"
    };
  });

  const overall =
    years.length > 0
      ? Math.round(years.reduce((s, y) => s + y.progress_pct, 0) / years.length)
      : 0;

  return {
    overall_pct: overall,
    auto,
    ask,
    hold,
    years
  };
}
