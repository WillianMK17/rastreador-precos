# Leitura e Registro de Cupons Fiscais (NFC-e SP)

## Contexto

O app "Rastreador de Preços" já tem uma tela de scanner de QR Code
(`js/scanner.js`), mas o callback de sucesso (`handleReceiptParsed`) é um
stub: descarta o conteúdo lido e mostra um alerta genérico de sucesso, sem
extrair nem salvar nenhuma informação real do cupom. Não existe histórico de
compras, e os dados de "comparar mercados" (`AppState.compareMarkets`) e
indicadores agregados (`monthlySpent`, `itemsRising`) são mockados.

O QR Code de uma NFC-e (cupom fiscal eletrônico) traz apenas uma URL com
parâmetros básicos da nota (chave de acesso, valor total, data de emissão).
Os itens/produtos do cupom **não** vêm no QR — só existem na página de
consulta pública da SEFAZ do estado emissor. Cada estado tem seu próprio
portal e formato de página.

Viabilidade confirmada: testei a página de consulta da SEFAZ-SP
(`nfce.fazenda.sp.gov.br`) com uma chave inválida — ela responde com HTML
renderizado no servidor (ASP.NET WebForms clássico), sem CAPTCHA na consulta
pública. Um fetch simples do lado do servidor deve conseguir os dados sem
precisar de navegador headless.

## Escopo desta versão

- Suporte só ao portal da SEFAZ-SP (a cidade padrão do app é Ourinhos, SP).
  Outros estados ficam para versões futuras — a estrutura deve deixar isso
  fácil de adicionar (um parser por UF), mas não implementar agora.
- Extrair e salvar: dados da nota (loja, CNPJ, endereço, data, valor total,
  chave de acesso) e a lista de itens (descrição, quantidade, valor
  unitário, valor total por item).
- Popular a tela "Histórico" existente (`#history` em `index.html`), que já
  tem o placeholder pronto para receber cards de cupons reais.
- **Fora de escopo:** alimentar `compareMarkets`, `monthlySpent` e
  `itemsRising` com dados reais dos cupons. Essas agregações exigem decisões
  de produto adicionais (como casar o mesmo produto entre cupons de lojas
  diferentes) e ficam para uma iteração seguinte, depois que a captura básica
  estiver validada com cupons reais.

## Arquitetura

```
Câmera → scanner.js (decodedText = URL do QR)
       → POST /api/parse-nfce { url }         [função serverless Vercel]
       → fetch server-side da página SEFAZ-SP → parse HTML (cheerio)
       → JSON estruturado { nota, itens[] }
       → cliente salva em Firestore: users/{uid}/receipts/{receiptId}
       → renderiza card na tela Histórico
```

**Por que backend próprio (Vercel serverless) em vez de parsear no
navegador:** a busca precisa rodar no servidor por causa de CORS (a SEFAZ não
libera acesso direto via `fetch` do navegador). Uma função serverless na
própria Vercel é gratuita no plano atual do projeto e usa o mesmo pipeline de
deploy já existente — não exige habilitar cobrança em nenhum lugar (ao
contrário de Firebase Cloud Functions, que exigiria plano Blaze). A lógica de
parsing fica só no backend, então atualizar o parser (se a SEFAZ mudar o
layout da página) não exige novo deploy do frontend.

**Por que Firestore em vez de localStorage:** o histórico de cupons deve
sobreviver a troca de aparelho/navegador e ficar ligado à conta Google (que
já foi corrigida nesta sessão). Usuários convidados (`loginAsGuest`, sem
Firebase Auth real) continuam sem persistência de cupons — igual ao
comportamento atual deles com o resto do app.

## Componentes

- **`api/parse-nfce.js`** (nova função serverless Vercel)
  - Recebe `{ url }` via POST.
  - Valida que o host é `www.nfce.fazenda.sp.gov.br` — outro host retorna erro
    claro (`estado não suportado`).
  - Faz `fetch` da URL, parseia o HTML com `cheerio`.
  - **Risco conhecido:** não tenho uma chave de NFC-e real para testar hoje,
    então os seletores exatos da tabela de itens serão ajustados no primeiro
    teste real durante a implementação — o teste de viabilidade confirmou que
    a página carrega e é server-rendered, mas não a estrutura exata do HTML
    com dados reais.
  - Retorna JSON: `{ store: { name, cnpj, address }, receipt: { chaveAcesso,
    emittedAt, totalValue }, items: [{ description, quantity, unitPrice,
    totalPrice }] }`.
  - Em caso de falha no parsing (layout mudou, timeout, chave não encontrada),
    retorna ao menos os dados que já vêm no próprio QR Code (chave de acesso e
    valor total, extraídos da query string pelo cliente antes mesmo de chamar
    a API) em vez de falhar por completo.

- **`js/scanner.js`** (`handleReceiptParsed`)
  - Extrai da URL os parâmetros básicos do QR (chave de acesso, valor,
    data) como fallback imediato.
  - Chama `/api/parse-nfce`.
  - Em sucesso: monta o objeto do cupom e chama `window.StoreModule.saveReceipt(...)`.
  - Em erro: salva o fallback básico com uma flag `itemsAvailable: false`, e
    avisa o usuário que os itens não puderam ser lidos desta vez.

- **`js/store.js`** (nova função `saveReceipt`)
  - Se `auth.currentUser` existir: grava em
    `users/{uid}/receipts/{receiptId}` no Firestore (merge: true, id = chave
    de acesso da nota, evitando duplicar o mesmo cupom escaneado 2x).
  - Se não houver usuário real (convidado): mostra aviso de que é preciso
    entrar com Google para guardar o histórico de cupons.

- **`js/ui.js`** / tela `#history`
  - Ao entrar na tela, busca os cupons do usuário no Firestore (ordenados por
    data, mais recentes primeiro) e renderiza um `.receipt-card` por cupom
    (loja, data, valor total, lista de itens expansível). Mantém a mensagem
    atual como estado vazio quando não há cupons.

## Modelo de dados (Firestore)

```
users/{uid}/receipts/{chaveAcesso}
  storeName: string
  storeCnpj: string
  storeAddress: string
  emittedAt: timestamp
  totalValue: number
  itemsAvailable: boolean       // false se o parsing da SEFAZ falhou
  items: [
    { description: string, quantity: number, unitPrice: number, totalPrice: number }
  ]
  scannedAt: serverTimestamp
```

## Tratamento de erros

| Situação | Comportamento |
|---|---|
| QR não é URL de NFC-e válida | Mensagem clara, não chama a API |
| QR é de outro estado (não SP) | Mensagem "consulta disponível só para SP por enquanto", salva só os dados básicos do QR |
| SEFAZ fora do ar / timeout | Salva fallback básico (chave, valor, data do QR), avisa que os itens não puderam ser carregados agora |
| Layout da página mudou (parsing falha) | Mesmo fallback acima |
| Usuário convidado (sem login Google) | Avisa que precisa entrar com Google para guardar o histórico |
| Cupom já escaneado antes | `merge: true` com id = chave de acesso evita duplicata; apenas atualiza |

## Testes

- Testes unitários do parser (`api/parse-nfce.js`) contra um HTML de exemplo
  salvo localmente (fixture) — como não há chave real ainda, a fixture inicial
  será capturada no primeiro teste manual bem-sucedido durante a
  implementação e versionada no repo para testes futuros.
- Teste manual end-to-end: escanear um cupom fiscal real de SP e confirmar
  que os itens aparecem corretos no histórico.
- Teste dos caminhos de erro: URL inválida, host de outro estado, timeout
  simulado.
