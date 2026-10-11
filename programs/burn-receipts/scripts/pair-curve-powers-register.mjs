#!/usr/bin/env node
// THE POWERS REGISTER of pair_curve (2026-10-10) — every power anyone holds over a rivalry pair launched through the pair curve,
// generated from the program's IDL (src/lib/pairCurve/idl.ts) so it cannot drift from the code. Same rules as
// powers-register.mjs (burn_receipts): the generator FAILS if the IDL has an instruction or a signer account this file does not
// describe, or if this file describes one the IDL does not have. Output is deterministic.
//
//   node programs/burn-receipts/scripts/pair-curve-powers-register.mjs           # writes docs/burn-receipts/pair-curve-powers-register.{json,md}
//   node programs/burn-receipts/scripts/pair-curve-powers-register.mjs --check   # exits 1 if stale or undescribed
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(here, "..", "..", "..");
const idlTs = path.join(repo, "src", "lib", "pairCurve", "idl.ts");
const outDir = path.join(repo, "docs", "burn-receipts");
const idlText = fs.readFileSync(idlTs, "utf8");
const idl = JSON.parse(idlText.slice(idlText.indexOf("= {") + 2, idlText.lastIndexOf("};") + 1));

const ROLES = {
  anyone: "Anyone with a funded wallet. Pays only the transaction fee (and its own token account's rent when it buys for the first time); chooses no price.",
  trader: "Anyone, acting on their OWN wallet only: spends their own SOL or sells their own tokens, at the curve formula's price, within the slippage bound they set.",
  pair_creator: "The creator recorded in BOTH mints' burn_receipts TokenConfigs (initialize_token is mint-signed, so this is the launcher). Holds no power after init_pair; receives the rent of the accounts close_pair closes.",
};

const POWERS = {
  init_pair: {
    class: "creation",
    signers: { payer: "anyone", creator: "pair_creator" },
    can: "Create the ONE Pair of two fresh mints (zero supply, 6 decimals, no freeze authority, mint authority = the pair's SOL vault PDA) whose TokenConfigs are burn_receipts policy 2 with the same pinned LaunchLab platform and cpConfigId: fix the curve parameters, the combined target, the minimum side share and the deadline (all validated, never writable again); mint 1,000,000,000 of each coin into its token vault and revoke the mint authority; read the developer wallet from the pinned platform.",
    cannot: "Run twice for a pair or ever again on the same mints (they have no mint authority afterwards); be run by anyone but the recorded creator; choose the fee, its recipients, the AmmConfig or the burn pools; keep any token or any authority.",
    timelock: null, sunset: "Single use per pair.", funds: "Payer → the Pair, the two token vaults (rent) and the SOL vault's rent minimum.",
  },
  buy: {
    class: "permissionless",
    signers: { buyer: "trader" },
    can: "While Open and before the deadline: pay F(sold + t) − F(sold) plus the 100 bps fee for t tokens of one side (the largest t the budget affords, capped at the curve supply), all into the SOL vault — the fee is accounted there: 75 bps escrowed for that side's burn pool (paid when its pool exists, returned to its holders on a void), 25 bps accrued for the developer wallet (claim_developer_fee). The trade that leaves the pair ready (target, minimum share, both pools affordable at the current AmmConfig) commits it.",
    cannot: "Buy after the deadline, once committed, or after a void; pay any other account; move anyone else's funds; change the price formula; get tokens for 0 lamports.",
    timelock: null, sunset: "The deadline (or the commit).", funds: "Buyer → SOL vault (curve cost + fee); token vault → buyer (tokens).",
  },

  sell: {
    class: "permissionless",
    signers: { seller: "trader" },
    can: "While Open (also after the deadline): return t tokens of one side for F(sold) − F(sold − t) less the 100 bps fee (accounted in the vault like a buy's). After a void, or on a side refunded after a Raydium block: a pro-rata redemption at the snapshot (curve SOL + the escrowed burn share), no fee, the same rate whatever the order of exits.",
    cannot: "Sell once graduation is committed (except a refunding side); sell more than is outstanding; receive more than the formula or the pro-rata share; touch the other side's SOL.",
    timelock: null, sunset: "The commit.", funds: "Seller → token vault (tokens); SOL vault → seller (proceeds less fee, or the redemption).",
  },

  graduate: {
    class: "permissionless",
    signers: { cranker: "anyone" },
    can: "Once per side. The first call (combined raise ≥ target, each side ≥ its minimum share, before the deadline) commits the pair and closes both curves. Each call wraps that side's raise less CPMM's fee and rents, creates the side's Raydium CPMM pool at the pair_curve PDA [\"pool\", pair, [side]] with the vault as creator and the pinned AmmConfig, at the curve's last price, burns 100 % of the LP and every token the pool did not need, and sends rent refunds and dust to the side's burn pool.",
    cannot: "Graduate before the condition holds or after the deadline (first call); pick the amounts, the price, the pool address or the AmmConfig; keep any LP; send SOL anywhere but the pool, CPMM's fee/rents and the burn pool; leave the vault re-assigned or a vault token account delegated or close-authorised (re-checked after the CPI, hard errors).",
    timelock: null, sunset: "Once per side.", funds: "SOL vault → its WSOL account → the side's CPMM pool (and CPMM's create-pool fee + rents); token vault → the pool; LP → burned; leftover tokens → burned; residue → the side's burn pool.",
  },
  void_pair: {
    class: "permissionless",
    signers: { caller: "anyone" },
    can: "At or after the deadline, if never committed: mark the pair Voided and snapshot each side's redemption pool (curve SOL + escrowed burn share). Or, ≥ 3 days after the commit, if Raydium actually blocks the missing side's pool (creation disabled, or the fee leaves no liquidity): put that side alone into redemption.",
    cannot: "Void before the deadline, a committed pair (except the blocked side), or twice; refund a side because nobody cranked it; move any funds.",
    timelock: "The pair's deadline; 3 days after the commit for a blocked side.", sunset: "Single use per pair / side.", funds: "None.",
  },

  close_pair: {
    class: "permissionless",
    signers: { caller: "anyone" },
    can: "Voided pairs only, once no token of either coin circulates outside the vault (burned tokens count as gone): burn the returned supplies, pay the developer accrual, send the SOL vault's lamports above its rent minimum to the two burn pools, close the token vaults and the Pair with their rent to the recorded creator (to burn pool A if that address is executable).",
    cannot: "Close a committed or graduated pair (its Pair account is what burn_receipts' register_pair_pool reads); close while tokens circulate; send residue anywhere but the burn pools or rent anywhere but the creator (or burn pool A).",
    timelock: null, sunset: "Single use.", funds: "Developer accrual → developer wallet; SOL vault residue → burn pools; account rent → the creator.",
  },
  claim_developer_fee: {
    class: "permissionless",
    signers: { caller: "anyone" },
    can: "Pay the accrued 25 bps developer share to the developer wallet recorded at init (from the pinned Burnticker platform).",
    cannot: "Pay any other account; pay more than the accrual; run while the wallet cannot receive (executable, or below rent) — and its failure affects nothing else.",
    timelock: null, sunset: "None.", funds: "SOL vault → developer wallet (the accrual only).",
  },

};

