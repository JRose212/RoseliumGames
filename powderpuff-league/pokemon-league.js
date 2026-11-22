// League rules modal - a self-contained IIFE, separate from the main one
// below, so it works regardless of Firebase/auth state (including signed
// out, or Firebase failing to configure entirely). #rules in the URL opens
// it directly, so the link is shareable on its own.
(function () {
  const modalEl = document.getElementById("rules-modal");
  const linkBtn = document.getElementById("rules-link-btn");
  const closeBtn = document.getElementById("rules-modal-close");
  if (!modalEl || !linkBtn || !closeBtn) return;

  const openModal = () => {
    modalEl.hidden = false;
  };
  const closeModal = () => {
    modalEl.hidden = true;
    if (location.hash === "#rules") {
      history.replaceState(null, "", location.pathname + location.search);
    }
  };

  linkBtn.addEventListener("click", (event) => {
    event.preventDefault();
    location.hash = "rules";
    openModal();
  });
  closeBtn.addEventListener("click", closeModal);
  modalEl.addEventListener("click", (event) => {
    if (event.target === modalEl) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modalEl.hidden) closeModal();
  });
  window.addEventListener("hashchange", () => {
    if (location.hash === "#rules") openModal();
    else modalEl.hidden = true;
  });

  if (location.hash === "#rules") openModal();
})();

