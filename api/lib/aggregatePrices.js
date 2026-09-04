const MIN_DISTINCT_USERS = 2;

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Agrega preços de itens de cupons de todos os usuários por matchKey (produto),
 * sem expor nenhum dado individual — só média, menor preço e quantas amostras.
 *
 * Um produto só entra no resultado se pelo menos MIN_DISTINCT_USERS pessoas
 * diferentes o compraram, pra nunca revelar o preço exato de uma única pessoa.
 *
 * @param {Array<{userId: string, storeName: string, itemsAvailable: boolean, items: Array}>} receipts
 * @returns {Array<{matchKey, sampleDescription, avgUnitPrice, minUnitPrice, minUnitPriceStore, sampleSize, distinctUsers}>}
 */
export function aggregateReceiptItems(receipts) {
  const totals = {};

  (receipts || []).forEach(receipt => {
    if (!receipt || !receipt.itemsAvailable) return;
    (receipt.items || []).forEach(item => {
      if (!item || !item.matchKey || !item.unitPrice || item.unitPrice <= 0) return;

      if (!totals[item.matchKey]) {
        totals[item.matchKey] = {
          matchKey: item.matchKey,
          sampleDescription: item.description || item.matchKey,
          sum: 0,
          count: 0,
          min: Infinity,
          minStore: '',
          userIds: new Set()
        };
      }

      const entry = totals[item.matchKey];
      entry.sum += item.unitPrice;
      entry.count += 1;
      if (receipt.userId) entry.userIds.add(receipt.userId);
      if (item.unitPrice < entry.min) {
        entry.min = item.unitPrice;
        entry.minStore = receipt.storeName || '';
      }
    });
  });

  return Object.values(totals)
    .filter(entry => entry.userIds.size >= MIN_DISTINCT_USERS)
    .map(entry => ({
      matchKey: entry.matchKey,
      sampleDescription: entry.sampleDescription,
      avgUnitPrice: round2(entry.sum / entry.count),
      minUnitPrice: round2(entry.min),
      minUnitPriceStore: entry.minStore,
      sampleSize: entry.count,
      distinctUsers: entry.userIds.size
    }));
}
