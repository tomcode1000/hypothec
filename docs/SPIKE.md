# Spike: 2-of-3 FROST spend on Ironwood (BUILD-PLAN section 1)

Goal: three parties run FROST DKG, receive shielded ZEC into the vault, and make ONE
Ironwood spend signed by any 2 of 3, paying two outputs (lender share + borrower surplus).

Started: 8 Oct 2026. Deadline for GO / NO-GO: 2 days of work.

## Verdict: GO (8 Oct 2026, day 1)

On an Ironwood (NU6.3) regtest chain, Borrower, Lender and Referee ran a FROST DKG as three
separate processes; the vault received 10 ZEC in two shielded notes; Lender proposed ONE
transaction paying 5.15 ZEC to the lender and 4.84985 ZEC to the borrower (fee 0.00015
ZEC, change 0); Lender and Referee each verified and signed; the Borrower did not sign.
The transaction was broadcast and mined, and all three parties then saw the vault at 0.

- txid `ece4e09782fdc56e12ca8da01b0bb723d39b420cd3b3d158b848564b512eb1d2` (regtest, height 121)
- approve output, both signers: `2 payment(s), fee 15000 zat, change 0 zat, 2 spend(s) to sign`
- Full log: `~/hypothec-build/liquidation.log` in WSL.

Not yet checked in the spike: that the two recipient wallets see their notes (since checked
in core/e2e on 8 Oct: recipients received 999,985,000 zat); testnet instead of regtest.

## Status

| Step | State |
|---|---|
| 1. Study zafe, check licence | Done |
| Build zafe in WSL (CLI, relay, example) | Done (after OpenSSL workaround) |
| Offline 2-of-3 FROST Ironwood spend (`cargo test -p zafe-core --test spend`) | Passes, 3/3 (one output, no chain) |
| Two-output patch compiles; `propose --help` shows repeatable flags | Done |
| 2. Reproduce zafe's end-to-end regtest spend (`scripts/m0-e2e.sh`) | Passes ("M0 end-to-end: OK") |
| 3. Two-output liquidation spend, Lender + Referee signing | Passes ("HYPOTHEC SPIKE: OK") |

## zafe

