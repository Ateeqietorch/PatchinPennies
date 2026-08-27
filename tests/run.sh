#!/usr/bin/env bash
# Runs every suite and fails if any of them reports an error.
# Needs jsdom once:  npm install jsdom
cd "$(dirname "$0")"
fail=0
for t in test_*.js; do
  printf '%-26s ' "$t"
  out=$(node "$t" 2>&1 | grep -v "Not implemented\|Could not load script")
  n=$(echo "$out" | grep -oE 'TOTAL ERRORS: [0-9]+' | grep -oE '[0-9]+$')
  if [ "$n" = "0" ]; then echo "pass"; else echo "FAIL ($n)"; echo "$out" | grep '^FAIL'; fail=1; fi
done
exit $fail
