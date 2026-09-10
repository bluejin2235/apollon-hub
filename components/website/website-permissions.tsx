"use client";

import { createContext, useContext, type ReactNode } from "react";
import { isWebsiteTesterRole } from "@/lib/auth/website-tester";

type WebsitePermissions = {
  isWebsiteTester: boolean;
  /** 홈페이지 어드민에 들어온 사람은 등록·저장·공개·감추기·편성 모두 가능 */
  canManageWorks: boolean;
};

const WebsitePermissionsContext = createContext<WebsitePermissions>({
  isWebsiteTester: false,
  canManageWorks: true
});

export function WebsitePermissionsProvider({
  role,
  children
}: {
  role: string | null | undefined;
  children: ReactNode;
}) {
  const isWebsiteTester = isWebsiteTesterRole(role);

  return (
    <WebsitePermissionsContext.Provider
      value={{
        isWebsiteTester,
        canManageWorks: true
      }}
    >
      {children}
    </WebsitePermissionsContext.Provider>
  );
}

export function useWebsitePermissions(): WebsitePermissions {
  return useContext(WebsitePermissionsContext);
}