const NON_POWERS = [
  "No admin, authority, owner or operator field exists in the program; no instruction takes a privileged signer after init_pair.",
  "No instruction updates a pair's parameters (virtual reserves, curve supply, target, minimum share, deadline, fee, fee recipients, AmmConfig) after init_pair.",
  "No withdraw, sweep or transfer-out instruction exists for the SOL vault or the token vaults. SOL leaves the vault only as a seller's formula proceeds, the fee legs (fixed recipients, formula amounts), the CPMM deposit at graduation (formula amounts, LP burned in the same instruction) and residue to the burn pools.",
  "No pause or freeze exists. Buys end at the deadline; nothing can stop sells on an open or voided pair.",
  "No mint authority survives init_pair and no freeze authority ever exists; the program never mints after init.",
  "The pair program holds the 75 bps burn share only in escrow: it reaches the side's burn_receipts fee PDA when the pool is created, or goes back to that side's holders on a void.",
  "No trade credits any account but the SOL vault and the trader: the developer's 25 bps accrue in the vault (claim_developer_fee) and the 75 bps burn share is escrowed there until the side's pool exists — so neither the developer wallet nor a burn pool can block a trade or an exit.",
  "The developer wallet is the claim wallet of the ONE LaunchLab platform compiled into the build (BURNTICKER_PLATFORM); a creator cannot route the 25 bps elsewhere.",
  "A committed or graduated pair is never closed, so burn_receipts can always register its pools.",
];

const UPGRADE = {
  power: "Program upgrade authority (BPF Upgradeable Loader) — outside the IDL, the one power above all of this.",
  holder_at_launch: "The same Squads v4 2-of-3 multisig vault and time lock as burn_receipts (docs/burnticker/runbook.md \"Pair program gates\").",
  sunset: "Set to none (`solana program set-upgrade-authority <PROGRAM_ID> --final`, through the multisig) on the same finalisation plan as burn_receipts.",
};

const EXTERNAL = [
  {
    power: "Raydium CPMM admin (outside the program)",
    holder: "Raydium",
    can: "Change the pinned AmmConfig's create-pool fee or disable pool creation on it; upgrade the CPMM program.",
    effect: "Before the first graduate: graduation can fail (InsufficientPoolSol / CPMM refusal) and the pair voids at its deadline — every holder can sell back. Between the two sides: the second side waits; after 3 days its holders may sell back on its curve. A hostile CPMM upgrade cannot re-assign the vault or its token accounts or take more than the pool costs (post-CPI checks; tests/lifecycle.rs with mocks/evil_cpmm_init).",
  },
  {
    power: "LaunchLab platform admin (outside the program)",
    holder: "the key that created the pinned LaunchLab platform",
    can: "Change platformClaimFeeWallet and cpConfigId on the platform.",
    effect: "None on an existing pair: init_pair copies the developer wallet and the cpConfigId (from the TokenConfigs' pins) into the Pair.",
  },
];

