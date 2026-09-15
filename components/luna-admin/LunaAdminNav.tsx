"use client";

import {
  LUNA_ADMIN_MENUS,
  adminMenuDef,
  type LunaAdminMenu,
  type LunaAdminSub
} from "@/lib/luna-admin/nav";

type Badges = {
  failures: number;
  candidates: number;
  selfstudy_dot: boolean;
};

type Props = {
  menu: LunaAdminMenu;
  sub: LunaAdminSub | null;
  badges: Badges;
  onMenu: (menu: LunaAdminMenu) => void;
  onSub: (sub: LunaAdminSub) => void;
};

export function LunaAdminNav({ menu, sub, badges, onMenu, onSub }: Props) {
  const subs = adminMenuDef(menu).subs ?? [];

  return (
    <>
      <nav className="nav" aria-label="LUNA 관리자 메뉴">
        {LUNA_ADMIN_MENUS.map((item) => {
          const on = menu === item.slug;
          const count =
            item.slug === "failures"
              ? badges.failures
              : item.slug === "candidates"
                ? badges.candidates
                : 0;
          const dot = item.slug === "selfstudy" && badges.selfstudy_dot;
          return (
            <button
              key={item.slug}
              type="button"
              className={on ? "on" : ""}
              onClick={() => onMenu(item.slug)}
            >
              {item.label}
              {count > 0 ? <span className="n">{count}</span> : null}
              {dot ? <span className="dot" /> : null}
            </button>
          );
        })}
      </nav>
      {subs.length > 0 ? (
        <nav className="sub2" aria-label="LUNA 관리자 하위">
          {subs.map((item) => (
            <button
              key={item.slug}
              type="button"
              className={sub === item.slug ? "on" : ""}
              onClick={() => onSub(item.slug)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      ) : null}
    </>
  );
}
