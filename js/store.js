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
      // Descarta itens de estoque que vieram de cupom escaneado (recurso removido) —
      // Estoque agora é só o que o usuário cadastra manualmente.
      if (parsed.stock) window.AppState.stock = parsed.stock.filter(item => item.source === 'manual');
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
  { category: 'Posto de Combustível', pattern: /POSTO|COMBUSTIVEL|AUTO POSTO|IPIRANGA|SHELL|PETROBRAS|ALESAT/ },
  { category: 'Farmácia', pattern: /FARMA|DROGARIA|DROGASIL|PACHECO|RAIA|PAGUE MENOS|EXTRAFARMA|VENANCIO/ },
  { category: 'Bar/Restaurante', pattern: /\bBAR\b|RESTAURANTE|LANCHONETE|PIZZARIA|CHURRASCARIA|PADARIA|\bCAFE\b/ },
  {
    category: 'Contas Fixas',
    pattern: /\bCPFL\b|\bENEL\b|ELEKTRO|\bLIGHT\b|\bCOPEL\b|\bCEMIG\b|EQUATORIAL|CELESC|\bRGE\b|COELBA|CELPE|COSERN|\bCEEE\b|\bAMPLA\b|SABESP|COPASA|CAGECE|CORSAN|EMBASA|CEDAE|COMPESA|\bCAESB\b|SANEPAR|\bVIVO\b|\bCLARO\b|\bTIM\b|\bOI\b\s|\bNET\b|\bSKY\b|\bALGAR\b|NEXTEL/
  },
  {
    category: 'Mercado',
    pattern: /MERCADO|SUPERMERCADO|ATACAD|HIPERMERCADO|COMERCIO|MUFFATO|ASSAI|EXTRA|CARREFOUR|PAO DE ACUCAR|WALMART|\bBIG\b|\bDIA\b|ANGELONI|\bCOOP\b|ZAFFARI|BRETAS|SAVEGNAGO|GBARBOSA|NAGUMO|COMPER|CONDOR|MAKRO|SAMS CLUB|TENDA|ST MARCHE|SUPER NOSSO|MUNDIAL|GUANABARA|EMPORIO/
  }
];

function categorizeStore(storeName) {
  const name = (storeName || '').toUpperCase();
  const match = window.CATEGORY_RULES.find(rule => rule.pattern.test(name));
  return match ? match.category : 'Outros';
}

window.ITEM_CATEGORY_RULES = [
  {
    category: 'Farmácia',
    pattern: /CLORIDRATO|SULFATO DE|SUCCINATO|MALEATO|BESILATO|CITRATO DE|BROMIDRATO|FUMARATO|DIPIRONA|PARACETAMOL|IBUPROFENO|AMOXICILINA|AZITROMICINA|OMEPRAZOL|LOSARTANA|ANLODIPINO|SINVASTATINA|METFORMINA|LORATADINA|DIPROSPAN|NIMESULIDA|CETOPROFENO|VITAMINA\s?[A-Z]?\d*|COMPRIMIDO|COMP\s?\d|CAPSULA|XAROPE|POMADA|GENERICO|ANTIALERGICO|ANALGESICO|ANTIBIOTICO|PROTETOR SOLAR FPS|ABSORVENTE|FRALDA GERIATRICA/
  },
  {
    category: 'Pet',
    pattern: /RACAO|PETISCO|AREIA SANITARIA|SANITARIO GATO|COLEIRA|BRINQUEDO PET|SHAMPOO PET|TAPETE HIGIENICO/
  },
  {
    category: 'Vestuário',
    pattern: /CAMISETA|CALCA JEANS|\bBERMUDA\b|\bVESTIDO\b|\bBLUSA\b|\bCAMISA\b|\bSHORT\b|\bMEIA[S]?\b|\bCUECA\b|\bSUTIA\b|\bJAQUETA\b|\bCASACO\b|\bTENIS\b|SANDALIA|\bCHINELO\b/
  }
];

function categorizeItems(items) {
  if (!items || items.length === 0) return null;
  const match = window.ITEM_CATEGORY_RULES.find(rule =>
    items.some(item => rule.pattern.test((item.description || '').toUpperCase()))
  );
  return match ? match.category : null;
}

const STRONG_STORE_CATEGORIES = ['Posto de Combustível', 'Farmácia', 'Bar/Restaurante', 'Contas Fixas'];

function categorizeReceipt(storeName, items) {
  const storeCategory = categorizeStore(storeName);
  if (STRONG_STORE_CATEGORIES.includes(storeCategory)) {
    return storeCategory;
  }
  return categorizeItems(items) || storeCategory;
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
        // Categoria explícita (ex: lançamento manual de conta) tem prioridade
        // sobre a detecção automática pelo nome da loja/concessionária.
        category: receipt.category || categorizeReceipt(receipt.storeName, receipt.items),
        scannedAt: firebase.firestore.FieldValue.serverTimestamp()
      }), { merge: true }).then(() => ({ duplicate: false }));
    });
  },

  deleteReceipt: function(chaveAcesso) {
    if (!window.auth || !window.auth.currentUser) {
      return Promise.reject(new Error('not-authenticated'));
    }
    if (!window.db) {
      return Promise.reject(new Error('firestore-unavailable'));
    }
    const uid = window.auth.currentUser.uid;
    return window.db.collection('users').doc(uid).collection('receipts').doc(chaveAcesso).delete();
  },

  recategorizeAllReceipts: function() {
    if (!window.auth || !window.auth.currentUser || !window.db) {
      return Promise.resolve(0);
    }
    const uid = window.auth.currentUser.uid;
    const receiptsRef = window.db.collection('users').doc(uid).collection('receipts');

    return receiptsRef.get().then(snapshot => {
      const updates = [];
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        const correctCategory = categorizeReceipt(data.storeName, data.items);
        if (data.category !== correctCategory) {
          updates.push(doc.ref.update({ category: correctCategory }));
        }
      });
      return Promise.all(updates).then(() => updates.length);
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
  }
};
