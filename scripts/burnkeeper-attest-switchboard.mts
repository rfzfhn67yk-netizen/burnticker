// SWITCHBOARD ON-DEMAND ATTESTER TOOLING (2026-10-09). No key is ever printed; nothing is sent without --send and a --payer file.
//
//   R() { node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnkeeper-attest-switchboard.mts "$@"; }   (a function: zsh does not split $R)
//   R job                                   the $DEFICIT job JSON, its sha256, the feed hash on each cluster, the v2 quote account (offline)
//   R create-feed --cluster devnet          DRY RUN (default): the job, hashes and the PullFeed pubkey that WOULD be created; nothing sent
//   R create-feed --cluster devnet --send --payer <keypair.json> [--rpc=<url>]
//                                            stores the job on Crossbar, creates a classic PullFeed (initIx) — needs the oracle network
//   R pull --feed <pubkey> [--cluster devnet] [--rpc=<url>] [--signatures 3]
//                                            fetches a signed update from the gateways: value, slot, per-oracle responses (nothing sent)
//   R verify --feed <pubkey> --expect <value> [--tolerance-bps 0] [--max-age-min 1440] [--max-staleness-slots N] [--rpc=<url>]
//                                            reads the account over RPC and judges staleness + agreement; exit 0 agree, 2 disagree
//   R simulate                              asks Crossbar to run the job once (no chain)
//
// STATUS 2026-10-09: Switchboard shut its oracle network on 2026-09-25 (see attesters/switchboard.ts). `job` and `verify` work
// (offline / RPC only); `create-feed --send`, `pull` and `simulate` need Crossbar + gateways and fail until someone runs that stack.

