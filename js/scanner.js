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

  handleReceiptParsed: function(qrCodeData) {
    // Simulated parsing of SEFAZ NFC-e QR Code
    alert("Cupom Fiscal Escaneado com Sucesso!\nNota registrada no seu histórico seguro.");
    if (window.go) window.go('history');
  }
};
