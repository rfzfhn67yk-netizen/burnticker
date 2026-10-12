# End sinks (LAUNCHPAD-PATH §45): program round 4, status 2026-10-12

Branch `burnticker/endsink2` (round 4 from the paused `burnticker/end-sink` / `burnticker/end-sink-ts`, merged onto the integration tip
109e3ae7 and finished). Nothing here is deployed. Devnet and mainnet both still run round 3.

## What a coin does now

A coin launched with `onEnd.endSink` in its hashed rule (every new launch: `rules.ts` DEFAULT_ON_END) pins an EndSink at
`initialize_token`. When its rule ends:

- **with a result** (a season over, a one-shot settled YES or NO, a derby season over): the keeper records a quorum-signed RuleEnd
  (`submit_rule_end`, outcome resolved) once nothing is left to attest or crank. No reading dated later is accepted or cranked. Anyone
  can then call `forward_on_end`: the program moves the fee PDA's spendable SOL and WSOL (above the reserve, under the burn-pool cap, at
  least the EndSink's minimum) to the sink it picks, and that coin's own cranks burn it. The coin retires. Later fee income is forwarded
  again whenever it passes the minimum, at most once a week (the retired sweep follows the sink).
- **void** (a voided market, a pair that voided, a cancelled season): the RuleEnd is recorded void and the coin keeps the 28-day
  wind-down on itself, then the self-burn sweep.

Who the sink is: a single coin's sink is $DEFICIT (the flagship, compiled per cluster: mainnet `AJJ4XxCU…oqj`, devnet `4QnwyiBM…AM4F`,
localnet/test `H4JcMPic…r9M`). A winner-takes-the-burn pair coin's sink is its partner when the partner won the end date's result and
is still live, else $DEFICIT. The pair coin that won the end date is the sink itself: the keeper records no end for it, so it stays live,
its partner's leftover lands in its pool, and its own leftover burns it through the ordinary wind-down. A one-shot at 100 % drains on its
own coin first ("burns everything"), then records the end and forwards only the trickle. League sets are a later round (`set` and
`endSink` cannot be combined; league-mode coins keep the wind-down). Vault-mode coins have no burn pool and get no sink.

## Done

- Program: EndSink (`end_sink_mint` is an `Option<Pubkey>`: None = the flagship, or the pair_mint of the same create, which keeps a
  LaunchLab pair's create inside 1,232 bytes), `submit_rule_end`, `forward_on_end`, the reading and crank gates, 33 entrypoints / 110
  errors / 37 events. LiteSVM suite green (`programs/burn-receipts/scripts/test.sh`).
- TS: the hashed rule field and its validation, the descriptions ("whatever is left burns $DEFICIT" / "burns the winning coin, or
  $DEFICIT if there isn't one", plus the void sentence), the API spec, ProgramBurnClient pins the EndSink (refused unless
  `BURNTICKER_END_SINKS_LIVE`), the pair-curve re-encode, the end-sink client (fake + chain), the keeper step
  (`src/lib/burnticker/endSinkKeeper.ts`, called from `multiKeeper.planRuleEnd`), the admin CLI (`submit-rule-end`, `forward-on-end`,
  `end-status`, `initialize-token --end-sink … --program-round 3|4`, default from `BURNTICKER_INITIALIZE_TOKEN_LAYOUT`), the Powers Register outflow sentence, the checklist erratum,
  the whitepaper §13.3.
- **Two initialize_token layouts.** `#[event_cpi]` puts event_authority after the new end_sink slot, so a round-4 create is refused by a
  round-3 program and the other way round. `initializeTokenIx` defaults to the round-3 bytes (`INITIALIZE_TOKEN_DEFAULT_LAYOUT = "r3"`),
  shown landing on a validator running the deployed round-3 source; round 4 is used with an end sink or `--program-round 4`.
- Localnet: the chain client against this source on a validator; devnet run staged for the owner
  (`docs/burnkeeper/evidence/devnet-endsink2/README.md`).

## Not done

- `sweep_retired` (PROGRAM-UPGRADE-QUEUE item 1): not built. After §45 it only matters for a VOID coin's trickle (a resolved coin's
  trickle already moves permissionlessly through `forward_on_end`), and it needs the swap-and-burn core of `crank_buyback` factored out,
  a change to the most-reviewed instruction. The keeper's weekly self-burn sweep stays for void coins.
- The devnet upgrade and run (owner commands staged), the verified-build table (rewritten at the upgrade), the mainnet upgrade (a Squads
  proposal after the 48 h time lock, ~2026-10-23).
- Coin pages do not yet show the end-sink state (the registry status keys `rule.endsink.<mint>` and `rule.endfwd.<mint>` hold it).

## What flips creator launches on

All of these, in order; until then `BURNTICKER_CREATOR_LAUNCHES_ENABLED` stays off:

1. The devnet Squads upgrade executed and the devnet run's checks green (evidence README).
2. The mainnet Squads upgrade of burn_receipts executed (after the 48 h lock), read back with `verified-build.sh --onchain mainnet`,
   and `config/burnticker/verified-build.json` rewritten.
3. The host flags, one staged script (`scripts/ops/burnticker-open-creator-launches.sh --apply <host env file>`):
   `BURNTICKER_INITIALIZE_TOKEN_LAYOUT=r4` (the code default stays "r3"; any other value is refused), `BURNTICKER_END_SINKS_LIVE=1`,
   `BURNTICKER_PAIR_CURVE_ENABLED=1`, `BURNTICKER_CREATOR_LAUNCHES_ENABLED=1`.
4. The launch review's cost estimate counts the EndSink account's rent (launchReview.ts, website-12's file).

Plan (owner, 2026-10-12): mainnet Squads upgrade Friday 2026-10-16 (two days after $DEFICIT is created on round 3), creator launches open
Monday 2026-10-19. The upgrade also carries the pair-forward round-3 re-check fixes (P3-1, P3-2, P3-I1). Rollback steps:
`docs/burnkeeper/evidence/devnet-endsink2/README.md` section B.
