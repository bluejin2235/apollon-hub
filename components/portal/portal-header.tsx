"use client";

import { useEffect } from "react";
import Link from "next/link";
import { PortalStatsTracker } from "@/components/portal/portal-stats-tracker";
import { APP_TITLE } from "@/lib/portal/app-title";

export type PortalHeaderProps = {
  /** `이름 / 부서 / 권한` 한 줄 */
  userInfoLine: string;
  onLogout: () => void;
  /** Hub page uses a non-link title; shells link back to `/hub` */
  hubTitleVariant?: "link" | "text";
  maxWidthClass?: string;
  zIndexClass?: string;
  showSettingsLink?: boolean;
};

const headerBar = "fixed top-0 left-0 right-0 z-50 w-full border-b border-slate-200 bg-white";

function LogoMark() {
  return (
    <img
      src="/logo.png"
      alt="Apollon Logo"
      width={28}
      height={28}
      className="shrink-0"
      aria-hidden
    />
  );
}

function IconSettings(props: { className?: string }) {
  return (
    <svg className={props.className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.281Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function IconLogout(props: { className?: string }) {
  return (
    <svg className={props.className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M18 9l3 3m0 0-3 3m3-3H9"
      />
    </svg>
  );
}

function HeaderNotifications() {
  useEffect(() => {
    if (document.getElementById("tabler-icons-css")) return;
    const link = document.createElement("link");
    link.id = "tabler-icons-css";
    link.rel = "stylesheet";
    link.href =
      "https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.34.1/dist/tabler-icons.min.css";
    document.head.appendChild(link);
  }, []);

  return (
    <button
      type="button"
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-gray-900 transition hover:border-slate-400 hover:bg-slate-50"
      aria-label="알림"
      title="알림"
    >
      <i className="ti ti-bell text-lg leading-none" aria-hidden />
    </button>
  );
}

export function PortalHeader({
  userInfoLine,
  onLogout,
  hubTitleVariant = "link",
  maxWidthClass = "max-w-7xl",
  zIndexClass = "z-50",
  showSettingsLink = true
}: PortalHeaderProps) {
  const title = (
    <span className="text-base font-bold uppercase tracking-wide text-gray-900 sm:text-[0.95rem]">{APP_TITLE}</span>
  );

  return (
    <header className={`${headerBar} ${zIndexClass}`}>
      <PortalStatsTracker />
      <div className={`mx-auto flex h-14 w-full ${maxWidthClass} items-center justify-between gap-4 px-4 sm:px-6`}>
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/hub" className="shrink-0" aria-label="허브로 이동">
            <LogoMark />
          </Link>
          {hubTitleVariant === "link" ? (
            <Link href="/hub" className="min-w-0 shrink truncate text-gray-900 hover:text-gray-700">
              {title}
            </Link>
          ) : (
            <p className="min-w-0 shrink truncate text-gray-900">{title}</p>
          )}
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
          <span
            className="min-w-0 max-w-[min(46vw,24rem)] truncate text-xs text-gray-900 sm:max-w-[min(56vw,32rem)] sm:text-sm"
            title={userInfoLine}
          >
            {userInfoLine}
          </span>

          <HeaderNotifications />

          {showSettingsLink ? (
            <Link
              href="/settings"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-gray-900 transition hover:border-slate-400 hover:bg-slate-50"
              aria-label="설정"
              title="설정"
            >
              <IconSettings className="h-5 w-5" />
            </Link>
          ) : null}
          <button
            type="button"
            onClick={onLogout}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-gray-900 transition hover:border-slate-400 hover:bg-slate-50"
            aria-label="로그아웃"
            title="로그아웃"
          >
            <IconLogout className="h-5 w-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
