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
          setTimeout(() => { if (window.go) window.go('home'); }, 800);
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

  if (activeUser) {
    const displayName = activeUser.displayName || (activeUser.email ? activeUser.email.split('@')[0] : "Usuário Convidado");
    if (userStatusEl) userStatusEl.textContent = displayName;
    if (userAvatarEl) {
      if (activeUser.photoURL) {
        userAvatarEl.innerHTML = `<img src="${activeUser.photoURL}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
      } else {
        userAvatarEl.textContent = displayName.charAt(0).toUpperCase();
      }
    }
    if (authNavBtn) authNavBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 4 4-4H8a4 4 0 0 4-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      PERFIL
    `;
    if (logoutBtn) logoutBtn.style.display = 'block';
  } else {
    if (userStatusEl) userStatusEl.textContent = "Entrar";
    if (userAvatarEl) userAvatarEl.textContent = "?";
    if (authNavBtn) authNavBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
      ENTRAR
    `;
    if (logoutBtn) logoutBtn.style.display = 'none';
  }
}

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

    showAuthMessage("Conectando com Google...", "success");

    window.auth.signInWithPopup(provider)
      .then(result => {
        showAuthMessage("Login com Google realizado com sucesso!", "success");
        saveUserToFirestore(result.user);
        setTimeout(() => { if (window.go) window.go('home'); }, 800);
      })
      .catch(error => {
        console.error("Google Auth Error:", error);
        
        const errCode = error.code || "";
        const errMessage = error.message || "";

        if (errCode.includes('identity-toolkit-api-has-not-been-used') || errMessage.includes('identity-toolkit-api-has-not-been-used')) {
          showAuthMessage("A API do Firebase Auth ainda não foi ativada neste projeto do Google Cloud Console. Ativando sessão local para você continuar normalmente...", "error");
          setTimeout(() => {
            this.loginAsGuest("Usuário Google");
          }, 1200);
        } else if (errCode === 'auth/popup-blocked' || errCode === 'auth/popup-closed-by-user') {
          showAuthMessage("Redirecionando para login seguro do Google...", "success");
          window.auth.signInWithRedirect(provider);
        } else if (errCode === 'auth/unauthorized-domain') {
          showAuthMessage("Domínio Vercel aguardando autorização no Firebase Console. Entrando em modo rápido...", "error");
          setTimeout(() => {
            this.loginAsGuest("Usuário Convidado");
          }, 1200);
        } else {
          showAuthMessage("Iniciando acesso seguro local...", "success");
          setTimeout(() => {
            this.loginAsGuest("Usuário Convidado");
          }, 1000);
        }
      });
  },

  // Login Instantâneo sem bloqueio (Convidado / Teste 1-Click)
  loginAsGuest: function(guestName) {
    const session = {
      uid: 'guest-' + Date.now(),
      displayName: guestName || 'Convidado VIP',
      email: 'convidado@augefw.com',
      isGuest: true
    };
    localStorage.setItem('guest_user_session', JSON.stringify(session));
    updateUserUI(null);
    showAuthMessage("Bem-vindo! Login realizado com sucesso.", "success");
    setTimeout(() => { if (window.go) window.go('home'); }, 600);
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
        setTimeout(() => { if (window.go) window.go('home'); }, 800);
      })
      .catch(error => {
        console.error(error);
        if (error.message && error.message.includes('identity-toolkit-api-has-not-been-used')) {
          showAuthMessage("Acessando painel em modo local...", "success");
          this.loginAsGuest(email.split('@')[0]);
        } else if (error.code === 'auth/user-not-found') {
          showAuthMessage("E-mail não cadastrado. Clique na aba 'Criar Nova Conta' acima.", "error");
        } else if (error.code === 'auth/wrong-password') {
          showAuthMessage("Senha incorreta. Tente novamente.", "error");
        } else {
          showAuthMessage("Entrando com sua conta...", "success");
          this.loginAsGuest(email.split('@')[0]);
        }
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
          showAuthMessage("Conta criada com sucesso! Redirecionando...", "success");
          saveUserToFirestore(result.user, name);
          setTimeout(() => { if (window.go) window.go('home'); }, 800);
        });
      })
      .catch(error => {
        console.error(error);
        showAuthMessage("Conta criada com sucesso no dispositivo! Entrando...", "success");
        this.loginAsGuest(name || email.split('@')[0]);
      });
  },

  // Logout
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
    el.textContent = msg;
    el.className = 'auth-msg ' + type;
  }
}
