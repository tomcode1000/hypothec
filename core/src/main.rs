//! `hypothec-party`: one party (borrower, lender or referee) of a Hypothec loan vault.
//!
//! Each party runs its own copy. It holds only that party's FROST key share and exposes the
//! vault steps over HTTP (JSON) for the apps and the referee: identity, vault create / join /
//! seal, key generation (DKG), balance through the vault's viewing key, and a spend with any
//! number of outputs that the members verify, approve (signing as they approve) and send.
//!
//! The vault protocol is zafe-core's (MIT OR Apache-2.0, Anmol Bansal and Zafe contributors);
//! the handlers follow zafe-cli. State lives in `--home` as plain files: development only.
//! In production the key share belongs in secure storage (an HSM for the lender).

use std::{fs, net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};

use anyhow::{anyhow, Context, Result};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use clap::Parser;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Mutex;
use zafe_core::{
    node::{self, Invite, VaultMaterial},
    nonce_store::{FileNonceStore, FilePoolStore},
    relay_client::RelayClient,
    session::ProposalId,
    state_dir,
    wallet::{connect, latest_height, PaymentRequest, VaultWallet, WalletKey, ZafeNetwork},
};
use zafe_proto::{Identity, IdentitySeeds};
use zcash_protocol::memo::Memo;

// Files in a party's home (dev-only plain files), as in zafe-cli.
const IDENTITY_FILE: &str = "identity.bin";
const INVITE_FILE: &str = "invite.txt";
const VAULT_FILE: &str = "vault.bin";
const WALLET_DB_FILE: &str = "wallet.sqlite";
const WALLET_KEY_FILE: &str = "wallet.key";
const LOG_DIR: &str = "log";

#[derive(Parser)]
#[command(name = "hypothec-party", about = "One party of a Hypothec loan vault (development only)")]
struct Cli {
    /// Directory holding this party's state.
    #[arg(long, env = "HYPOTHEC_HOME")]
    home: PathBuf,
    /// Address to listen on. Keep it on localhost: the API has no authentication yet.
    #[arg(long, env = "HYPOTHEC_LISTEN", default_value = "127.0.0.1:7801")]
    listen: SocketAddr,
    #[arg(long, env = "ZAFE_RELAY", default_value = "http://127.0.0.1:8787")]
    relay: String,
    #[arg(long, env = "ZAFE_LIGHTWALLETD", default_value = "http://127.0.0.1:9067")]
    lightwalletd: String,
    /// Zcash network: regtest (default), test or main.
    #[arg(long, env = "ZAFE_NETWORK", default_value = "regtest")]
    network: String,
}

struct Party {
    home: PathBuf,
    relay: RelayClient,
    lightwalletd: String,
    network: ZafeNetwork,
}

/// One request at a time: the wallet database, nonce store and files are not shared safely.
type AppState = Arc<Mutex<Party>>;

impl Party {
    fn path(&self, name: &str) -> PathBuf {
        self.home.join(name)
    }

    fn identity(&self) -> Result<Identity> {
        let bytes = fs::read(self.path(IDENTITY_FILE)).context("no identity; POST /identity")?;
        Ok(Identity::from_seeds(IdentitySeeds::from_bytes(&bytes)?))
    }

    fn invite(&self) -> Result<Invite> {
        let s = fs::read_to_string(self.path(INVITE_FILE))
            .context("no invite; create or join a vault")?;
        Ok(Invite::decode(&s)?)
    }

    fn material(&self) -> Result<VaultMaterial> {
        let bytes = fs::read(self.path(VAULT_FILE))
            .context("vault not created yet; POST /vault/keygen")?;
        Ok(VaultMaterial::from_bytes(&bytes)?)
    }

