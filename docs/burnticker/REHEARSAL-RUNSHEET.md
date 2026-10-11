# $DEFICIT run-sheet: devnet rehearsal, mainnet rehearsal coin, launch day

Written 2026-10-10 on branch `agent/RUNSHEET-2026-10-10` (base `a96f845`). One ordered list for the owner and Claude to work
through in one sitting. It replaces reading five docs, but it does not replace them as the record. Nothing in this file has been run. Every
command was checked against the scripts at `a96f845`. The flags that could not be checked are listed in §E.

**Precedence.** Where the docs disagree, this sheet follows the newest code and says so in a "⚠ differs from" note. All of those notes are
collected in §F. Sources: `docs/burnkeeper/{devnet-run,README-execution,fees}.md`, `docs/burn-receipts/{README,CHANGELOG}.md`,
`docs/burnticker/{runbook,deploy}.md`, `scripts/{burnkeeper-launch,burn-keeper,burnticker-keeper,burnticker-platform-config}.mts`,
`scripts/burnkeeper-keygen.mjs`, `scripts/ops/provision-burnticker-host.sh`, `src/lib/burnKeeper/burnPool.ts`,
`src/lib/burnReceipts/crank.ts`, and `LAUNCHPAD-PATH.md` §15–§19 (mct-runner-study/launch-debt-egg-2026-10-09).

**Conventions**

- **WHO.** *owner* means the owner's hands: real keys, a hardware wallet, a mainnet send, a browser wallet, a public post. *Claude* means Claude
  runs it or stages it, with devnet throwaway keys or read-only commands. *either* means whoever is at the keyboard.
- **Times** are America/Denver. Treasury posts the Debt to the Penny figure at about 14:00 Denver. The keeper polls at 16:30 and 20:00
  America/New_York, which is 14:30 and 18:00 Denver all year (the two zones change clocks together).
- `<ANGLE_BRACKETS>` are values you paste in. Never paste a secret key or passphrase into a command line, a file in the repo, or a chat.
- **Every send gets a dry run first.** For mainnet sends, `BURNKEEPER_MAINNET=1` goes on the same line as the send and nowhere else.
- **zsh on the Mac does not split `$R`.** This sheet, the runbook and devnet-run.md all define `R` as a shell **function**, which works in
  zsh and bash. The docs used `R="node …"; $R …` until 2026-10-10.
- **The Mac's Solana CLI points at mainnet by default** (`solana config get` prints `https://api.mainnet-beta.solana.com`). Every
  `solana` command below passes `--url`. Do not run `solana config set`.
- **One command per block.** A block made of `&&`-chained commands is still one paste.

---

## Decisions to settle before step A1

These are blocking. Each one comes from a contradiction between the docs and the code, or between a gate and what the chain allows.
The sheet assumes the **default** shown in each row. Change it in the row if you choose differently.

| # | Question | Why it blocks | Default this sheet assumes |
|---|---|---|---|
| D-1 | **When to finalise the program** (upgrade authority set to none). | README §5.3 (review-2 F16, 2026-10-10) says no mainnet launch announcement until `Authority: none` and the verified hash. The 10-09 runbook (gate 12, launch step 2) and LAUNCHPAD §17.2 say Squads holds the upgrade authority at launch and gives it up after review. §5.3 also says to "crank one real reading on this cluster first" to prove the compiled CPMM and LaunchLab ids. A mainnet `crank_buyback` needs a **graduated** mainnet pool, which neither the rehearsal coin (B) nor a fresh $DEFICIT has. If the program is finalised with a wrong mainnet CPMM id, no buyback can ever run, and the fee PDA's SOL is stuck for good. | Launch with the **Squads 2-of-3 + 48 h** vault as upgrade authority. The trust page states it plainly. Finalise (C16) after the first mainnet `crank_buyback` burns. This **departs from F16**, so the owner must choose it on purpose. The other option is to finalise before launch on the strength of a static check of the compiled ids plus the devnet run. That is not safe enough on its own (see C16). |
| D-2 | **What gate 2 can prove.** | Gate 2 asks for "a `confirmed` burn" on $REHEARSAL at about 0.1 SOL. A mainnet LaunchLab curve needs at least 24 SOL of buys to graduate (`minFundRaisingB`; the standard is 85). Before graduation there is no CPMM pool, so `register_pool` and `crank_buyback` cannot run. A 0.1 SOL coin can never burn. | Gate 2 is amended: platform dials live, creator = fee PDA, curve fees accrue 50/25 bps, `claim_launchlab_creator_fee` lands against **mainnet** LaunchLab, and the keeper attests on mainnet with the status page showing "waiting for the CPMM pool". The swap and burn are proven on devnet only (gate 1). Paying ~24 SOL of your own buys to force graduation is possible but not recommended. |
| D-3 | **Who is the LaunchLab platform admin.** | `burnkeeper-launch.mts platform --admin` loads a key **file** (`loadKey`, which uses keyfile.ts and cannot use `usb://ledger`). This admin can change the developer fee (0–500 bps), the claim wallet and the LP split at any time, with **no timelock** on chain. trust.ts already lists it as a plain key with the sunset "transfer to a multisig before P3". LAUNCHPAD §17.2 wants it behind the timelocked multisig. | The admin is a dedicated encrypted file key on the Mac (`$M/platform-admin.enc.json`), disclosed on the trust page as an untimelocked power. Moving it behind Squads would mean building `create_platform_config` as a Squads vault transaction, which no tool here does. |
| D-4 | **The text of the rules file before it is hashed.** | The sha is taken over the exact bytes. Three fields in `config/burnkeeper/deficit.rules.json` are stale: `fractionPerUnitDecision` still says "OWNER DECISION PENDING" (decided on 10-09: 1%); `statement` says "the keeper spends … and burns every token it receives in the next transaction" (under program execution the **program** swaps and burns in one instruction); `"router": "jupiter"` (the program swaps on the CPMM pool). | Fix all three wording issues **once**, in a reviewed commit, before step C2. Mirror the same edits in the devnet and rehearsal copies so all three rehearse the final text. |
| D-5 | **`floor_lamports`** (immutable once `initialize_token` runs). | The rule file says a $1 floor, in USD. On chain the floor is lamports and must be > 0 (F7). | Devnet: `1000000` (0.001 SOL). Mainnet: `round(1e9 / <SOL price in USD on the day>)`, about $1. |
| D-6 | **Run `initialize_platform`, or keep the built-in default?** | Without a PlatformConfig the program applies a 25 SOL cap until 2027-10-01T00:00Z, with no authority at all (review M-1). Creating one adds a raise-only, 48 h authority (the Squads vault) and can set an earlier sunset. It must run while the deployer is still the upgrade authority. | **Skip it** (fewer powers). The default cap matches the 25 SOL decision. Steps A6 and B6 are marked optional. |
| D-7 | **The same program id on devnet and mainnet?** | README §5.1 creates the "REAL program id" key but does not say per cluster. One id means one `anchor keys sync` and one committed `declare_id!`. The devnet build (`--features devnet`) and the mainnet build still differ in their compiled cluster constants. | **One id** for both clusters. The keypair lives at `$M/burn_receipts-program.json` and never goes to the VPS. |
| D-8 | **What happens to $REHEARSAL afterwards?** | Nothing can retire a TokenConfig. If the keeper stops attesting, readings stop, nothing more is burned, and the fee PDA's SOL stays put. Each reading costs the keeper about 0.0021 SOL of rent (294-byte account), roughly 0.55 SOL a year. | Keep attesting for 14 days, then decide. Whichever you choose, write it on the trust page. |

**Status 2026-10-10:** D-4's three wording fixes are applied to `config/burnkeeper/deficit.rules.json`, giving sha `0b4d09946e22…` before
the mint is written in. The row stays so the owner rereads the final text before hashing.

Smaller items that must be done before launch (not blocking the devnet run): `OPERATOR_LINE` in `src/lib/burnticker/fees.ts` still says
`TODO_CONTACT_ADDRESS` (LAUNCHPAD §18 "operator line + contact"). The platform CLI used to default `--web`/`--img` to `burnticker.com`. Since 2026-10-10
both flags are **required** for `--send` (steps A10 and B9 pass them), because the values are written on chain. The bug bounty
(5–10 SOL) and both review reports must be published (LAUNCHPAD §19).

---

## 0. Prerequisites

### 0.1 Wallets and SOL

These SOL amounts are working budgets. They include fees and a margin. Rent figures come from `solana rent <bytes>` on 2026-10-10: the
program is 617,000 B, about 3.135 SOL, and `solana program deploy` sizes it to the program's length by default. A TokenConfig is 863 B,
about 0.005 SOL. A Reading is 294 B, about 0.0021 SOL. A token account is 165 B, about 0.0015 SOL.

| Wallet | Purpose | Where it is made and kept | Format | Devnet SOL | Mainnet SOL |
|---|---|---|---|---|---|
| Ops payer (the "launch wallet") | Pays platform config, `initialize_token` (config rent + 0.02 SOL reserve into the fee PDA), LaunchLab create (rent ≈ 0.03 + fees), the seed, the rehearsal buy, claims | Mac, `$D/payer.json` / `$M/ops-payer.json`, mode 600 | plain `solana-keygen` JSON (the `solana transfer` CLI cannot read `.enc.json`) | 3 | 4.5 (3 seed + 0.1 rehearsal buy + rent and fees + margin) |
| Deployer | Deploys the program. While it is upgrade authority it can also sign `initialize_platform` | Mac, `$D/deployer.json` / `$M/deployer.json` | plain JSON | 7 | 7 (≈3.14 stays as program rent; the ≈3.14 deploy buffer comes back). **Drained to ≈ 0 after B8** (gate 12) |
| Program id key | The program's address only | Mac, `$M/burn_receipts-program.json`, copied into `programs/burn-receipts/target/deploy/` | plain JSON | 0 | 0 |
| $DEFICIT keeper key | The TokenConfig's only attester (quorum 1) and the fee payer for `submit_reading`, claims and cranks. Holds no token funds | **devnet:** Mac throwaway `$D/keeper.json`. **mainnet:** generated **on the Burnticker host**, `~/.config/meme-coin-trader/signer-burnkeeper.enc.json` | devnet plain, mainnet `.enc.json` | 1 | 0.3 (reading rent ≈0.0021/business day + fees; it alerts below 0.05) |
| Platform keeper key | Burnticker's multi-token keeper (not used by $DEFICIT) | Burnticker host, `signer-burnticker.enc.json` | `.enc.json` | — | 0.1 |
| LaunchLab platform admin | Signs `create_platform_config` once (D-3) | devnet: `$D/payer.json`. mainnet: Mac `$M/platform-admin.enc.json` (`scripts/burnkeeper-keygen.mjs --new` with `BURNKEEPER_SIGNER_PATH` pointing there) | `.enc.json` | (payer) | 0.05 |
| Dev fee wallet | Receives the 25 bps platform fee (`BURNTICKER_FEE_WALLET`, pubkey only) | **hardware wallet**. devnet: throwaway `$D/devfee.json` | — | 0 | 0 |
| Squads members A / B / C | 2-of-3 multisig: upgrade authority, config admin, and platform authority if D-6 changes | devnet: `$D/squads-{a,b,c}.json`. mainnet: A = owner hardware (`usb://ledger`), B = owner second key, C = trusted third | — | A 0.5, B 0.1 | A 0.1, B 0.02 |
| Squads vault (index 0) | A PDA, the authority address | derived (`display-vault`) | — | 0 | 0 |
| $DEFICIT mint keypair | Signs `initialize_token` and the LaunchLab create. Never printed by our tools | Mac, `$M/mint-deficit.json` (runbook: `~/.config/meme-coin-trader/mint-deficit.json`; either path works) | plain JSON | — | 0 |
| $REHEARSAL mint keypair | the same, for B | Mac, `$M/mint-rehearsal.json` | plain JSON | — | 0 |
| devnet mint keypair | the same, for A | Mac, `$D/mint.json` | plain JSON | 0 | — |
| Devnet trader | Buys on the curve to graduate it, then trades the CPMM pool for the TWAP | a **browser wallet** (Phantom/Solflare) set to devnet | — | 2 | — |

Devnet total is about 14 SOL. The public airdrop answered `429` for every amount on 10-09 (devnet-run.md). Use https://faucet.solana.com
(signing in with GitHub raises the limit), and spread the requests across addresses and hours.

Mainnet total is about 12 SOL moved. Of that, about 3.14 SOL is locked as program rent and 3 SOL is the seed gift. The rest is recoverable.

### 0.2 Hosts

| Host | Runs | Holds |
|---|---|---|
| Mac (`~/Projects/meme-coin-trader`) | build, deploy, Squads member B, launch CLI, `initialize_token`, the devnet keeper | deployer, ops payer, platform admin, mint keypairs, program id key, devnet throwaways |
| Burnticker VPS (`mct-burnticker`, Tailscale; user `mct`) | `mct-burnkeeper`, `mct-burnticker-keeper`, `mct-burnticker-web`, audit and publish timers | the two keeper keys, the passphrase, RPC URLs, the webhook token. **Nothing from the trading app** (deploy.md host rule) |
| Trading VPS | the alert intake only (`mct-server`) | `MCT_ALERT_INTAKE_TOKEN`, Telegram |

