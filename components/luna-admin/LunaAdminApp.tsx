"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { PortalHeader } from "@/components/portal/portal-header";
import { LunaAdminNav } from "@/components/luna-admin/LunaAdminNav";
import { LunaAdminDashboard } from "@/components/luna-admin/LunaAdminDashboard";
import { LunaAdminPrimary } from "@/components/luna-admin/LunaAdminPrimary";
import { LunaAdminSecondary } from "@/components/luna-admin/LunaAdminSecondary";
import { LunaAdminTonight } from "@/components/luna-admin/LunaAdminTonight";
import { LunaAdminLinkProgress } from "@/components/luna-admin/LunaAdminLinkProgress";
import { LunaAdminAnalysis } from "@/components/luna-admin/LunaAdminAnalysis";
import { LunaAdminSent } from "@/components/luna-admin/LunaAdminSent";
import { LunaAdminMine, LunaAdminPending } from "@/components/luna-admin/LunaAdminCandidates";
import { LunaTalkHistory } from "@/components/luna/talk/LunaTalkHistory";
import { LunaTalkMetrics } from "@/components/luna/talk/LunaTalkMetrics";
import { LunaTalkSources } from "@/components/luna/talk/LunaTalkSources";
import { LunaFailures } from "@/components/luna/failures/LunaFailures";
import { LunaKnowledgeConflict } from "@/components/luna/knowledge/LunaKnowledgeConflict";
import { LunaCandidatesHistory } from "@/components/luna/candidates/LunaCandidatesHistory";
import { LunaSelfstudyHistory } from "@/components/luna/selfstudy/LunaSelfstudyHistory";
import { LunaStudyRunHistory } from "@/components/luna-admin/LunaStudyRunHistory";
import { LunaSelfstudySettings } from "@/components/luna/selfstudy/LunaSelfstudySettings";
import { LunaSelfstudyLearned } from "@/components/luna/selfstudy/LunaSelfstudyLearned";
import { LunaBrainEval } from "@/components/luna/brain/LunaBrainEval";
import { LunaBrainModel } from "@/components/luna/brain/LunaBrainModel";
import { LunaBrainPrompts } from "@/components/luna/brain/LunaBrainPrompts";
import { LunaBrainTypes } from "@/components/luna/brain/LunaBrainTypes";
import { LunaBrainReport } from "@/components/luna/brain/LunaBrainReport";
import { LunaBrainUpgrade } from "@/components/luna/brain/LunaBrainUpgrade";
import {
  buildLunaAdminUrl,
  isPrimarySource,
  resolveAdminRoute,
  defaultSubForAdminMenu,
  type LunaAdminMenu,
  type LunaAdminSub
} from "@/lib/luna-admin/nav";
import { adminFetch } from "@/components/luna-admin/fetch";
import type { AdminDashboard } from "@/lib/luna-admin/types";
import type { LunaAdminPrimarySource } from "@/lib/luna-admin/nav";

type Props = {
  userInfoLine: string;
  onLogout: () => void;
  role?: string;
};

export function LunaAdminApp(props: Props) {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-slate-500">불러오는 중…</p>}>
      <LunaAdminAppInner {...props} />
    </Suspense>
  );
}

