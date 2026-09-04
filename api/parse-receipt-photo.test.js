import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from './parse-receipt-photo.js';

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

describe('POST /api/parse-receipt-photo', () => {
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

  it('rejeita corpo sem imagem', async () => {
    const { req, res } = mockReqRes('POST', {});
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_request' });
  });

  it('retorna erro quando a chave do Gemini não está configurada', async () => {
    delete process.env.GEMINI_API_KEY;
    const { req, res } = mockReqRes('POST', { imageBase64: 'abc', mimeType: 'image/jpeg' });
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'gemini_not_configured' });
  });

  it('retorna gemini_unreachable quando o fetch falha', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    const { req, res } = mockReqRes('POST', { imageBase64: 'abc', mimeType: 'image/jpeg' });
    await handler(req, res);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'gemini_unreachable' });
  });

  it('retorna ok:false quando o Gemini não reconhece um cupom', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockGeminiResponse('{"found":false,"items":[]}'));
    const { req, res } = mockReqRes('POST', { imageBase64: 'abc', mimeType: 'image/jpeg' });
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: false, reason: 'receipt-not-recognized' });
  });

  it('retorna os itens extraídos quando o Gemini reconhece o cupom', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockGeminiResponse(JSON.stringify({
      found: true,
      store: { name: 'Loja Teste', cnpj: '00.000.000/0001-00', address: 'Rua Teste, 1' },
      emittedAt: '01/09/2026 10:00:00',
      totalValue: 21,
      items: [{ description: 'Item de exemplo', quantity: 2, unit: 'un', unitPrice: 10.5, totalPrice: 21 }]
    })));
    const { req, res } = mockReqRes('POST', { imageBase64: 'abc', mimeType: 'image/jpeg' });
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.store.name).toBe('Loja Teste');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].totalPrice).toBe(21);
  });
});
