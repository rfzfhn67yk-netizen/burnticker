> **RETIRED (owner decision 2026-10-25).** The burn-pool cap was removed from the burn_receipts program, together with the per-run
> 2 % bound and the cranker allowlist. There is no burn-pool cap and no limit on how much one burn spends: each burn spends the
> rule's full share of the burn pool in one run. The platform authority no longer holds a cap-raise power. The program refuses every
> cap raise (`propose_cap_raise`, `cancel_cap_raise` and `apply_cap_raise` always refuse with `CapRemoved`), and
> `scripts/burnreceipts-cap.mts` now refuses too. Nothing on this page can be run any more. The page is kept below unchanged as the
> history of the 2026-10-12 raise plan.

# Raising the burn-pool cap

The owner decided on 2026-10-12 to raise the burn-pool cap from 25 SOL to 1,000 SOL. This page says what the cap is, how the raise
happens, who signs each step, and how anyone can check it on chain.

## What the cap is

Before the burn program (`burn_receipts`, `AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM`) has been audited, a buyback spends at most
the cap from a coin's fee pool in one go. Anything above the cap stays in the coin's fee account; it is never moved anywhere else, and
it is spent by later buybacks. The cap only matters while it is in force. It ends on its own at the sunset date, which can never be
later than 1 October 2027 (00:00 UTC).

Until the program's platform settings account exists, the program uses the default: 25 SOL until the sunset. That account lives at
`EXz6enAb7mSUfC1bWJstF96uLZiCSdFcLLSQ9cwhhxx6`. On 2026-10-12 it did not exist on devnet or on mainnet.

The cap can only go up, never down. Every raise waits 48 hours in public before it takes effect. Only the platform authority can
withdraw a pending raise, and only before someone applies it.

## The three steps

1. **Create the settings and propose the raise (one Squads vault transaction).** The Squads vault holds the program's upgrade
   authority, so only the vault can create the settings account. The script `scripts/burnreceipts-cap.mts propose-vault` builds one
   vault transaction with two instructions, both signed by the vault:
   - create the settings account with the platform authority set to the vault, the cap at exactly 25 SOL (the program refuses any
     other starting value), the sunset date, and an optional list of up to three crank keys;
   - propose the new cap of 1,000 SOL.

   If the settings account already exists, the script builds only the proposal and says so.

   The vault pays the rent for the settings account (about 0.0019 SOL on mainnet), because inside a vault transaction the vault is
   the only key that signs. Send that much to the vault first; the dry run says how much is missing. The member who creates the
   proposal pays the rent for the Squads proposal and the transaction fee.

   Two of the three Squads members approve, and after the vault's time lock any member executes it. The 48 hour wait starts when it
   executes.
2. **Wait 48 hours.** The pending cap and the time it can be applied are stored in the settings account for anyone to read.
3. **Apply the raise.** After the 48 hours anyone can apply it, from any key. The script's `apply` command refuses before then and
   prints the time left.

## Who signs what

| Step | Signed by | Pays |
| --- | --- | --- |
| Create the vault transaction and its proposal | one Squads member with the Initiate permission | that member: proposal rent and fee |
| Approve | two of the three Squads members | each voter: their fee |
| Execute (create the settings, propose 1,000 SOL) | any Squads member; the vault signs the inner instructions | the vault: settings rent; the member: fee |
| Apply after 48 hours | anyone | that key: fee |

## Checking the pending raise yourself

- Run the read-only command, which prints the cap, the sunset, the pending cap, when it can be applied (Denver time and UTC), the
  authority and the crank keys:
  `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnreceipts-cap.mts show --cluster mainnet`
- Or read the account directly with `solana account EXz6enAb7mSUfC1bWJstF96uLZiCSdFcLLSQ9cwhhxx6 --url mainnet-beta`. The pending cap
  in lamports is the 8 bytes starting at byte 58, and the time it can be applied, in Unix seconds, is the 8 bytes starting at byte 66.
  The current cap starts at byte 42 and the authority at byte 10. Numbers are little-endian; a pending time of 0 means nothing is
  pending.
- The execute transaction's logs carry the program's `CapRaiseProposed` event with the current cap, the new cap and the time it can
  be applied. The apply transaction carries `CapRaised`.
- The authority must be the vault `8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV`.

## The owner's commands

Every command is a dry run unless it says `--send`. Replace the key paths with your own; the script never prints a key.

### Devnet first

The devnet multisig is `GfARhgcTZysagCH3CrC4mjXy3QkNnMuykW4aCzFx3K1w` (vault `A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD`,
2 of 3, 60 second time lock).

