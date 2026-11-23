// Shared across all 5 pokemon-*.html pages, unlike this repo's usual
// one-file-per-page convention - the chat widget is identical everywhere,
// so duplicating it 5 times would just be copy-paste with no per-page
// variation to justify it.
(function () {
  const config = window.siteConfig || {};
  const toggleBtn = document.getElementById("chat-toggle-btn");
  const sidebarEl = document.getElementById("chat-sidebar");
  const closeBtn = document.getElementById("chat-close-btn");
  const clearSystemBtn = document.getElementById("chat-clear-system-btn");
  const tradeBadgeEl = document.getElementById("trade-notification-badge");
  const tradeBadgeCountEl = document.getElementById("trade-notification-count");
  const messagesEl = document.getElementById("chat-messages");
  const formEl = document.getElementById("chat-form");
  const inputEl = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send-btn");
  const statusEl = document.getElementById("chat-status");

  if (!sidebarEl) return;

  const escapeHtml = (value) => {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  if (!config.firebaseConfig || config.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") {
    statusEl.hidden = false;
    statusEl.className = "status error";
    statusEl.textContent = "Chat isn't configured yet.";
    return;
  }

  // Every pokemon-*.html page's own script already calls initializeApp -
  // reuse that default app instead of calling it again, which would throw.
  if (!firebase.apps.length) firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  toggleBtn.addEventListener("click", () => {
    sidebarEl.classList.add("open");
    markChatRead();
  });
  closeBtn.addEventListener("click", () => sidebarEl.classList.remove("open"));

  // On desktop the sidebar is always on-screen via plain CSS - it never
  // gets the mobile-only "open" class toggled onto it - so the toggle
  // button (hidden on desktop anyway) would otherwise never get marked
  // read there. Treating desktop width as "always visible" keeps
  // chatLastReadAt accurate across devices for the same account.
  const isDesktopChatLayout = () => window.matchMedia("(min-width: 901px)").matches;
  const isChatVisible = () => isDesktopChatLayout() || sidebarEl.classList.contains("open");

  // Unread tracking for the mobile chat bubble: chatLastReadAt lives on
  // the user's own team doc (no new collection/rules needed - the owner
  // can already write arbitrary fields there). latestMessageAtMs comes
  // from the live chatMessages listener below. The bubble glows only when
  // there's a message newer than what's stored as read AND the chat isn't
  // currently visible.
  let myTeamRef = null;
  let lastReadAtMs = 0;
  let latestMessageAtMs = 0;

  const updateUnreadGlow = () => {
    const hasUnread = Boolean(auth.currentUser) && latestMessageAtMs > lastReadAtMs && !isChatVisible();
    toggleBtn.classList.toggle("chat-toggle-btn--unread", hasUnread);
  };

  const markChatRead = () => {
    toggleBtn.classList.remove("chat-toggle-btn--unread");
    if (!myTeamRef || latestMessageAtMs <= lastReadAtMs) return;
    lastReadAtMs = latestMessageAtMs;
    myTeamRef.update({ chatLastReadAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(() => {});
  };

  const isRealAdmin = () =>
    Boolean(auth.currentUser && config.adminUid && config.adminUid !== "YOUR_ADMIN_UID" && auth.currentUser.uid === config.adminUid);
  // Admin Mode toggle (pokemon-admin-toggle.js) - lets a real admin browse
  // as a regular user without losing admin rights server-side; this only
  // ever hides admin-only UI here, Firestore rules still check the real
  // uid regardless of this toggle.
  const isAdmin = () => isRealAdmin() && localStorage.getItem(`adminViewMode:${auth.currentUser.uid}`) !== "user";

  const scrollToBottom = () => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return "";
    return timestamp.toDate().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  // Current manager names, keyed by uid, from teams/{uid}.managerName.
  // Messages store the sender's name as it was when they were sent; this
  // lets a rename show on every message, old ones included. The name's
  // source of truth is users/{uid}.displayName, but users docs hold emails
  // and are owner/admin-only, so each manager's own page copies their name
  // onto their (public) team doc - see syncMyManagerName below.
  let managerNames = {};
  // Current team names, keyed by uid, shown in parentheses after the
  // sender's name - live from teams/{uid}.teamName, so a renamed team
  // updates on every message.
  let teamNames = {};
  let lastMessages = [];

  const renderMessages = (messages) => {
    lastMessages = messages;
    if (clearSystemBtn) clearSystemBtn.hidden = !isAdmin();
    if (!messages.length) {
      messagesEl.innerHTML = `<p class="status">No messages yet - say hello.</p>`;
      return;
    }
    messagesEl.innerHTML = messages
      .map((m) => {
        if (m.system) {
          return `
            <div class="chat-message chat-message--system">
              <p class="chat-message-text">${escapeHtml(m.text)}</p>
              <span class="chat-message-time">${formatTime(m.createdAt)}</span>
              ${isAdmin() ? `<button type="button" class="chat-delete-btn" data-id="${m.id}" title="Delete message">✕</button>` : ""}
            </div>
          `;
        }
        return `
          <div class="chat-message">
            <div class="chat-message-meta">
              <span class="chat-message-name">${escapeHtml(managerNames[m.uid] || m.displayName || "Unknown")}${
                teamNames[m.uid] ? ` <span class="chat-message-team">(${escapeHtml(teamNames[m.uid])})</span>` : ""
              }</span>
              <span class="chat-message-time">${formatTime(m.createdAt)}</span>
              ${isAdmin() ? `<button type="button" class="chat-delete-btn" data-id="${m.id}" title="Delete message">✕</button>` : ""}
            </div>
            <p class="chat-message-text">${escapeHtml(m.text)}</p>
          </div>
        `;
      })
      .join("");
    messagesEl.querySelectorAll(".chat-delete-btn").forEach((btn) => {
      btn.addEventListener("click", () => deleteMessage(btn.dataset.id));
    });
    scrollToBottom();
  };

  async function deleteMessage(id) {
    if (!window.confirm("Delete this message?")) return;
    try {
      await db.collection("chatMessages").doc(id).delete();
    } catch (error) {
      window.alert(`Unable to delete: ${error.message}`);
    }
  }

  // Admin-only. System messages (pick/autodraft/skip/free-agent
  // announcements) pile up fast during testing - this clears all of them
  // in one go instead of deleting each with the per-message "✕".
  async function clearSystemMessages() {
    if (!window.confirm("Delete every system message from the chat? This can't be undone.")) return;
    try {
      const snapshot = await db.collection("chatMessages").where("system", "==", true).get();
      for (let i = 0; i < snapshot.docs.length; i += 450) {
        const batch = db.batch();
        snapshot.docs.slice(i, i + 450).forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }
    } catch (error) {
      window.alert(`Unable to clear system messages: ${error.message}`);
    }
  }

  if (clearSystemBtn) clearSystemBtn.addEventListener("click", clearSystemMessages);

  let unsubscribe = null;
  let unsubscribeNames = null;

  // Copy my users/{uid}.displayName onto my team doc (as managerName) and
  // my login profile, so a name changed in the database shows up in chat
  // the next time I load any page. Best-effort: a brand-new sign-up's team
  // doc may not exist yet, in which case the next page load catches it.
  const syncMyManagerName = async (user) => {
    try {
      const userSnap = await db.collection("users").doc(user.uid).get();
      const name = userSnap.exists && String(userSnap.data().displayName || "").trim();
      if (!name) return;
      const teamRef = db.collection("teams").doc(user.uid);
      const teamSnap = await teamRef.get();
      if (teamSnap.exists && teamSnap.data().managerName !== name) {
        await teamRef.update({ managerName: name });
      }
      if (user.displayName !== name) await user.updateProfile({ displayName: name });
    } catch (error) {
      // Non-fatal - chat falls back to the name stored on each message.
    }
  };

  const subscribe = () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (unsubscribeNames) {
      unsubscribeNames();
      unsubscribeNames = null;
    }
    managerNames = {};
    teamNames = {};

    if (!auth.currentUser) {
      inputEl.disabled = true;
      sendBtn.disabled = true;
      inputEl.placeholder = "Sign in to chat…";
      messagesEl.innerHTML = `<p class="status">Sign in on <a href="pokemon-league.html">League Home</a> to view and join the chat.</p>`;
      if (clearSystemBtn) clearSystemBtn.hidden = true;
      myTeamRef = null;
      lastReadAtMs = 0;
      latestMessageAtMs = 0;
      toggleBtn.classList.remove("chat-toggle-btn--unread");
      return;
    }

    inputEl.disabled = false;
    sendBtn.disabled = false;
    inputEl.placeholder = "Message the league…";

    myTeamRef = db.collection("teams").doc(auth.currentUser.uid);
    myTeamRef
      .get()
      .then((snap) => {
        const data = snap.data();
        lastReadAtMs = (data && data.chatLastReadAt && data.chatLastReadAt.toMillis()) || 0;
        updateUnreadGlow();
      })
      .catch(() => {});

    syncMyManagerName(auth.currentUser);

    unsubscribeNames = db.collection("teams").onSnapshot(
      (snapshot) => {
        const names = {};
        const teams = {};
        snapshot.docs.forEach((doc) => {
          const data = doc.data();
          if (data.managerName) names[doc.id] = data.managerName;
          if (data.teamName) teams[doc.id] = data.teamName;
        });
        managerNames = names;
        teamNames = teams;
        if (lastMessages.length) renderMessages(lastMessages);
      },
      () => {}
    );

    unsubscribe = db
      .collection("chatMessages")
      .orderBy("createdAt", "desc")
      .limit(200)
      .onSnapshot(
        (snapshot) => {
          const messages = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).reverse();
          const latest = messages[messages.length - 1];
          if (latest && latest.createdAt) latestMessageAtMs = latest.createdAt.toMillis();
          renderMessages(messages);
          if (isChatVisible()) {
            markChatRead();
          } else {
            updateUnreadGlow();
          }
        },
        (error) => {
          messagesEl.innerHTML = `<p class="status error">Unable to load chat: ${escapeHtml(error.message)}</p>`;
        }
      );
  };

  // Pending-trade notification badge - every page, next to the Fantasy
  // Pokeball header badge (the chat toggle itself is hidden on desktop, so
  // tying this to it specifically wouldn't actually be visible everywhere).
  let unsubscribeTradeBadge = null;

  const subscribeTradeBadge = () => {
    if (unsubscribeTradeBadge) {
      unsubscribeTradeBadge();
      unsubscribeTradeBadge = null;
    }
    if (!tradeBadgeEl) return;
    if (!auth.currentUser) {
      tradeBadgeEl.hidden = true;
      return;
    }
    // Single equality filter, filtered client-side for toUid - avoids
    // needing a composite index for the two-field combination.
    unsubscribeTradeBadge = db
      .collection("trades")
      .where("status", "==", "pending")
      .onSnapshot(
        (snapshot) => {
          const count = snapshot.docs.filter((doc) => doc.data().toUid === auth.currentUser.uid).length;
          tradeBadgeEl.hidden = count === 0;
          if (tradeBadgeCountEl) tradeBadgeCountEl.textContent = count;
        },
        () => {
          tradeBadgeEl.hidden = true;
        }
      );
  };

  auth.onAuthStateChanged(() => {
    subscribe();
    subscribeTradeBadge();
  });

  formEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = inputEl.value.trim();
    if (!text || !auth.currentUser) return;
    inputEl.value = "";
    try {
      await db.collection("chatMessages").add({
        uid: auth.currentUser.uid,
        displayName: auth.currentUser.displayName || auth.currentUser.email,
        text,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      statusEl.hidden = false;
      statusEl.className = "status error";
      statusEl.textContent = error.message;
    }
  });
})();
