/**
 * Store & Data Management
 * Rastreador de Preços - br.com.willian.rastreadorprecos
 */

window.AppState = {
  theme: localStorage.getItem('theme_preference') || 'dark',
  lgpdAccepted: localStorage.getItem('lgpd_accepted') === 'true',
  monthlySpent: 1284.60,
  personalIndex: "+4,7%",
  itemsRising: [
    { name: "Arroz Tio João 5kg", market: "Extra Supermercados", priceUnit: "R$ 5,78/kg", change: "▲ 12,4%", down: false },
    { name: "Gasolina comum", market: "Posto Ipiranga", priceUnit: "R$ 6,29/l", change: "▲ 6,8%", down: false },
    { name: "Óleo de soja 900ml", market: "Assaí Atacadista", priceUnit: "R$ 10,44/l", change: "▲ 9,0%", note: "embalagem 900ml, antes 1l", down: false }
  ],
  shoppingList: [
    { id: 1, name: "Tomate", checked: true },
    { id: 2, name: "Cebola", checked: true },
    { id: 3, name: "Arroz Tio João 5kg", checked: true },
    { id: 4, name: "Feijão carioca 1kg", checked: true }
  ],
  stock: [
    { id: 'gtin-1', name: "Arroz Tio João 5kg", qty: 2, meta: "2 pacotes · dura ~25 dias cada", level: 80, low: false },
    { id: 'gtin-2', name: "Óleo de soja 900ml", qty: 0, meta: "acabando", level: 15, low: true },
    { id: 'gtin-3', name: "Feijão carioca 1kg", qty: 1, meta: "1 pacote", level: 50, low: false }
  ],
  compareMarkets: [
    { name: "Assaí Atacadista", dist: "2,1 km · Centro", price: "R$ 26,50", fresh: "● atualizado há 2 dias", best: true, stale: false },
    { name: "Pão de Açúcar", dist: "3,4 km · Jardim Europa", price: "R$ 27,90", fresh: "● atualizado há 4 dias", best: false, stale: false },
    { name: "Extra Supermercados", dist: "1,3 km · Centro", price: "R$ 28,90", fresh: "○ há 11 dias · pode ter mudado", best: false, stale: true }
  ]
};

// Local storage helper
window.saveState = function() {
  localStorage.setItem('rastreador_state', JSON.stringify({
    shoppingList: window.AppState.shoppingList,
    stock: window.AppState.stock
  }));
};

window.loadState = function() {
  const saved = localStorage.getItem('rastreador_state');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.shoppingList) window.AppState.shoppingList = parsed.shoppingList;
      if (parsed.stock) window.AppState.stock = parsed.stock;
    } catch(e) {
      console.error(e);
    }
  }
};
