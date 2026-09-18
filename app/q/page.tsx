"use client";

import { PortalAuthChecking } from "@/components/portal/portal-auth-checking";
import { LunaQaChat } from "@/components/luna/LunaQaChat";
import { useRequirePortalSession } from "@/lib/auth/use-require-portal-session";

export default function QPage() {
  const { status } = useRequirePortalSession();
  if (status === "checking") return <PortalAuthChecking />;
  return <LunaQaChat />;
}
