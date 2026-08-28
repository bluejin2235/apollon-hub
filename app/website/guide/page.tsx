"use client";

import { WikiDocList } from "@/components/wiki/WikiDocList";

const WEBSITE_GUIDE_MENU = "website";

export default function WebsiteGuidePage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WikiDocList menuSlug={WEBSITE_GUIDE_MENU} />
    </div>
  );
}
