/**
 * Firebase Authentication & Firestore Service Integration
 * Rastreador de Preços - br.com.willian.rastreadorprecos
 * Developed by AugeFW (augefw.com)
 */

(function() {
  const cfg = window.APP_CONFIG.firebase;
  
  if (typeof firebase !== 'undefined') {
    if (!firebase.apps.length) {
      firebase.initializeApp(cfg);
    }
    
    window.db = firebase.firestore();
    window.auth = firebase.auth();

    // Enable Firestore offline persistence
    window.db.enablePersistence().catch(err => {
      console.warn("Firestore offline persistence state:", err.code);
    });

    // Monitor Auth State
    window.auth.onAuthStateChanged(user => {
      window.currentUser = user;
      updateUserUI(user);
    });
  } else {
    console.warn("Firebase SDK not loaded, operating in local mode.");
  }
})();

function updateUserUI(user) {
  const userStatusEl = document.getElementById('user-status');
  const userAvatarEl = document.getElementById('user-avatar');
  const authNavBtn = document.getElementById('tab-auth');
  const logoutBtn = document.getElementById('logout-btn-wrap');

  if (user) {
    const displayName = user.displayName || (user.email ? user.email.split('@')[0] : "Usuário");
    if (userStatusEl) userStatusEl.textContent = displayName;
    if (userAvatarEl) {
      if (user.photoURL) {
        userAvatarEl.innerHTML = `<img src="${user.photoURL}" style="width:100%;height:100%;border-radius:50%;">`;
      } else {
        userAvatarEl.textContent = displayName.charAt(0).toUpperCase();
      }
    }
    if (authNavBtn) authNavBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      PERFIL
    `;
    if (logoutBtn) logoutBtn.style.display = 'block';
  } else {
    if (userStatusEl) userStatusEl.textContent = "Entrar / Cadastrar";
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
  // Google Sign-In
  loginWithGoogle: function() {
    if (!window.auth) {
      showAuthMessage("Firebase não inicializado.", "error");
      return;
    }
    const provider = new firebase.auth.GoogleAuthProvider();
    window.auth.signInWithPopup(provider)
      .then(result => {
        showAuthMessage("Login com Google realizado com sucesso!", "success");
        saveUserToFirestore(result.user);
        setTimeout(() => { if (window.go) window.go('home'); }, 800);
      })
      .catch(error => {
        console.error(error);
        showAuthMessage("Erro no login com Google: " + error.message, "error");
      });
  },

  // E-mail & Password Sign-In
  loginWithEmail: function(email, password) {
    if (!window.auth) {
      showAuthMessage("Firebase não inicializado.", "error");
      return;
    }
    window.auth.signInWithEmailAndPassword(email, password)
      .then(result => {
        showAuthMessage("Bem-vindo de volta!", "success");
        setTimeout(() => { if (window.go) window.go('home'); }, 800);
      })
      .catch(error => {
        console.error(error);
        showAuthMessage("E-mail ou senha inválidos.", "error");
      });
  },

  // E-mail & Password Sign-Up (Cadastro)
  registerWithEmail: function(name, email, password) {
    if (!window.auth) {
      showAuthMessage("Firebase não inicializado.", "error");
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
        showAuthMessage("Erro ao criar conta: " + error.message, "error");
      });
  },

  // Logout
  logout: function() {
    if (window.auth) {
      window.auth.signOut().then(() => {
        showAuthMessage("Você saiu da conta.", "success");
        if (window.go) window.go('landing');
      });
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
  }, { merge: true }).catch(err => console.error("Firestore user save error:", err));
}

function showAuthMessage(msg, type) {
  const el = document.getElementById('auth-message');
  if (el) {
    el.textContent = msg;
    el.className = 'auth-msg ' + type;
  }
}
