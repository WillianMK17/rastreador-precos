import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

function makeDoc(userId, storeName, items) {
  return {
    data: () => ({ storeName, itemsAvailable: true, items }),
    ref: { parent: { parent: { id: userId } } }
  };
}

const batchSetCalls = [];
let batchCommitMock;
let collectionGroupGetMock;

vi.mock('firebase-admin/app', () => ({
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(() => ({})),
  cert: vi.fn((creds) => creds)
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({
    collectionGroup: vi.fn(() => ({ get: collectionGroupGetMock })),
    collection: vi.fn(() => ({ doc: vi.fn((id) => ({ id })) })),
    batch: vi.fn(() => ({
      set: vi.fn((ref, data) => batchSetCalls.push({ ref, data })),
      commit: batchCommitMock
    }))
  })),
  FieldValue: { serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP') }
}));

describe('POST /api/aggregate-prices', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    batchSetCalls.length = 0;
    batchCommitMock = vi.fn().mockResolvedValue();
    collectionGroupGetMock = vi.fn().mockResolvedValue({ docs: [] });
    process.env.FIREBASE_PROJECT_ID = 'test-project';
    process.env.FIREBASE_CLIENT_EMAIL = 'test@test-project.iam.gserviceaccount.com';
    process.env.FIREBASE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('rejeita métodos diferentes de POST', async () => {
    const { default: handler } = await import('./aggregate-prices.js');
    const { req, res } = mockReqRes('GET', {});
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  it('retorna erro quando as credenciais do Admin SDK não estão configuradas', async () => {
    delete process.env.FIREBASE_PROJECT_ID;
    const { default: handler } = await import('./aggregate-prices.js');
    const { req, res } = mockReqRes('POST', {});
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'firebase_admin_not_configured' });
  });

  it('retorna firestore_unavailable quando a leitura falha', async () => {
    collectionGroupGetMock = vi.fn().mockRejectedValue(new Error('down'));
    const { default: handler } = await import('./aggregate-prices.js');
    const { req, res } = mockReqRes('POST', {});
    await handler(req, res);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: 'firestore_unavailable' });
  });

  it('agrega os cupons de todos os usuários e grava o resumo no priceIndex', async () => {
    collectionGroupGetMock = vi.fn().mockResolvedValue({
      docs: [
        makeDoc('user-1', 'Assai Atacadista', [
          { matchKey: 'arroz tio joao 5kg', description: 'Arroz Tio João 5kg', unitPrice: 26.5 }
        ]),
        makeDoc('user-2', 'Extra Supermercados', [
          { matchKey: 'arroz tio joao 5kg', description: 'Arroz Tio João 5kg', unitPrice: 28.9 }
        ])
      ]
    });

    const { default: handler } = await import('./aggregate-prices.js');
    const { req, res } = mockReqRes('POST', {});
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, productsUpdated: 1 });
    expect(batchSetCalls).toHaveLength(1);
    expect(batchSetCalls[0].data).toMatchObject({
      matchKey: 'arroz tio joao 5kg',
      avgUnitPrice: 27.7,
      sampleSize: 2,
      distinctUsers: 2
    });
    expect(batchCommitMock).toHaveBeenCalledTimes(1);
  });

  it('não grava nada quando nenhum produto atinge o mínimo de usuários distintos', async () => {
    collectionGroupGetMock = vi.fn().mockResolvedValue({
      docs: [makeDoc('user-1', 'Assai Atacadista', [{ matchKey: 'item raro', unitPrice: 10 }])]
    });

    const { default: handler } = await import('./aggregate-prices.js');
    const { req, res } = mockReqRes('POST', {});
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, productsUpdated: 0 });
    expect(batchSetCalls).toHaveLength(0);
    expect(batchCommitMock).not.toHaveBeenCalled();
  });
});
