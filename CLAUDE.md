# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` — install dependencies (only `/api` has any: `cheerio`, `firebase-admin`, `vitest`).
- `npm test` — runs the full vitest suite (all of `/api`). There is no lint or build script — the frontend is static files, nothing to build.
- `npm test -- <pattern>` — run a single test file, e.g. `npm test -- parse-invoice-photo`.
- The frontend (`index.html` + `js/*.js`) has no automated tests. Verify changes manually or with an ad-hoc Playwright script (`chromium.launch({ channel: 'chrome' })` — Playwright's own bundled Chromium doesn't run on this Mac's macOS 12/Monterey); such scripts are throwaway, not committed.
- A plain static server (`npx serve .` or `python3 -m http.server`) is enough to iterate on the frontend, but calls to `/api/*` won't resolve from it — those need `vercel dev` or a real deployment.
- Deploys are automatic: pushing to `main` triggers a Vercel build/deploy to `rastreador-precos-beta.vercel.app`. `vercel ls` shows recent deployment status.
- Firestore security rules (`firestore.rules`) are **not** part of the Vercel deploy — they must be pushed separately: `firebase deploy --only firestore:rules --project willian-rastreador-precos`.

## Architecture

**Static frontend, no framework, no build step.** `index.html` loads `js/*.js` as classic (non-module) `<script>` tags, in this order: `app-config.js` → `firebase-init.js` → `store.js` → `scanner.js` → `ui.js`. Because these are classic scripts sharing one global scope, a top-level `function` declared in one file is callable from any file loaded after it — there's no import system. Firebase is loaded via the `firebase-compat` CDN build (v10.8.0), not npm.

**Navigation without a router.** Every screen is a `<div class="screen" id="...">` block already present in `index.html`; `window.go(id)` (in `js/ui.js`) just toggles the `active` class and, for screens with dynamic content, calls that screen's `render*()` function. Adding a screen means: add the `<div>`, add its id to the `screens` array in `js/ui.js`, and add a branch in `go()` if it needs a render call on entry.

**One Firestore collection for every kind of expense.** Regardless of how an expense was captured — NFC-e QR scan, photo of a receipt/bill (Gemini), manual entry, manual fixed bill, or an imported credit-card invoice line — it becomes one doc in `users/{uid}/receipts/{chaveAcesso}` with the same shape (`storeName`, `emittedAt`, `totalValue`, `category`, `items[]`, plus a `source` tag). Every downstream screen (Histórico, Painel mensal, drill-down por categoria) reads that single collection. A new capture method should add fields to this shape rather than introduce a parallel collection.

**`emittedAt` (a `"dd/mm/yyyy hh:mm:ss"` string, not a Firestore Timestamp) controls which month an expense counts toward**, everywhere (`isReceiptInMonth` / `buildMonthlySpendingHistory` in `js/ui.js` parse it). This is exploited on purpose: a manually-entered fixed bill sets `emittedAt` to its due date rather than the date it was logged, so it lands in the right month even if entered early or late; invoice-imported installments compute one `emittedAt` per month offset the same way (see `computeInstallmentEmittedAt` in `js/store.js`).

**Categorization is two independent mechanisms that don't share logic**, and both matter when touching categories: (1) `categorizeStore`/`categorizeItems` regex rules in `js/store.js` run for NFC-e and photo-scanned receipts; (2) the Gemini prompt in `api/parse-invoice-photo.js` suggests a category directly per line when importing a card invoice. The category list itself (`window.EXPENSE_CATEGORIES` in `js/store.js`) is duplicated verbatim (`EXPENSE_CATEGORIES_LIST`) in `api/parse-invoice-photo.js` — the two run in different runtimes (browser vs. Node/Vercel) and can't import from each other, so keep them in sync by hand.

**`/api/*` (Vercel serverless functions) exists only for what the client can't do:** call Gemini (needs the secret `GEMINI_API_KEY`), scrape the SEFAZ-SP NFC-e consultation page (needs to run server-side to avoid CORS), and aggregate prices across *all* users for the community price index (needs `firebase-admin` with a service account — `db.collectionGroup(...)` — since the client Firestore SDK is scoped by security rules to the logged-in user's own data). Endpoints with real parsing/aggregation logic split it into `api/lib/*.js` so it's unit-testable without mocking `req`/`res` (see `parseSefazSp.js`, `aggregatePrices.js`, with HTML fixtures under `api/lib/__fixtures__/`); endpoints that mainly shape a Gemini prompt keep the logic inline in the handler (`parse-receipt-photo.js`, `parse-invoice-photo.js`).

**Design docs precede non-trivial features.** `docs/superpowers/specs/` holds the design/spec written before building a feature, `docs/superpowers/plans/` holds the resulting task-by-task implementation plan. Check these for the reasoning behind an existing feature before changing it.

**`aprendizados.md`** (repo root) is a running list of hard-won, codebase-specific lessons — Firestore `collectionGroup` aggregation without Cloud Functions, anonymizing community data by distinct-user count (not sample count), WebView rendering quirks for `<input type="date">`, CSS traps for aligning bar charts, and a reminder to confirm *which code path* produced a given piece of data before "fixing" a bug (this app has multiple independent entry points — manual, scan, photo/IA, invoice import — that don't necessarily share logic). Read it before debugging something that smells like a repeat, and add to it when you find something worth not rediscovering.

**This is a shared/multi-session scratch checkout, not necessarily the only place this repo is worked on.** Before committing, run `git fetch && git log HEAD..origin/main --oneline` — a past session pushed 27 commits from elsewhere in the time this checkout went unsynced, including a duplicate implementation of the same feature (see `aprendizados.md` #1).
