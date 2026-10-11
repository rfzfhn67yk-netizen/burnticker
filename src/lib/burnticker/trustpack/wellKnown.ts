import { loadOperator, type Cluster } from "@/lib/burnticker/trustpack/operator";
import { loadVerifiedBuild } from "@/lib/burnticker/trustpack/verifiedBuild";
import { loadTransparency } from "@/lib/burnticker/trust";

/**
 * /.well-known/burnticker.json (trust pack, 2026-10-10): one machine-readable file that ties the site, the repository, the X accounts,
 * the program ids, the Squads vault and the operator wallets together, so a wallet, an explorer or a sceptic can check that they
 * belong to each other. Generated from config/burnticker/operator.json, the verified-build table and transparency.json by
 * `scripts/burnticker-trustpack.mts well-known --write` into BOTH public/.well-known/ (the Next app) and site/burnticker/.well-known/
 * (what Caddy serves at https://burnticker.com/.well-known/burnticker.json); the test holds both equal to this function's output.
 * Placeholders stay TODO_… strings, never blanks.
 */

export const WELL_KNOWN_PATHS = ["public/.well-known/burnticker.json", "site/burnticker/.well-known/burnticker.json"] as const;

export function buildWellKnown(root = process.cwd()): Record<string, unknown> {
  const op = loadOperator(root), vb = loadVerifiedBuild(root), t = loadTransparency(root);
  const cluster = (c: Cluster) => {
    const cl = op.clusters[c];
    return {
      status: cl.status,
      programs: Object.fromEntries(vb.programs.map((p) => [p.library, { programId: p.programId, deployed: !!p.deployed[c], executableHash: p.deployed[c]?.hash ?? null, buildHash: p.builds[c].hash, upgradeAuthority: p.deployed[c]?.upgradeAuthority ?? cl.squads.vault }])),
      launchlabPlatform: cl.launchlabPlatform,
      squads: { vault: cl.squads.vault, multisig: cl.squads.multisig, threshold: cl.squads.threshold, timeLock: cl.squads.timeLock },
      wallets: Object.fromEntries(cl.wallets.map((w) => [w.role, w.pubkey])),
    };
  };
  return {
    schema: "burnticker.well-known/v1",
    name: "Burnticker",
    updatedAt: op.updatedAt,
    operator: { name: op.operator.name, state: op.operator.state, country: op.operator.country, contact: op.operator.contact, security: op.operator.security, entity: op.operator.entity },
    links: { site: op.links.site, app: op.links.app, deficitSite: op.links.deficitSite, github: op.links.github, githubOrg: op.links.githubOrg, x: op.links.x },
    clusters: { devnet: cluster("devnet"), mainnet: cluster("mainnet") },
    security: { policy: `${op.links.github}/blob/main/SECURITY.md`, contact: op.operator.security, bountyWallet: t.howBuilt.bounty.wallet ?? "TODO_BOUNTY_WALLET", firmAudit: false },
    trust: {
      trustPage: `${op.links.app}/trust`, check: `${op.links.app}/check`, feeLedger: `${op.links.app}/fees/ledger`, operator: `${op.links.app}/operator`,
      verifiedBuild: `${op.links.github}/blob/main/docs/burnticker/VERIFIED-BUILD.md`, verifiedBuildKind: vb.kind, sourceCommit: vb.sourceCommit,
      powersRegisters: [`${op.links.github}/blob/main/docs/burn-receipts/powers-register.md`, `${op.links.github}/blob/main/docs/burn-receipts/pair-curve-powers-register.md`],
      api: `${op.links.app.replace(/\/burnticker$/, "")}/api/burnticker/v1/openapi.json`,
    },
  };
}

export const wellKnownText = (root = process.cwd()): string => `${JSON.stringify(buildWellKnown(root), null, 2)}\n`;
