import type { License } from "@/lib/licenses/types";

export type ServiceCategory = {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

/** services 조회 시 카테고리명 join */
export const SERVICES_WITH_CATEGORY_SELECT =
  "*, service_categories ( id, name, sort_order, is_active )";

type CategoryJoin =
  | { id?: string; name?: string; sort_order?: number; is_active?: boolean }
  | { id?: string; name?: string; sort_order?: number; is_active?: boolean }[]
  | null
  | undefined;

function unwrapCategoryJoin(raw: CategoryJoin): {
  id: string | null;
  name: string | null;
} {
  if (!raw) return { id: null, name: null };
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== "object") return { id: null, name: null };
  const id = typeof row.id === "string" ? row.id : null;
  const name = typeof row.name === "string" ? row.name.trim() : null;
  return { id, name: name || null };
}

/** select 결과를 License 형태로 정규화 (join 이름 → category_name) */
export function mapServiceRow(row: Record<string, unknown>): License {
  const join = unwrapCategoryJoin(row.service_categories as CategoryJoin);
  const category_id =
    typeof row.category_id === "string"
      ? row.category_id
      : join.id;
  const category_name = join.name;
  const legacy =
    typeof row.category === "string" && row.category.trim()
      ? row.category.trim()
      : null;

  const { service_categories: _omit, ...rest } = row;
  void _omit;

  return {
    ...(rest as unknown as License),
    category_id: category_id ?? null,
    category_name: category_name ?? legacy,
    // B그룹 스냅샷 호환: 현재 표시명을 category 에도 채워 둔다
    category: category_name ?? legacy ?? ""
  };
}

export function mapServiceRows(rows: unknown[] | null | undefined): License[] {
  return (rows ?? [])
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
    .map(mapServiceRow);
}

export function licenseCategoryLabel(
  license: Pick<License, "category_name" | "category">
): string {
  const name = (license.category_name ?? license.category ?? "").trim();
  return name || "카테고리 미분류";
}

export function licenseCategoryKey(
  license: Pick<License, "category_id" | "category_name" | "category">
): string {
  if (license.category_id) return license.category_id;
  return `__name:${licenseCategoryLabel(license)}`;
}

export function isFkRestrictError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const msg = (error.message ?? "").toLowerCase();
  return (
    code === "23503" ||
    msg.includes("foreign key") ||
    msg.includes("violates foreign key") ||
    msg.includes("restrict")
  );
}
