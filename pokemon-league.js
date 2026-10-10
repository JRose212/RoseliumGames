(function () {
  const config = window.siteConfig || {};
  const authPanelEl = document.getElementById("auth-panel");
  const statusSummaryEl = document.getElementById("league-status-summary");
  const startDraftAreaEl = document.getElementById("start-draft-area");
  const managerListEl = document.getElementById("manager-list");

  const escapeHtml = (value) => {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  if (!config.firebaseConfig || config.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") {
    authPanelEl.innerHTML = `<p class="status error">Fantasy League is not configured yet (missing Firebase config in config.js).</p>`;
    statusSummaryEl.textContent = "Fantasy League is not configured yet.";
    return;
  }

  firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

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

  const renderSignedIn = (user) => {
    const draftPending = !latestDraftState || latestDraftState.status === "pending";
    const teamName = myTeam?.teamName || "";
    authPanelEl.innerHTML = `
      <div class="auth-identity">
        <div>
          <p class="auth-identity-name">${escapeHtml(user.displayName || user.email)}</p>
          <p>Signed in as ${escapeHtml(user.email)}</p>
        </div>
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          <button type="button" class="btn btn-secondary" id="leave-league-btn" ${draftPending ? "" : "disabled"}>Leave League</button>
          <button type="button" class="btn btn-secondary" id="auth-signout-btn">Sign Out</button>
        </div>
      </div>
      <form class="auth-form" id="team-name-form" style="margin-top: 1rem;">
        <label for="team-name-input">Team name</label>
        <input type="text" id="team-name-input" value="${escapeHtml(teamName)}" maxlength="40" required />
        <button type="button" class="btn btn-secondary" id="team-name-save-btn">Save Team Name</button>
      </form>
      <p class="status" id="team-name-message" hidden></p>
      ${draftPending ? "" : `<p class="status">Leaving isn't available once the draft has started.</p>`}
      <p class="status" id="leave-league-message" hidden></p>
    `;
    document.getElementById("auth-signout-btn").addEventListener("click", () => auth.signOut());
    document.getElementById("leave-league-btn").addEventListener("click", () => leaveLeague(user));
    document.getElementById("team-name-save-btn").addEventListener("click", () => saveTeamName(user));
  };

  async function saveTeamName(user) {
    const messageEl = document.getElementById("team-name-message");
    const showMessage = (text, isError) => {
      if (!messageEl) return;
      messageEl.hidden = false;
      messageEl.textContent = text;
      messageEl.className = `status${isError ? " error" : ""}`;
    };
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

  async function leaveLeague(user) {
    const messageEl = document.getElementById("leave-league-message");
    const showMessage = (text, isError) => {
      if (!messageEl) return;
      messageEl.hidden = false;
      messageEl.textContent = text;
      messageEl.className = `status${isError ? " error" : ""}`;
    };

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

  // League status: manager list + draft status + Start Draft gate.
  let latestTeams = [];
  let latestDraftState = null;
  let myTeam = null;
  let unsubscribeTeams = null;
  let unsubscribeDraftState = null;
  let unsubscribeMyTeam = null;

  const renderManagerList = () => {
    if (!latestTeams.length) {
      managerListEl.innerHTML = `<li class="manager-item">No managers have signed up yet.</li>`;
      return;
    }
    managerListEl.innerHTML = latestTeams
      .map(
        (team) =>
          `<li class="manager-item"><span class="manager-item-name">${escapeHtml(
            team.teamName || "Unnamed Team"
          )}</span></li>`
      )
      .join("");
  };

  const renderStartDraftArea = () => {
    if (!latestDraftState) return;
    const minManagers = config.minManagersToStartDraft || 8;

    if (latestDraftState.status === "drafting") {
      startDraftAreaEl.innerHTML = `<p class="status">The draft is in progress — <a href="pokemon-draft.html">head to the Draft Room</a>.</p>`;
      return;
    }
    if (latestDraftState.status === "complete") {
      startDraftAreaEl.innerHTML = `<p class="status">The draft is complete — <a href="pokemon-teams.html">view the rosters</a>.</p>`;
      return;
    }

    if (latestTeams.length < minManagers) {
      startDraftAreaEl.innerHTML = `<p class="status">Need at least ${minManagers} managers to start the draft (${latestTeams.length} signed up so far).</p>`;
      return;
    }

    if (!auth.currentUser) {
      startDraftAreaEl.innerHTML = `<p class="status">Sign in to start the draft.</p>`;
      return;
    }

    startDraftAreaEl.innerHTML = `<button type="button" class="btn" id="start-draft-btn">Start Draft (${latestTeams.length} managers)</button><p class="status" id="start-draft-message" hidden></p>`;
    document.getElementById("start-draft-btn").addEventListener("click", startDraft);
  };

  // Firestore listeners that error out (e.g. because auth hadn't resolved
  // yet) don't retry on their own, so these are torn down and restarted
  // every time the sign-in state actually changes rather than started once
  // unconditionally at page load.
  const subscribeLeagueStatus = () => {
    if (unsubscribeTeams) {
      unsubscribeTeams();
      unsubscribeTeams = null;
    }
    if (unsubscribeDraftState) {
      unsubscribeDraftState();
      unsubscribeDraftState = null;
    }
    if (unsubscribeMyTeam) {
      unsubscribeMyTeam();
      unsubscribeMyTeam = null;
    }

    if (!auth.currentUser) {
      managerListEl.innerHTML = `<li class="manager-item">Sign in to see who's joined.</li>`;
      statusSummaryEl.textContent = "Sign in to see league status.";
      startDraftAreaEl.innerHTML = "";
      myTeam = null;
      return;
    }

    unsubscribeMyTeam = db
      .collection("teams")
      .doc(auth.currentUser.uid)
      .onSnapshot(
        (doc) => {
          myTeam = doc.exists ? doc.data() : null;
          if (auth.currentUser) renderSignedIn(auth.currentUser);
        },
        () => {}
      );

    unsubscribeTeams = db
      .collection("teams")
      .orderBy("createdAt")
      .onSnapshot(
        (snapshot) => {
          latestTeams = snapshot.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
          renderManagerList();
          renderStartDraftArea();
        },
        (error) => {
          managerListEl.innerHTML = `<li class="manager-item status error">Unable to load managers: ${escapeHtml(error.message)}</li>`;
        }
      );

    unsubscribeDraftState = db
      .collection("draftState")
      .doc("current")
      .onSnapshot(
        (doc) => {
          latestDraftState = doc.exists ? doc.data() : null;
          if (!latestDraftState) {
            statusSummaryEl.textContent = "Draft state has not been set up yet.";
            return;
          }
          if (latestDraftState.status === "pending") {
            statusSummaryEl.textContent = "Signups are open. The draft hasn't started yet.";
          } else if (latestDraftState.status === "drafting") {
            statusSummaryEl.textContent = `Draft in progress — pick ${latestDraftState.currentPickIndex + 1} of ${latestDraftState.pickOrder.length}.`;
          } else if (latestDraftState.status === "complete") {
            statusSummaryEl.textContent = "The draft is complete.";
          }
          renderStartDraftArea();
          if (auth.currentUser) renderSignedIn(auth.currentUser);
        },
        (error) => {
          statusSummaryEl.textContent = `Unable to load draft status: ${error.message}`;
        }
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

  const buildSnakePickOrder = (uids, positions) => {
    const order = [];
    for (let round = 0; round < positions.length; round++) {
      const roundUids = round % 2 === 0 ? uids : [...uids].slice().reverse();
      order.push(...roundUids);
    }
    return order;
  };

  async function startDraft() {
    const messageEl = document.getElementById("start-draft-message");
    const showMessage = (text, isError) => {
      if (!messageEl) return;
      messageEl.hidden = false;
      messageEl.textContent = text;
      messageEl.className = `status${isError ? " error" : ""}`;
    };

    try {
      const teamsSnapshot = await db.collection("teams").orderBy("createdAt").get();
      const uids = teamsSnapshot.docs.map((doc) => doc.id);
      const positions = config.pokemonPositions || [];
      const pickOrder = buildSnakePickOrder(uids, positions);

      const stateRef = db.collection("draftState").doc("current");
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(stateRef);
        if (!snap.exists || snap.data().status !== "pending") {
          throw new Error("The draft has already been started.");
        }
        tx.update(stateRef, {
          status: "drafting",
          participants: uids,
          pickOrder,
          positionList: positions,
          currentPickIndex: 0,
          currentUid: pickOrder[0],
          currentRound: 1,
          pickDeadlineAt: firebase.firestore.Timestamp.fromMillis(
            Date.now() + (config.autodraftTimeoutMs || 2 * 60 * 1000)
          ),
          startedAt: firebase.firestore.FieldValue.serverTimestamp(),
          startedBy: auth.currentUser.uid,
        });
      });
    } catch (error) {
      showMessage(error.message, true);
    }
  }
})();
