# Leitura e Registro de Cupons NFC-e (SP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Escanear um cupom fiscal (NFC-e) da SEFAZ-SP, buscar e extrair os itens/preços reais da nota, e salvar no histórico do usuário no Firestore.

**Architecture:** Uma função serverless da Vercel (`api/parse-nfce.js`) recebe a URL do QR Code, busca a página pública de consulta da SEFAZ-SP do lado do servidor e extrai loja/itens com `cheerio`. O cliente (`js/scanner.js`) chama essa API ao decodificar um QR, e salva o resultado em `users/{uid}/receipts/{chaveAcesso}` no Firestore via `js/store.js`. A tela "Histórico" (`js/ui.js`) lê e renderiza esses cupons.

**Tech Stack:** Node.js (função serverless Vercel, runtime padrão), `cheerio` para parsing HTML, `vitest` para testes, Firebase Firestore (SDK compat já usado no projeto), vanilla JS no cliente (sem framework/bundler).

**Spec:** `docs/superpowers/specs/2026-09-04-nfce-scan-parse-design.md`

## Global Constraints

- Suporte apenas ao portal da SEFAZ-SP (`www.nfce.fazenda.sp.gov.br`) nesta versão — qualquer outro host retorna erro claro, sem tentar parsear.
- O QR Code da NFC-e-SP traz **somente** a chave de acesso (44 dígitos) + parâmetros de ambiente/hash — **não** traz valor nem data. Qualquer fallback client-side só pode usar a chave.
- Nenhum dado real de CPF/pessoa física deve ser commitado no repositório (é público). Fixtures de teste usam `000.000.000-00`.
- Persistência de cupons só ocorre para usuários autenticados via Google (`auth.currentUser`); contas convidadas (`loginAsGuest`) não gravam no Firestore, igual ao comportamento atual do resto do app.
- Cupons são deduplicados pelo id do documento = chave de acesso (44 dígitos), com `set(..., {merge:true})`.

---

## Task 1: Inicializar `package.json` com `cheerio` e `vitest`

**Files:**
- Create: `package.json`
- Create: `.gitignore` (modify — adicionar `node_modules`)

**Interfaces:**
- Produces: comando `npm test` rodando `vitest run`; dependência `cheerio` disponível para `api/lib/parseSefazSp.js` (Task 2).

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "rastreador-precos",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "cheerio": "^1.0.0"
  },
  "devDependencies": {
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 2: Adicionar `node_modules` ao `.gitignore`**

Abrir `.gitignore` e garantir que contenha, entre outras linhas já existentes:

```
node_modules
```

- [ ] **Step 3: Instalar dependências**

Run: `npm install`
Expected: instala sem erro, cria `package-lock.json` e `node_modules/`.

- [ ] **Step 4: Rodar `npm test` (ainda sem testes)**

Run: `npm test`
Expected: vitest roda e reporta "No test files found" (ainda não há testes — normal nesta etapa).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: adicionar package.json com cheerio e vitest"
```

---

## Task 2: Parser do HTML da SEFAZ-SP (`parseSefazSpHtml`)

**Files:**
- Create: `api/lib/parseSefazSp.js`
- Create: `api/lib/parseSefazSp.test.js`
- Create (já criados nesta sessão, manter): `api/lib/__fixtures__/sefaz-sp-sample.html`, `api/lib/__fixtures__/sefaz-sp-not-found.html`

**Interfaces:**
- Consumes: nenhum (função pura, só recebe uma string HTML).
- Produces: `parseSefazSpHtml(html: string)` retornando:
  - Sucesso: `{ ok: true, store: { name, cnpj, address }, receipt: { chaveAcesso, emittedAt, totalValue }, items: [{ description, code, quantity, unit, unitPrice, totalPrice }] }`
  - Falha: `{ ok: false, reason: string }`
  - Usado por `api/parse-nfce.js` (Task 3).

As fixtures `api/lib/__fixtures__/sefaz-sp-sample.html` (nota real da Irmãos Muffato, com CPF mascarado) e `api/lib/__fixtures__/sefaz-sp-not-found.html` (página de erro para chave inválida) já foram criadas nesta sessão a partir de uma consulta real à SEFAZ-SP — não recriar, só usar.

- [ ] **Step 1: Escrever o teste que falha**

Criar `api/lib/parseSefazSp.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSefazSpHtml } from './parseSefazSp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');
}

