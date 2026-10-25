#!/usr/bin/env bash
# Starts the hosted demo on a Hugging Face Space. A free Space keeps no files across restarts,
# so the Zcash test wallet's keys come from a secret (TESTNET_ZEC_WALLET_B64: a base64 tar of
# its key files) and the wallet rescans the chain; the desks are reopened on every start.
set -euo pipefail
mkdir -p /data/testnet-wallet
if [[ -n "${TESTNET_ZEC_WALLET_B64:-}" && ! -f /data/testnet-wallet/a/vault.bin ]]; then
  printf '%s' "$TESTNET_ZEC_WALLET_B64" | base64 -d | tar xz -C /data/testnet-wallet
  echo "test wallet keys restored: $(cat /data/testnet-wallet/address)"
fi
exec bash /app/deploy/start.sh
