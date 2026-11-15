# Rolling out the second reading signer

Staged on 2026-10-12. Nothing on this page has been run. The owner runs every command and presses every Send. Times are Denver time
unless a line says UTC. Why a second signer and how it works is in [SIGNER-TWO.md](SIGNER-TWO.md). The program's rules for changing a
coin's signers are in [ATTESTERS.md](ATTESTERS.md).

In short: a small separate host runs the signer with its own key. The keepers ask it to co-sign each reading. First it runs in shadow, with
its key not yet on any coin. Then the Squads vault proposes adding its key and raising the quorum from 1 to 2. After the 48-hour wait the
change is applied, and from then on every reading needs both signatures. The quorum can never come down again.

## 1. What the owner sets up (provisioning)

1. **A separate small host.** A small cloud host (the smallest shared x86 type) or a similar machine, about $5 a month. It must not be the trading VPS. The trading VPS never
   gets Burnticker code or keys. It must not be the keeper's box either, or the second signature means nothing. Join it
   to the tailnet so the keeper's box can reach it on a 100.x address.
2. **Node 22 and a plain clone of the public repository** in `~/burnticker-signer`, then `npm ci`. No env file from any other host is
   copied there.
3. **A new key, made on that host, with the owner's passphrase.** Claude does not make it. On the signer host:

   ```sh
   cd ~/burnticker-signer
   R() { node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs "$@"; }
   read -rs BURNTICKER_ATTESTER_PASSPHRASE && export BURNTICKER_ATTESTER_PASSPHRASE
   R scripts/burnticker-attester.mts keygen --out ~/.config/burnticker-cosigner/cosigner.enc.json
   unset BURNTICKER_ATTESTER_PASSPHRASE
   ```

   The file name must end in `.enc.json`, or the signer refuses to load it. The public key is in `cosigner.enc.json.address`.
4. **0.1 SOL to that public key.** The signer itself never pays a fee and never sends anything. The SOL lets the key pay for a
   transaction by hand later if the owner ever wants it to (for example a permissionless apply). It holds nothing else.
5. **The coins file** `~/.config/burnticker-cosigner/coins.json`, with the rules files copied beside it from the repository
   (`config/burnkeeper/deficit.rules.json`, `config/burnkeeper/rehearsal.rules.json`). `baselineAt` is the coin's launch time from its
   launch transaction:

   ```json
   [
     { "mint": "AJJ4XxCUYr8zzMWm8FYg3xh638LYAAApdNqWBqCK4oqj", "ticker": "DEFICIT", "kind": "debt", "rulesFile": "deficit.rules.json", "baselineAt": "<launch time, ISO>" },
     { "mint": "FwXiFscFSYXzvPVzV4rCw4UBcGDhT53xHDpsL3pVpzkp", "ticker": "REHEARSAL", "kind": "debt", "rulesFile": "rehearsal.rules.json", "baselineAt": "2026-10-11T<time>Z" }
   ]
   ```

