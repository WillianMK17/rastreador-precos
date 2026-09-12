# Importação de Fatura de Cartão de Crédito — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user import a credit card invoice (PDF or photo), have Gemini extract and categorize every transaction, review/edit them, cancel duplicate individually-scanned receipts, and have installment purchases land in every month they're due.

**Architecture:** A new Vercel serverless endpoint (`api/parse-invoice-photo.js`, same pattern as the existing `api/parse-receipt-photo.js`) sends the file to Gemini and gets back a structured list of transactions. The client never auto-saves: it loads the user's existing receipts, flags likely duplicates, and shows an editable review screen. Only on explicit confirmation does it write to Firestore — reusing the existing `users/{uid}/receipts` collection (new `source: 'invoice'` docs, same shape everything else already reads) instead of a new collection, so every existing screen (Histórico, Painel mensal, drill-down por categoria) works unchanged.

**Tech Stack:** Vanilla JS (classic `<script>` tags, no build step, no ESM in `js/*`), Firebase client SDK (Auth + Firestore), Vercel serverless functions (ESM) under `/api`, Gemini `gemini-3.6-flash` via REST, `vitest` for `/api` unit tests.

**Spec:** `docs/superpowers/specs/2026-09-11-invoice-import-design.md`

## Global Constraints

- Reuse the `users/{uid}/receipts` Firestore collection — do not create a new collection or subcollection for invoices.
- `GEMINI_MODEL = 'gemini-3.6-flash'` (same model already used by `api/parse-receipt-photo.js`), same 30s timeout, same `AbortController` pattern.
- No new npm dependencies. `js/*.js` files are loaded as classic (non-module) `<script>` tags — never add `import`/`export` to them. `api/*.js` files are ESM (`"type": "module"` in `package.json`) and use `export default async function handler(req, res)`.
- The expense category list (`Mercado`, `Farmácia`, `Posto de Combustível`, `Bar/Restaurante`, `Contas Fixas`, `Pet`, `Vestuário`, `Assinaturas/Streaming`, `Delivery`, `Compras Online`, `Transporte/App`, `Outros`) must be identical, in the same order, in both `api/parse-invoice-photo.js` and `js/store.js` (`window.EXPENSE_CATEGORIES`) — they cannot import from each other (different runtimes), so keep them in sync by hand and note that in a comment at both definitions.
- Any new Firestore write must go through `window.auth`/`window.db`, exactly like existing `StoreModule` functions — reject with `Error('not-authenticated')` / `Error('firestore-unavailable')` when missing, matching the existing error-message contract other UI code already checks for (`err.message === 'not-authenticated'`).
- `chaveAcesso` values generated for invoice-derived receipts must be **deterministic** (a hash of stable inputs), never random — this is what prevents duplicate writes when the same invoice or the same future installment is imported twice.
- Before your first commit in this plan, run `git fetch origin && git log HEAD..origin/main --oneline` in the repo root; if it prints anything, stop and reconcile before continuing (this scratch checkout has diverged from `origin/main` before — see `aprendizados.md`).

---

### Task 1: `parse-invoice-photo` Gemini endpoint + category taxonomy

**Files:**
- Create: `api/parse-invoice-photo.js`
- Create: `api/parse-invoice-photo.test.js`
- Modify: `js/store.js` (add `window.EXPENSE_CATEGORIES` near `window.CATEGORY_RULES`, around line 84)

**Interfaces:**
- Produces: `POST /api/parse-invoice-photo` — request body `{ fileBase64: string, mimeType: string }` (mimeType may be `image/*` or `application/pdf`); response `{ ok: true, transactions: [{ date, description, value, type, installmentCurrent, installmentTotal, suggestedCategory }] }` or `{ ok: false, reason: 'invoice-not-recognized' }` or `{ error: string }` with a non-200 status. `type` is always one of `'purchase' | 'payment' | 'fee' | 'previous_balance'`. `installmentCurrent`/`installmentTotal` are `number | null`. `suggestedCategory` is always one of the 12 categories below (never a free string).
- Produces: `window.EXPENSE_CATEGORIES` — a plain array of 12 category-name strings, read by later tasks (the review screen's dropdown and `importInvoiceTransactions`'s default-category fallback).

- [ ] **Step 1: Write the failing tests**

