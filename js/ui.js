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

// Viewport Device Mode Switcher (Computador, Tablet, Celular)
window.setViewportMode = function(mode) {
  const container = document.getElementById('app-container');
  if (!container) return;

  ['mode-mobile', 'mode-tablet', 'mode-desktop'].forEach(cls => container.classList.remove(cls));

  ['dev-btn-auto', 'dev-btn-desktop', 'dev-btn-tablet', 'dev-btn-mobile'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.remove('active');
  });

  const activeBtn = document.getElementById('dev-btn-' + mode);
  if (activeBtn) activeBtn.classList.add('active');

  if (mode !== 'auto') {
    container.classList.add('mode-' + mode);
  }
};

// Navigation Function
const screens = ['landing','auth','home','consent','scan','manual','history','compare','list','list-result','stock','month-detail','analysis'];

window.go = function(id) {
  screens.forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.remove('active');
  });
  
  const target = document.getElementById(id);
  if (target) target.classList.add('active');

  // Active Tab Highlight
  ['landing','home','scan','history','list','stock','auth','analysis'].forEach(t => {
    const tabEl = document.getElementById('tab-' + t);
    if (tabEl) tabEl.classList.remove('active');
  });

  const tabMap = { manual: 'scan', consent: 'scan', compare: 'history', 'list-result': 'list', 'month-detail': 'home' };
  const tabId = tabMap[id] || id;
  const activeTab = document.getElementById('tab-' + tabId);
  if (activeTab) activeTab.classList.add('active');

  // Trigger camera scanner when entering scan screen
  if (id === 'scan') {
    if (window.ScannerModule) {
      window.ScannerModule.startCameraScanner('qr-reader', (data) => {
        window.ScannerModule.handleReceiptParsed(data);
      });
    }
  } else if (id === 'history') {
    renderReceiptsHistory();
    if (window.ScannerModule) window.ScannerModule.stopScanner();
  } else if (id === 'home') {
    renderHomePanel();
    if (window.ScannerModule) window.ScannerModule.stopScanner();
  } else if (id === 'compare') {
    renderMarketComparison();
    if (window.ScannerModule) window.ScannerModule.stopScanner();
  } else if (id === 'month-detail') {
    renderMonthDetail();
    if (window.ScannerModule) window.ScannerModule.stopScanner();
  } else if (id === 'analysis') {
    renderProductAnalysis();
    if (window.ScannerModule) window.ScannerModule.stopScanner();
  } else {
    if (window.ScannerModule) window.ScannerModule.stopScanner();
  }
};

function formatBRL(value) {
  return 'R$ ' + (value || 0).toFixed(2).replace('.', ',');
}

