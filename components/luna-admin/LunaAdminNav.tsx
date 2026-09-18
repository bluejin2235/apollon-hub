"use client";

import {
  LUNA_ADMIN_MENUS,
  PRIMARY_SOURCE_TABS,
  SECONDARY_CHIPS,
  adminMenuDef,
  type LunaAdminMenu,
  type LunaAdminPrimarySource,
  type LunaAdminSecondaryChip,
  type LunaAdminSub
} from "@/lib/luna-admin/nav";

type Badges = {
  failures: number;
  candidates: number;
  selfstudy_dot: boolean;
  selfstudy_ask?: number;
};

type NavCounts = {
  primary?: { work: number; notion: number; wiki: number; glossary: number };
  secondary?: { same: number; belongs: number; follows: number; perspective: number };
};

type Props = {
  menu: LunaAdminMenu;
  sub: LunaAdminSub | null;
  source?: Exclude<LunaAdminPrimarySource, "image"> | null;
  secondaryChip?: LunaAdminSecondaryChip;
  badges: Badges;
  counts?: NavCounts;
  onMenu: (menu: LunaAdminMenu) => void;
  onSub: (sub: LunaAdminSub) => void;
  onPrimarySource?: (source: Exclude<LunaAdminPrimarySource, "image"> | null) => void;
  onSecondaryChip?: (chip: LunaAdminSecondaryChip) => void;
};

function fmt(n: number | undefined): string {
  if (n == null) return "";
  return n.toLocaleString("ko-KR");
}

export function LunaAdminNav({
  menu,
  sub,
  source,
  secondaryChip,
  badges,
  counts,
  onMenu,
  onSub,
  onPrimarySource,
  onSecondaryChip
}: Props) {
  const subs = adminMenuDef(menu).subs ?? [];
  const knowledge = menu === "knowledge";
  const primaryOn = knowledge && sub === "primary";
  const secondaryOn = knowledge && sub === "secondary";

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
              {item.slug === "ask" && (badges.selfstudy_ask ?? 0) > 0 ? (
                <b className="ask-n">{badges.selfstudy_ask}</b>
              ) : null}
            </button>
          ))}
        </nav>
      ) : null}
      {primaryOn ? (
        <nav className="nav3" aria-label="1차 데이터 원천">
          <button
            type="button"
            className={!source ? "on" : ""}
            onClick={() => onPrimarySource?.(null)}
          >
            전체
          </button>
          {PRIMARY_SOURCE_TABS.map((item) => {
            const n =
              item.slug === "workserver"
                ? counts?.primary?.work
                : item.slug === "notion"
                  ? counts?.primary?.notion
                  : item.slug === "wiki"
                    ? counts?.primary?.wiki
                    : counts?.primary?.glossary;
            return (
              <button
                key={item.slug}
                type="button"
                className={source === item.slug ? `on ${item.tone}` : ""}
                onClick={() => onPrimarySource?.(item.slug)}
              >
                {item.label}
                {n != null ? <b>{fmt(n)}</b> : null}
              </button>
            );
          })}
        </nav>
      ) : null}
      {secondaryOn ? (
        <nav className="nav3" aria-label="2차 데이터 종류">
          {SECONDARY_CHIPS.map((item) => {
            const n =
              item.slug === "same"
                ? counts?.secondary?.same
                : item.slug === "belongs"
                  ? counts?.secondary?.belongs
                  : item.slug === "follows"
                    ? counts?.secondary?.follows
                    : item.slug === "perspective"
                      ? counts?.secondary?.perspective
                      : undefined;
            const on =
              item.slug === "all"
                ? !secondaryChip || secondaryChip === "all" || secondaryChip === "criteria"
                : secondaryChip === item.slug;
            return (
              <button
                key={item.slug}
                type="button"
                className={on ? "on" : ""}
                onClick={() => onSecondaryChip?.(item.slug)}
              >
                {item.label}
                {n != null ? <b>{fmt(n)}</b> : null}
              </button>
            );
          })}
        </nav>
      ) : null}
    </>
  );
}