```sh
S="node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/alias-hook.mjs scripts/burnreceipts-cap.mts"
$S show --cluster devnet
solana transfer --url devnet --keypair <member A key> A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD 0.003 --allow-unfunded-recipient
$S propose-vault --cluster devnet --multisig GfARhgcTZysagCH3CrC4mjXy3QkNnMuykW4aCzFx3K1w --member <member A key> --memo "burn pool cap 25 to 1000 SOL"
$S propose-vault --cluster devnet --multisig GfARhgcTZysagCH3CrC4mjXy3QkNnMuykW4aCzFx3K1w --member <member A key> --memo "burn pool cap 25 to 1000 SOL" --send
squads-multisig-cli proposal-vote --rpc-url https://api.devnet.solana.com --keypair <member A key> --multisig-pubkey GfARhgcTZysagCH3CrC4mjXy3QkNnMuykW4aCzFx3K1w --transaction-index <index printed> --action Approve
squads-multisig-cli proposal-vote --rpc-url https://api.devnet.solana.com --keypair <member B key> --multisig-pubkey GfARhgcTZysagCH3CrC4mjXy3QkNnMuykW4aCzFx3K1w --transaction-index <index printed> --action Approve
squads-multisig-cli vault-transaction-execute --rpc-url https://api.devnet.solana.com --keypair <member A key> --multisig-pubkey GfARhgcTZysagCH3CrC4mjXy3QkNnMuykW4aCzFx3K1w --transaction-index <index printed>
$S show --cluster devnet
# 48 hours later
$S apply --cluster devnet --payer <any key>
$S apply --cluster devnet --payer <any key> --send --i-understand-this-raises-the-cap
```

### Then mainnet

The mainnet multisig is `7gYAZ6meH3W4VwEHcqq3cWgmSAL2w7voM91oaQezvDYc` (vault `8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV`,
2 of 3, time lock 0 today). The script never sends the proposal on mainnet. It prints the inner message, the unsigned proposal
transaction and an unsigned transaction of the two inner instructions for the Squads app's import, for the owner's own signing tool.

```sh
$S show --cluster mainnet
solana transfer --url mainnet-beta --keypair <member A key> 8zsHrHjSgunnLmVyPG848GLw5a9xai6u8SZCYaskWrDV 0.002
$S propose-vault --cluster mainnet --multisig 7gYAZ6meH3W4VwEHcqq3cWgmSAL2w7voM91oaQezvDYc --member DLxTkuqMfp5D6b87SikjptfL1preaYH2WbMdMfxu6ZCJ --memo "burn pool cap 25 to 1000 SOL"
# create the proposal from the printed bytes with your own signing tool, then:
squads-multisig-cli proposal-vote --rpc-url https://api.mainnet-beta.solana.com --keypair <member A key> --multisig-pubkey 7gYAZ6meH3W4VwEHcqq3cWgmSAL2w7voM91oaQezvDYc --transaction-index <index printed> --action Approve
squads-multisig-cli proposal-vote --rpc-url https://api.mainnet-beta.solana.com --keypair <member B key> --multisig-pubkey 7gYAZ6meH3W4VwEHcqq3cWgmSAL2w7voM91oaQezvDYc --transaction-index <index printed> --action Approve
squads-multisig-cli vault-transaction-execute --rpc-url https://api.mainnet-beta.solana.com --keypair <member A key> --multisig-pubkey 7gYAZ6meH3W4VwEHcqq3cWgmSAL2w7voM91oaQezvDYc --transaction-index <index printed>
$S show --cluster mainnet
# 48 hours later
BURNKEEPER_MAINNET=1 $S apply --cluster mainnet --payer <any key> --send --i-understand-this-raises-the-cap
```

The default sunset is the program's own limit, 1 October 2027. Pass `--sunset 2027-06-30` (any date up to that) for an earlier one,
and `--cranker <key>` up to three times to limit who may run buybacks while the cap is in force. Both are fixed once the settings
account exists.

## What was tested

`test/burnReceiptsCap.test.ts` pins the instruction bytes against the program's interface file, the vault message byte for byte, and
every refusal. With `BURN_RECEIPTS_LOCALNET=1` it runs the whole flow on a local validator through the real Squads v4 program:
proposal, approval, execution (the vault paid the settings rent), the refusal before 48 hours, and the apply. A local validator's
clock cannot be moved forward 48 hours, so the apply ran on a second validator loaded with the settings the first one wrote and the
waiting time moved into the past. The run is recorded in `docs/burnkeeper/evidence/cap-raise-localnet-2026-10-12/`.
