import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSefazSpHtml } from './parseSefazSp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return readFileSync(join(__dirname, '__fixtures__', name), 'utf-8');
}

describe('parseSefazSpHtml', () => {
  it('extrai loja, itens e totais de um cupom válido', () => {
    const html = loadFixture('sefaz-sp-sample.html');
    const result = parseSefazSpHtml(html);

    expect(result.ok).toBe(true);
    expect(result.store).toEqual({
      name: 'IRMAOS MUFFATO E CIA LTDA',
      cnpj: '76.430.438/0106-49',
      address: 'RUA CARDOSO RIBEIRO, 861, VILA BOA ESPERANCA, Ourinhos, SP'
    });
    expect(result.receipt).toEqual({
      chaveAcesso: '35260876430438010649650040000368291004437688',
      emittedAt: '23/08/2026 18:38:00',
      totalValue: 29.03
    });
    expect(result.items).toEqual([
      { description: 'PAN PAO FRANC KG', code: '322173', quantity: 0.672, unit: 'Kg', unitPrice: 11.979167, totalPrice: 8.05 },
      { description: 'BEB L CAROLINA 1250G', code: '271905', quantity: 1, unit: 'Un', unitPrice: 9.99, totalPrice: 9.99 },
      { description: 'PAO KIM 400G', code: '296872', quantity: 1, unit: 'Un', unitPrice: 10.99, totalPrice: 10.99 }
    ]);
  });

  it('retorna ok:false quando a chave não é encontrada', () => {
    const html = loadFixture('sefaz-sp-not-found.html');
    const result = parseSefazSpHtml(html);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('items-not-found');
  });
});
