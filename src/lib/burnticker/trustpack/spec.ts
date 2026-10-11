/**
 * THE TRUST PACK IN THE PUBLIC API (2026-10-10; OpenAPI 1.5.0). Six read-only operations and their schemas, kept out of
 * src/lib/burnticker/api/spec.ts's table (spec.ts spreads them into SCHEMAS / ENDPOINTS, a two-line splice like Burn Derby's).
 * Same conventions: hand-written JSON Schema, additive only within v1.
 */
type Schema = Record<string, unknown>;
const str: Schema = { type: "string" };
const nstr: Schema = { type: ["string", "null"] };
const int: Schema = { type: "integer" };
const bool: Schema = { type: "boolean" };
const nbool: Schema = { type: ["boolean", "null"] };
const arr = (items: Schema): Schema => ({ type: "array", items });
const obj = (properties: Record<string, Schema>, required: string[] = [], extra: Schema = {}): Schema => ({ type: "object", properties, required, ...extra });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const PUBKEY: Schema = { type: "string", pattern: "^[1-9A-HJ-NP-Za-km-z]{32,44}$" };

export const TRUSTPACK_SCHEMAS: Record<string, Schema> = {
  CheckItem: obj({ id: str, title: str, text: str, where: str, status: str }, ["id", "title", "text", "where"]),
  Check: obj({
    schema: { const: "burnticker.check/v1" }, generatedFrom: arr(str),
    programs: arr(obj({ name: str, programId: PUBKEY, idlSha256: str, register: str, privileged: int, overFunds: { const: "none" } }, ["name", "programId", "privileged", "overFunds"])),
    money: arr(obj({ program: str, instruction: str, class: str, signers: str, outflow: str, outflowClass: str, funds: str }, ["program", "instruction", "outflow", "outflowClass"])),
    nonPowers: arr(obj({ program: str, text: str }, ["program", "text"])),
    powers: arr(obj({ program: str, instruction: str, holder: str, can: str, timelock: nstr, funds: str }, ["program", "instruction", "holder", "funds"])),
    upgradeAuthority: arr(obj({ program: str, holder: str, sunset: str }, ["program", "holder"])),
    external: arr(obj({ program: str, power: str, holder: str, effect: str }, ["program", "power", "holder"])),
    locked: arr(ref("CheckItem")), notDone: arr(ref("CheckItem")), build: { type: "object", description: "config/burnticker/verified-build.json: the executable hash of each program per build (mainnet / devnet features) and of the deployed bytes" },
  }, ["schema", "programs", "money", "powers", "locked", "notDone", "build"], { description: "The sceptic's checklist against ourselves: where money can go (every instruction of both programs with its outflow), who can do what (no power over funds), what is locked, what is not done, and the verified-build table. docs/burnticker/CHECK-THIS-YOURSELF.md is rendered from the same object." }),
  CheckReceipt: obj({ ticker: str, recordDate: str, units: int, status: str, signature: str, memo: str, explorerUrl: str, evidence: str, rulesPath: str, rulesSha256: nstr }, ["ticker", "recordDate", "signature", "memo", "rulesPath"]),
  CheckReceipts: obj({ cluster: { const: "devnet" }, programId: PUBKEY, rpc: str, receipts: arr(ref("CheckReceipt")), rules: { type: "object", description: "rules file path → exact text (the verifier hashes it and compares the on-chain TokenConfig.rules_sha256)" } }, ["cluster", "programId", "receipts", "rules"]),
  ReceiptCheckLine: obj({ id: { enum: ["tx", "program", "memo", "reading", "config", "rules", "source", "units", "spend", "burn"] }, label: str, ok: nbool, detail: str }, ["id", "label", "ok", "detail"]),
  ReceiptCheck: obj({ verified: bool, checks: arr(ref("ReceiptCheckLine")), facts: { type: "object" }, ranOn: str, sample: { anyOf: [ref("CheckReceipt"), { type: "null" }] } }, ["verified", "checks", "facts"], { description: "The browser verifier's checks run on the server: transaction, program, memo, the program-owned Reading and TokenConfig accounts, the rules hash, the re-fetched Treasury source (its URL hashed against the Reading's source_url_hash), units, spend (the program's fixed point) and the burn instructions." }),
  FeeLedger: obj({
    schema: { const: "burnticker.fee-ledger/v1" }, generatedAt: str, cluster: str, wallet: { anyOf: [PUBKEY, { type: "null" }] }, source: { enum: ["chain", "unavailable"] }, note: str,
    balanceLamports: nstr, totals: obj({ inLamports: str, outLamports: str, transactions: int, complete: bool }, ["inLamports", "outLamports", "transactions"]),
    months: arr(obj({ month: str, inLamports: str, outLamports: str, txIn: int, txOut: int }, ["month", "inLamports", "outLamports"])),
    entries: arr(obj({ signature: str, slot: int, blockTime: nstr, month: nstr, deltaLamports: str, direction: { enum: ["in", "out"] }, counterparty: nstr, err: bool }, ["signature", "deltaLamports", "direction"])),
    expenses: obj({ whatTheFeePaysFor: str, items: arr(obj({ id: str, label: str, cadence: str, usd: { type: ["number", "null"] }, placeholder: bool, todo: nstr, note: str }, ["id", "label", "usd", "placeholder"])) }, ["whatTheFeePaysFor", "items"]),
    placeholders: arr(str), served: str,
  }, ["schema", "cluster", "wallet", "source", "totals", "months", "entries", "expenses"], { description: "Every lamport the developer fee wallet (pinned in config/burnticker/operator.json for the platform's cluster) received or sent, read from chain, by UTC month; and the expenses the fee pays (placeholders marked)." }),
  OperatorView: obj({
    schema: { const: "burnticker.operator-view/v1" }, cluster: str, operator: { type: "object" }, links: { type: "object" }, clusters: { type: "object" },
    signedMessage: obj({ status: { enum: ["todo", "signed", "invalid"] }, signer: nstr, message: str, signature: nstr, verified: nbool, how: str, detail: str }, ["status", "message", "verified"]),
    neverBuys: obj({ rule: str, rehearsalNote: str, report: { anyOf: [{ type: "object" }, { type: "null" }] }, line: str, status: { enum: ["clear", "explained", "red", "not-run"] } }, ["rule", "line", "status"]),
    placeholders: arr(obj({ path: str, value: str }, ["path", "value"])), wellKnown: str,
  }, ["schema", "operator", "clusters", "signedMessage", "neverBuys", "placeholders"], { description: "Who runs the platform, every operator wallet per cluster (TODO placeholders shown), the signed-statement slot with its ed25519 check, and the never-buys monitor's last report." }),
  Bounty: obj({ wallet: { anyOf: [PUBKEY, { type: "null" }] }, walletTodo: nstr, balanceLamports: nstr, error: nstr, rangeSol: arr(int), fundedFrom: str, status: str, contact: nstr, terms: str, howReportsArePaid: nstr, reports: { type: "object" } }, ["wallet", "rangeSol", "status", "reports"]),
};

