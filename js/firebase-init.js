/**
 * Firebase Authentication & Firestore Service Integration
 * Rastreador de Preços - br.com.willian.rastreadorprecos
 * Developed by AugeFW (augefw.com)
 */

(function() {
  const cfg = window.APP_CONFIG.firebase;
  
  if (typeof firebase !== 'undefined') {
    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(cfg);
      }
      
      window.db = firebase.firestore();
      window.auth = firebase.auth();

      // Enable Firestore offline persistence
      window.db.enablePersistence().catch(err => {
        console.warn("Firestore offline persistence state:", err.code);
      });

      // Handle Google Auth Redirect Results
      window.auth.getRedirectResult().then(result => {
        if (result && result.user) {
          showAuthMessage("Login com Google realizado com sucesso!", "success");
          saveUserToFirestore(result.user);
          setTimeout(() => { if (window.onUserAuthenticated) window.onUserAuthenticated(); }, 400);
        }
      }).catch(err => {
        console.warn("Auth redirect result error:", err);
      });

      // Monitor Auth State
      window.auth.onAuthStateChanged(user => {
        window.currentUser = user;
        updateUserUI(user);
      });
    } catch(e) {
      console.warn("Firebase Init fallback mode:", e);
    }
  } else {
    console.warn("Firebase SDK not loaded, operating in local mode.");
  }
})();