import fs from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { attestedFromPullFeed, canonicalQuotePubkey, feedHashFor, jobHash, readSwitchboardFeed, SWITCHBOARD, SWITCHBOARD_VERSIONS, treasuryDebtJob, TREASURY_DEBT_JOB_SPEC, type SbCluster } from "../src/lib/burnKeeper/attesters/switchboard.ts";
import { compareAttested, decimalToCents } from "../src/lib/burnKeeper/attesters/types.ts";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (n: string): string | undefined => { const i = args.indexOf(`--${n}`); if (i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1]; return args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3); };
const flag = (n: string) => args.includes(`--${n}`);
const cluster = ((opt("cluster") ?? "devnet") as SbCluster);
if (!(cluster in SWITCHBOARD) || cluster === ("quoteProgram" as never) || cluster === ("decimals" as never)) { console.error(`--cluster must be devnet or mainnet-beta`); process.exit(1); }
const rpcUrl = opt("rpc") ?? (cluster === "devnet" ? "https://api.devnet.solana.com" : "https://api.mainnet-beta.solana.com");
const out = (o: unknown) => console.log(JSON.stringify(o, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

async function jobReport() {
  const job = treasuryDebtJob();
  const h = await jobHash(job);
  const fh = { devnet: await feedHashFor(SWITCHBOARD.devnet.queue, [job]), "mainnet-beta": await feedHashFor(SWITCHBOARD["mainnet-beta"].queue, [job]) };
  return { sdk: SWITCHBOARD_VERSIONS, spec: TREASURY_DEBT_JOB_SPEC, job, jobSha256: h, feedHash: fh, quoteAccountV2: { devnet: await canonicalQuotePubkey(SWITCHBOARD.devnet.queue, fh.devnet), "mainnet-beta": await canonicalQuotePubkey(SWITCHBOARD["mainnet-beta"].queue, fh["mainnet-beta"]) }, programs: SWITCHBOARD };
}

try {
  if (cmd === "job") { out(await jobReport()); process.exit(0); }

  if (cmd === "create-feed") {
    const rep = await jobReport();
    const feedKp = Keypair.generate();   // only the pubkey leaves this process unless --send writes the account
    const plan = { dryRun: !flag("send"), cluster, rpcUrl, queue: SWITCHBOARD[cluster].queue, programId: SWITCHBOARD[cluster].programId, feedHash: rep.feedHash[cluster], jobSha256: rep.jobSha256,
      classicPullFeed: { pubkey: feedKp.publicKey.toBase58(), config: { name: "DEFICIT treasury.debt_to_penny", maxVariance: 0, minResponses: 1, minSampleSize: 1, maxStaleness: 1_000 } },
      managedQuoteAccountV2: rep.quoteAccountV2[cluster], note: "Switchboard's oracle network stopped 2026-09-25; --send needs Crossbar (store) and gateways (updates) that no longer answer." };
    if (!flag("send")) { out(plan); process.exit(0); }
    const payerPath = opt("payer"); if (!payerPath) throw new Error("--send needs --payer <keypair.json>");
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(payerPath, "utf8")) as number[]));
    if (cluster === "mainnet-beta" && process.env.BURNKEEPER_MAINNET !== "1") throw new Error("mainnet needs BURNKEEPER_MAINNET=1");
    const sb = await import("@switchboard-xyz/on-demand"); const common = await import("@switchboard-xyz/common");
    const connection = new Connection(rpcUrl, "confirmed");
    const program = await sb.AnchorUtils.loadProgramFromConnection(connection, undefined, new PublicKey(SWITCHBOARD[cluster].programId));
    const crossbar = common.CrossbarClient.default();
    // The pinned @switchboard-xyz/common 5.8.5 exposes storeOracleFeed (a v2 feed id), not the older store(queue, jobs). The network
    // is down (2026-09-25), so this path cannot be exercised; it fails closed: any id that is not the locally computed hash refuses.
    const stored = await crossbar.storeOracleFeed({ name: plan.classicPullFeed.config.name, jobs: [common.OracleJob.fromObject(rep.job)] });
    const feedHash = stored.feedId;
    if (feedHash.replace(/^0x/, "") !== rep.feedHash[cluster]) throw new Error(`Crossbar's feed hash ${feedHash} ≠ the local ${rep.feedHash[cluster]} — refused`);
    const pullFeed = new sb.PullFeed(program, feedKp.publicKey);
    const ix = await pullFeed.initIx({ name: plan.classicPullFeed.config.name, queue: new PublicKey(SWITCHBOARD[cluster].queue), feedHash: Buffer.from(rep.feedHash[cluster], "hex"), maxVariance: 0, minResponses: 1, minSampleSize: 1, maxStaleness: 1_000, payer: payer.publicKey });
    const tx = await sb.asV0Tx({ connection, ixs: [ix], payer: payer.publicKey, signers: [payer, feedKp] });
    const sig = await connection.sendTransaction(tx, { preflightCommitment: "processed" });
    out({ ...plan, dryRun: false, sent: { signature: sig, explorer: `https://explorer.solana.com/tx/${sig}?cluster=${cluster === "devnet" ? "devnet" : "mainnet-beta"}` } });
    process.exit(0);
  }

  if (cmd === "pull") {
    const feed = opt("feed"); if (!feed) throw new Error("--feed <pubkey>");
    const sb = await import("@switchboard-xyz/on-demand"); const common = await import("@switchboard-xyz/common");
    const connection = new Connection(rpcUrl, "confirmed");
    const program = await sb.AnchorUtils.loadProgramFromConnection(connection, undefined, new PublicKey(SWITCHBOARD[cluster].programId));
    const pullFeed = new sb.PullFeed(program, new PublicKey(feed));
    const [ixs, responses, numSuccess, , errors] = await pullFeed.fetchUpdateIx({ crossbarClient: common.CrossbarClient.default(), numSignatures: Number(opt("signatures") ?? 3) });
    out({ feed, numSuccess, instructions: ixs?.length ?? 0, errors, responses: responses.map((r) => ({ oracle: r.oracle.pubkey.toBase58(), value: r.value?.toString() ?? null, error: r.error || null })) });
    process.exit(0);
  }

  if (cmd === "verify") {
    const feed = opt("feed"), expect = opt("expect");
    if (!feed || !expect) throw new Error("--feed <pubkey> --expect <value>");
    const cents = decimalToCents(expect); if (cents === null) throw new Error("--expect must be a dollar amount with at most two decimals");
    const connection = new Connection(rpcUrl, "confirmed");
    const a = await readSwitchboardFeed(connection, feed, SWITCHBOARD[cluster].programId);
    const nowSlot = await connection.getSlot("confirmed");
    const r = compareAttested(cents, a, { toleranceBps: Number(opt("tolerance-bps") ?? 0), maxAgeMs: Number(opt("max-age-min") ?? 1440) * 60_000, maxStalenessSlots: opt("max-staleness-slots") ? Number(opt("max-staleness-slots")) : null, nowSlot, now: Date.now() });
    out({ feed, expect, nowSlot, attested: a, agreement: r });
    process.exit(r.ok ? 0 : 2);
  }

  if (cmd === "simulate") {
    const common = await import("@switchboard-xyz/common");
    const res = await common.CrossbarClient.default().simulateJobs({ jobs: [common.OracleJob.fromObject(treasuryDebtJob())], includeReceipts: false } as never);
    out(res); process.exit(0);
  }

  if (cmd === "decode-fixture") {   // offline check of the account → attestation conversion on a JSON dump (tests use the same function)
    const d = JSON.parse(fs.readFileSync(opt("file")!, "utf8"));
    out(attestedFromPullFeed(opt("feed") ?? "fixture", d)); process.exit(0);
  }

  console.error("usage: see the header of scripts/burnkeeper-attest-switchboard.mts"); process.exit(1);
} catch (e) {
  console.error(`error: ${(e as Error).message}`);
  process.exit(1);
}
