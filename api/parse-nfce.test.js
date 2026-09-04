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
