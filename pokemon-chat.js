// Shared across all 5 pokemon-*.html pages, unlike this repo's usual
// one-file-per-page convention - the chat widget is identical everywhere,
// so duplicating it 5 times would just be copy-paste with no per-page
// variation to justify it.
(function () {
  const config = window.siteConfig || {};
  const toggleBtn = document.getElementById("chat-toggle-btn");
  const sidebarEl = document.getElementById("chat-sidebar");
  const closeBtn = document.getElementById("chat-close-btn");
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

  toggleBtn.addEventListener("click", () => sidebarEl.classList.add("open"));
  closeBtn.addEventListener("click", () => sidebarEl.classList.remove("open"));

  const isAdmin = () =>
    Boolean(auth.currentUser && config.adminUid && config.adminUid !== "YOUR_ADMIN_UID" && auth.currentUser.uid === config.adminUid);

  const scrollToBottom = () => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return "";
    return timestamp.toDate().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  const renderMessages = (messages) => {
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
              <span class="chat-message-name">${escapeHtml(m.displayName || "Unknown")}</span>
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

  let unsubscribe = null;

  const subscribe = () => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    if (!auth.currentUser) {
      inputEl.disabled = true;
      sendBtn.disabled = true;
      inputEl.placeholder = "Sign in to chat…";
      messagesEl.innerHTML = `<p class="status">Sign in on <a href="pokemon-league.html">League Home</a> to view and join the chat.</p>`;
      return;
    }

    inputEl.disabled = false;
    sendBtn.disabled = false;
    inputEl.placeholder = "Message the league…";

    unsubscribe = db
      .collection("chatMessages")
      .orderBy("createdAt", "desc")
      .limit(200)
      .onSnapshot(
        (snapshot) => {
          const messages = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).reverse();
          renderMessages(messages);
        },
        (error) => {
          messagesEl.innerHTML = `<p class="status error">Unable to load chat: ${escapeHtml(error.message)}</p>`;
        }
      );
  };

  auth.onAuthStateChanged(() => subscribe());

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
