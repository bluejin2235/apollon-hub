import type { WikiDoc, WikiMenu } from "@/lib/wiki/types";

export {
  canDeleteWiki,
  canToggleWikiVisibility,
  canViewWikiDoc,
  filterVisibleWikiDocs,
  isWikiMember,
  isWikiSuperAdmin,
  WIKI_RULES_LOCK_MESSAGE
} from "@/lib/luna/wiki-permissions";

export function canEditWikiMenu(
  menu: WikiMenu | null | undefined,
  isSuperAdmin: boolean
): boolean {
  if (!menu) return isSuperAdmin;
  if (menu.editable_by === "admin") return isSuperAdmin;
  return true;
}

export function canMoveToWikiMenu(
  menu: WikiMenu | null | undefined,
  isSuperAdmin: boolean
): boolean {
  return canEditWikiMenu(menu, isSuperAdmin);
}

export function canCreateInWikiMenu(
  menu: WikiMenu | null | undefined,
  isSuperAdmin: boolean
): boolean {
  if (!menu || !menu.is_active) return false;
  return canEditWikiMenu(menu, isSuperAdmin);
}

export function docMenuSlug(doc: Pick<WikiDoc, "menu_slug">): string {
  return doc.menu_slug;
}
