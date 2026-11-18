import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  experimental: {
    // 미들웨어가 매칭되는 큰 JSON/기타 본문 대비. 업로드는 matcher 에서 제외.
    middlewareClientMaxBodySize: "220mb"
  },
  async redirects() {
    return [
      { source: "/glossary", destination: "/wiki/terms", permanent: false },
      {
        source: "/website/stats/ai-visibility",
        destination: "/website/stats/ai",
        permanent: false
      },
      {
        source: "/website/stats/ai-crawler",
        destination: "/website/stats/ai",
        permanent: false
      },
      // 옛 stats-v3 미리보기 주소 → 본 주소 (308)
      {
        source: "/website/stats-v3",
        destination: "/website/stats/summary",
        permanent: true
      },
      {
        source: "/website/stats-v3/overview",
        destination: "/website/stats/summary",
        permanent: true
      },
      {
        source: "/website/stats-v3/visits",
        destination: "/website/stats/behavior",
        permanent: true
      },
      {
        source: "/website/stats-v3/:screen",
        destination: "/website/stats/:screen",
        permanent: true
      }
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }]
      }
    ];
  }
};

export default nextConfig;
