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
- **+ button** — quick add: Expense / Income / Move Money
- **Settings (gear icon)** — Accounts, Categories, Recurring, People, App

### Credit card model

The card has one sole cardholder (Ateeq). A charge queues silently against the card's balance and does **not** count as spending until the card is paid off. Paying it down settles the oldest queued charges first (FIFO); a full payoff clears everything to real spending at once.

`Code.gs` is a legacy Google Apps Script backend from an earlier version of this project and is no longer used by the app.
