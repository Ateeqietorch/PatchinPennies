#!/usr/bin/env bash
# Runs every suite. Each suite exits non-zero if it reported any error, so we
# trust the exit code rather than parsing stdout.
cd "$(dirname "$0")"
fail=0
for t in test_*.js; do
  printf '%-26s ' "$t"
  out=$(node "$t" 2>&1 | grep -v "Not implemented\|Could not load script")
  if [ $? -eq 0 ] && ! echo "$out" | grep -q '^FAIL'; then
    echo "pass  ($(echo "$out" | grep -c '^OK') checks)"
  else
    echo "FAIL"; echo "$out" | grep '^FAIL' | sed 's/^/    /'; fail=1
  fi
done
exit $fail
