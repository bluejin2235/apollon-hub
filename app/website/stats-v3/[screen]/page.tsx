import { notFound } from "next/navigation";

import { V3Shell } from "@/components/website/stats-v3/v3-shell";
import { isV3ScreenId, V3_SCREENS } from "@/components/website/stats-v3/v3-screens";

type PageProps = {
  params: Promise<{ screen: string }>;
};

export function generateStaticParams() {
  return V3_SCREENS.map((item) => ({ screen: item.id }));
}

export default async function WebsiteStatsV3Page({ params }: PageProps) {
  const { screen } = await params;
  if (!isV3ScreenId(screen)) notFound();
  return <V3Shell screen={screen} />;
}
