import Link from "next/link";
import { CREATOR_LAUNCHES_CLOSED } from "@/lib/burnticker/creatorLaunches";
import { closedNetworkLine, type LaunchGateState } from "@/lib/burnticker/launchGateState";
import { EXPLORE_VERIFIED_BURN } from "@/lib/burnticker/currentStatusLinks";
import { EmptyState } from "../_components/EmptyState";

/**
 * Everything the launch page shows while the wizard may not render (launchGateState.ts): a neutral skeleton until the catalogue
 * answers, the closed page (the refusal sentence, the network this host shows, and the pre-launch action — explore a real, verified
 * devnet burn), or "data unavailable" with the diagnostics behind a disclosure. No search box, tile, review card or wallet button.
 */
export function LaunchGate({ state, deficitHref, noWalletLine }: { state: Exclude<LaunchGateState, { kind: "open" }>; deficitHref: string; noWalletLine?: string }) {
  if (state.kind === "loading") return (
    <main className="mx-auto max-w-4xl px-4 py-6 space-y-3" data-launch-gate="loading">
      <h1 className="text-2xl font-semibold">Launch a coin</h1>
      <EmptyState kind="loading" body="Checking whether creator launches are open on this host." />
    </main>
  );
  if (state.kind === "unavailable") return (
    <main className="mx-auto max-w-4xl px-4 py-6 space-y-3" data-launch-gate="unavailable">
      <h1 className="text-2xl font-semibold">Launch a coin</h1>
      <EmptyState kind="unavailable" body="Whether creator launches are open could not be read, so no launch controls are shown." details={state.detail} />
      <p className="text-sm"><Link className="underline" href={EXPLORE_VERIFIED_BURN.href}>{EXPLORE_VERIFIED_BURN.label}</Link> · <Link className="underline" href="/burnticker">All coins</Link></p>
    </main>
  );
  const net = closedNetworkLine(state.cluster);
  return (
    <main className="mx-auto max-w-4xl px-4 py-6 space-y-3" data-launch-gate="closed">
      <h1 className="text-2xl font-semibold">Launch a coin</h1>
      <p className="text-neutral-200" data-launches-closed>{CREATOR_LAUNCHES_CLOSED}{net ? ` ${net}` : ""}</p>
      <p><Link className="inline-block rounded bg-amber-400 px-4 py-2 font-semibold text-neutral-950" href={EXPLORE_VERIFIED_BURN.href} data-primary-action>{EXPLORE_VERIFIED_BURN.label}</Link></p>
      <p className="text-sm text-neutral-400">{EXPLORE_VERIFIED_BURN.blurb}</p>
      <p className="text-sm"><a className="underline" href={deficitHref}>$DEFICIT</a> · <Link className="underline" href="/burnticker">Burnticker</Link> · <Link className="underline" href="/burnticker/trust">Current status</Link>{noWalletLine ? ` · ${noWalletLine}` : ""}</p>
    </main>
  );
}
