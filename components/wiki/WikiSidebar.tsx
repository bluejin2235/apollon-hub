"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { wikiFetch } from "@/components/wiki/wiki-fetch";
import { W } from "@/components/wiki/wiki-theme";
import type { WikiMenu } from "@/lib/wiki/types";

type NavPayload = {
  terms?: number;
  menus?: WikiMenu[];
  is_admin?: boolean;
};

export function WikiSidebar() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [nav, setNav] = useState<NavPayload>({});

  useEffect(() => {
    void wikiFetch<NavPayload>("/api/wiki/nav")
      .then(setNav)
      .catch(() => undefined);
  }, [pathname]);

  const menus = (nav.menus ?? []).filter((m) => m.is_active);
  const openMenus = menus.filter((m) => m.editable_by !== "admin");
  const lockedMenus = menus.filter((m) => m.editable_by === "admin");

  function isOn(href: string): boolean {
    if (href === "/wiki/terms") {
      return pathname === "/wiki/terms" || pathname.startsWith("/wiki/terms/");
    }
    if (href.startsWith("/wiki/list/")) {
      return pathname === href || pathname.startsWith(`${href}/`);
    }
    return pathname === href;
  }

  return (
    <aside
      className="flex h-full w-full flex-col border-r bg-white md:w-[184px] md:shrink-0"
      style={{ borderColor: W.line }}
    >
      <div className="flex items-center gap-2 px-[13px] pb-[11px] pt-[15px]">
        <span
          className="grid h-[23px] w-[23px] place-items-center rounded-[7px] text-[11px] text-white"
          style={{ background: W.luna }}
        >
          📖
        </span>
        <span className="text-[13.5px] font-bold" style={{ color: W.ink }}>
          Wikipedia
        </span>
      </div>
      <div
        className="mb-[11px] border-b px-[9px] pb-[11px]"
        style={{ borderColor: W.line2 }}
      >
        <button
          type="button"
          onClick={() => router.push("/luna")}
          className="rounded-lg px-[9px] py-1.5 text-[12px] font-semibold"
          style={{ background: W.lunaSoft, color: W.luna }}
        >
          ← 루나로 돌아가기
        </button>
      </div>

      <div className="mb-3 px-[9px]">
        <div className="mb-1 px-[9px] text-[9.5px]" style={{ color: W.faint }}>
          누구나 고칠 수 있어요
        </div>
        <NavLink
          href="/wiki/terms"
          label="용어사전"
          count={nav.terms}
          active={isOn("/wiki/terms")}
        />
        {openMenus.map((m) => (
          <NavLink
            key={m.slug}
            href={`/wiki/list/${m.slug}`}
            label={m.name}
            count={m.doc_count}
            active={isOn(`/wiki/list/${m.slug}`)}
          />
        ))}
      </div>

      {lockedMenus.length > 0 ? (
        <div className="px-[9px]">
          <div className="mb-1 px-[9px] text-[9.5px]" style={{ color: W.faint }}>
            읽기만 가능해요
          </div>
          {lockedMenus.map((m) => (
            <NavLink
              key={m.slug}
              href={`/wiki/list/${m.slug}`}
              label={`${m.name} 🔒`}
              count={m.doc_count}
              active={isOn(`/wiki/list/${m.slug}`)}
            />
          ))}
        </div>
      ) : null}

      {nav.is_admin ? (
        <div
          className="mt-auto border-t px-[13px] py-2.5"
          style={{ borderColor: W.line2 }}
        >
          <Link
            href="/wiki/menus"
            className="text-[11px] font-semibold"
            style={{
              color: pathname.startsWith("/wiki/menus") ? W.lunaInk : W.luna
            }}
          >
            ＋ 메뉴 관리
          </Link>
        </div>
      ) : null}
    </aside>
  );
}

function NavLink({
  href,
  label,
  count,
  active
}: {
  href: string;
  label: string;
  count?: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className="mb-px flex items-center gap-[7px] rounded-lg px-[9px] py-1.5 text-[12px]"
      style={
        active
          ? { background: W.lunaSoft, color: W.lunaInk, fontWeight: 700 }
          : { color: W.sub }
      }
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {typeof count === "number" ? (
        <span className="text-[10px]" style={{ color: W.faint }}>
          {count}
        </span>
      ) : null}
    </Link>
  );
}
