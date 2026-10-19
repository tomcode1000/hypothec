//! `hypothec-watch`: the balance behind a unified full viewing key, with no key share.
//!
//! A viewing key shows balance and history and cannot spend. Use it to check a vault from
//! outside (an auditor given the vault's key) or to confirm a payout reached its recipient.
//! Prints one JSON line. Development only: the cache database key sits in `--home`.

use std::{fs, path::PathBuf};

use anyhow::{anyhow, Result};
use clap::Parser;
use serde_json::json;
use zafe_core::wallet::{connect, VaultWallet, WalletKey, ZafeNetwork};
use zcash_keys::keys::UnifiedFullViewingKey;

#[derive(Parser)]
#[command(name = "hypothec-watch", about = "Balance from a viewing key (development only)")]
struct Cli {
    /// Unified full viewing key (uview... / uviewregtest...).
    #[arg(long)]
    ufvk: String,
    /// Height to scan from: the key's birthday (the vault's, from GET /vault).
    #[arg(long)]
    birthday: u32,
    /// Cache directory for this key's scanned chain data.
    #[arg(long)]
    home: PathBuf,
    #[arg(long, env = "ZAFE_LIGHTWALLETD", default_value = "http://127.0.0.1:9067")]
    lightwalletd: String,
    /// Zcash network: regtest (default), test or main.
    #[arg(long, env = "ZAFE_NETWORK", default_value = "regtest")]
    network: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let network = ZafeNetwork::from_name(&cli.network)
        .ok_or_else(|| anyhow!("--network must be regtest, test or main"))?;
    let ufvk = UnifiedFullViewingKey::decode(&network, &cli.ufvk)
        .map_err(|e| anyhow!("not a viewing key for {}: {e}", cli.network))?;
    fs::create_dir_all(&cli.home)?;
    let path = cli.home.join("watch.sqlite");
    let key_path = cli.home.join("watch.key");
    let key = match fs::read(&key_path) {
        Ok(bytes) => WalletKey::from_slice(&bytes)?,
        Err(_) => {
            let key = WalletKey::random();
            fs::write(&key_path, key.as_bytes())?;
            key
        }
    };
    let mut client = connect(&cli.lightwalletd).await?;
    let mut wallet = if VaultWallet::exists(&path, &key, network.clone()) {
        VaultWallet::open(&path, &key, network.clone())?
    } else {
        let _ = fs::remove_file(&path);
        VaultWallet::create(&path, &key, network.clone(), "watch", &ufvk, cli.birthday, &mut client)
            .await?
    };
    wallet.sync(&mut client).await?;
    let b = wallet.balance()?;
    println!(
        "{}",
        json!({
            "height": wallet.chain_height()?.unwrap_or(0),
            "spendable_zat": b.ironwood_spendable,
            "ironwood_zat": b.ironwood_total,
            "total_zat": b.total,
        })
    );
    Ok(())
}
