(function () {
  const config = window.siteConfig || {};
  const statusEl = document.getElementById("myteam-status");
  const rosterCardEl = document.getElementById("myteam-roster-card");
  const offenseGridEl = document.getElementById("myteam-offense-grid");
  const defenseGridEl = document.getElementById("myteam-defense-grid");
  const specialGridEl = document.getElementById("myteam-special-grid");
  const benchGridEl = document.getElementById("myteam-bench-grid");
  const matchupCardEl = document.getElementById("myteam-matchup-card");
  const matchupMetaEl = document.getElementById("myteam-matchup-meta");
  const oppHeadingEl = document.getElementById("myteam-opp-heading");
  const oppListEl = document.getElementById("myteam-opp-list");
  const trainingCardEl = document.getElementById("training-card");
  const trainingInfoBtnEl = document.getElementById("training-info-btn");
  const trainingInfoPopoverEl = document.getElementById("training-info-popover");
  const trainingMetaEl = document.getElementById("training-meta");
  const trainingButtonsEl = document.getElementById("training-buttons");
  const trainingMessageEl = document.getElementById("training-message");
  const myTrainingBadgesEl = document.getElementById("myteam-training-badges");

  if (!rosterCardEl) return;

  const escapeHtml = (value) => {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  const smallSpriteUrl = (pokemonId) =>
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemonId}.png`;
  const largeSpriteUrl = (pokemonId) =>
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokemonId}.png`;
  const itemSpriteUrl = (item) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${item}.png`;

  const trainingTypes = config.trainingTypes || [];
  const trainingTypeByKey = new Map(trainingTypes.map((t) => [t.key, t]));

  // Local calendar day, not a rolling 24h window - 11:59pm and 12:01am the
  // next day are two different training days.
  const dateKey = (offsetDays = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  if (!config.firebaseConfig || config.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") {
    statusEl.className = "status error";
    statusEl.textContent = "Fantasy League is not configured yet.";
    return;
  }

  firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const groups = config.positionGroups || { offense: [], defense: [], specialTeams: [], bench: [] };

  let currentUser = null;
  let teamsByUid = new Map();
  let matchups = [];
  let currentWeek = null;
  let todayLog = null;

  // --- Training ---

  const trainingBadgesHtml = (training) => {
    const t = training || {};
    const streak = t.currentStreak || 0;
    const bonus = t.bonusSessionsAvailable || 0;
    const parts = [];
    if (streak > 0) parts.push(`<span class="training-badge training-badge--streak">🔥 ${streak}-day streak</span>`);
    if (bonus > 0) parts.push(`<span class="training-badge training-badge--bonus">+${bonus} bonus session${bonus === 1 ? "" : "s"}</span>`);
    return parts.join("");
  };

  let trainingMessageTimeout = null;
  const showTrainingMessage = (text, isError) => {
    trainingMessageEl.hidden = false;
    trainingMessageEl.className = `status${isError ? " error" : ""}`;
    trainingMessageEl.textContent = text;
    clearTimeout(trainingMessageTimeout);
    trainingMessageTimeout = setTimeout(() => {
      trainingMessageEl.hidden = true;
    }, 5000);
  };

  const renderTraining = () => {
    if (!currentUser) {
      trainingCardEl.hidden = true;
      return;
    }
    const myTeam = teamsByUid.get(currentUser.uid);
    if (!myTeam) {
      trainingCardEl.hidden = true;
      return;
    }
    trainingCardEl.hidden = false;

    const training = myTeam.training || {};
    const bonusAvailable = training.bonusSessionsAvailable || 0;
    const doneToday = (todayLog && todayLog.types) || [];
    const maxToday = bonusAvailable > 0 ? 2 : 1;
    const quotaUsed = doneToday.length >= maxToday;

    if (doneToday.length === 0) {
      trainingMetaEl.textContent =
        bonusAvailable > 0
          ? `You have a bonus session banked - pick up to 2 today.`
          : `Pick today's training session.`;
    } else if (!quotaUsed) {
      trainingMetaEl.textContent = `One more session available today (bonus session banked).`;
    } else {
      trainingMetaEl.textContent = `Today's training is done. Come back tomorrow.`;
    }

    trainingButtonsEl.innerHTML = trainingTypes
      .map((type) => {
        const alreadyDone = doneToday.includes(type.key);
        const disabled = alreadyDone || quotaUsed;
        return `<button type="button" class="training-btn${alreadyDone ? " training-btn--done" : ""}" data-key="${type.key}"
                  style="--training-color: ${type.color}" ${disabled ? "disabled" : ""}>
                  <img class="training-btn-sprite" src="${itemSpriteUrl(type.item)}" alt="" loading="lazy" />
                  <span>${escapeHtml(type.label)}</span>
                  ${alreadyDone ? `<span class="training-btn-check">✓ Done today</span>` : ""}
                </button>`;
      })
      .join("");

    trainingButtonsEl.querySelectorAll(".training-btn:not([disabled])").forEach((btn) => {
      btn.addEventListener("click", () => logTraining(btn.dataset.key));
    });
  };

  async function logTraining(typeKey) {
    if (!currentUser) return;
    const type = trainingTypeByKey.get(typeKey);
    if (!type) return;

    const today = dateKey();
    const yesterday = dateKey(-1);
    const logRef = db.collection("trainingLog").doc(`${currentUser.uid}_${today}`);
    const teamRef = db.collection("teams").doc(currentUser.uid);

    try {
      await db.runTransaction(async (tx) => {
        const [logSnap, teamSnap] = await Promise.all([tx.get(logRef), tx.get(teamRef)]);
        const team = teamSnap.data();
        const training = (team && team.training) || {};
        const bonusAvailable = training.bonusSessionsAvailable || 0;

        if (!logSnap.exists) {
          const prevStreak = training.lastTrainedDate === yesterday ? training.currentStreak || 0 : 0;
          tx.set(logRef, {
            uid: currentUser.uid,
            date: today,
            types: [typeKey],
            loggedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
          tx.update(teamRef, {
            "training.lastTrainedDate": today,
            "training.currentStreak": prevStreak + 1,
          });
          return;
        }

        const existing = logSnap.data();
        if (existing.types.includes(typeKey)) throw new Error("You've already done that session today.");
        if (existing.types.length >= 2) throw new Error("No more training sessions available today.");
        if (bonusAvailable <= 0) throw new Error("No more training sessions available today.");

        tx.update(logRef, { types: firebase.firestore.FieldValue.arrayUnion(typeKey) });
        tx.update(teamRef, { "training.bonusSessionsAvailable": firebase.firestore.FieldValue.increment(-1) });
      });
      showTrainingMessage(`Your team had a good ${type.label} session today!`);
    } catch (error) {
      showTrainingMessage(error.message, true);
    }
  }

  trainingInfoBtnEl.addEventListener("click", (event) => {
    event.stopPropagation();
    trainingInfoPopoverEl.hidden = !trainingInfoPopoverEl.hidden;
  });
  document.addEventListener("click", (event) => {
    if (!trainingInfoPopoverEl.hidden && !trainingInfoPopoverEl.contains(event.target) && event.target !== trainingInfoBtnEl) {
      trainingInfoPopoverEl.hidden = true;
    }
  });
  if (trainingInfoPopoverEl) {
    trainingInfoPopoverEl.innerHTML = (config.trainingInfoBlurb || "")
      .split("\n\n")
      .map((para) => `<p>${escapeHtml(para)}</p>`)
      .join("");
  }

  // --- My roster: draggable, square, large-sprite slots ---

  const renderSlot = (position, slots) => {
    const pick = slots[position];
    const isOut = pick && currentWeek !== null && pick.outForWeek === currentWeek;
    if (!pick) {
      return `<div class="myteam-slot" data-position="${escapeHtml(position)}">
                <span class="myteam-slot-position">${escapeHtml(position)}</span>
                <span class="myteam-slot-empty">— empty —</span>
              </div>`;
    }
    return `<div class="myteam-slot myteam-slot--filled${isOut ? " myteam-slot--out" : ""}" draggable="true" data-position="${escapeHtml(
      position
    )}">
              <span class="myteam-slot-position">${escapeHtml(position)}</span>
              <img class="myteam-slot-sprite" src="${largeSpriteUrl(pick.pokemonId)}" alt="${escapeHtml(pick.pokemonName)}" loading="lazy" />
              <span class="myteam-slot-name">${escapeHtml(pick.pokemonName)}</span>
              ${isOut ? `<span class="myteam-out-badge">OUT — Wk ${pick.outForWeek}</span>` : ""}
            </div>`;
  };

  let draggedPosition = null;

  const wireDragAndDrop = (gridEl) => {
    gridEl.querySelectorAll(".myteam-slot").forEach((slotEl) => {
      slotEl.addEventListener("dragstart", (event) => {
        if (!slotEl.classList.contains("myteam-slot--filled")) {
          event.preventDefault();
          return;
        }
        draggedPosition = slotEl.dataset.position;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedPosition);
      });
      slotEl.addEventListener("dragover", (event) => {
        if (draggedPosition === null || draggedPosition === slotEl.dataset.position) return;
        event.preventDefault();
        slotEl.classList.add("myteam-slot--dragover");
      });
      slotEl.addEventListener("dragleave", () => {
        slotEl.classList.remove("myteam-slot--dragover");
      });
      slotEl.addEventListener("drop", (event) => {
        event.preventDefault();
        slotEl.classList.remove("myteam-slot--dragover");
        const fromPosition = draggedPosition;
        const toPosition = slotEl.dataset.position;
        draggedPosition = null;
        if (!fromPosition || fromPosition === toPosition) return;
        swapSlots(fromPosition, toPosition);
      });
      slotEl.addEventListener("dragend", () => {
        draggedPosition = null;
        gridEl.querySelectorAll(".myteam-slot--dragover").forEach((el) => el.classList.remove("myteam-slot--dragover"));
      });
    });
  };

  const renderMyRoster = () => {
    if (!currentUser) {
      rosterCardEl.hidden = true;
      return;
    }
    const myTeam = teamsByUid.get(currentUser.uid);
    if (!myTeam) {
      rosterCardEl.hidden = true;
      return;
    }
    rosterCardEl.hidden = false;
    myTrainingBadgesEl.innerHTML = trainingBadgesHtml(myTeam.training);
    const slots = myTeam.slots || {};

    const groupRender = (gridEl, positions) => {
      gridEl.innerHTML = positions.map((position) => renderSlot(position, slots)).join("");
      wireDragAndDrop(gridEl);
    };

    groupRender(offenseGridEl, groups.offense || []);
    groupRender(defenseGridEl, groups.defense || []);
    groupRender(specialGridEl, groups.specialTeams || []);
    groupRender(benchGridEl, groups.bench || []);
  };

  async function swapSlots(fromPosition, toPosition) {
    if (!currentUser) return;
    const teamRef = db.collection("teams").doc(currentUser.uid);
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(teamRef);
        const team = snap.data();
        if (!team || !team.slots) throw new Error("Team not found.");
        const fromValue = team.slots[fromPosition] || null;
        const toValue = team.slots[toPosition] || null;
        tx.update(teamRef, {
          [`slots.${fromPosition}`]: toValue,
          [`slots.${toPosition}`]: fromValue,
        });
      });
    } catch (error) {
      window.alert(`Unable to move Pokémon: ${error.message}`);
    }
  }

  // --- Next matchup + opponent roster (small sprites, read-only) ---

  const renderOppRow = (position, slots) => {
    const pick = slots[position];
    const middle = pick
      ? `<span class="roster-row-filled">
          <img class="roster-row-sprite" src="${smallSpriteUrl(pick.pokemonId)}" alt="${escapeHtml(pick.pokemonName)}" loading="lazy" />
          ${escapeHtml(pick.pokemonName)}
        </span>`
      : `<span class="roster-row-empty">— empty —</span>`;
    return `<li class="roster-row">
              <span class="roster-row-position">${escapeHtml(position)}</span>
              ${middle}
            </li>`;
  };

  const formatMatchupDate = (date) => {
    if (!date) return "";
    return date.toDate().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  };

  const renderNextMatchup = () => {
    if (!currentUser) {
      matchupCardEl.hidden = true;
      return;
    }
    const upcoming = matchups
      .filter((m) => m.status === "scheduled" && (m.homeUid === currentUser.uid || m.awayUid === currentUser.uid))
      .sort((a, b) => a.date.toMillis() - b.date.toMillis())[0];

    if (!upcoming) {
      matchupCardEl.hidden = false;
      matchupMetaEl.hidden = false;
      matchupMetaEl.textContent = "No upcoming matchup scheduled yet.";
      oppHeadingEl.innerHTML = `Opponent<span class="training-badges" id="myteam-opp-training-badges"></span>`;
      oppListEl.innerHTML = "";
      return;
    }

    const opponentUid = upcoming.homeUid === currentUser.uid ? upcoming.awayUid : upcoming.homeUid;
    const opponent = teamsByUid.get(opponentUid);
    const opponentSlots = (opponent && opponent.slots) || {};

    matchupCardEl.hidden = false;
    matchupMetaEl.hidden = false;
    matchupMetaEl.textContent = `Week ${upcoming.week} — ${formatMatchupDate(upcoming.date)}`;
    const opponentName = escapeHtml(opponent ? opponent.teamName || "Unnamed Team" : "Unknown team");
    oppHeadingEl.innerHTML = `${opponentName}<span class="training-badges">${trainingBadgesHtml(opponent && opponent.training)}</span>`;

    const positions = config.pokemonPositions || [];
    oppListEl.innerHTML = positions.map((position) => renderOppRow(position, opponentSlots)).join("");
  };

  const renderAll = () => {
    renderMyRoster();
    renderNextMatchup();
    renderTraining();
  };

  // --- Live listeners ---

  let unsubscribeTeams = null;
  let unsubscribeMatchups = null;
  let unsubscribeTodayLog = null;
  let unsubscribeSeason = null;

  const subscribe = () => {
    [unsubscribeTeams, unsubscribeMatchups, unsubscribeSeason, unsubscribeTodayLog].forEach(
      (unsubscribe) => unsubscribe && unsubscribe()
    );
    unsubscribeTeams = unsubscribeMatchups = unsubscribeSeason = unsubscribeTodayLog = null;
    todayLog = null;

    if (!currentUser) {
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.innerHTML = `Sign in on the <a href="pokemon-league.html">League Home</a> page to view your team.`;
      rosterCardEl.hidden = true;
      matchupCardEl.hidden = true;
      trainingCardEl.hidden = true;
      return;
    }

    unsubscribeTodayLog = db
      .collection("trainingLog")
      .doc(`${currentUser.uid}_${dateKey()}`)
      .onSnapshot(
        (doc) => {
          todayLog = doc.exists ? doc.data() : null;
          renderAll();
        },
        () => {}
      );

    statusEl.hidden = true;

    unsubscribeTeams = db.collection("teams").onSnapshot(
      (snapshot) => {
        teamsByUid = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
        if (!teamsByUid.has(currentUser.uid)) {
          statusEl.hidden = false;
          statusEl.className = "status";
          statusEl.innerHTML = `You haven't joined the league yet - head to <a href="pokemon-league.html">League Home</a> to sign up.`;
          rosterCardEl.hidden = true;
          matchupCardEl.hidden = true;
          return;
        }
        statusEl.hidden = true;
        renderAll();
      },
      (error) => {
        statusEl.hidden = false;
        statusEl.className = "status error";
        statusEl.textContent = `Unable to load your team: ${error.message}`;
      }
    );

    unsubscribeMatchups = db.collection("matchups").onSnapshot(
      (snapshot) => {
        matchups = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        renderAll();
      },
      () => {}
    );

    unsubscribeSeason = db
      .collection("seasonState")
      .doc("current")
      .onSnapshot(
        (doc) => {
          currentWeek = doc.exists ? doc.data().currentWeek ?? null : null;
          renderAll();
        },
        () => {}
      );
  };

  auth.onAuthStateChanged((user) => {
    currentUser = user;
    subscribe();
  });

  // If the page is left open across local midnight, re-point the today's-
  // log listener and re-render so a new day's training actually unlocks
  // without needing a manual refresh.
  let lastSeenDateKey = dateKey();
  setInterval(() => {
    const nowKey = dateKey();
    if (nowKey !== lastSeenDateKey) {
      lastSeenDateKey = nowKey;
      subscribe();
    }
  }, 30000);
})();
