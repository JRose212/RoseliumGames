(function () {
  const config = window.siteConfig || {};
  const statusEl = document.getElementById("feedback-status");
  const formCardEl = document.getElementById("feedback-form-card");
  const formEl = document.getElementById("feedback-form");
  const textEl = document.getElementById("feedback-text");
  const formMessageEl = document.getElementById("feedback-form-message");
  const adminCardEl = document.getElementById("feedback-admin-card");
  const adminListEl = document.getElementById("feedback-admin-list");

  if (!formCardEl) return;

  const escapeHtml = (value) => {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  if (!config.firebaseConfig || config.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") {
    statusEl.className = "status error";
    statusEl.textContent = "Fantasy League is not configured yet.";
    return;
  }

  if (!firebase.apps.length) firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  let currentUser = null;

  const isAdmin = () =>
    Boolean(currentUser && config.adminUid && config.adminUid !== "YOUR_ADMIN_UID" && currentUser.uid === config.adminUid);

  const showFormMessage = (text, isError) => {
    formMessageEl.hidden = false;
    formMessageEl.className = `status${isError ? " error" : ""}`;
    formMessageEl.textContent = text;
  };

  formEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser) return;
    const text = textEl.value.trim();
    if (!text) return;

    try {
      const teamSnap = await db.collection("teams").doc(currentUser.uid).get();
      const team = teamSnap.exists ? teamSnap.data() : null;
      await db.collection("feedback").add({
        uid: currentUser.uid,
        teamName: (team && team.teamName) || currentUser.email || "Unknown",
        text,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      textEl.value = "";
      showFormMessage("Sent - thanks for the feedback!", false);
    } catch (error) {
      showFormMessage(error.message, true);
    }
  });

  const formatTime = (timestamp) => {
    if (!timestamp) return "";
    return timestamp.toDate().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  const renderAdminList = (entries) => {
    if (!entries.length) {
      adminListEl.innerHTML = `<li class="status">No feedback yet.</li>`;
      return;
    }
    adminListEl.innerHTML = entries
      .map(
        (entry) => `
          <li class="ranking-item">
            <div style="flex: 1;">
              <strong>${escapeHtml(entry.teamName)}</strong>
              <span style="color: var(--muted); font-size: 0.78rem; margin-left: 0.5rem;">${formatTime(entry.createdAt)}</span>
              <p style="margin: 0.4rem 0 0;">${escapeHtml(entry.text)}</p>
            </div>
            <button type="button" class="roster-remove-btn feedback-delete-btn" data-id="${entry.id}" title="Delete">✕</button>
          </li>
        `
      )
      .join("");
    adminListEl.querySelectorAll(".feedback-delete-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!window.confirm("Delete this feedback entry?")) return;
        try {
          await db.collection("feedback").doc(btn.dataset.id).delete();
        } catch (error) {
          window.alert(`Unable to delete: ${error.message}`);
        }
      });
    });
  };

  let unsubscribeFeedback = null;

  const subscribe = () => {
    if (unsubscribeFeedback) {
      unsubscribeFeedback();
      unsubscribeFeedback = null;
    }

    if (!currentUser) {
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.innerHTML = `Sign in on the <a href="pokemon-league.html">League Home</a> page to send feedback.`;
      formCardEl.hidden = true;
      adminCardEl.hidden = true;
      return;
    }

    statusEl.hidden = true;
    formCardEl.hidden = false;
    formMessageEl.hidden = true;
    textEl.value = "";

    if (isAdmin()) {
      adminCardEl.hidden = false;
      unsubscribeFeedback = db
        .collection("feedback")
        .orderBy("createdAt", "desc")
        .onSnapshot(
          (snapshot) => {
            renderAdminList(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
          },
          (error) => {
            adminListEl.innerHTML = `<li class="status error">Unable to load feedback: ${escapeHtml(error.message)}</li>`;
          }
        );
    } else {
      adminCardEl.hidden = true;
    }
  };

  auth.onAuthStateChanged((user) => {
    currentUser = user;
    subscribe();
  });
})();
