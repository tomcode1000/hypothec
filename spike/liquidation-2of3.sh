#!/usr/bin/env bash
# Hypothec spike (BUILD-PLAN section 1): the liquidation shape on an Ironwood regtest chain.
#
#   Borrower, Lender and Referee run a FROST DKG -> one shielded vault (2-of-3).
#   The vault receives 10 ZEC (two faucet notes).
#   Lender proposes ONE transaction with TWO outputs: the lender's share and the
#   borrower's surplus. Lender + Referee approve and sign. The Borrower does nothing.
#   Lender aggregates, proves and broadcasts; the chain mines it.
#
# Adapted from zafe's scripts/m0-e2e.sh (MIT OR Apache-2.0, Anmol Bansal and Zafe
# contributors). Needs the patched zafe in ZAFE_DIR (see docs/SPIKE.md), Docker and ths 0.3.0.
#   ZAFE_DIR=~/hypothec-build/zafe spike/liquidation-2of3.sh
set -euo pipefail

ZAFE_DIR=${ZAFE_DIR:?set ZAFE_DIR to the patched zafe checkout}
cd "$ZAFE_DIR"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/hypothec-spike.XXXXXX")
RELAY_PORT=${HYPOTHEC_RELAY_PORT:-48788}
export ZAFE_REGTEST_NAME=hypothec-spike ZAFE_REGTEST_PORT_OFFSET=30300
export ZAFE_RELAY="http://127.0.0.1:$RELAY_PORT" ZAFE_LIGHTWALLETD="http://127.0.0.1:$((9067 + ZAFE_REGTEST_PORT_OFFSET))"
RPC="http://127.0.0.1:$((18232 + ZAFE_REGTEST_PORT_OFFSET))"

# Loan terms for the spike (zatoshis). 10 ZEC locked; lender is owed 5.15 ZEC.
LOCKED=1000000000
LENDER_SHARE=515000000
# Fee for two notes in, two outputs, no change: 15,000 zat, as zafe's wallet computes it
# (ZIP 317, 5,000 zat per action; observed 8 Oct, the 10,000 guess was refused).
FEE=${FEE_ZAT:-15000}
SURPLUS=$((LOCKED - LENDER_SHARE - FEE))

cargo build -q -p zafe-cli -p zafe-relay
cargo build -q -p zafe-core --example vault_address
ZAFE="$ZAFE_DIR/target/debug/zafe"

cleanup() {
  [[ -n "${RELAY_PID:-}" ]] && kill "$RELAY_PID" 2>/dev/null || true
  [[ -z "${KEEP_CHAIN:-}" ]] && "$ZAFE_DIR/infra/regtest/down.sh" || true
  rm -rf "$WORK"
}
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }
member() { local who=$1; shift; "$ZAFE" --home "$WORK/$who" "$@"; }
mine() { "${THS:-ths}" --name "$ZAFE_REGTEST_NAME" mine "$1" >/dev/null; }
rpc() { curl -sf -X POST -H 'content-type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}" "$RPC"; }
wait_lwd() {
  for _ in $(seq 120); do
    h=$(member Borrower sync 2>/dev/null | awk '{print $2}') || true
    [[ "${h:-0}" -ge "$1" ]] && return 0
    sleep 1
  done
  echo "lightwalletd did not reach height $1" >&2; exit 1
}

step "relay (forwards encrypted messages between the three parties; holds no keys)"
ZAFE_RELAY_LISTEN="127.0.0.1:$RELAY_PORT" ZAFE_RELAY_DB="$WORK/relay.sqlite" "$ZAFE_DIR/target/debug/zafe-relay" &
RELAY_PID=$!
for _ in $(seq 50); do
  (exec 3<>"/dev/tcp/127.0.0.1/$RELAY_PORT") 2>/dev/null && break
  sleep 0.2
done

step "identities"
for who in Borrower Lender Referee; do member "$who" init; done

step "Borrower opens a 2-of-3 loan vault; Lender and Referee join"
INVITE=$(member Borrower vault create --name Loan-001 --threshold 2 --members 3)
member Lender vault join "$INVITE"
member Referee vault join "$INVITE"
member Borrower vault seal

step "safety numbers match"
SN_B=$(member Borrower vault members | sed -n 's/^safety number: //p')
SN_L=$(member Lender vault members | sed -n 's/^safety number: //p')
SN_R=$(member Referee vault members | sed -n 's/^safety number: //p')
echo "Borrower: $SN_B  Lender: $SN_L  Referee: $SN_R"
[[ "$SN_B" == "$SN_L" && "$SN_L" == "$SN_R" ]] || { echo "safety numbers differ" >&2; exit 1; }

step "FROST DKG (three processes, through the relay)"
member Borrower vault keygen --safety-number "$SN_B" --birthday 2 > "$WORK/kB" &
KB=$!
member Lender vault keygen --safety-number "$SN_L" > "$WORK/kL" &
KL=$!
member Referee vault keygen --safety-number "$SN_R" > "$WORK/kR" &
KR=$!
wait "$KB" "$KL" "$KR"
cat "$WORK/kB" "$WORK/kL" "$WORK/kR"
VAULT=$(member Borrower vault show | sed -n 's/^address //p')
[[ "$(member Lender vault show | sed -n 's/^address //p')" == "$VAULT" ]]
[[ "$(member Referee vault show | sed -n 's/^address //p')" == "$VAULT" ]]
echo "vault: $VAULT"

step "regtest chain; Borrower locks 10 ZEC in the vault (2 shielded notes)"
"$ZAFE_DIR/infra/regtest/up.sh"
"$ZAFE_DIR/infra/regtest/fund.sh" "$VAULT" 2
TIP=$(rpc getblockcount '[]' | sed 's/.*"result":\([0-9]*\).*/\1/')
wait_lwd "$TIP"
for who in Borrower Lender Referee; do echo "$who sees: $(member "$who" sync)"; done

step "liquidation: Lender proposes ONE tx, two outputs"
LENDER_ADDR=$("$ZAFE_DIR/target/debug/examples/vault_address" 1 | sed -n 's/^ua=//p')
BORROWER_ADDR=$("$ZAFE_DIR/target/debug/examples/vault_address" 2 | sed -n 's/^ua=//p')
[[ "$LENDER_ADDR" != "$BORROWER_ADDR" ]]
echo "lender share   $LENDER_SHARE zat -> $LENDER_ADDR"
echo "borrower surplus $SURPLUS zat -> $BORROWER_ADDR"
echo "fee            $FEE zat"
PROPOSAL=$(member Lender propose \
  --to "$LENDER_ADDR" --amount "$LENDER_SHARE" \
  --to "$BORROWER_ADDR" --amount "$SURPLUS" \
  --memo "Hypothec spike: liquidation" | awk '{print $2}')
member Lender proposals

step "Lender and Referee each rebuild and check the tx, then approve (Borrower does not sign)"
member Lender approve "$PROPOSAL"
member Referee approve "$PROPOSAL"
member Lender proposals

step "Lender aggregates the 2 signature shares, proves and broadcasts"
member Lender send "$PROPOSAL" | tee "$WORK/send"
mine 2
sleep 3
member Lender proposals | tee "$WORK/after"
grep -q "Broadcast" "$WORK/after" || { echo "proposal not broadcast" >&2; exit 1; }

step "vault after liquidation (expect 0: everything left the vault in one tx)"
for who in Borrower Lender Referee; do echo "$who sees: $(member "$who" sync)"; done

echo
echo "HYPOTHEC SPIKE: OK (2-of-3 FROST, Ironwood, one tx, two outputs, Borrower not signing)"
