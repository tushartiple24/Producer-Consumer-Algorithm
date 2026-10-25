#!/usr/bin/env bash
# Automated checks for the C++ simulator. Run from simulator/:  make test
set -u
BIN=./server_sync
pass=0; fail=0
ok()  { echo "  PASS  $1"; pass=$((pass+1)); }
bad() { echo "  FAIL  $1"; fail=$((fail+1)); }
field() { echo "$1" | grep -E "^$2" | head -1 | sed 's/.*: *//' | awk '{print $1}'; }

echo "1. Default scenario (15 producers / 10 slots / 3 workers, synchronized)"
out=$(timeout 30 $BIN 15 10 3 1 100 0)
[ "$(field "$out" 'Requests processed')" = "15" ] && ok "all 15 requests processed (no hang)" || bad "processed != 15"
[ "$(field "$out" 'Race-condition count')" = "0" ] && ok "no race with mutex" || bad "race with mutex"
[ "$(field "$out" 'Tickets')" = "1" ] && ok "exactly 1 ticket sold" || bad "tickets sold != 1"

echo "2. Buffer full / empty behaviour"
[ "$(field "$out" 'Peak buffer usage')" = "10" ] && ok "buffer reached 10/10" || bad "buffer never full"
[ "$(field "$out" 'Producer wait events')" -ge 1 ] && ok "producers blocked on full buffer" || bad "no producer waits"
[ "$(field "$out" 'Consumer wait events')" -ge 1 ] && ok "consumers blocked on empty buffer" || bad "no consumer waits"

echo "3. Unsynchronized mode"
out=$(timeout 30 $BIN 15 10 3 0 100 0)
[ "$(field "$out" 'Race-condition count')" -ge 1 ] && ok "lost update / overselling detected" || bad "race not reproduced"

echo "4. Deterministic race experiment"
timeout 30 $BIN --race >/dev/null && ok "--race: unsafe detected, safe prevented" || bad "--race experiment"

echo "5. Other configurations / termination"
for cfg in "15 1 3 1 5 0" "7 2 5 1 5 3" "30 3 1 1 2 0" "1 1 1 1 1 0"; do
  set -- $cfg
  o=$(timeout 30 $BIN $cfg) && [ "$(field "$o" 'Requests processed')" = "$1" ] && ok "config [$cfg]" || bad "config [$cfg]"
done

echo "6. Input validation"
$BIN 0 10 3 >/dev/null 2>&1; [ $? -eq 2 ] && ok "rejects clients=0" || bad "accepted clients=0"

echo; echo "passed=$pass failed=$fail"; [ $fail -eq 0 ]
