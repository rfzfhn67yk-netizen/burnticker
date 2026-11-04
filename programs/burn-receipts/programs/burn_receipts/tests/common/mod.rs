//! LiteSVM harness for burn_receipts: the program under test, the REAL Raydium CPMM program (built from source as a fixture), SPL
//! Token / ATA / Memo (LiteSVM defaults) and the Ed25519 precompile. Everything here is local and in-process.
#![allow(dead_code)]

pub mod cpmm;

use anchor_lang::prelude::{Clock, Pubkey};
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program_pack::Pack;
use anchor_lang::solana_program::system_instruction;
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use anchor_spl::associated_token::{get_associated_token_address, spl_associated_token_account};
use anchor_spl::token::spl_token;
use burn_receipts::constants::*;
use burn_receipts::state::{AttesterEntry, Reading, RuleParams, TokenConfig};
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

pub type TxResult = Result<TransactionMetadata, FailedTransactionMetadata>;

pub const SOL: u64 = 1_000_000_000;
pub const UNIT: u64 = 100_000_000_000; // $1B in cents
pub const DECIMALS: u8 = 6;
pub const TOKEN: u64 = 1_000_000; // 10^DECIMALS
/// 2026-10-09T12:00:00Z
pub const NOW: i64 = 1_791_547_200;
pub const FEED: &str = "treasury.debt_to_penny";
pub const SRC: &str = "fiscaldata.treasury.gov debt_to_penny";
pub const CPMM_ADMIN_SEED: [u8; 32] = [42u8; 32];
pub const CREATE_POOL_FEE_RECEIVER: Pubkey = anchor_lang::prelude::pubkey!("DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8");
pub const COMPUTE_BUDGET_ID: Pubkey = anchor_lang::prelude::pubkey!("ComputeBudget111111111111111111111111111111");
pub const SYSVAR_RENT_ID: Pubkey = anchor_lang::prelude::pubkey!("SysvarRent111111111111111111111111111111111");

pub fn rules_sha256() -> [u8; 32] {
    use sha2::Digest;
    let mut h = sha2::Sha256::new();
    h.update(b"{\"schema\":\"burnkeeper.rules/v1\",\"token\":\"DEBT\"} (test stand-in for config/burnkeeper/deficit.rules.json)");
    h.finalize().into()
}

pub struct Env {
    pub svm: LiteSVM,
    pub payer: Keypair,
    /// The program's upgrade authority in this test VM (LiteSVM deploys with none; Env::new sets this TEST key on the ProgramData).
    pub upgrade_authority: Keypair,
    /// Account keys of the last transaction sent, in message order (to resolve inner-instruction program ids).
    pub last_keys: Vec<Pubkey>,
}

pub const UPGRADE_AUTHORITY_SEED: [u8; 32] = [77u8; 32];

fn read_fixture(rel: &str, hint: &str) -> Vec<u8> {
    let p = format!("{}/../../{}", env!("CARGO_MANIFEST_DIR"), rel);
    std::fs::read(&p).unwrap_or_else(|e| panic!("cannot read {p}: {e}. {hint}"))
}

impl Env {
    pub fn new() -> Self {
        // The `test-pins` build (scripts/test.sh → target/deploy-test): mainnet genesis and Raydium ids, with the harness's
        // TEST_LAUNCHLAB_PLATFORM compiled in as BURNTICKER_PLATFORM (lp-lock blind review RL-3) and the test treasury [0x7e; 32]. The
        // default (mainnet) build pins no platform and refuses every policy-0/2 initialize_token (PlatformNotPinned).
        Self::with_program("target/deploy-test/burn_receipts.so", "Run scripts/test.sh first (builds --features test-pins).")
    }

    /// The DEFAULT (mainnet) build (anchor build → target/deploy/burn_receipts.so) — for the few tests about what only the deployable
    /// build does (round-5 review R5-5: initialize_token retired).
    pub fn new_mainnet_build() -> Self {
        Self::with_program("target/deploy/burn_receipts.so", "Run anchor build (or scripts/test.sh) first.")
    }

    fn with_program(rel: &str, hint: &str) -> Self {
        let mut svm = LiteSVM::new().with_precompiles();
        svm.add_program(burn_receipts::ID, &read_fixture(rel, hint)).unwrap();
        // Round-5 review R5-11 (opt-in): run against the REAL SPL Token / Associated Token programs dumped from a cluster instead of
        // LiteSVM's bundled copies (`solana program dump TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA /tmp/token.so -u mainnet-beta`).
        if let Ok(p) = std::env::var("REVIEW_TOKEN_SO") { svm.add_program(spl_token::ID, &std::fs::read(&p).expect("REVIEW_TOKEN_SO")).unwrap(); }
        if let Ok(p) = std::env::var("REVIEW_ATA_SO") { svm.add_program(anchor_spl::associated_token::ID, &std::fs::read(&p).expect("REVIEW_ATA_SO")).unwrap(); }
        svm.add_program(CPMM_PROGRAM_ID, &read_fixture("fixtures/raydium_cp_swap.so", "Run scripts/build-cpmm-fixture.sh first.")).unwrap();
        // The WSOL mint (SPL Token's native mint) — present on every real cluster, absent from a bare LiteSVM.
        let mut mint_data = vec![0u8; spl_token::state::Mint::LEN];
        spl_token::state::Mint { mint_authority: None.into(), supply: 0, decimals: 9, is_initialized: true, freeze_authority: None.into() }
            .pack_into_slice(&mut mint_data);
        svm.set_account(
            NATIVE_MINT,
            litesvm_account(svm.minimum_balance_for_rent_exemption(mint_data.len()), mint_data, spl_token::ID),
        )
        .unwrap();
        let payer = Keypair::new();
        svm.airdrop(&payer.pubkey(), 100_000 * SOL).unwrap();
        // ProgramData = [u32 tag 3][u64 slot][Option<Pubkey>: 1 + 32][ELF…]; give it a test upgrade authority.
        let upgrade_authority = Keypair::new_from_array(UPGRADE_AUTHORITY_SEED);
        let pd_key = program_data_address();
        let mut pd = svm.get_account(&pd_key).expect("programdata");
        pd.data[12] = 1;
        pd.data[13..45].copy_from_slice(upgrade_authority.pubkey().as_ref());
        svm.set_account(pd_key, pd).unwrap();
        svm.airdrop(&upgrade_authority.pubkey(), 10 * SOL).unwrap();
        let mut env = Env { svm, payer, upgrade_authority, last_keys: Vec::new() };
        // The test LaunchLab platform (review-3 M-3: initialize_token pins its cpConfigId = AmmConfig 0, scales 100 %).
        cpmm::set_platform_cp_config(&mut env, &cpmm::amm_config_0());
        env.set_time(NOW);
        env
    }

    pub fn set_time(&mut self, unix: i64) {
        let mut c: Clock = self.svm.get_sysvar();
        c.unix_timestamp = unix;
        c.slot += 1;
        self.svm.set_sysvar(&c);
        self.svm.expire_blockhash();
    }

    pub fn now(&self) -> i64 {
        let c: Clock = self.svm.get_sysvar();
        c.unix_timestamp
    }