describe('parseSefazSpHtml', () => {
  it('extrai loja, itens e totais de um cupom válido', () => {
    const html = loadFixture('sefaz-sp-sample.html');
    const result = parseSefazSpHtml(html);

    expect(result.ok).toBe(true);
    expect(result.store).toEqual({
      name: 'IRMAOS MUFFATO E CIA LTDA',
      cnpj: '76.430.438/0106-49',
      address: 'RUA CARDOSO RIBEIRO, 861, VILA BOA ESPERANCA, Ourinhos, SP'
    });
    expect(result.receipt).toEqual({
      chaveAcesso: '35260876430438010649650040000368291004437688',
      emittedAt: '23/08/2026 18:38:00',
      totalValue: 29.03
    });
    expect(result.items).toEqual([
      { description: 'PAN PAO FRANC KG', code: '322173', quantity: 0.672, unit: 'Kg', unitPrice: 11.979167, totalPrice: 8.05 },
      { description: 'BEB L CAROLINA 1250G', code: '271905', quantity: 1, unit: 'Un', unitPrice: 9.99, totalPrice: 9.99 },
      { description: 'PAO KIM 400G', code: '296872', quantity: 1, unit: 'Un', unitPrice: 10.99, totalPrice: 10.99 }
    ]);
  });

  it('retorna ok:false quando a chave não é encontrada', () => {
    const html = loadFixture('sefaz-sp-not-found.html');
    const result = parseSefazSpHtml(html);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('items-not-found');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test`
Expected: FAIL — `Cannot find module './parseSefazSp.js'` (o módulo ainda não existe).

- [ ] **Step 3: Implementar `api/lib/parseSefazSp.js`**

```js
import * as cheerio from 'cheerio';

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function toFloat(brNumber) {
  return parseFloat(brNumber.replace(/\./g, '').replace(',', '.'));
}

export function parseSefazSpHtml(html) {
  const $ = cheerio.load(html);

  const rows = $('#tabResult tr').toArray();
  if (rows.length === 0) {
    return { ok: false, reason: 'items-not-found' };
  }

  const storeName = normalizeWhitespace($('#u20').text());
  const cnpjText = normalizeWhitespace($('.txtCenter .text').eq(0).text());
  const cnpjMatch = cnpjText.match(/CNPJ:\s*([\d.\/-]+)/);
  const addressText = normalizeWhitespace($('.txtCenter .text').eq(1).text());
  const address = addressText
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .join(', ');

  const infosText = normalizeWhitespace($('#infos').text());
  const emittedMatch = infosText.match(/Emissão:\s*([\d/]+ [\d:]+)/);

  const chave = normalizeWhitespace($('.chave').text()).replace(/\s/g, '');

  const totalValueText = normalizeWhitespace($('#totalNota .linhaShade .totalNumb').first().text());

  const items = rows.map(row => {
    const $row = $(row);
    const description = normalizeWhitespace($row.find('span.txtTit').first().text());
    const codeText = normalizeWhitespace($row.find('.RCod').text());
    const codeMatch = codeText.match(/Código:\s*(\d+)/);
    const qtdText = normalizeWhitespace($row.find('.Rqtd').text());
    const qtdMatch = qtdText.match(/Qtde\.:\s*([\d.,]+)/);
    const unitText = normalizeWhitespace($row.find('.RUN').text());
    const unitMatch = unitText.match(/UN:\s*(\S+)/);
    const unitPriceText = normalizeWhitespace($row.find('.RvlUnit').text());
    const unitPriceMatch = unitPriceText.match(/Vl\.\s*Unit\.:\s*([\d.,]+)/);
    const totalPriceText = normalizeWhitespace($row.find('td.txtTit .valor').text());

    return {
      description,
      code: codeMatch ? codeMatch[1] : '',
      quantity: qtdMatch ? toFloat(qtdMatch[1]) : 0,
      unit: unitMatch ? unitMatch[1] : '',
      unitPrice: unitPriceMatch ? toFloat(unitPriceMatch[1]) : 0,
      totalPrice: totalPriceText ? toFloat(totalPriceText) : 0
    };
  });

  return {
    ok: true,
    store: {
      name: storeName,
      cnpj: cnpjMatch ? cnpjMatch[1] : '',
      address
    },
    receipt: {
      chaveAcesso: chave,
      emittedAt: emittedMatch ? emittedMatch[1] : '',
      totalValue: totalValueText ? toFloat(totalValueText) : 0
    },
    items
  };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test`
Expected: PASS — os dois testes de `parseSefazSpHtml` passam.

- [ ] **Step 5: Commit**

```bash
git add api/lib/parseSefazSp.js api/lib/parseSefazSp.test.js api/lib/__fixtures__
git commit -m "feat: parser do HTML de consulta NFC-e da SEFAZ-SP"
```

---

## Task 3: Endpoint serverless `POST /api/parse-nfce`

**Files:**
- Create: `api/parse-nfce.js`
- Create: `api/parse-nfce.test.js`
- Modify: `package.json` (mudar `"type": "module"` — necessário para `import` funcionar tanto no handler quanto no parser)

**Interfaces:**
- Consumes: `parseSefazSpHtml(html)` da Task 2.
- Produces: endpoint HTTP `POST /api/parse-nfce` com body `{ url: string }`, usado pelo cliente na Task 6.
  - `400 { error: 'invalid_request' }` — corpo sem `url` ou `url` malformada.
  - `400 { error: 'unsupported_state' }` — host da URL não é `nfce.fazenda.sp.gov.br`.
  - `405 { error: 'method_not_allowed' }` — método diferente de POST.
  - `502 { error: 'sefaz_unreachable' }` — falha de rede/timeout ou resposta não-2xx da SEFAZ.
  - `200 { ok: true, store, receipt, items }` — sucesso.
  - `200 { ok: false, reason }` — SEFAZ respondeu, mas o cupom não foi encontrado/reconhecido.

- [ ] **Step 1: Adicionar `"type": "module"` ao `package.json`**

Em `package.json`, adicionar a chave `"type": "module"` (no mesmo nível de `"name"`):

```json
{
  "name": "rastreador-precos",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  ...
}
```

- [ ] **Step 2: Escrever o teste que falha**

Criar `api/parse-nfce.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from './parse-nfce.js';

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

describe('POST /api/parse-nfce', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejeita métodos diferentes de POST', async () => {
    const { req, res } = mockReqRes('GET', {});
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  it('rejeita corpo sem url', async () => {
    const { req, res } = mockReqRes('POST', {});
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_request' });
  });

  it('rejeita host de outro estado', async () => {
    const { req, res } = mockReqRes('POST', { url: 'https://www.sefaz.rs.gov.br/NFCE/qrcode?p=123' });
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'unsupported_state' });
  });

  it('retorna sefaz_unreachable quando o fetch falha', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const { req, res } = mockReqRes('POST', { url: 'https://www.nfce.fazenda.sp.gov.br/qrcode?p=123|2|1|1|abc' });
    await handler(req, res);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'sefaz_unreachable' });
  });

  it('retorna os dados parseados quando a busca funciona', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<table id="tabResult"><tr><td><span class="txtTit">ITEM</span><span class="RCod">(Código: 1)</span><span class="Rqtd"><strong>Qtde.:</strong>1</span><span class="RUN"><strong>UN: </strong>Un</span><span class="RvlUnit"><strong>Vl. Unit.:</strong>1,00</span></td><td class="txtTit"><span class="valor">1,00</span></td></tr></table><div id="u20">LOJA</div>'
    });
    const { req, res } = mockReqRes('POST', { url: 'https://www.nfce.fazenda.sp.gov.br/qrcode?p=123|2|1|1|abc' });
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.items).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `npm test`
Expected: FAIL — `Cannot find module './parse-nfce.js'`.

