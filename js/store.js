/**
 * Store & Data Management
 * Rastreador de Preços - br.com.willian.rastreadorprecos
 * Developed by AugeFW (augefw.com)
 */

window.AppState = {
  theme: localStorage.getItem('theme_preference') || 'dark',
  lgpdAccepted: localStorage.getItem('lgpd_accepted') === 'true',
  monthlySpent: 0.00,
  personalIndex: "0.0%",
  itemsRising: [],
  shoppingList: [],
  stock: [],
  compareMarkets: [
    { name: "Assaí Atacadista", dist: "2,1 km · Centro", price: "R$ 0,00", fresh: "● aguardando cupons", best: true, stale: false },
    { name: "Pão de Açúcar", dist: "3,4 km · Jardim Europa", price: "R$ 0,00", fresh: "● aguardando cupons", best: false, stale: false },
    { name: "Extra Supermercados", dist: "1,3 km · Centro", price: "R$ 0,00", fresh: "○ aguardando cupons", best: false, stale: true }
  ]
};

// Local storage helper
window.saveState = function() {
  localStorage.setItem('rastreador_state_v2', JSON.stringify({
    shoppingList: window.AppState.shoppingList,
    stock: window.AppState.stock,
    monthlySpent: window.AppState.monthlySpent
  }));
};

window.loadState = function() {
  const saved = localStorage.getItem('rastreador_state_v2');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.shoppingList) window.AppState.shoppingList = parsed.shoppingList;
      if (parsed.stock) window.AppState.stock = parsed.stock;
      if (parsed.monthlySpent !== undefined) window.AppState.monthlySpent = parsed.monthlySpent;
    } catch(e) {
      console.error(e);
    }
  }
};

window.resetAllData = function() {
  localStorage.removeItem('rastreador_state');
  localStorage.removeItem('rastreador_state_v2');
  window.AppState.shoppingList = [];
  window.AppState.stock = [];
  window.AppState.monthlySpent = 0.00;
  window.AppState.itemsRising = [];
  window.saveState();
};

window.CATEGORY_RULES = [
  { category: 'Posto de Combustível', pattern: /POSTO|COMBUSTIVEL|AUTO POSTO/ },
  { category: 'Farmácia', pattern: /FARMA|DROGARIA|DROGASIL|PACHECO/ },
  { category: 'Bar/Restaurante', pattern: /\bBAR\b|RESTAURANTE|LANCHONETE|PIZZARIA|CHURRASCARIA|PADARIA|\bCAFE\b/ },
  { category: 'Mercado', pattern: /MERCADO|SUPERMERCADO|ATACAD|HIPERMERCADO|COMERCIO/ }
];

function categorizeStore(storeName) {
  const name = (storeName || '').toUpperCase();
  const match = window.CATEGORY_RULES.find(rule => rule.pattern.test(name));
  return match ? match.category : 'Outros';
}

function normalizeProductName(text) {
  const combiningDiacritics = new RegExp('[̀-ͯ]', 'g');
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(combiningDiacritics, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

window.StoreModule = {
  saveReceipt: function(receipt) {
    if (!window.auth || !window.auth.currentUser) {
      return Promise.reject(new Error('not-authenticated'));
    }
    if (!window.db) {
      return Promise.reject(new Error('firestore-unavailable'));
    }
    const uid = window.auth.currentUser.uid;
    const docRef = window.db.collection('users').doc(uid).collection('receipts').doc(receipt.chaveAcesso);

    return docRef.get().then(docSnapshot => {
      if (docSnapshot.exists) {
        const existing = docSnapshot.data();
        const isUpgradeFromFallback = !existing.itemsAvailable && receipt.itemsAvailable;
        if (!isUpgradeFromFallback) {
          return { duplicate: true };
        }
      }

      const itemsWithMatchKey = (receipt.items || []).map(item => Object.assign({}, item, {
        matchKey: normalizeProductName(item.description)
      }));
      return docRef.set(Object.assign({}, receipt, {
        items: itemsWithMatchKey,
        category: categorizeStore(receipt.storeName),
        scannedAt: firebase.firestore.FieldValue.serverTimestamp()
      }), { merge: true }).then(() => ({ duplicate: false }));
    });
  },

  loadReceipts: function() {
    if (!window.auth || !window.auth.currentUser || !window.db) {
      return Promise.resolve([]);
    }
    const uid = window.auth.currentUser.uid;
    return window.db
      .collection('users').doc(uid)
      .collection('receipts')
      .orderBy('scannedAt', 'desc')
      .get()
      .then(snapshot => snapshot.docs.map(doc => Object.assign({ id: doc.id }, doc.data())));
  },

  loadPriceComparisons: function() {
    return this.loadReceipts().then(receipts => {
      const entriesByMatchKey = {};

      receipts.forEach(r => {
        if (!r.itemsAvailable) return;
        (r.items || []).forEach(item => {
          if (!item.matchKey) return;
          if (!entriesByMatchKey[item.matchKey]) entriesByMatchKey[item.matchKey] = [];
          entriesByMatchKey[item.matchKey].push({
            description: item.description,
            unitPrice: item.unitPrice,
            storeName: r.storeName,
            storeAddress: r.storeAddress,
            emittedAt: r.emittedAt
          });
        });
      });

      return Object.values(entriesByMatchKey)
        .map(entries => {
          const latestByStore = {};
          entries.forEach(entry => {
            const existing = latestByStore[entry.storeName];
            if (!existing || entry.emittedAt > existing.emittedAt) {
              latestByStore[entry.storeName] = entry;
            }
          });
          return Object.values(latestByStore);
        })
        .filter(stores => stores.length >= 2)
        .map(stores => ({
          description: stores[0].description,
          stores: stores.sort((a, b) => a.unitPrice - b.unitPrice)
        }));
    });
  },

  addItemsToStock: function(items) {
    items.forEach(item => {
      const qty = Math.max(1, Math.round(item.quantity));
      const existing = item.code ? window.AppState.stock.find(s => s.code === item.code) : null;
      if (existing) {
        existing.qty += qty;
      } else {
        window.AppState.stock.push({
          id: 'stock-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
          code: item.code,
          name: item.description,
          qty: qty,
          meta: item.unit || 'via cupom fiscal',
          low: false
        });
      }
    });
    window.saveState();
  }
};
