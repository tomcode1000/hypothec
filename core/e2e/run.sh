#!/usr/bin/env bash
# Builds hypothec-party and runs core/e2e/liquidation.sh. Run in WSL Ubuntu.
# Log: ~/hypothec-build/core-e2e.log
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
source ~/hypothec-build/env.sh
export CARGO_TARGET_DIR=~/hypothec-build/target-hypothec
echo "start $(date -Is)"
(cd "$HERE/../.." && cargo build -q -p hypothec-core) || { echo "build failed"; exit 1; }
"$HERE/liquidation.sh" > ~/hypothec-build/core-e2e.log 2>&1
status=$?
grep -vE "^\s*$" ~/hypothec-build/core-e2e.log | tail -80
echo "exit $status"
exit $status
