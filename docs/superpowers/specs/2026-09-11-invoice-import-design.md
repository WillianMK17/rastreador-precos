# Importação de Fatura de Cartão de Crédito (PDF ou Foto)

## Contexto

Hoje o app já lê despesas por foto (`api/parse-receipt-photo.js` + Gemini),
mas sempre uma despesa por vez, de uma loja só: cupom fiscal ou conta de
consumo isolada. Cada despesa vira um doc em
`users/{uid}/receipts/{chaveAcesso}`, com `emittedAt` decidindo o mês em que
ela conta (inclusive contas fixas já usam esse truque — a data de vencimento
vira `emittedAt` pra cair no mês certo), e uma `category` que ou vem de regra
automática (`categorizeStore`/`categorizeItems` em `js/store.js`) ou é fixada
manualmente pelo usuário via `categoryManuallySet`.

Uma fatura de cartão de crédito é estruturalmente diferente: um único
documento com dezenas de lançamentos, de estabelecimentos diferentes, com
nomes muitas vezes cifrados pela adquirente (`MP*IFOOD`, `PAG*NETFLIX`),
algumas linhas que não são despesa (pagamento recebido, saldo anterior) e
compras parceladas que precisam contar em vários meses. Além disso, um
lançamento que aparece na fatura pode já ter sido escaneado individualmente
(cupom fiscal ou foto) antes — importar a fatura sem cuidado duplicaria o
gasto.

## Escopo desta versão

- Importar uma fatura por vez (um PDF ou uma foto), de um cartão identificado
  pelo usuário no momento da importação (ex: "Nubank", "Itaú").
- Extrair via Gemini a lista de lançamentos da fatura, com data, descrição,
  valor, tipo (compra/pagamento/taxa/saldo anterior), parcela atual/total
  (quando a descrição trouxer isso) e uma categoria sugerida.
- Tela de revisão obrigatória antes de gravar qualquer coisa: usuário
  confere, edita categoria, inclui/exclui linhas e confirma prováveis
  duplicatas com recibos já existentes.
- Compra parcelada: ao confirmar, gera um doc de despesa por mês da parcela
  (mês atual + futuros), todos ligados por um `installmentGroupId` comum. Uma
  próxima importação de fatura que contenha a mesma parcela não duplica.
- Duplicata com recibo individual: sugerida automaticamente (valor
  aproximado + data próxima), mas só cancela o recibo antigo se o usuário
  confirmar na tela de revisão.
- Novas categorias para cobrir gasto de cartão que não existiam:
  `Assinaturas/Streaming`, `Delivery`, `Compras Online`, `Transporte/App`.
- **Fora de escopo:** ler extrato bancário (conta corrente) ou fatura de
  mais de um cartão no mesmo upload; reconciliação automática sem
  confirmação do usuário; edição de uma importação já confirmada (pra
  corrigir, o usuário apaga os recibos gerados manualmente pela tela de
  Histórico, que já existe).

## Arquitetura

```
Upload (PDF ou foto) + nome do cartão
  → js/scanner.js: scanInvoiceFile(file, cardName)
  → POST /api/parse-invoice-photo { fileBase64, mimeType, cardName }
  → Gemini (mesmo padrão de parse-receipt-photo.js, aceita mimeType application/pdf)
  → JSON: { ok, transactions: [...] }
  → cliente cruza contra receipts já carregados (duplicata) e monta a tela de revisão
  → usuário edita/confirma
  → js/store.js: importInvoiceTransactions(transactions, cardName)
      → Firestore batch write: cria N docs em receipts/ (1 por parcela/mês)
                                 + deleta os recibos individuais confirmados como duplicata
```

Mesmo racional do design de NFC-e para "por que backend próprio": o Gemini
precisa da API key (secreta) e o payload de imagem/PDF não deve passar por
CORS de navegador — a função serverless Vercel já é o padrão usado por
`parse-receipt-photo.js` e `parse-nfce.js`.

**Por que reaproveitar a coleção `receipts` em vez de uma coleção nova:**
`receipts` já é o formato genérico de "despesa com categoria e mês" — cupom
fiscal, foto de conta e lançamento manual já são três origens diferentes
gravando no mesmo formato. Uma fatura importada é só uma quarta origem
(`source: 'invoice'`). Isso significa que toda a leitura existente
(`buildMonthlySpendingHistory`, `isReceiptInMonth`, drill-down por categoria
em `openCategoryDetail`) funciona sem nenhuma mudança — só quem escreve muda.

