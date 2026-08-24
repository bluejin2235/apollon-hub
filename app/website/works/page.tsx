import { WebsiteWorksList } from "@/components/website/website-works-list";

export default function WebsiteWorksPage() {
  return <WebsiteWorksList siteUrl={process.env.WEBSITE_API_URL ?? ""} />;
}
