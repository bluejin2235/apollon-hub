"use client";

import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { PortalHeader } from "@/components/portal/portal-header";
import ServiceCard from "@/components/service-card";
import { signOutAndRedirectToLogin } from "@/lib/auth/logout";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";
import { formatPortalHeaderUserInfo } from "@/lib/portal/profile";
import { portalServices } from "@/lib/services";

export default function ServiceHubPage() {
  const { status, profile } = useRequirePortalSession();

  if (status === "checking") {
    return <PortalAuthChecking />;
  }

  const userInfoLine = profile ? formatPortalHeaderUserInfo(profile) : "- / - / -";

  return (
    <main className="min-h-screen">
      <PortalHeader
        userInfoLine={userInfoLine}
        onLogout={() => void signOutAndRedirectToLogin()}
        hubTitleVariant="text"
        zIndexClass="z-10"
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
