#!/usr/bin/env bash
# Spike step 3: the liquidation shape (two outputs, Lender + Referee sign).
# Run in WSL Ubuntu. Log: ~/hypothec-build/liquidation.log
# Fee override: put a whole number of zatoshis in spike/FEE_ZAT (default 15000).
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
source ~/hypothec-build/env.sh
if [[ -f "$HERE/FEE_ZAT" ]]; then
  FEE_ZAT=$(tr -d '[:space:]' < "$HERE/FEE_ZAT")
  [[ "$FEE_ZAT" =~ ^[0-9]+$ ]] || { echo "spike/FEE_ZAT must be a whole number" >&2; exit 2; }
  export FEE_ZAT
fi
echo "start $(date -Is) fee ${FEE_ZAT:-15000}"
ZAFE_DIR=~/hypothec-build/zafe "$HERE/liquidation-2of3.sh" > ~/hypothec-build/liquidation.log 2>&1
status=$?
grep -vE "^\s*$" ~/hypothec-build/liquidation.log | tail -80
echo "exit $status"
exit $status
