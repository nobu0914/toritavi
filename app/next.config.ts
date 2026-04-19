import type { NextConfig } from "next";

// Security headers applied to every response.
// CSP allows Supabase (auth + realtime) and blob/data URIs used by pdf.js and camera.
// 'unsafe-inline' / 'unsafe-eval' are tolerated because Mantine v7 and Next.js 16
// hydration rely on them; revisit with nonces when we need to tighten further.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co blob:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
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