## Componentes

- **`api/parse-invoice-photo.js`** (novo, espelha `parse-receipt-photo.js`)
  - Recebe `{ fileBase64, mimeType }` via POST. Aceita `image/*` e
    `application/pdf` no mesmo `inline_data` do Gemini.
  - Prompt novo, pedindo uma lista de lançamentos da fatura brasileira, cada
    um com: `date` (dd/mm/aaaa), `description` (texto bruto do lançamento),
    `value`, `type` (`purchase` | `payment` | `fee` | `previous_balance`),
    `installmentCurrent`/`installmentTotal` (null se a descrição não indicar
    parcelamento, ex: sem "1/3" no texto) e `suggestedCategory` (uma das
    categorias válidas do app, passadas no prompt, ou `null` se não houver
    match razoável — vira "Outros" no cliente).
  - `RESPONSE_SCHEMA` do Gemini (`responseSchema`) força esse formato,
    igual ao endpoint de recibo.
  - Timeout de 30s e tratamento de erro idênticos ao `parse-receipt-photo.js`
    (`gemini_unreachable`, `gemini_invalid_response`, resposta vazia →
    `{ ok:false }`).

- **`js/scanner.js`** (`scanInvoiceFile`, nova função)
  - Converte o arquivo (PDF ou foto) pra base64 (reaproveita
    `_fileToBase64`, que já funciona com qualquer tipo de arquivo via
    `FileReader.readAsDataURL`).
  - Chama `/api/parse-invoice-photo`.
  - Em sucesso, não salva nada ainda — repassa a lista de `transactions` pra
    tela de revisão (`js/ui.js`).
  - Em erro/lista vazia: mensagem clara ("não conseguimos ler os
    lançamentos dessa fatura"), sem crashar.

- **`js/ui.js`** — nova tela "Revisar Fatura" (`#invoice-review`)
  - Lista cada transação com: data, descrição, valor, dropdown de
    categoria (pré-selecionado com `suggestedCategory` ou "Outros"),
    checkbox "incluir" (desmarcado por padrão quando `type` for `payment`
    ou `previous_balance`), badge de parcela ("2/3") quando aplicável.
  - Antes de renderizar, cruza cada transação `purchase`/`fee` contra
    `window.StoreModule.loadReceipts()` (já carregado em outras telas):
    candidato a duplicata = `|receipt.totalValue - transaction.value| <= 0.02`
    E data dentro de ±5 dias. Se achar, marca a linha com um aviso
    "possível duplicata de: {storeName} em {data}" e um checkbox extra
    "cancelar o recibo individual" (marcado por padrão quando achar
    candidato).
  - Botão "Confirmar importação" desabilitado se nenhuma linha estiver
    marcada. Ao confirmar, chama `window.StoreModule.importInvoiceTransactions(...)`.

- **`js/store.js`** — nova função `importInvoiceTransactions`
  - Recebe a lista de transações confirmadas (já com categoria final e
    flag de duplicata) + `cardName`.
  - Para cada transação **sem** parcelamento (`installmentTotal` null ou
    1): calcula `chaveAcesso = 'fatura-' + hash(cardName + description + date + value)`
    (hash determinístico, não aleatório) e monta 1 doc de receipt
    (`source: 'invoice'`, `cardName`, `emittedAt` = data do lançamento,
    `category`, `categoryManuallySet: true` — já que veio de escolha
    explícita na revisão, não deve ser sobrescrita depois por
    `recategorizeAllReceipts`).
  - Para transação **com** parcelamento (`installmentTotal > 1`): calcula
    `installmentGroupId = hash(cardName + description + value + installmentTotal)`.
    Para cada parcela de `installmentCurrent` até `installmentTotal` (nunca
    parcelas anteriores a `installmentCurrent` — se a primeira fatura
    importada já mostra "2/3", a parcela 1 ficou pra trás antes do usuário
    começar a usar essa importação e não é recriada retroativamente), monta
    um doc com `chaveAcesso: installmentGroupId + '-p' + n`, `emittedAt` no
    mês correspondente — mês da fatura para `n === installmentCurrent`,
    e um mês a mais para cada `n` seguinte —, mesmo valor,
    `installmentGroupId`, `installmentIndex: n`.
  - Como o hash é determinístico a partir dos dados do próprio lançamento,
    o mesmo lançamento gera sempre o mesmo `chaveAcesso` — seja ele
    reimportado na mesma fatura por engano, seja uma parcela futura que
    reaparece na fatura do mês seguinte. Antes de montar o batch, o cliente
    faz um `.get()` em cada `chaveAcesso` candidato (leituras não entram no
    batch do Firestore, só escritas) e remove da lista os que já existem —
    é isso que evita duplicar tanto uma fatura reimportada quanto uma
    parcela já criada por uma importação anterior.
  - Para toda transação marcada "cancelar recibo individual duplicado":
    inclui um `.delete()` do recibo antigo no mesmo `WriteBatch`.
  - As criações (docs novos, pós-filtro acima) e os cancelamentos entram no
    mesmo `firebase.firestore().batch()` — grava e cancela junto, ou nada é
    gravado se algo falhar (evita ficar com metade da fatura importada).

- **`js/store.js`** — `window.CATEGORY_RULES` / lista de categorias válidas
  - Adiciona as 4 categorias novas à lista usada tanto no prompt do Gemini
    quanto no dropdown da tela de revisão. Não precisa de regex própria
    (a categorização de lançamento de fatura vem do Gemini, não do
    `categorizeStore`) — as regras existentes continuam servindo só pra
    cupom fiscal/conta.

## Modelo de dados (Firestore)

Sem coleção nova — só campos novos, opcionais, em
`users/{uid}/receipts/{chaveAcesso}`:

```
users/{uid}/receipts/{chaveAcesso}
  ...campos existentes (storeName, emittedAt, totalValue, category, items, ...)
  source: 'invoice'              // além de 'photo' | 'manual' | undefined (NFC-e)
  cardName: string                // nome/apelido do cartão, só quando source === 'invoice'
  installmentGroupId: string | undefined   // presente só se for parcela
  installmentIndex: number | undefined     // 1-based, presente só se for parcela
  installmentTotal: number | undefined
```

`storeName` recebe a descrição bruta do lançamento (ex: "MP*IFOOD"), pra
manter consistência com o resto do histórico. `items` fica com um único item
sintético (mesmo padrão já usado por conta fixa e lançamento manual):
`[{ description: storeName, quantity: 1, unit: 'un', unitPrice: value, totalPrice: value }]`.

## Tratamento de erros

| Situação | Comportamento |
|---|---|
| Gemini não reconhece nenhum lançamento | Mensagem clara, não abre tela de revisão vazia |
| PDF/foto ilegível ou corrompido | Mesmo erro do endpoint de recibo (`gemini_invalid_response` → mensagem amigável) |
| Timeout do Gemini (fatura grande, muitas páginas) | Erro amigável, sugerir tentar de novo; se persistir, é limite conhecido a documentar em `aprendizados.md` |
| Usuário não marca nenhuma linha | Botão "Confirmar" fica desabilitado |
| Falha no meio do batch write | Firestore batch é atômico — nada fica parcialmente gravado |
| Reimportar a mesma fatura duas vezes | Mesma parcela/lançamento gera o mesmo `chaveAcesso` determinístico — segunda importação não duplica (mesmo mecanismo de `installmentGroupId` cobre isso, já que hash é determinístico a partir de cartão+descrição+valor) |

## Testes

- `api/parse-invoice-photo.test.js` (unitário, mesmo padrão de
  `parse-receipt-photo.test.js`): schema da resposta, timeout, erro de rede,
  resposta vazia.
- Teste manual end-to-end com uma fatura real (PDF e foto): conferir que
  parcelas aparecem nos meses certos, que duplicata é sugerida corretamente
  contra um recibo individual pré-existente, e que reimportar a mesma fatura
  não duplica nada.
- Playwright: fluxo da tela de revisão (desmarcar linha, trocar categoria,
  confirmar duplicata, confirmar importação) — seguindo o padrão de testes
  ad-hoc já usado no projeto antes de cada deploy.