6. **The local env file on the signer host** (mode 600, typed in by the owner). The names are listed in `scripts/burnticker-signer.mts`:
   `BURNTICKER_COSIGNER_KEY`, `BURNTICKER_COSIGNER_PASSPHRASE`, `BURNTICKER_COSIGNER_CLUSTER=mainnet`, `BURNTICKER_COSIGNER_PROGRAM_ID`,
   `BURNTICKER_COSIGNER_RPC_URL` (a read-only mainnet RPC, not the keeper's), `BURNTICKER_COSIGNER_COINS`,
   `BURNTICKER_COSIGNER_LISTEN=<the host's 100.x address>:8790`, and `BURNTICKER_COSIGNER_TOKEN` (a long random string).
7. **The unit.** Copy `deploy/systemd/mct-burnticker-signer.service` to `~/.config/systemd/user/`, then
   `systemctl --user daemon-reload && systemctl --user enable --now mct-burnticker-signer`. Check it with
   `sh scripts/service/run-burnticker-signer.sh health`. It prints the key, the program, the cluster and the coins.

## 2. Shadow (quorum still 1)

On the keeper's box, add two lines to its local env file: `BURNTICKER_COSIGNER_URL=http://<signer 100.x address>:8790` and
`BURNTICKER_COSIGNER_TOKEN=<the same token>`. Restart `mct-burnkeeper` and `mct-burnticker-keeper` the usual way, between cycles and never
mid-send. The keeper log then shows a "second signer" line at start and a `[cosign]` line for every reading.

What changes in shadow: the signer's key is not on any coin yet, so its signature is not sent. When it agrees, the reading goes ahead as
before. **When it disagrees, the reading is held and an alert is raised**, even at quorum 1. When it cannot check (Treasury down, the host
down), the keeper goes ahead alone and logs why. The owner should decide before step 2 whether a hold at quorum 1 is acceptable for
$DEFICIT's first week. If it is not, leave the keeper lines out until the proposal is made.

**Gate before proposing:** at least three $DEFICIT readings co-signed in shadow with no disagreement, and the signer's journal on its host
showing the same messages the chain holds.

## 3. The proposals

Print the plan on the owner's Mac (it only reads the chain, and signs nothing):

```sh
R scripts/burnticker-signer-rollout.mts --signer <signer public key> --program <mainnet burn_receipts id> --rpc <read-only mainnet RPC> --payer <Squads vault address>
```

For each coin it prints the step, the times in UTC, the unsigned `propose_attesters` instruction (the vault is its signer) and the unsigned
`apply_attester_change` instruction. Put each one to the Squads vault as a vault transaction, with the program id, accounts and data exactly
as printed. Two of three members approve and execute. Add `--now <ISO time>` to see a later day's plan.

| Coin | Keeper key joined | Earliest proposal (keeper key 7 days in the set) | Earliest apply (48 hours later) | Second key senior |
|---|---|---|---|---|
| $REHEARSAL | initialize_token, 2026-10-11 | Sunday 2026-10-18, at the same time of day | Tuesday 2026-10-20 | Tuesday 2026-10-27 |
| $DEFICIT | initialize_token, launch night Wednesday 2026-10-14 | Wednesday 2026-10-21, evening | Friday 2026-10-23, evening | Friday 2026-10-30 |

The script prints the exact minutes from the chain. $REHEARSAL goes first, as a mainnet rehearsal of the change itself. $DEFICIT follows
once a $REHEARSAL reading has landed with both signatures. That keeps $DEFICIT inside the trust page's 14 days after launch (by
2026-10-28).

**Before the apply lands, both keepers must have `BURNTICKER_COSIGNER_URL` set** (step 2). After the apply, a reading without the second
signature waits. It is late, never lost.

**Pair sets.** No pair coin exists on mainnet, and pair launches stay off. The script reports a paired coin and does not plan it. A pair
changes its set only through `apply_paired_attester_change` with the partner's quorum, both coins must keep one set, and the signer cannot
check pair coins yet. Pair coins stay at quorum 1 until it can. A two-signature pair win also needs a lookup table that the pair client
does not pass yet.

## 4. If something goes wrong

- **The signer disagrees.** The keeper holds that day and raises `cosigner-disagree`. Compare the two values in the alert with the
  source row. If the signer is wrong, fix the signer and the day goes through on the next cycle. If the keeper is wrong, it is an incident
  under [INCIDENTS.md](INCIDENTS.md).
- **The signer host is down after the apply.** Readings wait. Bring the host back. Nothing is lost.
- **The key is lost.** At quorum 2 with two keys, a lost key stops readings until a new set is applied. The vault proposes a set that
  keeps the keeper key and adds a new second key, and the same 7-day and 48-hour rules apply. Keep a sealed copy of the encrypted key file
  and the passphrase offline.