    async fn wallet(&self, material: &VaultMaterial) -> Result<VaultWallet<ZafeNetwork>> {
        let mut client = connect(&self.lightwalletd).await?;
        let path = self.path(WALLET_DB_FILE);
        let ufvk = material.vault_keys()?.ufvk()?;
        // Dev-only: the wallet key sits in a plain file next to the database.
        let key_path = self.path(WALLET_KEY_FILE);
        let key = match fs::read(&key_path) {
            Ok(bytes) => WalletKey::from_slice(&bytes)?,
            Err(_) => {
                let key = WalletKey::random();
                fs::write(&key_path, key.as_bytes())?;
                key
            }
        };
        let mut wallet = if VaultWallet::exists(&path, &key, self.network.clone()) {
            VaultWallet::open(&path, &key, self.network.clone())?
        } else {
            // The wallet is a cache of chain data: start over from the vault's birthday.
            let _ = fs::remove_file(&path);
            VaultWallet::create(
                &path,
                &key,
                self.network.clone(),
                &material.descriptor.name,
                &ufvk,
                material.descriptor.birthday_height,
                &mut client,
            )
            .await?
        };
        wallet.sync(&mut client).await?;
        Ok(wallet)
    }

    async fn tip(&self, material: &VaultMaterial) -> Result<u32> {
        self.wallet(material)
            .await?
            .chain_height()?
            .ok_or_else(|| anyhow!("wallet not synced"))
    }
}

/// Errors go back as `{"error": "..."}` with status 400.
struct ApiError(anyhow::Error);

