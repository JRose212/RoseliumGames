// Latest-episode card - same as League Home's, reads window.broadcasts
// (renders immediately, no Firebase dependency, works for signed-out
// visitors), then merges in admin-uploaded episodes from the `broadcasts`
// Firestore collection once available (the fallback upload path on the
// K&J Show page - signed-in only). The Firestore call is deferred a tick
// so it runs after this page's main IIFE below has already called
// firebase.initializeApp(). Past episodes live on their own page
// (pokemon-kj-show.html) now, not here.
(function () {
  const cardEl = document.getElementById("broadcasts-archive-card");
  const latestEl = document.getElementById("broadcasts-latest");
  if (!cardEl || !latestEl) return;

  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const staticBroadcasts = window.broadcasts || [];
  const typeLabels = window.broadcastTypeLabels || {};

  const render = (liveBroadcasts) => {
    const all = staticBroadcasts.concat(liveBroadcasts || []);
    if (!all.length) return;
    const latest = [...all].sort((a, b) => b.date.localeCompare(a.date))[0];
    const title = latest.title || `Week ${latest.week}: ${typeLabels[latest.type] || latest.type}`;
    latestEl.innerHTML = `<div class="broadcast-archive-item">
                <p>${escapeHtml(title)} <span class="matchup-day">${escapeHtml(latest.date)}</span></p>
                <audio controls src="${escapeHtml(latest.file)}" style="width: 100%;"></audio>
              </div>`;
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
  const statusEl = document.getElementById("schedule-status");
  const generateCardEl = document.getElementById("generate-schedule-card");
  const startDateEl = document.getElementById("season-start-date");
  const generateBtnEl = document.getElementById("generate-schedule-btn");
  const generateMessageEl = document.getElementById("generate-schedule-message");
  const standingsCardEl = document.getElementById("standings-card");
  const standingsBodyEl = document.getElementById("standings-body");
  const playoffAdminCardEl = document.getElementById("playoff-admin-card");
  const playoffAdminAreaEl = document.getElementById("playoff-admin-area");
  const bracketCardEl = document.getElementById("bracket-card");
  const bracketAreaEl = document.getElementById("bracket-area");
  const weeksEl = document.getElementById("schedule-weeks");
  const resultModalEl = document.getElementById("result-modal");
  const resultTitleEl = document.getElementById("result-modal-title");
  const resultHomeLabelEl = document.getElementById("result-home-label");
  const resultAwayLabelEl = document.getElementById("result-away-label");
  const resultHomeScoreEl = document.getElementById("result-home-score");
  const resultAwayScoreEl = document.getElementById("result-away-score");
  const resultDriveSummaryEl = document.getElementById("result-drive-summary");
  const resultShortSummaryEl = document.getElementById("result-short-summary");
  const resultMessageEl = document.getElementById("result-message");
  const resultSubmitBtnEl = document.getElementById("result-submit-btn");
  const resultCancelBtnEl = document.getElementById("result-cancel-btn");
  const resetSeasonCardEl = document.getElementById("reset-season-card");
  const resetSeasonBtnEl = document.getElementById("reset-season-btn");
  const resetSeasonMessageEl = document.getElementById("reset-season-message");
  const resetTrainingCardEl = document.getElementById("reset-training-card");
  const trainingCutoffEl = document.getElementById("training-cutoff-date");
  const resetTrainingBtnEl = document.getElementById("reset-training-btn");
  const resetTrainingMessageEl = document.getElementById("reset-training-message");
  const swapTeamsCardEl = document.getElementById("swap-teams-card");
  const swapTeamsWeekEl = document.getElementById("swap-teams-week");
  const swapTeamsAEl = document.getElementById("swap-teams-a");
  const swapTeamsBEl = document.getElementById("swap-teams-b");
  const swapTeamsBtnEl = document.getElementById("swap-teams-btn");
  const swapTeamsMessageEl = document.getElementById("swap-teams-message");
  const potwModalEl = document.getElementById("potw-modal");
  const potwModalTitleEl = document.getElementById("potw-modal-title");
  const potwSearchEl = document.getElementById("potw-search");
  const potwSuggestionsEl = document.getElementById("potw-suggestions");
  const potwSelectedEl = document.getElementById("potw-selected");
  const potwWriteupEl = document.getElementById("potw-writeup");
  const potwMessageEl = document.getElementById("potw-message");
  const potwSaveBtnEl = document.getElementById("potw-save-btn");
  const potwRemoveBtnEl = document.getElementById("potw-remove-btn");
  const potwCancelBtnEl = document.getElementById("potw-cancel-btn");

  if (!weeksEl) return;

  const escapeHtml = (value) => {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  const teamAvatarHtml = (team, sizeClass = "") => {
    const name = (team && team.teamName) || "?";
    const cls = `team-avatar${sizeClass ? ` ${sizeClass}` : ""}`;
    if (team && team.photoURL) {
      return `<img class="${cls}" src="${escapeHtml(team.photoURL)}" alt="${escapeHtml(name)}" loading="lazy" />`;
    }
    return `<span class="${cls} team-avatar-placeholder">${escapeHtml(name.charAt(0) || "?")}</span>`;
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
    statusEl.className = "status error";
    statusEl.textContent = "The Powderpuff League isn't set up yet.";
    return;
  }

  firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const regularWeeks = config.regularSeasonWeeks || 6;
  const minTeams = config.minTeamsToGenerateSchedule || 4;
  const positions = config.pokemonPositions || [];
  const positionLabels = config.positionLabels || {};
  const itemSpriteUrl = (item) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${item}.png`;
  const pokemonSpriteUrl = (pokemonId) =>
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemonId}.png`;
  const trainingTypeByKey = new Map((config.trainingTypes || []).map((t) => [t.key, t]));

  let currentUser = null;
  let teamsByUid = new Map();
  let matchups = [];
  let seasonState = null;
  let trainingLog = [];

  const isRealAdmin = () =>
    Boolean(currentUser && config.adminUid && config.adminUid !== "YOUR_ADMIN_UID" && currentUser.uid === config.adminUid);
  // Admin Mode toggle (pokemon-admin-toggle.js) - only hides admin-only UI;
  // Firestore rules still check the real uid regardless.
  const isAdmin = () => isRealAdmin() && localStorage.getItem(`adminViewMode:${currentUser.uid}`) !== "user";

  const teamName = (uid) => teamsByUid.get(uid)?.teamName || "Unknown team";

  // --- Round-robin schedule generation ---

  const roundRobinRounds = (uids) => {
    const teams = uids.slice();
    if (teams.length % 2 !== 0) teams.push(null); // bye slot for odd team counts
    const n = teams.length;
    const rounds = [];
    const arr = teams.slice();
    for (let r = 0; r < n - 1; r++) {
      const pairs = [];
      for (let i = 0; i < n / 2; i++) {
        const a = arr[i];
        const b = arr[n - 1 - i];
        if (a !== null && b !== null) pairs.push(i % 2 === 0 ? [a, b] : [b, a]);
      }
      rounds.push(pairs);
      const last = arr.pop();
      arr.splice(1, 0, last);
    }
    return rounds;
  };

  // Every game is on a Sunday, stored at the very start of that Sunday
  // (local midnight). Rosters lock for all of Sunday anyway, so training
  // logged on game day counts toward the following week's game.
  const sundayForWeek = (startDate, week) => {
    const result = new Date(startDate);
    result.setDate(result.getDate() + (week - 1) * 7);
    result.setHours(0, 0, 0, 0);
    return result;
  };

  const showGenerateMessage = (text, isError) => {
    generateMessageEl.hidden = false;
    generateMessageEl.className = `status${isError ? " error" : ""}`;
    generateMessageEl.textContent = text;
  };

  // Any already-played game locks the schedule in - regenerating would
  // wipe its recorded result. Before that point it's a safe preview.
  const hasFinalRegularGame = () => matchups.some((m) => m.round === "regular" && m.status === "final");

  const updateGenerateCardVisibility = () => {
    const locked = hasFinalRegularGame();
    generateCardEl.hidden = !(isAdmin() && !locked);
    resetSeasonCardEl.hidden = !(isAdmin() && locked);
  };

  // Deletes every matchup and the season state entirely (Player of the
  // Week picks included, since they live on the season state), so a fresh
  // schedule can be generated. Training data is untouched.
  async function resetSeason() {
    if (
      !window.confirm(
        "This permanently deletes every matchup (including recorded results), Player of the Week picks, and the season state. Continue?"
      )
    ) {
      return;
    }
    try {
      const matchupsSnapshot = await db.collection("matchups").get();
      const refs = [db.collection("seasonState").doc("current"), ...matchupsSnapshot.docs.map((doc) => doc.ref)];
      for (let i = 0; i < refs.length; i += 450) {
        const batch = db.batch();
        refs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
        await batch.commit();
      }
      resetSeasonMessageEl.hidden = false;
      resetSeasonMessageEl.className = "status";
      resetSeasonMessageEl.textContent = "Season reset - you can generate a fresh schedule now.";
    } catch (error) {
      resetSeasonMessageEl.hidden = false;
      resetSeasonMessageEl.className = "status error";
      resetSeasonMessageEl.textContent = error.message;
    }
  }

  if (resetSeasonBtnEl) resetSeasonBtnEl.addEventListener("click", resetSeason);

  // Wipes every team's training streak/banked bonus sessions and deletes
  // any trainingLog entries dated before the cutoff - e.g. clearing out
  // pre-season test activity once the real season starts.
  async function resetTraining() {
    const cutoff = trainingCutoffEl.value;
    if (!cutoff) {
      resetTrainingMessageEl.hidden = false;
      resetTrainingMessageEl.className = "status error";
      resetTrainingMessageEl.textContent = "Pick a cutoff date first.";
      return;
    }
    if (
      !window.confirm(
        `This clears every team's training streak and banked bonus sessions, and permanently deletes any training log entries before ${cutoff}. Continue?`
      )
    ) {
      return;
    }
    try {
      const [logsSnapshot, teamsSnapshot] = await Promise.all([db.collection("trainingLog").get(), db.collection("teams").get()]);
      const staleLogRefs = logsSnapshot.docs.filter((doc) => doc.data().date < cutoff).map((doc) => doc.ref);
      const ops = [
        ...staleLogRefs.map((ref) => ({ ref, type: "delete" })),
        ...teamsSnapshot.docs.map((doc) => ({
          ref: doc.ref,
          type: "update",
          data: { training: firebase.firestore.FieldValue.delete() },
        })),
      ];
      for (let i = 0; i < ops.length; i += 450) {
        const batch = db.batch();
        ops.slice(i, i + 450).forEach((op) => {
          if (op.type === "delete") batch.delete(op.ref);
          else batch.update(op.ref, op.data);
        });
        await batch.commit();
      }
      resetTrainingMessageEl.hidden = false;
      resetTrainingMessageEl.className = "status";
      resetTrainingMessageEl.textContent = `Done - cleared training for ${teamsSnapshot.docs.length} teams and removed ${staleLogRefs.length} log entries before ${cutoff}.`;
    } catch (error) {
      resetTrainingMessageEl.hidden = false;
      resetTrainingMessageEl.className = "status error";
      resetTrainingMessageEl.textContent = error.message;
    }
  }

  if (resetTrainingBtnEl) resetTrainingBtnEl.addEventListener("click", resetTraining);

  // --- Swap two teams within one week ---
  // Every matchup in the chosen week that has Team A gets Team B in that
  // same seat (home/away), and the other way around. A team on bye has no
  // matchup, so swapping it in hands the bye to the other team.

  const renderSwapTeamsOptions = () => {
    if (!swapTeamsWeekEl || !swapTeamsAEl || !swapTeamsBEl) return;
    const weeks = [...new Set(matchups.map((m) => m.week))].sort((a, b) => a - b);
    const prevWeek = swapTeamsWeekEl.value ? Number(swapTeamsWeekEl.value) : null;
    swapTeamsWeekEl.innerHTML = weeks.map((week) => `<option value="${week}">Week ${week}</option>`).join("");
    if (weeks.includes(prevWeek)) swapTeamsWeekEl.value = prevWeek;

    const teamOptions = [...teamsByUid.entries()]
      .filter(([, team]) => !team.hidden)
      .sort(([, a], [, b]) => (a.teamName || "").localeCompare(b.teamName || ""))
      .map(([uid, team]) => `<option value="${escapeHtml(uid)}">${escapeHtml(team.teamName || "Unknown team")}</option>`)
      .join("");
    const prevA = swapTeamsAEl.value;
    const prevB = swapTeamsBEl.value;
    swapTeamsAEl.innerHTML = teamOptions;
    swapTeamsBEl.innerHTML = teamOptions;
    if (teamsByUid.has(prevA)) swapTeamsAEl.value = prevA;
    if (teamsByUid.has(prevB)) swapTeamsBEl.value = prevB;
  };

  async function swapTeamsInWeek() {
    const showMessage = (text, isError) => {
      swapTeamsMessageEl.hidden = false;
      swapTeamsMessageEl.className = `status${isError ? " error" : ""}`;
      swapTeamsMessageEl.textContent = text;
    };

    const week = Number(swapTeamsWeekEl.value);
    const uidA = swapTeamsAEl.value;
    const uidB = swapTeamsBEl.value;
    if (!week || !uidA || !uidB || uidA === uidB) {
      showMessage("Pick a week and two different teams.", true);
      return;
    }

    const affected = matchups.filter(
      (m) => m.week === week && [m.homeUid, m.awayUid].some((uid) => uid === uidA || uid === uidB)
    );
    if (!affected.length) {
      showMessage(`Neither team plays in Week ${week}.`, true);
      return;
    }
    if (affected.some((m) => [m.homeUid, m.awayUid].includes(uidA) && [m.homeUid, m.awayUid].includes(uidB))) {
      showMessage(`${teamName(uidA)} and ${teamName(uidB)} play each other in Week ${week}, so there's nothing to swap.`, true);
      return;
    }
    if (affected.some((m) => m.status === "final")) {
      showMessage("One of these games is already final, so it can't be changed.", true);
      return;
    }

    const swapUid = (uid) => (uid === uidA ? uidB : uid === uidB ? uidA : uid);
    const describe = (home, away) => `${teamName(home)} @ ${teamName(away)}`;
    const changes = affected.map((m) => ({ m, homeUid: swapUid(m.homeUid), awayUid: swapUid(m.awayUid) }));
    const summary = changes
      .map(({ m, homeUid, awayUid }) => `${describe(m.homeUid, m.awayUid)}  ->  ${describe(homeUid, awayUid)}`)
      .join("\n");
    if (!window.confirm(`Week ${week} changes:\n\n${summary}\n\nSave these changes?`)) return;

    try {
      const batch = db.batch();
      changes.forEach(({ m, homeUid, awayUid }) => {
        batch.update(db.collection("matchups").doc(m.id), { homeUid, awayUid });
      });
      await batch.commit();
      showMessage(`Week ${week} updated: ${summary.replace(/\n/g, "; ")}`, false);
    } catch (error) {
      showMessage(error.message, true);
    }
  }

  if (swapTeamsBtnEl) swapTeamsBtnEl.addEventListener("click", swapTeamsInWeek);

  async function generateSchedule() {
    const dateValue = startDateEl.value;
    if (!dateValue) {
      showGenerateMessage("Pick a start date first.", true);
      return;
    }
    const startDate = new Date(`${dateValue}T12:00:00`);
    if (startDate.getDay() !== 0) {
      showGenerateMessage("That date isn't a Sunday - every game is on Sunday, so pick the first Sunday of the season.", true);
      return;
    }

    if (hasFinalRegularGame()) {
      showGenerateMessage("A result has already been recorded - the schedule can no longer be regenerated.", true);
      return;
    }

    if (seasonState && !window.confirm("A schedule already exists. Regenerating replaces every regular-season matchup. Continue?")) {
      return;
    }

    try {
      const teamsSnapshot = await db.collection("teams").orderBy("createdAt").get();
      const uids = teamsSnapshot.docs.filter((doc) => !doc.data().hidden).map((doc) => doc.id);
      if (uids.length < minTeams) throw new Error(`Need at least ${minTeams} teams to generate a schedule (${uids.length} so far).`);

      // Clear out previously-generated regular-season matchups first - a
      // different team count can mean a different number per week.
      const staleSnapshot = await db.collection("matchups").where("round", "==", "regular").get();
      const deleteBatch = db.batch();
      staleSnapshot.docs.forEach((doc) => deleteBatch.delete(doc.ref));
      if (staleSnapshot.docs.length) await deleteBatch.commit();

      const rrRounds = roundRobinRounds(uids);
      const batch = db.batch();

      for (let week = 1; week <= regularWeeks; week++) {
        const pairs = rrRounds[(week - 1) % rrRounds.length];
        pairs.forEach((pair, idx) => {
          const matchupId = `w${String(week).padStart(2, "0")}-m${idx + 1}`;
          batch.set(db.collection("matchups").doc(matchupId), {
            week,
            round: "regular",
            day: "sun",
            date: firebase.firestore.Timestamp.fromDate(sundayForWeek(startDate, week)),
            homeUid: pair[0],
            awayUid: pair[1],
            homeScore: null,
            awayScore: null,
            winnerUid: null,
            driveSummary: "",
            shortSummary: "",
            status: "scheduled",
          });
        });
      }

      batch.set(db.collection("seasonState").doc("current"), {
        phase: "regular",
        startDate: firebase.firestore.Timestamp.fromDate(startDate),
        regularWeeks,
        playoffSeeds: null,
        currentWeek: 1,
      });

      await batch.commit();
      showGenerateMessage(`Schedule generated: ${regularWeeks} weeks for ${uids.length} teams.`, false);
    } catch (error) {
      showGenerateMessage(error.message, true);
    }
  }

  generateBtnEl.addEventListener("click", generateSchedule);

  // --- Standings ---

  const computeStandings = () => {
    const stats = new Map(
      [...teamsByUid.entries()]
        .filter(([, team]) => !team.hidden)
        .map(([uid, team]) => [uid, { uid, teamName: team.teamName, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }])
    );
    matchups
      .filter((m) => m.round === "regular" && m.status === "final")
      .forEach((m) => {
        const home = stats.get(m.homeUid);
        const away = stats.get(m.awayUid);
        if (!home || !away) return;
        home.pointsFor += m.homeScore;
        home.pointsAgainst += m.awayScore;
        away.pointsFor += m.awayScore;
        away.pointsAgainst += m.homeScore;
        if (m.winnerUid === m.homeUid) {
          home.wins++;
          away.losses++;
        } else if (m.winnerUid === m.awayUid) {
          away.wins++;
          home.losses++;
        } else {
          home.ties++;
          away.ties++;
        }
      });
    return [...stats.values()].sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.pointsFor - b.pointsAgainst - (a.pointsFor - a.pointsAgainst);
    });
  };

  const renderStandings = () => {
    if (!seasonState) {
      standingsCardEl.hidden = true;
      return;
    }
    standingsCardEl.hidden = false;
    standingsBodyEl.innerHTML = computeStandings()
      .map((s, i) => {
        const diff = s.pointsFor - s.pointsAgainst;
        return `<tr class="standings-playoff-row">
          <td class="standings-seed-cell">${i + 1}</td>
          <td class="standings-team-cell">${teamAvatarHtml(teamsByUid.get(s.uid), "team-avatar--sm")} ${escapeHtml(s.teamName || "Unnamed Team")}</td>
          <td>${s.wins}</td>
          <td>${s.losses}</td>
          <td>${s.ties}</td>
          <td>${s.pointsFor}</td>
          <td>${s.pointsAgainst}</td>
          <td>${diff > 0 ? "+" : ""}${diff}</td>
        </tr>`;
      })
      .join("");
  };

  // --- Training shown under each team on the schedule ---

  // Everything a team trained strictly after its own previous game through
  // this game's stored time (start of that Sunday) - a team's first game
  // of the season has no lower bound.
  const previousMatchupFor = (uid, currentMatchup) => {
    if (!currentMatchup.date) return null;
    return (
      matchups
        .filter(
          (m) => (m.homeUid === uid || m.awayUid === uid) && m.date && m.date.toMillis() < currentMatchup.date.toMillis()
        )
        .sort((a, b) => b.date.toMillis() - a.date.toMillis())[0] || null
    );
  };

  const trainingSinceLastGame = (uid, currentMatchup) => {
    if (!currentMatchup.date) return [];
    const prev = previousMatchupFor(uid, currentMatchup);
    const startMs = prev && prev.date ? prev.date.toMillis() : null;
    const endMs = currentMatchup.date.toMillis();
    return trainingLog
      .filter((log) => log.uid === uid)
      .filter((log) => {
        const logMs = log.loggedAt ? log.loggedAt.toMillis() : new Date(`${log.date}T12:00:00`).getTime();
        return (startMs === null || logMs > startMs) && logMs <= endMs;
      })
      .sort((a, b) => a.date.localeCompare(b.date))
      .flatMap((log) => log.types || []);
  };

  const trainingSpriteRow = (uid, currentMatchup) => {
    const icons = trainingSinceLastGame(uid, currentMatchup)
      .map((key) => trainingTypeByKey.get(key))
      .filter(Boolean)
      .map(
        (type) =>
          `<img class="matchup-training-sprite" src="${itemSpriteUrl(type.item)}" alt="${escapeHtml(type.label)}" title="${escapeHtml(type.label)}" loading="lazy" />`
      )
      .join("");
    return `<span class="matchup-training-row">${icons}</span>`;
  };

  const matchupTeamBlock = (uid, currentMatchup, won) => `
    <span class="matchup-team${won ? " winner" : ""}">
      ${teamAvatarHtml(teamsByUid.get(uid), "team-avatar--sm")}
      <span class="matchup-team-name">${escapeHtml(teamName(uid))}</span>
      ${trainingSpriteRow(uid, currentMatchup)}
    </span>
  `;

  const matchupLabel = (m) => {
    const homeWon = m.status === "final" && m.winnerUid === m.homeUid;
    const awayWon = m.status === "final" && m.winnerUid === m.awayUid;
    return `${matchupTeamBlock(m.homeUid, m, homeWon)} @ ${matchupTeamBlock(m.awayUid, m, awayWon)}`;
  };

  const formatMatchupDate = (date) => {
    if (!date) return "";
    return date.toDate().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  };

  // --- Playoffs: every team gets in, seeded by the final standings. The
  // bracket is sized to the next power of 2, using the standard seed
  // layout (1v8, 4v5, 2v7, 3v6 for 8), so when the team count falls short
  // the top seeds get a first-round bye. Only real games get matchup docs
  // (round "playoff", playoffRound 1..N, bracketIndex within the round);
  // byes are worked out from the seeds. ---

  const bracketSeedOrder = (size) => {
    let order = [1];
    while (order.length < size) {
      const total = order.length * 2 + 1;
      order = order.flatMap((seed) => [seed, total - seed]);
    }
    return order;
  };

  const bracketSize = () => (seasonState && seasonState.bracketSize) || 0;
  const totalPlayoffRounds = () => Math.round(Math.log2(bracketSize() || 1));
  const playoffSeeds = () => (seasonState && seasonState.playoffSeeds) || [];

  const playoffRoundName = (round) => {
    const total = totalPlayoffRounds();
    if (round === total) return "Powderpuff Bowl";
    if (round === total - 1) return "Semifinals";
    if (round === total - 2) return "Quarterfinals";
    return `Playoff Round ${round}`;
  };

  const playoffMatchupFor = (round, index) =>
    matchups.find((m) => m.round === "playoff" && m.playoffRound === round && m.bracketIndex === index) || null;

  // Who's in each bracket position for a round: a uid, null for an empty
  // seed (a bye's missing side), or undefined when it depends on a game
  // that isn't final yet.
  const roundEntrants = (round) => {
    if (round === 1) {
      const seeds = playoffSeeds();
      return bracketSeedOrder(bracketSize()).map((seed) => seeds[seed - 1] || null);
    }
    const prev = roundEntrants(round - 1);
    const next = [];
    for (let i = 0; i < prev.length / 2; i++) {
      const a = prev[i * 2];
      const b = prev[i * 2 + 1];
      if (a === undefined || b === undefined) next.push(undefined);
      else if (!a || !b) next.push(a || b);
      else {
        const m = playoffMatchupFor(round - 1, i);
        next.push(m && m.status === "final" ? m.winnerUid : undefined);
      }
    }
    return next;
  };

  const seedOf = (uid) => playoffSeeds().indexOf(uid) + 1;

  const roundGenerated = (round) => matchups.some((m) => m.round === "playoff" && m.playoffRound === round);

  const roundComplete = (round) => {
    const entrants = roundEntrants(round);
    for (let i = 0; i < entrants.length / 2; i++) {
      const a = entrants[i * 2];
      const b = entrants[i * 2 + 1];
      if (a === undefined || b === undefined) return false;
      if (a && b) {
        const m = playoffMatchupFor(round, i);
        if (!m || m.status !== "final") return false;
      }
    }
    return true;
  };

  const regularSeasonComplete = () => {
    const regular = matchups.filter((m) => m.round === "regular");
    return regular.length > 0 && regular.every((m) => m.status === "final");
  };

  const championUid = () => {
    const total = totalPlayoffRounds();
    if (!total || !roundComplete(total)) return null;
    const m = playoffMatchupFor(total, 0);
    return m ? m.winnerUid : null;
  };

  async function generatePlayoffRound(round) {
    const startDate = seasonState.startDate.toDate();
    const batch = db.batch();
    const seasonUpdates = {};

    if (round === 1) {
      const seeds = computeStandings().map((s) => s.uid);
      let size = 2;
      while (size < seeds.length) size *= 2;
      seasonUpdates.phase = "playoffs";
      seasonUpdates.playoffSeeds = seeds;
      seasonUpdates.bracketSize = size;
      // Compute this round's pairs from the fresh seeds directly, since
      // seasonState won't have them until this batch lands.
      seasonState = { ...seasonState, playoffSeeds: seeds, bracketSize: size };
    }

    const week = regularWeeks + round;
    const entrants = roundEntrants(round);
    let games = 0;
    for (let i = 0; i < entrants.length / 2; i++) {
      const a = entrants[i * 2];
      const b = entrants[i * 2 + 1];
      if (!a || !b) continue; // a bye - the other side just advances
      const [home, away] = seedOf(a) <= seedOf(b) ? [a, b] : [b, a];
      batch.set(db.collection("matchups").doc(`w${String(week).padStart(2, "0")}-p${round}-m${i + 1}`), {
        week,
        round: "playoff",
        playoffRound: round,
        bracketIndex: i,
        day: "sun",
        date: firebase.firestore.Timestamp.fromDate(sundayForWeek(startDate, week)),
        homeUid: home,
        awayUid: away,
        homeScore: null,
        awayScore: null,
        winnerUid: null,
        driveSummary: "",
        shortSummary: "",
        status: "scheduled",
      });
      games++;
    }
    seasonUpdates.currentWeek = week;
    batch.set(db.collection("seasonState").doc("current"), seasonUpdates, { merge: true });
    try {
      await batch.commit();
      const text = `${playoffRoundName(round)} matchups are set (Week ${week}, ${games} game${games === 1 ? "" : "s"}).`;
      notifyDiscord(text);
    } catch (error) {
      playoffAdminAreaEl.innerHTML = `<p class="status error">${escapeHtml(error.message)}</p>`;
    }
  }

  const renderPlayoffAdmin = () => {
    if (!isAdmin() || !seasonState) {
      playoffAdminCardEl.hidden = true;
      return;
    }
    let html;
    const total = totalPlayoffRounds();
    const champion = championUid();
    if (champion) {
      html = `<p>🏆 The season is complete! Champion: ${escapeHtml(teamName(champion))}</p>`;
    } else if (seasonState.phase !== "playoffs") {
      html = regularSeasonComplete()
        ? `<button type="button" class="btn" id="gen-playoff-btn" data-round="1">Start the Playoffs (every team, seeded by standings)</button>`
        : `<p class="status">The playoffs can start once every regular-season game is final.</p>`;
    } else {
      const nextRound = [...Array(total).keys()].map((i) => i + 1).find((r) => !roundGenerated(r) && r > 1 && roundComplete(r - 1));
      html = nextRound
        ? `<button type="button" class="btn" id="gen-playoff-btn" data-round="${nextRound}">Generate ${escapeHtml(playoffRoundName(nextRound))}</button>`
        : `<p class="status">Nothing to advance yet - waiting on this round's results.</p>`;
    }
    playoffAdminCardEl.hidden = false;
    playoffAdminAreaEl.innerHTML = html;
    const btn = document.getElementById("gen-playoff-btn");
    if (btn) {
      btn.addEventListener("click", () => {
        btn.disabled = true;
        generatePlayoffRound(Number(btn.dataset.round));
      });
    }
  };

  const renderBracket = () => {
    const total = totalPlayoffRounds();
    if (!seasonState || seasonState.phase !== "playoffs" || !total) {
      bracketCardEl.hidden = true;
      return;
    }
    bracketCardEl.hidden = false;
    const entrantHtml = (uid) =>
      uid
        ? `${teamAvatarHtml(teamsByUid.get(uid), "team-avatar--sm")} <span class="pp-bracket-seed">${seedOf(uid)}</span> ${escapeHtml(teamName(uid))}`
        : `<span class="roster-row-empty">TBD</span>`;
    const champion = championUid();
    let html = "";
    for (let round = 1; round <= total; round++) {
      const entrants = roundEntrants(round);
      const rows = [];
      for (let i = 0; i < entrants.length / 2; i++) {
        const a = entrants[i * 2];
        const b = entrants[i * 2 + 1];
        if (a === null || b === null) {
          const through = a || b;
          rows.push(`<div class="card matchup-card pp-bracket-bye">${entrantHtml(through)} <span class="status">bye - straight to the next round</span></div>`);
          continue;
        }
        const m = playoffMatchupFor(round, i);
        if (m) {
          rows.push(`<div class="card matchup-card">
              <span class="matchup-teams">${matchupLabel(m)}</span>
              <span class="matchup-score">${m.status === "final" ? `${m.homeScore} – ${m.awayScore}` : "TBD"}</span>
            </div>`);
        } else {
          rows.push(`<div class="card matchup-card"><span>${entrantHtml(a)}</span> <span>vs</span> <span>${entrantHtml(b)}</span></div>`);
        }
      }
      html += `<div class="bracket-round">
          <h3 class="matchup-week-heading">${escapeHtml(playoffRoundName(round))} · Week ${regularWeeks + round}</h3>
          ${rows.join("")}
        </div>`;
    }
    if (champion) html += `<p class="pp-champion">🏆 Champion: ${escapeHtml(teamName(champion))}</p>`;
    bracketAreaEl.innerHTML = html;
  };

  // --- Admin export: both teams' rosters + training for one matchup, in a
  // single CSV, for feeding into an external results tool. ---

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

  const trainingTypeList = config.trainingTypes || [];

  const activeStreak = (training) => {
    const t = training || {};
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const pad = (n) => String(n).padStart(2, "0");
    const yesterdayKey = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;
    return t.lastTrainedDate && t.lastTrainedDate >= yesterdayKey ? t.currentStreak || 0 : 0;
  };

  // A final game exports the lineup it was played with (saved when the
  // result was declared); an upcoming one exports the current roster.
  const lineupFor = (matchup, side) => {
    const saved = side === "home" ? matchup.homeLineup : matchup.awayLineup;
    if (saved) return saved;
    const uid = side === "home" ? matchup.homeUid : matchup.awayUid;
    return (teamsByUid.get(uid) || {}).slots || {};
  };

  const teamCsvSection = (matchup, side, label) => {
    const uid = side === "home" ? matchup.homeUid : matchup.awayUid;
    const team = teamsByUid.get(uid) || {};
    const training = team.training || {};
    const seasonCounts = countByType(trainingLog.filter((log) => log.uid === uid).flatMap((log) => log.types || []));
    const sinceLastCounts = countByType(trainingSinceLastGame(uid, matchup));

    let csv = "";
    csv += csvRow([`${label} Team`, team.teamName || "Unnamed Team"]);
    csv += csvRow(["Training Streak (days)", activeStreak(training)]);
    csv += csvRow(["Bonus Sessions Banked", training.bonusSessionsAvailable || 0]);
    csv += "\r\n";
    csv += csvRow(["Training Since Last Game", "Count"]);
    trainingTypeList.forEach((type) => (csv += csvRow([type.label, sinceLastCounts.get(type.key) || 0])));
    csv += "\r\n";
    csv += csvRow(["Training Totals (Season)", "Count"]);
    trainingTypeList.forEach((type) => (csv += csvRow([type.label, seasonCounts.get(type.key) || 0])));
    csv += "\r\n";
    csv += csvRow(["Roster Position", "Pokemon ID", "Pokemon Name"]);
    const lineup = lineupFor(matchup, side);
    positions.forEach((position) => {
      const pick = lineup[position];
      csv += csvRow([positionLabels[position] || position, pick ? pick.pokemonId : "", pick ? pick.pokemonName : ""]);
    });
    return csv;
  };

  const exportMatchupCsv = (matchup) => {
    let csv = "";
    csv += csvRow(["Matchup", `Week ${matchup.week} - ${formatMatchupDate(matchup.date)}`]);
    csv += csvRow(["Home Team", teamName(matchup.homeUid)]);
    csv += csvRow(["Away Team", teamName(matchup.awayUid)]);
    csv += csvRow(["Scoring", `Touchdown = ${config.touchdownPoints || 7} points, no kicks or safeties`]);
    csv += "\r\n";
    csv += teamCsvSection(matchup, "home", "Home");
    csv += "\r\n";
    csv += teamCsvSection(matchup, "away", "Away");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const safeName = `week${matchup.week}-${teamName(matchup.homeUid)}-vs-${teamName(matchup.awayUid)}`
      .replace(/[^a-z0-9]+/gi, "-")
      .toLowerCase();
    link.download = `${safeName}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  // --- Player of the Week ---
  // One pick per week, stored on seasonState/current as
  // playerOfTheWeek.{week} (admin-write, everyone-read). The admin picks
  // from the Pokemon that played that week: each game's saved lineups, or
  // the teams' current rosters for a game without a result yet. This
  // league has no box scores, so it's the sprite, the team, and the
  // admin's write-up.

  const playerOfTheWeekFor = (week) => (seasonState && seasonState.playerOfTheWeek && seasonState.playerOfTheWeek[week]) || null;

  // One entry per team per Pokemon - a team that plays the same Pokemon
  // in several spots lists it once, with every spot it played.
  const potwCandidates = (week) => {
    const byKey = new Map();
    matchups
      .filter((m) => m.week === week)
      .forEach((m) => {
        ["home", "away"].forEach((side) => {
          const uid = side === "home" ? m.homeUid : m.awayUid;
          const lineup = lineupFor(m, side);
          positions.forEach((slot) => {
            const pick = lineup[slot];
            if (!pick) return;
            const key = `${uid}|${pick.pokemonId}`;
            if (!byKey.has(key)) byKey.set(key, { uid, pokemonId: pick.pokemonId, pokemonName: pick.pokemonName, slots: [] });
            byKey.get(key).slots.push(slot);
          });
        });
      });
    return [...byKey.values()].sort((a, b) => a.pokemonName.localeCompare(b.pokemonName));
  };

  const potwSpriteHtml = (potw, cls) =>
    potw.pokemonId
      ? `<img class="${cls}" src="${pokemonSpriteUrl(potw.pokemonId)}" alt="${escapeHtml(potw.pokemonName)}" loading="lazy" />`
      : `<span class="${cls} potw-sprite-placeholder">?</span>`;

  const potwMetaText = (potw) => `${(potw.slots || []).join(", ")}${potw.slots && potw.slots.length ? " · " : ""}${teamName(potw.uid)}`;

  // Shown inside the week's header row, so it's visible while collapsed.
  const potwCollapsedHtml = (potw) => `
    <span class="potw-collapsed">
      ${potwSpriteHtml(potw, "potw-sprite")}
      <span class="potw-text">
        <span class="potw-label">✨ Player of the Week</span>
        <span class="potw-name">${escapeHtml(potw.pokemonName)}</span>
        <span class="potw-stats">${escapeHtml(potwMetaText(potw))}</span>
      </span>
    </span>`;

  // Shown at the top of the expanded week, with the write-up.
  const potwExpandedHtml = (potw) => `
    <div class="card potw-card">
      ${potwSpriteHtml(potw, "potw-sprite potw-sprite--lg")}
      <div class="potw-text">
        <span class="potw-label">✨ Player of the Week</span>
        <span class="potw-name">${escapeHtml(potw.pokemonName)}</span>
        <span class="potw-stats">${escapeHtml(potwMetaText(potw))}</span>
        ${potw.writeUp ? `<p class="potw-writeup">${escapeHtml(potw.writeUp).replace(/\n/g, "<br>")}</p>` : ""}
      </div>
    </div>`;

  let potwWeek = null;
  let potwSelection = null;

  const showPotwMessage = (text, isError) => {
    potwMessageEl.hidden = false;
    potwMessageEl.className = `status${isError ? " error" : ""}`;
    potwMessageEl.textContent = text;
  };

  const candidateLabel = (c) => `${c.pokemonName} (${c.slots.join(", ")}, ${teamName(c.uid)})`;
  const normalizeName = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

  const setPotwSelection = (candidate) => {
    potwSelection = candidate;
    potwSaveBtnEl.disabled = !candidate;
    potwSelectedEl.hidden = !candidate;
    potwSelectedEl.className = "status";
    potwSelectedEl.textContent = candidate ? `Selected: ${candidateLabel(candidate)}` : "";
  };

  const renderPotwSuggestions = () => {
    const candidates = potwCandidates(potwWeek);
    const term = normalizeName(potwSearchEl.value);
    if (!candidates.length) {
      potwSuggestionsEl.innerHTML = `<p class="status error">No Pokémon are on Week ${potwWeek}'s lineups yet.</p>`;
      return;
    }
    // Typing changes the pick - it's only valid again once one is chosen,
    // or the text exactly matches exactly one Pokemon from this week.
    const exact = candidates.filter((c) => normalizeName(c.pokemonName) === term);
    if (!potwSelection || normalizeName(potwSelection.pokemonName) !== term) {
      setPotwSelection(exact.length === 1 ? exact[0] : null);
    }
    if (!term) {
      potwSuggestionsEl.innerHTML = "";
      return;
    }
    const matches = candidates.filter((c) => normalizeName(c.pokemonName).includes(term)).slice(0, 12);
    if (!matches.length) {
      potwSuggestionsEl.innerHTML = `<p class="status error">No Pokémon named "${escapeHtml(potwSearchEl.value)}" played in Week ${potwWeek}.</p>`;
      return;
    }
    potwSuggestionsEl.innerHTML = matches
      .map(
        (c, i) =>
          `<button type="button" class="potw-suggestion" data-index="${i}"><img src="${pokemonSpriteUrl(c.pokemonId)}" alt="" loading="lazy" />${escapeHtml(candidateLabel(c))}</button>`
      )
      .join("");
    potwSuggestionsEl.querySelectorAll(".potw-suggestion").forEach((btn) => {
      btn.addEventListener("click", () => {
        const candidate = matches[Number(btn.dataset.index)];
        potwSearchEl.value = candidate.pokemonName;
        setPotwSelection(candidate);
        potwSuggestionsEl.innerHTML = "";
      });
    });
  };

  const openPotwModal = (week) => {
    potwWeek = week;
    const existing = playerOfTheWeekFor(week);
    potwModalTitleEl.textContent = `Week ${week}`;
    potwMessageEl.hidden = true;
    potwSearchEl.value = existing ? existing.pokemonName : "";
    potwWriteupEl.value = existing ? existing.writeUp || "" : "";
    potwRemoveBtnEl.hidden = !existing;
    const current = existing
      ? potwCandidates(week).find((c) => c.uid === existing.uid && c.pokemonId === existing.pokemonId) || null
      : null;
    setPotwSelection(current);
    potwSuggestionsEl.innerHTML = "";
    if (!potwCandidates(week).length) renderPotwSuggestions();
    potwModalEl.hidden = false;
    potwSearchEl.focus();
  };

  const closePotwModal = () => {
    potwModalEl.hidden = true;
    potwWeek = null;
    setPotwSelection(null);
  };

  function savePlayerOfTheWeek() {
    if (!potwSelection || potwWeek === null) {
      showPotwMessage("Pick a Pokémon from the list first.", true);
      return;
    }
    const writeUp = potwWriteupEl.value.trim();
    if (!writeUp) {
      showPotwMessage("Add a write-up.", true);
      return;
    }
    const week = potwWeek;
    const selection = potwSelection;
    const write = db
      .collection("seasonState")
      .doc("current")
      .set(
        {
          playerOfTheWeek: {
            [week]: {
              pokemonName: selection.pokemonName,
              pokemonId: selection.pokemonId,
              uid: selection.uid,
              slots: selection.slots,
              writeUp,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            },
          },
        },
        { merge: true }
      );
    // Firestore shows the change on the page straight away; its promise
    // only resolves once the server confirms, which can lag. Close now and
    // only speak up if it fails.
    closePotwModal();
    write.catch((error) => {
      window.alert(`Couldn't save the Week ${week} Player of the Week: ${error.message}`);
    });
  }

  function removePlayerOfTheWeek() {
    if (potwWeek === null) return;
    if (!window.confirm(`Remove the Week ${potwWeek} Player of the Week?`)) return;
    const week = potwWeek;
    const write = db
      .collection("seasonState")
      .doc("current")
      .update({ [`playerOfTheWeek.${week}`]: firebase.firestore.FieldValue.delete() });
    closePotwModal();
    write.catch((error) => {
      window.alert(`Couldn't remove the Week ${week} Player of the Week: ${error.message}`);
    });
  }

  if (potwModalEl) {
    let potwSearchTimeout = null;
    potwSearchEl.addEventListener("input", () => {
      clearTimeout(potwSearchTimeout);
      potwSearchTimeout = setTimeout(renderPotwSuggestions, 120);
    });
    // Enter in the search box would otherwise submit the form and reload.
    document.getElementById("potw-form").addEventListener("submit", (event) => event.preventDefault());
    potwSaveBtnEl.addEventListener("click", savePlayerOfTheWeek);
    potwRemoveBtnEl.addEventListener("click", removePlayerOfTheWeek);
    potwCancelBtnEl.addEventListener("click", closePotwModal);
    document.getElementById("potw-close-btn").addEventListener("click", closePotwModal);
    potwModalEl.addEventListener("click", (event) => {
      if (event.target === potwModalEl) closePotwModal();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !potwModalEl.hidden) closePotwModal();
    });
  }

  // --- Weekly schedule rendering ---

  // Which weeks the viewer has opened or closed, so a live update doesn't
  // snap every week back to the default.
  const weekOpenOverrides = new Map();

  // The week that starts expanded: the earliest week with a game not yet
  // final, or the last week once everything's been played.
  const currentWeekForDisplay = () => {
    const unplayed = matchups.filter((m) => m.status !== "final");
    if (unplayed.length) return Math.min(...unplayed.map((m) => m.week));
    const allWeeks = matchups.map((m) => m.week);
    return allWeeks.length ? Math.max(...allWeeks) : null;
  };

  const renderWeeks = () => {
    if (!matchups.length) {
      weeksEl.innerHTML = "";
      return;
    }
    const byWeek = new Map();
    matchups.forEach((m) => {
      if (!byWeek.has(m.week)) byWeek.set(m.week, []);
      byWeek.get(m.week).push(m);
    });
    const weeks = [...byWeek.keys()].sort((a, b) => a - b);
    const currentWeek = currentWeekForDisplay();

    weeksEl.innerHTML = weeks
      .map((week) => {
        const weekMatchups = byWeek.get(week).slice().sort((a, b) => a.id.localeCompare(b.id));
        const first = weekMatchups[0];
        const heading = first.round === "regular" ? `Week ${week}` : `${playoffRoundName(first.playoffRound)} (Week ${week})`;
        const cards = weekMatchups
          .map((m) => {
            const scoreText = m.status === "final" ? `${m.homeScore} – ${m.awayScore}` : "";
            const declareBtn = isAdmin()
              ? `<button type="button" class="btn btn-secondary result-open-btn" data-id="${m.id}">${m.status === "final" ? "Edit Result" : "Declare Result"}</button>`
              : "";
            const exportBtn = isAdmin()
              ? `<button type="button" class="btn btn-secondary export-matchup-btn" data-id="${m.id}">Export</button>`
              : "";
            const summaryLine =
              m.status === "final" && m.shortSummary ? `<p class="matchup-summary">${escapeHtml(m.shortSummary)}</p>` : "";
            const driveSummaryHtml =
              m.status === "final" && m.driveSummary
                ? `
                <details class="roster-set matchup-expand">
                  <summary class="roster-set-title">Game Summary</summary>
                  <div class="roster-set-group"><p>${escapeHtml(m.driveSummary).replace(/\n/g, "<br>")}</p></div>
                </details>
              `
                : "";
            return `<div class="card matchup-card">
                      <span class="matchup-day">${formatMatchupDate(m.date)}</span>
                      <span class="matchup-teams">${matchupLabel(m)}</span>
                      <span class="matchup-score">${scoreText}</span>
                      ${declareBtn}
                      ${exportBtn}
                      ${summaryLine}
                      ${driveSummaryHtml}
                    </div>`;
          })
          .join("");
        const gameCount = weekMatchups.length;
        const potw = playerOfTheWeekFor(week);
        const potwBtn = isAdmin()
          ? `<button type="button" class="btn btn-secondary potw-open-btn" data-week="${week}">${potw ? "Edit" : "Upload"} Player of the Week</button>`
          : "";
        const isOpen = weekOpenOverrides.has(week) ? weekOpenOverrides.get(week) : week === currentWeek;
        return `
          <details class="roster-set week-collapse" data-week="${week}"${isOpen ? " open" : ""}>
            <summary class="roster-set-title">${escapeHtml(heading)}<span class="roster-set-count">${gameCount} game${gameCount === 1 ? "" : "s"}</span>${potwBtn}${potw ? potwCollapsedHtml(potw) : ""}</summary>
            <div class="roster-set-group">${potw ? potwExpandedHtml(potw) : ""}${cards}</div>
          </details>
        `;
      })
      .join("");

    weeksEl.querySelectorAll(".week-collapse").forEach((detailsEl) => {
      detailsEl.addEventListener("toggle", () => {
        weekOpenOverrides.set(Number(detailsEl.dataset.week), detailsEl.open);
      });
    });
    weeksEl.querySelectorAll(".potw-open-btn").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        // The button lives inside the week's <summary> - don't let the
        // click also expand/collapse the week.
        event.preventDefault();
        event.stopPropagation();
        openPotwModal(Number(btn.dataset.week));
      });
    });
    weeksEl.querySelectorAll(".result-open-btn").forEach((btn) => {
      btn.addEventListener("click", () => openResultModal(btn.dataset.id));
    });
    weeksEl.querySelectorAll(".export-matchup-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const matchup = matchups.find((m) => m.id === btn.dataset.id);
        if (matchup) exportMatchupCsv(matchup);
      });
    });
  };

  // --- Declare result modal ---

  let pendingMatchupId = null;

  const showResultMessage = (text, isError) => {
    resultMessageEl.hidden = false;
    resultMessageEl.className = `status${isError ? " error" : ""}`;
    resultMessageEl.textContent = text;
  };

  const openResultModal = (matchupId) => {
    const matchup = matchups.find((m) => m.id === matchupId);
    if (!matchup) return;
    pendingMatchupId = matchupId;
    resultTitleEl.textContent = `${teamName(matchup.homeUid)} @ ${teamName(matchup.awayUid)}`;
    resultHomeLabelEl.textContent = `${teamName(matchup.homeUid)} score`;
    resultAwayLabelEl.textContent = `${teamName(matchup.awayUid)} score`;
    resultHomeScoreEl.value = matchup.homeScore ?? "";
    resultAwayScoreEl.value = matchup.awayScore ?? "";
    resultDriveSummaryEl.value = matchup.driveSummary || "";
    resultShortSummaryEl.value = matchup.shortSummary || "";
    resultMessageEl.hidden = true;
    resultModalEl.hidden = false;
  };

  const closeResultModal = () => {
    resultModalEl.hidden = true;
    pendingMatchupId = null;
  };

  resultCancelBtnEl.addEventListener("click", closeResultModal);

  async function submitResult() {
    if (!pendingMatchupId) return;
    const matchup = matchups.find((m) => m.id === pendingMatchupId);
    if (!matchup) return;

    if (resultHomeScoreEl.value === "" || resultAwayScoreEl.value === "") {
      showResultMessage("Enter both scores.", true);
      return;
    }
    const homeScore = Number(resultHomeScoreEl.value);
    const awayScore = Number(resultAwayScoreEl.value);
    if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) {
      showResultMessage("Enter both scores.", true);
      return;
    }
    // A playoff tie would leave the next round with no team to advance.
    if (matchup.round !== "regular" && homeScore === awayScore) {
      showResultMessage("Playoff games can't end in a tie - enter the final score after overtime.", true);
      return;
    }
    const winnerUid = homeScore === awayScore ? null : homeScore > awayScore ? matchup.homeUid : matchup.awayUid;

    const isFirstDeclaration = matchup.status !== "final";
    const scoreChanged = homeScore !== matchup.homeScore || awayScore !== matchup.awayScore;
    const previousWinnerUid = matchup.winnerUid || null;
    const winnerChanged = winnerUid !== previousWinnerUid;

    // Firestore batches reject more than one write to the same document,
    // so each team's changes land in a single merged update().
    const teamUpdates = new Map();
    const mergeTeamUpdate = (uid, fields) => {
      teamUpdates.set(uid, Object.assign(teamUpdates.get(uid) || {}, fields));
    };

    // A losing team banks a bonus training session; a winning team's banked
    // sessions reset to zero. Whenever a game's winner changes, the old
    // outcome is undone first - the sessions a winner lost are kept on the
    // matchup so the undo can restore them.
    const matchupFields = {};
    if (winnerChanged) {
      const opponentOf = (uid) => (uid === matchup.homeUid ? matchup.awayUid : matchup.homeUid);
      const bonus = new Map(
        [matchup.homeUid, matchup.awayUid].map((uid) => [uid, teamsByUid.get(uid)?.training?.bonusSessionsAvailable || 0])
      );
      if (previousWinnerUid) {
        const previousLoserUid = opponentOf(previousWinnerUid);
        bonus.set(previousWinnerUid, bonus.get(previousWinnerUid) + (matchup.bonusClearedFromWinner || 0));
        bonus.set(previousLoserUid, Math.max(0, bonus.get(previousLoserUid) - 1));
      }
      matchupFields.bonusClearedFromWinner = 0;
      if (winnerUid) {
        const loserUid = opponentOf(winnerUid);
        matchupFields.bonusClearedFromWinner = bonus.get(winnerUid);
        bonus.set(winnerUid, 0);
        bonus.set(loserUid, bonus.get(loserUid) + 1);
      }
      bonus.forEach((sessions, uid) => mergeTeamUpdate(uid, { "training.bonusSessionsAvailable": sessions }));
    }

    // Rosters change week to week here, so the first time a result is
    // posted, both teams' lineups are saved onto the game - that's what
    // Player of the Week and the export use for this game from then on.
    if (!matchup.homeLineup) matchupFields.homeLineup = (teamsByUid.get(matchup.homeUid) || {}).slots || {};
    if (!matchup.awayLineup) matchupFields.awayLineup = (teamsByUid.get(matchup.awayUid) || {}).slots || {};

    const resultText = winnerUid
      ? `${teamName(winnerUid)} defeated ${teamName(winnerUid === matchup.homeUid ? matchup.awayUid : matchup.homeUid)} ${Math.max(homeScore, awayScore)}-${Math.min(homeScore, awayScore)} (Week ${matchup.week})`
      : `${teamName(matchup.homeUid)} and ${teamName(matchup.awayUid)} tied ${homeScore}-${awayScore} (Week ${matchup.week})`;
    // Editing only the summaries of a final game stays quiet.
    const announceText = isFirstDeclaration ? resultText : scoreChanged ? `Score updated: ${resultText}` : null;

    try {
      const batch = db.batch();
      batch.update(db.collection("matchups").doc(pendingMatchupId), {
        homeScore,
        awayScore,
        winnerUid,
        driveSummary: resultDriveSummaryEl.value.trim(),
        shortSummary: resultShortSummaryEl.value.trim(),
        status: "final",
        ...matchupFields,
      });
      teamUpdates.forEach((fields, uid) => {
        batch.update(db.collection("teams").doc(uid), fields);
      });
      if (announceText) {
        batch.set(db.collection("chatMessages").doc(), {
          uid: auth.currentUser.uid,
          system: true,
          text: announceText,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      if (announceText) notifyDiscord(announceText);
      closeResultModal();
    } catch (error) {
      showResultMessage(error.message, true);
    }
  }

  resultSubmitBtnEl.addEventListener("click", submitResult);

  // --- Live listeners ---

  let unsubscribers = [];

  const renderAll = () => {
    renderStandings();
    renderWeeks();
    renderPlayoffAdmin();
    renderBracket();
    if (isAdmin()) renderSwapTeamsOptions();
  };

  const subscribe = () => {
    unsubscribers.forEach((u) => u());
    unsubscribers = [];

    if (!currentUser) {
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.innerHTML = `Sign in on the <a href="pokemon-league.html">League Home</a> page to view the schedule.`;
      generateCardEl.hidden = true;
      resetSeasonCardEl.hidden = true;
      resetTrainingCardEl.hidden = true;
      swapTeamsCardEl.hidden = true;
      standingsCardEl.hidden = true;
      playoffAdminCardEl.hidden = true;
      bracketCardEl.hidden = true;
      weeksEl.innerHTML = "";
      return;
    }

    statusEl.hidden = true;
    resetTrainingCardEl.hidden = !isAdmin();
    swapTeamsCardEl.hidden = !isAdmin();
    if (isAdmin() && trainingCutoffEl && !trainingCutoffEl.value) {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      trainingCutoffEl.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }

    unsubscribers.push(
      db.collection("teams").onSnapshot((snapshot) => {
        teamsByUid = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
        renderAll();
      }, () => {})
    );

    unsubscribers.push(
      db.collection("trainingLog").onSnapshot((snapshot) => {
        trainingLog = snapshot.docs.map((doc) => doc.data());
        renderAll();
      }, () => {})
    );

    unsubscribers.push(
      db.collection("matchups").onSnapshot((snapshot) => {
        matchups = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        updateGenerateCardVisibility();
        renderAll();
      }, () => {})
    );

    unsubscribers.push(
      db
        .collection("seasonState")
        .doc("current")
        .onSnapshot((doc) => {
          seasonState = doc.exists ? doc.data() : null;
          updateGenerateCardVisibility();
          if (generateBtnEl) generateBtnEl.textContent = seasonState ? "Regenerate Schedule" : "Generate Schedule";
          renderAll();
        }, () => {})
    );
  };

  auth.onAuthStateChanged((user) => {
    currentUser = user;
    subscribe();
  });
})();