// Latest broadcast card - reads the hand-maintained window.broadcasts
// list from broadcasts.js (renders immediately, no Firebase dependency,
// works for signed-out visitors), then merges in any admin-uploaded
// episodes from the `broadcasts` Firestore collection once available (the
// fallback upload path on the K&J Show page - signed-in only). The
// Firestore call is deferred a tick so it runs after the page's main IIFE
// below has already called firebase.initializeApp().
(function () {
  const cardEl = document.getElementById("latest-broadcast-card");
  const titleEl = document.getElementById("latest-broadcast-title");
  const playerEl = document.getElementById("latest-broadcast-player");
  if (!cardEl || !titleEl || !playerEl) return;

  const staticBroadcasts = window.broadcasts || [];
  const typeLabels = window.broadcastTypeLabels || {};

  const render = (liveBroadcasts) => {
    const all = staticBroadcasts.concat(liveBroadcasts || []);
    if (!all.length) return;
    const latest = [...all].sort((a, b) => b.date.localeCompare(a.date))[0];
    titleEl.textContent = latest.title || `Week ${latest.week}: ${typeLabels[latest.type] || latest.type}`;
    playerEl.src = latest.file;
    cardEl.hidden = false;
  };

  render([]);

  const config = window.siteConfig || {};
  if (!config.firebaseConfig || config.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") return;
  setTimeout(() => {
    if (!firebase.apps.length) return; // main IIFE below didn't initialize for some reason
    firebase
      .firestore()
      .collection("broadcasts")
      .onSnapshot(
        (snapshot) => render(snapshot.docs.map((doc) => doc.data())),
        () => {}
      );
  }, 0);
})();


(function () {
  const config = window.siteConfig || {};
  const authPanelEl = document.getElementById("auth-panel");
  const statusSummaryEl = document.getElementById("league-status-summary");
  const rosterPicksAreaEl = document.getElementById("roster-picks-area");
  const rosterLockAreaEl = document.getElementById("roster-lock-area");
  const managerListEl = document.getElementById("manager-list");

  const escapeHtml = (value) => {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  // Best-effort only - never block the real action on this. Same Discord
  // channel as the Pokeball League, so posts carry this league's prefix.
  const notifyDiscord = (text) => {
    if (!config.discordWebhookUrl) return;
    fetch(config.discordWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `${config.discordMessagePrefix || ""}${text}` }),
    }).catch(() => {});
  };

  if (!config.firebaseConfig || config.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") {
    authPanelEl.innerHTML = `<p class="status error">The Powderpuff League isn't set up yet (missing Firebase config in config.js).</p>`;
    statusSummaryEl.textContent = "The Powderpuff League isn't set up yet.";
    return;
  }

  firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const storage = firebase.storage ? firebase.storage() : null;

  const isRealAdmin = () =>
    Boolean(auth.currentUser && config.adminUid && config.adminUid !== "YOUR_ADMIN_UID" && auth.currentUser.uid === config.adminUid);
  // Admin Mode toggle (pokemon-admin-toggle.js) - only ever hides admin-only
  // UI; Firestore rules still check the real uid regardless.
  const computeIsAdmin = () => isRealAdmin() && localStorage.getItem(`adminViewMode:${auth.currentUser.uid}`) !== "user";

  const teamAvatarHtml = (team, sizeClass = "") => {
    const name = (team && team.teamName) || "?";
    const cls = `team-avatar${sizeClass ? ` ${sizeClass}` : ""}`;
    if (team && team.photoURL) {
      return `<img class="${cls}" src="${escapeHtml(team.photoURL)}" alt="${escapeHtml(name)}" loading="lazy" />`;
    }
    return `<span class="${cls} team-avatar-placeholder">${escapeHtml(name.charAt(0) || "?")}</span>`;
  };

  const emptyRoster = () => {
    const roster = {};
    (config.pokemonPositions || []).forEach((slot) => {
      roster[slot] = null;
    });
    return roster;
  };

  const renderSignedOut = () => {
    authPanelEl.innerHTML = `
      <h2>Join the league</h2>
      <form class="auth-form" id="auth-form">
        <input type="text" id="auth-name" placeholder="Team manager name" autocomplete="name" />
        <input type="email" id="auth-email" placeholder="Email" autocomplete="email" required />
        <input type="password" id="auth-password" placeholder="Password" autocomplete="current-password" required minlength="6" />
        <div class="auth-tabs">
          <button type="button" class="btn" id="auth-signup-btn">Create Account</button>
          <button type="button" class="btn btn-secondary" id="auth-signin-btn">Sign In</button>
        </div>
      </form>
      <p class="status">This league has its own accounts - a Pokéball or Big Woof login won't work here.</p>
      <p class="status" id="auth-message" hidden></p>
    `;

    const messageEl = document.getElementById("auth-message");
    const showMessage = (text, isError) => {
      messageEl.hidden = false;
      messageEl.textContent = text;
      messageEl.className = `status${isError ? " error" : ""}`;
    };

    document.getElementById("auth-signup-btn").addEventListener("click", async () => {
      const displayName = document.getElementById("auth-name").value.trim() || "Unnamed Manager";
      const email = document.getElementById("auth-email").value.trim();
      const password = document.getElementById("auth-password").value;
      if (!email || password.length < 6) {
        showMessage("Enter an email and a password of at least 6 characters.", true);
        return;
      }
      try {
        const credential = await auth.createUserWithEmailAndPassword(email, password);
        await credential.user.updateProfile({ displayName });
        await db.collection("users").doc(credential.user.uid).set({
          displayName,
          email,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        await db.collection("teams").doc(credential.user.uid).set({
          ownerUid: credential.user.uid,
          managerName: displayName,
          teamName: `${displayName}'s Team`,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          slots: emptyRoster(),
        });
      } catch (error) {
        showMessage(error.message, true);
      }
    });

    document.getElementById("auth-signin-btn").addEventListener("click", async () => {
      const email = document.getElementById("auth-email").value.trim();
      const password = document.getElementById("auth-password").value;
      try {
        await auth.signInWithEmailAndPassword(email, password);
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  };

  // Leaving deletes the team, so it's only allowed before a schedule
  // exists (the same window firestore.rules allows the delete in).
  const canLeave = () => !latestSeasonState;

  const renderSignedIn = (user) => {
    const teamName = myTeam?.teamName || "";
    authPanelEl.innerHTML = `
      <div class="auth-identity">
        <div>
          <p class="auth-identity-name">${escapeHtml(user.displayName || user.email)}</p>
          <p>Signed in as ${escapeHtml(user.email)}</p>
        </div>
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <button type="button" class="btn btn-secondary" id="leave-league-btn" ${canLeave() ? "" : "disabled"}>Leave League</button>
          <button type="button" class="btn btn-secondary" id="auth-signout-btn">Sign Out</button>
        </div>
      </div>
      <form class="auth-form" id="team-name-form" style="margin-top: 1rem;">
        <label for="team-name-input">Team name</label>
        <input type="text" id="team-name-input" value="${escapeHtml(teamName)}" maxlength="40" required />
        <button type="button" class="btn btn-secondary" id="team-name-save-btn">Save Team Name</button>
      </form>
      <p class="status" id="team-name-message" hidden></p>

      <div class="team-photo-row">
        ${teamAvatarHtml(myTeam, "team-avatar--lg")}
        <div class="team-photo-controls">
          <input type="file" id="team-photo-input" accept="image/*" />
          <button type="button" class="btn btn-secondary" id="team-photo-upload-btn">Upload Photo</button>
          ${myTeam && myTeam.photoURL ? `<button type="button" class="btn btn-secondary" id="team-photo-remove-btn">Remove Photo</button>` : ""}
        </div>
      </div>
      <p class="status" id="team-photo-message" hidden></p>

      ${canLeave() ? "" : `<p class="status">Leaving isn't available once the season's schedule has been made.</p>`}
      <p class="status" id="leave-league-message" hidden></p>
    `;
    document.getElementById("auth-signout-btn").addEventListener("click", () => auth.signOut());
    document.getElementById("leave-league-btn").addEventListener("click", () => leaveLeague(user));
    document.getElementById("team-photo-upload-btn").addEventListener("click", () => uploadTeamPhoto(user));
    const removePhotoBtn = document.getElementById("team-photo-remove-btn");
    if (removePhotoBtn) removePhotoBtn.addEventListener("click", () => removeTeamPhoto(user));
    document.getElementById("team-name-save-btn").addEventListener("click", () => saveTeamName(user));
  };

  const messageShower = (id) => (text, isError) => {
    const messageEl = document.getElementById(id);
    if (!messageEl) return;
    messageEl.hidden = false;
    messageEl.textContent = text;
    messageEl.className = `status${isError ? " error" : ""}`;
  };

  async function saveTeamName(user) {
    const showMessage = messageShower("team-name-message");
    const newName = document.getElementById("team-name-input").value.trim();
    if (!newName) {
      showMessage("Team name can't be empty.", true);
      return;
    }
    try {
      await db.collection("teams").doc(user.uid).update({ teamName: newName });
      showMessage("Team name saved.", false);
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

  async function uploadTeamPhoto(user) {
    const showMessage = messageShower("team-photo-message");
    if (!storage) {
      showMessage("Photo uploads aren't available right now.", true);
      return;
    }
    const fileInput = document.getElementById("team-photo-input");
    const file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) {
      showMessage("Choose an image first.", true);
      return;
    }
    if (!file.type.startsWith("image/")) {
      showMessage("That file isn't an image.", true);
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      showMessage("Image is too large - 5MB max.", true);
      return;
    }
    try {
      showMessage("Uploading…", false);
      const photoRef = storage.ref(`teamPhotos/${user.uid}`);
      await photoRef.put(file, { contentType: file.type });
      const photoURL = await photoRef.getDownloadURL();
      await db.collection("teams").doc(user.uid).update({ photoURL });
      showMessage("Photo updated.", false);
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  async function removeTeamPhoto(user) {
    const showMessage = messageShower("team-photo-message");
    if (!storage) return;
    try {
      await storage.ref(`teamPhotos/${user.uid}`).delete();
      await db.collection("teams").doc(user.uid).update({ photoURL: firebase.firestore.FieldValue.delete() });
      showMessage("Photo removed.", false);
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  async function leaveLeague(user) {
    const showMessage = messageShower("leave-league-message");
    const confirmed = window.confirm(
      "Leave the league? This permanently deletes your team, your profile, and your login. This can't be undone."
    );
    if (!confirmed) return;
    try {
      await db.collection("teams").doc(user.uid).delete();
      await db.collection("users").doc(user.uid).delete();
      await user.delete();
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  // --- League status: manager list + the admin's roster-picks switch ---

  let latestTeams = [];
  let latestSettings = null;
  let latestSeasonState = null;
  let myTeam = null;
  let unsubscribers = [];

  const picksOpen = () => Boolean(latestSettings && latestSettings.rosterPicksOpen);
  const rostersLocked = () => Boolean(latestSettings && latestSettings.rostersLocked);
  const minTeams = config.minTeamsToGenerateSchedule || 4;

  const renderManagerList = () => {
    if (!latestTeams.length) {
      managerListEl.innerHTML = `<li class="manager-item">No managers have signed up yet.</li>`;
      return;
    }
    managerListEl.innerHTML = latestTeams
      .map(
        (team) =>
          `<li class="manager-item"><span class="manager-item-identity">${teamAvatarHtml(team)}<span class="manager-item-name">${escapeHtml(
            team.teamName || "Unnamed Team"
          )}</span></span></li>`
      )
      .join("");
  };

  const renderStatus = () => {
    const count = latestTeams.length;
    const teamsText = `${count} team${count === 1 ? "" : "s"} signed up`;
    let summary;
    if (latestSeasonState) {
      summary = `${teamsText}. The season schedule is out - see the Schedule page.`;
    } else if (count < minTeams) {
      summary = `${teamsText}. The schedule can be made once at least ${minTeams} teams have joined.`;
    } else {
      summary = `${teamsText} - enough to make the schedule.`;
    }
    statusSummaryEl.textContent = summary;

    const pickLine = picksOpen()
      ? `<p class="pp-picks-state pp-picks-state--open">🌸 Roster picks are open - fill your 14 spots on <a href="pokemon-myteam.html">My Team</a>.</p>`
      : `<p class="pp-picks-state">🔒 Roster picks aren't open yet. The admin will open them soon.</p>`;
    const adminBtn = computeIsAdmin()
      ? `<button type="button" class="btn${picksOpen() ? " btn-secondary" : ""}" id="toggle-picks-btn">${picksOpen() ? "Close Roster Picks" : "Open Roster Picks"}</button>
         <p class="status" id="toggle-picks-message" hidden></p>`
      : "";
    rosterPicksAreaEl.innerHTML = pickLine + adminBtn;
    const btn = document.getElementById("toggle-picks-btn");
    if (btn) btn.addEventListener("click", toggleRosterPicks);

    const lockLine = rostersLocked()
      ? `<p class="pp-picks-state">🔒 Rosters are locked right now - no lineup changes until the admin unlocks them.</p>`
      : `<p class="pp-picks-state pp-picks-state--open">Rosters are unlocked - managers can change their lineup.</p>`;
    const lockAdminBtn = computeIsAdmin()
      ? `<button type="button" class="btn${rostersLocked() ? "" : " btn-secondary"}" id="toggle-roster-lock-btn">${rostersLocked() ? "Unlock Rosters" : "Lock Rosters"}</button>
         <p class="status" id="toggle-roster-lock-message" hidden></p>`
      : "";
    rosterLockAreaEl.innerHTML = lockLine + lockAdminBtn;
    const lockBtn = document.getElementById("toggle-roster-lock-btn");
    if (lockBtn) lockBtn.addEventListener("click", toggleRosterLock);
  };

  async function toggleRosterPicks() {
    const showMessage = messageShower("toggle-picks-message");
    const opening = !picksOpen();
    if (
      !window.confirm(
        opening
          ? "Open roster picks? Every manager will be able to pick Pokémon for their team."
          : "Close roster picks? Nobody will be able to change their roster until you open them again."
      )
    ) {
      return;
    }
    const text = opening ? "Roster picks are open! Head to My Team to pick your Pokémon." : "Roster picks are closed for now.";
    try {
      const batch = db.batch();
      batch.set(db.collection("leagueSettings").doc("current"), { rosterPicksOpen: opening }, { merge: true });
      batch.set(db.collection("chatMessages").doc(), {
        uid: auth.currentUser.uid,
        system: true,
        text,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      await batch.commit();
      notifyDiscord(text);
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  async function toggleRosterLock() {
    const showMessage = messageShower("toggle-roster-lock-message");
    const locking = !rostersLocked();
    if (
      !window.confirm(
        locking
          ? "Lock rosters? Nobody will be able to change their lineup until you unlock them again."
          : "Unlock rosters? Managers will be able to change their lineup right away."
      )
    ) {
      return;
    }
    const text = locking ? "Rosters are locked - no lineup changes for now." : "Rosters are unlocked - go make your changes!";
    try {
      const batch = db.batch();
      batch.set(db.collection("leagueSettings").doc("current"), { rostersLocked: locking }, { merge: true });
      batch.set(db.collection("chatMessages").doc(), {
        uid: auth.currentUser.uid,
        system: true,
        text,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      await batch.commit();
      notifyDiscord(text);
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  // A signed-in account with no team - e.g. one whose sign-up made the
  // login but failed to save the team (such as before the database rules
  // were in place) - gets its team created here, once per page load.
  let ensureMyTeamTried = false;
  const ensureMyTeam = async () => {
    const user = auth.currentUser;
    if (!user || ensureMyTeamTried) return;
    ensureMyTeamTried = true;
    // A brand-new sign-up writes its own team a moment after the login
    // exists - give it time, then only step in if there's still no team.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      if ((await db.collection("teams").doc(user.uid).get()).exists) return;
    } catch (error) {
      return;
    }
    const displayName = user.displayName || (user.email || "").split("@")[0] || "Unnamed Manager";
    try {
      await db.collection("users").doc(user.uid).set(
        { displayName, email: user.email || "", createdAt: firebase.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      await db.collection("teams").doc(user.uid).set({
        ownerUid: user.uid,
        managerName: displayName,
        teamName: `${displayName}'s Team`,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        slots: emptyRoster(),
      });
    } catch (error) {
      statusSummaryEl.textContent = `Couldn't set up your team: ${error.message}`;
    }
  };

  // Firestore listeners that error out (e.g. because auth hadn't resolved
  // yet) don't retry on their own, so these are torn down and restarted
  // every time the sign-in state changes.
  const subscribeLeagueStatus = () => {
    unsubscribers.forEach((u) => u());
    unsubscribers = [];

    if (!auth.currentUser) {
      managerListEl.innerHTML = `<li class="manager-item">Sign in to see who's joined.</li>`;
      statusSummaryEl.textContent = "Sign in to see league status.";
      rosterPicksAreaEl.innerHTML = "";
      rosterLockAreaEl.innerHTML = "";
      myTeam = null;
      return;
    }

    const rerenderMe = () => {
      if (auth.currentUser) renderSignedIn(auth.currentUser);
    };

    unsubscribers.push(
      db
        .collection("teams")
        .doc(auth.currentUser.uid)
        .onSnapshot((doc) => {
          myTeam = doc.exists ? doc.data() : null;
          if (!doc.exists) ensureMyTeam();
          rerenderMe();
        }, () => {})
    );

    unsubscribers.push(
      db
        .collection("teams")
        .orderBy("createdAt")
        .onSnapshot(
          (snapshot) => {
            // Hidden teams (admin-only toggle, Rosters page) stay out of the
            // manager list and the headcount.
            latestTeams = snapshot.docs.map((doc) => ({ uid: doc.id, ...doc.data() })).filter((team) => !team.hidden);
            renderManagerList();
            renderStatus();
          },
          (error) => {
            managerListEl.innerHTML = `<li class="manager-item status error">Unable to load managers: ${escapeHtml(error.message)}</li>`;
          }
        )
    );

    unsubscribers.push(
      db
        .collection("leagueSettings")
        .doc("current")
        .onSnapshot((doc) => {
          latestSettings = doc.exists ? doc.data() : null;
          renderStatus();
        }, () => {})
    );

    unsubscribers.push(
      db
        .collection("seasonState")
        .doc("current")
        .onSnapshot((doc) => {
          latestSeasonState = doc.exists ? doc.data() : null;
          renderStatus();
          rerenderMe();
        }, () => {})
    );
  };

  auth.onAuthStateChanged((user) => {
    if (user) {
      renderSignedIn(user);
    } else {
      renderSignedOut();
    }
    subscribeLeagueStatus();
  });
})();
