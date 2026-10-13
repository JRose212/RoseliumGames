(function () {
  const config = window.siteConfig || {};
  const statusEl = document.getElementById("teams-status");
  const listEl = document.getElementById("teams-list");

  if (!listEl) return;

  const escapeHtml = (value) => {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  const spriteUrl = (pokemonId) =>
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemonId}.png`;

  const trainingBadgesHtml = (training) => {
    const t = training || {};
    const streak = t.currentStreak || 0;
    const bonus = t.bonusSessionsAvailable || 0;
    const parts = [];
    if (streak > 0) parts.push(`<span class="training-badge training-badge--streak">🔥 ${streak}-day training streak</span>`);
    if (bonus > 0) parts.push(`<span class="training-badge training-badge--bonus">+${bonus} bonus session${bonus === 1 ? "" : "s"}</span>`);
    return parts.join("");
  };

  if (!config.firebaseConfig || config.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") {
    statusEl.className = "status error";
    statusEl.textContent = "Fantasy League is not configured yet.";
    return;
  }

  firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const groups = config.positionGroups || { offense: [], defense: [], specialTeams: [] };
  const trainingTypeList = config.trainingTypes || [];

  const isAdmin = () =>
    Boolean(currentUser && config.adminUid && config.adminUid !== "YOUR_ADMIN_UID" && currentUser.uid === config.adminUid);

  let currentUser = null;
  let myTeam = null;
  let draftedMap = new Map();
  let currentWeek = null;
  let draftState = null;

  const draftIsComplete = () => Boolean(draftState && draftState.status === "complete");

  // --- Admin export: roster + training, for feeding into an external
  // results tool. Training "since last game" uses the same per-team
  // previous-matchup lookup as the Schedule/My Team pages (a game ends a
  // team's training window, not a fixed calendar week), plus a season-to-
  // date total per type for the fuller picture. ---

  let matchups = [];
  let trainingLog = [];

  const previousMatchupFor = (uid, currentMatchup) => {
    if (!currentMatchup || !currentMatchup.date) return null;
    return (
      matchups
        .filter(
          (m) => (m.homeUid === uid || m.awayUid === uid) && m.date && m.date.toMillis() < currentMatchup.date.toMillis()
        )
        .sort((a, b) => b.date.toMillis() - a.date.toMillis())[0] || null
    );
  };

  const nextMatchupFor = (uid) =>
    matchups
      .filter((m) => m.status === "scheduled" && (m.homeUid === uid || m.awayUid === uid) && m.date)
      .sort((a, b) => a.date.toMillis() - b.date.toMillis())[0] || null;

  const trainingSinceLastGame = (uid, currentMatchup) => {
    if (!currentMatchup || !currentMatchup.date) return [];
    const prev = previousMatchupFor(uid, currentMatchup);
    const startMs = prev && prev.date ? prev.date.toMillis() : null;
    const endMs = currentMatchup.date.toMillis();
    return trainingLog
      .filter((log) => log.uid === uid)
      .filter((log) => {
        const logMs = new Date(`${log.date}T12:00:00`).getTime();
        return (startMs === null || logMs > startMs) && logMs <= endMs;
      })
      .flatMap((log) => log.types || []);
  };

  const countByType = (typeKeys) => {
    const counts = new Map();
    typeKeys.forEach((key) => counts.set(key, (counts.get(key) || 0) + 1));
    return counts;
  };

  const csvField = (value) => {
    const str = String(value ?? "");
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csvRow = (values) => values.map(csvField).join(",") + "\r\n";

  const exportTeamCsv = (team) => {
    const uid = team.uid;
    const training = team.training || {};
    const seasonCounts = countByType(trainingLog.filter((log) => log.uid === uid).flatMap((log) => log.types || []));
    const upcoming = nextMatchupFor(uid);
    const sinceLastCounts = countByType(upcoming ? trainingSinceLastGame(uid, upcoming) : []);

    let csv = "";
    csv += csvRow(["Team", team.teamName || "Unnamed Team"]);
    csv += csvRow(["Training Streak (days)", training.currentStreak || 0]);
    csv += csvRow(["Bonus Sessions Banked", training.bonusSessionsAvailable || 0]);
    csv += csvRow([
      "Next Matchup",
      upcoming ? `Week ${upcoming.week} - ${upcoming.date.toDate().toLocaleDateString("en-US")}` : "None scheduled",
    ]);
    csv += "\r\n";

    csv += csvRow(["Training Since Last Game", "Count"]);
    trainingTypeList.forEach((type) => csv += csvRow([type.label, sinceLastCounts.get(type.key) || 0]));
    csv += "\r\n";

    csv += csvRow(["Training Totals (Season)", "Count"]);
    trainingTypeList.forEach((type) => csv += csvRow([type.label, seasonCounts.get(type.key) || 0]));
    csv += "\r\n";

    csv += csvRow(["Roster Position", "Pokemon ID", "Pokemon Name"]);
    (config.pokemonPositions || []).forEach((position) => {
      const pick = (team.slots || {})[position];
      csv += csvRow([position, pick ? pick.pokemonId : "", pick ? pick.pokemonName : ""]);
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const safeName = (team.teamName || "team").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    link.download = `${safeName}-roster-training.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const renderRow = (position, slots, isMine) => {
    const pick = slots[position];
    const isOut = pick && currentWeek !== null && pick.outForWeek === currentWeek;
    let middle;
    if (pick) {
      middle = `<span class="roster-row-filled">
          <img class="roster-row-sprite" src="${spriteUrl(pick.pokemonId)}" alt="${escapeHtml(pick.pokemonName)}" loading="lazy" />
          ${escapeHtml(pick.pokemonName)}
        </span>
        ${isMine ? `<button type="button" class="roster-remove-btn" data-slot="${escapeHtml(position)}" data-id="${pick.pokemonId}" data-name="${escapeHtml(pick.pokemonName)}" title="Remove from roster">✕</button>` : ""}`;
    } else if (isMine && draftIsComplete()) {
      middle = `<span class="roster-row-empty">— empty — (sign a free agent from the <a href="pokemon-dex.html">Pokédex</a>)</span>`;
    } else if (isMine) {
      middle = `<span class="roster-row-empty">— empty — (free agency opens after the draft)</span>`;
    } else {
      middle = `<span class="roster-row-empty">— empty —</span>`;
    }
    return `<li class="roster-row">
              <span class="roster-row-position">${escapeHtml(position)}</span>
              ${middle}
              ${isOut ? `<span class="out-badge">OUT — Week ${pick.outForWeek}</span>` : ""}
            </li>`;
  };

  const renderTeams = (teams) => {
    if (!teams.length) {
      listEl.innerHTML = "";
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.textContent = "No teams yet.";
      return;
    }
    statusEl.hidden = true;
    const isAdminViewer = isAdmin();
    listEl.innerHTML = teams
      .map((team) => {
        const isMine = currentUser && team.ownerUid === currentUser.uid;
        const slots = team.slots || {};
        const offenseRows = groups.offense.map((p) => renderRow(p, slots, isMine)).join("");
        const defenseRows = groups.defense.map((p) => renderRow(p, slots, isMine)).join("");
        const kickerRows = groups.specialTeams.map((p) => renderRow(p, slots, isMine)).join("");
        const benchRows = (groups.bench || []).map((p) => renderRow(p, slots, isMine)).join("");
        const exportBtn = isAdminViewer
          ? `<button type="button" class="btn btn-secondary export-team-btn" data-uid="${escapeHtml(team.uid)}">Export</button>`
          : "";
        return `<section class="card">
                  <h2>${escapeHtml(team.teamName || "Unnamed Team")}<span class="training-badges">${trainingBadgesHtml(team.training)}</span>${exportBtn}</h2>
                  <div class="roster-columns">
                    <div class="roster-column">
                      <h3 class="roster-column-heading">Offense</h3>
                      <ul class="roster-list">${offenseRows}</ul>
                    </div>
                    <div class="roster-column">
                      <h3 class="roster-column-heading">Defense</h3>
                      <ul class="roster-list">${defenseRows}</ul>
                    </div>
                  </div>
                  <div class="roster-columns" style="margin-top: 1.5rem;">
                    <div class="roster-column">
                      <h3 class="roster-column-heading">Kicker</h3>
                      <ul class="roster-list">${kickerRows}</ul>
                    </div>
                    <div class="roster-column">
                      <h3 class="roster-column-heading">Bench</h3>
                      <ul class="roster-list">${benchRows}</ul>
                    </div>
                  </div>
                </section>`;
      })
      .join("");

    if (isAdminViewer) {
      listEl.querySelectorAll(".export-team-btn").forEach((btn) => {
        const team = teams.find((t) => t.uid === btn.dataset.uid);
        if (team) btn.addEventListener("click", () => exportTeamCsv(team));
      });
    }
    listEl.querySelectorAll(".roster-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () =>
        removeFromRoster(btn.dataset.slot, Number(btn.dataset.id), btn.dataset.name)
      );
    });
  };

  async function removeFromRoster(slot, pokemonId, pokemonName) {
    if (!currentUser) return;
    const confirmed = window.confirm(`Remove ${pokemonName} from your roster and return it to the free agent pool?`);
    if (!confirmed) return;

    const teamRef = db.collection("teams").doc(currentUser.uid);
    const draftedRef = db.collection("draftedPokemon").doc(String(pokemonId));

    try {
      await db.runTransaction(async (tx) => {
        const teamSnap = await tx.get(teamRef);
        const team = teamSnap.data();
        if (!team || !team.slots || !team.slots[slot]) throw new Error("That slot is already empty.");
        tx.delete(draftedRef);
        tx.update(teamRef, { [`slots.${slot}`]: null });
      });
    } catch (error) {
      window.alert(`Unable to remove: ${error.message}`);
    }
  }

  // --- Live listeners ---

  let unsubscribeTeams = null;
  let unsubscribeDrafted = null;
  let unsubscribeSeason = null;
  let unsubscribeDraftState = null;
  let unsubscribeMatchups = null;
  let unsubscribeTrainingLog = null;
  let latestTeams = [];

  const subscribe = () => {
    [unsubscribeTeams, unsubscribeDrafted, unsubscribeSeason, unsubscribeDraftState, unsubscribeMatchups, unsubscribeTrainingLog].forEach(
      (unsubscribe) => unsubscribe && unsubscribe()
    );
    unsubscribeTeams = unsubscribeDrafted = unsubscribeSeason = unsubscribeDraftState = unsubscribeMatchups = unsubscribeTrainingLog = null;

    if (!currentUser) {
      listEl.innerHTML = "";
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.innerHTML = `Sign in on the <a href="pokemon-league.html">League Home</a> page to view rosters.`;
      return;
    }

    statusEl.hidden = false;
    statusEl.className = "status";
    statusEl.textContent = "Loading rosters…";

    unsubscribeTeams = db
      .collection("teams")
      .orderBy("createdAt")
      .onSnapshot(
        (snapshot) => {
          latestTeams = snapshot.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
          renderTeams(latestTeams);
        },
        (error) => {
          statusEl.hidden = false;
          statusEl.className = "status error";
          statusEl.textContent = `Unable to load rosters: ${error.message}`;
        }
      );

    unsubscribeDrafted = db.collection("draftedPokemon").onSnapshot(
      (snapshot) => {
        draftedMap = new Map();
        snapshot.forEach((doc) => draftedMap.set(Number(doc.id), doc.data()));
      },
      () => {}
    );

    unsubscribeSeason = db
      .collection("seasonState")
      .doc("current")
      .onSnapshot(
        (doc) => {
          currentWeek = doc.exists ? doc.data().currentWeek ?? null : null;
          renderTeams(latestTeams);
        },
        () => {}
      );

    unsubscribeDraftState = db
      .collection("draftState")
      .doc("current")
      .onSnapshot(
        (doc) => {
          draftState = doc.exists ? doc.data() : null;
          renderTeams(latestTeams);
        },
        () => {}
      );

    // Only the admin's export button needs these - skip the extra reads
    // for everyone else.
    if (isAdmin()) {
      unsubscribeMatchups = db.collection("matchups").onSnapshot((snapshot) => {
        matchups = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      }, () => {});

      unsubscribeTrainingLog = db.collection("trainingLog").onSnapshot((snapshot) => {
        trainingLog = snapshot.docs.map((doc) => doc.data());
      }, () => {});
    }
  };

  auth.onAuthStateChanged((user) => {
    currentUser = user;
    subscribe();
  });
})();