    /// Sends a LEGACY transaction (compute-budget instruction + `ixs`). Review-2 F4/F17e: LiteSVM does not enforce the 1,232-byte
    /// packet limit, so every transaction this harness sends is serialized and asserted to fit — a test can no longer pass with a
    /// transaction no real cluster would accept.
    pub fn send(&mut self, ixs: &[Instruction], extra_signers: &[&Keypair]) -> TxResult {
        let signers = self.signers(extra_signers);
        let mut all = vec![compute_budget(1_400_000)];
        all.extend_from_slice(ixs);
        let msg = Message::new_with_blockhash(&all, Some(&self.payer.pubkey()), &self.svm.latest_blockhash());
        let keys = msg.account_keys.clone();
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers).unwrap();
        self.last_keys = keys;
        let size = tx_bytes(&tx);
        assert!(size <= PACKET_DATA_SIZE, "legacy transaction is {size} bytes (limit {PACKET_DATA_SIZE})");
        let r = self.svm.send_transaction(tx);
        self.svm.expire_blockhash();
        r
    }

    /// Sends a v0 transaction resolving accounts through the given address lookup tables (created with `create_lookup_table`); its
    /// serialized size is asserted ≤ 1,232 bytes too.
    pub fn send_v0(&mut self, ixs: &[Instruction], extra_signers: &[&Keypair], tables: &[solana_message::AddressLookupTableAccount]) -> TxResult {
        let signers = self.signers(extra_signers);
        let mut all = vec![compute_budget(1_400_000)];
        all.extend_from_slice(ixs);
        let msg = solana_message::v0::Message::try_compile(&self.payer.pubkey(), &all, tables, self.svm.latest_blockhash()).unwrap();
        let mut keys = msg.account_keys.clone();
        for (t, l) in tables.iter().zip(msg.address_table_lookups.iter()) {
            keys.extend(l.writable_indexes.iter().map(|i| t.addresses[*i as usize]));
        }
        for (t, l) in tables.iter().zip(msg.address_table_lookups.iter()) {
            keys.extend(l.readonly_indexes.iter().map(|i| t.addresses[*i as usize]));
        }
        let tx = VersionedTransaction::try_new(VersionedMessage::V0(msg), &signers).unwrap();
        self.last_keys = keys;
        let size = tx_bytes(&tx);
        assert!(size <= PACKET_DATA_SIZE, "v0 transaction is {size} bytes (limit {PACKET_DATA_SIZE})");
        let r = self.svm.send_transaction(tx);
        self.svm.expire_blockhash();
        r
    }

    /// Wire size of a legacy transaction carrying exactly `ixs` (no compute-budget instruction added), paid by the payer.
    pub fn legacy_size(&self, ixs: &[Instruction]) -> usize {
        let msg = Message::new_with_blockhash(ixs, Some(&self.payer.pubkey()), &self.svm.latest_blockhash());
        let n = msg.header.num_required_signatures as usize;
        1 + 64 * n + VersionedMessage::Legacy(msg).serialize().len()
    }

    fn signers<'a>(&'a self, extra: &[&'a Keypair]) -> Vec<&'a Keypair> {
        let mut signers: Vec<&Keypair> = vec![&self.payer];
        for k in extra {
            if !signers.iter().any(|s| s.pubkey() == k.pubkey()) {
                signers.push(k);
            }
        }
        signers
    }

    /// An active address lookup table holding `addresses` (written directly: deactivation_slot = u64::MAX, last extended at slot 0,
    /// no authority — the AddressLookupTable program's account layout).
    pub fn create_lookup_table(&mut self, addresses: &[Pubkey]) -> solana_message::AddressLookupTableAccount {
        let key = Pubkey::new_unique();
        let mut data = vec![0u8; 56];
        data[0..4].copy_from_slice(&1u32.to_le_bytes());
        data[4..12].copy_from_slice(&u64::MAX.to_le_bytes());
        for a in addresses {
            data.extend_from_slice(a.as_ref());
        }
        let lamports = self.svm.minimum_balance_for_rent_exemption(data.len());
        self.svm.set_account(key, litesvm_account(lamports, data, ADDRESS_LOOKUP_TABLE_PROGRAM_ID)).unwrap();
        solana_message::AddressLookupTableAccount { key, addresses: addresses.to_vec() }
    }

    pub fn ok(&mut self, ixs: &[Instruction], extra_signers: &[&Keypair]) -> TransactionMetadata {
        match self.send(ixs, extra_signers) {
            Ok(m) => m,
            Err(e) => panic!("transaction failed: {:?}\n{}", e.err, e.meta.logs.join("\n")),
        }
    }

    pub fn lamports(&self, k: &Pubkey) -> u64 {
        self.svm.get_balance(k).unwrap_or(0)
    }

    pub fn token_amount(&self, k: &Pubkey) -> u64 {
        let a = self.svm.get_account(k).expect("token account");
        spl_token::state::Account::unpack(&a.data).unwrap().amount
    }

    pub fn mint_supply(&self, k: &Pubkey) -> u64 {
        let a = self.svm.get_account(k).expect("mint");
        spl_token::state::Mint::unpack(&a.data).unwrap().supply
    }

    pub fn config(&self, k: &Pubkey) -> TokenConfig {
        let a = self.svm.get_account(k).expect("config");
        TokenConfig::try_deserialize(&mut a.data.as_slice()).unwrap()
    }

    pub fn reading(&self, k: &Pubkey) -> Option<Reading> {
        let a = self.svm.get_account(k)?;
        if a.data.is_empty() {
            return None;
        }
        Some(Reading::try_deserialize(&mut a.data.as_slice()).unwrap())
    }

    /// Creates a FIXED-SUPPLY SPL mint (the program requires one — review L-3): the whole supply (10^12 tokens) is minted to the
    /// payer's treasury ATA and the mint authority is revoked at once; there is never a freeze authority. `mint_to` then hands out
    /// tokens from the treasury. (`_authority` is kept for call-site compatibility.)
    pub fn create_mint(&mut self, mint: &Keypair, _authority: &Pubkey, decimals: u8) {
        let payer = self.payer.pubkey();
        self.create_mint_with_authority(mint, &payer, decimals);
        let treasury = self.create_ata(&payer, &mint.pubkey());
        let ixs = [
            spl_token::instruction::mint_to(&spl_token::ID, &mint.pubkey(), &treasury, &payer, &[], 1_000_000_000_000 * 10u64.pow(decimals as u32)).unwrap(),
            spl_token::instruction::set_authority(&spl_token::ID, &mint.pubkey(), None, spl_token::instruction::AuthorityType::MintTokens, &payer, &[]).unwrap(),
        ];
        self.ok(&ixs, &[]);
    }

    /// A mint that KEEPS `authority` as mint authority (and optionally a freeze authority) — for the L-3 refusal tests.
    pub fn create_mint_with_authority(&mut self, mint: &Keypair, authority: &Pubkey, decimals: u8) {
        self.create_mint_full(mint, authority, None, decimals);
    }

    pub fn create_mint_full(&mut self, mint: &Keypair, authority: &Pubkey, freeze: Option<&Pubkey>, decimals: u8) {
        let rent = self.svm.minimum_balance_for_rent_exemption(spl_token::state::Mint::LEN);
        let ixs = [
            system_instruction::create_account(&self.payer.pubkey(), &mint.pubkey(), rent, spl_token::state::Mint::LEN as u64, &spl_token::ID),
            spl_token::instruction::initialize_mint2(&spl_token::ID, &mint.pubkey(), authority, freeze, decimals).unwrap(),
        ];
        self.ok(&ixs, &[mint]);
    }

    pub fn create_ata(&mut self, owner: &Pubkey, mint: &Pubkey) -> Pubkey {
        let ix = spl_associated_token_account::instruction::create_associated_token_account_idempotent(&self.payer.pubkey(), owner, mint, &spl_token::ID);
        self.ok(&[ix], &[]);
        get_associated_token_address(owner, mint)
    }

    /// Hands out `amount` tokens from the payer's treasury (see create_mint); supply never changes.
    pub fn mint_to(&mut self, mint: &Pubkey, _authority: &Keypair, to: &Pubkey, amount: u64) {
        let payer = self.payer.pubkey();
        let treasury = get_associated_token_address(&payer, mint);
        let ix = spl_token::instruction::transfer(&spl_token::ID, &treasury, to, &payer, &[], amount).unwrap();
        self.ok(&[ix], &[]);
    }

    /// Wraps `lamports` into `owner`'s WSOL ATA (creating it).
    pub fn wrap_sol(&mut self, owner: &Keypair, lamports: u64) -> Pubkey {
        let ata = self.create_ata(&owner.pubkey(), &NATIVE_MINT);
        let ixs = [system_instruction::transfer(&owner.pubkey(), &ata, lamports), spl_token::instruction::sync_native(&spl_token::ID, &ata).unwrap()];
        self.ok(&ixs, &[owner]);
        ata
    }

    pub fn transfer_sol(&mut self, to: &Pubkey, lamports: u64) {
        let ix = system_instruction::transfer(&self.payer.pubkey(), to, lamports);
        self.ok(&[ix], &[]);
    }

    pub fn fund(&mut self, who: &Pubkey, lamports: u64) {
        self.svm.airdrop(who, lamports).unwrap();
    }
}

