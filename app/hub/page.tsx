"use client";

import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import ServiceCard from "@/components/service-card";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalProfileSummary } from "@/lib/portal/profile";
import { portalServices } from "@/lib/services";

export default function ServiceHubPage() {
  const { status, profile } = useRequirePortalSession();

  if (status === "checking") {
    return <PortalAuthChecking />;
  }

  const summary = profile ? formatPortalProfileSummary(profile) : "- / -";

  return (
    <main className="min-h-screen">
      <PortalHeader
        profileSummary={summary}
        onLogout={() => void signOutAndRedirectToLogin()}
        hubTitleVariant="text"
        zIndexClass="z-10"
        profileChipClassName="text-sm text-slate-100"
        actionsRowClassName="flex items-center gap-6 text-sm"
        actionsInnerWrapClassName="flex items-center gap-2 text-sm"
      />

      <div className="pb-10 pt-16">
        <section className="grid gap-4 md:grid-cols-2">
          {portalServices.map((service) => (
            <ServiceCard
              key={service.title}
              title={service.title}
              description={service.description}
              icon={service.icon}
              href={service.href}
              comingSoon={service.comingSoon}
            />
          ))}
        </section>
      </div>
    </main>
  );
}