function parseEmittedAtToTimestamp(str) {
  const m = (str || '').match(/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return 0;
  const [, dd, mm, yyyy, hh, min, ss] = m;
  return new Date(yyyy + '-' + mm + '-' + dd + 'T' + hh + ':' + min + ':' + ss).getTime();
}

function buildPriceTrendMap(receipts) {
  const flat = [];
  receipts.forEach(r => {
    if (!r.itemsAvailable) return;
    const timestamp = parseEmittedAtToTimestamp(r.emittedAt);
    (r.items || []).forEach(item => {
      if (!item.matchKey) return;
      flat.push({ matchKey: item.matchKey, unitPrice: item.unitPrice, timestamp });
    });
  });
  flat.sort((a, b) => a.timestamp - b.timestamp);

  const lastSeenPrice = {};
  const trendByKey = {};
  flat.forEach(entry => {
    const key = entry.matchKey + '|' + entry.timestamp;
    const previous = lastSeenPrice[entry.matchKey];
    if (previous !== undefined) {
      trendByKey[key] = entry.unitPrice > previous ? 'up' : (entry.unitPrice < previous ? 'down' : 'same');
    }
    lastSeenPrice[entry.matchKey] = entry.unitPrice;
  });
  return trendByKey;
}

function renderReceiptItemsList(receipt, trendMap) {
  if (!receipt.itemsAvailable || !receipt.items || receipt.items.length === 0) {
    return `<div class="item-meta" style="padding:8px 0 0; opacity:.7;">Itens indisponíveis para este cupom.</div>`;
  }
  const timestamp = parseEmittedAtToTimestamp(receipt.emittedAt);
  return receipt.items.map(item => {
    const trend = trendMap[item.matchKey + '|' + timestamp];
    const trendBadge = trend === 'up'
      ? ' <span style="color:var(--price-up);">▲</span>'
      : trend === 'down'
        ? ' <span style="color:var(--price-down);">▼</span>'
        : '';
    return `
    <div class="item-row" style="padding-top:8px; padding-bottom:8px; border-top:1px dashed var(--card-border);">
      <div class="item-meta">${item.description} <span style="opacity:.6;">(${item.quantity} ${item.unit})</span>${trendBadge}</div>
      <div style="font-family:var(--font-mono); font-size:13px;">${formatBRL(item.totalPrice)}</div>
    </div>
  `;
  }).join('');
}

function renderReceiptsHistory() {
  const container = document.getElementById('receipts-history-container');
  if (!container) return;

  container.innerHTML = `
    <div class="receipt-card" style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">
      Carregando cupons...
    </div>
  `;

  window.StoreModule.loadReceipts().then(receipts => {
    if (!receipts || receipts.length === 0) {
      container.innerHTML = `
        <div class="receipt-card" style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">
          Nenhum histórico detalhado registrado. Escaneie um cupom para comparar automaticamente.
        </div>
      `;
      return;
    }

    const trendMap = buildPriceTrendMap(receipts);

    container.innerHTML = receipts.map(r => `
      <div class="receipt-card" style="margin-bottom:12px;" data-id="${r.id}">
        <div class="item-row">
          <div>
            <div class="item-name">${r.billType ? (BILL_TYPE_LABELS[r.billType] || r.billType) + ' · ' : ''}${r.storeName || 'Loja não identificada'}</div>
            <div class="item-meta">${r.emittedAt || ''}${r.dueDate ? ' · vence ' + r.dueDate.split('-').reverse().join('/') : ''}</div>
          </div>
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="text-align:right;">
              <div style="font-family:var(--font-mono); font-weight:700; font-size:16px;">${formatBRL(r.totalValue)}</div>
            </div>
            <button class="btn-remove" title="Excluir lançamento" onclick="removeReceipt('${r.id}')">🗑️</button>
          </div>
        </div>
        ${renderReceiptItemsList(r, trendMap)}
      </div>
    `).join('');
  });
}

window.removeReceipt = function(id) {
  if (!confirm('Excluir este lançamento? Essa ação não pode ser desfeita.')) return;

  window.StoreModule.deleteReceipt(id).then(() => {
    renderReceiptsHistory();
  }).catch(err => {
    console.error('Erro ao excluir lançamento:', err);
    alert('Não foi possível excluir. Tente novamente.');
  });
};

function renderMarketComparison() {
  const container = document.getElementById('market-comparison-container');
  if (!container) return;

  container.innerHTML = `
    <div class="receipt-card" style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">
      Carregando comparações...
    </div>
  `;

  window.StoreModule.loadPriceComparisons().then(comparisons => {
    if (!comparisons || comparisons.length === 0) {
      container.innerHTML = `
        <div class="receipt-card" style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">
          Escaneie cupons de mercados diferentes para começar a comparar preços.
        </div>
      `;
      return;
    }

    container.innerHTML = comparisons.map(c => {
      const maxPrice = Math.max(...c.stores.map(s => s.unitPrice)) || 1;
      const ariaLabel = 'Comparação de preço de ' + c.description + ' entre ' +
        c.stores.map(s => s.storeName + ': ' + formatBRL(s.unitPrice)).join(', ');

      return `
      <div class="receipt-card" style="margin-bottom:12px;">
        <div class="item-name" style="margin-bottom:10px;">${c.description}</div>
        <div role="img" aria-label="${ariaLabel}">
          ${c.stores.map((s, i) => {
            const pct = Math.max(6, Math.round((s.unitPrice / maxPrice) * 100));
            return `
            <div class="compare-bar-row">
              <div class="compare-bar-label">${i === 0 ? '<span class="badge-best">MAIS BARATO</span> ' : ''}${s.storeName || 'Loja não identificada'}</div>
              <div class="compare-bar-track">
                <div class="compare-bar-fill${i === 0 ? ' best' : ''}" style="width:${pct}%"></div>
              </div>
              <div class="compare-bar-value">${formatBRL(s.unitPrice)}</div>
            </div>
          `;
          }).join('')}
        </div>
      </div>
    `;
    }).join('');
  });
}

const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function getReceiptDate(receipt) {
  const emittedTimestamp = parseEmittedAtToTimestamp(receipt.emittedAt);
  if (emittedTimestamp) return new Date(emittedTimestamp);
  if (receipt.scannedAt && typeof receipt.scannedAt.toDate === 'function') return receipt.scannedAt.toDate();
  return null;
}

function isReceiptInMonth(receipt, year, month) {
  const date = getReceiptDate(receipt);
  return !!date && date.getFullYear() === year && date.getMonth() === month;
}

function buildMonthlySpendingHistory(receipts) {
  const totalsByMonthKey = {};
  receipts.forEach(r => {
    const date = getReceiptDate(r);
    if (!date) return;
    const key = date.getFullYear() + '-' + date.getMonth();
    if (!totalsByMonthKey[key]) {
      totalsByMonthKey[key] = { year: date.getFullYear(), month: date.getMonth(), total: 0 };
    }
    totalsByMonthKey[key].total += (r.totalValue || 0);
  });
  return Object.values(totalsByMonthKey).sort((a, b) => (b.year - a.year) || (b.month - a.month));
}

function buildProductAveragePricesForMonth(receipts, year, month) {
  const sums = {};
  receipts.forEach(r => {
    if (!r.itemsAvailable || !isReceiptInMonth(r, year, month)) return;
    (r.items || []).forEach(item => {
      if (!item.matchKey) return;
      if (!sums[item.matchKey]) sums[item.matchKey] = { total: 0, count: 0 };
      sums[item.matchKey].total += item.unitPrice;
      sums[item.matchKey].count += 1;
    });
  });
  const averages = {};
  Object.keys(sums).forEach(key => {
    averages[key] = sums[key].total / sums[key].count;
  });
  return averages;
}

function calculatePersonalPriceIndex(receipts, year, month) {
  const prevMonthDate = new Date(year, month - 1, 1);
  const currentAverages = buildProductAveragePricesForMonth(receipts, year, month);
  const previousAverages = buildProductAveragePricesForMonth(receipts, prevMonthDate.getFullYear(), prevMonthDate.getMonth());

  const matchedKeys = Object.keys(currentAverages).filter(key => previousAverages[key] !== undefined);
  if (matchedKeys.length === 0) return null;

  const percentChanges = matchedKeys.map(key =>
    ((currentAverages[key] - previousAverages[key]) / previousAverages[key]) * 100
  );
  const avgChangePct = percentChanges.reduce((sum, v) => sum + v, 0) / percentChanges.length;

  return { changePct: avgChangePct, productCount: matchedKeys.length };
}

function renderHomePanel() {
  const valueEl = document.getElementById('home-total-spent-value');
  const subtitleEl = document.getElementById('home-total-spent-subtitle');
  const monthlyHistoryContainer = document.getElementById('home-monthly-history-container');
  const itemsContainer = document.getElementById('home-recent-items-container');
  const indexValueEl = document.getElementById('home-price-index-value');
  const indexPillEl = document.getElementById('home-price-index-pill');
  const indexSubtitleEl = document.getElementById('home-price-index-subtitle');
  if (!valueEl || !itemsContainer) return;

  window.StoreModule.loadReceipts().then(receipts => {
    const now = new Date();
    const receiptsThisMonth = receipts.filter(r => isReceiptInMonth(r, now.getFullYear(), now.getMonth()));

    const totalSpent = receiptsThisMonth.reduce((sum, r) => sum + (r.totalValue || 0), 0);
    valueEl.textContent = formatBRL(totalSpent);
    subtitleEl.textContent = receiptsThisMonth.length === 0
      ? 'Nenhum cupom escaneado ainda este mês.'
      : receiptsThisMonth.length + ' cupom(ns) escaneado(s) este mês.';

    if (indexValueEl && indexPillEl && indexSubtitleEl) {
      const index = calculatePersonalPriceIndex(receipts, now.getFullYear(), now.getMonth());
      if (!index) {
        indexValueEl.textContent = '0,0%';
        indexPillEl.textContent = '● baseline inicial';
        indexPillEl.className = 'trend-pill down';
        indexSubtitleEl.textContent = 'Compre os mesmos produtos em mais de um mês para começar a calcular.';
      } else {
        const sign = index.changePct > 0 ? '+' : '';
        indexValueEl.textContent = sign + index.changePct.toFixed(1).replace('.', ',') + '%';
        const isRising = index.changePct > 0;
        indexPillEl.textContent = isRising ? '▲ subindo' : (index.changePct < 0 ? '▼ descendo' : '● estável');
        indexPillEl.className = 'trend-pill' + (isRising ? '' : ' down');
        indexSubtitleEl.textContent = 'Baseado em ' + index.productCount + ' produto(s) recomprado(s) este mês vs. mês anterior.';
      }
    }

    if (monthlyHistoryContainer) {
      const monthlyHistory = buildMonthlySpendingHistory(receipts);
      monthlyHistoryContainer.innerHTML = monthlyHistory.length === 0
        ? `<div class="receipt-card" style="text-align:center; padding:16px; color:var(--text-muted); font-size:13px;">Sem histórico de meses anteriores ainda.</div>`
        : `<div class="receipt-card">
            ${monthlyHistory.map(m => `
              <div class="item-row" style="cursor:pointer;" onclick="window.openMonthDetail(${m.year}, ${m.month})">
                <div class="item-name">${MONTH_NAMES[m.month]} de ${m.year} ›</div>
                <div style="font-family:var(--font-mono); font-weight:700;">${formatBRL(m.total)}</div>
              </div>
            `).join('')}
          </div>`;
    }

    const recentItems = receipts
      .filter(r => r.itemsAvailable)
      .flatMap(r => r.items.map(item => Object.assign({}, item, { storeName: r.storeName })))
      .slice(0, 10);

    if (recentItems.length === 0) {
      itemsContainer.innerHTML = `
        <div class="receipt-card">
          <div style="text-align:center; padding:24px 10px; color:var(--text-muted); font-size:13.5px;">
            📄 Seu histórico está limpo. Escaneie um cupom fiscal abaixo para registrar seu primeiro produto!
          </div>
        </div>
      `;
      return;
    }

    itemsContainer.innerHTML = `
      <div class="receipt-card">
        ${recentItems.map(item => `
          <div class="item-row">
            <div>
              <div class="item-name">${item.description}</div>
              <div class="item-meta">${item.storeName || ''}</div>
            </div>
            <div style="font-family:var(--font-mono); font-weight:700;">${formatBRL(item.totalPrice)}</div>
          </div>
        `).join('')}
      </div>
    `;
  });
}

window.openMonthDetail = function(year, month) {
  window.SelectedMonth = { year, month };
  if (window.go) window.go('month-detail');
};

function renderMonthDetail() {
  const container = document.getElementById('month-detail-container');
  const titleEl = document.getElementById('month-detail-title');
  if (!container || !window.SelectedMonth) return;

  const { year, month } = window.SelectedMonth;
  if (titleEl) titleEl.textContent = MONTH_NAMES[month] + ' de ' + year;

  container.innerHTML = `
    <div class="receipt-card" style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">
      Carregando...
    </div>
  `;

  window.StoreModule.loadReceipts().then(receipts => {
    const receiptsInMonth = receipts.filter(r => isReceiptInMonth(r, year, month));
    const totalsByCategory = {};
    receiptsInMonth.forEach(r => {
      const cat = r.category || 'Outros';
      totalsByCategory[cat] = (totalsByCategory[cat] || 0) + (r.totalValue || 0);
    });

    const categories = Object.entries(totalsByCategory).sort((a, b) => b[1] - a[1]);

    if (categories.length === 0) {
      container.innerHTML = `
        <div class="receipt-card" style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">
          Nenhum cupom registrado neste mês.
        </div>
      `;
      return;
    }

    const maxValue = categories[0][1];

    container.innerHTML = `
      <div class="receipt-card">
        ${categories.map(([category, value], i) => {
          const pct = Math.max(6, Math.round((value / maxValue) * 100));
          return `
          <div class="compare-bar-row">
            <div class="compare-bar-label">${category}</div>
            <div class="compare-bar-track">
              <div class="compare-bar-fill${i === 0 ? ' best' : ''}" style="width:${pct}%"></div>
            </div>
            <div class="compare-bar-value">${formatBRL(value)}</div>
          </div>
        `;
        }).join('')}
      </div>
    `;
  });
}

function buildProductPriceHistory(receipts) {
  const byKey = {};
  receipts.forEach(r => {
    if (!r.itemsAvailable) return;
    const date = getReceiptDate(r);
    if (!date) return;
    (r.items || []).forEach(item => {
      if (!item.matchKey) return;
      if (!byKey[item.matchKey]) byKey[item.matchKey] = { description: item.description, entries: [] };
      byKey[item.matchKey].entries.push({ date, price: item.unitPrice, storeName: r.storeName });
    });
  });

  return Object.values(byKey)
    .map(product => {
      product.entries.sort((a, b) => a.date - b.date);
      return product;
    })
    .filter(product => product.entries.length >= 2);
}

function buildPriceLineChartSvg(entries) {
  const width = 280;
  const height = 90;
  const padX = 12;
  const padTop = 18;
  const padBottom = 18;
  const prices = entries.map(e => e.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice || 1;

  const chartWidth = width - padX * 2;
  const chartHeight = height - padTop - padBottom;
  const stepX = entries.length > 1 ? chartWidth / (entries.length - 1) : 0;

  const points = entries.map((e, i) => ({
    x: padX + stepX * i,
    y: padTop + chartHeight - ((e.price - minPrice) / range) * chartHeight,
    price: e.price
  }));

  const pathD = points.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
  const circles = points.map(p =>
    `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="var(--accent-gold)" stroke="var(--card-bg)" stroke-width="2" />`
  ).join('');

  const lastPoint = points[points.length - 1];
  const lastIndex = points.length - 1;
  const firstLabel = `<text x="${points[0].x}" y="${points[0].y - 10}" font-size="9" font-family="var(--font-mono)" fill="var(--text-muted)" text-anchor="start">${formatBRL(points[0].price)}</text>`;
  const lastLabel = `<text x="${lastPoint.x}" y="${lastPoint.y - 10}" font-size="9" font-family="var(--font-mono)" fill="var(--text-main)" font-weight="700" text-anchor="end">${formatBRL(lastPoint.price)}</text>`;

  const minIndex = prices.indexOf(minPrice);
  const maxIndex = prices.indexOf(maxPrice);
  let extremeLabels = '';
  if (minIndex !== 0 && minIndex !== lastIndex) {
    const p = points[minIndex];
    extremeLabels += `<text x="${p.x.toFixed(1)}" y="${p.y - 10}" font-size="9" font-family="var(--font-mono)" fill="var(--price-down)" text-anchor="middle">${formatBRL(p.price)}</text>`;
  }
  if (maxIndex !== 0 && maxIndex !== lastIndex && maxIndex !== minIndex) {
    const p = points[maxIndex];
    extremeLabels += `<text x="${p.x.toFixed(1)}" y="${p.y - 10}" font-size="9" font-family="var(--font-mono)" fill="var(--price-up)" text-anchor="middle">${formatBRL(p.price)}</text>`;
  }

  const monthLabels = entries.map((e, i) => {
    const label = MONTH_NAMES[e.date.getMonth()].slice(0, 3) + '/' + String(e.date.getFullYear()).slice(2);
    return `<text x="${points[i].x.toFixed(1)}" y="${height - 4}" font-size="8" font-family="var(--font-mono)" fill="var(--text-muted)" text-anchor="middle">${label}</text>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" style="width:100%; height:auto; display:block;" role="img" aria-label="Gráfico de evolução de preço">
      <path d="${pathD}" fill="none" stroke="var(--accent-gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      ${circles}
      ${firstLabel}
      ${lastLabel}
      ${extremeLabels}
      ${monthLabels}
    </svg>
  `;
}

function renderProductAnalysis() {
  const container = document.getElementById('analysis-container');
  if (!container) return;

  container.innerHTML = `
    <div class="receipt-card" style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">
      Carregando...
    </div>
  `;

  window.StoreModule.loadReceipts().then(receipts => {
    const products = buildProductPriceHistory(receipts);

    if (products.length === 0) {
      container.innerHTML = `
        <div class="receipt-card" style="text-align:center; padding:20px; color:var(--text-muted); font-size:13px;">
          Compre o mesmo produto mais de uma vez para ver a evolução do preço aqui.
        </div>
      `;
      return;
    }

    container.innerHTML = products.map(product => {
      const first = product.entries[0];
      const last = product.entries[product.entries.length - 1];
      const changePct = first.price ? ((last.price - first.price) / first.price) * 100 : 0;
      const isRising = changePct > 0;
      const trendText = isRising
        ? '▲ +' + changePct.toFixed(1).replace('.', ',') + '%'
        : changePct < 0
          ? '▼ ' + changePct.toFixed(1).replace('.', ',') + '%'
          : '● estável';
      const pillClass = 'trend-pill' + (isRising ? '' : ' down');

      return `
        <div class="receipt-card" style="margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; gap:8px;">
            <div class="item-name">${product.description}</div>
            <span class="${pillClass}" style="font-size:10px; flex-shrink:0;">${trendText}</span>
          </div>
          <div class="item-meta" style="margin-bottom:6px;">${product.entries.length} compras registradas</div>
          ${buildPriceLineChartSvg(product.entries)}
        </div>
      `;
    }).join('');
  });
}

window.recalculateCategories = function() {
  window.StoreModule.recategorizeAllReceipts().then(updatedCount => {
    alert(updatedCount > 0
      ? updatedCount + ' cupom(ns) tiveram a categoria corrigida.'
      : 'Nenhuma categoria precisou ser corrigida.');
    renderMonthDetail();
  });
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

// Auth Tab Switching ("login" vs "register")
window.switchAuthTab = function(mode) {
  const tabLogin = document.getElementById('auth-tab-login');
  const tabRegister = document.getElementById('auth-tab-register');
  const formLogin = document.getElementById('auth-form-login');
  const formRegister = document.getElementById('auth-form-register');
  const msg = document.getElementById('auth-message');

  if (msg) msg.style.display = 'none';

  if (mode === 'login') {
    if (tabLogin) tabLogin.classList.add('active');
    if (tabRegister) tabRegister.classList.remove('active');
    if (formLogin) formLogin.style.display = 'block';
    if (formRegister) formRegister.style.display = 'none';
  } else {
    if (tabRegister) tabRegister.classList.add('active');
    if (tabLogin) tabLogin.classList.remove('active');
    if (formRegister) formRegister.style.display = 'block';
    if (formLogin) formLogin.style.display = 'none';
  }
};

// Auth Submit Handlers
window.handleEmailLogin = function(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const pass = document.getElementById('login-pass').value;
  window.AuthModule.loginWithEmail(email, pass);
};

window.handleEmailRegister = function(e) {
  e.preventDefault();
  const name = document.getElementById('reg-name').value;
  const email = document.getElementById('reg-email').value;
  const pass = document.getElementById('reg-pass').value;
  window.AuthModule.registerWithEmail(name, email, pass);
};

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

window.addStockItem = function(name, qty, meta) {
  const item = {
    id: 'stock-' + Date.now(),
    name: name,
    qty: qty || 1,
    meta: meta || 'adicionado recentemente',
    level: 100,
    low: false,
    source: 'manual'
  };
  window.AppState.stock.push(item);
  renderStock();
  window.saveState();
};

function renderStock() {
  const container = document.getElementById('stock-container');
  if (!container) return;

  if (!window.AppState.stock || window.AppState.stock.length === 0) {
    container.innerHTML = `
      <div class="receipt-card" style="text-align:center; padding:30px 20px;">
        <div style="font-size:32px; margin-bottom:8px;">📦</div>
        <div style="font-weight:700; font-size:15px; margin-bottom:4px;">Seu estoque está limpo</div>
        <div style="color:var(--text-muted); font-size:13px; max-width:280px; margin:0 auto;">
          Cadastre um produto acima para acompanhar a despensa da sua casa.
        </div>
      </div>
    `;
    return;
  }

  container.innerHTML = window.AppState.stock.map(item => `
    <div class="receipt-card stock-row" data-id="${item.id}" style="margin-bottom:12px;">
      <div style="flex:1;">
        <div class="item-name">${item.name}</div>
        <div class="item-meta">${item.qty} un · ${item.meta}</div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill ${item.low ? 'low' : ''}" style="width: ${item.qty > 0 ? Math.min(100, (item.qty * 25)) + '%' : '5%'}"></div>
        </div>
      </div>
      <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">
        <div class="stock-ctrls">
          <button class="btn-qty" onclick="stockAdjust(this, -1)">−</button>
          <span class="qty-val">${item.qty}</span>
          <button class="btn-qty" onclick="stockAdjust(this, 1)">+</button>
        </div>
        <button class="btn-remove" title="Excluir item" onclick="removeStockItem('${item.id}')">🗑️</button>
      </div>
    </div>
  `).join('');
}

window.addStockItemManual = function() {
  const input = document.getElementById('stock-input-field');
  if (!input || !input.value.trim()) return;
  window.addStockItem(input.value.trim(), 1, 'cadastrado manualmente');
  input.value = '';
};

window.removeStockItem = function(id) {
  window.AppState.stock = window.AppState.stock.filter(s => s.id !== id);
  renderStock();
  window.saveState();
};

// Manual Bill Entry (água, luz, celular, internet, aluguel)
const BILL_TYPE_LABELS = {
  agua: 'Água',
  luz: 'Luz',
  celular: 'Celular',
  internet: 'Internet',
  aluguel: 'Aluguel',
  outra_conta: 'Outra conta'
};

let selectedBillType = 'agua';

window.selectBillType = function(el, type) {
  selectedBillType = type;
  el.parentElement.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
};

window.saveManualBill = function() {
  const providerInput = document.getElementById('bill-provider');
  const priceInput = document.getElementById('bill-price');
  const dueDateInput = document.getElementById('bill-due-date');
  const provider = (providerInput.value || '').trim();
  const price = parseFloat(priceInput.value || 0);
  const dueDateValue = dueDateInput ? dueDateInput.value : '';

  if (!provider || !price) {
    alert('Preencha a concessionária e o valor da conta.');
    return;
  }

  const pad = n => String(n).padStart(2, '0');
  const now = new Date();

  // Com vencimento informado, a conta entra no mês do vencimento (não no mês do lançamento)
  let emittedAt;
  if (dueDateValue) {
    const [yyyy, mm, dd] = dueDateValue.split('-');
    emittedAt = dd + '/' + mm + '/' + yyyy + ' 12:00:00';
  } else {
    emittedAt = pad(now.getDate()) + '/' + pad(now.getMonth() + 1) + '/' + now.getFullYear() + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':00';
  }

  const billTypeLabel = BILL_TYPE_LABELS[selectedBillType] || 'Outra conta';

  const receipt = {
    chaveAcesso: 'manual-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    storeName: provider,
    storeCnpj: '',
    storeAddress: '',
    emittedAt: emittedAt,
    dueDate: dueDateValue || null,
    billType: selectedBillType,
    // Categoria fixa, independente do nome da concessionária reconhecer ou não
    // um padrão conhecido — resolve o caso de contas caindo em "Outros".
    category: 'Contas Fixas',
    totalValue: price,
    itemsAvailable: true,
    source: 'manual',
    items: [{
      description: billTypeLabel + ' · ' + provider,
      code: '',
      quantity: 1,
      unit: 'mês',
      unitPrice: price,
      totalPrice: price
    }]
  };

  window.StoreModule.saveReceipt(receipt).then(result => {
    if (result && result.duplicate) {
      alert('Essa conta já parece ter sido registrada.');
      return;
    }
    providerInput.value = '';
    priceInput.value = '';
    if (dueDateInput) dueDateInput.value = '';
    alert('Conta registrada com sucesso!');
    if (window.go) window.go('history');
  }).catch(err => {
    if (err.message === 'not-authenticated') {
      alert('Entre com sua conta Google para guardar o histórico de contas.');
    } else {
      console.error('Erro ao salvar conta manual:', err);
      alert('Houve um erro ao salvar a conta.');
    }
  });
};

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

  if (!window.AppState.shoppingList || window.AppState.shoppingList.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:24px 14px; color:var(--text-muted); font-size:13.5px;">
        🛒 Sua lista está vazia. Digite um produto acima e clique no botão <b>+</b> para adicionar!
      </div>
    `;
    return;
  }

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