function LunaAdminAppInner({ userInfoLine, onLogout, role }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const route = resolveAdminRoute(searchParams.get("menu"), searchParams.get("sub"));
  const sourceRaw = searchParams.get("source");
  const source = isPrimarySource(sourceRaw) ? sourceRaw : null;
  const chipParam = searchParams.get("chip");
  const secondaryChip =
    chipParam === "same" ||
    chipParam === "belongs" ||
    chipParam === "follows" ||
    chipParam === "criteria" ||
    chipParam === "perspective" ||
    chipParam === "all"
      ? chipParam
      : "all";
  const [badges, setBadges] = useState({
    failures: 0,
    candidates: 0,
    selfstudy_dot: false
  });

  useEffect(() => {
    void (async () => {
      try {
        const dash = await adminFetch<AdminDashboard>("/api/luna-admin/dashboard");
        setBadges(dash.badges);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const go = useCallback(
    (href: string) => {
      router.replace(href, { scroll: false });
    },
    [router]
  );

  const onMenu = useCallback(
    (menu: LunaAdminMenu) => {
      go(buildLunaAdminUrl(menu, defaultSubForAdminMenu(menu)));
    },
    [go]
  );

  const onSub = useCallback(
    (sub: LunaAdminSub) => {
      go(buildLunaAdminUrl(route.menu, sub));
    },
    [go, route.menu]
  );

  return (
    <main className="min-h-screen bg-[#f5f6f8]">
      <PortalHeader
        userInfoLine={userInfoLine}
        onLogout={onLogout}
        showSettingsLink={false}
        role={role}
      />
      <div className="luna-admin mx-auto max-w-[1020px] px-4 pb-16 pt-16">
        <div className="admin-head">
          <h1>LUNA 관리자</h1>
          <Link href="/settings?tab=profile">계정 설정</Link>
        </div>
        <div className="screen">
          <LunaAdminNav
            menu={route.menu}
            sub={route.sub}
            badges={badges}
            onMenu={onMenu}
            onSub={onSub}
          />
          <div className="body">
            {renderBody(route.menu, route.sub, source, go, secondaryChip)}
          </div>
        </div>
      </div>
    </main>
  );
}

function renderBody(
  menu: LunaAdminMenu,
  sub: LunaAdminSub | null,
  source: LunaAdminPrimarySource | null,
  go: (href: string) => void,
  secondaryChip: "all" | "same" | "belongs" | "follows" | "criteria" | "perspective"
) {
  if (menu === "dashboard") {
    return <LunaAdminDashboard onGo={go} />;
  }
  if (menu === "knowledge") {
    if (sub === "secondary") {
      return <LunaAdminSecondary onGo={go} initialChip={secondaryChip} />;
    }
    return (
      <LunaAdminPrimary
        source={source}
        onOpen={(next) => go(buildLunaAdminUrl("knowledge", "primary", { source: next }))}
        onBack={() => go(buildLunaAdminUrl("knowledge", "primary"))}
      />
    );
  }
  if (menu === "talk") {
    if (sub === "sources") return <LunaTalkSources />;
    if (sub === "metrics") return <LunaTalkMetrics />;
    return <LunaTalkHistory />;
  }
  if (menu === "selfstudy") {
    if (sub === "history") {
      return (
        <>
          <LunaStudyRunHistory />
          <LunaSelfstudyHistory />
        </>
      );
    }
    if (sub === "links") return <LunaAdminLinkProgress onGo={go} />;
    if (sub === "learned") return <LunaSelfstudyLearned />;
    if (sub === "settings") return <LunaSelfstudySettings />;
    return <LunaAdminTonight />;
  }
  if (menu === "failures") {
    if (sub === "analysis") return <LunaAdminAnalysis onGo={go} />;
    if (sub === "sent") return <LunaAdminSent />;
    return <LunaFailures />;
  }
  if (menu === "candidates") {
    if (sub === "mine") return <LunaAdminMine />;
    if (sub === "conflict") return <LunaKnowledgeConflict />;
    if (sub === "history") return <LunaCandidatesHistory />;
    return <LunaAdminPending onGo={go} />;
  }
  if (menu === "brain") {
    if (sub === "types") return <LunaBrainTypes />;
    if (sub === "upgrade") return <LunaBrainUpgrade />;
    if (sub === "report") return <LunaBrainReport />;
    if (sub === "model") return <LunaBrainModel />;
    if (sub === "eval") return <LunaBrainEval />;
    return <LunaBrainPrompts />;
  }
  return <p className="empty">화면이 없습니다.</p>;
}