const SIG_PARAM = { name: "signature", in: "path" as const, required: true, description: "the receipt's transaction signature (base58)", schema: { type: "string", pattern: "^[1-9A-HJ-NP-Za-km-z]{64,88}$" } };

export const TRUSTPACK_ENDPOINTS = [
  { operationId: "getCheck", method: "GET" as const, path: "/check", tag: "platform", summary: "Check this yourself: money flows, powers, locks, gaps, build hashes", description: "Since 1.5.0. Every instruction of burn_receipts and pair_curve with the only place it can move funds, every privileged power (none over funds), what is locked, what is not done yet, and the verified-build table. Built from the Powers Registers and the public config files; no network.", params: [], request: null, response: "Check", errors: [429], cacheSec: 600, bucket: "read" as const },
  { operationId: "listCheckReceipts", method: "GET" as const, path: "/check/receipts", tag: "platform", summary: "The devnet receipts the verifier offers, with their rules files", description: "Since 1.5.0. Every confirmed receipt of the 2026-10-10 devnet rehearsals (from the evidence files) and the exact rules text of each token; the verifier hashes the text and compares the on-chain TokenConfig.", params: [], request: null, response: "CheckReceipts", errors: [429], cacheSec: 600, bucket: "read" as const },
  { operationId: "checkReceipt", method: "GET" as const, path: "/check/receipts/{signature}", tag: "platform", summary: "Verify one receipt transaction from the chain and the source", description: "Since 1.5.0. The /burnticker/check page's browser verifier run on the server: fetches the transaction and the burn program's Reading and TokenConfig accounts from devnet, the Treasury values for the reading's two dates, and recomputes units, spend and the burn. Each check ok true / false / null (not checkable, with the reason).", params: [SIG_PARAM], request: null, response: "ReceiptCheck", errors: [400, 429], cacheSec: 300, bucket: "heavy" as const },
  { operationId: "getFeeLedger", method: "GET" as const, path: "/fees/ledger", tag: "platform", summary: "The developer fee wallet's ledger from chain, by month, and the expenses it pays", description: "Since 1.5.0. Every balance change of the pinned developer fee wallet (config/burnticker/operator.json, the platform's cluster), read from chain and grouped by UTC month; the published copy (scripts/burnticker-trustpack.mts fees-ledger) while under an hour old, else a cached chain read. Expenses from config/burnticker/expenses.json, placeholders marked.", params: [], request: null, response: "FeeLedger", errors: [429], cacheSec: 600, bucket: "read" as const },
  { operationId: "getOperator", method: "GET" as const, path: "/operator", tag: "platform", summary: "Who runs this, the operator wallets, the signed statement and the never-buys monitor", description: "Since 1.5.0. config/burnticker/operator.json with every TODO placeholder listed, the signed-statement check (ed25519 over the exact text) and the never-buys monitor's last report (no chain scan on a request).", params: [], request: null, response: "OperatorView", errors: [429], cacheSec: 60, bucket: "read" as const },
  { operationId: "getBounty", method: "GET" as const, path: "/bounty", tag: "platform", summary: "The bounty wallet, its live balance, and the decided reports", description: "Since 1.5.0. The wallet is null (walletTodo says why) until the mainnet Squads vault exists; then its balance is read live from mainnet.", params: [], request: null, response: "Bounty", errors: [429], cacheSec: 60, bucket: "read" as const },
];
