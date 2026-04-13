import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: {
    position: "top-right",
  },
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
