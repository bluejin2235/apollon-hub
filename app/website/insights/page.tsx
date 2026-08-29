import { WebsiteInsightsList } from "@/components/website/website-insights-list";

export default function WebsiteInsightsPage() {
  return <WebsiteInsightsList siteUrl={process.env.WEBSITE_API_URL ?? ""} />;
}
