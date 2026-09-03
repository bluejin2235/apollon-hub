import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  experimental: {
    // 미들웨어가 매칭되는 큰 JSON/기타 본문 대비. 업로드는 matcher 에서 제외.
    middlewareClientMaxBodySize: "220mb"
  },
  async redirects() {
    return [
      { source: "/glossary", destination: "/wiki/terms", permanent: false }
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