const problems = [];
const idlNames = idl.instructions.map((i) => i.name).sort();
for (const n of idlNames) if (!POWERS[n]) problems.push(`IDL instruction ${n} is not described in the register`);
for (const n of Object.keys(POWERS)) if (!idlNames.includes(n)) problems.push(`register describes ${n}, which the IDL does not have`);
for (const ix of idl.instructions) {
  const p = POWERS[ix.name];
  if (!p) continue;
  const signers = ix.accounts.filter((a) => a.signer).map((a) => a.name).sort();
  const listed = Object.keys(p.signers).sort();
  if (JSON.stringify(signers) !== JSON.stringify(listed)) problems.push(`${ix.name}: IDL signers [${signers}] ≠ register signers [${listed}]`);
  for (const role of Object.values(p.signers)) if (!ROLES[role]) problems.push(`${ix.name}: unknown role ${role}`);
}
if (problems.length) {
  console.error(`pair_curve powers register out of date:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

const register = {
  schema: "pair-curve.powers-register/v1",
  program: { name: idl.metadata.name, version: idl.metadata.version, address_in_idl: idl.address, idl_sha256: crypto.createHash("sha256").update(JSON.stringify(idl)).digest("hex") },
  roles: ROLES,
  instructions: idl.instructions.map((ix) => {
    const p = POWERS[ix.name];
    return { name: ix.name, class: p.class, signers: ix.accounts.filter((a) => a.signer).map((a) => ({ account: a.name, role: p.signers[a.name] })), can: p.can, cannot: p.cannot, timelock: p.timelock, sunset: p.sunset, funds: p.funds };
  }),
  privileged_powers: idl.instructions.filter((ix) => POWERS[ix.name].class === "privileged").map((ix) => ix.name),
  powers_over_funds: "none",
  non_powers: NON_POWERS,
  upgrade_authority: UPGRADE,
  external_powers: EXTERNAL,
};
const json = JSON.stringify(register, null, 2) + "\n";
const esc = (s) => String(s ?? "—").replace(/\|/g, "\\|");
let md = "# Powers Register — pair_curve\n\n";
md += "GENERATED by `programs/burn-receipts/scripts/pair-curve-powers-register.mjs` from the program's IDL — do not edit by hand. Machine-readable twin: `pair-curve-powers-register.json`. Design: `docs/burnticker/PAIR-CURVE.md`.\n\n";
md += `Program \`${idl.metadata.name}\` v${idl.metadata.version}; program id \`${idl.address}\`; IDL sha256 \`${register.program.idl_sha256.slice(0, 16)}…\`.\n\n`;
md += `## Privileged powers\n\n**${register.privileged_powers.length}.** No instruction needs a privileged signer after \`init_pair\`; there are **no powers over funds**. Every instruction after creation is permissionless and moves money only by formula to fixed recipients.\n\n`;
md += "## Every instruction\n\n| Instruction | Class | Signers (role) | Can | Cannot | Timelock | Sunset | Funds |\n|---|---|---|---|---|---|---|---|\n";
for (const i of register.instructions) md += `| \`${i.name}\` | ${i.class} | ${i.signers.map((s) => `${s.account} (${s.role})`).join(", ")} | ${esc(i.can)} | ${esc(i.cannot)} | ${esc(i.timelock)} | ${esc(i.sunset)} | ${esc(i.funds)} |\n`;
md += "\n## Roles\n\n";
for (const [k, v] of Object.entries(ROLES)) md += `- **${k}** — ${v}\n`;
md += "\n## What does not exist\n\n";
for (const n of NON_POWERS) md += `- ${n}\n`;
md += "\n## Program upgrade authority\n\n";
for (const [k, v] of Object.entries(UPGRADE)) md += `- **${k}** — ${v}\n`;
md += "\n## Powers outside the program that it depends on\n\n";
for (const e of EXTERNAL) md += `- **${e.power}** — holder: ${e.holder}. Can: ${e.can} Effect here: ${e.effect}\n`;

const jsonPath = path.join(outDir, "pair-curve-powers-register.json");
const mdPath = path.join(outDir, "pair-curve-powers-register.md");
if (process.argv.includes("--check")) {
  const stale = [];
  if (!fs.existsSync(jsonPath) || fs.readFileSync(jsonPath, "utf8") !== json) stale.push(path.relative(repo, jsonPath));
  if (!fs.existsSync(mdPath) || fs.readFileSync(mdPath, "utf8") !== md) stale.push(path.relative(repo, mdPath));
  if (stale.length) {
    console.error(`stale: ${stale.join(", ")} — run node programs/burn-receipts/scripts/pair-curve-powers-register.mjs`);
    process.exit(1);
  }
  console.log("pair_curve powers register up to date");
} else {
  fs.writeFileSync(jsonPath, json);
  fs.writeFileSync(mdPath, md);
  console.log(`wrote ${path.relative(repo, jsonPath)} and ${path.relative(repo, mdPath)}`);
}
