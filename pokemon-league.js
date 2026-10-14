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

// Latest broadcast card - also standalone, reading the hand-maintained
// window.broadcasts list from broadcasts.js. No Firebase/auth dependency,
// so it shows for signed-out visitors too.
(function () {
  const cardEl = document.getElementById("latest-broadcast-card");
  const titleEl = document.getElementById("latest-broadcast-title");
  const playerEl = document.getElementById("latest-broadcast-player");
  if (!cardEl || !titleEl || !playerEl) return;

  const broadcasts = window.broadcasts || [];
  if (!broadcasts.length) return;

  const typeLabels = window.broadcastTypeLabels || {};
  const latest = [...broadcasts].sort((a, b) => b.date.localeCompare(a.date))[0];
  titleEl.textContent = latest.title || `Week ${latest.week}: ${typeLabels[latest.type] || latest.type}`;
  playerEl.src = latest.file;
  cardEl.hidden = false;
})();

(function () {
  const config = window.siteConfig || {};
  const authPanelEl = document.getElementById("auth-panel");
  const statusSummaryEl = document.getElementById("league-status-summary");
  const startDraftAreaEl = document.getElementById("start-draft-area");
  const draftOrderAreaEl = document.getElementById("draft-order-area");
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

    const isAdmin = Boolean(
      auth.currentUser && config.adminUid && config.adminUid !== "YOUR_ADMIN_UID" && auth.currentUser.uid === config.adminUid
    );
    const restartButtonHtml = isAdmin
      ? `<button type="button" class="btn btn-secondary" id="restart-draft-btn">Restart Draft</button>`
      : "";

    if (latestDraftState.status === "drafting") {
      startDraftAreaEl.innerHTML = `<p class="status">The draft is in progress — <a href="pokemon-draft.html">head to the Draft Room</a>.</p>${restartButtonHtml}<p class="status" id="restart-draft-message" hidden></p>`;
      if (isAdmin) document.getElementById("restart-draft-btn").addEventListener("click", restartDraft);
      return;
    }
    if (latestDraftState.status === "complete") {
      startDraftAreaEl.innerHTML = `<p class="status">The draft is complete — <a href="pokemon-teams.html">view the rosters</a>.</p>${restartButtonHtml}<p class="status" id="restart-draft-message" hidden></p>`;
      if (isAdmin) document.getElementById("restart-draft-btn").addEventListener("click", restartDraft);
      return;
    }

    if (latestTeams.length < minManagers) {
      startDraftAreaEl.innerHTML = `<p class="status">Need at least ${minManagers} managers to start the draft (${latestTeams.length} signed up so far).</p>`;
      return;
    }

    const hasOrder = Boolean(latestDraftState.draftOrder && latestDraftState.draftOrder.length);

    if (!isAdmin) {
      startDraftAreaEl.innerHTML = `<p class="status">${latestTeams.length} managers signed up - the admin will start the draft when ready.</p>`;
      return;
    }

    const orderButtonLabel = hasOrder ? "Regenerate Draft Order" : "Generate Draft Order";
    startDraftAreaEl.innerHTML = `
      <button type="button" class="btn btn-secondary" id="generate-order-btn">${orderButtonLabel}</button>
      <button type="button" class="btn" id="start-draft-btn">Start Draft (${latestTeams.length} managers)</button>
      <p class="status" id="start-draft-message" hidden></p>
    `;
    document.getElementById("generate-order-btn").addEventListener("click", generateDraftOrder);
    document.getElementById("start-draft-btn").addEventListener("click", startDraft);
  };

  const renderDraftOrderArea = () => {
    if (!draftOrderAreaEl) return;
    const order = latestDraftState && latestDraftState.draftOrder;
    if (!order || !order.length) {
      draftOrderAreaEl.innerHTML = "";
      return;
    }

    const isAdmin = Boolean(
      auth.currentUser && config.adminUid && config.adminUid !== "YOUR_ADMIN_UID" && auth.currentUser.uid === config.adminUid
    );

    const nameByUid = {};
    latestTeams.forEach((team) => {
      nameByUid[team.uid] = team.teamName || "Unnamed Team";
    });
    const myUid = auth.currentUser && auth.currentUser.uid;

    const rows = order
      .map((uid, index) => {
        const isMe = uid === myUid;
        const name = escapeHtml(nameByUid[uid] || "Unknown manager");
        return `<li class="manager-item"${isMe ? ' style="font-weight: bold;"' : ""}><span class="manager-item-name">${index + 1}. ${name}${isMe ? " (You)" : ""}</span></li>`;
      })
      .join("");

    const statusNote =
      latestDraftState.status === "pending"
        ? "This is the order the draft will start in once the admin clicks Start Draft."
        : "";

    // Admin-only manual reordering, for the rare case a manager needs to
    // swap spots before the draft actually starts (illness, scheduling,
    // etc.) - only usable while status is still "pending", since once
    // Start Draft has run this field no longer drives anything.
    const swapToolHtml =
      isAdmin && latestDraftState.status === "pending"
        ? `
          <div class="auth-form" style="margin-top: 0.75rem; max-width: 320px;">
            <label for="swap-pos-a">Swap pick #</label>
            <input type="number" id="swap-pos-a" min="1" max="${order.length}" placeholder="e.g. 14" />
            <label for="swap-pos-b">with pick #</label>
            <input type="number" id="swap-pos-b" min="1" max="${order.length}" placeholder="e.g. 8" />
            <button type="button" class="btn btn-secondary" id="swap-order-btn">Swap</button>
          </div>
          <p class="status" id="swap-order-message" hidden></p>
        `
        : "";

    draftOrderAreaEl.innerHTML = `
      <h3 style="margin-top: 1rem;">Draft Order (Round 1)</h3>
      <p class="status">Snake draft - order reverses every round, so whoever picks last here picks first in Round 2.${statusNote ? " " + statusNote : ""}</p>
      <ul class="manager-list">${rows}</ul>
      ${swapToolHtml}
    `;

    if (isAdmin && latestDraftState.status === "pending") {
      document.getElementById("swap-order-btn").addEventListener("click", swapDraftOrderPositions);
    }
  };

  async function swapDraftOrderPositions() {
    const messageEl = document.getElementById("swap-order-message");
    const showMessage = (text, isError) => {
      if (!messageEl) return;
      messageEl.hidden = false;
      messageEl.textContent = text;
      messageEl.className = `status${isError ? " error" : ""}`;
    };

    const order = latestDraftState && latestDraftState.draftOrder;
    const a = parseInt(document.getElementById("swap-pos-a").value, 10);
    const b = parseInt(document.getElementById("swap-pos-b").value, 10);

    if (!order || !a || !b || a < 1 || b < 1 || a > order.length || b > order.length) {
      showMessage(`Enter two pick numbers between 1 and ${order ? order.length : "?"}.`, true);
      return;
    }
    if (a === b) {
      showMessage("Pick numbers must be different.", true);
      return;
    }

    const newOrder = order.slice();
    [newOrder[a - 1], newOrder[b - 1]] = [newOrder[b - 1], newOrder[a - 1]];

    try {
      const stateRef = db.collection("draftState").doc("current");
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(stateRef);
        if (!snap.exists || snap.data().status !== "pending") {
          throw new Error("The draft order can only be edited before the draft starts.");
        }
        tx.update(stateRef, { draftOrder: newOrder });
      });
      showMessage(`Swapped pick ${a} and pick ${b}.`, false);
    } catch (error) {
      showMessage(error.message, true);
    }
  }

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
      draftOrderAreaEl.innerHTML = "";
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
          // Hidden teams (admin-only toggle, Rosters page) stay out of the
          // manager list, the Start Draft headcount, and the draft itself.
          latestTeams = snapshot.docs.map((doc) => ({ uid: doc.id, ...doc.data() })).filter((team) => !team.hidden);
          renderManagerList();
          renderStartDraftArea();
          renderDraftOrderArea();
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
          renderDraftOrderArea();
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

  // Fisher-Yates - picks a fresh random round-1 order each time the draft
  // is started, rather than always running in signup order.
  const shuffle = (array) => {
    const result = array.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };

  // Lets the admin lock in and publish the round-1 order before draft
  // night, separately from actually starting the clock - status stays
  // "pending" so nothing else about the draft changes yet. startDraft()
  // below reuses this order instead of reshuffling if one is already set.
  async function generateDraftOrder() {
    const messageEl = document.getElementById("start-draft-message");
    const showMessage = (text, isError) => {
      if (!messageEl) return;
      messageEl.hidden = false;
      messageEl.textContent = text;
      messageEl.className = `status${isError ? " error" : ""}`;
    };

    try {
      const teamsSnapshot = await db.collection("teams").orderBy("createdAt").get();
      const uids = shuffle(teamsSnapshot.docs.filter((doc) => !doc.data().hidden).map((doc) => doc.id));

      const stateRef = db.collection("draftState").doc("current");
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(stateRef);
        if (!snap.exists || snap.data().status !== "pending") {
          throw new Error("The draft order can only be set before the draft starts.");
        }
        tx.update(stateRef, {
          draftOrder: uids,
          draftOrderSetAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
      showMessage("Draft order generated - visible to everyone below.", false);
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  async function startDraft() {
    const messageEl = document.getElementById("start-draft-message");
    const showMessage = (text, isError) => {
      if (!messageEl) return;
      messageEl.hidden = false;
      messageEl.textContent = text;
      messageEl.className = `status${isError ? " error" : ""}`;
    };

    try {
      // Reuse the order from Generate Draft Order if the admin already set
      // one, so the published round-1 order is exactly what's used - only
      // falls back to a fresh shuffle here if no order was pre-generated.
      let uids = latestDraftState && latestDraftState.draftOrder;
      if (!uids || !uids.length) {
        const teamsSnapshot = await db.collection("teams").orderBy("createdAt").get();
        uids = shuffle(teamsSnapshot.docs.filter((doc) => !doc.data().hidden).map((doc) => doc.id));
      }
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
            Date.now() + (config.autodraftTimeoutMs || 20 * 1000)
          ),
          startedAt: firebase.firestore.FieldValue.serverTimestamp(),
          startedBy: auth.currentUser.uid,
        });
      });
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  // Admin-only. Wipes every pick/roster/training record so a draft can be
  // run again from scratch - pick numbering always restarts at 0001, which
  // would otherwise collide with leftover draftPicks docs from whatever
  // draft ran before and get rejected by the append-only security rule.
  // Training streaks/bonus sessions and the daily trainingLog are wiped
  // too, since those are tied to a specific draft's rosters, not something
  // that should carry over into a redone test (or a real restart). Pre-
  // draft rankings are left untouched since those are a manager's own
  // standing preferences, not part of a single draft run.
  async function restartDraft() {
    const messageEl = document.getElementById("restart-draft-message");
    const showMessage = (text, isError) => {
      if (!messageEl) return;
      messageEl.hidden = false;
      messageEl.textContent = text;
      messageEl.className = `status${isError ? " error" : ""}`;
    };

    if (
      !window.confirm(
        "This permanently deletes every draft pick, empties every roster, and clears all training streaks/bonus sessions. Continue?"
      )
    ) {
      return;
    }

    try {
      const [picksSnapshot, draftedSnapshot, teamsSnapshot, trainingLogSnapshot] = await Promise.all([
        db.collection("draftPicks").get(),
        db.collection("draftedPokemon").get(),
        db.collection("teams").get(),
        db.collection("trainingLog").get(),
      ]);

      const ops = [];
      picksSnapshot.docs.forEach((doc) => ops.push({ ref: doc.ref, type: "delete" }));
      draftedSnapshot.docs.forEach((doc) => ops.push({ ref: doc.ref, type: "delete" }));
      trainingLogSnapshot.docs.forEach((doc) => ops.push({ ref: doc.ref, type: "delete" }));
      teamsSnapshot.docs.forEach((doc) =>
        ops.push({
          ref: doc.ref,
          type: "update",
          data: { slots: emptyRoster(), training: firebase.firestore.FieldValue.delete() },
        })
      );
      ops.push({
        ref: db.collection("draftState").doc("current"),
        type: "update",
        data: {
          status: "pending",
          participants: [],
          pickOrder: [],
          positionList: [],
          currentPickIndex: 0,
          currentUid: null,
          currentRound: 1,
          pickDeadlineAt: null,
          completedAt: null,
          startedAt: null,
          startedBy: null,
          draftOrder: [],
          draftOrderSetAt: null,
        },
      });

      // Firestore caps a single batch at 500 writes.
      for (let i = 0; i < ops.length; i += 450) {
        const batch = db.batch();
        ops.slice(i, i + 450).forEach((op) => {
          if (op.type === "delete") batch.delete(op.ref);
          else batch.update(op.ref, op.data);
        });
        await batch.commit();
      }

      showMessage("Draft restarted - picks cleared, rosters emptied, training reset.");
    } catch (error) {
      showMessage(error.message, true);
    }
  }
})();
