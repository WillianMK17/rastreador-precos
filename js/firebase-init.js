/**
 * Firebase Service Initialization
 * Rastreador de Preços - br.com.willian.rastreadorprecos
 */

(function() {
  const cfg = window.APP_CONFIG.firebase;
  
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) {
      firebase.initializeApp(cfg);
    }
    
    window.db = firebase.firestore();
    window.auth = firebase.auth();

    // Enable offline persistence
    window.db.enablePersistence().catch(err => {
      console.warn("Firestore offline persistence state:", err.code);
    });

    // Monitor Auth State
    window.auth.onAuthStateChanged(user => {
      window.currentUser = user;
      const userBadge = document.getElementById('user-status');
      if (userBadge) {
        if (user) {
          userBadge.textContent = user.displayName || user.email.split('@')[0];
        } else {
          userBadge.textContent = "Convidado";
        }
      }
    });
  } else {
    console.warn("Firebase SDK not loaded, using local storage fallback mode.");
  }
})();
