import { ReactNode } from "react";

import { WikiRoutesProvider } from "@/components/wiki/wiki-routes-context";
import { WEBSITE_GUIDE_ROUTES_CONFIG } from "@/lib/wiki/routes";

export default function WebsiteGuideLayout({ children }: { children: ReactNode }) {
  return (
    <WikiRoutesProvider config={WEBSITE_GUIDE_ROUTES_CONFIG}>{children}</WikiRoutesProvider>
  );
}
