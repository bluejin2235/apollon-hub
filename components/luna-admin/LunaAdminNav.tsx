"use client";

import {
  LUNA_ADMIN_MENUS,
  PRIMARY_SOURCE_TABS,
  adminMenuDef,
  type LunaAdminMenu,
  type LunaAdminPrimarySource,
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
  source?: LunaAdminPrimarySource | null;
  badges: Badges;
  onMenu: (menu: LunaAdminMenu) => void;
  onSub: (sub: LunaAdminSub) => void;
  onPrimarySource?: (source: LunaAdminPrimarySource | null) => void;
};

export function LunaAdminNav({
  menu,
  sub,
  source,
  badges,
  onMenu,
  onSub,
  onPrimarySource
}: Props) {
  const subs = adminMenuDef(menu).subs ?? [];
  const sourceMode = menu === "knowledge" && sub === "primary" && Boolean(source);

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
      {sourceMode ? (
        <nav className="sub2" aria-label="1차 데이터 원천">
          <button type="button" onClick={() => onPrimarySource?.(null)}>
            1차 데이터
          </button>
          {PRIMARY_SOURCE_TABS.map((item) => (
            <button
              key={item.slug}
              type="button"
              className={source === item.slug ? `on ${item.tone}` : ""}
              onClick={() => onPrimarySource?.(item.slug)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      ) : subs.length > 0 ? (
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
