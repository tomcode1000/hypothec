#!/usr/bin/env bash
# Starts the hosted demo (deploy/Dockerfile), in order, on Zcash testnet:
#   zafe relay -> test wallet (2-of-2, pays the locks) -> party host -> loanbook and both
#   guardians -> test desks on first boot -> website with the desk agents (in front).
# Everything keeps its state on /data, so a redeploy picks up where it left off.
# Secrets come from the host's environment, never the image:
#   TESTNET_WALLETS_JSON   the test wallets' Base Sepolia keys (testnet only)
#   HYPOTHEC_DEMO_TOKEN    unlocks the demo price controls (?demo=<token> on the Lending tab)
set -euo pipefail
mkdir -p /data/.hypothec /data/stack /data/testnet-wallet

if [[ -n "${TESTNET_WALLETS_JSON:-}" ]]; then
  printf '%s' "$TESTNET_WALLETS_JSON" > /data/.hypothec/testnet-wallets.json
fi
[[ -f /data/.hypothec/testnet-wallets.json ]] || { echo "TESTNET_WALLETS_JSON is not set"; exit 1; }

export ZAFE_NETWORK=test ZAFE_LIGHTWALLETD=https://testnet.zec.rocks:443
export ZAFE_RELAY=http://127.0.0.1:48790 STACK_STATE=/data/stack PARTY_BIN=/usr/local/bin/hypothec-party

wait_port() { for _ in $(seq 300); do (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0; sleep 0.2; done; return 1; }

echo "== relay"
ZAFE_RELAY_LISTEN=127.0.0.1:48790 ZAFE_RELAY_DB=/data/stack/relay.sqlite zafe-relay &
wait_port 48790

echo "== test wallet"
WALLET_HOME=/data/testnet-wallet RELAY_PORT=48790 RELAY_BIN=/usr/local/bin/zafe-relay \
  bash /app/e2e/testnet-wallet.sh || echo "test wallet: not ready yet (it retries on the next deploy)"
if [[ -f /data/testnet-wallet/address ]]; then
  export HYPOTHEC_TEST_WALLET_ZEC=$(cat /data/testnet-wallet/address)
  echo "Fund the test wallet at https://faucet.testnet.valargroup.dev/ : $HYPOTHEC_TEST_WALLET_ZEC"
fi

echo "== party host"
THS_BIN="" python3 /app/e2e/control.py &
wait_port 7899

echo "== loanbook and guardians"
cd /app/services
npx ts-node --transpile-only src/serve.ts all &
wait_port 7900
node /app/deploy/seed-desks.js || echo "seed desks: skipped"

echo "== website on :${PORT:-10000}"
HYPOTHEC_API_HOST=0.0.0.0 HYPOTHEC_API_PORT=${PORT:-10000} exec npx ts-node --transpile-only src/api.ts
