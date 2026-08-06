import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
