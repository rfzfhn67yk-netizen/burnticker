import type { NextConfig } from "next";
import { cspHeaderRules } from "@/lib/burnticker/csp";

/** The public Burnticker app: the wizard, the token pages, the trust page and their API routes. Served behind Caddy (deploy/caddy). */
const nextConfig: NextConfig = {
  compress: true,
  // scripts/ops/deploy-burnticker-host.sh builds beside the live build (NEXT_DIST_DIR=.next-burnticker) and ships that directory as .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typescript: { ignoreBuildErrors: false },
  // No "X-Powered-By: Next.js" on a public host.
  poweredByHeader: false,
  // ChatGPT audit 7 item 4: a Content-Security-Policy in REPORT-ONLY mode on every page but the embeds (src/lib/burnticker/csp.ts).
  // It blocks nothing; browsers report what it would block to /api/burnticker/csp-report. docs/burnticker/CSP.md: how to enforce.
  async headers() {
    return cspHeaderRules((process.env.BURNTICKER_PUBLIC_RPC_ORIGIN ?? "").trim() || null);
  },
};

export default nextConfig;
