#!/usr/bin/env bash
# core/ end-to-end on an Ironwood regtest chain, through the HTTP API only, in the product's
# vault shape (docs/DECISIONS.md D4): 3-of-4, Borrower :7801, Lender :7802 and two referees
# from the operator list, RefereeA :7803 and RefereeB :7804.
# The vault receives 10 ZEC; Lender proposes ONE spend with two outputs (lender share,
# borrower surplus); Lender + RefereeA + RefereeB approve; Lender sends. Borrower never
# signs. Before that, it checks that Lender + one referee alone cannot complete the spend.
#
# Run in WSL Ubuntu after building (see core/README.md):
#   source ~/hypothec-build/env.sh && core/e2e/liquidation.sh
# Needs: ths 0.3.0, zafe-relay and examples/vault_address built in ~/hypothec-build/zafe,
# hypothec-party built in ~/hypothec-build/target-hypothec.
set -euo pipefail

ZAFE_DIR=${ZAFE_DIR:-$HOME/hypothec-build/zafe}
PARTY=${PARTY:-$HOME/hypothec-build/target-hypothec/debug/hypothec-party}
WATCH=${WATCH:-$HOME/hypothec-build/target-hypothec/debug/hypothec-watch}
WORK=$(mktemp -d "${TMPDIR:-/tmp}/hypothec-core-e2e.XXXXXX")
RELAY_PORT=48789
export ZAFE_REGTEST_NAME=hypothec-core-e2e ZAFE_REGTEST_PORT_OFFSET=30400
export ZAFE_RELAY="http://127.0.0.1:$RELAY_PORT" ZAFE_LIGHTWALLETD="http://127.0.0.1:$((9067 + ZAFE_REGTEST_PORT_OFFSET))"
RPC="http://127.0.0.1:$((18232 + ZAFE_REGTEST_PORT_OFFSET))"
PARTIES=(Borrower Lender RefereeA RefereeB)
declare -A PORT=([Borrower]=7801 [Lender]=7802 [RefereeA]=7803 [RefereeB]=7804)

LOCKED=1000000000
LENDER_SHARE=515000000
FEE=15000
SURPLUS=$((LOCKED - LENDER_SHARE - FEE))

