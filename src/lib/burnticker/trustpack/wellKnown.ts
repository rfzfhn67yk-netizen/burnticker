import { loadOperator, TODO_RE, type Cluster } from "@/lib/burnticker/trustpack/operator";
import { loadVerifiedBuild } from "@/lib/burnticker/trustpack/verifiedBuild";
import { loadTransparency } from "@/lib/burnticker/trust";
import { lpLockPolicyJson } from "@/lib/burnticker/lockFees";

/**
 * /.well-known/burnticker.json (trust pack, 2026-10-10): one machine-readable file that ties the site, the repository, the X accounts,
 * the program ids, the Squads vault and the operator wallets together, so a wallet, an explorer or a sceptic can check that they
 * belong to each other. Since 2026-10-10 each cluster also names its LP lock (LP locked forever; its fees fund the burn). Generated from config/burnticker/operator.json, the verified-build table and transparency.json by
 * `scripts/burnticker-trustpack.mts well-known --write` into BOTH public/.well-known/ (the Next app) and site/burnticker/.well-known/
 * (what Caddy serves at https://burnticker.com/.well-known/burnticker.json); the test holds both equal to this function's output.
 * Placeholders stay TODO_… strings in config/burnticker/operator.json (the owner fills them; the operator page says each in words). I-1
 * (audit 2026-10-19): this public file states an unset value as null with a sentence saying why, never the raw TODO_ marker.
 */
const unset = (v: string | null | undefined): string | null => (v && TODO_RE.test(v) ? null : v ?? null);

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
      // LP locked forever (owner decision 2026-10-10): the lock program, the Fee Key owner (burn_receipts ["fee_keys"]), the operator
      // treasury compiled into the program (null = not pinned: claims refuse TreasuryNotPinned) and the compiled 80/20 split. Each coin's
      // own Fee Key and claims: GET /api/burnticker/v1/tokens/{ticker} → status.lp.
      lpLock: (({ urls: _urls, ...rest }) => rest)(lpLockPolicyJson(c, vb.programs.find((p) => p.library === "burn_receipts")?.programId ?? null)),
    };
  };
  return {
    schema: "burnticker.well-known/v1",
    name: "Burnticker",
    updatedAt: op.updatedAt,
    operator: { name: op.operator.name, state: op.operator.state, country: op.operator.country, contact: op.operator.contact, security: op.operator.security, entity: unset(op.operator.entity), ...(unset(op.operator.entity) === null ? { entityPending: op.operator.entityPending ?? "No legal entity has been formed." } : {}) },
    links: { site: op.links.site, app: op.links.app, deficitSite: op.links.deficitSite, github: op.links.github, githubOrg: unset(op.links.githubOrg), x: op.links.x },
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