pub fn litesvm_account(lamports: u64, data: Vec<u8>, owner: Pubkey) -> solana_account::Account {
    solana_account::Account { lamports, data, owner, executable: false, rent_epoch: 0 }
}

/// The packet limit every transaction must fit (solana-packet PACKET_DATA_SIZE).
pub const PACKET_DATA_SIZE: usize = 1_232;
pub const ADDRESS_LOOKUP_TABLE_PROGRAM_ID: Pubkey = anchor_lang::prelude::pubkey!("AddressLookupTab1e1111111111111111111111111");

/// Wire size of a signed transaction (bincode of the VersionedTransaction: shortvec signatures + message).
pub fn tx_bytes(tx: &VersionedTransaction) -> usize {
    let msg = tx.message.serialize();
    let n = tx.signatures.len();
    let shortvec = if n < 0x80 { 1 } else if n < 0x4000 { 2 } else { 3 };
    shortvec + 64 * n + msg.len()
}

pub fn compute_budget(units: u32) -> Instruction {
    let mut data = vec![2u8];
    data.extend_from_slice(&units.to_le_bytes());
    Instruction { program_id: COMPUTE_BUDGET_ID, accounts: vec![], data }
}

/// Expect a failed transaction whose logs carry the Anchor error name (e.g. "QuorumNotMet").
pub fn expect_anchor_err(r: TxResult, name: &str) {
    match r {
        Ok(m) => panic!("expected error {name}, transaction succeeded:\n{}", m.logs.join("\n")),
        Err(e) => {
            let logs = e.meta.logs.join("\n");
            assert!(logs.contains(&format!("Error Code: {name}")), "expected error {name}, got {:?}\n{logs}", e.err);
        }
    }
}

pub fn expect_fail(r: TxResult) -> String {
    match r {
        Ok(m) => panic!("expected failure, transaction succeeded:\n{}", m.logs.join("\n")),
        Err(e) => format!("{:?}\n{}", e.err, e.meta.logs.join("\n")),
    }
}

// --------------------------------------------------------------------------------------------------------------------------------
// burn_receipts PDAs and instructions
// --------------------------------------------------------------------------------------------------------------------------------

pub fn program_data_address() -> Pubkey {
    Pubkey::find_program_address(&[burn_receipts::ID.as_ref()], &anchor_lang::solana_program::bpf_loader_upgradeable::ID).0
}
pub fn platform_pda() -> Pubkey {
    Pubkey::find_program_address(&[PLATFORM_SEED], &burn_receipts::ID).0
}

pub fn ix_initialize_platform(payer: &Pubkey, upgrade_authority: &Pubkey, authority: &Pubkey, cap: u64, sunset: i64) -> Instruction {
    ix_initialize_platform_with(payer, upgrade_authority, authority, cap, sunset, vec![])
}

pub fn ix_initialize_platform_with(payer: &Pubkey, upgrade_authority: &Pubkey, authority: &Pubkey, cap: u64, sunset: i64, crankers: Vec<Pubkey>) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::InitializePlatform { authority: *authority, burn_pool_cap_lamports: cap, cap_sunset_ts: sunset, crankers }.data(),
        burn_receipts::accounts::InitializePlatform {
            payer: *payer,
            upgrade_authority: *upgrade_authority,
            program_data: program_data_address(),
            platform: platform_pda(),
            system_program: anchor_lang::solana_program::system_program::ID,
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_platform(which: &str, authority: &Pubkey, new_cap: u64) -> Instruction {
    let accounts = burn_receipts::accounts::PlatformAuthorityOnly { authority: *authority, platform: platform_pda(), event_authority: event_authority(), program: burn_receipts::ID }
        .to_account_metas(None);
    let data = match which {
        "propose" => burn_receipts::instruction::ProposeCapRaise { new_cap_lamports: new_cap }.data(),
        "cancel" => burn_receipts::instruction::CancelCapRaise {}.data(),
        "renounce" => burn_receipts::instruction::RenouncePlatformAuthority {}.data(),
        _ => unreachable!(),
    };
    Instruction::new_with_bytes(burn_receipts::ID, &data, accounts)
}

pub fn ix_apply_cap(caller: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::ApplyCapRaise {}.data(),
        burn_receipts::accounts::ApplyCapRaise { caller: *caller, platform: platform_pda(), event_authority: event_authority(), program: burn_receipts::ID }.to_account_metas(None),
    )
}

/// The old 25 SOL default some tests still pass as initialize_platform's cap argument. Since the owner decision of 2026-10-25 the
/// program ignores it (there is no burn-pool cap); it stays in the instruction for a stable interface.
pub const LEGACY_CAP_ARG: u64 = 25_000_000_000;

/// A carry left in a TokenConfig by the program before 2026-10-25 (when the 2 % per-crank bound still carried part of a spend).
/// The current program creates a burn-sized carry only after 30 days of an untradeable pool; tests that exercise the carry paths
/// (crank_carried, the end paths, release_target) start from such a legacy carry, exactly as a mainnet coin upgraded mid-carry would.
pub fn set_legacy_carry(env: &mut Env, mint: &Pubkey, lamports: u64) {
    let key = config_pda(mint);
    let mut cfg = env.config(&key);
    cfg.carried_spend_lamports = lamports;
    let mut acc = env.svm.get_account(&key).unwrap();
    let mut data = Vec::new();
    anchor_lang::AccountSerialize::try_serialize(&cfg, &mut data).unwrap();
    acc.data[..data.len()].copy_from_slice(&data);
    env.svm.set_account(key, acc).unwrap();
}

impl Env {
    /// The platform config (the cap argument is ignored since 2026-10-25), sunset 300 days out, authority = `authority`.
    pub fn init_platform(&mut self, authority: &Pubkey, cap: u64) {
        // `cap` is ignored by the program since 2026-10-25 (kept so callers read as before).
        let (payer, ua) = (self.payer.pubkey(), self.upgrade_authority.insecure_clone());
        let ix = ix_initialize_platform(&payer, &ua.pubkey(), authority, cap, NOW + 300 * 86_400);
        self.ok(&[ix], &[&ua]);
    }
}

pub fn event_authority() -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &burn_receipts::ID).0
}
pub fn config_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[CONFIG_SEED, mint.as_ref()], &burn_receipts::ID).0
}
pub fn fee_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[FEE_SEED, mint.as_ref()], &burn_receipts::ID).0
}
pub fn reading_pda(config: &Pubkey, date: u32) -> Pubkey {
    Pubkey::find_program_address(&[READING_SEED, config.as_ref(), &date.to_le_bytes()], &burn_receipts::ID).0
}

pub fn buyback_rule() -> RuleParams {
    RuleParams {
        mode: MODE_BUYBACK,
        carry_rule: CARRY_CONSECUTIVE,
        pool_policy: POOL_POLICY_CREATOR_IS_FEE_PDA,
        value_decimals: 2,
        unit_value: UNIT,
        max_abs_delta: 2_000_000_000_000 * 100,
        fraction_per_unit_bps: 500,
        slippage_bps: 300,
        max_twap_deviation_bps: 300,
        twap_window_secs: 600,
        floor_lamports: 1_000_000,
        reserve_lamports: 20_000_000,
        tokens_per_unit: 0,
        vault_allocation: 0,
    }
}

