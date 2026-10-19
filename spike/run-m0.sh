#!/usr/bin/env bash
# Spike step 2: zafe's own end-to-end regtest run (one output, members B + C sign).
# Run in WSL Ubuntu. Log: ~/hypothec-build/m0.log
set -uo pipefail
source ~/hypothec-build/env.sh
cd ~/hypothec-build/zafe
echo "start $(date -Is)"
scripts/m0-e2e.sh > ~/hypothec-build/m0.log 2>&1
status=$?
grep -vE "^\s*$" ~/hypothec-build/m0.log | tail -60
echo "exit $status"
exit $status
