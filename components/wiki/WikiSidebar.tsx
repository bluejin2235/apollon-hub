"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { wikiFetch } from "@/components/wiki/wiki-fetch";
import { W } from "@/components/wiki/wiki-theme";
import { WIKI_CATEGORY_META, type WikiCategory } from "@/lib/wiki/types";

type NavPayload = {
  terms?: number;
  forms?: number;
  standards?: number;
  rules?: number;
};

const OPEN_ITEMS: { category: WikiCategory | "terms"; label: string; href: string }[] =
  [
    { category: "terms", label: "용어사전", href: "/wiki/terms" },
    { category: "forms", label: WIKI_CATEGORY_META.forms.label, href: "/wiki/forms" },
    {
      category: "standards",
      label: WIKI_CATEGORY_META.standards.label,
      href: "/wiki/standards"
    }
  ];

export function WikiSidebar() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [counts, setCounts] = useState<NavPayload>({});

  useEffect(() => {
    void wikiFetch<NavPayload>("/api/wiki/nav")
      .then(setCounts)
      .catch(() => undefined);
  }, [pathname]);

  function isOn(href: string): boolean {
    if (href === "/wiki/terms") {
      return pathname === "/wiki/terms" || pathname.startsWith("/wiki/terms/");
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function countFor(key: WikiCategory | "terms"): number | undefined {
    if (key === "terms") return counts.terms;
    return counts[key];
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
        <div
          className="mb-1 px-[9px] text-[9.5px]"
          style={{ color: W.faint }}
        >
          누구나 고칠 수 있어요
        </div>
        {OPEN_ITEMS.map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            count={countFor(item.category)}
            active={isOn(item.href)}
          />
        ))}
      </div>

      <div className="px-[9px]">
        <div
          className="mb-1 px-[9px] text-[9.5px]"
          style={{ color: W.faint }}
        >
          읽기만 가능해요
        </div>
        <NavLink
          href="/wiki/rules"
          label="규정 🔒"
          count={counts.rules}
          active={isOn("/wiki/rules")}
        />
      </div>
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
