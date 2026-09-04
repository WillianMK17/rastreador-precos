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

window.StoreModule = {
  saveReceipt: function(receipt) {
    if (!window.auth || !window.auth.currentUser) {
      return Promise.reject(new Error('not-authenticated'));
    }
    if (!window.db) {
      return Promise.reject(new Error('firestore-unavailable'));
    }
    const uid = window.auth.currentUser.uid;
    return window.db
      .collection('users').doc(uid)
      .collection('receipts').doc(receipt.chaveAcesso)
      .set(Object.assign({}, receipt, {
        scannedAt: firebase.firestore.FieldValue.serverTimestamp()
      }), { merge: true });
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
