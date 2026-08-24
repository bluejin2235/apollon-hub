import { WebsiteDashboard } from "@/components/website/website-dashboard";

export default function WebsitePage() {
  return <WebsiteDashboard siteUrl={process.env.WEBSITE_API_URL ?? ""} />;
}
