/**
 * UI Controller & Interactivity
 * Rastreador de Preços - br.com.willian.rastreadorprecos
 * Developed by AugeFW (augefw.com)
 */

document.addEventListener('DOMContentLoaded', () => {
  window.loadState();
  initTheme();
  initLGPD();
  renderShoppingList();
  renderStock();
});

// Navigation Function
const screens = ['home','consent','scan','manual','history','compare','list','list-result','stock'];

window.go = function(id) {
  screens.forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.remove('active');
  });
  
  const target = document.getElementById(id);
  if (target) target.classList.add('active');

  // Active Tab Highlight
  ['home','scan','history','list','stock'].forEach(t => {
    const tabEl = document.getElementById('tab-' + t);
    if (tabEl) tabEl.classList.remove('active');
  });

  const tabMap = { manual: 'scan', consent: 'scan', compare: 'history', 'list-result': 'list' };
  const tabId = tabMap[id] || id;
  const activeTab = document.getElementById('tab-' + tabId);
  if (activeTab) activeTab.classList.add('active');

  // Trigger camera scanner when entering scan screen
  if (id === 'scan') {
    window.ScannerModule.startCameraScanner('qr-reader', (data) => {
      window.ScannerModule.handleReceiptParsed(data);
    });
  } else {
    window.ScannerModule.stopScanner();
  }
};

// Theme Controller (Escuro Terroso vs Claro Pastel Moderno)
function initTheme() {
  const currentTheme = window.AppState.theme;
  document.documentElement.setAttribute('data-theme', currentTheme);
  updateThemeIcon(currentTheme);
}

window.toggleTheme = function() {
  const nextTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', nextTheme);
  window.AppState.theme = nextTheme;
  localStorage.setItem('theme_preference', nextTheme);
  updateThemeIcon(nextTheme);
};

function updateThemeIcon(theme) {
  const label = document.getElementById('theme-toggle-label');
  if (label) {
    label.textContent = theme === 'light' ? '☀️ Claro' : '🌙 Escuro';
  }
}

// LGPD Fixed Banner Controller
function initLGPD() {
  const banner = document.getElementById('lgpd-banner');
  if (banner) {
    if (window.AppState.lgpdAccepted) {
      banner.style.display = 'none';
    } else {
      banner.style.display = 'flex';
    }
  }
}

window.acceptLGPD = function() {
  window.AppState.lgpdAccepted = true;
  localStorage.setItem('lgpd_accepted', 'true');
  const banner = document.getElementById('lgpd-banner');
  if (banner) banner.style.display = 'none';
};

// Stock Adjustments
window.stockAdjust = function(btn, delta) {
  const row = btn.closest('.stock-row');
  const qtyEl = row.querySelector('.qty-val');
  let qty = Math.max(0, parseInt(qtyEl.textContent) + delta);
  qtyEl.textContent = qty;
  
  const id = row.getAttribute('data-id');
  const item = window.AppState.stock.find(s => s.id === id);
  if (item) {
    item.qty = qty;
    window.saveState();
  }
};

window.emptyStockItem = function(id) {
  const item = window.AppState.stock.find(s => s.id === id);
  if (item) {
    item.qty = 0;
    renderStock();
    window.saveState();
  }
};

function renderStock() {
  const container = document.getElementById('stock-container');
  if (!container) return;

  container.innerHTML = window.AppState.stock.map(item => `
    <div class="receipt-card stock-row" data-id="${item.id}" style="margin-bottom:12px;">
      <div style="flex:1;">
        <div class="item-name">${item.name}</div>
        <div class="item-meta">${item.qty} pacotes · ${item.meta}</div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill ${item.low ? 'low' : ''}" style="width: ${item.qty > 0 ? (item.qty * 40) + '%' : '5%'}"></div>
        </div>
      </div>
      <div class="stock-ctrls">
        <button class="btn-qty" onclick="stockAdjust(this, -1)">−</button>
        <span class="qty-val">${item.qty}</span>
        <button class="btn-qty" onclick="stockAdjust(this, 1)">+</button>
      </div>
    </div>
  `).join('');
}

// Shopping List Controller
window.addListItem = function() {
  const input = document.getElementById('list-input-field');
  if (!input || !input.value.trim()) return;

  const newItem = {
    id: Date.now(),
    name: input.value.trim(),
    checked: true
  };

  window.AppState.shoppingList.push(newItem);
  input.value = '';
  renderShoppingList();
  window.saveState();
};

window.removeListItem = function(id) {
  window.AppState.shoppingList = window.AppState.shoppingList.filter(i => i.id !== id);
  renderShoppingList();
  window.saveState();
};

function renderShoppingList() {
  const container = document.getElementById('shopping-list-container');
  if (!container) return;

  container.innerHTML = window.AppState.shoppingList.map(item => `
    <div class="list-row">
      <input type="checkbox" ${item.checked ? 'checked' : ''} onchange="toggleItemChecked(${item.id})">
      <div class="item-name" style="flex:1;">${item.name}</div>
      <button style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:12px;" onclick="removeListItem(${item.id})">remover</button>
    </div>
  `).join('');
}

window.toggleItemChecked = function(id) {
  const item = window.AppState.shoppingList.find(i => i.id === id);
  if (item) {
    item.checked = !item.checked;
    window.saveState();
  }
};

window.strategy = function(mode) {
  document.getElementById('strat-single')?.classList.toggle('active', mode === 'single');
  document.getElementById('strat-split')?.classList.toggle('active', mode === 'split');
  
  const singleView = document.getElementById('single-view');
  const splitView = document.getElementById('split-view');
  if (singleView) singleView.style.display = mode === 'single' ? 'block' : 'none';
  if (splitView) splitView.style.display = mode === 'split' ? 'block' : 'none';
};
