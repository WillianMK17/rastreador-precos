const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
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
  required: ['found', 'items']
};

const PROMPT = `Você está lendo a foto de um cupom fiscal (nota de mercado, posto de gasolina, farmácia, etc) do Brasil.
Extraia os dados exatamente como aparecem impressos, sem inventar nada.
Se a foto não for de um cupom fiscal legível, retorne found:false e items:[].
Para cada item da lista de produtos, extraia: descrição, quantidade, unidade (ex: UN, KG, L), valor unitário e valor total do item.
Extraia também: nome da loja, CNPJ, endereço, data/hora de emissão (formato dd/mm/aaaa hh:mm:ss se disponível) e valor total do cupom.
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
