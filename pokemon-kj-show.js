// Past episodes of the show. Reads window.broadcasts (the hand-maintained
// static file - still the primary way episodes get added) merged with any
// admin-uploaded episodes in the `broadcasts` Firestore collection (the
// fallback path for posting one without VS Code/git access - see the
// upload form below). The static list renders immediately with no
// Firebase dependency, same as before; the live collection only reaches
// signed-in users; it's a merge-in enhancement, not a replacement.
// Deliberately excludes the single latest episode (across both sources) -
// that one stays featured on League Home and the Schedule page, not
// duplicated here.
(function () {
  const config = window.siteConfig || {};
  const listEl = document.getElementById("kj-show-list");
  const emptyEl = document.getElementById("kj-show-empty");
  const uploadCardEl = document.getElementById("upload-episode-card");
  const uploadFormEl = document.getElementById("upload-episode-form");
  const uploadTypeEl = document.getElementById("upload-episode-type");
  const uploadWeekEl = document.getElementById("upload-episode-week");
  const uploadTitleEl = document.getElementById("upload-episode-title");
  const uploadDateEl = document.getElementById("upload-episode-date");
  const uploadFileEl = document.getElementById("upload-episode-file");
  const uploadBtnEl = document.getElementById("upload-episode-btn");
  const uploadMessageEl = document.getElementById("upload-episode-message");
  if (!listEl) return;

  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const staticBroadcasts = window.broadcasts || [];
  const typeLabels = window.broadcastTypeLabels || {};
  let liveBroadcasts = [];
  let currentUser = null;

  const isAdmin = () =>
    Boolean(currentUser && config.adminUid && config.adminUid !== "YOUR_ADMIN_UID" && currentUser.uid === config.adminUid);

  const render = () => {
    const all = staticBroadcasts.concat(liveBroadcasts);
    const sorted = [...all].sort((a, b) => b.date.localeCompare(a.date));
    const past = sorted.slice(1); // drop the latest - it lives elsewhere

    if (!past.length) {
      listEl.innerHTML = "";
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    listEl.innerHTML = past
      .map((b) => {
        const title = b.title || `Week ${b.week}: ${typeLabels[b.type] || b.type}`;
        const deleteBtn =
          b.liveId && isAdmin()
            ? `<button type="button" class="btn btn-secondary delete-episode-btn" data-id="${b.liveId}" data-storage-path="${escapeHtml(b.storagePath)}" style="margin-top:0.4rem;">Delete</button>`
            : "";
        return `<div class="broadcast-archive-item">
                  <p>${escapeHtml(title)} <span class="matchup-day">${escapeHtml(b.date)}</span></p>
                  <audio controls src="${escapeHtml(b.file)}" style="width: 100%;"></audio>
                  ${deleteBtn}
                </div>`;
      })
      .join("");

    listEl.querySelectorAll(".delete-episode-btn").forEach((btn) => {
      btn.addEventListener("click", () => deleteEpisode(btn.dataset.id, btn.dataset.storagePath));
    });
  };

  render();

  if (!config.firebaseConfig || config.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") {
    return; // no live merge or upload feature without Firebase configured
  }

  if (!firebase.apps.length) firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const storage = firebase.storage ? firebase.storage() : null;

  db.collection("broadcasts").onSnapshot(
    (snapshot) => {
      liveBroadcasts = snapshot.docs.map((doc) => {
        const data = doc.data();
        return { ...data, liveId: doc.id };
      });
      render();
    },
    () => {} // signed-out visitors can't read this collection - fine, static list still renders
  );

  const showUploadMessage = (text, isError) => {
    uploadMessageEl.hidden = false;
    uploadMessageEl.className = `status${isError ? " error" : ""}`;
    uploadMessageEl.textContent = text;
  };

  const MAX_EPISODE_BYTES = 40 * 1024 * 1024;

  async function uploadEpisode() {
    if (!storage) {
      showUploadMessage("Uploads aren't available right now.", true);
      return;
    }
    const file = uploadFileEl.files && uploadFileEl.files[0];
    if (!file) {
      showUploadMessage("Choose an audio file first.", true);
      return;
    }
    if (!file.type.startsWith("audio/")) {
      showUploadMessage("That file isn't an audio file.", true);
      return;
    }
    if (file.size > MAX_EPISODE_BYTES) {
      showUploadMessage("File is too large - 40MB max.", true);
      return;
    }
    const week = Number(uploadWeekEl.value);
    if (!week || week < 1) {
      showUploadMessage("Enter a week number.", true);
      return;
    }
    const date = uploadDateEl.value || new Date().toISOString().slice(0, 10);

    try {
      showUploadMessage("Uploading…", false);
      uploadBtnEl.disabled = true;
      const docRef = db.collection("broadcasts").doc();
      const ext = (file.name.split(".").pop() || "mp3").toLowerCase();
      const audioRef = storage.ref(`broadcastAudio/${docRef.id}.${ext}`);
      await audioRef.put(file, { contentType: file.type });
      const fileUrl = await audioRef.getDownloadURL();
      await docRef.set({
        type: uploadTypeEl.value,
        week,
        title: uploadTitleEl.value.trim(),
        date,
        file: fileUrl,
        storagePath: audioRef.fullPath,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdBy: currentUser.uid,
      });
      showUploadMessage("Episode uploaded.", false);
      uploadFormEl.reset();
    } catch (error) {
      showUploadMessage(error.message, true);
    } finally {
      uploadBtnEl.disabled = false;
    }
  }

  if (uploadBtnEl) uploadBtnEl.addEventListener("click", uploadEpisode);

  async function deleteEpisode(liveId, storagePath) {
    if (!window.confirm("Delete this uploaded episode? This can't be undone.")) return;
    try {
      if (storage && storagePath) await storage.ref(storagePath).delete().catch(() => {});
      await db.collection("broadcasts").doc(liveId).delete();
    } catch (error) {
      window.alert(error.message);
    }
  }

  auth.onAuthStateChanged((user) => {
    currentUser = user;
    if (uploadCardEl) uploadCardEl.hidden = !isAdmin();
    render();
  });
})();
