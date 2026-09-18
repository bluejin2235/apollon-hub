import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { countLinks } from "@/lib/luna-admin/links";
import { countQuestions } from "@/lib/luna-admin/questions";
import { yearFromPath } from "@/lib/luna-admin/link-parse";
import type { LinkProgressPayload, YearProgressRow } from "@/lib/luna-admin/types";

export type { YearProgressRow, LinkProgressPayload };

function bucketYear(year: string): string {
  const n = Number(year);
  if (!Number.isFinite(n) || n <= 2022) return "2022 이전";
  return year;
}

const YEAR_ORDER = ["2026", "2025", "2024", "2023", "2022 이전"] as const;
const ROOTS = ["01 사업개발", "02 Project"] as const;

async function countLinksYear(
  admin: SupabaseClient,
  year: string,
  extra?: { kind?: string; role?: string }
): Promise<number> {
  const years =
    year === "2022 이전" ? ["2022", "2021", "2020", "2019"] : [year];
  let total = 0;
  for (const y of years) {
    let q = admin
      .from("luna_links")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .filter("evidence->>year", "eq", y);
    if (extra?.kind) q = q.eq("kind", extra.kind);
    if (extra?.role) q = q.filter("evidence->>role", "eq", extra.role);
    const { count, error } = await q;
    if (error) {
      console.error("[luna-admin/year-progress] links", error);
      continue;
    }
    total += count ?? 0;
  }
  return total;
}

async function countProjectFolders(
  admin: SupabaseClient
): Promise<Map<string, number>> {
  const projectYears = new Map<string, number>();
  const calendarYears = [2026, 2025, 2024, 2023, 2022, 2021, 2020];
  for (const yearNum of calendarYears) {
    let n = 0;
    for (const root of ROOTS) {
      const like = `${root}\\${yearNum}\\%`;
      const nested = `${root}\\${yearNum}\\%\\%`;
      const { count, error } = await admin
        .from("nas_directory")
        .select("path", { count: "exact", head: true })
        .eq("type", "folder")
        .like("path", like)
        .not("path", "like", nested);
      if (error) {
        console.error("[luna-admin/year-progress] nas", error);
        continue;
      }
      n += count ?? 0;
    }
    const b = bucketYear(String(yearNum));
    projectYears.set(b, (projectYears.get(b) ?? 0) + n);
  }
  return projectYears;
}

async function fetchPaged<T>(
  admin: SupabaseClient,
  table: string,
  columns: string
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .range(from, from + 999);
    if (error) {
      console.error(`[luna-admin/year-progress] ${table}`, error);
      break;
    }
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
    from += 1000;
  }
  return out;
}

export async function buildLinkProgress(
  admin: SupabaseClient
): Promise<LinkProgressPayload> {
  const [projectYears, notionRows, imageRows, auto, ask, hold] = await Promise.all([
    countProjectFolders(admin),
    fetchPaged<{
      title: string | null;
      nas_path: string | null;
      path_titles: string[] | null;
    }>(admin, "luna_notion_pages", "title, nas_path, path_titles"),
    fetchPaged<{ path: string | null; project: string | null }>(
      admin,
      "luna_media_index",
      "path, project"
    ),
    countLinks(admin, { status: "active" }),
    countQuestions(admin, "pending"),
    countLinks(admin, { status: "pending" })
  ]);

  const notionYears = new Map<string, number>();
  for (const row of notionRows) {
    const title = String(row.title ?? "");
    const nas = String(row.nas_path ?? "");
    const pathTitles = Array.isArray(row.path_titles)
      ? row.path_titles.map(String).join(" / ")
      : "";
    const y = yearFromPath(nas) || yearFromPath(title) || yearFromPath(pathTitles);
    const b = bucketYear(y ?? "2022");
    notionYears.set(b, (notionYears.get(b) ?? 0) + 1);
  }

  const imageYears = new Map<string, number>();
  for (const row of imageRows) {
    const y =
      yearFromPath(String(row.path ?? "")) ||
      yearFromPath(String(row.project ?? ""));
    const b = bucketYear(y ?? "2022");
    imageYears.set(b, (imageYears.get(b) ?? 0) + 1);
  }

  const bundleCounts = await Promise.all(
    YEAR_ORDER.map((year) =>
      countLinksYear(admin, year, { kind: "belongs", role: "bundle" })
    )
  );

  const years: YearProgressRow[] = YEAR_ORDER.map((year, index) => {
    const nasProjects = projectYears.get(year) ?? 0;
    const bundles = bundleCounts[index] ?? 0;
    const projects = nasProjects || bundles;
    const notion = year === "2022 이전" ? 0 : (notionYears.get(year) ?? 0);
    const images = imageYears.get(year) ?? 0;
    const hasWork = projects + notion + images + bundles > 0;
    const denom = Math.max(1, nasProjects || bundles);
    const progress_pct = hasWork
      ? Math.min(100, Math.round((bundles / denom) * 100))
      : 0;
    let status: YearProgressRow["status"] = "wait";
    if (!hasWork) status = "wait";
    else if (bundles > 0) status = "done";
    else status = "wait";
    return {
      year,
      projects,
      notion: year.startsWith("2022") ? 0 : notion,
      images,
      progress_pct,
      status,
      status_label: status === "done" ? "완료" : "대기"
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