- [ ] **Step 4: Implementar `api/parse-nfce.js`**

```js
import { parseSefazSpHtml } from './lib/parseSefazSp.js';

const ALLOWED_HOST = 'www.nfce.fazenda.sp.gov.br';
const FETCH_TIMEOUT_MS = 10000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const url = req.body && req.body.url;
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'invalid_request' });
  }

  if (parsedUrl.hostname !== ALLOWED_HOST) {
    return res.status(400).json({ error: 'unsupported_state' });
  }

  let html;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(parsedUrl.toString(), { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      return res.status(502).json({ error: 'sefaz_unreachable' });
    }
    html = await response.text();
  } catch {
    return res.status(502).json({ error: 'sefaz_unreachable' });
  }

  const result = parseSefazSpHtml(html);
  return res.status(200).json(result);
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `npm test`
Expected: PASS — todos os testes de `api/parse-nfce.test.js` e `api/lib/parseSefazSp.test.js` passam.

- [ ] **Step 6: Commit**

```bash
git add api/parse-nfce.js api/parse-nfce.test.js package.json
git commit -m "feat: endpoint serverless /api/parse-nfce"
```

---

## Task 4: Regras de segurança do Firestore para `users/{uid}/receipts`

**Files:**
- Create: `firebase.json`
- Create: `firestore.rules`

**Interfaces:**
- Produces: acesso liberado (leitura/escrita) a `users/{userId}/**` (inclui o documento de perfil já usado por `saveUserToFirestore` em `js/firebase-init.js` e a nova subcoleção `receipts` da Task 5) somente para o próprio usuário autenticado.

**Nota:** este projeto não tem `firestore.rules` versionado hoje — as regras atuais só existem no Firebase Console (podem estar em modo teste totalmente aberto, ou bloqueando tudo). A regra abaixo cobre toda a árvore do usuário (`{document=**}`), não só `receipts`, para não quebrar a escrita de perfil que já funciona hoje. Se você tiver outras coleções/regras customizadas no console que não aparecem aqui, revise antes do deploy.

- [ ] **Step 1: Criar `firebase.json`**

```json
{
  "firestore": {
    "rules": "firestore.rules"
  }
}
```

- [ ] **Step 2: Criar `firestore.rules`**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

- [ ] **Step 3: Deploy das regras**

Run: `firebase deploy --only firestore:rules --project willian-rastreador-precos`
Expected: deploy concluído sem erro.

- [ ] **Step 4: Commit**

```bash
git add firebase.json firestore.rules
git commit -m "feat: regras do Firestore para dados do usuário (perfil + cupons)"
```

---

## Task 5: `saveReceipt` / `loadReceipts` em `js/store.js`

**Files:**
- Modify: `js/store.js`

**Interfaces:**
- Consumes: `window.auth` e `window.db` (já inicializados em `js/firebase-init.js`).
- Produces:
  - `window.StoreModule.saveReceipt(receipt) -> Promise<void>` onde `receipt = { chaveAcesso, storeName, storeCnpj, storeAddress, emittedAt, totalValue, itemsAvailable, items }`. Rejeita com `Error('not-authenticated')` se não houver `auth.currentUser`.
  - `window.StoreModule.loadReceipts() -> Promise<Array<receipt & { id: string }>>`, ordenado por `scannedAt` desc. Resolve `[]` se não houver `auth.currentUser`.
  - Usado por `js/scanner.js` (Task 6) e `js/ui.js` (Task 7).

- [ ] **Step 1: Adicionar `StoreModule` ao final de `js/store.js`**

```js
window.StoreModule = {
  saveReceipt: function(receipt) {
    if (!window.auth || !window.auth.currentUser) {
      return Promise.reject(new Error('not-authenticated'));
    }
    if (!window.db) {
      return Promise.reject(new Error('firestore-unavailable'));
    }
    const uid = window.auth.currentUser.uid;
    return window.db
      .collection('users').doc(uid)
      .collection('receipts').doc(receipt.chaveAcesso)
      .set(Object.assign({}, receipt, {
        scannedAt: firebase.firestore.FieldValue.serverTimestamp()
      }), { merge: true });
  },

  loadReceipts: function() {
    if (!window.auth || !window.auth.currentUser || !window.db) {
      return Promise.resolve([]);
    }
    const uid = window.auth.currentUser.uid;
    return window.db
      .collection('users').doc(uid)
      .collection('receipts')
      .orderBy('scannedAt', 'desc')
      .get()
      .then(snapshot => snapshot.docs.map(doc => Object.assign({ id: doc.id }, doc.data())));
  }
};
```

- [ ] **Step 2: Verificar manualmente**

Não há framework de teste de browser neste projeto (é HTML/JS estático). Verificação: abrir `js/store.js` no navegador via devtools depois do deploy (Task 8) e confirmar no console que `window.StoreModule.saveReceipt` e `window.StoreModule.loadReceipts` existem como funções.

- [ ] **Step 3: Commit**

```bash
git add js/store.js
git commit -m "feat: salvar e carregar cupons escaneados no Firestore"
```

---

## Task 6: Integrar o fluxo real em `js/scanner.js`

**Files:**
- Modify: `js/scanner.js`

**Interfaces:**
- Consumes: `POST /api/parse-nfce` (Task 3), `window.StoreModule.saveReceipt` (Task 5).
- Produces: `handleReceiptParsed(qrCodeData)` (async) — chamado pelo callback de sucesso do scanner (`js/ui.js`, já existente).

- [ ] **Step 1: Substituir `handleReceiptParsed` em `js/scanner.js`**

Trocar o corpo atual (que só mostra um alert genérico) por:

```js
  extractChaveFromQrUrl: function(qrCodeData) {
    try {
      const parsed = new URL(qrCodeData);
      const p = parsed.searchParams.get('p');
      if (!p) return null;
      const chave = p.split('|')[0];
      return /^\d{44}$/.test(chave) ? chave : null;
    } catch {
      return null;
    }
  },

  isSefazSpUrl: function(qrCodeData) {
    try {
      return new URL(qrCodeData).hostname === 'www.nfce.fazenda.sp.gov.br';
    } catch {
      return false;
    }
  },

  handleReceiptParsed: async function(qrCodeData) {
    const chave = this.extractChaveFromQrUrl(qrCodeData);

    if (!chave) {
      showAuthMessage("QR Code lido, mas não parece ser uma NFC-e válida.", "error");
      return;
    }

    if (!this.isSefazSpUrl(qrCodeData)) {
      showAuthMessage("Por enquanto só conseguimos ler cupons de São Paulo. A chave " + chave + " foi identificada, mas os itens não puderam ser buscados.", "error");
      return this._saveFallback(chave);
    }

    showAuthMessage("Cupom lido! Buscando os itens na SEFAZ...", "success");

    let apiResult;
    try {
      const response = await fetch('/api/parse-nfce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: qrCodeData })
      });
      apiResult = await response.json();
    } catch (err) {
      console.error("Erro ao buscar cupom na SEFAZ:", err);
      showAuthMessage("Não conseguimos buscar os itens agora, mas a chave foi registrada.", "error");
      return this._saveFallback(chave);
    }

    if (!apiResult || apiResult.ok !== true) {
      showAuthMessage("Cupom não encontrado na SEFAZ, mas a chave foi registrada.", "error");
      return this._saveFallback(chave);
    }

    const receipt = {
      chaveAcesso: apiResult.receipt.chaveAcesso || chave,
      storeName: apiResult.store.name,
      storeCnpj: apiResult.store.cnpj,
      storeAddress: apiResult.store.address,
      emittedAt: apiResult.receipt.emittedAt,
      totalValue: apiResult.receipt.totalValue,
      itemsAvailable: true,
      items: apiResult.items
    };

    try {
      await window.StoreModule.saveReceipt(receipt);
      showAuthMessage("Cupom Fiscal registrado com sucesso!", "success");
      if (window.go) window.go('history');
    } catch (err) {
      if (err.message === 'not-authenticated') {
        showAuthMessage("Entre com sua conta Google para guardar o histórico de cupons.", "error");
      } else {
        console.error("Erro ao salvar cupom:", err);
        showAuthMessage("Cupom lido, mas houve um erro ao salvar.", "error");
      }
    }
  },

  _saveFallback: async function(chave) {
    try {
      await window.StoreModule.saveReceipt({
        chaveAcesso: chave,
        storeName: '',
        storeCnpj: '',
        storeAddress: '',
        emittedAt: '',
        totalValue: 0,
        itemsAvailable: false,
        items: []
      });
      if (window.go) window.go('history');
    } catch (err) {
      if (err.message === 'not-authenticated') {
        showAuthMessage("Entre com sua conta Google para guardar o histórico de cupons.", "error");
      }
    }
  }
```

Isso substitui a função `handleReceiptParsed` original dentro do objeto `window.ScannerModule` (mantendo `startCameraScanner` e `stopScanner` como estão) e adiciona `extractChaveFromQrUrl`, `isSefazSpUrl` e `_saveFallback` como novos métodos do mesmo objeto.

- [ ] **Step 2: Verificação manual (ver Task 8)**

Este arquivo depende do DOM e da câmera real — sem mock de navegador no projeto, a verificação é o teste end-to-end da Task 8.

- [ ] **Step 3: Commit**

```bash
git add js/scanner.js
git commit -m "feat: buscar e salvar itens reais do cupom ao escanear"
```

---

## Task 7: Renderizar o histórico real em `js/ui.js` + `index.html`

**Files:**
- Modify: `index.html:383-387` (bloco `.receipt-card` dentro de `#history`)
- Modify: `js/ui.js`

**Interfaces:**
- Consumes: `window.StoreModule.loadReceipts()` (Task 5).
- Produces: `renderReceiptsHistory()`, chamada ao navegar para a tela `history` (hook em `window.go`, que já existe em `js/ui.js`).

- [ ] **Step 1: Dar um id ao container em `index.html`**

Trocar:

```html
      <div class="receipt-card">
        <div style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">
          Nenhum histórico detalhado registrado. Escaneie um cupom para comparar automaticamente.
        </div>
      </div>
```

por:

```html
      <div class="receipt-card" id="receipts-history-container">
        <!-- Rendered dynamically via js/ui.js -->
      </div>
```

- [ ] **Step 2: Adicionar `renderReceiptsHistory` em `js/ui.js`**

```js
function renderReceiptsHistory() {
  const container = document.getElementById('receipts-history-container');
  if (!container) return;

  container.innerHTML = `
    <div style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">
      Carregando cupons...
    </div>
  `;

  window.StoreModule.loadReceipts().then(receipts => {
    if (!receipts || receipts.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">
          Nenhum histórico detalhado registrado. Escaneie um cupom para comparar automaticamente.
        </div>
      `;
      return;
    }

    container.innerHTML = receipts.map(r => `
      <div class="item-row">
        <div>
          <div class="item-name">${r.storeName || 'Loja não identificada'}</div>
          <div class="item-meta">${r.emittedAt || ''}${r.itemsAvailable ? ' · ' + r.items.length + ' itens' : ' · itens indisponíveis'}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-family:var(--font-mono); font-weight:700; font-size:16px;">R$ ${r.totalValue ? r.totalValue.toFixed(2).replace('.', ',') : '--,--'}</div>
        </div>
      </div>
    `).join('');
  });
}
```

- [ ] **Step 3: Chamar `renderReceiptsHistory` ao entrar na tela `history`**

Em `js/ui.js`, dentro de `window.go`, no bloco que já trata a entrada na tela `scan` (por volta da linha 60), adicionar um `else if` para `history`:

```js
  if (id === 'scan') {
    if (window.ScannerModule) {
      window.ScannerModule.startCameraScanner('qr-reader', (data) => {
        window.ScannerModule.handleReceiptParsed(data);
      });
    }
  } else if (id === 'history') {
    renderReceiptsHistory();
    if (window.ScannerModule) window.ScannerModule.stopScanner();
  } else {
    if (window.ScannerModule) window.ScannerModule.stopScanner();
  }
```

(substitui o `if/else` existente nesse trecho, mantendo o `stopScanner()` para as demais telas.)

- [ ] **Step 4: Commit**

```bash
git add index.html js/ui.js
git commit -m "feat: renderizar histórico real de cupons na tela Histórico"
```

---

## Task 8: Deploy e teste end-to-end com cupom real

**Files:** nenhum (verificação manual em produção)

- [ ] **Step 1: Deploy em produção**

Run: `vercel --prod --yes`
Expected: deploy `READY`.

- [ ] **Step 2: Teste manual**

No app publicado: entrar com Google, ir em "Escanear", apontar para um cupom fiscal real de SP (ou reabrir o mesmo QR usado nesta sessão). Confirmar:
- A câmera detecta o QR (já corrigido em commit anterior).
- A tela mostra "Cupom lido! Buscando os itens na SEFAZ..." e depois "Cupom Fiscal registrado com sucesso!".
- A tela "Histórico" mostra o nome da loja, data e valor total do cupom.

- [ ] **Step 3: Teste do caminho de erro**

Escanear (ou colar via `window.ScannerModule.handleReceiptParsed(url)` no console) uma URL de outro estado (ex: um QR de NFC-e do RS) e confirmar que aparece a mensagem "só conseguimos ler cupons de São Paulo" e que a chave é salva mesmo assim (`itemsAvailable: false` no histórico).