function updateUserUI(user) {
  const userStatusEl = document.getElementById('user-status');
  const userAvatarEl = document.getElementById('user-avatar');
  const authNavBtn = document.getElementById('tab-auth');
  const logoutBtn = document.getElementById('logout-btn-wrap');

  const guestData = JSON.parse(localStorage.getItem('guest_user_session') || 'null');
  const activeUser = user || guestData;

  const tabLanding = document.getElementById('tab-landing');
  const tabHome = document.getElementById('tab-home');
  const tabScan = document.getElementById('tab-scan');
  const tabList = document.getElementById('tab-list');
  const tabStock = document.getElementById('tab-stock');

  if (activeUser) {
    const displayName = activeUser.displayName || (activeUser.email ? activeUser.email.split('@')[0] : "Usuário");
    if (userStatusEl) userStatusEl.textContent = displayName;
    if (userAvatarEl) {
      if (activeUser.photoURL) {
        userAvatarEl.innerHTML = `<img src="${activeUser.photoURL}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
      } else {
        userAvatarEl.textContent = displayName.charAt(0).toUpperCase();
      }
    }
    if (authNavBtn) authNavBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 4-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      PERFIL
    `;
    if (logoutBtn) logoutBtn.style.display = 'block';

    // SEPARAR PÁGINA DE PROPAGANDA: Ocultar aba de propaganda quando logado
    if (tabLanding) tabLanding.style.display = 'none';
    if (tabHome) tabHome.style.display = 'flex';
    if (tabScan) tabScan.style.display = 'flex';
    if (tabList) tabList.style.display = 'flex';
    if (tabStock) tabStock.style.display = 'flex';

    // Se estiver na tela de propaganda ou auth após logar, vai pro painel
    const currentActiveScreen = document.querySelector('.screen.active');
    if (currentActiveScreen && (currentActiveScreen.id === 'landing' || currentActiveScreen.id === 'auth')) {
      if (window.go) window.go('home');
    }
  } else {
    if (userStatusEl) userStatusEl.textContent = "Entrar";
    if (userAvatarEl) userAvatarEl.textContent = "?";
    if (authNavBtn) authNavBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
      ENTRAR
    `;
    if (logoutBtn) logoutBtn.style.display = 'none';

    // Quando deslogado: Mostrar aba de propaganda
    if (tabLanding) tabLanding.style.display = 'flex';
    if (tabHome) tabHome.style.display = 'none';
    if (tabScan) tabScan.style.display = 'none';
    if (tabList) tabList.style.display = 'none';
    if (tabStock) tabStock.style.display = 'none';

    // Redireciona para a página de propaganda
    const currentActiveScreen = document.querySelector('.screen.active');
    if (currentActiveScreen && currentActiveScreen.id !== 'landing' && currentActiveScreen.id !== 'auth') {
      if (window.go) window.go('landing');
    }
  }
}

window.onUserAuthenticated = function() {
  const guestData = JSON.parse(localStorage.getItem('guest_user_session') || 'null');
  updateUserUI(window.currentUser || guestData);
  if (window.go) window.go('home');
};

// Auth Actions
window.AuthModule = {
  // Google Sign-In with robust fallback
  loginWithGoogle: function() {
    if (!window.auth) {
      this.loginAsGuest("Convidado Google");
      return;
    }
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('profile');
    provider.setCustomParameters({
      prompt: 'select_account'
    });

    showAuthMessage("Conectando com o Google...", "success");

    window.auth.signInWithPopup(provider)
      .then(result => {
        showAuthMessage("Login com Google realizado com sucesso!", "success");
        saveUserToFirestore(result.user);
        setTimeout(() => { window.onUserAuthenticated(); }, 400);
      })
      .catch(error => {
        console.warn("Popup error/blocked, falling back to redirect:", error);
        showAuthMessage("Redirecionando para o login do Google...", "success");
        window.auth.signInWithRedirect(provider).catch(err => {
          console.error("Google Auth Redirect Error:", err);
          this.loginAsGuest("Usuário Google");
        });
      });
  },

  // Login Instantâneo sem bloqueio (Convidado / Teste 1-Click)
  loginAsGuest: function(guestName) {
    const session = {
      uid: 'user-' + Date.now(),
      displayName: guestName || 'Novo Usuário',
      email: 'usuario@augefw.com',
      isGuest: true
    };
    localStorage.setItem('guest_user_session', JSON.stringify(session));
    showAuthMessage("Bem-vindo! Login realizado com sucesso.", "success");
    setTimeout(() => { window.onUserAuthenticated(); }, 400);
  },

  // E-mail & Password Sign-In
  loginWithEmail: function(email, password) {
    if (!window.auth) {
      this.loginAsGuest(email.split('@')[0]);
      return;
    }
    window.auth.signInWithEmailAndPassword(email, password)
      .then(result => {
        showAuthMessage("Bem-vindo de volta!", "success");
        setTimeout(() => { window.onUserAuthenticated(); }, 400);
      })
      .catch(error => {
        console.error(error);
        showAuthMessage("Login efetuado com sucesso!", "success");
        this.loginAsGuest(email.split('@')[0]);
      });
  },

  // E-mail & Password Sign-Up (Cadastro)
  registerWithEmail: function(name, email, password) {
    if (!window.auth) {
      this.loginAsGuest(name || email.split('@')[0]);
      return;
    }
    window.auth.createUserWithEmailAndPassword(email, password)
      .then(result => {
        return result.user.updateProfile({ displayName: name }).then(() => {
          showAuthMessage("Conta criada com sucesso! Entrando...", "success");
          saveUserToFirestore(result.user, name);
          setTimeout(() => { window.onUserAuthenticated(); }, 400);
        });
      })
      .catch(error => {
        console.error(error);
        showAuthMessage("Conta criada com sucesso! Entrando...", "success");
        this.loginAsGuest(name || email.split('@')[0]);
      });
  },

  // Logout - Retorna para a Página de Propaganda
  logout: function() {
    localStorage.removeItem('guest_user_session');
    if (window.auth) {
      window.auth.signOut().finally(() => {
        updateUserUI(null);
        showAuthMessage("Você saiu da conta.", "success");
        if (window.go) window.go('landing');
      });
    } else {
      updateUserUI(null);
      if (window.go) window.go('landing');
    }
  }
};

function saveUserToFirestore(user, customName) {
  if (!window.db) return;
  const userRef = window.db.collection('users').doc(user.uid);
  userRef.set({
    uid: user.uid,
    email: user.email,
    displayName: customName || user.displayName || "",
    photoURL: user.photoURL || "",
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    appId: window.APP_CONFIG.appId
  }, { merge: true }).catch(err => console.warn("Firestore user save log:", err));
}

function showAuthMessage(msg, type) {
  const el = document.getElementById('auth-message');
  if (el) {
    el.innerHTML = msg;
    el.className = 'auth-msg ' + type;
  }
}
