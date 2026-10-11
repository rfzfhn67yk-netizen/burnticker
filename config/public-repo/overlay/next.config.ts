import type { NextConfig } from "next";

/** The public Burnticker app: the wizard, the token pages, the trust page and their API routes. Served behind Caddy (deploy/caddy). */
const nextConfig: NextConfig = {
  compress: true,
  // scripts/ops/deploy-burnticker-host.sh builds beside the live build (NEXT_DIST_DIR=.next-burnticker) and ships that directory as .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typescript: { ignoreBuildErrors: false },
  // No "X-Powered-By: Next.js" on a public host.
  poweredByHeader: false,
};

export default nextConfig;