Create `api/parse-invoice-photo.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from './parse-invoice-photo.js';

function mockReqRes(method, body) {
  const req = { method, body };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
  return { req, res };
}

function mockGeminiResponse(jsonText) {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: jsonText }] } }]
    })
  };
}

describe('POST /api/parse-invoice-photo', () => {
  const originalKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.GEMINI_API_KEY = 'test-key';
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalKey;
  });

  it('rejeita métodos diferentes de POST', async () => {
    const { req, res } = mockReqRes('GET', {});
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  it('rejeita corpo sem arquivo', async () => {
    const { req, res } = mockReqRes('POST', {});
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_request' });
  });

  it('retorna erro quando a chave do Gemini não está configurada', async () => {
    delete process.env.GEMINI_API_KEY;
    const { req, res } = mockReqRes('POST', { fileBase64: 'abc', mimeType: 'application/pdf' });
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'gemini_not_configured' });
  });

  it('retorna gemini_unreachable quando o fetch falha', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const { req, res } = mockReqRes('POST', { fileBase64: 'abc', mimeType: 'application/pdf' });
    await handler(req, res);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'gemini_unreachable' });
  });

  it('retorna ok:false quando o Gemini não reconhece uma fatura', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockGeminiResponse('{"found":false,"transactions":[]}'));
    const { req, res } = mockReqRes('POST', { fileBase64: 'abc', mimeType: 'image/jpeg' });
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: false, reason: 'invoice-not-recognized' });
  });

  it('aceita application/pdf e retorna as transações extraídas', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockGeminiResponse(JSON.stringify({
      found: true,
      transactions: [
        { date: '05/09/2026', description: 'MP*IFOOD', value: 42.9, type: 'purchase', installmentCurrent: null, installmentTotal: null, suggestedCategory: 'Delivery' },
        { date: '10/09/2026', description: 'PAGAMENTO RECEBIDO', value: 500, type: 'payment', installmentCurrent: null, installmentTotal: null, suggestedCategory: 'Outros' },
        { date: '12/09/2026', description: 'MAGAZINE LUIZA 2/6', value: 89.9, type: 'purchase', installmentCurrent: 2, installmentTotal: 6, suggestedCategory: 'Compras Online' }
      ]
    })));
    const { req, res } = mockReqRes('POST', { fileBase64: 'abc', mimeType: 'application/pdf' });
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.transactions).toHaveLength(3);
    expect(res.body.transactions[0]).toEqual({
      date: '05/09/2026', description: 'MP*IFOOD', value: 42.9, type: 'purchase',
      installmentCurrent: null, installmentTotal: null, suggestedCategory: 'Delivery'
    });
    expect(res.body.transactions[2].installmentCurrent).toBe(2);
    expect(res.body.transactions[2].installmentTotal).toBe(6);
  });

  it('normaliza type e suggestedCategory inválidos em vez de quebrar', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockGeminiResponse(JSON.stringify({
      found: true,
      transactions: [
        { date: '01/09/2026', description: 'LOJA DESCONHECIDA', value: 10, type: 'algo-invalido', suggestedCategory: 'Categoria Que Não Existe' }
      ]
    })));
    const { req, res } = mockReqRes('POST', { fileBase64: 'abc', mimeType: 'image/jpeg' });
    await handler(req, res);
    expect(res.body.transactions[0].type).toBe('purchase');
    expect(res.body.transactions[0].suggestedCategory).toBe('Outros');
    expect(res.body.transactions[0].installmentCurrent).toBe(null);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- parse-invoice-photo`
