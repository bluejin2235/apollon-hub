"use client";

// TODO(홈페이지 오픈 후 삭제) 개발 기간 한정 테스트 계정 권한

import { createContext, useContext, type ReactNode } from "react";
import { isWebsiteTesterRole } from "@/lib/auth/website-tester";

type WebsitePermissions = {
  isWebsiteTester: boolean;
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
        canManageWorks: !isWebsiteTester
      }}
    >
      {children}
    </WebsitePermissionsContext.Provider>
  );
}

export function useWebsitePermissions(): WebsitePermissions {
  return useContext(WebsitePermissionsContext);
}
