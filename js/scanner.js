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
      return this.html5QrCode.stop().then(() => {
        this.isScanning = false;
      }).catch(err => console.error(err));
    }
    return Promise.resolve();
  },

  scanFromFile: function(file) {
    if (!file) return;
    if (typeof Html5Qrcode === 'undefined') {
      console.warn("Html5Qrcode library not loaded.");
      return;
    }

    const runScan = () => {
      if (!this.html5QrCode) {
        this.html5QrCode = new Html5Qrcode('qr-reader');
      }
      this.html5QrCode.scanFile(file, false)
        .then(decodedText => {
          console.log("QR Code lido de foto:", decodedText);
          this.handleReceiptParsed(decodedText);
        })
        .catch(err => {
          console.warn("Não foi possível ler QR Code na foto:", err);
          showScanMessage("Não conseguimos encontrar um QR Code nessa foto. Tente tirar mais de perto, com boa luz.", "error");
          this.startCameraScanner('qr-reader', (data) => this.handleReceiptParsed(data));
        });
    };

    this.stopScanner().then(runScan);
  },

  scanReceiptPhoto: async function(file) {
    if (!file) return;

    await this.stopScanner();
    showScanMessage("Foto recebida! Lendo os itens do cupom com IA...", "success");

    let imageBase64;
    try {
      imageBase64 = await this._fileToBase64(file);
    } catch (err) {
      console.error("Erro ao ler a foto:", err);
      showScanMessage("Não conseguimos abrir essa foto. Tente novamente.", "error");
      return;
    }

    let apiResult;
    try {
      const response = await fetch('/api/parse-receipt-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mimeType: file.type || 'image/jpeg' })
      });
      apiResult = await response.json();
    } catch (err) {
      console.error("Erro ao enviar foto para leitura:", err);
      showScanMessage("Não conseguimos ler essa foto agora. Tente de novo ou lance manualmente.", "error");
      return;
    }

    if (!apiResult || apiResult.ok !== true) {
      showScanMessage("Não conseguimos identificar um cupom fiscal nessa foto. Tente uma foto mais nítida ou lance manualmente.", "error");
      return;
    }

    const receipt = {
      chaveAcesso: 'foto-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      storeName: apiResult.store.name,
      storeCnpj: apiResult.store.cnpj,
      storeAddress: apiResult.store.address,
      emittedAt: apiResult.receipt.emittedAt,
      totalValue: apiResult.receipt.totalValue,
      itemsAvailable: true,
      source: 'photo',
      // A IA já sabe se é fatura de consumo mesmo sem reconhecer o nome da
      // concessionária — usamos isso em vez de depender só do regex de nome.
      category: apiResult.isUtilityBill ? 'Contas Fixas' : undefined,
      items: apiResult.items
    };

    try {
      await window.StoreModule.saveReceipt(receipt);
      showScanMessage("Cupom lido e registrado com sucesso!", "success");
      if (window.go) window.go('history');
    } catch (err) {
      if (err.message === 'not-authenticated') {
        showScanMessage("Entre com sua conta Google para guardar o histórico de cupons.", "error");
      } else {
        console.error("Erro ao salvar cupom da foto:", err);
        showScanMessage("Cupom lido, mas houve um erro ao salvar.", "error");
      }
    }
  },

  _fileToBase64: function(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        const base64 = result.substring(result.indexOf(',') + 1);
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
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
      showScanMessage("QR Code lido, mas não parece ser uma NFC-e válida.", "error");
      return;
    }

    if (!this.isSefazSpUrl(qrCodeData)) {
      showScanMessage("Por enquanto só conseguimos ler cupons de São Paulo. A chave " + chave + " foi identificada, mas os itens não puderam ser buscados.", "error");
      return this._saveFallback(chave);
    }

    showScanMessage("Cupom lido! Buscando os itens na SEFAZ...", "success");

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
      showScanMessage("Não conseguimos buscar os itens agora, mas a chave foi registrada.", "error");
      return this._saveFallback(chave);
    }

    if (!apiResult || apiResult.ok !== true) {
      showScanMessage("Cupom não encontrado na SEFAZ, mas a chave foi registrada.", "error");
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
      const result = await window.StoreModule.saveReceipt(receipt);
      if (result && result.duplicate) {
        showScanMessage("Esse cupom já tinha sido lido antes — não foi registrado de novo.", "error");
        return;
      }
      showScanMessage("Cupom Fiscal registrado com sucesso!", "success");
      if (window.go) window.go('history');
    } catch (err) {
      if (err.message === 'not-authenticated') {
        showScanMessage("Entre com sua conta Google para guardar o histórico de cupons.", "error");
      } else {
        console.error("Erro ao salvar cupom:", err);
        showScanMessage("Cupom lido, mas houve um erro ao salvar.", "error");
      }
    }
  },

  _saveFallback: async function(chave) {
    try {
      const result = await window.StoreModule.saveReceipt({
        chaveAcesso: chave,
        storeName: '',
        storeCnpj: '',
        storeAddress: '',
        emittedAt: '',
        totalValue: 0,
        itemsAvailable: false,
        items: []
      });
      if (result && result.duplicate) {
        showScanMessage("Esse cupom já tinha sido lido antes — não foi registrado de novo.", "error");
        return;
      }
      if (window.go) window.go('history');
    } catch (err) {
      if (err.message === 'not-authenticated') {
        showScanMessage("Entre com sua conta Google para guardar o histórico de cupons.", "error");
      }
    }
  }
};
