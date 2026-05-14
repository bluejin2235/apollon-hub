"use client";

import { useEffect, useState } from "react";
import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import ServiceCard from "@/components/service-card";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalHeaderUserInfo } from "@/lib/portal/profile";
import {
  HUB_SERVICE_COLUMNS,
  canAccessHubService,
  isHubServiceAccessLevel,
  isHubServiceStatus,
  type HubService
} from "@/lib/services/hub-types";
import { supabase } from "@/lib/supabase/client";

export default function ServiceHubPage() {
  const { status, profile } = useRequirePortalSession();
  const [services, setServices] = useState<HubService[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingServices, setLoadingServices] = useState(true);

  useEffect(() => {
    if (status !== "ready") return;
    let cancelled = false;

    (async () => {
      console.log("[hub][debug] services 조회 시작", { selectCols: HUB_SERVICE_COLUMNS });

      const { data, error, status: respStatus, statusText } = await supabase
        .from("services")
        .select(HUB_SERVICE_COLUMNS)
        .eq("is_hub_card", true)
        .order("order_index", { ascending: true })
        .order("created_at", { ascending: true });

      if (cancelled) return;

      console.log("[hub][debug] 쿼리 응답", {
        httpStatus: respStatus,
        statusText,
        errorMessage: error?.message ?? null,
        errorCode: (error as { code?: string } | null)?.code ?? null,
        errorDetails: (error as { details?: string } | null)?.details ?? null,
        errorHint: (error as { hint?: string } | null)?.hint ?? null,
        rowCount: data?.length ?? 0,
        rawData: data
      });

      if (error) {
        console.error("[hub] services fetch failed", error);
        setLoadError(
          `${error.message}${(error as { code?: string }).code ? ` (code=${(error as { code?: string }).code})` : ""}`
        );
        setLoadingServices(false);
        return;
      }

      const rawRows = (data ?? []) as Array<Record<string, unknown>>;
      const rejected: Array<{ row: unknown; reason: string }> = [];
      const accepted = rawRows.filter((row) => {
        const reasons: string[] = [];
        if (typeof row.name !== "string") reasons.push(`name type=${typeof row.name}`);
        if (!isHubServiceStatus(row.status))
          reasons.push(`status invalid (value=${JSON.stringify(row.status)})`);
        if (!isHubServiceAccessLevel(row.access_level))
          reasons.push(`access_level invalid (value=${JSON.stringify(row.access_level)})`);
        if (reasons.length > 0) {
          rejected.push({ row, reason: reasons.join(", ") });
          return false;
        }
        return true;
      });

      console.log("[hub][debug] validation 결과", {
        rawCount: rawRows.length,
        acceptedCount: accepted.length,
        rejectedCount: rejected.length,
        rejected
      });

      const rows: HubService[] = accepted.map(
        (row): HubService => ({
          id: row.id as string,
          name: row.name as string,
          description: (row.description as string | null) ?? null,
          icon: (row.icon as string | null) ?? null,
          url: (row.url as string | null) ?? null,
          status: row.status as HubService["status"],
          access_level: row.access_level as HubService["access_level"],
          order_index: (row.order_index as number) ?? 0,
          created_at: row.created_at as string
        })
      );
      setServices(rows);
      setLoadError(null);
      setLoadingServices(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [status]);

  if (status === "checking") {
    return <PortalAuthChecking />;
  }

  const userInfoLine = profile ? formatPortalHeaderUserInfo(profile) : "- / - / -";
  const role = profile?.role;

  return (
    <main className="min-h-screen">
      <PortalHeader
        userInfoLine={userInfoLine}
        onLogout={() => void signOutAndRedirectToLogin()}
        hubTitleVariant="text"
        zIndexClass="z-10"
      />

      <div className="w-full px-4 pb-10 pt-16">
        {loadError ? (
          <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            서비스를 불러오지 못했습니다. ({loadError})
          </p>
        ) : null}

        <section className="grid grid-cols-2 gap-4">
          {loadingServices && services.length === 0 ? (
            <p className="col-span-full text-sm text-slate-500">서비스 불러오는 중…</p>
          ) : services.length === 0 ? (
            <p className="col-span-full rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
              표시할 서비스가 없습니다. 설정 → 서비스 관리에서 추가해 주세요.
            </p>
          ) : (
            services.map((svc) => {
              const restricted = !canAccessHubService(svc.access_level, role);
              return (
                <ServiceCard
                  key={svc.id}
                  title={svc.name}
                  description={svc.description ?? ""}
                  icon={svc.icon ?? "✨"}
                  href={svc.url ?? undefined}
                  status={svc.status}
                  accessRestricted={restricted}
                />
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
