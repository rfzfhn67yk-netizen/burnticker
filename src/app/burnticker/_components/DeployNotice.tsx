"use client";

import { useEffect, useState } from "react";

/**
 * THE UPDATE BANNER (owner, launch night 2026-10-13: "when we do these updates, now that the site is live, add a warning at the top so
 * people know it's not broken"). scripts/ops/deploy-burnticker-host.sh writes /deploying.json on the host before it copies anything and
 * removes it after the web unit answers and the static pages are in place; this strip shows while that file exists and checks again
 * every 20 s. While the web unit itself restarts, Caddy serves the static fallback page, which carries the same sentence. Nothing on
 * chain is touched by a deploy, and the strip says so.
 */
import { DEPLOY_NOTICE_TEXT, readDeployMarker } from "@/lib/burnticker/deployNotice";

export function DeployNotice() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      // HS-9: the host answers {"deploying":false} when no deploy runs (no more 404 in the console every 20 s)
      const on = await readDeployMarker();
      if (alive) setOn(on);
    };
    void check();
    const id = setInterval(() => { void check(); }, 20_000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  if (!on) return null;
  return <div role="status" className="bt-deploy-notice" style={{ background: "var(--amber, #ffb000)", color: "var(--amber-ink, #12100e)", padding: "8px 16px", fontSize: 14, textAlign: "center" }}>{DEPLOY_NOTICE_TEXT}</div>;
}
