# PatchinPennies

A shared household finance tracker for Ateeq + Celeste (and Patches 🐱). Log income, expenses, transfers, and debt payments together; every dollar gets a job.

## Stack

Vanilla HTML/CSS/JS — no framework, no build step. Everything lives in a single `index.html`.

**Google Sheets is the source of truth.** A Google Apps Script backend (`Code.gs`, deployed as a web app) reads and writes a shared spreadsheet, so both people's devices see the same data. `localStorage` is used as an **offline cache**: the app paints instantly from the last-synced snapshot, and any change you make while offline is queued (`pp:pendingWrites`) and replayed against the Sheet the moment you're back online — see the sync badge in the top bar (🟢 synced / 📴 offline, with a pending-change count). Settings → App → **Sync** shows connection status and lets you point at a different deployment URL if you ever redeploy your own copy of `Code.gs`.

The one exception is the Anthropic API key for statement scanning (below) and a manual "local snapshot" export/import under Settings → App, both of which are local-only by design.

## Structure

- **Home** — unallocated income for the month, budgets, credit card strip, recent activity
- **Money** — accounts, net worth, cash-flow Sankey diagram, spending trends
- **Goals** — debt payoff (snowball/avalanche) + savings goals with milestone celebrations
- **Recap** — monthly summary vs budget, net worth change, and the Money Date ritual
- **+ button** — quick add: Expense / Income / Move Money / Scan statement
- **Settings (gear icon)** — Accounts, Categories, Recurring, People, App

### Credit card model

The card has one sole cardholder (Ateeq). A charge queues silently against the card's balance and does **not** count as spending until the card is paid off. Paying it down settles the oldest queued charges first (FIFO); a full payoff clears everything to real spending at once.

### Scan statement (optional, bring-your-own API key)

From the ＋ button, "Scan statement" lets you upload one or more photos — a full statement, individual receipts, whatever — plus an optional free-text description (e.g. "this is the March Chase statement" or "the $40 charge on the 14th was a gift, categorize as Shopping"). It calls the Claude API **directly from the browser** with your own Anthropic API key (Settings → App → Statement scanning) to extract line items as structured data across all the photos at once, flags anything that looks like it's already logged in the app so you don't double-count it, and lets you review/edit every row before importing. The API key is stored in its own `localStorage` key, separate from everything else — it is never included in the JSON export/import backup.

### Backend (`Code.gs`)

Deployed via `clasp` (see `.clasp.json`). Exposes one GET-routed web app (`doGet`) with actions for transactions, income, goals, debts + payments, accounts + reconciliation, recurring bills, recurring investment/divestment flows, contributions, the credit-card charge queue, and categories/budgets. `setup()` is idempotent — safe to re-run any time — and creates/repairs sheets and columns without touching existing data; the app calls it once automatically (`?action=runSetup`) on a device's very first sync. Time-based triggers (`installTriggers()`) auto-log due recurring bills/flows and send a monthly recap email, entirely server-side — they run whether or not anyone has the app open, so recurring items are never double-logged across two people's devices.

Every `add*` endpoint accepts an optional client-supplied `id`; the client always generates one before writing, which is what makes offline queueing safe — no ID-reconciliation step is needed once a queued write finally lands.