### 0.3 Environment variable names, per host (names only)

- **Mac session (devnet):** `BURNTICKER_PROGRAM_ID`, `BURNTICKER_PLATFORM_ID`, `BURNKEEPER_EXECUTION`, `BURNKEEPER_SIGNER_PATH`,
  `BURNKEEPER_MINT`, `BURNKEEPER_RULES`, `BURNKEEPER_DB`, `BURNKEEPER_PUBLISH_DIR`, `BURNKEEPER_BASELINE_DATE`, and optionally
  `BURNKEEPER_RPC_URL` (a private devnet RPC is kinder than the public one).
- **Mac session (mainnet sends):** `BURNTICKER_PROGRAM_ID`, `BURNTICKER_PLATFORM_ID`, `BURNTICKER_FEE_WALLET`,
  `BURNKEEPER_RPC_URL` (mainnet RPC), `BURNKEEPER_SIGNER_PASSPHRASE` (only to unlock `platform-admin.enc.json`; entered with
  `read -rs`, never typed into a command line), and `BURNKEEPER_MAINNET=1` (inline on a send line only).
- **Burnticker host `~/meme-coin-trader/.env.local`** (runbook launch step 8 together with deploy.md):
  - $DEFICIT keeper: `BURNKEEPER_EXECUTION=program`, `BURNTICKER_PROGRAM_ID`, `BURNKEEPER_MINT`, `BURNKEEPER_MAINNET`, `BURNKEEPER_RULES_SHA`,
    `BURNKEEPER_RPC_URL`, `BURNKEEPER_SIGNER_PASSPHRASE`, `BURNKEEPER_CREATOR_FEE_SOURCE`, `BURNKEEPER_SEED_TX`, `BURNKEEPER_SEED_SOL`.
  - Platform keeper: `BURNTICKER_CLUSTER`, `BURNTICKER_PLATFORM_ID`, `BURNTICKER_PLATFORM_ADMIN` (pubkey, trust page), `BURNTICKER_KEEPER_PUBKEY`,
    `BURNTICKER_SIGNER_PATH`, `BURNTICKER_FEE_WALLET`, `BURNTICKER_RPC_URL`, `NEXT_PUBLIC_BURNTICKER_RPC_URL`, `BURNTICKER_MAINNET`,
    `BURNTICKER_ADMIN` (the Squads vault; launch bundles), `BURNTICKER_PROGRAM_HASH`, `BURNTICKER_UPGRADE_AUTHORITY`,
    `BURNTICKER_ALERT_WEBHOOK`, `BURNTICKER_ALERT_WEBHOOK_TOKEN`.
  - **Do not set** `BURNKEEPER_CLAIM_CREATOR_FEES`. It is a legacy flag. Program mode claims on its own, and the legacy leg refuses it.
    deploy.md's env table and the `run-burnkeeper.sh` header say the same since 2026-10-10.
  - `.env.local` only fills names that are **unset** (`scripts/load-env.sh`). A value given on the command line wins. That is how the
    rehearsal keeper instance (B17) runs beside $DEFICIT.
- **Trading VPS:** `MCT_ALERT_INTAKE_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. **Mac check-in:** `BURNTICKER_OPS_URL`.

### 0.4 Tools

| Tool | State on the Mac (2026-10-10) | Needed for |
|---|---|---|
| Solana CLI (Agave) | **installed**, `solana-cli 4.3.0`, at `~/.local/share/solana/install/active_release/bin` (⚠ devnet-run.md says "no Solana CLI"; that is out of date) | keys, deploy, transfers |
| Anchor | **installed**, `anchor-cli 1.2.1`, at `~/.cargo/bin` | build, `keys sync` |
| jq, curl | installed | reading JSON, RPC reads |
| `squads-multisig-cli` 0.1.7 | **not installed**: `cargo install squads-multisig-cli --version 0.1.7 --locked` | A5, B3 |
| `solana-verify` | **not installed**: `cargo install solana-verify --locked` | B4, B5, C16, gate 13 |
| Docker (Docker Desktop or colima) | **not installed** | `anchor build --verifiable` (B4). Without it there is no verifiable hash, so gates 13 and 14 cannot be met |
| `spl-token` | not installed, **not needed** (the probe and `curl` read token balances) | — |
| Ledger with the Solana app | owner | Squads member A on mainnet |

### 0.5 Session setup (each new Mac terminal)

```bash
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"; cd ~/Projects/meme-coin-trader; R() { node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs "$@"; }; D=~/.config/meme-coin-trader/devnet; M=~/.config/meme-coin-trader/mainnet; H=~/.config/meme-coin-trader/runsheet; DEVNET_RPC=https://api.devnet.solana.com; MAINNET_RPC=<MAINNET_RPC_URL>
```

On the Burnticker host, as `mct` (runbook header, with `R` as a function):

```bash
cd ~/meme-coin-trader; export XDG_RUNTIME_DIR=/run/user/$(id -u); R() { node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs "$@"; }
```

### 0.6 Three helper snippets (written once, outside the repo)

There is **no CLI** for `initialize_token`, `register_pool`, `claim_launchlab_creator_fee` or `initialize_platform`. The repo has only the
library calls (`src/lib/burnReceipts`). The runbook and devnet-run say "`initializeTokenIx`, src/lib/burnReceipts" without giving a command.
These three snippets wrap those library calls. Each one **simulates first** and sends only with `SEND=1`. A mainnet send also needs
`BURNKEEPER_MAINNET=1`. They are run from the repo root, so `./src/…` resolves, with `R --input-type=module -e "$(cat …)"`.

Claude dry-ran all three on 2026-10-10 against devnet with throwaway keys. Each built and signed its transaction, and simulation stopped at
`AccountNotFound` because the payer was unfunded. The `initialize_token` snippet's rules sha matched `--print-rules`. The probe was run
read-only against a real migrated mainnet LaunchLab pool (see the K-checkpoints).

Probe (read-only: mint authorities, fee PDA, LaunchLab pool, TokenConfig, CPMM candidates and pool provenance):

```bash
mkdir -p "$H" && cat > "$H/probe.mjs" <<'EOF'
import { Connection, PublicKey } from "@solana/web3.js";
import { LaunchpadPool, getCpmmPdaPoolId } from "@raydium-io/raydium-sdk-v2";
import { fetchTokenConfig, fetchCpmmPool, feePda, feeWsolAddress, launchlabPoolPda, lpLockVault, CPMM_PROGRAM_ID, LAUNCHLAB_PROGRAM_ID, NATIVE_MINT } from "./src/lib/burnReceipts/index.ts";
const e = (k) => { const v = process.env[k]?.trim(); if (!v) throw new Error(`set ${k}`); return v; };
const j = (x) => JSON.stringify(x, (_k, v) => typeof v === "bigint" ? v.toString() : v instanceof PublicKey ? v.toBase58() : v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v, 2);
const cluster = e("CLUSTER"), connection = new Connection(e("RPC"), "confirmed"), programId = new PublicKey(e("PROGRAM_ID")), mint = new PublicKey(e("MINT"));
const fee = feePda(programId, mint), wsol = feeWsolAddress(programId, mint);
const out = { cluster, mint, feePda: fee };
const m = (await connection.getParsedAccountInfo(mint, "confirmed")).value;
out.mintAccount = m ? { mintAuthority: m.data.parsed?.info?.mintAuthority ?? null, freezeAuthority: m.data.parsed?.info?.freezeAuthority ?? null, decimals: m.data.parsed?.info?.decimals, supply: m.data.parsed?.info?.supply } : "missing";
out.feePdaSol = (await connection.getBalance(fee, "confirmed")) / 1e9;
out.feeWsol = await connection.getTokenAccountBalance(wsol, "confirmed").then((r) => r.value.uiAmountString).catch(() => "no account yet");
const ll = launchlabPoolPda(LAUNCHLAB_PROGRAM_ID[cluster], mint), lli = await connection.getAccountInfo(ll, "confirmed");
if (lli) { const p = LaunchpadPool.decode(Buffer.from(lli.data)); out.launchlab = { pool: ll, creator: p.creator, creatorIsFeePda: p.creator.equals(fee), status: p.status, platformId: p.platformId, realB_lamports: p.realB?.toString(), totalFundRaisingB: p.totalFundRaisingB?.toString() }; } else out.launchlab = "no LaunchLab pool for this mint";
const cfg = await fetchTokenConfig(connection, programId, mint);
out.tokenConfig = cfg ? (({ config: c }) => ({ address: cfg.address, feedId: c.feedId, memoPrefix: c.memoPrefix, memoSource: c.memoSource, rulesSha256: c.rules_sha256, attesters: c.activeAttesters, quorum: c.quorum, admin: c.admin, clusterGenesis: c.cluster_genesis, hasBaseline: c.has_baseline, lastRecordDate: c.last_record_date, crankCursor: c.crank_cursor, readings: c.readings, burns: c.burns, totalBurnedRaw: c.total_burned, totalSpentLamports: c.total_spent_lamports, carriedSpendLamports: c.carried_spend_lamports, poolRegistered: c.poolRegistered, cpmmPool: c.cpmm_pool, poolUntradeableSince: c.pool_untradeable_since, rule: c.rule }))(cfg) : "none — initialize_token has not run";
if (process.env.AMM_CONFIG?.trim()) {
  const amm = new PublicKey(e("AMM_CONFIG")), cands = [getCpmmPdaPoolId(CPMM_PROGRAM_ID[cluster], amm, mint, NATIVE_MINT).publicKey, getCpmmPdaPoolId(CPMM_PROGRAM_ID[cluster], amm, NATIVE_MINT, mint).publicKey];
  out.cpmmCandidates = await Promise.all(cands.map(async (c) => ({ pool: c, exists: !!(await connection.getAccountInfo(c, "confirmed")) })));
}
if (process.env.POOL?.trim()) {
  const pool = new PublicKey(e("POOL")), p = await fetchCpmmPool(connection, pool, CPMM_PROGRAM_ID[cluster]);
  const lpMintSupply = BigInt((await connection.getTokenSupply(p.lpMint, "confirmed")).value.amount);
  const locked = await connection.getTokenAccountBalance(lpLockVault(cluster, p.lpMint), "confirmed").then((r) => BigInt(r.value.amount)).catch(() => 0n);
  const burned = p.lpSupply - lpMintSupply;
  out.cpmm = { pool, poolCreator: p.poolCreator, creatorIsFeePda: p.poolCreator.equals(fee), ammConfig: p.ammConfig, status: p.status, enableCreatorFee: p.enableCreatorFee, lpSupply: p.lpSupply, lpBurnedPct: Number((burned * 10000n) / (p.lpSupply || 1n)) / 100, lpLockedPct: Number((locked * 10000n) / (p.lpSupply || 1n)) / 100, observation: p.observationKey };
}
console.log(j(out));
EOF
```

`initialize_token` (payer = creator; the keeper is the only attester, quorum 1; admin = the Squads vault; TWAP 1,200 s / 300 bps):

```bash
mkdir -p "$H" && cat > "$H/init-token.mjs" <<'EOF'
import { Connection, PublicKey } from "@solana/web3.js";
import { loadKeypair } from "./src/lib/burnKeeper/keyfile.ts";
import { loadRules } from "./src/lib/burnKeeper/rules.ts";
import { initializeTokenIx, operatorAttester, ruleParamsFromKeeperRules, feePda, configPda, signTransaction, confirmByPolling, fetchTokenConfig } from "./src/lib/burnReceipts/index.ts";
const e = (k) => { const v = process.env[k]?.trim(); if (!v) throw new Error(`set ${k}`); return v; };
const j = (x) => JSON.stringify(x, (_k, v) => typeof v === "bigint" ? v.toString() : v instanceof PublicKey ? v.toBase58() : v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v, 2);
const cluster = e("CLUSTER"), send = process.env.SEND === "1";
if (cluster === "mainnet" && send && process.env.BURNKEEPER_MAINNET !== "1") throw new Error("mainnet send needs BURNKEEPER_MAINNET=1");
const programId = new PublicKey(e("PROGRAM_ID")), payer = loadKeypair({ keyPath: e("PAYER") }), mint = loadKeypair({ keyPath: e("MINT_KEYPAIR") });
const loaded = loadRules(e("RULES"));
if (loaded.rules.mint !== mint.publicKey.toBase58()) throw new Error(`the rule file's "mint" (${loaded.rules.mint}) is not the mint keypair (${mint.publicKey.toBase58()}) — write it in first`);
const rule = ruleParamsFromKeeperRules(loaded.rules, { floorLamports: BigInt(e("FLOOR_LAMPORTS")), maxTwapDeviationBps: 300, twapWindowSecs: 1200 });
const args = { feed_id: loaded.rules.feed.id, memo_prefix: loaded.rules.memo.prefix, memo_source: loaded.rules.feed.memoSource, rules_sha256: Uint8Array.from(Buffer.from(loaded.sha256, "hex")), rule,
  attesters: [operatorAttester(new PublicKey(e("KEEPER_PUBKEY")))], quorum: 1, fixed_pool: PublicKey.default, admin: new PublicKey(e("ADMIN")) };
