import { notFound } from "next/navigation";

import { WebsiteStatsActions } from "@/components/website/stats/website-stats";
import { V3Shell } from "@/components/website/stats-v3/v3-shell";
import { isV3ScreenId, V3_SCREENS } from "@/components/website/stats-v3/v3-screens";
import { isStatsScreenId } from "@/lib/website/stats";

type PageProps = {
  params: Promise<{ screen: string }>;
};

export function generateStaticParams() {
  return [
    ...V3_SCREENS.map((item) => ({ screen: item.id })),
    { screen: "actions" }
  ];
}

export default async function WebsiteStatsScreenPage({ params }: PageProps) {
  const { screen } = await params;
  if (!isStatsScreenId(screen)) notFound();
  if (screen === "actions") return <WebsiteStatsActions />;
  if (!isV3ScreenId(screen)) notFound();
  return <V3Shell screen={screen} />;
}
