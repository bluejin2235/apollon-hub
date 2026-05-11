/** 맛집 등록·상세 수정 공통: 대표 메뉴 행 ↔ DB `menu` / `price_range` */

export type MenuRow = { name: string; price: string };

export function formatMenuAndPriceRange(rows: MenuRow[]): { menu: string | null; price_range: string | null } {
  const filled = rows
    .map((r) => ({
      name: r.name.trim(),
      price: r.price.trim().replace(/,/g, "")
    }))
    .filter((r) => r.name.length > 0);

  if (filled.length === 0) {
    return { menu: null, price_range: null };
  }

  const parts = filled.map((r) => {
    if (!r.price) return r.name;
    const n = Number(r.price);
    const priceStr = Number.isFinite(n) && n >= 0 ? `${n.toLocaleString("ko-KR")}원` : `${r.price}원`;
    return `${r.name} (${priceStr})`;
  });

  const nums = filled.map((r) => Number(r.price)).filter((n) => Number.isFinite(n) && n > 0);

  let price_range: string | null = null;
  if (nums.length > 0) {
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    price_range =
      min === max ? `${min.toLocaleString("ko-KR")}원대` : `${min.toLocaleString("ko-KR")}~${max.toLocaleString("ko-KR")}원`;
  }

  return { menu: parts.join(" · "), price_range };
}

/** DB `menu` 문자열 → 편집용 행 (등록 시 `formatMenuAndPriceRange`와 역호환) */
export function parseMenuStringToRows(menu: string | null | undefined): MenuRow[] {
  const raw = menu?.trim();
  if (!raw) return [{ name: "", price: "" }];

  const segments = raw
    .split(/\s*[·•]\s*|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length === 0) return [{ name: "", price: "" }];

  const rows: MenuRow[] = [];
  for (const seg of segments) {
    const m = seg.match(/^(.+?)\s*\(([\d\s,]+)\s*원\)\s*$/);
    if (m) {
      const digits = m[2].replace(/\D/g, "");
      rows.push({ name: m[1].trim(), price: digits });
    } else {
      rows.push({ name: seg, price: "" });
    }
  }
  return rows.length > 0 ? rows : [{ name: "", price: "" }];
}
