import type { NextConfig } from "next";

// Non-CSP security headers (static).
//
// CSP is set per-request in src/proxy.ts so we can inject a fresh nonce
// into script-src. Putting CSP here would either force 'unsafe-inline'
// (what we're trying to remove) or leak stale config when routes differ.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  // Override Vercel edge's default `access-control-allow-origin: *` on HTML /
  // static responses. Same-origin fetches don't consult ACAO, so restricting
  // here only affects cross-origin attempts, which we don't want to serve.
  { key: "Access-Control-Allow-Origin", value: "https://toritavi.com" },
  { key: "Vary", value: "Origin" },
];

const nextConfig: NextConfig = {
  devIndicators: {
    position: "top-right",
  },
  compress: true,
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    scrollRestoration: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
