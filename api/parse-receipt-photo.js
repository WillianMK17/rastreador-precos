const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    isUtilityBill: { type: 'boolean' },
    store: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        cnpj: { type: 'string' },
        address: { type: 'string' }
      }
    },
    emittedAt: { type: 'string' },
    totalValue: { type: 'number' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          quantity: { type: 'number' },
          unit: { type: 'string' },
          unitPrice: { type: 'number' },
          totalPrice: { type: 'number' }
        },
        required: ['description', 'quantity', 'unitPrice', 'totalPrice']
      }
    }
  },
  required: ['found', 'isUtilityBill', 'items']
};

const PROMPT = `Você está lendo a foto de um documento de despesa do Brasil. Pode ser um cupom fiscal
(nota de mercado, posto de gasolina, farmácia, etc) OU uma fatura/conta de consumo
(água, esgoto, saneamento, energia elétrica, gás, telefone/internet, aluguel/condomínio).
Extraia os dados exatamente como aparecem impressos, sem inventar nada.
Se a foto não for de um documento de despesa legível, retorne found:false e items:[].

Defina isUtilityBill:true sempre que o documento for uma fatura/conta de consumo
(qualquer concessionária de água/esgoto/saneamento, energia, gás, telefonia/internet,
ou um boleto de aluguel/condomínio) — mesmo que você não reconheça o nome da empresa
por ela ser uma concessionária local ou pouco comum. Defina isUtilityBill:false para
cupom fiscal de compra de produtos (mercado, posto, farmácia, etc).

Se for um CUPOM FISCAL com lista de produtos: para cada item, extraia descrição,
quantidade, unidade (ex: UN, KG, L), valor unitário e valor total do item.

Se for uma FATURA/CONTA DE CONSUMO (sem lista de produtos, só um valor de serviço):
retorne items com um único item, onde description é o nome do serviço + mês de
referência (ex: "Energia Elétrica - Setembro/2026"), quantity:1, unit:"mês",
e unitPrice e totalPrice iguais ao valor total da fatura.

Em ambos os casos, extraia também: nome da loja/concessionária, CNPJ, endereço,
data/hora de emissão (formato dd/mm/aaaa hh:mm:ss se disponível) e valor total.
Se algum campo não estiver legível na foto, deixe como string vazia ou 0, mas nunca invente um valor.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'gemini_not_configured' });
  }

  const { imageBase64, mimeType } = req.body || {};
  if (!imageBase64 || !mimeType) {
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
            { inline_data: { mime_type: mimeType, data: imageBase64 } }
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

  if (!extracted.found || !extracted.items || extracted.items.length === 0) {
    return res.status(200).json({ ok: false, reason: 'receipt-not-recognized' });
  }

  return res.status(200).json({
    ok: true,
    isUtilityBill: extracted.isUtilityBill === true,
    store: {
      name: (extracted.store && extracted.store.name) || '',
      cnpj: (extracted.store && extracted.store.cnpj) || '',
      address: (extracted.store && extracted.store.address) || ''
    },
    receipt: {
      emittedAt: extracted.emittedAt || '',
      totalValue: extracted.totalValue || 0
    },
    items: extracted.items.map(item => ({
      description: item.description || '',
      code: '',
      quantity: item.quantity || 0,
      unit: item.unit || '',
      unitPrice: item.unitPrice || 0,
      totalPrice: item.totalPrice || 0
    }))
  });
}
