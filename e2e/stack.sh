#!/usr/bin/env bash
# The Zcash side of the wired system, kept running until stopped (Ctrl+C or kill):
#   - Ironwood regtest chain (ths; zafe's infra/regtest scripts)
#   - zafe relay on :48790
#   - a control API on 127.0.0.1:7899 for the Windows-side services, standing in for the
#     borrower's own Zcash wallet on regtest: POST /fund {"address","zec"} (faucet),
#     POST /mine {"blocks"}; and hosting the parties' key shares: POST /party
#     {"role","loan"} starts that loan's hypothec-party for that role (ports from 7810).
#     Localhost only.
# State lives in ~/hypothec-build/stack and is wiped at each start. When everything is up,
# the file ~/hypothec-build/stack/ready appears.
# Run in WSL Ubuntu: e2e/stack.sh
# NETWORK=test e2e/stack.sh: Zcash TESTNET instead of the local chain. No chain to start; the
# parties use the public lightwalletd testnet.zec.rocks, and locks are paid from the test
# wallet (e2e/testnet-wallet.sh, funded from the faucet). Blocks then take real time.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
source ~/hypothec-build/env.sh
export CARGO_TARGET_DIR=~/hypothec-build/target-hypothec
ZAFE_DIR=~/hypothec-build/zafe
PARTY=$CARGO_TARGET_DIR/debug/hypothec-party
STATE=~/hypothec-build/stack
RELAY_PORT=48790
NETWORK=${NETWORK:-regtest}
export ZAFE_REGTEST_NAME=hypothec-stack ZAFE_REGTEST_PORT_OFFSET=30500 ZAFE_NETWORK=$NETWORK
export ZAFE_RELAY="http://127.0.0.1:$RELAY_PORT"
if [[ $NETWORK == test ]]; then
  export ZAFE_LIGHTWALLETD=https://testnet.zec.rocks:443
else
  export ZAFE_LIGHTWALLETD="http://127.0.0.1:$((9067 + ZAFE_REGTEST_PORT_OFFSET))"
fi
PIDS=()
cleanup() {
  rm -f "$STATE/ready"
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
  [[ -f "$STATE/party-pids" ]] && xargs kill < "$STATE/party-pids" 2>/dev/null || true
  [[ $NETWORK == test ]] || "$ZAFE_DIR/infra/regtest/down.sh" || true
}
trap cleanup EXIT INT TERM

wait_port() { for _ in $(seq 100); do (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0; sleep 0.1; done; return 1; }

(cd "$HERE/.." && cargo build -q -p hypothec-core)
# A previous run stopped from Windows may leave its processes behind: stop them first.
for f in "$STATE/pids" "$STATE/party-pids"; do
  [[ -f "$f" ]] && while read -r p; do kill "$p" 2>/dev/null || true; done < "$f"
done
sleep 1
rm -rf "$STATE" && mkdir -p "$STATE"

if [[ $NETWORK == test ]]; then
  echo "== testnet: the test wallet"
  "$HERE/testnet-wallet.sh"
else
  echo "== chain"
  "$ZAFE_DIR/infra/regtest/up.sh"
fi

echo "== relay"
ZAFE_RELAY_LISTEN="127.0.0.1:$RELAY_PORT" ZAFE_RELAY_DB="$STATE/relay.sqlite" "$ZAFE_DIR/target/debug/zafe-relay" >"$STATE/relay.log" 2>&1 &
PIDS+=($!)
wait_port "$RELAY_PORT"

echo "== control API :7899 (faucet, mining, party host)"
THS_BIN=$(command -v "${THS:-ths}" || true) PARTY_BIN="$PARTY" STACK_STATE="$STATE" python3 "$HERE/control.py" >"$STATE/control.log" 2>&1 &
PIDS+=($!)
wait_port 7899

printf '%s\n' "${PIDS[@]}" > "$STATE/pids"
touch "$STATE/ready"
echo "network: $NETWORK"
echo "STACK READY (stop with Ctrl+C or by killing this script)"
wait
