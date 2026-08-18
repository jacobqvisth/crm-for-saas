import type { NextConfig } from "next";

// Content-Security-Policy is shipped REPORT-ONLY first: it logs violations
// without blocking, so we can tune it against the real app (Google Maps,
// recharts, TipTap, Supabase realtime, the 46elks WebRTC calling socket, and
// inbound-email images) before switching to an enforcing policy. Move this to
// the "Content-Security-Policy" header name once the console is quiet.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // Next.js needs inline/eval; Google Maps JS pulls from googleapis/gstatic.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://maps.googleapis.com https://maps.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // Inbound email bodies and tracking pixels can reference arbitrary https img
  // hosts; data:/blob: cover generated avatars and map tiles.
  "img-src 'self' data: blob: https:",
  // Supabase (REST + realtime wss + storage), Maps, and the calling socket.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://maps.googleapis.com wss: https:",
  // Sandboxed srcDoc iframes used to render inbound email safely.
  "frame-src 'self' data:",
].join("; ");

const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "payment=(), usb=(), browsing-topics=()" },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

const nextConfig: NextConfig = {
  // Don't advertise the framework/version.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  async redirects() {
    return [
      // The analytics suite moved from /ceo/* to /dashboard/*. Keep old
      // bookmarks, Slack links, and the legacy /ceo entrypoint working.
      { source: "/ceo", destination: "/dashboard", permanent: true },
      {
        source: "/ceo/:path*",
        destination: "/dashboard/:path*",
        permanent: true,
      },
      // Reviews was promoted out of the analytics suite to its own top-level
      // section on 2026-08-06. This has to sit before the /ceo/:path* rule's
      // destination is followed, so /ceo/reviews lands on /reviews too (it
      // redirects to /dashboard/reviews first, then here).
      {
        source: "/dashboard/reviews",
        destination: "/reviews",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
