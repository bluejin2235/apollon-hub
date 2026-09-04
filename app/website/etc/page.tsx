import { WebsiteEtc } from "@/components/website/website-etc";

export default function WebsiteEtcPage() {
  return <WebsiteEtc siteUrl={process.env.WEBSITE_API_URL ?? ""} />;
}
