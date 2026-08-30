import { WebsiteHome } from "@/components/website/website-home";

export default function WebsiteHomePage() {
  return <WebsiteHome siteUrl={process.env.WEBSITE_API_URL ?? ""} />;
}