pub fn vault_rule() -> RuleParams {
    RuleParams {
        mode: MODE_VAULT,
        carry_rule: CARRY_CONSECUTIVE,
        pool_policy: 0,
        value_decimals: 2,
        unit_value: UNIT,
        max_abs_delta: 2_000_000_000_000 * 100,
        fraction_per_unit_bps: 0,
        slippage_bps: 0,
        max_twap_deviation_bps: 0,
        twap_window_secs: 0,
        floor_lamports: 0,
        reserve_lamports: 0,
        tokens_per_unit: 100_000 * TOKEN,
        vault_allocation: 0,
    }
}

pub fn ed(keys: &[Pubkey]) -> Vec<AttesterEntry> {
    keys.iter().map(|k| AttesterEntry::operator(*k)).collect()
}

/// sha256 of the Treasury query URL the attesters read (the default for tests).
pub fn src_hash() -> [u8; 32] {
    use sha2::Digest;
    sha2::Sha256::digest(b"https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page[size]=1").into()
}

pub fn init_args(rule: RuleParams, attesters: Vec<Pubkey>, quorum: u8) -> burn_receipts::InitializeTokenArgs {
    init_args_entries(rule, ed(&attesters), quorum)
}

pub fn init_args_entries(rule: RuleParams, attesters: Vec<AttesterEntry>, quorum: u8) -> burn_receipts::InitializeTokenArgs {
    burn_receipts::InitializeTokenArgs {
        feed_id: FEED.to_string(),
        memo_prefix: "DEBT".to_string(),
        memo_source: SRC.to_string(),
        rules_sha256: rules_sha256(),
        rule,
        attesters,
        quorum,
        fixed_pool: Pubkey::default(),
        admin: Pubkey::default(),
        pair_void_by: 0,
        end_sink_kind: 0,
        end_sink_mint: None,
        end_sink_min_lamports: 0,
    }
}

/// Pair-forward r3 (RN-2): the voidBy ix_initialize_full fills in for a pairing coin that names none (far in the future, so the
/// voidBy evidence never fires unless a test sets its own).
pub const TEST_PAIR_VOID_BY: u32 = 20301231;
/// 2031-01-01T00:00:00Z — the first second after TEST_PAIR_VOID_BY has ended (UTC).
pub const TEST_PAIR_VOID_BY_ENDED_TS: i64 = 1_924_992_000;

/// initialize_token; a default `args.admin` is filled with the creator (test convenience — the program itself requires an
/// explicit admin, see `ix_initialize_raw` and the AdminRequired test).
pub fn ix_initialize(payer: &Pubkey, creator: &Pubkey, mint: &Pubkey, mut args: burn_receipts::InitializeTokenArgs) -> Instruction {
    if args.admin == Pubkey::default() {
        args.admin = *creator;
    }
    ix_initialize_raw(payer, creator, mint, args)
}

pub fn ix_initialize_raw(payer: &Pubkey, creator: &Pubkey, mint: &Pubkey, args: burn_receipts::InitializeTokenArgs) -> Instruction {
    // Buyback + policy 0 pins the test LaunchLab platform (review-3 M-3); other modes pass none.
    let platform = (args.rule.mode == MODE_BUYBACK && args.rule.pool_policy == POOL_POLICY_CREATOR_IS_FEE_PDA).then_some(TEST_LAUNCHLAB_PLATFORM);
    ix_initialize_with_platform(payer, creator, mint, args, platform)
}

pub fn ix_initialize_with_platform(payer: &Pubkey, creator: &Pubkey, mint: &Pubkey, args: burn_receipts::InitializeTokenArgs, launchlab_platform: Option<Pubkey>) -> Instruction {
    ix_initialize_full(payer, creator, mint, args, launchlab_platform, None, false)
}

