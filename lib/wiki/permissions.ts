import type { WikiCategory } from "@/lib/wiki/types";

export function canEditWikiCategory(
  category: WikiCategory,
  isSuperAdmin: boolean
): boolean {
  if (category === "rules") return isSuperAdmin;
  return true;
}

export function canDeleteWiki(isSuperAdmin: boolean): boolean {
  return isSuperAdmin;
}

export const WIKI_RULES_LOCK_MESSAGE =
  "🔒 이 문서는 관리자만 고칠 수 있습니다. 고쳐야 할 내용이 있으면 관리자에게 알려주세요.";
