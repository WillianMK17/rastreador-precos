const MIN_DISTINCT_USERS = 2;

function round2(n) {
  return Math.round(n * 100) / 100;
}

function aggregateByKey(receipts, keyFn) {
  const totals = {};

  (receipts || []).forEach(receipt => {
    if (!receipt || !receipt.itemsAvailable) return;
    (receipt.items || []).forEach(item => {
      if (!item || !item.matchKey || !item.unitPrice || item.unitPrice <= 0) return;

      const key = keyFn(receipt, item);
      if (key === null) return;

      if (!totals[key]) {
        totals[key] = {
          matchKey: item.matchKey,
          sampleDescription: item.description || item.matchKey,
          sum: 0,
          count: 0,
          min: Infinity,
          minStore: '',
          userIds: new Set()
        };
      }

      const entry = totals[key];
      entry.sum += item.unitPrice;
      entry.count += 1;
      if (receipt.userId) entry.userIds.add(receipt.userId);
      if (item.unitPrice < entry.min) {
        entry.min = item.unitPrice;
        entry.minStore = receipt.storeName || '';
      }
    });
  });

  return Object.entries(totals)
    .filter(([, entry]) => entry.userIds.size >= MIN_DISTINCT_USERS)
    .map(([docId, entry]) => ({
      docId,
      matchKey: entry.matchKey,
      sampleDescription: entry.sampleDescription,
      avgUnitPrice: round2(entry.sum / entry.count),
      minUnitPrice: round2(entry.min),
      minUnitPriceStore: entry.minStore,
      sampleSize: entry.count,
      distinctUsers: entry.userIds.size
    }));
}

/**
 * Agrega preços de itens de cupons de todos os usuários por matchKey (produto),
 * ignorando cidade — é o resumo "geral" (todas as cidades juntas).
 *
 * Um produto só entra no resultado se pelo menos MIN_DISTINCT_USERS pessoas
 * diferentes o compraram, pra nunca revelar o preço exato de uma única pessoa.
 *
 * @param {Array<{userId, storeName, itemsAvailable, items}>} receipts
 * @returns {Array<{docId, matchKey, sampleDescription, avgUnitPrice, minUnitPrice, minUnitPriceStore, sampleSize, distinctUsers}>}
 */
export function aggregateReceiptItems(receipts) {
  return aggregateByKey(receipts, (receipt, item) => item.matchKey);
}

/**
 * Mesma agregação, mas separada por cidade (receipt.citySlug) — cada produto
 * gera um resumo por cidade, com docId "{citySlug}__{matchKey}". Cupons sem
 * citySlug não entram aqui (só no resumo geral).
 *
 * @param {Array<{userId, storeName, citySlug, itemsAvailable, items}>} receipts
 * @returns {Array<{docId, matchKey, sampleDescription, avgUnitPrice, minUnitPrice, minUnitPriceStore, sampleSize, distinctUsers}>}
 */
export function aggregateReceiptItemsByCity(receipts) {
  return aggregateByKey(receipts, (receipt, item) =>
    receipt.citySlug ? receipt.citySlug + '__' + item.matchKey : null
  );
}