/// LAUNCHPAD-PATH §40: initialize_token naming `pair_mint` as the partner; `partner_first` = the partner initialized first (its
/// PairLink and TokenConfig are passed so both become paired here).
pub fn ix_initialize_full(
    payer: &Pubkey,
    creator: &Pubkey,
    mint: &Pubkey,
    args: burn_receipts::InitializeTokenArgs,
    launchlab_platform: Option<Pubkey>,
    pair_mint: Option<Pubkey>,
    partner_first: bool,
) -> Instruction {
    let mut args = args;
    if pair_mint.is_some() && args.pair_void_by == 0 {
        args.pair_void_by = TEST_PAIR_VOID_BY;
    }
    let args_min_end = args.end_sink_min_lamports;
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::InitializeToken { args }.data(),
        burn_receipts::accounts::InitializeToken {
            payer: *payer,
            creator: *creator,
            mint: *mint,
            config: config_pda(mint),
            fee_vault: fee_pda(mint),
            system_program: anchor_lang::solana_program::system_program::ID,
            launchlab_platform,
            pair_mint,
            pair_link: pair_mint.map(|_| pair_link_pda(mint)),
            // pair-forward blind review L-3: the partner's PairLink address always rides with pair_mint.
            partner_link: pair_mint.map(|m| pair_link_pda(&m)),
            partner_config: pair_mint.filter(|_| partner_first).map(|m| config_pda(&m)),
            // LAUNCHPAD-PATH §45: the harness pins an end sink whenever the args carry a minimum (end_sink_min_lamports != 0).
            end_sink: (args_min_end != 0).then(|| end_sink_pda(mint)),
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

/// burn_receipts' PairLink ["pair_link", mint] (LAUNCHPAD-PATH §40).
/// Round 5: the coin's BurnTarget ["burn_target", mint] (forward_to_winner / forward_on_end pass it for the R5-9 liveness check).
pub fn burn_target_pda(mint: &Pubkey) -> Pubkey {
    burn_receipts::state::burn_target_address(mint).0
}

/// Round-5 review R5-8: the coin's CarriedPace ["carried_pace", mint].
pub fn carried_pace_pda(mint: &Pubkey) -> Pubkey {
    burn_receipts::state::carried_pace_address(mint).0
}

/// Round-5 review R5-9 harness: turns `mint` into a target coin whose own pool is NOT verified (burn_target_kind EXTERNAL,
/// pool_verified false: the state pin_burn_target leaves before the coin graduates), with its BurnTarget pinned (`pinned`) or absent.
/// The pinned BurnTarget is written as pin_burn_target writes it (the burn_target suite proves the pin itself against real pools and
/// Pyth); here only its state matters, because liveness reads that state.
pub fn make_target_coin(env: &mut Env, mint: &Pubkey, pinned: bool) {
    use anchor_lang::AccountSerialize;
    let key = config_pda(mint);
    let mut cfg = env.config(&key);
    cfg.pool_verified = false;
    cfg.burn_target_kind = BURN_TARGET_EXTERNAL;
    let mut acc = env.svm.get_account(&key).unwrap();
    let mut data = Vec::new();
    cfg.try_serialize(&mut data).unwrap();
    acc.data[..data.len()].copy_from_slice(&data);
    env.svm.set_account(key, acc).unwrap();
    let bt_key = burn_target_pda(mint);
    if !pinned {
        env.svm.set_account(bt_key, litesvm_account(0, Vec::new(), anchor_lang::solana_program::system_program::ID)).unwrap();
        return;
    }
    let bump = burn_receipts::state::burn_target_address(mint).1;
    let t = burn_receipts::state::BurnTarget {
        version: 1,
        bump,
        mint: *mint,
        target_mint: Pubkey::new_unique(),
        target_decimals: 6,
        pool_kind: TARGET_POOL_CPMM,
        target_feed_id: [0x77; 32],
        pool: Pubkey::new_unique(),
        amm_config: Pubkey::new_unique(),
        wsol_vault: Pubkey::new_unique(),
        target_vault: Pubkey::new_unique(),
        observation: Pubkey::new_unique(),
        wsol_is_token_0: true,
        pinned_at: env.now(),
        total_target_burned: 0,
        total_spent_lamports: 0,
        burns: 0,
        repins: 0,
        pending_pool: Pubkey::default(),
        pending_eta: 0,
        last_sol_publish_time: env.now(),
        last_target_publish_time: env.now(),
        last_burn_at: 0,
        last_unblocked_at: 0,
    };
    let mut d = Vec::new();
    t.try_serialize(&mut d).unwrap();
    d.resize(8 + <burn_receipts::state::BurnTarget as anchor_lang::Space>::INIT_SPACE, 0);
    let lamports = env.svm.minimum_balance_for_rent_exemption(d.len());
    env.svm.set_account(bt_key, litesvm_account(lamports, d, burn_receipts::ID)).unwrap();
}

/// Round-5 review R5-9 harness: marks `mint`'s BurnTarget STALLED (its last target event a 30-day unblock: last_unblocked_at >
/// last_burn_at, the state release_target acts on), as crank_target_burn's unblock leaves it.
pub fn stall_target(env: &mut Env, mint: &Pubkey) {
    let key = burn_target_pda(mint);
    let mut acc = env.svm.get_account(&key).expect("a pinned BurnTarget");
    let now = env.now();
    acc.data[357..365].copy_from_slice(&0i64.to_le_bytes());
    acc.data[365..373].copy_from_slice(&now.to_le_bytes());
    env.svm.set_account(key, acc).unwrap();
}

/// The instruction with one account slot replaced by the program id (Anchor's "None" for an optional account).
pub fn without_account(mut ix: Instruction, key: &Pubkey) -> Instruction {
    let at = ix.accounts.iter().position(|a| a.pubkey == *key).expect("account in the instruction");
    ix.accounts[at] = AccountMeta::new_readonly(burn_receipts::ID, false);
    ix
}

/// The coin's CarriedPace, if a carried piece has run (round-5 review R5-8).
pub fn carried_pace(env: &Env, mint: &Pubkey) -> Option<burn_receipts::state::CarriedPace> {
    use anchor_lang::AccountDeserialize;
    env.svm.get_account(&carried_pace_pda(mint)).filter(|a| !a.data.is_empty()).map(|a| burn_receipts::state::CarriedPace::try_deserialize(&mut a.data.as_slice()).unwrap())
}

pub fn pair_link_pda(mint: &Pubkey) -> Pubkey {
    burn_receipts::state::pair_link_address(mint).0
}

/// burn_receipts' PairResult ["pair_result", mint_lo, mint_hi, record_date].
pub fn pair_result_pda(a: &Pubkey, b: &Pubkey, date: u32) -> Pubkey {
    burn_receipts::state::pair_result_address(a, b, date).0
}

pub fn ix_submit(payer: &Pubkey, mint: &Pubkey, date: u32, value: u64) -> Instruction {
    ix_submit_h(payer, mint, date, value, src_hash(), [0u8; 32])
}

pub fn ix_submit_h(payer: &Pubkey, mint: &Pubkey, date: u32, value: u64, source_url_hash: [u8; 32], proof_hash: [u8; 32]) -> Instruction {
    let config = config_pda(mint);
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::SubmitReading { record_date: date, value, source_url_hash, proof_hash }.data(),
        burn_receipts::accounts::SubmitReading {
            payer: *payer,
            config,
            reading: reading_pda(&config, date),
            instructions: solana_instructions_sysvar::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_crank_vault(cranker: &Pubkey, mint: &Pubkey, date: u32) -> Instruction {
    let config = config_pda(mint);
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::CrankVault { record_date: date }.data(),
        burn_receipts::accounts::CrankVault {
            cranker: *cranker,
            config,
            reading: reading_pda(&config, date),
            mint: *mint,
            vault: get_associated_token_address(&config, mint),
            token_program: spl_token::ID,
            memo_program: MEMO_PROGRAM_ID,
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_crank_no_units(cranker: &Pubkey, mint: &Pubkey, date: u32) -> Instruction {
    let config = config_pda(mint);
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::CrankNoUnits { record_date: date }.data(),
        burn_receipts::accounts::CrankNoUnits { cranker: *cranker, config, reading: reading_pda(&config, date), event_authority: event_authority(), program: burn_receipts::ID }
            .to_account_metas(None),
    )
}

/// register_pool for policy 0: the LaunchLab pool PDA and the test LaunchLab platform are passed (see cpmm::launchlab_migrated).
pub fn ix_register_pool(registrar: &Pubkey, mint: &Pubkey, pool: &Pubkey) -> Instruction {
    ix_register_pool_with(registrar, mint, pool, Some((launchlab_pool_pda(mint), TEST_LAUNCHLAB_PLATFORM)))
}

pub fn ix_register_pool_with(registrar: &Pubkey, mint: &Pubkey, pool: &Pubkey, launchlab: Option<(Pubkey, Pubkey)>) -> Instruction {
    ix_register_pool_full(registrar, mint, pool, &cpmm::lp_mint_of(pool), launchlab)
}

/// register_pool with an explicit LP mint (for copied/forged pool accounts whose LP mint is not their own PDA).
pub fn ix_register_pool_full(registrar: &Pubkey, mint: &Pubkey, pool: &Pubkey, lp_mint: &Pubkey, launchlab: Option<(Pubkey, Pubkey)>) -> Instruction {
    let lp_mint = *lp_mint;
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::RegisterPool {}.data(),
        burn_receipts::accounts::RegisterPool {
            registrar: *registrar,
            config: config_pda(mint),
            fee_vault: fee_pda(mint),
            mint: *mint,
            pool_state: *pool,
            lp_mint,
            lp_lock_vault: get_associated_token_address(&LOCK_CPMM_AUTHORITY, &lp_mint),
            launchlab_pool: launchlab.map(|l| l.0),
            // RL-3: policy 0 passes the mint's FeeKeyRecord (register_fee_key first; cpmm::launchlab_migrated writes a stand-in).
            fee_key: launchlab.map(|_| fee_key_record_pda(mint)),
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

/// burn_receipts' FeeKeyRecord ["fee_key", mint].
pub fn fee_key_record_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[FEE_KEY_SEED, mint.as_ref()], &burn_receipts::ID).0
}

/// The test LaunchLab platform account (stand-in for the Receipts platform's PlatformConfig; LaunchLab owner, SDK layout).
pub const TEST_LAUNCHLAB_PLATFORM: Pubkey = Pubkey::new_from_array([0x5a; 32]);

pub fn launchlab_pool_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[LAUNCHLAB_POOL_SEED, mint.as_ref(), NATIVE_MINT.as_ref()], &LAUNCHLAB_PROGRAM_ID).0
}

pub fn ix_admin(which: &str, admin: &Pubkey, mint: &Pubkey, attesters: Vec<AttesterEntry>, quorum: u8) -> Instruction {
    let accounts = burn_receipts::accounts::AdminOnly { admin: *admin, config: config_pda(mint), event_authority: event_authority(), program: burn_receipts::ID }
        .to_account_metas(None);
    let data = match which {
        "propose" => burn_receipts::instruction::ProposeAttesters { attesters, quorum }.data(),
        "cancel" => burn_receipts::instruction::CancelAttesterChange {}.data(),
        "renounce" => burn_receipts::instruction::RenounceAdmin {}.data(),
        _ => unreachable!(),
    };
    Instruction::new_with_bytes(burn_receipts::ID, &data, accounts)
}

pub fn ix_apply(caller: &Pubkey, mint: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::ApplyAttesterChange {}.data(),
        burn_receipts::accounts::ApplyAttesterChange { caller: *caller, config: config_pda(mint), event_authority: event_authority(), program: burn_receipts::ID }
            .to_account_metas(None),
    )
}

/// The canonical attestation message (v2: program id ‖ mint ‖ feed ‖ prev date ‖ date ‖ value ‖ src ‖ proof), default source hash,
/// no proof. `prev` = the previous reading's date (0 = none, the baseline).
pub fn message(mint: &Pubkey, prev: u32, date: u32, value: u64) -> Vec<u8> {
    message_h(mint, prev, date, value, &src_hash(), &[0u8; 32])
}

pub fn message_h(mint: &Pubkey, prev: u32, date: u32, value: u64, src: &[u8; 32], proof: &[u8; 32]) -> Vec<u8> {
    burn_receipts::attest::canonical_message(&burn_receipts::ID, mint, FEED, prev, date, value, 2, src, proof).into_bytes()
}

/// The previous reading's date as the program will sign-check it (0 before the baseline).
pub fn prev_of(env: &Env, mint: &Pubkey) -> u32 {
    match env.svm.get_account(&config_pda(mint)) {
        Some(a) if !a.data.is_empty() => {
            let c = TokenConfig::try_deserialize(&mut a.data.as_slice()).unwrap();
            if c.has_baseline { c.last_record_date } else { 0 }
        }
        _ => 0,
    }
}

/// One Ed25519SigVerify instruction carrying several (pubkey, signature, message) entries, each with ITS OWN copy of its message,
/// all offsets pointing into itself (instruction index u16::MAX) — the web3.js layout; used by tests that sign different messages.
pub fn ed25519_ix(entries: &[(Pubkey, [u8; 64], Vec<u8>)]) -> Instruction {
    let n = entries.len();
    let header = 2 + n * 14;
    let mut data = vec![0u8; header];
    data[0] = n as u8;
    for (i, (pk, sig, msg)) in entries.iter().enumerate() {
        let pk_off = data.len();
        data.extend_from_slice(pk.as_ref());
        let sig_off = data.len();
        data.extend_from_slice(sig);
        let msg_off = data.len();
        data.extend_from_slice(msg);
        let o = 2 + i * 14;
        let w = |d: &mut Vec<u8>, at: usize, v: u16| d[at..at + 2].copy_from_slice(&v.to_le_bytes());
        w(&mut data, o, sig_off as u16);
        w(&mut data, o + 2, u16::MAX);
        w(&mut data, o + 4, pk_off as u16);
        w(&mut data, o + 6, u16::MAX);
        w(&mut data, o + 8, msg_off as u16);
        w(&mut data, o + 10, msg.len() as u16);
        w(&mut data, o + 12, u16::MAX);
    }
    Instruction { program_id: ED25519_PROGRAM_ID, accounts: vec![], data }
}

pub fn sign(k: &Keypair, msg: &[u8]) -> [u8; 64] {
    let s = k.sign_message(msg);
    let mut out = [0u8; 64];
    out.copy_from_slice(s.as_ref());
    out
}

/// Review-2 F4: the shared-message layout — ONE copy of the message, N (pubkey, signature) entries whose message offsets all point
/// at it (every offset inside this instruction, instruction index u16::MAX), as src/lib/burnReceipts/attestation.ts builds it.
pub fn ed25519_shared(entries: &[(Pubkey, [u8; 64])], msg: &[u8]) -> Instruction {
    let n = entries.len();
    let header = 2 + n * 14;
    let mut data = vec![0u8; header];
    data[0] = n as u8;
    let msg_off = header + n * 96;
    for (i, (pk, sig)) in entries.iter().enumerate() {
        let pk_off = data.len();
        data.extend_from_slice(pk.as_ref());
        let sig_off = data.len();
        data.extend_from_slice(sig);
        let o = 2 + i * 14;
        for (at, v) in [(o, sig_off as u16), (o + 2, u16::MAX), (o + 4, pk_off as u16), (o + 6, u16::MAX), (o + 8, msg_off as u16), (o + 10, msg.len() as u16), (o + 12, u16::MAX)] {
            data[at..at + 2].copy_from_slice(&v.to_le_bytes());
        }
    }
    data.extend_from_slice(msg);
    Instruction { program_id: ED25519_PROGRAM_ID, accounts: vec![], data }
}

/// Submit an attested reading signed by `signers` (shared-message layout, legacy transaction — size-asserted by `Env::send`).
pub fn submit(env: &mut Env, mint: &Pubkey, date: u32, value: u64, signers: &[&Keypair]) -> TxResult {
    let msg = message(mint, prev_of(env, mint), date, value);
    let entries: Vec<_> = signers.iter().map(|k| (k.pubkey(), sign(k, &msg))).collect();
    let payer = env.payer.pubkey();
    env.send(&[ed25519_shared(&entries, &msg), ix_submit(&payer, mint, date, value)], &[])
}

pub fn account_meta_ro(k: Pubkey) -> AccountMeta {
    AccountMeta::new_readonly(k, false)
}

/// (event discriminator, payload) of every event the program emitted through emit_cpi! in this transaction, in order.
pub fn events(meta: &TransactionMetadata) -> Vec<([u8; 8], Vec<u8>)> {
    let mut out = Vec::new();
    for list in &meta.inner_instructions {
        for ii in list {
            let d = &ii.instruction.data;
            if d.len() >= 16 && &d[..8] == anchor_lang::event::EVENT_IX_TAG_LE {
                let mut disc = [0u8; 8];
                disc.copy_from_slice(&d[8..16]);
                out.push((disc, d[16..].to_vec()));
            }
        }
    }
    out
}

pub fn event_names(meta: &TransactionMetadata) -> Vec<&'static str> {
    use anchor_lang::Discriminator;
    use burn_receipts::events::*;
    let table: [(&[u8], &'static str); 27] = [
        (CrankerAllowlistCleared::DISCRIMINATOR, "CrankerAllowlistCleared"),
        (RegistrationPolicyProposed::DISCRIMINATOR, "RegistrationPolicyProposed"),
        (RegistrationPolicyCancelled::DISCRIMINATOR, "RegistrationPolicyCancelled"),
        (RegistrationPolicyApplied::DISCRIMINATOR, "RegistrationPolicyApplied"),
        (SpendCarried::DISCRIMINATOR, "SpendCarried"),
        (BuybackQueueUnblocked::DISCRIMINATOR, "BuybackQueueUnblocked"),
        (ReadingReset::DISCRIMINATOR, "ReadingReset"),
        (SpendCapBound::DISCRIMINATOR, "SpendCapBound"),
        (LaunchLabCreatorFeeClaimed::DISCRIMINATOR, "LaunchLabCreatorFeeClaimed"),
        (PoolUntradeableFlagged::DISCRIMINATOR, "PoolUntradeableFlagged"),
        (PoolUntradeableCleared::DISCRIMINATOR, "PoolUntradeableCleared"),
        (PoolReplaced::DISCRIMINATOR, "PoolReplaced"),
        (PlatformInitialized::DISCRIMINATOR, "PlatformInitialized"),
        (CapRaiseProposed::DISCRIMINATOR, "CapRaiseProposed"),
        (CapRaiseCancelled::DISCRIMINATOR, "CapRaiseCancelled"),
        (CapRaised::DISCRIMINATOR, "CapRaised"),
        (PlatformAuthorityRenounced::DISCRIMINATOR, "PlatformAuthorityRenounced"),
        (BurnPoolCapBound::DISCRIMINATOR, "BurnPoolCapBound"),
        (TokenInitialized::DISCRIMINATOR, "TokenInitialized"),
        (PoolRegistered::DISCRIMINATOR, "PoolRegistered"),
        (ReadingSubmitted::DISCRIMINATOR, "ReadingSubmitted"),
        (ReadingProcessed::DISCRIMINATOR, "ReadingProcessed"),
        (AttesterChangeProposed::DISCRIMINATOR, "AttesterChangeProposed"),
        (AttesterChangeCancelled::DISCRIMINATOR, "AttesterChangeCancelled"),
        (AttesterChangeApplied::DISCRIMINATOR, "AttesterChangeApplied"),
        (AdminRenounced::DISCRIMINATOR, "AdminRenounced"),
        (&[0u8; 0], "?"),
    ];
    events(meta).iter().map(|(d, _)| table.iter().find(|(t, _)| *t == &d[..]).map(|(_, n)| *n).unwrap_or("unknown")).collect()
}

pub fn ix_check_pool_health(caller: &Pubkey, mint: &Pubkey, pool: &Pubkey, wsol_vault: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::CheckPoolHealth {}.data(),
        burn_receipts::accounts::CheckPoolHealth {
            caller: *caller,
            config: config_pda(mint),
            pool_state: *pool,
            wsol_vault: *wsol_vault,
            instructions: solana_instructions_sysvar::ID,
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

pub fn ix_replace_pool(caller: &Pubkey, mint: &Pubkey, old_pool: &Pubkey, old_wsol: &Pubkey, new_pool: &Pubkey, new_wsol: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::ReplacePool {}.data(),
        burn_receipts::accounts::ReplacePool {
            caller: *caller,
            config: config_pda(mint),
            fee_vault: fee_pda(mint),
            mint: *mint,
            old_pool: *old_pool,
            old_wsol_vault: *old_wsol,
            new_pool: *new_pool,
            new_wsol_vault: *new_wsol,
            new_lp_mint: cpmm::lp_mint_of(new_pool),
            new_lp_lock_vault: get_associated_token_address(&LOCK_CPMM_AUTHORITY, &cpmm::lp_mint_of(new_pool)),
            launchlab_pool: launchlab_pool_pda(mint),
            launchlab_platform: TEST_LAUNCHLAB_PLATFORM,
            instructions: solana_instructions_sysvar::ID,
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

pub fn launchlab_creator_vault(fee: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[fee.as_ref(), NATIVE_MINT.as_ref()], &LAUNCHLAB_PROGRAM_ID).0
}
pub fn launchlab_auth() -> Pubkey {
    Pubkey::find_program_address(&[LAUNCHLAB_CREATOR_FEE_VAULT_AUTH_SEED], &LAUNCHLAB_PROGRAM_ID).0
}

pub fn ix_claim_launchlab(caller: &Pubkey, mint: &Pubkey) -> Instruction {
    let fee = fee_pda(mint);
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::ClaimLaunchlabCreatorFee {}.data(),
        burn_receipts::accounts::ClaimLaunchlabCreatorFee {
            payer: *caller,
            config: config_pda(mint),
            fee_vault: fee,
            fee_wsol: get_associated_token_address(&fee, &NATIVE_MINT),
            wsol_mint: NATIVE_MINT,
            fee_tokens: get_associated_token_address(&fee, mint),
            launchlab_vault_authority: launchlab_auth(),
            launchlab_creator_fee_vault: launchlab_creator_vault(&fee),
            launchlab_program: LAUNCHLAB_PROGRAM_ID,
            token_program: spl_token::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
            associated_token_program: anchor_spl::associated_token::ID,
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

// ---------------------------------------------------------------------------------------------------------------------------------
// LAUNCHPAD-PATH §40 — pairs (winner takes the burn)
// ---------------------------------------------------------------------------------------------------------------------------------

/// The pair-result message (attest.rs canonical_pair_message) for (a, b) in any order.
pub fn pair_message(a: &Pubkey, b: &Pubkey, date: u32, winner: &Pubkey, src: [u8; 32], proof: [u8; 32]) -> Vec<u8> {
    let (lo, hi) = burn_receipts::state::pair_order(a, b);
    burn_receipts::attest::canonical_pair_message(&burn_receipts::ID, &lo, &hi, date, winner, &src, &proof).into_bytes()
}

pub fn ix_submit_pair_result(payer: &Pubkey, a: &Pubkey, b: &Pubkey, date: u32, winner: Pubkey, src: [u8; 32], proof: [u8; 32]) -> Instruction {
    let (lo, hi) = burn_receipts::state::pair_order(a, b);
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::SubmitPairResult { record_date: date, winner, source_url_hash: src, proof_hash: proof }.data(),
        burn_receipts::accounts::SubmitPairResult {
            payer: *payer,
            config_lo: config_pda(&lo),
            config_hi: config_pda(&hi),
            link_lo: pair_link_pda(&lo),
            link_hi: pair_link_pda(&hi),
            pair_result: pair_result_pda(&lo, &hi, date),
            instructions: solana_instructions_sysvar::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
            // r2 H-1(a): a win carries both coins' readings for the date; a draw may omit them.
            reading_lo: (winner != Pubkey::default()).then(|| reading_pda(&config_pda(&lo), date)),
            reading_hi: (winner != Pubkey::default()).then(|| reading_pda(&config_pda(&hi), date)),
        }
        .to_account_metas(None),
    )
}

/// submit_pair_result signed by `signers` (one shared message; each key counts for whichever coin's set holds it).
pub fn submit_pair_result(env: &mut Env, a: &Pubkey, b: &Pubkey, date: u32, winner: Pubkey, signers: &[&Keypair]) -> TxResult {
    let msg = pair_message(a, b, date, &winner, src_hash(), [0u8; 32]);
    let entries: Vec<_> = signers.iter().map(|k| (k.pubkey(), sign(k, &msg))).collect();
    let payer = env.payer.pubkey();
    env.send(&[ed25519_shared(&entries, &msg), ix_submit_pair_result(&payer, a, b, date, winner, src_hash(), [0u8; 32])], &[])
}

pub fn ix_forward_to_winner(cranker: &Pubkey, loser: &Pubkey, winner: &Pubkey, date: u32) -> Instruction {
    let (lf, wf) = (fee_pda(loser), fee_pda(winner));
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::ForwardToWinner { record_date: date }.data(),
        burn_receipts::accounts::ForwardToWinner {
            cranker: *cranker,
            platform: platform_pda(),
            loser_config: config_pda(loser),
            loser_fee_vault: lf,
            loser_fee_wsol: get_associated_token_address(&lf, &NATIVE_MINT),
            loser_reading: reading_pda(&config_pda(loser), date),
            winner_config: config_pda(winner),
            winner_fee_vault: wf,
            winner_fee_wsol: get_associated_token_address(&wf, &NATIVE_MINT),
            pair_result: pair_result_pda(loser, winner, date),
            token_program: anchor_spl::token::spl_token::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
            memo_program: MEMO_PROGRAM_ID,
            loser_burn_target: Some(burn_target_pda(loser)),
            winner_burn_target: Some(burn_target_pda(winner)),
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

pub fn pair_link(env: &Env, mint: &Pubkey) -> Option<burn_receipts::state::PairLink> {
    use anchor_lang::AccountDeserialize;
    env.svm.get_account(&pair_link_pda(mint)).filter(|a| !a.data.is_empty()).map(|a| burn_receipts::state::PairLink::try_deserialize(&mut a.data.as_slice()).unwrap())
}

pub fn pair_result(env: &Env, a: &Pubkey, b: &Pubkey, date: u32) -> Option<burn_receipts::state::PairResult> {
    use anchor_lang::AccountDeserialize;
    env.svm.get_account(&pair_result_pda(a, b, date)).filter(|x| !x.data.is_empty()).map(|x| burn_receipts::state::PairResult::try_deserialize(&mut x.data.as_slice()).unwrap())
}

/// unlink_pair (pair-forward blind review M-2); `pair` = the pair_curve Pair as evidence (Voided / a side refunding), or None.
pub fn ix_unlink_pair(cranker: &Pubkey, a: &Pubkey, b: &Pubkey, pair: Option<Pubkey>) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::UnlinkPair {}.data(),
        burn_receipts::accounts::UnlinkPair {
            cranker: *cranker,
            config_a: config_pda(a),
            config_b: config_pda(b),
            link_a: pair_link_pda(a),
            link_b: pair_link_pda(b),
            fee_a: fee_pda(a),
            fee_b: fee_pda(b),
            pair,
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

/// apply_paired_attester_change (pair-forward r3 M-1) for `mint`, whose partner is `partner`.
pub fn ix_apply_paired_attester_change(caller: &Pubkey, mint: &Pubkey, partner: &Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::ApplyPairedAttesterChange {}.data(),
        burn_receipts::accounts::ApplyPairedAttesterChange {
            caller: *caller,
            config: config_pda(mint),
            link: pair_link_pda(mint),
            partner_config: config_pda(partner),
            partner_link: pair_link_pda(partner),
            instructions: solana_instructions_sysvar::ID,
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

/// The message the partner's quorum signs for `mint`'s pending attester change (attest::canonical_pair_attester_change_message).
pub fn pair_attester_change_message(env: &Env, mint: &Pubkey, partner: &Pubkey) -> Vec<u8> {
    let c = env.config(&config_pda(mint));
    let h = burn_receipts::instructions::pair::set_hash(c.pending_quorum, &c.pending_attesters[..c.pending_count as usize]);
    burn_receipts::attest::canonical_pair_attester_change_message(&burn_receipts::ID, mint, partner, &h, c.pending_eta).into_bytes()
}

/// submit_pair_result in a v0 transaction through a lookup table holding its accounts — what a result signed by two different keys
/// needs once the readings ride along (a legacy transaction is ~1,274 bytes then).
pub fn submit_pair_result_v0(env: &mut Env, a: &Pubkey, b: &Pubkey, date: u32, winner: Pubkey, signers: &[&Keypair]) -> TxResult {
    let msg = pair_message(a, b, date, &winner, src_hash(), [0u8; 32]);
    let entries: Vec<_> = signers.iter().map(|k| (k.pubkey(), sign(k, &msg))).collect();
    let payer = env.payer.pubkey();
    let ix = ix_submit_pair_result(&payer, a, b, date, winner, src_hash(), [0u8; 32]);
    let addrs: Vec<Pubkey> = ix.accounts.iter().filter(|m| !m.is_signer && m.pubkey != burn_receipts::ID).map(|m| m.pubkey).collect();
    let table = env.create_lookup_table(&addrs);
    env.send_v0(&[ed25519_shared(&entries, &msg), ix], &[], &[table])
}

// ---------------------------------------------------------------------------------------------------------------------------------
// LAUNCHPAD-PATH §45 — end sinks
// ---------------------------------------------------------------------------------------------------------------------------------

/// The harness flagship's mint keypair: its public key is the test-pins build's BURNTICKER_FLAGSHIP.
pub fn flagship_keypair() -> Keypair {
    Keypair::new_from_array([0x46; 32])
}

pub fn end_sink_pda(mint: &Pubkey) -> Pubkey {
    burn_receipts::state::end_sink_address(mint).0
}

pub fn rule_end_pda(mint: &Pubkey) -> Pubkey {
    burn_receipts::state::rule_end_address(mint).0
}

pub fn end_message(mint: &Pubkey, date: u32, outcome: u8, src: [u8; 32], proof: [u8; 32]) -> Vec<u8> {
    burn_receipts::attest::canonical_end_message(&burn_receipts::ID, mint, date, outcome, &src, &proof).into_bytes()
}

pub fn ix_submit_rule_end(payer: &Pubkey, mint: &Pubkey, date: u32, outcome: u8, src: [u8; 32], proof: [u8; 32]) -> Instruction {
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::SubmitRuleEnd { record_date: date, outcome, source_url_hash: src, proof_hash: proof }.data(),
        burn_receipts::accounts::SubmitRuleEnd {
            payer: *payer,
            config: config_pda(mint),
            end_sink: end_sink_pda(mint),
            rule_end: rule_end_pda(mint),
            instructions: solana_instructions_sysvar::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

/// submit_rule_end signed by `signers`.
pub fn submit_rule_end(env: &mut Env, mint: &Pubkey, date: u32, outcome: u8, signers: &[&Keypair]) -> TxResult {
    let msg = end_message(mint, date, outcome, src_hash(), [0u8; 32]);
    let entries: Vec<_> = signers.iter().map(|k| (k.pubkey(), sign(k, &msg))).collect();
    let payer = env.payer.pubkey();
    env.send(&[ed25519_shared(&entries, &msg), ix_submit_rule_end(&payer, mint, date, outcome, src_hash(), [0u8; 32])], &[])
}

/// forward_on_end for `mint` → `target`. `sink` = the EndSink's named coin (MINT / PAIR_WINNER); `pair` = (partner, end date) for
/// PAIR_WINNER (this coin's PairLink and that date's PairResult are passed).
pub fn ix_forward_on_end(cranker: &Pubkey, mint: &Pubkey, target: &Pubkey, sink: Option<Pubkey>, pair: Option<(Pubkey, u32)>) -> Instruction {
    let (f, tf) = (fee_pda(mint), fee_pda(target));
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::ForwardOnEnd {}.data(),
        burn_receipts::accounts::ForwardOnEnd {
            cranker: *cranker,
            platform: platform_pda(),
            config: config_pda(mint),
            fee_vault: f,
            fee_wsol: get_associated_token_address(&f, &NATIVE_MINT),
            end_sink: end_sink_pda(mint),
            rule_end: rule_end_pda(mint),
            target_config: config_pda(target),
            target_fee_vault: tf,
            target_fee_wsol: get_associated_token_address(&tf, &NATIVE_MINT),
            token_program: anchor_spl::token::spl_token::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
            memo_program: MEMO_PROGRAM_ID,
            sink_config: sink.map(|s| config_pda(&s)),
            pair_link: pair.map(|_| pair_link_pda(mint)),
            pair_result: pair.map(|(p, d)| pair_result_pda(mint, &p, d)),
            sink_burn_target: sink.map(|s| burn_target_pda(&s)),
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

pub fn end_sink(env: &Env, mint: &Pubkey) -> Option<burn_receipts::state::EndSink> {
    use anchor_lang::AccountDeserialize;
    env.svm.get_account(&end_sink_pda(mint)).filter(|a| !a.data.is_empty()).map(|a| burn_receipts::state::EndSink::try_deserialize(&mut a.data.as_slice()).unwrap())
}

pub fn rule_end(env: &Env, mint: &Pubkey) -> Option<burn_receipts::state::RuleEnd> {
    use anchor_lang::AccountDeserialize;
    env.svm.get_account(&rule_end_pda(mint)).filter(|a| !a.data.is_empty()).map(|a| burn_receipts::state::RuleEnd::try_deserialize(&mut a.data.as_slice()).unwrap())
}

/// burn_sol_on_end (the incinerator end sink). `incinerator` is normally INCINERATOR_ID; a test passes another key to see it refused.
pub fn ix_burn_sol_on_end(cranker: &Pubkey, mint: &Pubkey, incinerator: &Pubkey) -> Instruction {
    let f = fee_pda(mint);
    Instruction::new_with_bytes(
        burn_receipts::ID,
        &burn_receipts::instruction::BurnSolOnEnd {}.data(),
        burn_receipts::accounts::BurnSolOnEnd {
            cranker: *cranker,
            platform: platform_pda(),
            config: config_pda(mint),
            fee_vault: f,
            fee_wsol: get_associated_token_address(&f, &NATIVE_MINT),
            wsol_mint: NATIVE_MINT,
            end_sink: end_sink_pda(mint),
            rule_end: rule_end_pda(mint),
            incinerator: *incinerator,
            token_program: spl_token::ID,
            associated_token_program: anchor_spl::associated_token::ID,
            system_program: anchor_lang::solana_program::system_program::ID,
            memo_program: MEMO_PROGRAM_ID,
            event_authority: event_authority(),
            program: burn_receipts::ID,
        }
        .to_account_metas(None),
    )
}

/// initialize_token_r5: the same accounts and arguments as ix_initialize_full, under the round-5 create's discriminator.
#[allow(clippy::too_many_arguments)]
pub fn ix_initialize_r5(payer: &Pubkey, creator: &Pubkey, mint: &Pubkey, args: burn_receipts::InitializeTokenArgs, launchlab_platform: Option<Pubkey>, pair_mint: Option<Pubkey>, partner_first: bool) -> Instruction {
    use anchor_lang::Discriminator;
    let mut ix = ix_initialize_full(payer, creator, mint, args, launchlab_platform, pair_mint, partner_first);
    ix.data[..8].copy_from_slice(burn_receipts::instruction::InitializeTokenR5::DISCRIMINATOR);
    ix
}
