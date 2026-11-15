# Devnet run log — burn_receipts round 5 (+ review fixes), 2026-10-15

Run by Claude (agent) on the Mac, worktree `.claude/worktrees/agent-r5devnet`, branch `worktree-agent-r5devnet` (the round-5 fix branch
`worktree-agent-r5fix` at `e9614fdd` with `fix/price-integrity-and-engine-correctness` merged in, merge `067710cb`). Devnet only (genesis
`EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`). Owner decision 2026-10-15: round 5 goes to devnet first as a rehearsal, then to mainnet
through the Squads vote. Evidence: `docs/burnkeeper/evidence/devnet-round5/` (rehearsal files under `r/`). Explorer:
`https://explorer.solana.com/tx/<sig>?cluster=devnet`. Times are Denver.

**Status at 18:10 Denver: devnet runs round 5 and the rehearsal is green.** The owner approved and executed devnet Squads vault
transaction 21; the program reads back as the local devnet build `a475d902…`. Section R ran in full (R1–R10, table below). The upgrade
proposal itself was prepared by the agent at 16:29 (section 2), with the agent stopping at the proposal as instructed.

## 0. Merge and tests

- Merge of `fix/price-integrity-and-engine-correctness` (42 commits: two-step single-coin launch, lookup tables, mint bank, lite home,
  synthetic creator) into the round-5 branch: one conflict, `src/lib/burnticker/launchVerify.ts`. Resolution: the incoming rule (since
  2026-10-15 every LaunchLab single coin locks its rule one transaction before its create, so a create alone is taken for any LaunchLab
  draft whose TokenConfig is already on chain); the round-5 side's narrower "pinned target or paired only" condition is gone with it.
  The merge touched nothing under `programs/`: the program sources are exactly `e9614fdd`'s.
- Rust (`programs/burn-receipts/scripts/test.sh`, after `anchor build`): **burn_receipts 200 passed, 1 ignored; pair_curve 67 passed;
  0 failed.** The fixtures (`fixtures/*.so`: Raydium CPMM / AMM v4 and the test mocks) were copied from the round-5 fix worktree.
- TypeScript suite (burnticker, burnKeeper, deficit, pairCurve, burnReceipts, btShell): **2,990 tests, 2,989 passed, 0 failed, 1 skipped.**
- `npx tsc --noEmit -p . --incremental false`: **clean** (after `npx next typegen`; a fresh worktree has no `.next/types`, which gives a
  false `LayoutProps` error).

## 1. Build (local, the same Mac and toolchain as rounds 4 and 5: Solana CLI 4.3.0, cargo-build-sbf 4.4.0, platform-tools v1.57, Anchor 1.2.1)

`OUT=<dir> bash scripts/ops/verified-build.sh --local` (both feature pins), then `anchor build` in `programs/burn-receipts` as a second,
independent target directory: the same mainnet bytes.

| build | bytes | executable hash (sha256, trailing zeros stripped) | file sha256 |
|---|---|---|---|
| burn_receipts **mainnet** (default features) | 1,020,528 | `07b2b58f0a1ca77986a193159b101edc7c35080f6633e1f26a63fe4972c1b2f1` | `a9b0b572…16d6` |
| burn_receipts **devnet** (`--features devnet`) | 1,020,504 | `a475d902c287e94e2318b0becf18081fc396d5fda245bdf39e4a7e4e11f84bb9` | `47101dcf…4c6a` |
| pair_curve mainnet / devnet (NOT upgraded) | 418,744 | `a37a9fba…bc00` / `90be3929…ce6b` | |

Both burn_receipts builds are sBPFv3 (ELF `e_flags` 3). The staging table for the upgrade script is
`docs/burnkeeper/evidence/devnet-round5/verified-build.round5.json` (round-5 rows rewritten to these hashes; `round5SourceCommit`
`e9614fdd69cb1e50f6c392fad98e1e55e8601bf3`). Copies of both `.so` files with `SHA256SUMS`:
`~/mct-runner-study/launch-debt-egg-2026-10-09/round5-build/`.

pair_curve note: its source is unchanged, but it links the burn_receipts crate's constants, so rebuilding it from this tree gives new
bytes (`a37a9fba…` mainnet) while the deployed pair_curve is round 4's (`567f3700…` mainnet, `364eac3d…` devnet, both MATCH today).
Round 5 does not upgrade pair_curve (as in the round-5 test plan). Consequence for the verified-build page: pair_curve's row must keep
pointing at the round-4 source commit `29f6f5de`, not at the round-5 commit. Owner call whether to also push the relinked pair_curve
(no behaviour change expected; it would cost a second proposal and about 0.03 SOL of extend on each cluster).

Read back before the upgrade (`verified-build.sh --onchain devnet`, `onchain-verify-before.log`): burn_receipts `87d20b26…630a`,
pair_curve `364eac3d…01cf`, both MATCH (round 4).

## 2. Upgrade steps run on devnet (fees and rent from the synthetic-creator devnet wallet `E8S7Pcdn…DDi`)

| step | signature / result |
|---|---|
| extend burn_receipts program data by 194,560 B (833,736 → 1,028,296; 0.98836 SOL rent) | `G3E3e1NhBA1jJvEvVxBac4i6HVbTZNnxRhqEBocEFp48naFCSLhk9jLDyuyT9WSeYc9QQbv2zqLKeDmyP62tya5` (`br-extend.log`) |
| write buffer (devnet build, 5.18512 SOL rent, returned to the spill on execute) | buffer `CG6ytkrCoHp6EQKE9Y9dAXxfvXoVEVgsHcQnwVyGrKt7` (`br-buffer.log`) |
| buffer authority → the vault `A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD` | `2nQAnY3J7HGnjGb5pvJTCy6WEPNkYJCGwoNNQxURST3YkttirMmQw8HsBpfcrdjJtiizRMzL4K1xhQRQNhptNu2n` (`br-set-buffer-authority.log`) |
| `squads-program-upgrade.mts` dry run: buffer hash = table = local file `a475d902…`, buffer authority = program authority = vault, spill a member | `br-squads-dry.json`, simulation ok |
| proposal (vault transaction 21, created by member A `HUWbm4Cn…HfB`; memo "burn_receipts round 5 + review fixes (devnet rehearsal 2026-10-15)") | `5WoZsnJzEXWDZxxbrY41aUNUKGqWUrsozgKbNF8mbqt547o6MkNeEQDesifGdsQzDAWZgTpfQfssZW9HbfcjLJMY` (`br-squads-proposal.json`); transaction `E2QU5mTVswJzzDDrZ7P9Jk1vXeVnY9krtzSKpVA955q`, proposal `2P3VHM6dSPcoQB75jYsj8n3eC53cqzsy5muQ7vpi2KPL` |
| on-chain decode of vault transaction 21 (`squads-proposal-verify.mts`): Upgrade of `AuQjoSgq…` from buffer `CG6ytkrC…` with spill `HUWbm4Cn…`, buffer executable hash `a475d902…`, verdict **matches**, status Active, 0 approvals | `br-proposal-verify.json` |