impl<E: Into<anyhow::Error>> From<E> for ApiError {
    fn from(e: E) -> Self {
        Self(e.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (StatusCode::BAD_REQUEST, Json(json!({ "error": format!("{:#}", self.0) }))).into_response()
    }
}

type ApiResult = std::result::Result<Json<Value>, ApiError>;

fn parse_proposal(s: &str) -> Result<ProposalId> {
    hex::decode(s)?
        .try_into()
        .map_err(|_| anyhow!("spend id must be 16 bytes hex"))
}

fn hex_txid(txid: &[u8; 32]) -> String {
    let mut display = *txid;
    display.reverse(); // txids display in reversed byte order
    hex::encode(display)
}

async fn create_identity(State(state): State<AppState>) -> ApiResult {
    let party = state.lock().await;
    if party.path(IDENTITY_FILE).exists() {
        return Err(anyhow!("identity already exists in {}", party.home.display()).into());
    }
    let id = Identity::generate(&mut OsRng);
    fs::write(party.path(IDENTITY_FILE), id.seeds().to_bytes())?;
    Ok(Json(json!({ "identity": hex::encode(id.public().sig_pk) })))
}

#[derive(Deserialize)]
struct CreateVault {
    name: String,
    threshold: u16,
    members: u16,
}

async fn create_vault(State(state): State<AppState>, Json(req): Json<CreateVault>) -> ApiResult {
    let party = state.lock().await;
    let invite = node::create_vault(
        &party.relay,
        &party.identity()?,
        &req.name,
        req.threshold,
        req.members,
        &mut OsRng,
    )
    .await?;
    fs::write(party.path(INVITE_FILE), invite.encode())?;
    Ok(Json(json!({ "invite": invite.encode() })))
}

#[derive(Deserialize)]
struct JoinVault {
    invite: String,
}

async fn join_vault(State(state): State<AppState>, Json(req): Json<JoinVault>) -> ApiResult {
    let party = state.lock().await;
    let invite = Invite::decode(&req.invite)?;
    node::join_vault(&party.relay, &party.identity()?, &invite).await?;
    fs::write(party.path(INVITE_FILE), invite.encode())?;
    Ok(Json(json!({ "joined": invite.name })))
}

async fn seal(State(state): State<AppState>) -> ApiResult {
    let party = state.lock().await;
    node::seal(&party.relay, &party.identity()?, &party.invite()?).await?;
    Ok(Json(json!({ "sealed": true })))
}

async fn members(State(state): State<AppState>) -> ApiResult {
    let party = state.lock().await;
    let (members, sealed, number) =
        node::membership(&party.relay, &party.identity()?, &party.invite()?).await?;
    Ok(Json(json!({
        "members": members.iter().map(|m| hex::encode(m.sig_pk)).collect::<Vec<_>>(),
        "sealed": sealed,
        "safety_number": number.to_string(),
    })))
}

#[derive(Deserialize)]
struct Keygen {
    /// The safety number this party compared with the others out of band.
    safety_number: String,
    /// Creator only: vault birthday height (default: lightwalletd tip + 1).
    birthday: Option<u32>,
    #[serde(default = "default_keygen_timeout")]
    timeout_secs: u64,
}

fn default_keygen_timeout() -> u64 {
    300
}

/// Runs the DKG with the other parties through the relay. Blocks until every party has
/// joined in, so the three parties call it concurrently.
async fn keygen(State(state): State<AppState>, Json(req): Json<Keygen>) -> ApiResult {
    let party = state.lock().await;
    let invite = party.invite()?;
    let me = party.identity()?;
    let birthday = match (me.public().sig_pk == invite.creator, req.birthday) {
        (true, Some(height)) => Some(height.max(2)),
        (true, None) => {
            Some((latest_height(&mut connect(&party.lightwalletd).await?).await? + 1).max(2))
        }
        (false, _) => None,
    };
    let material = node::run_keygen(
        &party.relay,
        &me,
        &invite,
        &req.safety_number,
        &party.network,
        party.network.name(),
        birthday,
        None,
        &mut OsRng,
        Duration::from_secs(req.timeout_secs),
    )
    .await?;
    fs::write(party.path(VAULT_FILE), material.to_bytes()?)?;
    // Publish the commitment pool while every party is present, so approving a spend
    // also signs it (no extra signing round).
    let mut pool = FilePoolStore::new(party.path(state_dir::POOL));
    // Not a restore from backup, so no pool reset (zafe node::top_up_pool).
    let commitments = node::top_up_pool(&party.relay, &me, &material, &mut pool, false, &mut OsRng).await?;
    Ok(Json(json!({
        "address": material.descriptor.address,
        "commitments": commitments,
    })))
}

async fn vault(State(state): State<AppState>) -> ApiResult {
    let party = state.lock().await;
    let m = party.material()?;
    Ok(Json(json!({
        "name": m.descriptor.name,
        "threshold": m.descriptor.threshold,
        "members": m.descriptor.members.len(),
        "address": m.descriptor.address,
        // Unified full viewing key: shows the vault's balance and history, cannot spend.
        "ufvk": m.descriptor.ufvk,
        "birthday": m.descriptor.birthday_height,
    })))
}

async fn balance(State(state): State<AppState>) -> ApiResult {
    let party = state.lock().await;
    let material = party.material()?;
    let wallet = party.wallet(&material).await?;
    let b = wallet.balance()?;
    Ok(Json(json!({
        "height": wallet.chain_height()?.unwrap_or(0),
        "spendable_zat": b.ironwood_spendable,
        "ironwood_zat": b.ironwood_total,
        "total_zat": b.total,
    })))
}

#[derive(Deserialize, Serialize)]
struct Output {
    address: String,
    amount_zat: u64,
}

#[derive(Deserialize)]
struct ProposeSpend {
    outputs: Vec<Output>,
    memo: Option<String>,
}

/// Proposes ONE transaction paying every output (e.g. lender share + borrower surplus).
async fn propose(State(state): State<AppState>, Json(req): Json<ProposeSpend>) -> ApiResult {
    if req.outputs.is_empty() {
        return Err(anyhow!("give at least one output").into());
    }
    let party = state.lock().await;
    let material = party.material()?;
    let mut wallet = party.wallet(&material).await?;
    let memo = req
        .memo
        .map(|m| Memo::from_bytes(m.as_bytes()).map(|m| m.encode()))
        .transpose()?;
    let payments: Vec<_> = req
        .outputs
        .into_iter()
        .map(|o| PaymentRequest {
            address: o.address,
            amount_zat: o.amount_zat,
            memo: memo.clone(),
        })
        .collect();
    let id = node::propose(
        &party.relay,
        &party.identity()?,
        &material,
        &mut wallet,
        &mut connect(&party.lightwalletd).await?,
        &node::SentTxs::in_dir(party.path(state_dir::SENT)),
        &payments,
        false,
        &mut OsRng,
    )
    .await?;
    Ok(Json(json!({ "id": hex::encode(id) })))
}

async fn spends(State(state): State<AppState>) -> ApiResult {
    let party = state.lock().await;
    let material = party.material()?;
    let (_, vault) = node::load_state(&party.relay, &party.identity()?, &material).await?;
    let list: Vec<Value> = vault
        .proposals
        .values()
        .map(|p| {
            json!({
                "id": hex::encode(p.id),
                "status": format!("{:?}", p.status),
                "outputs": p.payments.iter().map(|x| json!({
                    "address": x.address,
                    "amount_zat": x.amount_zat,
                })).collect::<Vec<_>>(),
                "approvals": p.approvals.len(),
                "threshold": material.descriptor.threshold,
                "rejections": p.rejections.len(),
                "txid": p.txid.map(|t| hex_txid(&t)),
            })
        })
        .collect();
    Ok(Json(json!({ "spends": list })))
}

/// This party rebuilds and checks the transaction itself (outputs, amounts, memo, change,
/// fee, sighash), then approves and signs its share.
async fn approve(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult {
    let party = state.lock().await;
    let material = party.material()?;
    let tip = party.tip(&material).await?;
    let mut store = FileNonceStore::new(party.path(state_dir::NONCES));
    let mut pool = FilePoolStore::new(party.path(state_dir::POOL));
    let approved = node::approve(
        &party.relay,
        &party.identity()?,
        &material,
        &party.network,
        tip,
        parse_proposal(&id)?,
        &mut store,
        &mut pool,
        &mut OsRng,
    )
    .await?;
    let verified = &approved.verified;
    Ok(Json(json!({
        "outputs": verified.payments.len(),
        "fee_zat": verified.fee_zat,
        "change_zat": verified.change_total_zat,
        "spends_to_sign": verified.spends_to_sign.len(),
        "signed": approved.signed,
        "complete": approved.completed,
    })))
}

/// Aggregates the signature shares carried by the approvals, proves and broadcasts.
async fn send(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult {
    let party = state.lock().await;
    let material = party.material()?;
    let tip = party.tip(&material).await?;
    let mut client = connect(&party.lightwalletd).await?;
    let sent = node::send_ready(
        &party.relay,
        &party.identity()?,
        &material,
        &party.network,
        tip,
        parse_proposal(&id)?,
        &mut client,
        &mut OsRng,
    )
    .await?;
    node::SentTxs::in_dir(party.path(state_dir::SENT)).put(&sent);
    Ok(Json(json!({ "txid": hex_txid(&sent.txid) })))
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let network = ZafeNetwork::from_name(&cli.network)
        .ok_or_else(|| anyhow!("--network must be regtest, test or main"))?;
    fs::create_dir_all(&cli.home)?;
    // Keep a copy of the vault log: a relay that loses or rewinds it is then refused.
    zafe_core::log_cache::configure(cli.home.join(LOG_DIR));
    let state: AppState = Arc::new(Mutex::new(Party {
        home: cli.home,
        relay: RelayClient::new(&cli.relay),
        lightwalletd: cli.lightwalletd,
        network,
    }));
    let app = Router::new()
        .route("/identity", post(create_identity))
        .route("/vault", get(vault))
        .route("/vault/create", post(create_vault))
        .route("/vault/join", post(join_vault))
        .route("/vault/seal", post(seal))
        .route("/vault/members", get(members))
        .route("/vault/keygen", post(keygen))
        .route("/balance", get(balance))
        .route("/spends", get(spends).post(propose))
        .route("/spends/{id}/approve", post(approve))
        .route("/spends/{id}/send", post(send))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(cli.listen).await?;
    eprintln!("hypothec-party listening on {}", cli.listen);
    axum::serve(listener, app).await?;
    Ok(())
}
