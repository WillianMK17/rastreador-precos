/**
 * Real QR Code & NFC-e Scanner Module
 * Rastreador de Preços - br.com.willian.rastreadorprecos
 */

window.ScannerModule = {
  html5QrCode: null,
  isScanning: false,

  startCameraScanner: function(elementId, onSuccessCallback) {
    if (typeof Html5Qrcode === 'undefined') {
      console.warn("Html5Qrcode library not loaded.");
      return;
    }

    if (this.isScanning) return;

    this.html5QrCode = new Html5Qrcode(elementId);
    const config = {
      fps: 10,
      aspectRatio: 1.0,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
        const size = Math.floor(minEdge * 0.7);
        return { width: size, height: size };
      }
    };

    this.html5QrCode.start(
      { facingMode: "environment" },
      config,
      (decodedText, decodedResult) => {
        console.log("QR Code Scanned:", decodedText);
        this.stopScanner();
        onSuccessCallback(decodedText);
      },
      (errorMessage) => {
        // quiet scanning frame errors
      }
    ).then(() => {
      this.isScanning = true;
    }).catch(err => {
      console.warn("Camera access failed or denied:", err);
    });
  },

  stopScanner: function() {
    if (this.html5QrCode && this.isScanning) {
      this.html5QrCode.stop().then(() => {
        this.isScanning = false;
      }).catch(err => console.error(err));
    }
  },

  extractChaveFromQrUrl: function(qrCodeData) {
    try {
      const parsed = new URL(qrCodeData);
      const p = parsed.searchParams.get('p');
      if (!p) return null;
      const chave = p.split('|')[0];
      return /^\d{44}$/.test(chave) ? chave : null;
    } catch {
      return null;
    }
  },

  isSefazSpUrl: function(qrCodeData) {
    try {
      return new URL(qrCodeData).hostname === 'www.nfce.fazenda.sp.gov.br';
    } catch {
      return false;
    }
  },

  handleReceiptParsed: async function(qrCodeData) {
    const chave = this.extractChaveFromQrUrl(qrCodeData);

    if (!chave) {
      showAuthMessage("QR Code lido, mas não parece ser uma NFC-e válida.", "error");
      return;
    }

    if (!this.isSefazSpUrl(qrCodeData)) {
      showAuthMessage("Por enquanto só conseguimos ler cupons de São Paulo. A chave " + chave + " foi identificada, mas os itens não puderam ser buscados.", "error");
      return this._saveFallback(chave);
    }

    showAuthMessage("Cupom lido! Buscando os itens na SEFAZ...", "success");

    let apiResult;
    try {
      const response = await fetch('/api/parse-nfce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: qrCodeData })
      });
      apiResult = await response.json();
    } catch (err) {
      console.error("Erro ao buscar cupom na SEFAZ:", err);
      showAuthMessage("Não conseguimos buscar os itens agora, mas a chave foi registrada.", "error");
      return this._saveFallback(chave);
    }

    if (!apiResult || apiResult.ok !== true) {
      showAuthMessage("Cupom não encontrado na SEFAZ, mas a chave foi registrada.", "error");
      return this._saveFallback(chave);
    }

    const receipt = {
      chaveAcesso: apiResult.receipt.chaveAcesso || chave,
      storeName: apiResult.store.name,
      storeCnpj: apiResult.store.cnpj,
      storeAddress: apiResult.store.address,
      emittedAt: apiResult.receipt.emittedAt,
      totalValue: apiResult.receipt.totalValue,
      itemsAvailable: true,
      items: apiResult.items
    };

    try {
      await window.StoreModule.saveReceipt(receipt);
      window.StoreModule.addItemsToStock(receipt.items);
      showAuthMessage("Cupom Fiscal registrado com sucesso!", "success");
      if (window.go) window.go('history');
    } catch (err) {
      if (err.message === 'not-authenticated') {
        showAuthMessage("Entre com sua conta Google para guardar o histórico de cupons.", "error");
      } else {
        console.error("Erro ao salvar cupom:", err);
        showAuthMessage("Cupom lido, mas houve um erro ao salvar.", "error");
      }
    }
  },

  _saveFallback: async function(chave) {
    try {
      await window.StoreModule.saveReceipt({
        chaveAcesso: chave,
        storeName: '',
        storeCnpj: '',
        storeAddress: '',
        emittedAt: '',
        totalValue: 0,
        itemsAvailable: false,
        items: []
      });
      if (window.go) window.go('history');
    } catch (err) {
      if (err.message === 'not-authenticated') {
        showAuthMessage("Entre com sua conta Google para guardar o histórico de cupons.", "error");
      }
    }
  }
};