## V. Owner: approve and execute (devnet keys; nothing else to type)

```
cd <this worktree>; D=~/.config/meme-coin-trader/devnet; MS=GfARhgcTZysagCH3CrC4mjXy3QkNnMuykW4aCzFx3K1w; E=docs/burnkeeper/evidence/devnet-round5
squads-multisig-cli proposal-vote --rpc-url https://api.devnet.solana.com --keypair $D/squads-a.json --multisig-pubkey $MS --transaction-index 21 --action approve | tee -a $E/squads-votes.log
squads-multisig-cli proposal-vote --rpc-url https://api.devnet.solana.com --keypair $D/squads-b.json --multisig-pubkey $MS --transaction-index 21 --action approve | tee -a $E/squads-votes.log
# after 60 s (the devnet time lock)
squads-multisig-cli vault-transaction-execute --rpc-url https://api.devnet.solana.com --keypair $D/squads-a.json --multisig-pubkey $MS --transaction-index 21 | tee $E/br-squads-execute.log
```
(answer `y`; `squads-b` holds 0.04 devnet SOL, enough for a vote.) The 5.185 SOL buffer rent returns to `squads-a` (`HUWbm4Cn…`), which
then funds the rehearsal below.

**Done by the owner, 2026-10-15 ~17:00 Denver.** The vote and execute output went to the owner's terminal, not to the evidence files;
the signatures were read from chain (history of proposal `2P3VHM6d…` and vault transaction `E2QU5mTV…`) and are recorded in
`squads-votes.log` / `br-squads-execute.log`:
- approve: `58o7WtPRhkRHsjkGEtVAJaUvf8bsHPkDScEntA8VYrSKc7uw5fQdfTkjoVUiGVUwm3edK9LXHMetpjY25zG8bsMX`
- approve: `5Do2gMKQ7ay9Eskg3mbWAYovvZVGbsxZBjLzZnwnV3CaA91HX9KAJrYABgED2Kp4i72iWvmLuQKzM4gT3tpS1tPi`
- execute: `4PazngrZ9wyifqATnwhkGwLvPvBAHq1kUhutYNTgh7ZavjqcLgKitsmX9T2mHxaXvchQu6CmAZvvoHJdyp5XsMKz` (deployed in slot 511516747)

The box's `devnet-synth.env` does not have `BURNTICKER_INITIALIZE_TOKEN_LAYOUT=r5` yet; the owner adds it.

Right after the execute, on the box (devnet only): the nightly synthetic creator (`mct-burnticker-synth.timer`, 03:30 Denver) launches
devnet coins with `BURNTICKER_END_SINKS_LIVE=1` and therefore the round-4 `initialize_token`, which round 5 retires
(`InitializeTokenRetired`). Add `BURNTICKER_INITIALIZE_TOKEN_LAYOUT=r5` to `devnet-synth.env` (or expect a `bt-synthetic-failed` alert).

## Pre-checks that did not need the new program

