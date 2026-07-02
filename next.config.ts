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
    ];
  },
};

export default nextConfig;