const ix = initializeTokenIx({ programId, payer: payer.publicKey, creator: payer.publicKey, mint: mint.publicKey, args });
console.log(j({ cluster, send, programId, mint: mint.publicKey, payerAndCreator: payer.publicKey, feePda: feePda(programId, mint.publicKey), config: configPda(programId, mint.publicKey), rulesSha256: loaded.sha256, attesters: args.attesters, quorum: 1, admin: args.admin, rule }));
const connection = new Connection(e("RPC"), "confirmed");
const ctx = { connection, programId, mint: mint.publicKey, cluster, allowMainnet: process.env.BURNKEEPER_MAINNET === "1" };
const s = await signTransaction(ctx, [ix], [payer, mint]);
const sim = await connection.simulateTransaction(s.tx, { commitment: "confirmed" });
console.log("simulation:", sim.value.err ? JSON.stringify(sim.value.err) : `ok, ${sim.value.unitsConsumed} CU`); console.log((sim.value.logs ?? []).slice(-6).join("\n"));
if (send && !sim.value.err) {
  const sig = await connection.sendRawTransaction(s.raw, { skipPreflight: true, maxRetries: 5 });
  const err = await confirmByPolling(connection, sig, s.lastValidBlockHeight);
  console.log(err ? `FAILED ${JSON.stringify(err)} ${sig}` : `confirmed ${sig}`);
  const cfg = await fetchTokenConfig(connection, programId, mint.publicKey);
  const c = cfg?.config;
  console.log(j(c ? { feedId: c.feedId, memoPrefix: c.memoPrefix, memoSource: c.memoSource, rulesSha256: c.rules_sha256, attesters: c.activeAttesters, quorum: c.quorum, admin: c.admin, clusterGenesis: c.cluster_genesis, rule: c.rule } : "no TokenConfig found"));
}
EOF
```

`register_pool` / `claim` / `initialize_platform` (choose with `ACTION=`):

```bash
mkdir -p "$H" && cat > "$H/act.mjs" <<'EOF'
import { Connection, PublicKey } from "@solana/web3.js";
import { loadKeypair } from "./src/lib/burnKeeper/keyfile.ts";
import { registerPoolIx, claimLaunchlabCreatorFeeIx, createAtaIdempotentIx, initializePlatformIx, fetchCpmmPool, fetchLaunchLabPlatformId, feePda, feeWsolAddress, platformPda, signTransaction, confirmByPolling, CPMM_PROGRAM_ID, NATIVE_MINT } from "./src/lib/burnReceipts/index.ts";
const e = (k) => { const v = process.env[k]?.trim(); if (!v) throw new Error(`set ${k}`); return v; };
const action = e("ACTION"), cluster = e("CLUSTER"), send = process.env.SEND === "1";
if (cluster === "mainnet" && send && process.env.BURNKEEPER_MAINNET !== "1") throw new Error("mainnet send needs BURNKEEPER_MAINNET=1");
const connection = new Connection(e("RPC"), "confirmed"), programId = new PublicKey(e("PROGRAM_ID")), payer = loadKeypair({ keyPath: e("PAYER") });
const signers = [payer];
let ixs;
if (action === "register_pool") {
  const mint = new PublicKey(e("MINT")), pool = new PublicKey(e("POOL"));
  const p = await fetchCpmmPool(connection, pool, CPMM_PROGRAM_ID[cluster]);
  const launchlabPlatform = await fetchLaunchLabPlatformId(connection, cluster, mint);
  console.log(JSON.stringify({ pool: pool.toBase58(), poolCreator: p.poolCreator.toBase58(), feePda: feePda(programId, mint).toBase58(), creatorIsFeePda: p.poolCreator.equals(feePda(programId, mint)), ammConfig: p.ammConfig.toBase58(), lpMint: p.lpMint.toBase58(), launchlabPlatform: launchlabPlatform.toBase58(), enableCreatorFee: p.enableCreatorFee, status: p.status }, null, 2));
  ixs = [registerPoolIx({ programId, registrar: payer.publicKey, mint, pool, lpMint: p.lpMint, cluster, launchlabPlatform })];
} else if (action === "claim") {
  const mint = new PublicKey(e("MINT")), fee = feePda(programId, mint);
  ixs = [createAtaIdempotentIx({ payer: payer.publicKey, owner: fee, mint: NATIVE_MINT, ata: feeWsolAddress(programId, mint) }), claimLaunchlabCreatorFeeIx({ programId, payer: payer.publicKey, mint, cluster })];
  console.log(`claim_launchlab_creator_fee → fee PDA ${fee.toBase58()}, WSOL account ${feeWsolAddress(programId, mint).toBase58()}`);
} else if (action === "initialize_platform") {
  const upgradeAuthority = loadKeypair({ keyPath: e("UPGRADE_AUTHORITY") });
  signers.push(upgradeAuthority);
  ixs = [initializePlatformIx({ programId, payer: payer.publicKey, upgradeAuthority: upgradeAuthority.publicKey, authority: new PublicKey(e("AUTHORITY")), burnPoolCapLamports: BigInt(e("CAP_LAMPORTS")), capSunsetTs: BigInt(e("CAP_SUNSET_TS")) })];
  console.log(`initialize_platform → PlatformConfig ${platformPda(programId).toBase58()}, authority ${e("AUTHORITY")}`);
} else throw new Error("ACTION = register_pool | claim | initialize_platform");
const s = await signTransaction({ connection, programId, mint: PublicKey.default, cluster }, ixs, signers);
const sim = await connection.simulateTransaction(s.tx, { commitment: "confirmed" });
console.log("simulation:", sim.value.err ? JSON.stringify(sim.value.err) : `ok, ${sim.value.unitsConsumed} CU`); console.log((sim.value.logs ?? []).slice(-8).join("\n"));
if (send && !sim.value.err) {
  const sig = await connection.sendRawTransaction(s.raw, { skipPreflight: true, maxRetries: 5 });
  const err = await confirmByPolling(connection, sig, s.lastValidBlockHeight);
  console.log(err ? `FAILED ${JSON.stringify(err)} ${sig}` : `confirmed ${sig}`);
}
EOF
```

**TWAP parameters.** Runbook launch step 5 said `maxTwapDeviationBps: 500, twapWindowSecs: 600` until 2026-10-10. It now says 300 / 1,200. Review-2 F1
capped deviation and slippage at **300** and requires `deviation × window ≥ 150,000`, so `initialize_token` would **refuse** 500. The snippet
uses README §1's recommendation for $DEFICIT: **window 1,200 s, deviation 300, slippage 300** (slippage comes from the rule file, which says 300).

---

## A. Devnet rehearsal: gate 1

Goal: every program path runs once on a real validator, and `docs/burnkeeper/devnet-run.md` §4 gets filled in. Plan on a weekday morning
starting around 08:00 Denver. If the migration crank (K3) is prompt, the run takes about 3–4 h, plus faucet time.

| # | WHO | Step | Command | Expected / check | Proof (§4 row / gate) |
|---|---|---|---|---|---|
| A1 | either | Devnet keys | block A1 | 8 files in `$D`, mode 600. Pubkeys listed | — |
| A2 | owner | Fund devnet keys (faucet) | block A2 | deployer ≥ 7, payer ≥ 3, keeper ≥ 1, squads-a ≥ 0.5, squads-b ≥ 0.1; browser wallet ≥ 2 | — |
| A3 | either | Program id key + devnet build | blocks A3a–A3c | `anchor keys list` shows the new id; `target/deploy/burn_receipts.so` ≈ 617 KB; `npm test` passes | — |
| A4 | either | Deploy to devnet | blocks A4a–A4b | `Authority: <deployer>`, Data Length ≈ 617,000 | §4 "deploy" |
| A5 | either | Squads 2-of-3 (devnet, **60 s** time lock) | blocks A5a–A5e | `✅ Created Multisig`, then the vault address | gate 12 rehearsal |
| A6 | either | *(optional, D-6)* `initialize_platform` | block A6 | simulation ok, then confirmed | — |
| A7 | either | Upgrade authority → vault | blocks A7a–A7b | `Authority: <VAULT>` | gate 12 rehearsal |
| A8 | either | Devnet rules copy with the devnet mint | block A8 | `"mint"` = the devnet mint | — |
| A9 | either | Rules sha | block A9 | `sha256 <64 hex>`; record it | §4 "rules sha" |
| A10 | either | Our devnet LaunchLab platform (25/50, LP 100% locked, Fee Key → the fee-keys PDA) | blocks A10a–A10b | dials 2,500 / 5,000 ppm, `lpToPlatformPpm "1000000"`, `lockNftWallet` = `feeKeysPda`, `problems: []`; record `platformId` | — |
| A11 | either | `initialize_token` | blocks A11a–A11b | read-back: sha = A9, attesters = [keeper], quorum 1, admin = vault, genesis = devnet `EtWTRABZ…`, rule twap 300/1200, floor 1,000,000 | §4 "initialize_token" |
| A12 | either | LaunchLab create, creator = fee PDA (dry run, then send) | blocks A12a–A12c | `creator == burnPool.feePda`, `creatorIsFeePda: true`, `programIdIsLocalnetPlaceholder: false`, `platformId` = A10, `problems: []`, simulation null | §4 "LaunchLab create" |
| A13 | Claude | **K1** mint and freeze authority | block P (probe) | see K1 | — |
| A14 | either | Seed 0.5 SOL into the fee PDA | block A14 | signature; probe `feePdaSol` ≈ 0.52 | §4 "seed" |
| A15 | either | Keeper `--once`, before graduation | blocks A15a–A15b | see A15 | §4 "first submit_reading" |
| A16 | either | **K2** `claim_launchlab_creator_fee` on the real devnet LaunchLab | blocks A16a–A16b | see K2 | §4 "curve claim" |
| A17 | owner | Buy to graduate (≈1.2 SOL in 3 buys + 1 small sell) | browser | buys land; the fee vaults grow 0.5% / 0.25% of each buy | gate 3 rehearsal |
| A18 | Claude | **K3** migration happens on devnet | block P with `AMM_CONFIG` | see K3 | — |
| A19 | Claude | **K4** pool provenance | block P with `POOL` | see K4 | — |
| A20 | either | `register_pool` | blocks A20a–A20b | simulation ok, then confirmed | §4 "register_pool" |
| A21 | owner | Trade the CPMM pool for ≥ 25 min | browser | **K5** | — |
| A22 | either | Keeper loop (program mode) | block A22 | `check_pool_health`, a `TwapUnavailable` wait, then `CRANKED · burned` | §4 "check_pool_health", "deferred", "crank_buyback" |
| A23 | Claude | Receipt recomputes | blocks A23a–A23c | `verified: true`, `.health.unverified == 0`, memo on chain = the row's | gate 1 |
| A24 | Claude | CPMM creator-fee collect (`[fees] cpmm`) | log + probe | fee WSOL grows | §4 "CPMM creator-fee claim" |
| A24L | Claude | **K3-lock** LP locked, Fee Key at the program PDA, one claim + one burn | log + probe | `register_fee_key` confirmed; `[lp-fees] … LP fees claimed: X SOL → 80% burn pool / 20% operator`; the burn pool's next crank burns | LP locked forever (2026-10-10) |
| A25 | either | *(recommended)* Rehearse finalisation through Squads | block A25 | `Authority: none` on the devnet program | rehearses gate 14 |
| A26 | Claude | Fill devnet-run.md §4, save the evidence, commit | — | table filled with explorer links | **gate 1** |

### A1. Devnet keys

```bash
mkdir -p "$D" && chmod 700 "$D" && for k in deployer payer keeper mint squads-a squads-b squads-c devfee; do solana-keygen new --no-bip39-passphrase --silent -o "$D/$k.json"; done && chmod 600 "$D"/*.json && for k in deployer payer keeper squads-a squads-b squads-c devfee; do printf '%-9s %s\n' $k "$(solana-keygen pubkey "$D/$k.json")"; done
```

### A2. Fund, then check

Use https://faucet.solana.com for each address above (deployer, payer, keeper, squads-a, squads-b) and for the browser wallet. Check:

```bash
for k in deployer payer keeper squads-a squads-b; do printf '%-9s %s\n' $k "$(solana balance "$(solana-keygen pubkey "$D/$k.json")" --url devnet)"; done
```

### A3. Program id, build, test (on a deploy branch in the main checkout)

A3a, the program id key. It is created once. Without `--force` it refuses to overwrite:

```bash
mkdir -p "$M" && chmod 700 "$M" && solana-keygen new --no-bip39-passphrase --silent -o "$M/burn_receipts-program.json" && chmod 600 "$M/burn_receipts-program.json" && solana-keygen pubkey "$M/burn_receipts-program.json"
```

A3b, the branch, `keys sync`, the devnet build, and the IDL/register refresh (README §5.1):

```bash
git switch -c deploy/devnet-<YYYY-MM-DD> <COMMIT> && mkdir -p programs/burn-receipts/target/deploy && cp "$M/burn_receipts-program.json" programs/burn-receipts/target/deploy/burn_receipts-keypair.json && (cd programs/burn-receipts && anchor keys sync && anchor build -- --features devnet && node scripts/sync-idl.mjs && node scripts/powers-register.mjs) && git status --short
```

Expected: `declare_id!`, `Anchor.toml`, the TS IDL (`src/lib/burnReceipts/idl.ts`) and the powers register change to the new id.

A3c, the tests. If one fails because it pins the old localnet id `GV9CMj…SuF8`, stop and give the output to Claude. That failure is unverified:
the README expects the id change to be clean.

```bash
npm test 2>&1 | tail -5 && git add -A programs/burn-receipts src/lib/burnReceipts docs/burn-receipts && git commit -m "burn_receipts: real program id <PROGRAM_ID> (devnet build)"
```

### A4. Deploy

```bash
solana program deploy programs/burn-receipts/target/deploy/burn_receipts.so --program-id programs/burn-receipts/target/deploy/burn_receipts-keypair.json --upgrade-authority "$D/deployer.json" --keypair "$D/deployer.json" --url devnet
```

```bash
solana program show <PROGRAM_ID> --url devnet && export BURNTICKER_PROGRAM_ID=<PROGRAM_ID>
```

### A5. Squads 2-of-3 on devnet (commands from README §5.2; CLI 0.1.7 source)

A 60 s time lock on devnet means the commands get rehearsed without a 48 h wait. Mainnet uses 172800 (B3).

```bash
cargo install squads-multisig-cli --version 0.1.7 --locked
```

```bash
squads-multisig-cli multisig-create --rpc-url "$DEVNET_RPC" --keypair "$D/squads-a.json" --members "$(solana-keygen pubkey "$D/squads-a.json"),7" "$(solana-keygen pubkey "$D/squads-b.json"),7" "$(solana-keygen pubkey "$D/squads-c.json"),7" --threshold 2
```

Record `<MULTISIG>` from "✅ Created Multisig: …". Then set the time lock. This is config transaction index 1: propose it, two approvals,
execute.

```bash
squads-multisig-cli config-transaction-create --rpc-url "$DEVNET_RPC" --keypair "$D/squads-a.json" --multisig-pubkey <MULTISIG> --action "SetTimeLock 60" && squads-multisig-cli proposal-vote --rpc-url "$DEVNET_RPC" --keypair "$D/squads-a.json" --multisig-pubkey <MULTISIG> --transaction-index 1 --action approve && squads-multisig-cli proposal-vote --rpc-url "$DEVNET_RPC" --keypair "$D/squads-b.json" --multisig-pubkey <MULTISIG> --transaction-index 1 --action approve
```

```bash
squads-multisig-cli config-transaction-execute --rpc-url "$DEVNET_RPC" --keypair "$D/squads-a.json" --multisig-pubkey <MULTISIG> --transaction-index 1
```

```bash
squads-multisig-cli display-vault --rpc-url "$DEVNET_RPC" --multisig-address <MULTISIG> --vault-index 0
```

Record `<VAULT>`. On devnet it becomes the upgrade authority (A7) and the TokenConfig admin (A11).

### A6. *(optional, D-6)* `initialize_platform`, while the deployer is still upgrade authority

Pick `CAP_SUNSET_TS` no later than `1822348800` (2027-10-01T00:00Z, `DEFAULT_CAP_SUNSET_TS`; F8). The cap must be between 1 and 25 SOL.

```bash
ACTION=initialize_platform CLUSTER=devnet RPC="$DEVNET_RPC" PROGRAM_ID=<PROGRAM_ID> PAYER="$D/deployer.json" UPGRADE_AUTHORITY="$D/deployer.json" AUTHORITY=<VAULT> CAP_LAMPORTS=25000000000 CAP_SUNSET_TS=<UNIX_SECONDS> SEND=0 R --input-type=module -e "$(cat "$H/act.mjs")"
```

Then the same line with `SEND=1`.

### A7. Upgrade authority → the vault

```bash
solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <VAULT> --skip-new-upgrade-authority-signer-check --upgrade-authority "$D/deployer.json" --keypair "$D/deployer.json" --url devnet
```

```bash
solana program show <PROGRAM_ID> --url devnet
```

### A8. Devnet rules copy with the devnet mint written in

`--print-rules`, the launch CLI's `--rules` and the keeper's `BURNKEEPER_RULES` all read this file. The committed file already carries the D-4 wording
(applied 2026-10-10, rules sha `0b4d0994…`; the owner rereads it before C3), so the copy differs only in `"mint"`.

```bash
jq --arg m "$(solana-keygen pubkey "$D/mint.json")" '.mint = $m' config/burnkeeper/deficit.rules.json > "$D/deficit-devnet.rules.json" && jq -r .mint "$D/deficit-devnet.rules.json"
```

### A9. Rules sha

```bash
BURNKEEPER_RULES="$D/deficit-devnet.rules.json" R scripts/burn-keeper.mts --print-rules
```

### A10. Our devnet LaunchLab platform (rehearses C's dials; Raydium's own devnet platform pays only 25 bps to the creator slot)

Claude dry-ran the launch CLI against Raydium's devnet platform on 2026-10-10. It reported 25 / 25 / 25 bps, so the 50 bps burn-pool slot
exists only under our platform.

```bash
R scripts/burnkeeper-launch.mts platform --cluster devnet --admin "$D/payer.json" --fee-wallet "$(solana-keygen pubkey "$D/devfee.json")" --web https://burnticker.com --img https://burnticker.com/icon.png > "$D/platform-dry.json"; jq '{platformId, dials, problems, sim: .simulation.err, curve: [.feeSplit.preGraduation.legs[] | {bps, to}]}' "$D/platform-dry.json"
```

```bash
R scripts/burnkeeper-launch.mts platform --cluster devnet --admin "$D/payer.json" --fee-wallet "$(solana-keygen pubkey "$D/devfee.json")" --web https://burnticker.com --img https://burnticker.com/icon.png --send > "$D/platform.json"; jq '{platformId, sent, explorer}' "$D/platform.json" && export BURNTICKER_PLATFORM_ID=$(jq -r .platformId "$D/platform.json")
```

### A11. `initialize_token`

```bash
CLUSTER=devnet RPC="$DEVNET_RPC" PROGRAM_ID=$BURNTICKER_PROGRAM_ID PAYER="$D/payer.json" MINT_KEYPAIR="$D/mint.json" RULES="$D/deficit-devnet.rules.json" KEEPER_PUBKEY="$(solana-keygen pubkey "$D/keeper.json")" ADMIN=<VAULT> FLOOR_LAMPORTS=1000000 SEND=0 R --input-type=module -e "$(cat "$H/init-token.mjs")"
```

Then the same with `SEND=1`. The read-back must show everything listed in row A11.

### A12. LaunchLab create (devnet: raise 1 SOL, first buy 0.1 SOL; mainnet uses neither)

Launch gate first, in the same sitting (re-check R3-3; read-only, exit 1 = do not create — README §5 "Launch gate: platform pins"):

```bash
R scripts/burnreceipts-admin.mts verify-platform-pins --cluster devnet --program <burn program> --mint <mint> > "$D/pins.json"; echo "exit $?"; jq '{ok, mismatches, pinned, current}' "$D/pins.json"
```

```bash
R scripts/burnkeeper-launch.mts launch --cluster devnet --payer "$D/payer.json" --mint-keypair "$D/mint.json" --rules "$D/deficit-devnet.rules.json" --name DEFICIT --symbol DEFICIT --uri <METADATA_URL> --raise-sol 1 --first-buy-sol 0.1 > "$D/launch-dry.json"; jq '{creator, feePda: .burnPool.feePda, creatorIsFeePda: .burnPool.creatorIsFeePda, placeholder: .burnPool.programIdIsLocalnetPlaceholder, platformId, rulesSha: .rules.sha256, warnings, problems, sim: .simulation.create.err}' "$D/launch-dry.json"
```

```bash
R scripts/burnkeeper-launch.mts launch --cluster devnet --payer "$D/payer.json" --mint-keypair "$D/mint.json" --rules "$D/deficit-devnet.rules.json" --name DEFICIT --symbol DEFICIT --uri <METADATA_URL> --raise-sol 1 --first-buy-sol 0.1 --send > "$D/launch.json"; jq '{mint, poolId, creator, creatorFeeVault: .creatorFeeVault.address, platformFeeVault, cpmm: .cpmmAfterGraduation, sent}' "$D/launch.json"
```

### Block P: the probe (used in A13, A18, A19, and again in B and C)

Add `AMM_CONFIG=<launch.json .cpmmAfterGraduation.ammConfig>` to list both CPMM pool candidates and show which one exists. Add `POOL=<id>` to
read the pool's creator and LP.

```bash
CLUSTER=devnet RPC="$DEVNET_RPC" PROGRAM_ID=$BURNTICKER_PROGRAM_ID MINT=$(jq -r .mint "$D/launch.json") R --input-type=module -e "$(cat "$H/probe.mjs")"
```

**A13 · K1, mint and freeze authority (README L-3).** `register_pool`, `replace_pool` and both cranks refuse a mint that still has either authority.
*Pass:* `mintAccount.mintAuthority` and `.freezeAuthority` are both `null`, either now or at K4 at the latest. *Fail:* either one is still set at
K4. Stop. `register_pool` would refuse with `MintAuthorityRetained` / `FreezeAuthorityRetained`. Evidence so far: a real migrated mainnet
LaunchLab mint (`D1YZZg9d…F4n`) reads `null`/`null` (Claude, read-only, 2026-10-10).

### A14. Seed (devnet stand-in for the 3 SOL)

```bash
solana transfer $(jq -r .burnPool.feePda "$D/launch.json") 0.5 --allow-unfunded-recipient --keypair "$D/payer.json" --url devnet
```

### A15. Keeper once, before graduation

A15a, pick a baseline about two weeks back. It must be a Treasury `record_date`:

```bash
curl -s 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?fields=record_date,tot_pub_debt_out_amt&sort=-record_date&page%5Bsize%5D=15' | jq -r '.data[] | "\(.record_date)  \(.tot_pub_debt_out_amt)"'
```

A15b. The ledger must be fresh, because program mode refuses a ledger that holds legacy burns. If `data/burnkeeper-devnet.db` exists, move it
aside (`mv`, never delete). Then:

```bash
ls data/burnkeeper-devnet.db 2>/dev/null; BURNKEEPER_EXECUTION=program BURNTICKER_PROGRAM_ID=$BURNTICKER_PROGRAM_ID BURNKEEPER_SIGNER_PATH="$D/keeper.json" BURNKEEPER_MINT=$(jq -r .mint "$D/launch.json") BURNKEEPER_RULES="$D/deficit-devnet.rules.json" BURNKEEPER_DB=data/burnkeeper-devnet.db BURNKEEPER_PUBLISH_DIR=data/burnkeeper-devnet-site BURNKEEPER_BASELINE_DATE=<YYYY-MM-DD> R scripts/burn-keeper.mts --devnet --once
```

The log should show, in this order:

1. `execution program` in the banner.
2. The config line: `cluster devnet · EXECUTION program <id> · mode buyback · … · attesters 1 (quorum 1) · pool not registered`.
3. One `[attest] <date>: … attested and submitted (the program counted N unit(s))` per reading. The first one is the baseline.
4. `[fees] curve: …`.
5. `[program] <date>: waiting for the CPMM pool` (a wait, not an error).

A warning that "the keeper key … is not one of the config's attesters" means A11 named the wrong key. Stop.

### A16. K2: `claim_launchlab_creator_fee` against the real devnet LaunchLab

Before the claim, read the creator-fee vault and the fee PDA's WSOL. The A12 first buy left about 0.0005 SOL in the vault.

```bash
for a in $(jq -r .creatorFeeVault.address "$D/launch.json") $(jq -r .burnPool.feeWsolAta "$D/launch.json"); do curl -s "$DEVNET_RPC" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getTokenAccountBalance","params":["'$a'"]}' | jq -r --arg a $a '"\($a)  \(.result.value.uiAmountString // .error.message)"'; done
```

```bash
ACTION=claim CLUSTER=devnet RPC="$DEVNET_RPC" PROGRAM_ID=$BURNTICKER_PROGRAM_ID PAYER="$D/keeper.json" MINT=$(jq -r .mint "$D/launch.json") SEND=0 R --input-type=module -e "$(cat "$H/act.mjs")"
```

Then send with `SEND=1`, and rerun the balance block. *Pass:* `confirmed`, the vault is about 0, and fee WSOL has grown by the vault's
former balance. *Fail:* the simulation errors (log a `LaunchLab` / `ClaimOutflow` / account error). Record the logs. Gate 1 is not met, and
the program's claim path is wrong for the real LaunchLab (only a stand-in has run it). Stop and give it to Claude. The keeper also tries
this claim on every cycle while a burn day is pending, so an `[fees] curve: … sent <sig>` line from A15 counts as the same proof.

### A17. Buy to graduate (owner, browser wallet on devnet)

On `https://raydium.io/launchpad/token/?mint=<mint>&cluster=devnet` (URL from devnet-run.md; not checked), make 3 buys of about 0.4 SOL
each and one sell of about 0.05 SOL. That totals more than the 1 SOL raise plus fees. After the first buy, rerun the balance block on
`creatorFeeVault` and `platformFeeVault`. They should grow by about 0.5% and 0.25% of the buy. That rehearses gate 3.

**A18 · K3, devnet migration.** Run the probe with `AMM_CONFIG`. The LaunchLab `status` goes 0, then 1, then 2 (2 = migrated, as seen on a real
migrated mainnet pool), and one `cpmmCandidates[].exists` turns `true`. *Pass:* a CPMM pool exists within 60 min of the last buy. *Fail:*
there is still no pool 2 h after `status` reaches 1. Raydium's devnet migration crank is **not confirmed** (launchlab-devnet.md). Record it.
`register_pool`, the swap and the burn cannot be proven on devnet, so gate 1 is not met. Decide with Claude whether to wait, retry with a
new mint, or accept that gap.

**A19 · K4, pool provenance (README §3, F5).** Run the probe with `POOL=<the existing candidate>`. *Pass:* `cpmm.creatorIsFeePda: true`, and
`lpLockedPct ≥ 99` with `lpBurnedPct` ≈ 0 (LP locked forever, owner decision 2026-10-10: our platform locks 100%; `register_pool` itself
needs ≥ 50 % burned or locked at registration, ≥ 90 % for the fallback pool), and the pool is the candidate PDA (`exists: true` on the derived
address), and K1 passes. *Fail:* any one of these (under 99 % locked means the platform config is not locking the LP to the Fee Key). `register_pool` would refuse
(`NotMigrationPool` / `PoolCreatorMismatch` / the LP check under 50 %), and the readings wait
forever (the 30-day unblock does not apply to an unregistered pool). Stop.

Evidence so far, from a real mainnet migration (pool `CheJUx…cPvH`, read-only, 2026-10-10): `pool_creator` = the LaunchLab creator; the pool
equals the `["pool", ammConfig, token0, token1]` PDA; 99.99% of the LP sits in Raydium's LP-lock ATA. Under **our** platform it must show the same: locked (≈ 100 %),
with the Fee Key NFT held at ATA(fee-keys PDA, Fee Key mint).

### A20. `register_pool` (anyone; here the keeper key)

```bash
ACTION=register_pool CLUSTER=devnet RPC="$DEVNET_RPC" PROGRAM_ID=$BURNTICKER_PROGRAM_ID PAYER="$D/keeper.json" MINT=$(jq -r .mint "$D/launch.json") POOL=<CPMM_POOL> SEND=0 R --input-type=module -e "$(cat "$H/act.mjs")"
```

Then the same with `SEND=1`.

### A20L. K3-lock: the LP is locked, the Fee Key is the program's, one claim and one burn (LP locked forever, 2026-10-10)

The keeper runs this itself ahead of the buyback crank (`src/lib/burnticker/lockFeesKeeper.ts`): `register_fee_key` once, then
`claim_lock_fees` whenever fees have accrued. *Pass:* (1) the Raydium `LockedCpLiquidityState` (`["locked_liquidity", <Fee Key mint>]` under
the devnet lock program `DRay25Usp3YJAi7beckgpGUC7mGJ2cR1AVPxhYfwVCUX`) names the pool and holds ≈ 100 % of the LP; (2) the Fee Key NFT sits
in ATA(fee-keys PDA, Fee Key mint); (3) `register_fee_key` confirms; (4) after A21's trades one `claim_lock_fees` confirms with the memo
`<PREFIX>|lockfees|wsol=…|burnpool=…|operator=…|burned=…|nft=…|v1`, `operator` = floor(wsol × 2,000 / 10,000), the burn pool's WSOL grows by
the rest, the devnet treasury `A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD` by the operator share; (5) the next `crank_buyback` burns.
*Fail:* the Fee Key is anywhere else (`lock-fee-key-owner` alert), the split is not exactly 80/20 (`lock-fees-split`), or the claim refuses.

### A21. K5: TWAP history (window 1,200 s)

From the browser wallet, trade the CPMM pool. Alternate a buy and a sell of 0.01–0.02 SOL every 3–5 min for **≥ 25 min**. Write down the
first trade's time (Denver). Keep the sizes small and balanced. A burst of buys raises the token price, and the guard then defers
(`TwapDeviation`) until the TWAP catches up.

- *Pass:* the first `crank_buyback` burns within 40 min of the first CPMM trade.
- *Fail:* it is still deferring 60 min after the first trade. Note the reason. For `TwapDeviation`, stop trading for 20 min and let one cycle
  run. For `TwapUnavailable`, check that trades really landed. Retry once, then stop and record.

### A22. Keeper loop (a second terminal; stop with Ctrl-C, which finishes the cycle)

```bash
BURNKEEPER_EXECUTION=program BURNTICKER_PROGRAM_ID=$BURNTICKER_PROGRAM_ID BURNKEEPER_SIGNER_PATH="$D/keeper.json" BURNKEEPER_MINT=$(jq -r .mint "$D/launch.json") BURNKEEPER_RULES="$D/deficit-devnet.rules.json" BURNKEEPER_DB=data/burnkeeper-devnet.db BURNKEEPER_PUBLISH_DIR=data/burnkeeper-devnet-site R scripts/burn-keeper.mts --devnet
```

The log should show, in this order:

1. `[pool] check_pool_health: pool tradeable`.
2. Before the window fills: `crank_buyback deferred by the program (TwapUnavailable) — waiting for TWAP history`.
3. Then: `[program] <date>: CRANKED · burned · spent … got … burned … · <sig> · DEBT|<date>|…|v2`.

The cap of 2% of the pool's WSOL reserve per crank (about 0.02 SOL on a 1 SOL pool) means the backfilled days show as **partial** with
carried spend. That is expected (`SpendCapBound`).

### A23. The receipt recomputes

A23a:

```bash
jq '{execution, health, attestation: .program.attestation.lastReading, queue: .program.queue}' data/burnkeeper-devnet-site/status.json
```

A23b:

```bash
jq '[.[] | select(.status=="confirmed") | {recordDate, execution, units, burned, signature, verified: .verify.verified, checks: .verify.checks}]' data/burnkeeper-devnet-site/burns.json
```

A23c, the memo on chain against the row's memo (the output format of `solana confirm -v` was not checked):

```bash
solana confirm -v <CRANK_SIG> --url devnet | grep -i -A1 memo
```

*Pass (gate 1):* at least one `confirmed` day with `execution: "program"` and `verified: true`; `.health.unverified == 0`;
`.program.attestation.lastReading` set; the probe's `tokenConfig.burns ≥ 1`; and the supply has fallen.

### A24. The CPMM creator-fee leg

After graduation, the keeper's cycle logs `[fees] cpmm: …` (`collect_creator_fee_permissionless`, payer = keeper, destination = the fee PDA's
WSOL) while a burn day is pending. Confirm that fee WSOL grows in the probe, and record the signature.

### A25. *(recommended)* Rehearse finalisation through Squads

This makes the devnet program immutable, which is harmless because it is a throwaway. It is the one gate-14 command with no tool:
`squads-multisig-cli vault-transaction-create` needs a serialized message (README §5.3, §8), so use the Squads app's transaction builder with
the instruction from README §5.3 (BPF loader `SetAuthority`, data `[4,0,0,0]`, no new authority).

- *Pass:* `solana program show <PROGRAM_ID> --url devnet` prints `Authority: none`.
- If the app cannot do it, write that down. It also blocks gate 14 on mainnet.

### A26. Record

Claude fills the `docs/burnkeeper/devnet-run.md` §4 table, one row per step, with explorer URLs. The keeper's JSON carries them, and the
launch JSON has `sent.create.explorer`. Copy `data/burnkeeper-devnet-site/{status,burns}.json` and the `$D/*.json` launch outputs (not the
keys) into a dated evidence folder. Suggested path: `mct-runner-study/launch-debt-egg-2026-10-09/evidence/devnet-<date>/`. Then commit.
Gate 1 is ticked only when every §4 row has a signature or a recorded, explained gap.

---

## B. Mainnet rehearsal coin $REHEARSAL: gates 2, 3, 12, 13 (1–2 weekdays before launch)

B0–B9 are the **one-time mainnet setup**. They have to happen before the rehearsal, because gate 2 wants the rehearsal under the **real**
platform config and program. B10–B20 are the rehearsal coin itself.

| # | WHO | Step | Expected / proof |
|---|---|---|---|
| B0 | owner | Mainnet keys on the Mac (deployer, ops payer, platform admin) and funding | balances: deployer ≥ 7, ops payer ≥ 4.5, admin ≥ 0.05 |
| B1 | owner (Claude stages) | Provision the Burnticker host (deploy.md "First run") | `--check` clean; `https://burnticker.com/ops.json` serves |
| B2 | owner | Keeper keys **on the host** (by hand; see the provision bug note) | two `.enc.json`, mode 600, `.address` files; gate 12 |
| B3 | owner | Squads 2-of-3 on mainnet, 48 h time lock | `<VAULT>`; gate 12 |
| B4 | either + owner | Verifiable mainnet build (Docker) and its hash; tag; publish the public repo | hash recorded in README §5.4; gate 13 |
| B5 | owner | Deploy the **verifiable** `.so` to mainnet | `get-program-hash` = the B4 hash |
| B6 | owner | *(optional, D-6)* `initialize_platform` | — |
| B7 | owner | Upgrade authority → vault | `Authority: <VAULT>`; gate 12 |
| B8 | owner | Drain the deployer | `solana balance` ≈ 0; gate 12 |
| B9 | owner | Real LaunchLab platform config (25 / 50 / LP 100% locked, Fee Key → the fee-keys PDA) | `platformId`; dials read from the chain |
| B10 | either | $REHEARSAL mint keypair + rules file | `"mint"` set |
| B11 | either | Rules sha | — |
| B12 | Claude | Refuse lists + trust page entry, shipped **before** the create | own-tokens + transparency.json committed |
| B13 | owner | `initialize_token` (mainnet) | read-back as A11, genesis = mainnet `5eykt4Us…` |
| B14 | owner | Create with `--first-buy-sol 0.1` (disclosed) | `/tmp/rehearsal.json` (gate 2) |
| B15 | Claude | Fee routing check | gate 3 |
| B16 | owner or Claude | Claim against mainnet LaunchLab | fee WSOL grows |
| B17 | Claude | Keeper instance for the rehearsal (host, `--once`) | baseline attested; after 14:30, a unit reading attested |
| B18 | Claude | incidents/LOG.md line + sites shipped | gate 2 |
| B19 | — | What it proved / did not | — |
| B20 | owner | Retirement wording (D-8) | trust page |

### B0. Mainnet keys on the Mac

The deployer and ops payer are plain files, because the `solana` CLI must read them:

```bash
mkdir -p "$M" && chmod 700 "$M" && for k in deployer ops-payer; do solana-keygen new --no-bip39-passphrase --silent -o "$M/$k.json"; done && chmod 600 "$M"/*.json && for k in deployer ops-payer; do printf '%-10s %s\n' $k "$(solana-keygen pubkey "$M/$k.json")"; done
```

The platform admin is encrypted (D-3). The passphrase is typed once and not echoed. Keep it in your password manager.

```bash
read -rs BURNKEEPER_SIGNER_PASSPHRASE && export BURNKEEPER_SIGNER_PASSPHRASE && BURNKEEPER_SIGNER_PATH="$M/platform-admin.enc.json" node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/burnkeeper-keygen.mjs --new
```

The keygen's closing text talks about the "burn vault" and "vesting beneficiary". Ignore it: the header is out of date (§F 18). Fund the deployer
(7 SOL), the ops payer (4.5 SOL) and the admin (0.05 SOL) from your own wallet. Check:

```bash
for f in deployer.json ops-payer.json; do printf '%-15s %s\n' $f "$(solana balance "$(solana-keygen pubkey "$M/$f")" --url mainnet-beta)"; done; solana balance "$(cat "$M/platform-admin.enc.json.address")" --url mainnet-beta
```

### B1. Provision (deploy.md "First run"; run as root on the new box)

On the Mac:

```bash
git archive -o /tmp/mct.tar.gz HEAD && scp /tmp/mct.tar.gz scripts/ops/provision-burnticker-host.sh root@<PUBLIC_IP>:
```

On the box:

```bash
sh ~/provision-burnticker-host.sh --check
```

```bash
sh ~/provision-burnticker-host.sh --archive ~/mct.tar.gz
```

```bash
tailscale up
```

```bash
sh ~/provision-burnticker-host.sh
```

After that: DNS (deploy.md §DNS), `.env.local` as `mct` (the names in 0.3), `sh scripts/ops/deploy-burnticker-host.sh` from the Mac, then
`sh scripts/ops/deploy-sites.sh --check && sh scripts/ops/deploy-sites.sh` on the box. **Do not** start `mct-burnkeeper` yet.

Provision step 9 creates both keeper keys. **Fixed 2026-10-10:** it used to pass the passphrase to `su` as a trailing argument, which
left it empty inside (and visible in `ps`). It now pipes it on stdin into the `mct` shell. The pattern was tested end to end with the real
keygen on the Mac, but not yet on a box. If step 9 says "keygen failed" or "no terminal", use B2 by hand.

### B2. Keeper keys on the host by hand (only if step 9 did not make them; as `mct`; the passphrase is typed once and never echoed)

$DEFICIT keeper:

```bash
cd ~/meme-coin-trader && read -rs BURNKEEPER_SIGNER_PASSPHRASE && export BURNKEEPER_SIGNER_PASSPHRASE && BURNKEEPER_SIGNER_PATH=$HOME/.config/meme-coin-trader/signer-burnkeeper.enc.json node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/burnkeeper-keygen.mjs --new
```

Platform keeper, in the same shell:

```bash
BURNKEEPER_SIGNER_PATH=$HOME/.config/meme-coin-trader/signer-burnticker.enc.json node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/burnkeeper-keygen.mjs --new; unset BURNKEEPER_SIGNER_PASSPHRASE; ls -la ~/.config/meme-coin-trader/
```

Put `BURNKEEPER_SIGNER_PASSPHRASE` in the host env file `.env.local` by hand (mode 600). That is the **only** place it lives: never in
the repo, a unit file or a command line. deploy.md, the provision script, `run-burnkeeper.sh` and `scripts/load-env.sh` now all say the same
thing (fixed 2026-10-10). Linux has no Keychain, so state it on the trust page as a known limitation. Then set
`BURNTICKER_KEEPER_PUBKEY` to the content of `signer-burnticker.enc.json.address`, and send 0.3 SOL to the $DEFICIT keeper address and 0.1 SOL
to the platform keeper.

### B3. Squads on mainnet (owner; members A = Ledger, B = owner second key, C = trusted third)

```bash
squads-multisig-cli multisig-create --keypair usb://ledger --members "<A_PUBKEY>,7" "<B_PUBKEY>,7" "<C_PUBKEY>,7" --threshold 2
```

```bash
squads-multisig-cli config-transaction-create --keypair usb://ledger --multisig-pubkey <MULTISIG> --action "SetTimeLock 172800" && squads-multisig-cli proposal-vote --keypair usb://ledger --multisig-pubkey <MULTISIG> --transaction-index 1 --action approve && squads-multisig-cli proposal-vote --keypair <B_KEYPATH> --multisig-pubkey <MULTISIG> --transaction-index 1 --action approve
```

```bash
squads-multisig-cli config-transaction-execute --keypair usb://ledger --multisig-pubkey <MULTISIG> --transaction-index 1 && squads-multisig-cli display-vault --multisig-address <MULTISIG> --vault-index 0
```

The CLI's default RPC is assumed to be mainnet. Add `--rpc-url $MAINNET_RPC` if it is not (unverified).

### B4. Verifiable mainnet build, its hash, tag, public repo (gate 13)

Build on the D-7 id. The mainnet build is the default features: no `--features devnet`. Docker must be running.

```bash
git switch -c deploy/mainnet-<YYYY-MM-DD> <DEVNET_REHEARSED_COMMIT> && (cd programs/burn-receipts && anchor build --verifiable && solana-verify get-executable-hash target/verifiable/burn_receipts.so)
```

Record the hash in README §5.4 (it replaces the "owner records it here" note) and as `BURNTICKER_PROGRAM_HASH` on the host. Commit, then
tag `burn-receipts-mainnet-<YYYY-MM-DD>` (the tag name is a suggestion). Then publish the public tree:

```bash
sh scripts/ops/publish-public-repo.sh --check && sh scripts/ops/publish-public-repo.sh --tag --verify
```

### B5. Deploy the verifiable `.so`

The deployed hash must equal the **verifiable** hash (§5.3/§5.4), so deploy the verifiable artefact. README §5.1 now says the same (fixed
2026-10-10): Docker is required, and the verifiable build runs on the Linux VPS. Copy the `.so` back to the Mac first.

```bash
solana program deploy programs/burn-receipts/target/verifiable/burn_receipts.so --program-id programs/burn-receipts/target/deploy/burn_receipts-keypair.json --upgrade-authority "$M/deployer.json" --keypair "$M/deployer.json" --url mainnet-beta --with-compute-unit-price <MICROLAMPORTS>
```

```bash
solana program show <PROGRAM_ID> --url mainnet-beta && solana-verify get-program-hash -u mainnet-beta <PROGRAM_ID>
```

### B6. *(optional, D-6)* `initialize_platform`

This is the A6 line with `CLUSTER=mainnet RPC=$MAINNET_RPC PAYER="$M/deployer.json" UPGRADE_AUTHORITY="$M/deployer.json"` and
`BURNKEEPER_MAINNET=1` on the `SEND=1` line. It must run before B7.

### B7. Upgrade authority → the vault

```bash
solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <VAULT> --skip-new-upgrade-authority-signer-check --upgrade-authority "$M/deployer.json" --keypair "$M/deployer.json" --url mainnet-beta && solana program show <PROGRAM_ID> --url mainnet-beta
```

### B8. Drain the deployer (gate 12: "deployer ≈ 0")

```bash
solana transfer <OPS_PAYER_PUBKEY> ALL --keypair "$M/deployer.json" --url mainnet-beta && solana balance "$(solana-keygen pubkey "$M/deployer.json")" --url mainnet-beta
```

### B9. The real LaunchLab platform config (runbook launch step 1, moved here; D-3 admin)

Dry run. `--admin` is the encrypted file, so unlock it with `read -rs BURNKEEPER_SIGNER_PASSPHRASE; export BURNKEEPER_SIGNER_PASSPHRASE` first.

```bash
R scripts/burnkeeper-launch.mts platform --cluster mainnet --rpc "$MAINNET_RPC" --admin "$M/platform-admin.enc.json" --fee-wallet <DEV_FEE_HW_PUBKEY> --web https://burnticker.com --img https://burnticker.com/icon.png > /tmp/platform-dry.json; jq '{platformId, admin, feeWallet, dials, problems, sim: .simulation.err, feeSplit}' /tmp/platform-dry.json
```

*Read:* `platformFeeBps 25`, `burnPoolFeeBps 50`, `lpToPlatformPpm "1000000"` (LP locked forever), `lockNftWallet` = `feeKeysPda`, `cpConfig.index 0`,
`tradeFeeBps 25`, `creatorFeeBps 5`, `problems: []`, and a null simulation error. `problems` names "operator treasury is not pinned" until the
owner compiles the mainnet Squads vault into burn_receipts (TODO-OWNER): without it every claim refuses `TreasuryNotPinned` and the LP fees
stay in the lock. Then send:

```bash
BURNKEEPER_MAINNET=1 R scripts/burnkeeper-launch.mts platform --cluster mainnet --rpc "$MAINNET_RPC" --admin "$M/platform-admin.enc.json" --fee-wallet <DEV_FEE_HW_PUBKEY> --web https://burnticker.com --img https://burnticker.com/icon.png --send --i-understand-this-spends-real-sol > /tmp/platform.json; jq '{platformId, sent, explorer}' /tmp/platform.json
```

Set `BURNTICKER_PLATFORM_ID` to it on the Mac and in the host's `.env.local`. Also set `BURNTICKER_PLATFORM_ADMIN` to the admin pubkey (for the
trust page).

### B10. $REHEARSAL mint and rules file

The mint keypair:

```bash
solana-keygen new --no-bip39-passphrase --silent -o "$M/mint-rehearsal.json" && chmod 600 "$M/mint-rehearsal.json" && solana-keygen pubkey "$M/mint-rehearsal.json"
```

The rules file is $DEFICIT's file (D-4 wording already applied), renamed. `token`, `ticker` and `memo.prefix` must be equal, 2–12
capitals or digits (rules.ts), and the on-chain memo prefix is at most 12 bytes. Commit the result, because it is published byte for byte.

```bash
jq --arg m "$(solana-keygen pubkey "$M/mint-rehearsal.json")" '.mint=$m | .token="REHEARSAL" | .ticker="REHEARSAL" | .memo.prefix="REHEARSAL" | .statement = ("REHEARSAL COIN, a disclosed throwaway that tests the Burnticker machinery on mainnet; not for trading. " + .statement)' config/burnkeeper/deficit.rules.json > config/burnkeeper/rehearsal.rules.json && jq '{token, ticker, mint, memo}' config/burnkeeper/rehearsal.rules.json
```

### B11. Rules sha

```bash
BURNKEEPER_RULES=config/burnkeeper/rehearsal.rules.json R scripts/burn-keeper.mts --print-rules
```

### B12. Refuse lists and trust page before the create (Claude)

1. `config/own-tokens.json`: the REHEARSAL entry gets `"address": "<mint>", "status": "launched"`.
2. `config/burnticker/transparency.json` → `rehearsals[0]`: date, mint, status, and text. The current text says "to prove fee routing and
   burns", which is wrong after D-2: it proves fee routing and the claim, not burns.
3. Commit both, and ship `config/own-tokens.json` to the trading VPS. The arms re-read it by mtime, with no restart. ⚠ The exact ship command
   for the trading VPS is not in these docs. Claude uses the usual trading-VPS deploy.

### B13. `initialize_token` on mainnet

The `KEEPER_PUBKEY` is the host's `signer-burnkeeper.enc.json.address`. The payer is the ops payer. `FLOOR_LAMPORTS` is set per D-5.

```bash
CLUSTER=mainnet RPC="$MAINNET_RPC" PROGRAM_ID=<PROGRAM_ID> PAYER="$M/ops-payer.json" MINT_KEYPAIR="$M/mint-rehearsal.json" RULES=config/burnkeeper/rehearsal.rules.json KEEPER_PUBKEY=<HOST_KEEPER_ADDRESS> ADMIN=<VAULT> FLOOR_LAMPORTS=<FLOOR_LAMPORTS_D5> SEND=0 R --input-type=module -e "$(cat "$H/init-token.mjs")"
```

Then the same with `SEND=1 BURNKEEPER_MAINNET=1`.

### B14. Create $REHEARSAL (the 0.1 SOL first buy is the disclosed rehearsal buy)

Publish the metadata JSON at `<REHEARSAL_METADATA_URL>` first.

```bash
R scripts/burnkeeper-launch.mts launch --cluster mainnet --rpc "$MAINNET_RPC" --payer "$M/ops-payer.json" --mint-keypair "$M/mint-rehearsal.json" --rules config/burnkeeper/rehearsal.rules.json --name REHEARSAL --symbol REHEARSAL --uri <REHEARSAL_METADATA_URL> --raise-sol 85 --first-buy-sol 0.1 > /tmp/rehearsal-dry.json; jq '{creator, feePda: .burnPool.feePda, creatorIsFeePda: .burnPool.creatorIsFeePda, placeholder: .burnPool.programIdIsLocalnetPlaceholder, platformId, rulesSha: .rules.sha256, firstBuy, warnings, problems, sim: .simulation.create.err}' /tmp/rehearsal-dry.json
```

```bash
BURNKEEPER_MAINNET=1 R scripts/burnkeeper-launch.mts launch --cluster mainnet --rpc "$MAINNET_RPC" --payer "$M/ops-payer.json" --mint-keypair "$M/mint-rehearsal.json" --rules config/burnkeeper/rehearsal.rules.json --name REHEARSAL --symbol REHEARSAL --uri <REHEARSAL_METADATA_URL> --raise-sol 85 --first-buy-sol 0.1 --send --i-understand-this-spends-real-sol > /tmp/rehearsal.json; jq '{mint, poolId, creatorFeeVault: .creatorFeeVault.address, platformFeeVault, platformId, sent}' /tmp/rehearsal.json && cp /tmp/rehearsal.json "$M/"
```

### B15. Gate 3: fee routing

```bash
jq '.creator, .burnPool.feePda, .burnPool.creatorIsFeePda, .firstBuy.feeLamports' /tmp/rehearsal.json
```

```bash
for a in $(jq -r .creatorFeeVault.address /tmp/rehearsal.json) $(jq -r .platformFeeVault /tmp/rehearsal.json); do curl -s "$MAINNET_RPC" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getTokenAccountBalance","params":["'$a'"]}' | jq -r --arg a $a '"\($a)  \(.result.value.uiAmountString // .error.message)"'; done
```

*Pass:* the first command prints the same address twice and `true`. The creator vault holds about 0.0005 SOL (0.5% of 0.1) and the platform
vault about 0.00025 SOL (0.25%). Both should match `firstBuy.feeLamports.creatorToBurnPool` / `.platform`.

### B16. Claim against mainnet LaunchLab (also proves the mainnet build's LaunchLab id)

```bash
ACTION=claim CLUSTER=mainnet RPC="$MAINNET_RPC" PROGRAM_ID=<PROGRAM_ID> PAYER="$M/ops-payer.json" MINT=$(jq -r .mint /tmp/rehearsal.json) SEND=0 R --input-type=module -e "$(cat "$H/act.mjs")"
```

Then the same with `SEND=1 BURNKEEPER_MAINNET=1`. *Pass:* confirmed, the creator vault is about 0, and the probe's `feeWsol` has grown.

### B17. Keeper instance for the rehearsal (host, as `mct`; by hand, because the systemd unit pins `BURNKEEPER_RULES` to $DEFICIT's file)

Values on the command line win over `.env.local`. Set the seed fields explicitly so $DEFICIT's values never show up on this page.

```bash
BURNKEEPER_EXECUTION=program BURNKEEPER_MAINNET=1 BURNTICKER_PROGRAM_ID=<PROGRAM_ID> BURNKEEPER_MINT=<REHEARSAL_MINT> BURNKEEPER_RULES=config/burnkeeper/rehearsal.rules.json BURNKEEPER_RULES_SHA=<B11_SHA> BURNKEEPER_DB=data/burnkeeper-rehearsal.db BURNKEEPER_PUBLISH_DIR=data/burnkeeper-rehearsal-site BURNKEEPER_CREATOR_FEE_SOURCE=<REHEARSAL_CREATOR_FEE_VAULT> BURNKEEPER_SEED_TX=none BURNKEEPER_SEED_SOL=0 sh scripts/service/run-burnkeeper.sh --once
```

Check:

```bash
jq '{execution, cluster, addresses, funding: .buyback.funding, attestation: .program.attestation, queue: .program.queue}' data/burnkeeper-rehearsal-site/status.json
```

The first run attests the newest Treasury reading as the baseline. Rerun the same line after the 14:30 Denver poll. It should attest the
next reading and log `[program] … waiting for the CPMM pool` (D-2). To keep it running between runs, a user-level timer or a tmux loop would
do. That is a D-8 decision.

### B18. Disclose (gate 2)

Append one line to `docs/burnticker/incidents/LOG.md`, saying $REHEARSAL was created: date, mint, purpose, the 0.1 SOL buy, and what it cannot
prove. Commit it and the B12 files, ship the build (`sh scripts/ops/deploy-burnticker-host.sh`), and check that
`https://burnticker.com/burnticker/trust` lists the rehearsal.

### B19. What $REHEARSAL proves, and what it does not

| Proven on mainnet | Not proven (devnet only, gate 1) |
|---|---|
| The program deploys, the verifiable hash matches, and Squads holds the upgrade authority | `register_pool` (no graduation below a 24 SOL raise) |
| Platform dials read live: 25 bps dev, 50 bps burn pool, LP 100% locked to the fee-keys PDA | `crank_buyback`: swap, burn, memo |
| creator = fee PDA; curve fees accrue to the right vaults | `collect_creator_fee_permissionless` (CPMM) |
| `claim_launchlab_creator_fee` against the real mainnet LaunchLab | the TWAP guard on a real mainnet pool |
| `initialize_token` with mainnet genesis binding; `submit_reading` attested by the host key; the status page | the mainnet CPMM program id compiled into the build (see D-1) |

### B20. Retirement

There is nothing to retire. The TokenConfig cannot be closed, and no one can withdraw from the fee PDA. The page says "rehearsal". Per D-8,
state whether the keeper keeps attesting it. If attesting stops, nothing more is burned, and the fee PDA balance stays where it is.

---

## C. $DEFICIT launch day (a weekday; the create goes out 08:00–09:00 Denver)

Preconditions: every gate in §C-gates is ticked; D-1 to D-8 are settled; the host is fully provisioned, with both keepers **installed and
stopped**; the platform config and program come from B. `/tmp` is cleared on reboot, so copy every JSON into `$M/` as you go.

| # | When (Denver) | WHO | Step | Expected / proof |
|---|---|---|---|---|
| C1 | day before | Claude | Confirm the program, Squads, platform dials and host state (no send) | `solana program show` → vault; platform dials as B9; host `--check` clean |
| C2 | day before | owner + Claude | Mint keypair; `"mint"` into `deficit.rules.json`; D-4 edits; own-tokens; commit and ship | `jq .mint` = the mint pubkey |
| C3 | day before | either | Rules sha → publish and set `BURNKEEPER_RULES_SHA` on the host | sha on the site / metadata |
| C4 | day before | owner | Metadata JSON live at `<URI>` (name/symbol DEFICIT; description = rule sentence + disclaimer + rules sha; image) | `curl -s <URI> \| jq .` |
| C5 | 07:30 | owner | `initialize_token` (mainnet) | read-back as A11, mainnet genesis |
| C6 | 07:45 | owner + second reader | Dry run, then **the two-person pre-send read** (gate 4) | the initialed `/tmp/deficit-dry.json` |
| C7 | 08:00–09:00 | owner | LaunchLab create `--send`, **no team buy** | `$M/deficit.json` |
| C8 | right after | owner | Seed 3 SOL into the **fee PDA** | the seed signature |
| C9 | right after | owner | Keeper key funded (≥ 0.1, budget 0.3 SOL) | balance |
| C10 | right after | Claude (host) | Final `.env.local`; start `mct-burnkeeper` and `mct-burnticker-keeper`; publish the sites | log banners |
| C11 | +10 min | Claude | First receipt check | status.json fields |
| C12 | after C11 | owner | Mint-first posts (gate 5) from `burnkeeper-post-draft.mts` drafts (gate 9) | bios + site |
| C13 | 14:30 / 18:00 | Claude | First unit reading attested; curve claim | log + status |
| C14 | after graduation | anyone (Claude stages) | `register_pool` | confirmed |
| C15 | +20–40 min | Claude | First crank defers (`TwapUnavailable`), then burns; receipt verified | `burns.json` verified |
| C16 | after C15 | owner (Squads 2 of 3) | Finalise (D-1), with the pre-finalisation assertions | `Authority: none` |
| C17 | +14 days | owner | Signer two (zkTLS relayer or a second operator), `propose_attesters` with a quorum raise to 2 (F2) | trust page date |

### C1. Day-before state check

```bash
solana program show <PROGRAM_ID> --url mainnet-beta && solana-verify get-program-hash -u mainnet-beta <PROGRAM_ID>
```

Probe the rehearsal mint as a mainnet smoke test (read only):

```bash
CLUSTER=mainnet RPC="$MAINNET_RPC" PROGRAM_ID=<PROGRAM_ID> MINT=$(jq -r .mint "$M/rehearsal.json") R --input-type=module -e "$(cat "$H/probe.mjs")"
```

### C2. Mint, rules, refuse list (runbook launch step 3)

```bash
solana-keygen new --no-bip39-passphrase --silent -o "$M/mint-deficit.json" && chmod 600 "$M/mint-deficit.json" && solana-keygen pubkey "$M/mint-deficit.json"
```

Then (Claude):

1. Write `"mint": "<pubkey>"` into `config/burnkeeper/deficit.rules.json` (D-4 edits already merged). Write `"address": "<pubkey>", "status":
   "launched"` into `config/own-tokens.json`.
2. Commit both, and ship `own-tokens.json` to the trading VPS.
3. Ship the repo to the host (`sh scripts/ops/deploy-burnticker-host.sh --no-build`), so the host's rule file has the mint.

### C3. Rules sha (gate 4 compares against it)

```bash
R scripts/burn-keeper.mts --print-rules
```

Put the sha on the site, in the metadata description, and in the first post's draft. Set `BURNKEEPER_RULES_SHA=<sha>` in the host's
`.env.local`. Also run it on the host and confirm the same sha, which proves the host has the same bytes:

```bash
R scripts/burn-keeper.mts --print-rules
```

### C5. `initialize_token`

```bash
CLUSTER=mainnet RPC="$MAINNET_RPC" PROGRAM_ID=<PROGRAM_ID> PAYER="$M/ops-payer.json" MINT_KEYPAIR="$M/mint-deficit.json" RULES=config/burnkeeper/deficit.rules.json KEEPER_PUBKEY=<HOST_KEEPER_ADDRESS> ADMIN=<VAULT> FLOOR_LAMPORTS=<FLOOR_LAMPORTS_D5> SEND=0 R --input-type=module -e "$(cat "$H/init-token.mjs")"
```

Then the same with `SEND=1 BURNKEEPER_MAINNET=1`. Read back: `rulesSha256` = C3, attesters = [host keeper] quorum 1, admin = `<VAULT>`,
`clusterGenesis` = `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`, `rule.fraction_per_unit_bps` = 100, twap 300 / 1200, `floor_lamports` = D-5. The
keeper refuses to run if the sha, mode, prefix or decimals differ.

### C6. Dry run and the two-person read (gate 4)

```bash
R scripts/burnkeeper-launch.mts launch --cluster mainnet --rpc "$MAINNET_RPC" --payer "$M/ops-payer.json" --mint-keypair "$M/mint-deficit.json" --name DEFICIT --symbol DEFICIT --uri <METADATA_URL> --raise-sol 85 > /tmp/deficit-dry.json; cp /tmp/deficit-dry.json "$M/"; jq '{mint, creator, feePda: .burnPool.feePda, creatorIsFeePda: .burnPool.creatorIsFeePda, placeholder: .burnPool.programIdIsLocalnetPlaceholder, platformId, decimals: .curve.decimals, supplyRaw: .curve.supplyRaw, raise: .curve.raiseLamports, firstBuy, rulesSha: .rules.sha256, rulesMint: .rules.mint, warnings, problems, sim: .simulation.create.err}' /tmp/deficit-dry.json
```

Both readers initial each field next to this checklist:

- `mint` = C2;
- `creator == feePda` and `creatorIsFeePda: true`;
- `placeholder: false`;
- `platformId` = B9;
- `decimals: 6`;
- `supplyRaw "1000000000000000"`;
- `raise "85000000000"`;
- `firstBuy: null` (no team buy);
- `rulesSha` = C3 = the host's `BURNKEEPER_RULES_SHA`;
- `rulesMint` = mint;
- `problems: []`;
- `sim: null`;
- the metadata URI and image open.

The second reader is a person (the Squads member C) or, failing that, Claude reading it aloud. Write down which.

### C7. Create, with no team buy (`--first-buy-sol` defaults to 0)

```bash
BURNKEEPER_MAINNET=1 R scripts/burnkeeper-launch.mts launch --cluster mainnet --rpc "$MAINNET_RPC" --payer "$M/ops-payer.json" --mint-keypair "$M/mint-deficit.json" --name DEFICIT --symbol DEFICIT --uri <METADATA_URL> --raise-sol 85 --send --i-understand-this-spends-real-sol > /tmp/deficit.json; cp /tmp/deficit.json "$M/"; jq '{mint, poolId, creatorFeeVault: .creatorFeeVault.address, platformFeeVault, cpmmAfterGraduation, rules, sent}' /tmp/deficit.json
```

If `sent.create.status` reads "unknown after 120 s", check the explorer **before** doing anything else (§D).

### C8. Seed 3 SOL into the fee PDA (a disclosed gift; nothing can withdraw it)

```bash
solana transfer $(jq -r .burnPool.feePda "$M/deficit.json") 3 --allow-unfunded-recipient --keypair "$M/ops-payer.json" --url mainnet-beta
```

On the host's `.env.local`: `BURNKEEPER_SEED_TX=<sig>` and `BURNKEEPER_SEED_SOL=3`.

### C10. Start the keepers (host, as `mct`)

`.env.local` now has every name in 0.3. That includes `BURNKEEPER_MINT=<mint>` and `BURNKEEPER_CREATOR_FEE_SOURCE=<creatorFeeVault>`, and
**not** `BURNKEEPER_CLAIM_CREATOR_FEES`.

```bash
systemctl --user start mct-burnkeeper && sleep 20 && tail -n 20 logs/burnkeeper.log
```

The banner should read `execution program`, mainnet, the mint, the fee PDA, attesters 1 (quorum 1), the rules sha. Then come
`[attest] … attested and submitted` (the baseline), `[fees] curve: …`, and `waiting for the CPMM pool`.

```bash
systemctl --user start mct-burnticker-keeper && sleep 20 && tail -n 20 logs/burnticker-keeper.log
```

```bash
sh scripts/ops/deploy-sites.sh
```

### C11. First receipt check (no burn is expected before graduation)

```bash
curl -s https://<DEFICIT_HOST>/status.json | jq '.execution, .rules.sha256, .addresses.mint, .buyback.funding, .program.attestation, .program.queue'
```

### C14. After graduation: `register_pool`

Graduation could be days away, or never. Find the pool first (block P with `AMM_CONFIG=$(jq -r .cpmmAfterGraduation.ammConfig "$M/deficit.json")`
and then `POOL=`). Run the K4 checks. Then:

```bash
ACTION=register_pool CLUSTER=mainnet RPC="$MAINNET_RPC" PROGRAM_ID=<PROGRAM_ID> PAYER="$M/ops-payer.json" MINT=<DEFICIT_MINT> POOL=<CPMM_POOL> SEND=0 R --input-type=module -e "$(cat "$H/act.mjs")"
```

Then the same with `SEND=1 BURNKEEPER_MAINNET=1`. The keeper's next cycle checks pool health and cranks. The first crank waits
`TwapUnavailable` for about 20 min (window 1,200 s), then burns. Verify as in A23, on `data/burnkeeper-site/`.

### C16. Finalise (D-1)

Run README §5.3's assertions first:

1. `solana program show` → vault.
2. `solana account <PLATFORM_PDA>`, or accept the default (D-6).
3. **A real mainnet `crank_buyback` has burned** (C15).
4. `solana-verify get-program-hash` = the B4 hash.

Then make the Squads vault transaction (README §5.3; rehearsed in A25), get 2 of 3 approvals, wait out the 48 h lock, and execute. `solana
program show` must print `Authority: none`. Then set `BURNTICKER_UPGRADE_AUTHORITY` to `none` and update the trust page.

### C-gates: the 13 go/no-go gates (runbook) + gate 14 (README §5.3 / F16). No gate, no `--send` in C7.

| # | Gate | Proof artefact (path) | Made in |
|---|---|---|---|
| 1 | Devnet program path end to end | `docs/burnkeeper/devnet-run.md` §4 filled; `data/burnkeeper-devnet-site/burns.json` with one `confirmed`, `execution: "program"`, `verify.verified: true`; `status.json .program.attestation.lastReading` set | A26 |
| 2 | Mainnet rehearsal coin, **amended per D-2** | `$M/rehearsal.json` (`mint, poolId, creatorFeeVault, platformId`); `data/burnkeeper-rehearsal-site/status.json` with an attested reading; the B16 claim signature; the trust page rehearsal row; the `docs/burnticker/incidents/LOG.md` line. ⚠ The runbook's artefact (`data/burnticker-site/t/REHEARSAL/receipts.json` with a confirmed burn, `audit.json ok`) cannot be produced: the Burnticker wizard uses `FakeLaunchLab` (`src/lib/burnticker/server.ts`), and a 0.1 SOL coin cannot burn | B14–B18 |
| 3 | Fee routing 50 / 25 bps on real trades | `jq '.creator, .burnPool.feePda, .burnPool.creatorIsFeePda' $M/rehearsal.json` → the same address twice + `true`; the B15 balance lines | B15 |
| 4 | Two-person pre-send read | `$M/deficit-dry.json` initialed; `jq .rules.sha256` = `--print-rules` = `BURNKEEPER_RULES_SHA` | C6 |
| 5 | Mint-first announcement | screenshots of both bios; `grep -c <mint> /var/www/deficit/index.html` ≥ 1; `curl -s https://<DEFICIT_HOST>/status.json \| jq .addresses.mint` | C12 |
| 6 | Feed-late paragraph on the site | `grep -i "late" /var/www/deficit/index.html` | before C7 |
| 7 | No Telegram or Discord | the line in `statements` (`src/lib/burnticker/trust.ts`) on `/burnticker/trust`; `grep -ri "t.me\|discord" site/ src/app/burnticker` → nothing | before C7 |
| 8 | Failure definition on the trust page | the sentence in `statements` in trust.ts, visible and quoted in the thread | before C7 |
| 9 | Copy lint: every post from `scripts/burnkeeper-post-draft.mts` | the saved drafts (exit 0) + the owner's OK | C12 |
| 10 | Alerts end to end | the webhook `curl` → 200 (runbook "On each alert"); the `bt-test` row on the trading VPS; Telegram received; `ops.json .webhook.lastOkAt` set | B1 |
| 11 | Backups scheduled | `crontab -l` shows the runbook's backup line; a file in `~/backups/` newer than 6 h with `PRAGMA quick_check` = ok (include `burnkeeper.db` and `burnkeeper-rehearsal.db`) | B1 |
| 12 | Keys | host `ls -la ~/.config/meme-coin-trader/` (two `.enc.json`, mode 600, made there, B2); `solana program show` → vault (B7); the platform authority (only if D-6 changes) = vault; the LaunchLab platform admin disclosed (D-3); `solana balance <deployer>` ≈ 0 (B8) | B2, B7, B8 |
| 13 | Public repo at the tagged commit with the program hash | the tag; the trust page's program section shows `BURNTICKER_PROGRAM_HASH`; `solana program dump <id> program.so --url mainnet-beta && shasum -a 256 program.so` (the Mac has no `sha256sum`), or better `solana-verify get-program-hash`, equals it | B4, B5 |
| 14 | *(new, F16)* `Authority: none` + verified hash before announcing | `solana program show` → `Authority: none`; status page states the authority + hash. **Per D-1 this sheet moves it to after C15**, which the owner must accept on purpose | C16 |

---

## D. Rollback and abort points

The rule: **nothing destructive, no key reuse.** A step that failed is left as it is. Read the chain before you retry. A mint keypair that
has been through `initialize_token` or a create is retired for good. Devnet keys never touch mainnet.

| Step | Can it be undone? | What is left if you stop here | How to recover from a mid-way failure |
|---|---|---|---|
| Deploy (A4/B5) | Yes, while the deployer or vault holds the authority (`solana program close` returns the rent) | a program nobody uses | A failed deploy leaves a **buffer** holding SOL. `solana program show --buffers --url <cluster>`, then `solana program close <BUFFER>` refunds it. Re-run the deploy. |
| `initialize_platform` (A6/B6) | No (one per program; raise-only, sunset fixed) | a disclosed authority | Simulate first. If it landed, it landed. Read `solana account <PLATFORM_PDA>`. |
| Upgrade authority → vault (A7/B7) | Only through a Squads 2-of-3 proposal (48 h on mainnet) | Squads-controlled program | Check `solana program show`. A typo'd vault address is the one real danger, so paste it from `display-vault` and read `show` before B8. |
| LaunchLab platform config (A10/B9) | Fields can be changed with LaunchLab `update_platform_config` (no tool here); the `platformId` is fixed per admin key | a platform with no coins | If the dials are wrong, **do not launch**. Fix them with an update (Claude stages it) before any coin. |
| `initialize_token` (A11/B13/C5) | **No.** The TokenConfig and rule for that mint are permanent. The 0.02 SOL reserve stays in its fee PDA | a config for a mint that may never exist | If you abort after it, **retire that mint keypair**. A new launch needs a new mint, a new `"mint"` in the rules, a new sha, and a new `initialize_token`. A second `initialize_token` for the same mint is refused by the program. |
| LaunchLab create (A12/B14/C7) | **No.** The coin is public | the coin trades | "unknown after 120 s": look up the signature on the explorer and run the probe (`launchlab` present?) before retrying. Re-running with the same mint is refused once the mint exists. Never "fix" anything with a second coin. |
| Seed transfer (A14/C8) | **No** (no withdraw path) | — | Check the signature before resending. Never send twice blind. |
| Keeper start (A15/C10) | Yes: stop the unit or `touch data/PAUSE-burnkeeper` | — | Restart only between cycles (pause → one quiet cycle → restart → unpause; runbook). Signatures are written ahead, so a restart cannot attest or crank twice. |
| `register_pool` (A20/C14) | No (once per token), but anyone can retry after a refusal | — | A refusal changes nothing. Read the error (K4) and fix the cause. There is nothing to undo. |
| Finalise (A25/C16) | **No, ever** | — | Run every §5.3 assertion first. |

Abort before C7 (the create) and $DEFICIT does not exist. Everything up to then is disclosed infrastructure. Abort after C5 but before C7 and
only that mint is spent. After C7, the only "rollback" is publishing the facts. The failure definition (gate 8) applies: no relaunch, no v2.

---

## E. Flags and commands that could not be confirmed (treat as unverified)

- **`squads-multisig-cli`** (every subcommand and flag in A5, B3, A25). It is not installed here. The commands are copied from README §5.2,
  which says they were checked against the 0.1.7 source. `--rpc-url` placement and the default cluster were not checked.
  `vault-transaction-create` needs a serialized message (use the Squads app).
- **`solana-verify`** (`get-executable-hash`, `get-program-hash -u`, `verify-from-repo`) and **`anchor build --verifiable`**: not installed or
  no Docker. Anchor's `--verifiable` flag exists (`anchor build --help`).
- **`solana transfer <to> ALL`** (B8): `transfer --help` lists `--allow-unfunded-recipient`. The `ALL` amount keyword was not run here.
- **`solana confirm -v … | grep memo`**: the output format was not checked.
- **`solana program deploy --with-compute-unit-price`** exists in `--help` (4.3.0). The right price on the day is not known.
- **Raydium devnet UI URLs** (`raydium.io/launchpad/…?cluster=devnet`) and whether Raydium's devnet migration crank runs (K3).
- **Whether the TWAP becomes available from elapsed time alone or needs trades across the window** (K5 assumes trades are needed).
- **`npm test` after `anchor keys sync`** (A3c): not run with a real id. A test may pin the localnet id.
- **Provision step 9's stdin passphrase hand-off** (fixed 2026-10-10): tested with the real keygen through `sh -c` on the Mac, not through `su -` on a box.
- **The trading-VPS ship command for `config/own-tokens.json`** (B12, C2): not in these docs.
- **`--lock-nft-wallet`** exists in `burnkeeper-launch.mts platform` (code) but not in its usage header (not used here).
- Every `burnkeeper-launch.mts`, `burn-keeper.mts`, `burnkeeper-keygen.mjs`, `provision-burnticker-host.sh`, `deploy-sites.sh`,
  `deploy-burnticker-host.sh` and `publish-public-repo.sh` flag used above was checked against the source. `burnkeeper-launch.mts launch` was
  dry-run on devnet with `--simulate-as` (simulation success, 185,332 CU). The three helper snippets were dry-run (see 0.6).

---

## F. Where the docs disagree with the code, or with each other

Items marked **[fixed 2026-10-10]** were corrected on this branch after the first version of this sheet. The rest are owner decisions
(the D-table) or remain open.

1. **[fixed 2026-10-10]** **TWAP parameters.** Runbook launch step 5: `maxTwapDeviationBps: 500, twapWindowSecs: 600`. Code since F1: deviation ≤ 300 and
   `deviation × window ≥ 150,000`. 500 is refused at init. This sheet uses 300 / 1,200 (README §1).
2. **Finalisation timing.** README §5.3 / CHANGELOG F16 (10-10): finalise before announcing. The runbook (gate 12, launch step 2) and
   LAUNCHPAD §17.2: Squads at launch. README §5.1 also says "mainnet only after an audit", while LAUNCHPAD §19 decided on no paid audit. Moved
   to D-1.
3. **Gate 2 cannot be met as written.** A 0.1 SOL coin cannot graduate (24 SOL minimum), so it cannot burn. The artefact path
   (`data/burnticker-site/t/REHEARSAL/receipts.json`) is the Burnticker registry, but the wizard's LaunchLab is `FakeLaunchLab` and the real
   launch path is `burnkeeper-launch.mts`. transparency.json's devnet text ("three tokens, cranks from a second machine, the create wizard end to
   end") and its rehearsal text ("prove … burns") are wrong for the same reasons.
4. **[fixed 2026-10-10]** **The verifiable hash cannot match the deployed program as README §5.1 is written.** It deploys `target/deploy/…so` (non-verifiable),
   then §5.3 and §5.4 require the verifiable hash. Deploy `target/verifiable/…so` instead.
5. **`initialize_token` has no CLI.** The runbook and devnet-run point at `initializeTokenIx`. The same is true of `register_pool`,
   `claim_launchlab_creator_fee` and `initialize_platform`. This sheet supplies the snippets in 0.6.
6. **[fixed 2026-10-10]** **`$R` breaks in zsh** (devnet-run.md, runbook) on the owner's Mac. This sheet uses a function.
7. **[fixed 2026-10-10]** **devnet-run.md "no Solana CLI"** is out of date. CLI 4.3.0 and Anchor 1.2.1 are installed.
8. **[fixed 2026-10-10]** **`BURNKEEPER_CLAIM_CREATOR_FEES`.** deploy.md's env table and the `run-burnkeeper.sh` header still document it, with "the keeper must be
   the creator". The runbook (step 8) says do not set it. Program mode ignores it, and legacy refuses it. fees.md §4 still describes the flag as
   the claim switch.
9. **[fixed 2026-10-10]** **fees.md "Migration".** It says "ours does too, so `pool_creator = the keeper`". Since H-2 it is the fee PDA (fees.md's own correction
   box, burnPool.ts).
10. **LAUNCHPAD §15/§18.** "keeper key now, program fee PDA later" and "launch at level 1". The newer code launches on the program path with the
    fee PDA as creator from day one.
11. **[fixed 2026-10-10]** **Runbook launch step 10.** "quorum ≥ 2 waits for the client's v0 / shared-message submission". That landed on 10-10 (CHANGELOG F4). Also
    F2: at quorum 1, a new key can only be added together with a raise to quorum 2.
12. **Who the LaunchLab platform admin is.** Runbook gate 12 says "the PlatformConfig admin = the Squads vault". The CLI needs a key file
    (D-3), and trust.ts lists the LaunchLab admin as a plain key. Gate 12 can only mean burn_receipts' own PlatformConfig authority (D-6).
    trust.ts also says the admin's fee change affects "FUTURE launches" in one place and "new trades" in another. Whether it changes fees on live
    curves was not checked.
13. **[fixed 2026-10-10]** **Platform CLI defaults.** `--web/--img` default to `burnticker.com`, and `burnticker-platform-config.mts` uses `burnticker.com`. The
    site is `burnticker.com`.
14. **[fixed 2026-10-10]** **Where the passphrase lives.** deploy.md and provision say `.env.local`. `scripts/load-env.sh` says never there.
15. **[fixed 2026-10-10]** **Provision step 9** cannot pass the passphrase through `su` (B1 note). It would also expose it in the process list.
16. **[fixed 2026-10-10]** **Rules file text** (D-4): a "PENDING" decision note, a "next transaction" statement, `router: jupiter`, all inside the hashed bytes.
17. **README §3 launch-day order** lists "initialize_token → rules sha published". `rules_sha256` is an argument of `initialize_token`, so
    the sha must be **computed** before it (publishing can come after). The runbook's order (sha at step 4, init at step 5) is the right one.
18. **The `burnkeeper-keygen.mjs` header** still calls the key "the burn vault's only authority and the vesting beneficiary". In program mode
    it is an attester and fee payer only (README-execution §3).
19. **[fixed 2026-10-10]** **The `run-burnkeeper.sh` header** documents legacy behaviour. It does not mention `BURNKEEPER_EXECUTION` or `BURNTICKER_PROGRAM_ID`, both of
    which the keeper reads.
20. **`OPERATOR_LINE`** — RESOLVED 2026-10-10: contact@burnticker.com (iCloud+ custom domain; security@burnticker.com for the bounty).
