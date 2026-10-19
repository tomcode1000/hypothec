#!/usr/bin/env bash
# The demo's test wallet on Zcash TESTNET: a 2-of-2 vault whose two key shares are both held
# by local hypothec-party services, so the scripts can spend from it. It receives TAZ from
# the faucet (https://faucet.testnet.valargroup.dev/, 0.125 TAZ a day), pays each loan's
# vault for the lock, and takes the borrower's ZEC back on release, so one payout funds
# many demo loans. Testnet only: its keys sit in plain files.
#
# State lives in ~/hypothec-build/testnet-wallet and is KEPT between runs (it holds TAZ).
# Run in WSL Ubuntu: e2e/testnet-wallet.sh          -> prints the address and balance,
#                                                      creating the wallet the first time
# Leaves the relay and both parties running (ports 48791, 7891, 7892) until killed.
set -euo pipefail
# Locally (WSL) the binaries are in ~/hypothec-build; a host (deploy/start.sh) passes its own.
[[ -f ~/hypothec-build/env.sh ]] && source ~/hypothec-build/env.sh
export CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-~/hypothec-build/target-hypothec}
ZAFE_DIR=${ZAFE_DIR:-~/hypothec-build/zafe}
PARTY=${PARTY_BIN:-$CARGO_TARGET_DIR/debug/hypothec-party}
RELAY_BIN=${RELAY_BIN:-$ZAFE_DIR/target/debug/zafe-relay}
HOME_DIR=${WALLET_HOME:-~/hypothec-build/testnet-wallet}
RELAY_PORT=${RELAY_PORT:-48791}
export ZAFE_NETWORK=test ZAFE_LIGHTWALLETD=https://testnet.zec.rocks:443 ZAFE_RELAY="http://127.0.0.1:$RELAY_PORT"
mkdir -p "$HOME_DIR/a" "$HOME_DIR/b"

wait_port() { for _ in $(seq 100); do (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0; sleep 0.1; done; return 1; }
up() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
call() { curl -sS -X "$1" "http://127.0.0.1:$2$3" -H 'content-type: application/json' ${4:+-d "$4"}; }

if ! up "$RELAY_PORT"; then
  ZAFE_RELAY_LISTEN="127.0.0.1:$RELAY_PORT" ZAFE_RELAY_DB="$HOME_DIR/relay.sqlite" \
    nohup "$RELAY_BIN" >"$HOME_DIR/relay.log" 2>&1 </dev/null &
  wait_port "$RELAY_PORT"
fi
for p in a:7891 b:7892; do
  if ! up "${p#*:}"; then
    nohup "$PARTY" --home "$HOME_DIR/${p%%:*}" --listen "127.0.0.1:${p#*:}" >"$HOME_DIR/${p%%:*}.log" 2>&1 </dev/null &
    wait_port "${p#*:}"
  fi
done

if [[ ! -f "$HOME_DIR/a/vault.bin" ]]; then
  echo "== making the 2-of-2 test wallet on testnet"
  call POST 7891 /identity >/dev/null || true
  call POST 7892 /identity >/dev/null || true
  invite=$(call POST 7891 /vault/create '{"name":"Hypothec test wallet","threshold":2,"members":2}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["invite"])')
  call POST 7892 /vault/join "{\"invite\":\"$invite\"}" >/dev/null
  call POST 7891 /vault/seal >/dev/null
  sa=$(call GET 7891 /vault/members | python3 -c 'import json,sys; print(json.load(sys.stdin)["safety_number"])')
  sb=$(call GET 7892 /vault/members | python3 -c 'import json,sys; print(json.load(sys.stdin)["safety_number"])')
  [[ "$sa" == "$sb" ]] || { echo "safety numbers differ"; exit 1; }
  call POST 7891 /vault/keygen "{\"safety_number\":\"$sa\"}" > "$HOME_DIR/keygen-a.json" &
  call POST 7892 /vault/keygen "{\"safety_number\":\"$sb\"}" > "$HOME_DIR/keygen-b.json"
  wait
  cat "$HOME_DIR/keygen-a.json"; echo
fi

address=$(call GET 7891 /vault | python3 -c 'import json,sys; print(json.load(sys.stdin)["address"])')
echo "$address" > "$HOME_DIR/address"
echo "TEST WALLET ADDRESS (testnet): $address"
echo "balance: $(call GET 7891 /balance)"