PIDS=()
cleanup() {
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
  "$ZAFE_DIR/infra/regtest/down.sh" || true
  rm -rf "$WORK"
}
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }
# api WHO METHOD PATH [JSON]: prints the response body, fails on a non-2xx status.
api() {
  local who=$1 method=$2 path=$3 body=${4:-}
  local out status
  out=$(curl -sS -X "$method" -H 'content-type: application/json' ${body:+--data "$body"} \
    -w '\n%{http_code}' "http://127.0.0.1:${PORT[$who]}$path")
  status=${out##*$'\n'}
  out=${out%$'\n'*}
  if [[ "$status" != 2* ]]; then echo "$who $method $path -> $status $out" >&2; return 1; fi
  printf '%s\n' "$out"
}
# field KEY... : walks a JSON value from stdin (numeric keys index lists).
field() { python3 -c 'import json,sys; v=json.load(sys.stdin); [v:=v[int(k) if k.isdigit() else k] for k in sys.argv[1:]]; print(v)' "$@"; }
mine() { "${THS:-ths}" --name "$ZAFE_REGTEST_NAME" mine "$1" >/dev/null; }
wait_port() { for _ in $(seq 100); do (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0; sleep 0.1; done; return 1; }

step "relay + four party services"
ZAFE_RELAY_LISTEN="127.0.0.1:$RELAY_PORT" ZAFE_RELAY_DB="$WORK/relay.sqlite" "$ZAFE_DIR/target/debug/zafe-relay" &
PIDS+=($!)
wait_port "$RELAY_PORT"
for who in "${PARTIES[@]}"; do
  "$PARTY" --home "$WORK/$who" --listen "127.0.0.1:${PORT[$who]}" 2>"$WORK/$who.log" &
  PIDS+=($!)
  wait_port "${PORT[$who]}"
  echo "$who: $(api "$who" POST /identity | field identity)"
done

step "Borrower opens a 3-of-4 loan vault; Lender and both referees join"
INVITE=$(api Borrower POST /vault/create '{"name":"Loan-001","threshold":3,"members":4}' | field invite)
for who in Lender RefereeA RefereeB; do api "$who" POST /vault/join "{\"invite\":\"$INVITE\"}"; done
api Borrower POST /vault/seal
declare -A SN
for who in "${PARTIES[@]}"; do SN[$who]=$(api "$who" GET /vault/members | field safety_number); done
echo "safety numbers: ${SN[*]}"
for who in "${PARTIES[@]}"; do [[ "${SN[$who]}" == "${SN[Borrower]}" ]]; done

step "DKG (four services at once)"
KPIDS=()
for who in "${PARTIES[@]}"; do
  body="{\"safety_number\":\"${SN[$who]}\""
  [[ $who == Borrower ]] && body+=',"birthday":2'
  api "$who" POST /vault/keygen "$body}" > "$WORK/k$who" &
  KPIDS+=($!)
done
wait "${KPIDS[@]}"
VAULT=$(field address < "$WORK/kBorrower")
for who in "${PARTIES[@]}"; do [[ "$(field address < "$WORK/k$who")" == "$VAULT" ]]; done
echo "vault: $VAULT"
echo "threshold $(api Lender GET /vault | field threshold) of $(api Lender GET /vault | field members)"
[[ "$(api Lender GET /vault | field threshold)" == 3 && "$(api Lender GET /vault | field members)" == 4 ]]

step "chain up; 10 ZEC locked"
"$ZAFE_DIR/infra/regtest/up.sh"
"$ZAFE_DIR/infra/regtest/fund.sh" "$VAULT" 2
TIP=$(curl -sf -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"getblockcount","params":[]}' "$RPC" | field result)
for _ in $(seq 120); do
  h=$(api Lender GET /balance 2>/dev/null | field height) || true
  [[ "${h:-0}" -ge "$TIP" ]] && break
  sleep 1
done
for who in "${PARTIES[@]}"; do echo "$who: $(api "$who" GET /balance)"; done
[[ "$(api Lender GET /balance | field spendable_zat)" == "$LOCKED" ]]

step "an outsider with only the vault's viewing key sees the 10 ZEC"
VAULT_UFVK=$(api Lender GET /vault | field ufvk)
VAULT_BIRTHDAY=$(api Lender GET /vault | field birthday)
watch_vault() { "$WATCH" --ufvk "$VAULT_UFVK" --birthday "$VAULT_BIRTHDAY" --home "$WORK/watch-vault"; }
watch_vault
[[ "$(watch_vault | field total_zat)" == "$LOCKED" ]]

step "liquidation: Lender proposes one spend, two outputs"
LENDER_ADDR=$("$ZAFE_DIR/target/debug/examples/vault_address" 1 | sed -n 's/^ua=//p')
BORROWER_ADDR=$("$ZAFE_DIR/target/debug/examples/vault_address" 2 | sed -n 's/^ua=//p')
ID=$(api Lender POST /spends "{\"outputs\":[{\"address\":\"$LENDER_ADDR\",\"amount_zat\":$LENDER_SHARE},{\"address\":\"$BORROWER_ADDR\",\"amount_zat\":$SURPLUS}],\"memo\":\"Hypothec loan 001: liquidation\"}" | field id)
echo "spend $ID"

step "Lender + one referee is not enough"
api Lender POST "/spends/$ID/approve"
api RefereeA POST "/spends/$ID/approve" | tee "$WORK/a2"
[[ "$(field complete < "$WORK/a2")" == "False" ]]
if api Lender POST "/spends/$ID/send" 2>"$WORK/early"; then
  echo "send with 2 of 3 required signatures should have failed" >&2; exit 1
fi
echo "refused as expected: $(cat "$WORK/early")"

step "the second referee approves; Lender sends"
api RefereeB POST "/spends/$ID/approve" | tee "$WORK/a3"
[[ "$(field complete < "$WORK/a3")" == "True" ]]
api Lender POST "/spends/$ID/send"
mine 2
sleep 3
api Borrower GET /spends
[[ "$(api Borrower GET /spends | field spends 0 status)" == "Broadcast" ]]

step "vault after liquidation"
for who in "${PARTIES[@]}"; do echo "$who: $(api "$who" GET /balance)"; done
[[ "$(api Borrower GET /balance | field total_zat)" == "0" ]]
echo "outsider (vault viewing key): $(watch_vault)"
[[ "$(watch_vault | field total_zat)" == "0" ]]

step "the payouts arrived (viewing key of the test recipients' key)"
RECIPIENT_UFVK=$("$ZAFE_DIR/target/debug/examples/vault_address" | sed -n 's/^ufvk=//p')
RECEIVED=$("$WATCH" --ufvk "$RECIPIENT_UFVK" --birthday 2 --home "$WORK/watch-recipients")
echo "recipients: $RECEIVED"
[[ "$(field total_zat <<< "$RECEIVED")" == "$((LENDER_SHARE + SURPLUS))" ]]

echo
echo "CORE E2E: OK (3-of-4, Lender + both referees, Borrower not signing, payouts received)"
