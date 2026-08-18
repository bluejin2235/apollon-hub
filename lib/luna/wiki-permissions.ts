import type { WikiCategory } from "@/lib/wiki/types";

/** profiles.role = '슈퍼관리자' → 요구사항의 「관리자」 */
export function isWikiSuperAdmin(role: string | null | undefined): boolean {
  return role === "슈퍼관리자";
}

/** profiles.role = '멤버' → 요구사항의 「직원」 */
export function isWikiMember(role: string | null | undefined): boolean {
  return !isWikiSuperAdmin(role);
}

export function canViewWikiDoc(
  doc: { visible_to_staff?: boolean },
  isSuperAdmin: boolean
): boolean {
  if (isSuperAdmin) return true;
  return doc.visible_to_staff !== false;
}

export function canEditWikiCategory(
  category: WikiCategory,
  isSuperAdmin: boolean
): boolean {
  if (category === "rules") return isSuperAdmin;
  return true;
}

export function canToggleWikiVisibility(isSuperAdmin: boolean): boolean {
  return isSuperAdmin;
}

export function canDeleteWiki(isSuperAdmin: boolean): boolean {
  return isSuperAdmin;
}

export function filterVisibleWikiDocs<T extends { visible_to_staff?: boolean }>(
  docs: T[],
  isSuperAdmin: boolean
): T[] {
  if (isSuperAdmin) return docs;
  return docs.filter((d) => d.visible_to_staff !== false);
}

export const WIKI_RULES_LOCK_MESSAGE =
  "🔒 이 문서는 관리자만 고칠 수 있습니다. 고쳐야 할 내용이 있으면 관리자에게 알려주세요.";