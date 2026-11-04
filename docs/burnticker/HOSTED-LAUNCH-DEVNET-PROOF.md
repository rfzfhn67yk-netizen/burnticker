# Hosted launch on devnet: what is proved, and the owner's wallet test (launch-10, 2026-10-12)

This page records the end-to-end check of a browser launch with the real LaunchLab client, and stages the steps that need the owner's
wallet. No agent signs or sends anything. Every send below is the owner's. Times are Denver.

## 1. What was proved without a wallet (2026-10-12, read-only)

All of this ran on the Mac against the public devnet RPC. It read accounts and asked for simulations. Nothing was signed or sent.

| Check | Result |
|---|---|
| The real client reads the devnet platform `GvSKpe5p…` and LaunchLab's SOL global config `7ZR4zD7P…` | Decoded. Name "Burnticker", fee 2,500 ppm, creator fee 5,000 ppm, LP scales 1,000,000 / 0 / 0, Fee Key wallet `Bj4XCAoG…` (the fee-keys PDA), CPMM config `5MxLgy9o…`. The LP-lock pins pass. |
| The bundle the server builds (`prepareLaunch`, the real program client and the real LaunchLab client) | `ready: true`, `pending: []`, one step: `initialize_token` and LaunchLab `initialize_v2`, signed by the creator and the mint. No opening purchase. |
| Its size as a version-0 transaction against the expected lookup table | 979 bytes (limit 1,232). The size check reports no problem. |
| Each instruction simulated on devnet on its own (signature checks off) | `initialize_token`: success, 50,514 compute units. `initialize_v2`: success, 101,420 compute units. |
| The whole step simulated | Not possible yet: no devnet lookup table exists, and without one the step is over the packet limit. Section 2 step A fixes that. |
| The local build (`next dev --webpack` on port 3010 with the devnet settings in section 2 step B) | `GET /api/burnticker/launch` serves the pins. `POST /api/burnticker/launch` returned a ready bundle and a draft for the creator `Bfy67FZE…`. A request with an opening purchase was refused with `opening-purchase-off`. A confirmation with a signature that is not the coin's launch was refused by the chain reader (`launch-unverified`). `/burnticker/launch` answered 200. |

Rerun the read-only part at any time (it prints the same record; `--simulate` adds the simulations):

```bash
R scripts/burnticker-hosted-launch-proof.mts --creator <YOUR_DEVNET_WALLET_PUBKEY> --simulate
```

## 2. What needs the owner's wallet

### Session setup (Mac, from this worktree)

```bash
cd ~/Projects/mct-wt-LAUNCH10; R() { node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs "$@"; }; D=~/.config/meme-coin-trader/devnet
```

### Step A. The devnet lookup table (once; about 0.004 SOL of rent from the devnet payer)

```bash
R scripts/burnticker-lut.mts create --cluster devnet --keypair "$D/payer.json"
R scripts/burnticker-lut.mts create --cluster devnet --keypair "$D/payer.json" --send
```

The second command prints `new devnet table address: <T>`. Then freeze it and verify it:

```bash
R scripts/burnticker-lut.mts freeze --cluster devnet --keypair "$D/payer.json" --address <T> --send
R scripts/burnticker-lut.mts verify --cluster devnet --address <T>
```

`verify` must end with "matches the expected entries" and print a record line plus `BURNTICKER_LOOKUP_TABLE=<T>`. Paste the record
line into section 3.

### Step B. The local build on devnet (a second terminal; stop it with Ctrl-C)

```bash
cd ~/Projects/mct-wt-LAUNCH10 && mkdir -p ~/burnticker-devnet-proof && env BURNTICKER_CLUSTER=devnet BURNTICKER_RPC_URL=https://api.devnet.solana.com NEXT_PUBLIC_BURNTICKER_RPC_URL=https://api.devnet.solana.com BURNTICKER_PROGRAM_ID=AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM BURNTICKER_PLATFORM_ID=GvSKpe5pwLuRzCQ56EGAA1urjtcxx554NivsGHexv3tf BURNTICKER_ADMIN=A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD BURNTICKER_KEEPER_PUBKEY=D8seUoC1RZUs7918Atcc7TbFwRf1khqFvPdjkB4qktbn BURNTICKER_FEE_WALLET=3s97xfWwH5qwPjqrmjHwPobZ3Z6oxWMQm2CDVQoA5pZp BURNTICKER_CREATOR_LAUNCHES_ENABLED=1 BURNTICKER_ALLOW_HOSTED_METADATA=1 BURNTICKER_DB=$HOME/burnticker-devnet-proof/registry.sqlite BURNTICKER_PUBLISH_DIR=$HOME/burnticker-devnet-proof/publish BURNTICKER_PUBLIC_ORIGIN=http://localhost:3010 BURNTICKER_LOOKUP_TABLE=<T> npx next dev --webpack -p 3010
```

