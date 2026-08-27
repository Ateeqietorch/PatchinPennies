# Tests

Headless jsdom harnesses that load the real `index.html`, stub `fetch` with a
fixture shaped like the live Google Sheet, and drive the app the way a person
would. No build step and no test framework — each file is plain Node.

```sh
npm install jsdom   # once
./tests/run.sh
```

| Suite | Covers |
| --- | --- |
| `test_ownership.js` | Per-person net worth, card debt attribution, scan payer defaults |
| `test_redesign.js` | Safe-to-spend math, bills vs everyday split, plan equation |
| `test_sync.js` | Offline queueing, replay on reconnect, cache fallback, API key never exported |
| `test_streaming_scan.js` | Statement scan streaming, truncation errors, model token limits |
| `test_twocards.js` | Two cards on one account, per-card owner attribution |
| `test_ux.js` | Input focus retention, progressive disclosure, quick add |
| `test_overhaul.js` | Category ranking + filter, Activity search/filters, attention system |

Two invariants every suite re-checks, because both have regressed before:
the Anthropic API key must never appear in an export payload, and the app must
never call `alert()` or `prompt()`.
