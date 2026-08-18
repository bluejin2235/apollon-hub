import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  async redirects() {
    return [
      { source: "/glossary", destination: "/wiki/terms", permanent: false }
    ];
  }
};

export default nextConfig;
