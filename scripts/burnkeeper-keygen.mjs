// Generates the BURN KEEPER's own key (2026-10-09, the $DEFICIT launch — rule key DEBT). THIS FILE PRINTS NO KEY.
//
// The keeper's key is the burn vault's ONLY authority (SPEC §2/§4: "its own Solana keypair (burn authority only; holds ~0.1 SOL;
// never the treasury)"). If it were ever compromised the vault is the only thing at risk — not the treasury, not the LP, not any
// holder — which is exactly why it must never be the treasury's key or any arm's. On Raydium LaunchLab (the owner, 10-09 evening) this
// address is also the VESTING BENEFICIARY: the creator assigns the locked share to it, and only it can claim what has vested.
//
// Encrypted exactly the way src/lib/burnKeeper/keyfile.ts decrypts *.enc.json: AES-256-GCM under a scrypt key, the cleartext a JSON
// array of the 64 secret bytes. Mode 600, directory 700, OUTSIDE this repository. The passphrase is
// BURNKEEPER_SIGNER_PASSPHRASE when set (a keeper-only passphrase), else the treasury's AUTONOMOUS_SIGNER_PASSPHRASE / Keychain item.
//
//   BURNKEEPER_SIGNER_PASSPHRASE=… node scripts/burnkeeper-keygen.mjs --new        (or a wrapper that reads the passphrase from the host's keychain)
//
// Only the public ADDRESS is printed, and written to <key>.address. Refuses to overwrite a key, refuses a path inside the repository,
// and refuses a path that is the treasury's signer file.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import { encryptSecretKey } from "../src/lib/burnKeeper/keyfile.ts";

const KEY_PATH = process.env.BURNKEEPER_SIGNER_PATH?.trim() || path.join(os.homedir(), ".config", "meme-coin-trader", "signer-burnkeeper.enc.json");

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  if (!process.argv.includes("--new")) { console.log("usage: BURNKEEPER_SIGNER_PASSPHRASE=… node scripts/burnkeeper-keygen.mjs --new"); process.exit(1); }
  const passphrase = process.env.BURNKEEPER_SIGNER_PASSPHRASE || process.env.AUTONOMOUS_SIGNER_PASSPHRASE;
  if (!passphrase || passphrase.length < 8) { console.error("no passphrase (BURNKEEPER_SIGNER_PASSPHRASE or AUTONOMOUS_SIGNER_PASSPHRASE, 8+ characters)"); process.exit(3); }
  const resolved = path.resolve(KEY_PATH);
  if (["signer.enc.json", "signer.json"].includes(path.basename(resolved))) { console.error(`refusing: ${resolved} is the treasury's key file name`); process.exit(2); }
  if (resolved.startsWith(path.resolve(process.cwd()) + path.sep)) { console.error(`refusing: ${resolved} is inside the repository — keep the key outside it`); process.exit(2); }
  if (fs.existsSync(resolved)) { console.error(`refusing to overwrite ${resolved} — move it aside first`); process.exit(2); }
  const kp = Keypair.generate();
  const secret = Uint8Array.from(kp.secretKey);
  const bundle = encryptSecretKey(secret, passphrase);
  secret.fill(0);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  fs.writeFileSync(resolved, JSON.stringify(bundle, null, 2), { mode: 0o600, flag: "wx" });
  const address = kp.publicKey.toBase58();
  fs.writeFileSync(`${resolved}.address`, `${address}\n`, { mode: 0o644 });
  console.log(`\n  wrote ${resolved} (mode 600, encrypted)`);
  console.log(`  address ${address}`);
  console.log(`\n  This address is the burn vault's only authority and (on LaunchLab) the vesting beneficiary. Fund it with about 0.1 SOL for`);
  console.log(`  fees. It never holds the treasury's money, and the keeper refuses to start if it is the treasury's address.\n`);
}
