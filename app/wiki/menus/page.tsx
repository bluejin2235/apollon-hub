"use client";

import { WikiMenusAdmin } from "@/components/wiki/WikiMenusAdmin";
import { WikiMobileMenu } from "@/components/wiki/WikiMobileMenu";

export default function WikiMenusPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-[22px] pt-3 md:hidden">
        <WikiMobileMenu />
      </div>
      <WikiMenusAdmin />
    </div>
  );
}
