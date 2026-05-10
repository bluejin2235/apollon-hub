"use client";

import Link from "next/link";

export type PortalHeaderProps = {
  profileSummary: string;
  onLogout: () => void;
  /** Hub page uses a non-link title; shells link back to `/hub` */
  hubTitleVariant?: "link" | "text";
  maxWidthClass?: string;
  zIndexClass?: string;
  /** Shells hide profile chip on narrow screens */
  profileChipClassName?: string;
  showSettingsLink?: boolean;
  /** Tailwind classes for the profile + actions row */
  actionsRowClassName?: string;
  /** When set, Settings + Logout are wrapped (e.g. hub layout) */
  actionsInnerWrapClassName?: string;
};

const headerBar =
  "sticky top-0 border-b border-apollon-500/30 bg-cyan-900/85 backdrop-blur";

export function PortalHeader({
  profileSummary,
  onLogout,
  hubTitleVariant = "link",
  maxWidthClass = "w-full",
  zIndexClass = "z-20",
  profileChipClassName = "hidden rounded-md bg-white/10 px-2 py-1 text-slate-100 sm:inline",
  showSettingsLink = true,
  actionsRowClassName = "flex items-center gap-4 text-sm",
  actionsInnerWrapClassName
}: PortalHeaderProps) {
  const actions = (
    <>
      {showSettingsLink ? (
        <Link
          href="/settings"
          className="rounded-md px-3 py-1.5 text-slate-100 transition hover:bg-white/10 hover:text-white"
        >
          Settings
        </Link>
      ) : null}
      <button
        type="button"
        onClick={onLogout}
        className="rounded-md px-3 py-1.5 text-slate-100 transition hover:bg-white/10 hover:text-white"
      >
        Logout
      </button>
    </>
  );

  return (
    <header className={`${headerBar} ${zIndexClass}`}>
      <div className={`mx-auto flex h-14 w-full ${maxWidthClass} items-center justify-between`}>
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-apollon-500/90 text-center text-sm font-bold leading-7 text-white">A</div>
          {hubTitleVariant === "link" ? (
            <Link href="/hub" className="text-xl font-medium text-white">
              Apollon Hub
            </Link>
          ) : (
            <p className="text-xl font-medium text-white">Apollon Hub</p>
          )}
        </div>

        <div className={actionsRowClassName}>
          <span className={profileChipClassName}>{profileSummary}</span>
          {actionsInnerWrapClassName ? <div className={actionsInnerWrapClassName}>{actions}</div> : actions}
        </div>
      </div>
    </header>
  );
}
