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
