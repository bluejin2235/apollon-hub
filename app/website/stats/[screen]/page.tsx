import { notFound } from "next/navigation";

import { WebsiteStats } from "@/components/website/stats/website-stats";
import { isStatsScreenId, STATS_SCREENS } from "@/lib/website/stats";

type PageProps = {
  params: Promise<{ screen: string }>;
};

export function generateStaticParams() {
  return STATS_SCREENS.map((item) => ({ screen: item.id }));
}

export default async function WebsiteStatsScreenPage({ params }: PageProps) {
  const { screen } = await params;
  if (!isStatsScreenId(screen)) notFound();
  return <WebsiteStats screen={screen} />;
}
