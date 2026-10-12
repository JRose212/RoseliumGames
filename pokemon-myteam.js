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
      oppHeadingEl.textContent = "Opponent";
      oppListEl.innerHTML = "";
      return;
    }

    const opponentUid = upcoming.homeUid === currentUser.uid ? upcoming.awayUid : upcoming.homeUid;
    const opponent = teamsByUid.get(opponentUid);
    const opponentSlots = (opponent && opponent.slots) || {};

    matchupCardEl.hidden = false;
    matchupMetaEl.hidden = false;
    matchupMetaEl.textContent = `Week ${upcoming.week} — ${formatMatchupDate(upcoming.date)}`;
    oppHeadingEl.textContent = opponent ? opponent.teamName || "Unnamed Team" : "Unknown team";

    const positions = config.pokemonPositions || [];
    oppListEl.innerHTML = positions.map((position) => renderOppRow(position, opponentSlots)).join("");
  };

  const renderAll = () => {
    renderMyRoster();
    renderNextMatchup();
  };

  // --- Live listeners ---

  let unsubscribeTeams = null;
  let unsubscribeMatchups = null;
  let unsubscribeSeason = null;

  const subscribe = () => {
    [unsubscribeTeams, unsubscribeMatchups, unsubscribeSeason].forEach((unsubscribe) => unsubscribe && unsubscribe());
    unsubscribeTeams = unsubscribeMatchups = unsubscribeSeason = null;

    if (!currentUser) {
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.innerHTML = `Sign in on the <a href="pokemon-league.html">League Home</a> page to view your team.`;
      rosterCardEl.hidden = true;
      matchupCardEl.hidden = true;
      return;
    }

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
})();