- Repo: https://github.com/AnmolBansalDEV/zafe, cloned to `vendor/zafe`
- Commit: `6baa6782ed26263d62b1753c1ae95ac84b5d69ed` (8 Oct 2026, "Remove the beta caps,
  split testnet and mainnet deploy keys")
- Licence: **MIT OR Apache-2.0** (workspace `Cargo.toml`, `LICENSE-MIT`, `LICENSE-APACHE`).
  Reuse is allowed if we keep the copyright notice. Exception: the Flutter app code derived
  from Vizor is Apache-2.0 only; we don't use the app.
- Status per its README: pre-release, testnet/regtest only, not audited.

What it already does that Hypothec needs:
- FROST DKG between separate processes through a "blind relay" (relay forwards encrypted
  messages; never sees keys, amounts or addresses).
- Re-randomized FROST (reddsa) signing of Ironwood (NU6.3) spends, built as PCZTs.
- Every signer rebuilds and checks the transaction (recipients, amounts, memos, change,
  fee, sighash) before signing: `zafe-core/src/verify.rs`. This is the hook for the
  referee's rules later (BRIEF 4a, 4b).
- Multi-payment proposals in core: `node::propose` takes `&[PaymentRequest]`, and
  verification matches each payment exactly.
- A headless CLI member (`zafe-cli`) used for tests.

## Changes to zafe for the spike

Patch: `spike/zafe-multi-output.patch` (against the commit above). Two small changes:
1. `zafe propose` accepts `--to`/`--amount` more than once, paired in order, so one
   proposal pays several outputs. One `--to` behaves as before.
2. `examples/vault_address` takes an optional address index, so the spike has two
   distinct recipient addresses (lender, borrower).

No cryptography or core logic changed.

## Environment

- Windows 11; builds and regtest run in WSL Ubuntu 24.04 (8 cores, 11 GB RAM).
- Docker Desktop 29.2.1 (WSL integration works: `docker info` from Ubuntu).
- Rust (WSL): rustc 1.99.0, cargo 1.99.0, installed with rustup (minimal profile).
  zafe needs >= 1.88.
- Build directory: `~/hypothec-build/zafe` inside Ubuntu (a git clone of `vendor/zafe`).
  Kept out of OneDrive because the Zcash build output is several GB.
- Regtest: `ths` (thus-spoke-zakura, Zcash Labs) **0.3.0** exactly, which runs a Zakura
  node + lightwalletd + a mining/faucet wallet in Docker, NU6.3 active.

## Pinned crate versions (from zafe's workspace Cargo.toml)

| Crate | Version |
|---|---|
| frost-core | =3.0.0 |
| frost-rerandomized | =3.0.0 |
| reddsa | =0.5.2 (features frost, serde) |
| orchard | =0.15.5 |
| pczt | =0.9.3 |
| zcash_primitives | =0.30.1 |
| zcash_protocol | 0.10 |
| zcash_keys | =0.16.1 (feature unstable-frost) |
| zcash_client_backend | =0.24.0 |
| zcash_client_sqlite | =0.22.0 |
| zcash_spec | =0.2.1 |
| zip321 | 0.9 |
| zcash_address | 0.13 |

## Commands

Set up (WSL Ubuntu):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
source ~/.cargo/env
mkdir -p ~/hypothec-build && cd ~/hypothec-build
git clone "/mnt/c/Users/Toleexxzy/OneDrive/Documents/coding projects/hypothec/vendor/zafe" zafe
cd zafe

# WSL clock workaround (see Log, 8 Oct): build OpenSSL 3.6.3 once by hand, from the
# openssl-src 300.6.1+3.6.3 crate source, with the crate's own Configure options.
cp -r ~/.cargo/registry/src/*/openssl-src-300.6.1+3.6.3/openssl ~/hypothec-build/openssl-src
cd ~/hypothec-build/openssl-src
./Configure --prefix=$HOME/hypothec-build/openssl --libdir=lib no-shared no-module no-tests \
  no-docs no-comp no-zlib no-zlib-dynamic no-legacy no-ssl3 no-md2 no-rc5 \
  no-weak-ssl-ciphers -fPIC linux-x86_64
make -j8 build_libs || make -j8 build_libs   # rerun if it stops on "modification time in the future"
make install_dev
# ~/hypothec-build/env.sh, sourced before every build:
#   source ~/.cargo/env
#   export OPENSSL_NO_VENDOR=1 OPENSSL_STATIC=1 OPENSSL_DIR=$HOME/hypothec-build/openssl
#   export PATH="$HOME/.local/bin:$PATH"
source ~/hypothec-build/env.sh
cd ~/hypothec-build/zafe
cargo build -p zafe-cli -p zafe-relay
cargo build -p zafe-core --example vault_address
```

Install ths 0.3.0 (pulls its Docker images):

```bash
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/zcashlabs/thus-spoke-zakura/main/install.sh | THS_VERSION=0.3.0 sh
export PATH="$HOME/.local/bin:$PATH"
```

Step 2, reproduce zafe's run (unpatched behaviour, one output, members B + C sign):

```bash
source ~/hypothec-build/env.sh
cd ~/hypothec-build/zafe && scripts/m0-e2e.sh
```

Step 3, the liquidation shape:

```bash
source ~/hypothec-build/env.sh
cd ~/hypothec-build/zafe
git apply "/mnt/c/Users/Toleexxzy/OneDrive/Documents/coding projects/hypothec/spike/zafe-multi-output.patch"
ZAFE_DIR=~/hypothec-build/zafe \
  "/mnt/c/Users/Toleexxzy/OneDrive/Documents/coding projects/hypothec/spike/liquidation-2of3.sh"
```

What `spike/liquidation-2of3.sh` does: Borrower, Lender, Referee create a 2-of-3 vault
and run the DKG; the faucet locks 10 ZEC (two notes); Lender proposes one transaction
paying 5.15 ZEC to the lender and 4.84985 ZEC to the borrower (10 ZEC minus the share
minus a 15,000 zat ZIP 317 fee, so no change stays in the vault); Lender and Referee each
verify and approve; Lender aggregates, proves, broadcasts; two blocks are mined; the
script checks the proposal shows as broadcast and prints the vault balance (expect 0).
If the fee guess is wrong, rerun with `FEE_ZAT=<fee shown by approve>`.

## Log

- 8 Oct: read BRIEF, BUILD-PLAN, research rounds 13-17. Cloned zafe, checked licence
  (MIT OR Apache-2.0). Read its regtest setup, `m0-e2e.sh`, `tx.rs`, `wallet.rs::propose`,
  `node::propose`, `verify.rs`. Found multi-output support already in core; only the CLI
  limited it to one payment. Wrote the CLI patch and the spike script.
- 8 Oct: Rust installed in WSL; first build of zafe started.
- 8 Oct: build failed in `openssl-sys` (vendored OpenSSL, pulled in by SQLCipher via
  `rusqlite` -> `libsqlite3-sys`): make stopped on "file has modification time N s in the
  future". Cause: WSL2 clock bug. Within one script `date` said 08:15:48 and `uptime`
  08:15:01; the WSL clock was also 47 s behind Windows. `wsl --shutdown` resynced
  Windows vs WSL but the internal disagreement came back. `sudo hwclock -s` would fix
  it but needs the user's password. Workaround: build OpenSSL by hand (retrying make)
  and point openssl-sys at it with `OPENSSL_NO_VENDOR=1 OPENSSL_DIR=...`. The OpenSSL
  version and options are the same as the vendored build's.
- 8 Oct: zafe-cli, zafe-relay and examples/vault_address build (about 6 min each from
  cold). Patch applied in `~/hypothec-build/zafe`, compiles with no warnings.
  `vault_address 1` and `vault_address 2` give two distinct regtest addresses.
- 8 Oct: `cargo test -p zafe-core --test spend`: 3 passed in 10 s (FROST 2-of-3 signs an
  Ironwood spend, Halo 2 proof made, extracted tx verifies; a foreign note and a wrong
  re-randomizer are rejected). One output only, no chain: this is not yet the GO test.
- 8 Oct: installing ths was blocked by the session's permission rules (it runs a
  downloaded binary). Waiting on the user.
- 8 Oct: user approved; ths 0.3.0 installed to `~/.local/bin`. Images:
  `zakuracore/zakura:1.6.0`, `ghcr.io/zcashlabs/thus-spoke-zakura-app:0.3.0`,
  `ghcr.io/zcashlabs/thus-spoke-zakura-lightwalletd:0.3.0`.
- 8 Oct: running `scripts/m0-e2e.sh` (starts the chain with `ths start`) was blocked by
  the session's permission rules too. Waiting on the user again.
- 8 Oct: user approved two exact-command allow rules (in `~/.claude/settings.json`, not
  in any project folder) for `spike/run-m0.sh` and `spike/run-liquidation.sh`, the
  runners for steps 2 and 3. Run them from Windows with
  `wsl -d Ubuntu -- bash "/mnt/c/Users/Toleexxzy/OneDrive/Documents/coding projects/hypothec/spike/run-m0.sh"`
  (same for `run-liquidation.sh`).
- 8 Oct: step 2 passed. 3-member DKG, 3 x 5 ZEC funded, 1 ZEC sent by B + C, fee
  10,000 zat, txid `326979ea2ef3b8782acdd95b50574c886d62ec6d439bb8548207568aee9f99ec`.
- 8 Oct: step 3, first run failed at propose: `InsufficientFunds { available: 1000000000,
  required: 1000005000 }`. The wallet's fee for 2 notes in + 2 outputs is 15,000 zat,
  not my 10,000 guess. Reran with 15,000 (now the script's default): passed. See Verdict.
