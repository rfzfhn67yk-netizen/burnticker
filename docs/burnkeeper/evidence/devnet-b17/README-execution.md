# Devnet B-17 upgrade of burn_receipts, 2026-10-21 (executed 18:49 Denver, 00:49Z 10-22)

Same build commit as mainnet (116ff5ad), devnet feature set. Built on the operator's Mac with
`cargo build-sbf --features devnet` from the merged tree: 1,030,888 bytes, file sha256
`9dde1f9f5d5990b354166f6d2b13845202cd10a9c9ec7fe94b3b39c1f97e0a6f`, executable hash
`34d7b68e21dbb3b9629d437bb309767019be406eb55352ee95915061aa0ae4ee` = the devnet build recorded in
`config/burnticker/verified-build.json` on 2026-10-21 (reproduced to the byte).

Program `AuQjoSgq7upmyPBv2itwy2TSZ1VjoVipyy4z9wd7zhMM`, ProgramData `CqKa66TxEaqLXAuFyJdha4uosBosEEf2CBccNiE8gbKn`,
upgrade authority the devnet 2-of-3 Squads vault `A8VVQ8ztPcPmKTzWJDADP8EthMg8DvqKcK15dNBqMffD`
(multisig `GfARhgcTZysagCH3CrC4mjXy3QkNnMuykW4aCzFx3K1w`, 60 s time lock). The vault's members are throwaway devnet
keypairs on the operator's Mac, so the whole sequence ran without a wallet app. Public devnet RPC throughout.

| step | result |
|---|---|
| program data already 1,038,581 bytes, no `extend` needed | — |
| `solana program write-buffer` (deployer) | buffer `4LGLFBv1GEmUmGwD636UvJaqZoWnxjEFpT3Syte77DoA` (`write-buffer.log`) |
| `set-buffer-authority` → the vault | Authority: `A8VVQ8zt…MffD` |
| proposal via `scripts/squads-program-upgrade.mts --send` (member squads-a, spill squads-a, `--expect-file` the local .so, `--table` verified-build.json): buffer executable hash = table = local file; buffer authority = program authority = vault; vault transaction 23 | `4Ce79NGBQPLBR7FUnr9YpAq3aZ5VPF29c6EyZig41hYbah8VUDwyG2eZcTVegs7XMWK6qZ15h63gQaNtoD9NU4cf` (`propose.log`) |
| approve squads-a, squads-b (00:47Z) | `56tXUsBKsECeeMNGvKdHjx2xPpABkuaKPqgB35v1MzzNA6v8CMwh3SdqVJooWUv1tdmfRSNDhAXYMmB27Uvprrtc`, `42YLjbeBqK6Kkvn1jVJ2hXS7xUQwfnEioQcdkJqeWxNczEVBUGARzWVEToq3jWB8Jdbqj7tZFRaxWfUKvfJXaoz2` |
| execute after the 60 s lock (00:49Z) | `2viXZqW5ogMn28iqxBjnEYqopH7UX2FhAde8WikiKwduTKqQ9j9tASh1Z5aCXTcU8k3RxVzgJ626HLpAV5EXxPV1` (`execute.log`) |

Read back from ProgramData at 00:51:02Z: last-deployed slot 513,708,808, upgrade authority still the vault, 1,030,873 code
bytes, executable hash `34d7b68e…4ee` = the build (previous `74659afd…785c`, slot 511,540,317). The buffer's rent went to the
spill (squads-a). Devnet keeper clients choose the register_fee_key account list from the live hash, so they use the B-17
layout from this slot on without a restart.
