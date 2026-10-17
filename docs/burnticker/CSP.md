# Content-Security-Policy

The app's pages send a Content-Security-Policy in report-only mode. It blocks nothing. A browser that sees a page do something the
policy would block posts a report to `/api/burnticker/csp-report`, and the server adds one to a counter for that report's directive.
Nothing else from a report is kept: no address, no page address, no blocked address.

- The policy: `src/lib/burnticker/csp.ts` (`APP_CSP_DIRECTIVES`, `appCsp`).
- Where it is sent: `config/public-repo/overlay/next.config.ts` `headers()`, on `/`, `/burnticker` and every `/burnticker/...` page except
  `/burnticker/embed/...` (the embeds send their own policy, `src/lib/burnticker/embed.ts`).
- The static pages Caddy serves (the home, status, fallback) get the static policy from `deploy/caddy/csp-and-cache.proposed.caddy`.
- `BURNTICKER_PUBLIC_RPC_ORIGIN` on the host adds the host's own RPC origin to `connect-src`.
- The test: `test/burntickerSitePolish.test.ts` pins the header on `/` and `/burnticker/launch` and checks the directives.

## Reading the counts

The route logs one line at most once a minute while reports come in:

```
[csp-report] counts since start: script-src-elem=3 connect-src=1
```

`journalctl -u mct-burnticker-web | grep csp-report` on the host shows them. The counters start again when the app restarts.

## Switching to enforcing

1. Leave report-only on for at least a week of normal traffic, including a launch, a wallet connect and a receipt check on mainnet.
2. Read the counts. For each directive with reports, find the origin the page really needs (the browser console on that page shows
   the blocked address) and add it to `APP_CSP_DIRECTIVES`, or remove the page's use of it. Ship, and watch the counts for another day.
3. When the counts stay at zero for normal use, change the header name in `next.config.ts` from `Content-Security-Policy-Report-Only`
   to `Content-Security-Policy`. Keep `report-uri` and `report-to`, so a page that breaks later still reports.
4. Check by hand after the deploy: the home page, a coin page, the launch page up to the wallet prompt, the check page's receipt
   verifier, and the trust page. Each should load with no CSP error in the console.
5. To roll back, put the header name back to `Content-Security-Policy-Report-Only` and redeploy.

`'unsafe-inline'` stays in `script-src` until the inline scripts (Next's bootstrap and the theme boot) carry a nonce or a hash. That is a
separate change.
