import { describe, it, expect } from 'vitest';
import { aggregateReceiptItems } from './aggregatePrices.js';

function receipt(userId, storeName, items) {
  return { userId, storeName, itemsAvailable: true, items };
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