- **R5-11, the real Token program.** `solana program dump` of SPL Token (`Tokenkeg…`) and Associated Token (`ATokenGP…`) on devnet and
  on mainnet-beta, 2026-10-15: byte-identical on both clusters (Token sha256 `8190d3f7ceb6cb7a7a8d8924bff89f9f611e15ce1f806f2b6237f3311a98f697`,
  108,600 B, upgradeable loader; ATA `6804554e69fd3a58caa191dc4a58f4c67223d30ca28ab8987f39fc18d2f7374d`, 105,032 B). So the devnet run of
  `burn_sol_on_end` below is a run against mainnet's Token program as of today. A new opt-in hook in the LiteSVM harness
  (`tests/common/mod.rs`: `REVIEW_TOKEN_SO`, `REVIEW_ATA_SO`) loads those dumps in place of LiteSVM's bundled copies: `end_sink`
  (incl. `a_resolved_incinerator_coin_sends_its_sol_to_the_incinerator_and_nothing_else_moves`, which closes and re-creates the fee
  PDA's WSOL account with 0.2 SOL of WSOL in it), `burn_target` and `carried` all pass, 52 tests; a control run with a 4,000-byte zero
  file as `REVIEW_TOKEN_SO` panics at load, so the override is live (`r511-litesvm-real-token.txt`).
- **Pyth on devnet.** The sponsored push-oracle accounts exist on devnet at the same addresses as mainnet. SOL/USD refreshes every
  10–50 s; every other sampled feed (WIF, BONK, BTC, ETH, USDC, USDT, JUP) refreshes in one batch about every 5 minutes (200–310 s old
  between batches). The program takes a price only when it is at most 60 s old, so a devnet target crank or pin must land within about
  a minute of a batch: `devnet-round5-harness.mts wait-pyth` blocks until both are fresh. Mainnet, same accounts, sampled over 2.5 minutes:
  SOL, WIF and BONK refresh together every ~50 s (worst age seen 50 s): inside the 60 s limit, with about 10 s to spare.
- **The target token and its pool (round-independent).** TBONK `89EZ3MuiKjCekm8baXT9iTLot3SLrSygsj22LKwo2AiT` (6 decimals,
  1,000,000,000 supply, mint and freeze authority none; `r/tbonk-create.log`: create `3XtADL3N6SZZh65x4JxigysWNr67KPsB7rN6sPAwij71F5aYSaVVKvbg2H98BQcgiRenENo5fqmbqWGxgYiS5u8H`,
  account `5RaBjui1mEatpB1p8AT2ds11HzMcsPFPadsRHb8brNnwnD5G8om522WerWZHC4N9LwsMTiQMykAyUd3JwsVstRes`, mint `3rie4Qzb2irWsVne9Qked4FZ3svdpTE8PttGknZ3zGR6Uc7Q3gBkuTELQx5MaisGnqQZuZthNfrjndHsczsWpmS6`,
  authority disabled `4fxHGZYdhjTKRfGTfznxS1VCnEmvPqqxj6UhbMeXDWCNNP3YYqGraekEt7avpQHqxqWEjwo4rY2K4tHreP8JYXoZ`). A first attempt
  (`5GMdtxtG…TqP`) is dead: its mint step failed on a CLI signer default and the authority was then disabled with supply 0
  (`r/tbonk-attempt1-dead-supply0.log`); it is not used anywhere.
  CPMM pool `A6DHbbUMcGLWhZC7QCKH26FQN8fP36MGHQu4k4CYD6e5` on the devnet tier (`5MxLgy9o…`), 2.2 SOL / 1,150.7 TBONK at WIF's SOL price
  (`r/pool-create.json`: `5uNRcBzW4xCTcaJ5H7RGK5eeaKgWsPZg7n28d1Vtfo4GXsCo15hnFd25rWS8anPFo96knfeBmAupTdW32Wa33Wzs`). The program's
  admission, read-only (`burnreceipts-admin.mts check-target`, `r/check-target.json`): `ok: true`, no problems, reference `2246025822`
  vs spot `2246463121` (0.02 % apart), WSOL reserve 2.2 SOL over the devnet floor of 2 SOL.
- **The launch path, dry.** `devnet-round5-harness.mts launch` builds a coin exactly as the site does (`buildLaunchBundle` with the real
  `ProgramBurnClient` and `ChainLaunchLab`, the devnet platform `GvSKpe5p…`, the frozen devnet lookup table `Es59YYRM…`). On the round-4
  program (`r/launch-path-dry-on-round4.json`): step 1 "Lock in $R5L's rule" (initialize_token_r5 with the incinerator EndSink, 752 B
  as v0) is refused with 101 InstructionFallbackNotFound, as it must be before the upgrade; step 2 (LaunchLab create + 0.05 SOL first
  buy, 992 B) simulates clean, 170,903 CU.

Tooling fixed or added for this run (committed): `scripts/burnticker-devnet-trader.mts` `cpmm-create` was unreachable (the swap branch
was a bare `else` that caught it and died on "--pool is required"); `scripts/burnreceipts-admin.mts` takes `--end-sink incinerator:<min>`
(round 5 only) and has `release-target`; `scripts/ops/devnet-round5-harness.mts` (private) (launch / fund-wsol / balances / wait-pyth).

## R. The rehearsal, after V (commands; the agent runs them and fills the table)

Setup (zsh: functions, not variables):
```
cd <this worktree>; D=~/.config/meme-coin-trader/devnet; SYN=~/.config/burnticker-synth/synth-devnet.json; E=docs/burnkeeper/evidence/devnet-round5
PROG=AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM; VAULT=A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD; KEEPER=D8seUoC1RZUs7918Atcc7TbFwRf1khqFvPdjkB4qktbn
PLAT=GvSKpe5pwLuRzCQ56EGAA1urjtcxx554NivsGHexv3tf; WIF=4ca4beeca86f0d164160323817a4e42b10010a724c2217c6ee41b54cd4cc61fc
TB=89EZ3MuiKjCekm8baXT9iTLot3SLrSygsj22LKwo2AiT; TP=A6DHbbUMcGLWhZC7QCKH26FQN8fP36MGHQu4k4CYD6e5; PAY=$D/squads-a.json
R() { node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs "$@"; }
A() { R scripts/burnreceipts-admin.mts "$@" --cluster devnet --program $PROG; }
H() { R scripts/ops/devnet-round5-harness.mts "$@"; }   # the harness lives with the private ops scripts since 2026-10-15
T() { R scripts/burnticker-devnet-trader.mts "$@"; }
export BURNTICKER_INITIALIZE_TOKEN_LAYOUT=r5
```

R1. Read-back: `solana program dump $PROG /tmp/r5-devnet.so -u devnet -k $SYN` and its executable hash
(`node -e 'const b=require("fs").readFileSync("/tmp/r5-devnet.so");let n=b.length;while(n&&!b[n-1])n--;console.log(require("crypto").createHash("sha256").update(b.subarray(0,n)).digest("hex"))'`)
must print `a475d902c287e94e2318b0becf18081fc396d5fda245bdf39e4a7e4e11f84bb9` → `onchain-verify-after.log`.

R2. Old coins unchanged: `A target-status --mint 4QnwyiBMm2Caz5tJr9hNGzT2wqZcMipZjFHiSBu7AM4F` (burn_target_kind 0); the devnet $DEFICIT's
pending reading 2026-10-09 (crank_cursor 20261008 < last_record_date 20261009 today) cranks with `crank_buyback`, memo v2:
`A crank --payer $PAY --mint 4Qnwyi…` dry, then `--send > $E/r/compat-deficit-crank.json`.

R3. Retired create (R5-5): `A initialize-token --payer $SYN --creator $SYN --mint $D/r5-retired-mint.json --admin $VAULT --attester $KEEPER
--launchlab-platform $PLAT --rules config/burnkeeper/target-devnet-x.rules.json --program-round 4 --end-sink flagship:50000000
> $E/r/retired-initialize-token-refused-dry.json` → simulation error `InitializeTokenRetired`. And the r5 create without an end sink:
same with `--program-round 5` and no `--end-sink` → `LostPathBurnsSelf`.

R4. A fresh coin through lock + create (the site's launch path): `solana-keygen new --no-bip39-passphrase -o $D/r5l-mint.json`;
`H launch --creator $SYN --mint $D/r5l-mint.json --ticker R5L --first-buy 0.05 > $E/r/r5l-launch-dry.json`, then `--send >
$E/r/r5l-launch.json`. Expect step 1 initialize_token_r5 + EndSink kind 4 (incinerator), step 2 LaunchLab initialize_v2 (creator = the
fee PDA) + buy; `A end-status --mint <R5L>` shows the incinerator sink.

R5. One crank on R5L: two readings with the keeper key (counter `bt.units:R5L`, base 1, so value 1 = no units):
`A submit-reading --payer $PAY --mint <R5L> --date 20261014 --value 1 --attester $D/keeper.json --send` and `--date 20261015 --value 1`;
`A crank --payer $PAY --mint <R5L> --send` twice (crank_no_units).

R6. burn_sol_on_end with WSOL in the account (R5-11): `A claim-launchlab-creator-fee --payer $PAY --mint <R5L> --send` (the first buy's
creator fee lands in the fee PDA's WSOL account), `H fund-wsol --mint <R5L> --sol 0.03 --payer $PAY --send`, `solana transfer <R5L fee PDA>
0.03 --allow-unfunded-recipient -u devnet -k $PAY`; `H balances --mint <R5L> > $E/r/r5l-balances-before.json`;
`A submit-rule-end --payer $PAY --mint <R5L> --date 20261015 --outcome resolved --attester $D/keeper.json --send`;
`A forward-on-end --payer $PAY --mint <R5L>` (dry: the plan is burn_sol_on_end to `1nc1nerator…`), then `--send > $E/r/r5l-burn-sol-on-end.json`;
`H balances … > r5l-balances-after.json`. Pass: the transaction lands, memo `R5L|endburn|to=1nc1nerator1|lamports=…|v1`, the fee PDA is
back at its reserve, the WSOL account exists, owned by Token, amount 0, and the cranker's balance moved only by its fee.

R7. A target coin with an end sink (R5-5 pin): `solana-keygen new … -o $D/r5t-mint.json`;
`A initialize-token --payer $PAY --creator $PAY --mint $D/r5t-mint.json --admin $VAULT --attester $KEEPER --launchlab-platform $PLAT
--rules config/burnkeeper/target-devnet-x.rules.json --program-round 5 --end-sink flagship:50000000 --send > $E/r/r5t-init.json`;
`H wait-pyth --feed $WIF`; `A pin-burn-target --payer $PAY --mint $D/r5t-mint.json --target-mint $TB --pool $TP --feed $WIF --send >
$E/r/r5t-pin.json` (BurnTargetPinned; `A target-status` shows kind 1). Then the coin's mint (fixed supply, no freeze):
`spl-token create-token --decimals 6 $D/r5t-mint.json`, account, mint 1,000,000,000, `authorize … mint --disable` (a config file with the
payer as keypair: spl-token takes no `-k`).

R8. The target crank: readings `--date 20261014 --value 3800000000000000` and `--date 20261015 --value 3800300000000000` (3 units), fuel
`solana transfer <R5T fee PDA> 0.2 --allow-unfunded-recipient`, six pool swaps ~150 s apart for the CPMM TWAP (`T cpmm-swap --mint $TB --pool
$TP --dir buy --sol 0.002 --payer $PAY --send` / `--dir sell --pct 1`), re-check `A check-target` (within 3 %), then `H wait-pyth --feed $WIF`
and at once `A crank --payer $PAY --mint <R5T> --send > $E/r/r5t-crank.json` (crank_target_burn: memo `…|target=89EZ3Mui…|…|v3`, TBONK
supply down by `got`). If the batch is missed the reading holds (PythStale): that is the program working; wait for the next batch.

R9. release_target (R5-6): `A release-target --payer $PAY --mint <R5T>` dry → refused `TargetNotStalled` (the target burns; the positive
path needs 30 days without a burn and is covered by `r5_6_a_stalled_target_releases_its_carry_to_the_flagship` in LiteSVM)
→ `$E/r/r5t-release-target-refused-dry.json`.

R10. The paired path on pair 6 (`7dNGQuvi…` PCLA = A, `6jxEWF78…` PCLB = B, both PAIRED with verified pools; last readings 20261012:
A 4030200000000000, B 4031400000000000): B reads 20261014 = 4031600000000000 (2 units), A reads 20261014 = 4030300000000000 (1 unit),
`A submit-pair-result --payer $PAY --mint-a 7dNGQu… --mint-b 6jxEWF… --date 20261014 --winner 7dNGQu… --attester $D/keeper.json --send`,
`A crank --payer $PAY --mint 6jxEWF… --send` (plans forward_to_winner: memo `PCLB|forward|from=6jxEWF78rtBs|to=7dNGQuvijwxF|period=2026-10-14|…|v1`),
then `A crank --mint 7dNGQu…` (A's buyback; a TwapUnavailable hold is fine).

## R. Results (2026-10-15, 17:05–18:10 Denver; payer `squads-a` unless noted; every sent signature `solana confirm` → Finalized, `r/confirm-all.txt`)

| step | signature | result |
|---|---|---|
| V votes A, B; execute | `58o7WtPR…bsMX`, `5Do2gMKQ…1tPi`; `4PazngrZ…sMKz` | vault transaction 21 executed (owner) |
| R1 read-back | — | `solana program dump`: executable hash `a475d902c287e94e2318b0becf18081fc396d5fda245bdf39e4a7e4e11f84bb9`, 1,020,489 code bytes in 1,028,296 B of program data, authority still the vault `A8VVQ8zt…`, slot 511516747 (`onchain-verify-after.log`). Spill refund: `squads-a` 1.69 → 6.88 SOL |
| R2 $DEFICIT compat | `5SZkBzkde441HW7RYbZKB5TDvedPxsFHCAUsB2NKcXeWHiQeKwasuyG5JqLZ8RnkF66QV2gwkJ3Nxq4unWvVjSFn` | old coin unchanged: `burn_target_kind` 0, no BurnTarget (`r/compat-deficit-target.json`); its pending 2026-10-09 reading cranked with `crank_buyback`, memo v2 `DEBT|2026-10-09|…|units=1|pool=726671686|spent=21236058|got=3803844.514471|burn=3803844.514471|swap=5RoGVSCTBmcT|…|v2` (`r/compat-deficit-crank.json`) |
| R3 retired create (dry) | — | `initialize_token` refused 6136 `InitializeTokenRetired` (`r/retired-initialize-token-refused-dry.json`); `initialize_token_r5` without an end sink refused 6130 `LostPathBurnsSelf` (`r/r5-create-without-end-sink-refused-dry.json`) |
| R4 R5L lock / create (site launch path, creator = the synthetic-creator wallet) | lock `eexsuoYAZVVQU9wHWHx4wxtCSgudPDsbZmBwEJ2TUMP1gFsJyWfcXvQJGsmSurGwvKH3gVdE8Qv3JvJXdyqVYFg`; create + 0.05 SOL buy `2YD1DaZzJoywZk88UKkTDUebDWMnAWnQW9JcanA8k87BeWANDmg7fEuYFH6UMHckLZ4LVAdpR8ZrGJ8K2VgjZseR` | R5L `GkLVz1vcJT3zYcFDH1PL95Qb358EMigJs2Z5MWTSq9Bn`: step 1 initialize_token_r5 + EndSink kind 4 `1nc1nerator…` min 0.05 SOL (`r/r5l-end-status.json`); step 2 LaunchLab initialize_v2 with creator = fee PDA `ARDGd7LT…UGf`, pool `FEu6ELth…` (`r/r5l-launch.json`) |
| R5 R5L readings | `5Q6aPxcCMmbQxyx3G6DKuJXokHxSYTEKppw2X8A1wYUn2Vt7FVY6zRZ91U4AFKdtGHmLwGMfHeEsB5QH5Y7Dgr4S`, `35xaRzjXYm9ZGGRGmBweioR5en27xTt3QBoMDwuxZx3ZehRqTHUx7dXjdfikvZUBhQXxyyW5Mn2uLx4934AMhNmy` | two zero-unit readings (counter value 1): `submit_reading` settles a reading with no units itself, the cursor moved to 20261015 and `crank` answers `idle` (`r/r5l-crank-1.json`). A coin with no pool has nothing a crank could buy, so the cranks of this rehearsal are R2 (buyback, old coin), R8 (target burn, fresh coin) and R10 (forward + buyback, pair) |
| R6 burn_sol_on_end (R5-11) | creator-fee claim `3UwyGgwvWnr6pg8KGN9ehCXQvcgdhn8PB4B8yEd8mZyAa4qBF3AbzfQ2casRFGVmihxqdBRoKWunaAydUCtitTHN`; wrap 0.03 into the fee PDA's WSOL `4m5MFLFayFvsa6tNCHbDKYRpDZZx5bZksqqvioMxPWtMZWeHebHk5THRk4YrPoQtspweNAimk8HpJzPax75wB9si`; 0.03 SOL to the fee PDA `2bWVyUcnEGRvBQy1SsVZTSyVDWyLzZD1m1WANiBuLanU4RaJHqgoWRgjokoqHzE923yUAB1eKXv7HFhFEVieivMy`; rule end RESOLVED 20261015 `4yarQV5MdsDGh9TodX6irzG9YCiaXsbwi43w1W3CNqSV8g746dQgQudrBdxMjqxmomYWCaLEfBbnSiTGzsffWKNT`; **burn_sol_on_end `2apwmJXMPzcDSCA8Mkxmb7i5HqhaEK3DiihM3gjvgczGEX15aTDNCDJwCCx8nN4N3sTANg5uYdEUYB6mgnYndmdS`** | **passes against the real Token program.** Before: fee PDA 0.05 SOL, WSOL account 30,250,000 (0.03 wrapped + the 250,000 creator fee the claim brought in). Memo `R5L|endburn|to=1nc1nerator1|lamports=60250000|v1` = 0.03 above the 0.02 reserve + 0.03025 unwrapped. After: fee PDA 0.02 SOL (the reserve), the WSOL account re-created at the same address, owned by Token, amount 0, rent-exempt; cranker paid exactly 5,000 lamports (its fee; the account's new rent was refunded); RuleEnd `forwards` 1, `forwarded_lamports` 60,250,000 (`r/r5l-balances-{before,after}.json`, `r/r5l-end-status-after.json`, `r/r5l-cranker-delta.txt`) |
| R7 R5T init / pin | init `Zer2fqYnyQP8rDDzNXkL577SML3yX5VgTzEAnwNwgxHTu1BDQCBi3eEMJm2y3onHRY9MqGJmyQXsaXqdz1e8LHH`; pin `5Y3NP1j7Lu9tbxRWMJthJQacbncJ3MKuvLMShnVunGsJdj2J3JcXWtbeoNCpT9RodGMzzeno59MwubvW7BYHNEEY`; mint create / account / mint / authority off `YV6pifxQ…Lxa`, `GKn4RxnuK…TZ`, `24NPNcR5…ecds`, `678yLemM…djvu` | R5T `37EmrbWtytv6TryQgFaiCUsycirWAakHqUXdQUuUUUGy` (rules TGTX, EndSink flagship min 0.05 SOL): the first check-target was refused "price more than a minute old"; after `wait-pyth` (SOL 4 s, WIF 8 s) admission passed (reference `2258439303`, spot `2246463121`, 0.5 %) and the pin landed; `target-status` `burn_target_kind` 1, BurnTarget `9oXqWtJt…` (`r/r5t-target-status.json`); then the coin's mint, 1,000,000,000 fixed supply, no mint or freeze authority (`r/r5t-mint-create.log`) |
| R8 R5T target crank | readings `4b4wHW7L…bZru` (20261014), `2RjQRZxS…HNF` (20261015, 3 units); fuel 0.2 SOL `Gkc4wiAH…rwkg`; seven pool swaps 150 s apart (`r/r5t-twap-swap-{1..7}.json`); **crank_target_burn `4tMWmEt8BKQhyG6eJGe9dVCphwJDxZhTGTYGt4G8aoJjVQj6w8eNCgGmcyDSWvi7pXLgUadgR2spD8stWbT8AczT`** | holds first, as designed: 17:55 `TwapUnavailable` (the pool's oldest observation was younger than the 1,200 s window; `r/r5t-crank-dry.json`), 18:03 `PythStale` (`r/r5t-crank-dry2.json`); after `wait-pyth` (SOL 3 s, WIF 12 s) it landed, 322,647 CU: memo `TGTX|2026-10-15|…|units=3|pool=200000000|spent=5940200|got=3.080397|burn=3.080397|target=89EZ3MuiKjCekm8baXT9iTLot3SLrSygsj22LKwo2AiT|own=0|swap=A6DHbbUMcGLW|rules=sha256:2c7cdb048986|v3`; TBONK supply 1,000,000,000 → 999,999,996.919603 (down by exactly `got`) |
| R9 release_target (dry) | — | before the crank: refused 6131 `ReadingPending` (seen at 17:45; that output was overwritten by the later run); after the burn: refused 6139 `TargetNotStalled` (`r/r5t-release-target-refused-dry.json`); on a self coin: 3012 (no BurnTarget account, `r/self-coin-release-target-refused-dry.json`). The positive path needs 30 days without a burn: LiteSVM `r5_6_a_stalled_target_releases_its_carry_to_the_flagship` |
| R10 pair 6 | B reads 20261014 `qjBLAN98eKbqCPCDi2iFidqGTpTcGPDyvGPgR6HAnLMLmYbxe2VhmfNG4UHVfHcLyXgGWBios35McbBFJ4pDMnT`; A reads `5RpXnoEoH1fUd8df3UqrMN9Ra7terKLHrgDSe5ysZ9ULSBBrER1FQ1Q4bvY5op1pb44dWPSgKrA4roUUomAtXQL4`; pair result (A wins) `5D4gvZ8ptiM1mMU2t6RzPoUnseRv4TbgUzEqCiLrUCXv9H635tHeaaCyAYWedn8yV3dSg33AesmDV7dSxr9du3ah`; **forward_to_winner (B's crank) `rqEKns4E1uAv2NAvCSyGJDyeeNTAVPoQ7Xuihkvy2QHnXPcKqeWkXHiFmeWVZRfsj4Pb8PZSE785VaV36ECJcFz`**; A's buyback `CB1SXH1ZWvhtS8axhVeHRWwCDTZKNpFov7ZtwNed1pYavBCt9wNLEr1CDBnQF9mc8KdnwRf3Hkqxz3KxgWhepD6` | a result before the winner had read was refused 6090 `PairResultNotServable` (`r/pair6-win-before-winner-reading-refused-dry.json`); forward memo `PCLB|forward|from=6jxEWF78rtBs|to=7dNGQuvijwxF|period=2026-10-14|lamports=7583901|v1`; A's crank `PCLA|2026-10-14|…|units=1|pool=131537044|spent=1840341|got=2528995.53009|burn=2528995.53009|swap=7GRjCd6JjiHM|…|v2` |

What the run shows beyond the table: the two-step launch works end to end on round 5 from the site's own builders; the holds
(`TwapUnavailable`, `PythStale`) revert and leave the reading queued, then the same crank lands once the condition clears; on devnet
the Pyth batch timing (section "Pre-checks") is the practical constraint for target cranks, not the program.

## U2. Second round-5 upgrade: R5-8 / R5-9 inside the program (staged 2026-10-15 ~19:07 Denver; executed by the owner ~19:10; re-run green)

Owner decision 2026-10-15: R5-8 and R5-9 are fixed inside round 5 (branch `worktree-agent-r5prog`, tip `089024ff`: carried-spend
lamport budget with the CarriedPace PDA `["carried_pace", mint]`, stalled targets dead, optional BurnTarget accounts on
`forward_to_winner` / `forward_on_end`). Merged into this branch (`a4e195a3`; one conflict, VERIFIED-BUILD.md, resolved to the r5prog
table with devnet's on-chain cell set to the executed `a475d902…`). Rust after the merge (`anchor build` + `scripts/test.sh`): **282
passed (burn_receipts 215, pair_curve 67), 0 failed, 1 ignored.**

Rebuilt from a clean `OUT` directory (`verified-build.sh --local`): devnet `74659afdbb5f63fd0fb79a3366302bd68f7a8e84eea5cf9a6d9cdab97f36785c`
(1,028,920 B, file sha256 `d1e79233…06b7`), mainnet `152929ce72292d2113655c09a193a15cb49443109e4db202efdbc68232520821` (1,028,944 B, file
sha256 `cd014672…d290`): **both equal the builder's hashes.** Staging table `verified-build.round5.json` rewritten to them. Evidence:
`docs/burnkeeper/evidence/devnet-round5/u2/`. Paid by `squads-a`.

| step | signature / result |
|---|---|
| extend by 10,240 B (1,028,296 → 1,038,536; the devnet build was 624 B over) | `E1uY8kGrRW7HQiRfvwsH3Rj39fMSpVwwsri5YAgS3BYbybSGQ7CtKXfL7esyLgWGeWhkkP5mAurKWqVhRqKFgrd` (`u2/br-extend.log`) |
| write buffer (devnet build) | buffer `H1nLhesDehgEad8sBaBgXUmN6SBBCbeRwW3ikACgaLsU`; dumped back: executable hash `74659afd…785c`, 1,028,905 code bytes (`u2/buffer-dump-hash.log`) |
| buffer authority → the vault | `5cx6QmscQ281abAMTxiwRGXGfcKLRuewg6FgRyRXH3Lt9AfWa5PmAGHEhkTBTyHGMSxJYXAZxUwaW9ghmHZYohnG` (`u2/br-set-buffer-authority.log`) |
| dry run: buffer = table = local file `74659afd…`, buffer and program authority = vault, spill a member | `u2/br-squads-dry.json`, simulation ok |
| proposal: **vault transaction 22** (transaction `A5hxGC1KRmXzjhMAdo8tvJqF26exjsqr5WffniKBsaXo`, proposal `58m2hKLeoR593ZyjqAXSo4WK849RWWkSHaQTgnBGVwHa`) | `3zfgtWydnhG6xfpeom3oE5rNibHH6o7g1mX6CXgKRafMmGCBUgAdtjgoyrupZtDuDKofTuwg32BFAqXCFxW2m6xB` (`u2/br-squads-proposal.json`) |
| on-chain decode (`squads-proposal-verify --expect-hash 74659afd…`) | verdict **matches**, no problems, status Active, 0 approvals (`u2/br-proposal-verify.json`) |

Owner (devnet keys; answer `y`):
```
~/.cargo/bin/squads-multisig-cli proposal-vote --rpc-url https://api.devnet.solana.com --keypair ~/.config/meme-coin-trader/devnet/squads-a.json --multisig-pubkey GfARhgcTZysagCH3CrC4mjXy3QkNnMuykW4aCzFx3K1w --transaction-index 22 --action approve
~/.cargo/bin/squads-multisig-cli proposal-vote --rpc-url https://api.devnet.solana.com --keypair ~/.config/meme-coin-trader/devnet/squads-b.json --multisig-pubkey GfARhgcTZysagCH3CrC4mjXy3QkNnMuykW4aCzFx3K1w --transaction-index 22 --action approve
# after 60 s
~/.cargo/bin/squads-multisig-cli vault-transaction-execute --rpc-url https://api.devnet.solana.com --keypair ~/.config/meme-coin-trader/devnet/squads-a.json --multisig-pubkey GfARhgcTZysagCH3CrC4mjXy3QkNnMuykW4aCzFx3K1w --transaction-index 22
```
The 5.228 SOL buffer rent returns to `squads-a`. After the execute: read-back (must be `74659afd…`), then the re-run (R2 with a
`crank_carried`, R5, R6–R8, R10) and the builder's new steps (carried budget: full / half / dust pieces; a pinned target coin as pair
loser, winner and end sink; the `BurnTargetAccountMissing` omission; the stalled target in LiteSVM).

### U2 results: the re-run on `74659afd…` (2026-10-15, 19:05–19:40 Denver; payer `squads-a` unless noted)

Every signature sent in this re-run (62) is `solana confirm` → Finalized (`u2/r/confirm-all.txt`). Evidence: `u2/`, `u2/r/`.

| step | signature(s) | result |
|---|---|---|
| votes, execute (owner) | `4eAFqKnS57sYf2Kp9QRz1AM3MGmrvSAAiavR7xicVyjP8RStz2TgNxgM65EUJNcgQKCTxLnUo4UsrugTwfxS6X89`, `3pkRM94TbRgrHn7uR6iW6Wbg6qRAK45FbpXWs2kZ3rib97D6MNrsPFSpQbcFJa48jNW9c1gDNLdKHACqP5jtS2Vp`; execute `5P7L219sMSzywA3229NymRXMTMWNau9y8uSbjCp6GxSRydJxvKN1fms2HD5KFtyAsRSMGrxdESuYa74NPrFSKRFN` | read from chain (history of proposal `58m2hKLe…` and vault transaction `A5hxGC1K…`; the CLI output was not captured), `u2/squads-votes-execute.log` |
| R1 read-back | — | `solana program dump`: `74659afdbb5f63fd0fb79a3366302bd68f7a8e84eea5cf9a6d9cdab97f36785c`, 1,028,905 code bytes in 1,038,536 B, authority the vault, slot 511540317 (`u2/onchain-verify-after.log`) |
| R2 old coin + **crank_carried creates CarriedPace** | B1 full-cap piece `52e1VB35qZmioWQULRem2JHTBUUY1G8umeJJT9UFkvxdWDcQjJUsYJR6DKPXhfoseetBnpyHQ1Rkwav9DD6kT6ip`; new $DEFICIT reading `c9BPFasV…zDrf` and its crank_buyback `4enb5k9WCmdEkm3AayD1fy6Yh6ihGyY9ypWGhrtvfJgYvM6K67FbMaLGXfwva1GsS4iP4ro3KUZozW3bJmcnV8GQ` | $DEFICIT (carried 172,113,734): a piece above the cap is refused `SpendAboveCap` (`b0-above-cap-refused-dry.json`); the full-cap piece (21,659,548 = 2 % of the 1,082,977,403 WSOL reserve) landed and created CarriedPace (version 1, pieces 1, budget 0), memo `DEBT|carried|through=2026-10-09|spent=21659548|got=3729625.146846|…|left=150454186|piece=1|…|v1`. The 2026-10-15 reading still cranks as `crank_buyback` with the v2 memo |
| budget: a second piece at once | — | 10 s later, 1,000,000: refused 6141 `CarriedTooSoon` (and the planner says too-soon) (`b2-second-piece-refused-dry.json`) |
| budget: half cap after ~300 s | B3 `3qJNnoAEwfk9nwXFgfosi41tW3y7xmLTH1EvL1hUPFkQZy5mM4wNEbfUnoZaTrgMavB8myGh1bPXApQP2urZ8uoD` | at 316 s the budget check passed but the TWAP band refused (`TwapDeviation`: B1's 2 % buy moved spot ~4 % off the 1,200 s TWAP). After a counter-sale from the devnet payer (`5CCFUwKG…QPtX`), 19,000,000 at 355 s was refused `CarriedTooSoon` (budget ~0.59 cap), and 10,000,000 (~0.46 cap) at 364 s landed: piece 2, budget left 3,215,556 |
| budget: two pieces in one transaction | — | at 289 s after B3, 1,000,000 twice: the first simulates (piece 3), the second is refused `CarriedTooSoon` (same second) (`b5-two-pieces-one-tx-refused-dry.json`) |
| budget: dust, then the rest of the cap | dust B6 `9t9WVJguiYSuX7FYXzzaixjCugGK3WMac6pv9frU65ozkYb3xMJAKRiCeaZ1hp8zzD1mHBk1S85o2VpcmPT3k8o`; rest B7 `4HHSrT84Goem6mV6NeKdde9uZz6z67sj2Kx2Qs5bLLSBzsak2CfpBsVb2RqhbPN3Jei49ddcPXEappQsHeszKtJa` | 625 s after B3 (budget full, cap 21,470,710): a 1,000,000 dust piece left budget 20,470,710 (it took only its own lamports); the rest, exactly 20,470,710, landed 20 s later (piece 4, budget left 716,355 = the refill in between). The agent's first try at one second apart failed in its own shell arithmetic, so the gap was 20 s; the same-second case is the row above |
| R3 retired create (dry) | — | `InitializeTokenRetired` again on the new build (`u2/r/retired-initialize-token-refused-dry.json`) |
| R4/R5 fresh coin R5M (site launch path) | lock `2FyqgGenhpY3koeHnknEuCJP7MVVRKL4iMcUMmUobJ15GBmuhyon2YjUkkeBCU91wpwx69BefbkaADckriW412DP`; create + buy `4ZmuXfFzCzewa74hAw9Lv4dLqBWSEZE5f2s8aK4nF9qxJF6UhkCjyAXPkwY2huDbvvhJS26iW23wbgmz3LRng31W`; readings `YdLxYU1R…aYH`, `j41XUtFT…H89t` | R5M `5qnxXmetZRcK4rT6WQbbEBru4qhKhEmYdavUSWCGkSbd`, incinerator sink; zero-unit readings settle at submit, crank idle (as in R5) |
| R6 burn_sol_on_end | claim `26GMkPXr…mzGr5`; wrap `4sKmpj7M…Fw7uK`; fuel `hL6F3BRM…M7emj`; end `KJQattC1…gxPen`; **burn `hrBLRuCpdLnwX12YakpABREUVXfjQKEGb4YbjJap73PsAa4cHmoDo143h9Ry5AdS6sM8VCSJJa8KypX7G9cxqD5`** | memo `R5M|endburn|to=1nc1nerator1|lamports=60250000|v1`; fee PDA back to its 0.02 reserve, WSOL account re-created (Token-owned, amount 0), cranker paid 5,000 lamports |
| R7 target coin R5U (end sink flagship) | init `2D4DnTmA…nxyy`; pin `2QbECQjoeyCe2a3USJSCYcCiNRfJuhee2VqG4CYL2gtVN1Co9t1Ry8iCmmmU54VJnjguPchE3wf9bDZAkpR3veKJ`; mint `u2/r/r5u-mint-create.log` | R5U `ES1HxjArAP6e789g11qWESDrpeYPJWUwR7XCBEx2UHZe` pinned to TBONK / `A6DHbbUM…`; fixed supply, no authorities |
| R8 target crank | readings `1nmKTce1…G6V`, `3w7A5HMT…DtUyq`; fuel `pLUqato6…MJVTF`; **crank_target_burn `4EFZ2oC42qpDHJ2Ye4KgMpFJLhrJxcoYfEQVdAS7qPAkmpH38nVxaBXYPj9vdYxWqsV3vGiuAM6uj5TBHFrURMjY`** | first `PythStale` (held), then at a fresh batch (SOL 10 s, WIF 10 s): memo `TGTX|2026-10-15|…|units=3|pool=300000000|spent=8910300|got=4.589718|burn=4.589718|target=89EZ3Mui…|own=0|swap=A6DHbbUMcGLW|…|v3` |
| R9 release_target (dry) | — | `TargetNotStalled` (`u2/r/r5u-release-target-refused-dry.json`) |
| **pinned pre-graduation target coins as pair loser and winner** | PA init `3m7UQjS2…49gAS`, PB init (partner first, PAIRED) `NKqXTWqE…VQS91`; pins `4kueviiB…cz81S`, `4yaFDpFy…PbKpg`; mints (`u2/r/r5p{a,b}-mint-create.log`); PB's pre-pairing reading 2026-10-14 cranked as a target burn `35GVk9bh…nSHt` (unpaired history); readings 2026-10-16 `3rr2LDJi…h8Dt`, `44eHWtAD…kyhn`; result (PA wins) `21aY75VB…FrxC`; **forward_to_winner `5g57ohMBvvC5zyKyFTBfQvZtRnFsEjV15LxAxX8KP2P5J4iiE9yYp63QGoWkqvHFLk6CR9BSDCpr1go5YujVTd7B`** | PA `Cc7Yoe1PVRs9z2yt4tUffSvborxFm6CGfvgg79bzJ3ZY` and PB `HLjqsZb7TTgDtQRHaxbymfao7cyHMH5VmpCKhWmFmnrG`, LaunchLab pair sides (EndSink pair-winner), both pinned to TBONK, neither with an own pool. A 2026-10-14 result was refused `PairDateBeforePairing` (they paired on 2026-10-16 UTC), so the period is 2026-10-16. The loser PB forwarded 5,851,197 lamports to the winner PA: memo `PTB|forward|from=HLjqsZb7TTgD|to=Cc7Yoe1PVRs9|period=2026-10-16|lamports=5851197|v1`; PA's fee PDA +5,851,197, PB's −5,851,197 |
| **BurnTargetAccountMissing** | — | forward_to_winner without the loser's BurnTarget: 6143; without the winner's: 6143 (`u2/r/pab-fwd-omit-{loser,winner}-bt-refused-dry.json`); forward_on_end without the sink's: 6143 (`u2/r/s-fwd-end-omit-sink-bt-refused-dry.json`). Control: pair 6 (self coins with pools) with the loser's slot left out passes (`u2/r/pair6-fwd-omit-self-loser-bt-ok-dry.json`) |
| **pinned pre-graduation target coin as an end sink** | S init `rmw6wBEB…HpaL`; readings `3AcMSF9q…ALRW`, `2fb4A6wE…ULRG`; fuel `3CVqXzqM…n36FE`; end `32qsAMR5…fu7`; **forward_on_end `4f2vdqLb1dZyYjdtjhfZYVFe8FL1DuJSYaVzFGsZbRwR2WvBGGSjwnRM3PPTgvhaNM5uenCHbPNX5dYEYkFUAA8M`** | S `6dgkpNcjztaaNpM55jn3m69koY3nWs2Dx4QrEapHpNF4`, EndSink mint = R5U; the plan names R5U (sink kind 1, intended = target), memo `SNK|endfwd|to=ES1HxjArAP6e|lamports=100000000|v1`; R5U's fee PDA +100,000,000, S's −100,000,000 |
| R10 pair 6 (self coins) | readings `2zR1CyCv…MNgL`, `4FCmFkrR…qifkr`; result `5675fWKn…wAbTS`; **forward `5CjXgSE7vdgiYXR9BqQV1Jn7jAjRboohUwPNDPvfTD4qh6MRXtgFC5JUvPxnrPm2myYkmjo4hjjqKdZKihGTDe36`**; A's buyback `5uZr98Fj2dhMUdxWHGqkxDHb4TMyW6yTC3jVX2f8HMMxPSMLSTeFnfLywUDaUebSUeKj7WsCYC53vj6m4bGPEVwK` | memo `PCLB|forward|…|period=2026-10-15|lamports=7432981|v1`; A `PCLA|2026-10-15|…|units=1|…|v2` |
| stalled target (LiteSVM; devnet cannot age a target 30 days) | — | `r5_6_a_stalled_target_releases_its_carry_to_the_flagship`, `r5_9_a_stalled_target_coin_is_dead_on_either_side`, `r5_9_a_named_sink_that_burns_a_pinned_target_receives_and_an_unpinned_one_does_not` (it stalls the sink: nothing moves), and the other r5_9 cases: all pass (`u2/stalled-target-litesvm.txt`) |

What the re-run adds: the carried budget behaves exactly as specified on a real cluster (full cap once, refill per 600 s, partial
budgets enforced by lamports, dust takes only dust, same-second refused). One operating note for the keeper: a full-cap piece moves the
pool ~4 % (2 % of the reserve), more than the 3 % TWAP band, so the next piece is held by `TwapDeviation` until the TWAP catches up;
half-cap pieces (or waiting about one TWAP window) avoid that. It is the guard working, not a defect.

### Go / no-go for mainnet: GO

- The devnet build `74659afd…` runs on devnet and passed every rehearsal step; the mainnet build `152929ce…` comes from the same source
  and was reproduced from a clean target directory. The Rust suites pass (282) and the R5-11 Token-program check holds.
- Owner preconditions in `docs/burnkeeper/evidence/mainnet-round5/README-execution.md`: the deployer holds 6.40 SOL against a ≈ 6.27 SOL
  peak; pause launches across the execute and set `BURNTICKER_INITIALIZE_TOKEN_LAYOUT=r5` right after the read-back (the old create is
  retired); `devnet-synth.env` also needs the r5 layout (owner).
- Not part of the go: pair_curve stays on round 4; the keeper's Pyth posting path is still not built (mainnet feeds refresh ~50 s,
  inside the 60 s limit, so target cranks land without it today).

## Open items: recommendations for the owner (R5-8 and R5-9 since decided: fixed inside round 5, section U2)

**R5-8 (crank_carried has no rate limit).** What is true today: no PlatformConfig exists on either cluster (read 2026-10-15), so no
cranker allowlist and no burn-pool cap is in force, and anyone can call `crank_carried`. Every piece is bounded by the 2 % reserve cap,
the TWAP band and min-out, and the total by the carried amount, so the exposure is a sandwich sized to the slippage band on a coin
that has carry, plus an inflated public `burns` counter. Recommendation: ship round 5 with R5-8 open (low severity, bounded loss), and
put the fix in the next program round: a minimum interval between carried pieces per coin (10 minutes, half the 1,200 s TWAP window,
stored in TokenConfig's spare bytes) and carried pieces counted separately from `burns`. Until then the keeper should drain carry in
its own small pieces promptly after the reading that created it, which leaves less for anyone else to time. Owner decides.

**R5-9 (pair forwarding and end-sink liveness treat a target coin without its own verified pool as dead).** After R5-12 a graduated
target coin counts as live (`own_pool_verified()` reads `burn_target_kind == 2`), so the gap is only a target coin before its own pool is
verified: as a pair loser it forwards nothing (the reading is processed FORWARDED and it keeps its fuel), as a winner it receives
nothing, and as a named end-sink coin the fuel goes to the flagship instead. Recommendation, two parts: (1) now, off chain: the site and
the API refuse a burn target on a pair coin, and refuse naming a not-yet-graduated target coin as another coin's end sink (a rules
check; no program change); (2) next program round: the reviewer's definition, live = `own_pool_verified() || (burn_target_kind ==
EXTERNAL && BurnTarget pinned)`, in `pair.rs` and `end.rs`. Owner decides.

**R5-11 (burn_sol_on_end close and re-create).** Closed by R6: on devnet, whose SPL Token and ATA programs are byte-identical to mainnet's today, `burn_sol_on_end` closed and re-created the fee PDA's WSOL account holding 30,250,000 lamports of WSOL in one instruction and landed (`2apwmJXM…ndmdS`). Re-check only if either cluster's Token program changes before the mainnet upgrade (compare `solana program dump TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` sha256 `8190d3f7…f697` on mainnet).

## Verify commands (read-only)

- Upgrade proposal: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/squads-proposal-verify.mts --cluster devnet --multisig
  GfARhgcTZysagCH3CrC4mjXy3QkNnMuykW4aCzFx3K1w --index 21 --program AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM --buffer
  CG6ytkrCoHp6EQKE9Y9dAXxfvXoVEVgsHcQnwVyGrKt7 --spill HUWbm4CnrTfe4MLwpFhstTJFVyrj4FNuTidMzEBoiHfb --expect-hash
  a475d902c287e94e2318b0becf18081fc396d5fda245bdf39e4a7e4e11f84bb9` → verdict matches.
- Any signature: `solana confirm -v <sig> -u devnet`.
- Builds: `OUT=<dir> bash scripts/ops/verified-build.sh --local` prints the four hashes above (DIFFER against the committed round-4 table
  is expected until the table is rewritten).
- Pool admission: `A check-target --target-mint $TB --pool $TP --feed $WIF`.
