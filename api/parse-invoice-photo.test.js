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
