import { describe, it, expect } from 'vitest';
import { aggregateReceiptItems, aggregateReceiptItemsByCity } from './aggregatePrices.js';

function receipt(userId, storeName, items, citySlug) {
  return { userId, storeName, itemsAvailable: true, items, citySlug };
}

describe('aggregateReceiptItems', () => {
  it('agrega preço médio e mínimo por matchKey quando há amostras de usuários distintos', () => {
    const receipts = [
      receipt('user-1', 'Assai Atacadista', [
        { matchKey: 'arroz tio joao 5kg', description: 'Arroz Tio João 5kg', unitPrice: 26.50 }
      ]),
      receipt('user-2', 'Extra Supermercados', [
        { matchKey: 'arroz tio joao 5kg', description: 'Arroz Tio João 5kg', unitPrice: 28.90 }
      ])
    ];

    const result = aggregateReceiptItems(receipts);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      matchKey: 'arroz tio joao 5kg',
      avgUnitPrice: 27.70,
      minUnitPrice: 26.50,
      minUnitPriceStore: 'Assai Atacadista',
      sampleSize: 2,
      distinctUsers: 2
    });
  });

  it('não inclui um produto comprado por apenas 1 usuário, mesmo com várias notas dele', () => {
    const receipts = [
      receipt('user-1', 'Assai Atacadista', [{ matchKey: 'item raro', description: 'Item Raro', unitPrice: 10 }]),
      receipt('user-1', 'Assai Atacadista', [{ matchKey: 'item raro', description: 'Item Raro', unitPrice: 12 }])
    ];

    const result = aggregateReceiptItems(receipts);
    expect(result).toHaveLength(0);
  });

  it('ignora cupons sem itens disponíveis (itemsAvailable:false)', () => {
    const receipts = [
      { userId: 'user-1', storeName: 'X', itemsAvailable: false, items: [{ matchKey: 'a', unitPrice: 5 }] },
      receipt('user-2', 'Y', [{ matchKey: 'a', unitPrice: 5 }])
    ];

    const result = aggregateReceiptItems(receipts);
    expect(result).toHaveLength(0);
  });

  it('ignora itens sem matchKey ou com preço inválido', () => {
    const receipts = [
      receipt('user-1', 'X', [{ matchKey: '', description: 'sem chave', unitPrice: 5 }]),
      receipt('user-2', 'X', [{ matchKey: 'valido', description: 'valido', unitPrice: 0 }])
    ];

    const result = aggregateReceiptItems(receipts);
    expect(result).toHaveLength(0);
  });

  it('lida com lista de cupons vazia sem quebrar', () => {
    expect(aggregateReceiptItems([])).toEqual([]);
    expect(aggregateReceiptItems(undefined)).toEqual([]);
  });
});

describe('aggregateReceiptItemsByCity', () => {
  it('agrega separadamente por cidade, mesmo produto em cidades diferentes não se mistura', () => {
    const receipts = [
      receipt('user-1', 'Assai Atacadista', [
        { matchKey: 'arroz tio joao 5kg', description: 'Arroz Tio João 5kg', unitPrice: 26.50 }
      ], 'ourinhos sp'),
      receipt('user-2', 'Extra Supermercados', [
        { matchKey: 'arroz tio joao 5kg', description: 'Arroz Tio João 5kg', unitPrice: 28.90 }
      ], 'ourinhos sp'),
      receipt('user-3', 'Carrefour', [
        { matchKey: 'arroz tio joao 5kg', description: 'Arroz Tio João 5kg', unitPrice: 22.00 }
      ], 'sao paulo sp'),
      receipt('user-4', 'Pão de Açúcar', [
        { matchKey: 'arroz tio joao 5kg', description: 'Arroz Tio João 5kg', unitPrice: 24.00 }
      ], 'sao paulo sp')
    ];

    const result = aggregateReceiptItemsByCity(receipts);
    expect(result).toHaveLength(2);

    const ourinhos = result.find(r => r.docId === 'ourinhos sp__arroz tio joao 5kg');
    const saoPaulo = result.find(r => r.docId === 'sao paulo sp__arroz tio joao 5kg');

    expect(ourinhos).toMatchObject({ avgUnitPrice: 27.70, minUnitPrice: 26.50, distinctUsers: 2 });
    expect(saoPaulo).toMatchObject({ avgUnitPrice: 23.00, minUnitPrice: 22.00, distinctUsers: 2 });
  });

  it('ignora cupons sem citySlug (só entram no resumo geral, não no por-cidade)', () => {
    const receipts = [
      receipt('user-1', 'X', [{ matchKey: 'item', unitPrice: 10 }], null),
      receipt('user-2', 'Y', [{ matchKey: 'item', unitPrice: 12 }], null)
    ];

    expect(aggregateReceiptItemsByCity(receipts)).toEqual([]);
  });

  it('respeita o mínimo de usuários distintos por cidade (não só globalmente)', () => {
    const receipts = [
      receipt('user-1', 'X', [{ matchKey: 'item', unitPrice: 10 }], 'ourinhos sp'),
      receipt('user-2', 'Y', [{ matchKey: 'item', unitPrice: 12 }], 'sao paulo sp')
    ];

    // 2 usuários distintos no total, mas só 1 por cidade — nenhuma cidade atinge o mínimo
    expect(aggregateReceiptItemsByCity(receipts)).toEqual([]);
  });
});