The registry is a scratch file outside the repository. `BURNTICKER_ALLOW_HOSTED_METADATA=1` lets the devnet coin use the local
metadata address because the Mac has no Arweave uploader; it is never set on the live host.

### Step C. The wallet test, nine steps (website-7's script, rerun against the real client)

Use a browser wallet set to devnet with at least 0.2 devnet SOL. Its address is the creator.

1. Open `http://localhost:3010/burnticker/launch`. No "closed" or "preview" banner shows. Note the time.
2. Connect the wallet. The page shows the connected address. Nothing is signed by connecting.
3. Search `Detroit high above 90` and press "Use this". The review names Detroit's station and 91°F.
4. On the review, check the summary before the wallet: devnet, one transaction, about 0.057 SOL. The line saying vault mode is not
   offered is there. Nothing mentions an opening purchase except the one line on the signing card.
5. Press Launch. The signing card shows one step, "Create $<TICKER> with its rule locked in", signed by your wallet and the mint key,
   and no "Not signable here yet" list. If the list says the lookup table is missing or does not match, stop: step A or the
   `BURNTICKER_LOOKUP_TABLE` value is wrong.
6. The wallet opens. Check it says devnet and shows one transaction. Approve it.
7. The step turns to a check mark with a signature, then "$<TICKER> recorded as launched", then the coin page opens. Copy the
   signature and the mint from the card or the coin page.
8. Read it back from the chain (read-only probe, runsheet block P; `$H/probe.mjs` from section 0.6):
   `CLUSTER=devnet RPC=https://api.devnet.solana.com PROGRAM_ID=AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM MINT=<mint> R --input-type=module -e "$(cat "$H/probe.mjs")"`.
   Expect `launchlab.creatorIsFeePda: true`, `launchlab.platformId` = `GvSKpe5p…`, a TokenConfig whose `rulesSha256` equals the
   coin page's rule fingerprint, and both mint authorities null.
9. The refusal paths. Start a second launch and reject it in the wallet: the card says nothing was sent and the button offers to
   continue. Then stop the build, restart it with `BURNTICKER_CLUSTER=mainnet` (and nothing else changed), and press Launch on a
   review: it must refuse with "This site does not create coins on Solana mainnet yet, so nothing is built or sent here."

## 3. Results (owner fills in)

| Item | Value |
|---|---|
| Lookup table record line from `verify` | |
| Launch signature (step 7) | |
| Mint (step 7) | |
| Probe output matches step 8 (yes or no, and what differed) | |
| Rejection and mainnet refusal (step 9) | |

## 4. Before mainnet (not part of this test)

The live host stays closed: creator launches open only after the end-of-rule sink round is live and reviewed (owner decision,
2026-10-12). When that time comes, a mainnet host needs all of the following, and `hostedSigning()` in
`src/lib/burnticker/hostedLaunch.ts` lists whatever is missing:

- a mainnet lookup table made, frozen and verified with the same script, then `BURNTICKER_LOOKUP_TABLE=<address>` on the host;
- `NEXT_PUBLIC_BURNTICKER_RPC_URL` set to a mainnet RPC at build time, because the browser's wallet connection otherwise points at devnet
  and the signing card refuses;
- `BURNTICKER_ALLOW_MAINNET_LAUNCHES=1`, the owner's explicit allowance;
- `BURNTICKER_RPC_URL`, `BURNTICKER_PROGRAM_ID`, `BURNTICKER_PLATFORM_ID` (`94x5qDDJ…`), `BURNTICKER_ADMIN` and `BURNTICKER_FEE_WALLET`,
  which the live host already has or the trust page lists.