Expected: FAIL — `Cannot find module './parse-invoice-photo.js'` (file doesn't exist yet).

- [ ] **Step 3: Implement the endpoint**

Create `api/parse-invoice-photo.js`:

```js
const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Precisa ficar idêntica, na mesma ordem, a window.EXPENSE_CATEGORIES em js/store.js —
// os dois arquivos rodam em runtimes diferentes (serverless vs navegador) e não
// podem importar um do outro.
const EXPENSE_CATEGORIES_LIST = [
  'Mercado', 'Farmácia', 'Posto de Combustível', 'Bar/Restaurante', 'Contas Fixas',
  'Pet', 'Vestuário', 'Assinaturas/Streaming', 'Delivery', 'Compras Online',
  'Transporte/App', 'Outros'
];

const VALID_TYPES = ['purchase', 'payment', 'fee', 'previous_balance'];

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          description: { type: 'string' },
          value: { type: 'number' },
          type: { type: 'string' },
          installmentCurrent: { type: 'number' },
          installmentTotal: { type: 'number' },
          suggestedCategory: { type: 'string' }
        },
        required: ['date', 'description', 'value', 'type']
      }
    }
  },
  required: ['found', 'transactions']
};

const PROMPT = `Você está lendo uma fatura de cartão de crédito brasileira, em PDF ou foto.
Extraia TODOS os lançamentos listados, exatamente como aparecem impressos, sem inventar nada.
Se o documento não for uma fatura de cartão de crédito legível, retorne found:false e transactions:[].

Para cada lançamento, extraia:
- date: data no formato dd/mm/aaaa
- description: a descrição exatamente como impressa (ex: "MP*IFOOD", "NETFLIX.COM")
- value: valor do lançamento, sempre positivo (mesmo que a fatura mostre estorno/crédito
  com sinal negativo — nesse caso classifique como type "payment")
- type: "purchase" para uma compra normal; "payment" para pagamento recebido, crédito
  ou estorno; "previous_balance" para saldo de fatura anterior; "fee" para juros, IOF,
  multa ou anuidade
- installmentCurrent e installmentTotal: quando a descrição indicar parcelamento
  (ex: "1/3", "02/06", "PARC 3/10"), extraia os dois números. Quando não houver
  indicação de parcelamento, deixe os dois como null.
- suggestedCategory: escolha UMA destas categorias, a que melhor combina com a
  descrição do lançamento: ${EXPENSE_CATEGORIES_LIST.join(', ')}. Se nenhuma combinar
  bem, use "Outros".

Nunca invente um valor que não esteja legível no documento.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'gemini_not_configured' });
  }

  const { fileBase64, mimeType } = req.body || {};
  if (!fileBase64 || !mimeType) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  let geminiResponse;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    geminiResponse = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: PROMPT },
            { inline_data: { mime_type: mimeType, data: fileBase64 } }
          ]
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA
        }
      })
    });
    clearTimeout(timeout);
  } catch {
    return res.status(502).json({ error: 'gemini_unreachable' });
  }

  if (!geminiResponse.ok) {
    return res.status(502).json({ error: 'gemini_unreachable' });
  }

  let geminiJson;
  try {
    geminiJson = await geminiResponse.json();
  } catch {
    return res.status(502).json({ error: 'gemini_invalid_response' });
  }

  const text = geminiJson &&
    geminiJson.candidates &&
    geminiJson.candidates[0] &&
    geminiJson.candidates[0].content &&
    geminiJson.candidates[0].content.parts &&
    geminiJson.candidates[0].content.parts[0] &&
    geminiJson.candidates[0].content.parts[0].text;

  if (!text) {
    return res.status(502).json({ error: 'gemini_invalid_response' });
  }

  let extracted;
  try {
    extracted = JSON.parse(text);
  } catch {
    return res.status(502).json({ error: 'gemini_invalid_response' });
  }

  if (!extracted.found || !extracted.transactions || extracted.transactions.length === 0) {
    return res.status(200).json({ ok: false, reason: 'invoice-not-recognized' });
  }

  return res.status(200).json({
    ok: true,
    transactions: extracted.transactions.map(t => ({
      date: t.date || '',
      description: t.description || '',
      value: t.value || 0,
      type: VALID_TYPES.includes(t.type) ? t.type : 'purchase',
      installmentCurrent: t.installmentCurrent || null,
      installmentTotal: t.installmentTotal || null,
      suggestedCategory: EXPENSE_CATEGORIES_LIST.includes(t.suggestedCategory) ? t.suggestedCategory : 'Outros'
    }))
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- parse-invoice-photo`
Expected: PASS (7 tests).

- [ ] **Step 5: Add the shared category list to `js/store.js`**

In `js/store.js`, right after the closing `];` of `window.CATEGORY_RULES` (before `function categorizeStore`), add:

```js
// Precisa ficar idêntica, na mesma ordem, a EXPENSE_CATEGORIES_LIST em
// api/parse-invoice-photo.js — os dois arquivos rodam em runtimes diferentes
// (navegador vs serverless) e não podem importar um do outro.
window.EXPENSE_CATEGORIES = [
  'Mercado', 'Farmácia', 'Posto de Combustível', 'Bar/Restaurante', 'Contas Fixas',
  'Pet', 'Vestuário', 'Assinaturas/Streaming', 'Delivery', 'Compras Online',
  'Transporte/App', 'Outros'
];
```

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS (all existing suites plus the new one — no regressions).

- [ ] **Step 7: Commit**

```bash
git add api/parse-invoice-photo.js api/parse-invoice-photo.test.js js/store.js
git commit -m "$(cat <<'EOF'
Adiciona endpoint Gemini pra ler fatura de cartão (PDF/foto)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Deterministic IDs and duplicate-matching helpers in `js/store.js`

**Files:**
- Modify: `js/store.js`

**Interfaces:**
- Consumes: nothing new (pure functions over plain data).
- Produces (all top-level functions in `js/store.js`, not attached to `window` — same visibility pattern as the existing `categorizeStore`/`normalizeProductName`, which the browser still exposes globally for classic scripts): `hashString(text: string): string`, `parseDateToTimestamp(ddmmyyyy: string): number | null`, `computeInvoiceChaveAcesso(cardName: string, description: string, date: string, value: number): string`, `computeInstallmentGroupId(cardName: string, description: string, value: number, installmentTotal: number): string`, `computeInstallmentEmittedAt(invoiceDateStr: string, monthOffset: number): string`, `findDuplicateReceiptCandidate(transaction: {date, value}, receipts: array): object | null`. Task 3 and Task 6 call these directly by name.

- [ ] **Step 1: Add the functions**

In `js/store.js`, right after `function categorizeReceipt(...)` (before `function normalizeProductName`), add:

```js
// Hash não-criptográfico (djb2) só pra virar um sufixo curto e determinístico
// de chaveAcesso — o mesmo texto de entrada sempre produz o mesmo hash, o que
// é o que evita duplicar um lançamento de fatura reimportado.
function hashString(text) {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function parseDateToTimestamp(ddmmyyyy) {
  const m = (ddmmyyyy || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd)).getTime();
}

function computeInvoiceChaveAcesso(cardName, description, date, value) {
  return 'fatura-' + hashString(cardName + '|' + description + '|' + date + '|' + value);
}

function computeInstallmentGroupId(cardName, description, value, installmentTotal) {
  return 'parcela-' + hashString(cardName + '|' + description + '|' + value + '|' + installmentTotal);
}

// mês da fatura + monthOffset meses (0 = mesmo mês; o overflow de mês do
// próprio Date cuida da virada de ano, ex: mês 12 + 2 -> fevereiro do ano seguinte)
function computeInstallmentEmittedAt(invoiceDateStr, monthOffset) {
  const m = (invoiceDateStr || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const base = new Date(Number(yyyy), Number(mm) - 1 + monthOffset, Number(dd));
  const pad = n => String(n).padStart(2, '0');
  return pad(base.getDate()) + '/' + pad(base.getMonth() + 1) + '/' + base.getFullYear() + ' 12:00:00';
}

// Candidato a duplicata: um recibo já existente (não vindo de fatura) com
// valor quase igual (tolerância de 2 centavos, por arredondamento) e data
// dentro de 5 dias do lançamento da fatura. Só sugere — nunca decide sozinho.
function findDuplicateReceiptCandidate(transaction, receipts) {
  const transactionTimestamp = parseDateToTimestamp(transaction.date);
  if (transactionTimestamp === null) return null;
  const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;
  const valueTolerance = 0.02;

  return receipts.find(function(receipt) {
    if (receipt.source === 'invoice') return false;
    const receiptTimestamp = parseDateToTimestamp(receipt.emittedAt);
    if (receiptTimestamp === null) return false;
    const valueMatches = Math.abs((receipt.totalValue || 0) - transaction.value) <= valueTolerance;
    const dateMatches = Math.abs(receiptTimestamp - transactionTimestamp) <= fiveDaysMs;
    return valueMatches && dateMatches;
  }) || null;
}
```

- [ ] **Step 2: Manual verification in the browser console**

Run: `npx serve .` (from the repo root) in one terminal, then open `http://localhost:3000` in a browser and open devtools console. Paste:

```js
hashString('a') === hashString('a')  // deve ser true (determinístico)
computeInvoiceChaveAcesso('Nubank', 'MP*IFOOD', '05/09/2026', 42.9) ===
  computeInvoiceChaveAcesso('Nubank', 'MP*IFOOD', '05/09/2026', 42.9)  // true
computeInstallmentEmittedAt('15/12/2026', 2)  // "15/02/2027 12:00:00" (virada de ano)
findDuplicateReceiptCandidate(
  { date: '05/09/2026', value: 42.9 },
  [{ source: 'photo', totalValue: 42.9, emittedAt: '03/09/2026 12:00:00' }]
)  // deve retornar o objeto do recibo (data 2 dias antes, valor igual)
findDuplicateReceiptCandidate(
  { date: '05/09/2026', value: 42.9 },
  [{ source: 'photo', totalValue: 42.9, emittedAt: '20/09/2026 12:00:00' }]
)  // deve retornar null (mais de 5 dias de diferença)
```

Expected: all five results match the comments above.

- [ ] **Step 3: Commit**

```bash
git add js/store.js
git commit -m "$(cat <<'EOF'
Adiciona helpers de hash determinístico e dedup pra import de fatura

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `StoreModule.importInvoiceTransactions` (Firestore batch write)

**Files:**
- Modify: `js/store.js`

**Interfaces:**
- Consumes: `computeInvoiceChaveAcesso`, `computeInstallmentGroupId`, `computeInstallmentEmittedAt` (Task 2), `normalizeProductName` (already existing in this file).
- Produces: `window.StoreModule.importInvoiceTransactions(transactions, cardName): Promise<{ created: number, canceled: number, skipped: number }>`, where each item of `transactions` is `{ date, description, value, installmentCurrent, installmentTotal, category, cancelDuplicateReceiptId }` (`installmentCurrent`/`installmentTotal`/`cancelDuplicateReceiptId` may be `null`). Rejects with `Error('not-authenticated')` or `Error('firestore-unavailable')`, matching every other `StoreModule` function.

- [ ] **Step 1: Add the function**

In `js/store.js`, inside the `window.StoreModule = { ... }` object, add a new method after `updateReceiptCategory` (before `recategorizeAllReceipts`):

```js
  importInvoiceTransactions: function(transactions, cardName) {
    if (!window.auth || !window.auth.currentUser) {
      return Promise.reject(new Error('not-authenticated'));
    }
    if (!window.db) {
      return Promise.reject(new Error('firestore-unavailable'));
    }
    const uid = window.auth.currentUser.uid;
    const receiptsRef = window.db.collection('users').doc(uid).collection('receipts');

    function makeItems(description, value) {
      return [{ description: description, code: '', quantity: 1, unit: 'un', unitPrice: value, totalPrice: value }]
        .map(item => Object.assign({}, item, { matchKey: normalizeProductName(item.description) }));
    }

    const docsToCreate = [];
    transactions.forEach(function(transaction) {
      const installmentTotal = transaction.installmentTotal || 1;
      const installmentCurrent = transaction.installmentCurrent || 1;
      const category = transaction.category || 'Outros';

      if (installmentTotal <= 1) {
        docsToCreate.push({
          chaveAcesso: computeInvoiceChaveAcesso(cardName, transaction.description, transaction.date, transaction.value),
          data: {
            storeName: transaction.description,
            storeCnpj: '',
            storeAddress: '',
            emittedAt: transaction.date + ' 12:00:00',
            totalValue: transaction.value,
            itemsAvailable: true,
            source: 'invoice',
            cardName: cardName,
            category: category,
            categoryManuallySet: true,
            items: makeItems(transaction.description, transaction.value)
          }
        });
      } else {
        const installmentGroupId = computeInstallmentGroupId(cardName, transaction.description, transaction.value, installmentTotal);
        for (let n = installmentCurrent; n <= installmentTotal; n++) {
          docsToCreate.push({
            chaveAcesso: installmentGroupId + '-p' + n,
            data: {
              storeName: transaction.description + ' (' + n + '/' + installmentTotal + ')',
              storeCnpj: '',
              storeAddress: '',
              emittedAt: computeInstallmentEmittedAt(transaction.date, n - installmentCurrent),
              totalValue: transaction.value,
              itemsAvailable: true,
              source: 'invoice',
              cardName: cardName,
              category: category,
              categoryManuallySet: true,
              installmentGroupId: installmentGroupId,
              installmentIndex: n,
              installmentTotal: installmentTotal,
              items: makeItems(transaction.description, transaction.value)
            }
          });
        }
      }
    });

    const cancelIds = transactions
      .filter(function(t) { return t.cancelDuplicateReceiptId; })
      .map(function(t) { return t.cancelDuplicateReceiptId; });

    // Firestore batches só fazem escrita — a checagem de "já existe" (o que
    // evita duplicar fatura reimportada ou parcela já lançada) precisa ser
    // lida antes de montar o batch.
    return Promise.all(docsToCreate.map(function(entry) {
      return receiptsRef.doc(entry.chaveAcesso).get().then(function(snapshot) {
        return { entry: entry, exists: snapshot.exists };
      });
    })).then(function(checked) {
      const batch = window.db.batch();
      let createdCount = 0;

      checked.forEach(function(checkedEntry) {
        if (checkedEntry.exists) return;
        batch.set(receiptsRef.doc(checkedEntry.entry.chaveAcesso), Object.assign({}, checkedEntry.entry.data, {
          city: window.AppState.profileCity || '',
          citySlug: window.AppState.profileCitySlug || '',
          scannedAt: firebase.firestore.FieldValue.serverTimestamp()
        }));
        createdCount++;
      });

      cancelIds.forEach(function(id) {
        batch.delete(receiptsRef.doc(id));
      });

      return batch.commit().then(function() {
        return { created: createdCount, canceled: cancelIds.length, skipped: docsToCreate.length - createdCount };
      });
    });
  },
```

- [ ] **Step 2: Manual verification against Firestore**

This needs a real logged-in Google account (guest mode has no Firestore) — run this from the app itself, logged in, via the browser console:

```js
window.StoreModule.importInvoiceTransactions([
  { date: '01/09/2026', description: 'TESTE PLANO IMPLEMENTACAO', value: 12.34, installmentCurrent: null, installmentTotal: null, category: 'Outros', cancelDuplicateReceiptId: null },
  { date: '01/09/2026', description: 'TESTE PARCELADO PLANO', value: 50, installmentCurrent: 1, installmentTotal: 3, category: 'Compras Online', cancelDuplicateReceiptId: null }
], 'Cartão Teste').then(console.log);
```

Expected: logs `{ created: 4, canceled: 0, skipped: 0 }` (1 doc for the single purchase + 3 installment docs). Then run `window.StoreModule.loadReceipts().then(r => console.log(r.filter(x => x.cardName === 'Cartão Teste')))` — expect 4 receipts, three of them sharing an `installmentGroupId` with `installmentIndex` 1, 2, 3 and `emittedAt` in September, October and November 2026 respectively. Re-run the same `importInvoiceTransactions(...)` call a second time — expect `{ created: 0, canceled: 0, skipped: 4 }` (no duplicates created). Clean up afterward: delete the 4 test receipts from the Histórico screen (🗑️ button) so they don't pollute real data.

- [ ] **Step 3: Commit**

```bash
git add js/store.js
git commit -m "$(cat <<'EOF'
Adiciona StoreModule.importInvoiceTransactions (batch write + dedup)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `ScannerModule.scanInvoiceFile`

**Files:**
- Modify: `js/scanner.js`

**Interfaces:**
- Consumes: `this._fileToBase64` (already exists in `ScannerModule`), `/api/parse-invoice-photo` (Task 1).
- Produces: `window.ScannerModule.scanInvoiceFile(file, cardName): Promise<Array<{date, description, value, type, installmentCurrent, installmentTotal, suggestedCategory}>>`. Resolves to `[]` (never rejects on a recognized-but-empty result) when Gemini doesn't find an invoice; only rejects on a file-read failure.

- [ ] **Step 1: Add the function**

In `js/scanner.js`, inside `window.ScannerModule = { ... }`, add a new method after `scanReceiptPhoto` (before `_fileToBase64`):

```js
  scanInvoiceFile: async function(file, cardName) {
    if (!file) return [];

    await this.stopScanner();

    let fileBase64;
    try {
      fileBase64 = await this._fileToBase64(file);
    } catch (err) {
      console.error("Erro ao ler o arquivo da fatura:", err);
      throw new Error('file-read-failed');
    }

    let apiResult;
    try {
      const response = await fetch('/api/parse-invoice-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileBase64, mimeType: file.type || 'application/pdf' })
      });
      apiResult = await response.json();
    } catch (err) {
      console.error("Erro ao enviar fatura para leitura:", err);
      throw new Error('invoice-request-failed');
    }

    if (!apiResult || apiResult.ok !== true) {
      return [];
    }
    return apiResult.transactions;
  },
```

- [ ] **Step 2: Manual verification**

Run: `npx serve .` from the repo root, open the app in a browser, log in (or use guest mode — this step doesn't touch Firestore), open devtools console on the `scan` screen, and paste (this bypasses the real file input, calling the function directly with a fake `File`):

```js
const fakeFile = new File([new Uint8Array([1,2,3])], 'fatura.pdf', { type: 'application/pdf' });
window.ScannerModule.scanInvoiceFile(fakeFile, 'Nubank').then(console.log).catch(console.error);
```

Expected: a network request to `/api/parse-invoice-photo` fires (visible in the Network tab) and the promise resolves — either to `[]` (if `/api` isn't reachable from a plain static server, since Vercel functions need `vercel dev` or a deployment) or to a transactions array if you ran this against a deployed/`vercel dev` origin instead. Either way, confirm no uncaught exception and that the function returns a Promise resolving to an array, not throwing, when the file itself is readable.

- [ ] **Step 3: Commit**

```bash
git add js/scanner.js
git commit -m "$(cat <<'EOF'
Adiciona ScannerModule.scanInvoiceFile

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Upload UI + review screen skeleton (HTML/CSS)

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `js/ui.js` (only the `screens` array, line 36)

**Interfaces:**
- Consumes: nothing yet (wiring happens in Task 6).
- Produces: a file input + button on the `#scan` screen calling `window.startInvoiceImport(file)` (defined in Task 6); a new `<div class="screen" id="invoice-review">` with an empty `#invoice-review-container`; `'invoice-review'` added to the `screens` navigation array so `go('invoice-review')` works.

- [ ] **Step 1: Add the upload button to the scan screen**

In `index.html`, inside `<div class="screen" id="scan">`, right after the existing "🧾 QR não leu? Foto do cupom inteiro" button and its `<p class="subtitle">` (currently ending at line 359), add:

```html
        <input type="file" accept="application/pdf,image/*" id="invoice-file-input" style="display:none;" onchange="window.startInvoiceImport(this.files[0]); this.value='';">
        <button class="btn-cta" style="max-width:320px; margin:8px auto 0; background:transparent; border:1px solid var(--card-border); color:var(--text-main);" onclick="document.getElementById('invoice-file-input').click()">
          💳 Importar fatura do cartão (PDF ou foto)
        </button>
```

- [ ] **Step 2: Add the review screen**

In `index.html`, right after the closing `</div>` of `<div class="screen" id="manual">` (currently line 429, right before `<!-- ===== SCREEN 5: HISTORY ===== -->`), add:

```html
    <!-- ===== SCREEN: INVOICE REVIEW ===== -->
    <div class="screen" id="invoice-review">
      <button style="background:none; border:none; color:var(--text-muted); font-family:var(--font-mono); font-size:12px; cursor:pointer; margin-bottom:12px;" onclick="go('scan')">← voltar ao scanner</button>
      <div class="eyebrow">Revisar Fatura</div>
      <h1 class="big-title">Confira os lançamentos</h1>
      <p class="subtitle">Desmarque o que não for despesa, ajuste categorias e confirme prováveis duplicatas antes de importar.</p>

      <div id="invoice-review-container" style="max-width:500px; margin:0 auto;"></div>

      <div class="app-legal-footer">
        Desenvolvido por <a href="https://augefw.com" target="_blank" rel="noopener">augefw.com</a><br>
        © 2026 AugeFW. Todos os direitos reservados.
      </div>
    </div>
```

- [ ] **Step 3: Register the screen in navigation**

In `js/ui.js` line 36, change:

```js
const screens = ['landing','auth','home','consent','scan','manual','history','compare','list','list-result','stock','month-detail','category-detail','analysis'];
```

to:

```js
const screens = ['landing','auth','home','consent','scan','manual','history','compare','list','list-result','stock','month-detail','category-detail','analysis','invoice-review'];
```

- [ ] **Step 4: Add the category-select styling**

In `styles.css`, right after the `.cat-chip.active { ... }` block (around line 1012), add:

```css
.invoice-category-select {
  width: 100%;
  margin-top: 8px;
  padding: 8px 10px;
  background: transparent;
  border: 1px solid var(--card-border);
  border-radius: 8px;
  color: var(--text-main);
  font-family: var(--font-main);
  font-size: 13px;
  color-scheme: dark;
}

[data-theme="light"] .invoice-category-select {
  color-scheme: light;
}
```

- [ ] **Step 5: Manual verification**

Run: `npx serve .` from the repo root, open the app in a browser. Navigate (login or guest) to the scanner screen — confirm the new "💳 Importar fatura do cartão" button renders below the existing cupom-photo button, styled the same way. In devtools console run `go('invoice-review')` — confirm the screen becomes visible with the title "Confira os lançamentos" and an empty container, and that the back button returns to `scan`.

- [ ] **Step 6: Commit**

```bash
git add index.html styles.css js/ui.js
git commit -m "$(cat <<'EOF'
Adiciona botão de importar fatura e tela de revisão (esqueleto)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Review screen rendering + confirm/import flow

**Files:**
- Modify: `js/ui.js`

**Interfaces:**
- Consumes: `findDuplicateReceiptCandidate` (Task 2), `window.StoreModule.loadReceipts`/`importInvoiceTransactions` (Task 3), `window.ScannerModule.scanInvoiceFile` (Task 4), `window.EXPENSE_CATEGORIES` (Task 1), `formatBRL`/`escapeHtml`/`escapeAttr` (already in this file), `showScanMessage` (already global from `js/firebase-init.js`), the `#invoice-review-container` element and `go()` dispatch (Task 5).
- Produces: `window.startInvoiceImport(file)`, `window.toggleInvoiceRowIncluded(id, checked)`, `window.setInvoiceRowCategory(id, category)`, `window.toggleInvoiceRowCancelDuplicate(id, checked)`, `window.confirmInvoiceImport()`, and the internal `renderInvoiceReview()` dispatched from `go()`. Also sets `window.PendingInvoiceImport` as the review screen's working state — shape: `{ cardName: string, rows: Array<{ id, date, description, value, type, installmentCurrent, installmentTotal, category, included, duplicateReceiptId, duplicateReceiptLabel, cancelDuplicate }> }`.

- [ ] **Step 1: Wire `invoice-review` into the `go()` dispatcher**

In `js/ui.js`, in the `window.go` function, add a branch right after the `else if (id === 'list-result') { ... }` block (around line 85):

```js
  } else if (id === 'invoice-review') {
    renderInvoiceReview();
    if (window.ScannerModule) window.ScannerModule.stopScanner();
```

- [ ] **Step 2: Add `startInvoiceImport`, `renderInvoiceReview`, and the row-editing handlers**

In `js/ui.js`, add this block right after `window.editReceiptCategory` finishes (after the closing of that function, which currently ends the file's category-editing section):

```js
window.startInvoiceImport = function(file) {
  const cardName = prompt('Nome do cartão (ex: Nubank, Itaú):');
  if (!cardName || !cardName.trim()) return;

  showScanMessage('Fatura recebida! Lendo os lançamentos com IA...', 'success');

  window.ScannerModule.scanInvoiceFile(file, cardName.trim()).then(function(transactions) {
    if (!transactions || transactions.length === 0) {
      showScanMessage('Não conseguimos identificar lançamentos nessa fatura. Tente uma foto/PDF mais nítido.', 'error');
      return;
    }
    return window.StoreModule.loadReceipts().then(function(receipts) {
      window.PendingInvoiceImport = {
        cardName: cardName.trim(),
        rows: transactions.map(function(t, i) {
          const duplicate = t.type === 'purchase' ? findDuplicateReceiptCandidate(t, receipts) : null;
          return {
            id: i,
            date: t.date,
            description: t.description,
            value: t.value,
            type: t.type,
            installmentCurrent: t.installmentCurrent,
            installmentTotal: t.installmentTotal,
            category: t.suggestedCategory || 'Outros',
            included: t.type === 'purchase' || t.type === 'fee',
            duplicateReceiptId: duplicate ? duplicate.id : null,
            duplicateReceiptLabel: duplicate ? ((duplicate.storeName || 'recibo') + ' em ' + (duplicate.emittedAt || '').slice(0, 10)) : null,
            cancelDuplicate: !!duplicate
          };
        })
      };
      window.go('invoice-review');
    });
  }).catch(function(err) {
    console.error('Erro ao ler fatura:', err);
    showScanMessage('Não conseguimos ler essa fatura agora. Tente de novo.', 'error');
  });
};

function renderInvoiceReview() {
  const container = document.getElementById('invoice-review-container');
  const pending = window.PendingInvoiceImport;
  if (!container || !pending) return;

  container.innerHTML = `
    <div class="item-meta" style="margin-bottom:10px;">Cartão: <b>${escapeHtml(pending.cardName)}</b> · ${pending.rows.length} lançamentos encontrados</div>
    ${pending.rows.map(function(row) {
      return `
      <div class="receipt-card" style="margin-bottom:10px;">
        <div class="item-row">
          <label style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
            <input type="checkbox" ${row.included ? 'checked' : ''} onchange="window.toggleInvoiceRowIncluded(${row.id}, this.checked)">
            <div style="min-width:0;">
              <div class="item-name">${escapeHtml(row.description)}${row.installmentTotal ? ' <span style="opacity:.6;">(' + row.installmentCurrent + '/' + row.installmentTotal + ')</span>' : ''}</div>
              <div class="item-meta">${escapeHtml(row.date)}</div>
            </div>
          </label>
          <div style="font-family:var(--font-mono); font-weight:700; font-size:15px; flex-shrink:0;">${formatBRL(row.value)}</div>
        </div>
        <select class="invoice-category-select" onchange="window.setInvoiceRowCategory(${row.id}, this.value)">
          ${window.EXPENSE_CATEGORIES.map(function(cat) {
            return '<option value="' + escapeAttr(cat) + '"' + (cat === row.category ? ' selected' : '') + '>' + escapeHtml(cat) + '</option>';
          }).join('')}
        </select>
        ${row.duplicateReceiptId ? `
        <label class="item-meta" style="display:flex; align-items:center; gap:8px; margin-top:8px; padding-top:8px; border-top:1px dashed var(--card-border);">
          <input type="checkbox" ${row.cancelDuplicate ? 'checked' : ''} onchange="window.toggleInvoiceRowCancelDuplicate(${row.id}, this.checked)">
          ⚠️ possível duplicata de "${escapeHtml(row.duplicateReceiptLabel)}" — cancelar o lançamento individual
        </label>
        ` : ''}
      </div>
    `;
    }).join('')}
    <button class="btn-cta" style="max-width:500px; margin:16px auto 0;" onclick="window.confirmInvoiceImport()">Confirmar importação</button>
  `;
}

window.toggleInvoiceRowIncluded = function(id, checked) {
  const row = window.PendingInvoiceImport.rows.find(function(r) { return r.id === id; });
  if (row) row.included = checked;
};

window.setInvoiceRowCategory = function(id, category) {
  const row = window.PendingInvoiceImport.rows.find(function(r) { return r.id === id; });
  if (row) row.category = category;
};

window.toggleInvoiceRowCancelDuplicate = function(id, checked) {
  const row = window.PendingInvoiceImport.rows.find(function(r) { return r.id === id; });
  if (row) row.cancelDuplicate = checked;
};

window.confirmInvoiceImport = function() {
  const pending = window.PendingInvoiceImport;
  if (!pending) return;

  const included = pending.rows.filter(function(r) { return r.included; });
  if (included.length === 0) {
    alert('Marque ao menos um lançamento para importar.');
    return;
  }

  const transactions = included.map(function(r) {
    return {
      date: r.date,
      description: r.description,
      value: r.value,
      installmentCurrent: r.installmentCurrent,
      installmentTotal: r.installmentTotal,
      category: r.category,
      cancelDuplicateReceiptId: r.cancelDuplicate ? r.duplicateReceiptId : null
    };
  });

  window.StoreModule.importInvoiceTransactions(transactions, pending.cardName).then(function(result) {
    window.PendingInvoiceImport = null;
    alert('Fatura importada: ' + result.created + ' lançamento(s) novo(s), ' + result.canceled + ' recibo(s) cancelado(s), ' + result.skipped + ' já existiam.');
    window.go('history');
  }).catch(function(err) {
    if (err.message === 'not-authenticated') {
      alert('Entre com sua conta Google para importar a fatura.');
    } else {
      console.error('Erro ao importar fatura:', err);
      alert('Houve um erro ao importar a fatura.');
    }
  });
};
```

- [ ] **Step 3: Manual verification — rendering and row interaction (no network, no auth needed)**

Run: `npx serve .`, open the app, open devtools console, and paste this to populate the review screen without needing a real Gemini call:

```js
window.PendingInvoiceImport = {
  cardName: 'Nubank',
  rows: [
    { id: 0, date: '05/09/2026', description: 'MP*IFOOD', value: 42.9, type: 'purchase', installmentCurrent: null, installmentTotal: null, category: 'Delivery', included: true, duplicateReceiptId: null, duplicateReceiptLabel: null, cancelDuplicate: false },
    { id: 1, date: '12/09/2026', description: 'MAGAZINE LUIZA', value: 89.9, type: 'purchase', installmentCurrent: 2, installmentTotal: 6, category: 'Compras Online', included: true, duplicateReceiptId: 'fake-id-123', duplicateReceiptLabel: 'Magazine Luiza em 10/09/2026', cancelDuplicate: true },
    { id: 2, date: '10/09/2026', description: 'PAGAMENTO RECEBIDO', value: 500, type: 'payment', installmentCurrent: null, installmentTotal: null, category: 'Outros', included: false, duplicateReceiptId: null, duplicateReceiptLabel: null, cancelDuplicate: false }
  ]
};
window.go('invoice-review');
```

Expected: 3 cards render. Row 0 (MP*IFOOD) checked, category dropdown pre-selected to "Delivery". Row 1 shows "(2/6)" next to the description and a checked "possível duplicata" warning naming "Magazine Luiza em 10/09/2026". Row 2 (PAGAMENTO RECEBIDO) unchecked by default. Uncheck row 0's checkbox, then run `window.PendingInvoiceImport.rows[0].included` in the console — expect `false`. Change row 1's category dropdown to "Outros", then run `window.PendingInvoiceImport.rows[1].category` — expect `'Outros'`.

- [ ] **Step 4: Manual verification — confirm flow (needs real Google login)**

Log in with a real Google account (not guest — Firestore writes require it). With the same `window.PendingInvoiceImport` from Step 3 still set (re-run it if needed, but keep row 1's `duplicateReceiptId` as `null` this time to avoid deleting a real receipt), click "Confirmar importação". Expected: an alert reporting counts, navigation to the Histórico screen, and the new "MP*IFOOD" entry (and, if included, "MAGAZINE LUIZA") visible in the list. Delete the test entries afterward via the 🗑️ button.

- [ ] **Step 5: Commit**

```bash
git add js/ui.js
git commit -m "$(cat <<'EOF'
Implementa tela de revisão e confirmação da importação de fatura

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: End-to-end verification with a real invoice, `aprendizados.md`, and deploy

**Files:**
- Modify: `aprendizados.md` (append lessons learned, per project convention)

**Interfaces:**
- Consumes: the full flow built in Tasks 1–6, deployed on Vercel (needed because `/api/*` functions don't run under a plain static server).

- [ ] **Step 1: Deploy to a preview and confirm the endpoint is live**

Run: `git push` (pushes the feature commits to `origin/main`, which auto-deploys on Vercel per the project's existing pipeline) or `vercel --prod` if the user prefers deploying from this checkout directly — confirm with the user before pushing to `main`, since this is a shared branch. Check the Vercel deployment logs show a successful build.

- [ ] **Step 2: Real end-to-end test with an actual credit card invoice**

Using a real invoice (PDF and, separately, a photo of a printed/screen invoice) that includes at least one plain purchase, one installment purchase, and one payment/previous-balance line:
1. Upload via "💳 Importar fatura do cartão", enter a card name, wait for the review screen.
2. Confirm payment/previous-balance lines came in unchecked by default, and installment lines show "(n/total)".
3. Confirm the category dropdown's suggestions look reasonable; adjust any that are wrong.
4. If any line is flagged as a possible duplicate of an already-scanned receipt, confirm the label names the right existing receipt before confirming the cancellation.
5. Click "Confirmar importação" and check the Histórico and Painel (monthly) screens: the installment purchase should now appear in every month it's due (verify by opening each future month's detail), and any canceled individual receipt should no longer appear.
6. Re-upload the exact same invoice file a second time, go through review again, confirm all its rows: expect the result alert to report 0 new entries created (all skipped) — this is the reimport-safety check from the spec.

- [ ] **Step 3: Document what broke or surprised you**

Append a new dated section to `aprendizados.md` (following its existing format — check the file's current entries for the exact heading style) describing anything from Step 2 that didn't work as designed: Gemini misreading installment notation, a category consistently misclassified, timeout on a large multi-page invoice, or anything else — this is what future sessions need to not rediscover the same problem.

- [ ] **Step 4: Commit and push**

```bash
git add aprendizados.md
git commit -m "$(cat <<'EOF'
Documenta lições da importação de fatura em produção

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```
