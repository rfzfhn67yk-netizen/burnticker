import type { NextConfig } from "next";
import { cspHeaderRules } from "@/lib/burnticker/csp";
import { pageCacheHeaderRules } from "@/lib/burnticker/edgeCache";
import { ogImageHeaderRule } from "@/lib/burnticker/pageMeta";

/** The public Burnticker app: the wizard, the token pages, the trust page and their API routes. Served behind Caddy (deploy/caddy). */
const nextConfig: NextConfig = {
  compress: true,
  // 2026-10-15 prelaunch audit H5: no page uses a remote image and the one next/image (the sidebar icon) is a local SVG, so the image
  // optimiser (/_next/image: GHSA-2xp9 RCE with AVIF, GHSA-cjq9 SSRF) is switched off and no remote host is allowed.
  images: { unoptimized: true, remotePatterns: [] },
  // scripts/ops/deploy-burnticker-host.sh builds beside the live build (NEXT_DIST_DIR=.next-burnticker) and ships that directory as .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typescript: { ignoreBuildErrors: false },
  // No "X-Powered-By: Next.js" on a public host.
  poweredByHeader: false,
  // ChatGPT audit 7 item 4: a Content-Security-Policy in REPORT-ONLY mode on every page but the embeds (src/lib/burnticker/csp.ts).
  // It blocks nothing; browsers report what it would block to /api/burnticker/csp-report. docs/burnticker/CSP.md: how to enforce.
  // Prelaunch audit 2026-10-18 A-22: the app's pages may be kept 30 s at the edge (src/lib/burnticker/edgeCache.ts); Next answered
  // every one `private, no-store`, so Cloudflare rendered nothing from its cache and the origin rendered every view.
  async headers() {
    return [...cspHeaderRules((process.env.BURNTICKER_PUBLIC_RPC_ORIGIN ?? "").trim() || null), ...pageCacheHeaderRules(), ogImageHeaderRule()];
  },
};

export default nextConfig;
