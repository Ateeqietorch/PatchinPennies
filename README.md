# PatchinPennies

A shared household finance tracker for Ateeq + Celeste (and Patches 🐱). Log income, expenses, transfers, and debt payments together; every dollar gets a job.

## Stack

Vanilla HTML/CSS/JS — no framework, no build step. Everything lives in a single `index.html`. All data is stored in the browser's `localStorage` (namespaced under `pp:*` keys) — there is no backend or account system, so it's entirely private to the device/browser it's used on.

Use Settings → App → **Export backup** now and then, since clearing browser data or switching devices/browsers will lose local data.

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

From the ＋ button, "Scan statement" lets you upload a photo of a bank/card statement. It calls the Claude API **directly from the browser** with your own Anthropic API key (Settings → App → Statement scanning) to extract line items as structured data, flags anything that looks like it's already logged in the app so you don't double-count it, and lets you review/edit every row before importing. The API key is stored in its own `localStorage` key, separate from everything else — it is never included in the JSON export/import backup.

`Code.gs` is a legacy Google Apps Script backend from an earlier version of this project and is no longer used by the app.
