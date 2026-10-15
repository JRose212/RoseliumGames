// Broadcasts archive - standalone, same as League Home's latest-episode
// card: reads window.broadcasts directly, no Firebase/auth dependency, so
// it shows for signed-out visitors too.
(function () {
  const cardEl = document.getElementById("broadcasts-archive-card");
  const latestEl = document.getElementById("broadcasts-latest");
  const archiveHeadingEl = document.getElementById("broadcasts-archive-heading");
  const listEl = document.getElementById("broadcasts-archive-list");
  if (!cardEl || !latestEl || !listEl) return;

  const broadcasts = window.broadcasts || [];
  if (!broadcasts.length) return;

  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const typeLabels = window.broadcastTypeLabels || {};
  const sorted = [...broadcasts].sort((a, b) => b.date.localeCompare(a.date));
  const episodeHtml = (b) => {
    const title = b.title || `Week ${b.week}: ${typeLabels[b.type] || b.type}`;
    return `<div class="broadcast-archive-item">
              <p>${escapeHtml(title)} <span class="matchup-day">${escapeHtml(b.date)}</span></p>
              <audio controls src="${escapeHtml(b.file)}" style="width: 100%;"></audio>
            </div>`;
  };

  const [latest, ...rest] = sorted;
  latestEl.innerHTML = episodeHtml(latest);
  if (rest.length) {
    archiveHeadingEl.hidden = false;
    listEl.innerHTML = rest.map(episodeHtml).join("");
  }
  cardEl.hidden = false;
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
  const resultInjuryAreaEl = document.getElementById("result-injury-area");
  const boxScoreInputEl = document.getElementById("box-score-input");
  const boxScoreMessageEl = document.getElementById("box-score-message");
  const boxScoreSaveBtnEl = document.getElementById("box-score-save-btn");
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

  if (!weeksEl) return;

  const escapeHtml = (value) => {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  // Best-effort only - never block the real action on this.
  const notifyDiscord = (text) => {
    if (!config.discordWebhookUrl) return;
    fetch(config.discordWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    }).catch(() => {});
  };

  if (!config.firebaseConfig || config.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") {
    statusEl.className = "status error";
    statusEl.textContent = "Fantasy League is not configured yet.";
    return;
  }

  firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const regularWeeks = config.regularSeasonWeeks || 13;
  const itemSpriteUrl = (item) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${item}.png`;
  const trainingTypeByKey = new Map((config.trainingTypes || []).map((t) => [t.key, t]));

  let currentUser = null;
  let teamsByUid = new Map();
  let matchups = [];
  let seasonState = null;
  let trainingLog = [];

  const isAdmin = () =>
    Boolean(currentUser && config.adminUid && config.adminUid !== "YOUR_ADMIN_UID" && currentUser.uid === config.adminUid);

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
        if (a !== null && b !== null) pairs.push([a, b]);
      }
      rounds.push(pairs);
      const last = arr.pop();
      arr.splice(1, 0, last);
    }
    return rounds;
  };

  const assignDays = (pairs, weekIndex) => {
    if (!pairs.length) return [];
    const offset = weekIndex % pairs.length;
    const ordered = pairs.slice(offset).concat(pairs.slice(0, offset));
    return ordered.map((pair, i) => ({
      pair,
      day: ordered.length > 1 && i === 0 ? "thu" : ordered.length > 1 && i === 1 ? "mon" : "sun",
    }));
  };

  const dateForDay = (startDate, week, day) => {
    const dayOffset = { thu: 0, sun: 3, mon: 4 };
    const result = new Date(startDate);
    result.setDate(result.getDate() + (week - 1) * 7 + dayOffset[day]);
    return result;
  };

  const showGenerateMessage = (text, isError) => {
    generateMessageEl.hidden = false;
    generateMessageEl.className = `status${isError ? " error" : ""}`;
    generateMessageEl.textContent = text;
  };

  // Any already-played game locks the schedule in - regenerating would
  // silently wipe its recorded result back to blank, and reshuffle every
  // other week's pairings since the round-robin depends on the full team
  // list. Before that point, it's just a preview and safe to re-run as
  // more teams join.
  const hasFinalRegularGame = () => matchups.some((m) => m.round === "regular" && m.status === "final");

  const updateGenerateCardVisibility = () => {
    const locked = hasFinalRegularGame();
    generateCardEl.hidden = !(isAdmin() && !locked);
    resetSeasonCardEl.hidden = !(isAdmin() && locked);
  };

  // Deletes every matchup and the season state doc entirely, so
  // generateSchedule() can run fresh afterward - the only way back once a
  // result has gone final and locked normal regeneration. Does not touch
  // training/trainingLog data; that's a separate system.
  async function resetSeason() {
    if (
      !window.confirm(
        "This permanently deletes every matchup (including recorded results) and the season state. Continue?"
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
  // any trainingLog entries dated before the cutoff - separate from
  // resetSeason() above, since training can need a reset (e.g. clearing
  // out pre-season test activity once the real season goes live) without
  // touching the schedule at all. Logs on/after the cutoff are left alone:
  // trainingSinceLastGame() has no previous matchup to anchor to before a
  // team's first game, so any stale pre-cutoff log would otherwise show up
  // as training for that first matchup.
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
      const [logsSnapshot, teamsSnapshot] = await Promise.all([
        db.collection("trainingLog").get(),
        db.collection("teams").get(),
      ]);
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

  async function generateSchedule() {
    const dateValue = startDateEl.value;
    if (!dateValue) {
      showGenerateMessage("Pick a start date first.", true);
      return;
    }
    const startDate = new Date(`${dateValue}T12:00:00`);
    if (startDate.getDay() !== 4) {
      showGenerateMessage("That date isn't a Thursday — pick the actual Thursday the season starts.", true);
      return;
    }

    if (hasFinalRegularGame()) {
      showGenerateMessage("A result has already been recorded - the schedule can no longer be regenerated.", true);
      return;
    }

    if (
      seasonState &&
      !window.confirm("A schedule already exists. Regenerating replaces every regular-season matchup. Continue?")
    ) {
      return;
    }

    try {
      const teamsSnapshot = await db.collection("teams").orderBy("createdAt").get();
      const uids = teamsSnapshot.docs.filter((doc) => !doc.data().hidden).map((doc) => doc.id);
      if (uids.length < 2) throw new Error("Need at least 2 teams to generate a schedule.");

      // Clear out any previously-generated regular-season matchups first -
      // a different team count can produce a different number of
      // matchups per week, which would otherwise leave stale leftover docs.
      const staleSnapshot = await db.collection("matchups").where("round", "==", "regular").get();
      const deleteBatch = db.batch();
      staleSnapshot.docs.forEach((doc) => deleteBatch.delete(doc.ref));
      if (staleSnapshot.docs.length) await deleteBatch.commit();

      const rrRounds = roundRobinRounds(uids);
      const batch = db.batch();

      for (let week = 1; week <= regularWeeks; week++) {
        const pairs = rrRounds[(week - 1) % rrRounds.length];
        const assigned = assignDays(pairs, week - 1);
        assigned.forEach(({ pair, day }, idx) => {
          const date = dateForDay(startDate, week, day);
          const matchupId = `w${String(week).padStart(2, "0")}-m${idx + 1}`;
          batch.set(db.collection("matchups").doc(matchupId), {
            week,
            round: "regular",
            day,
            date: firebase.firestore.Timestamp.fromDate(date),
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
        .map(([uid, team]) => [
          uid,
          { uid, teamName: team.teamName, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 },
        ])
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
        }
      });
    return [...stats.values()].sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst);
    });
  };

  const renderStandings = () => {
    if (!seasonState) {
      standingsCardEl.hidden = true;
      return;
    }
    standingsCardEl.hidden = false;
    const standings = computeStandings();
    standingsBodyEl.innerHTML = standings
      .map((s) => {
        const diff = s.pointsFor - s.pointsAgainst;
        return `<tr>
          <td>${escapeHtml(s.teamName || "Unnamed Team")}</td>
          <td>${s.wins}</td>
          <td>${s.losses}</td>
          <td>${s.pointsFor}</td>
          <td>${s.pointsAgainst}</td>
          <td>${diff > 0 ? "+" : ""}${diff}</td>
        </tr>`;
      })
      .join("");
  };

  // --- Weekly schedule rendering ---

  // A team's "week" of training isn't a fixed calendar block - a game
  // ends it. Since teams rotate through Thu/Sun/Mon, the gap between a
  // team's own two consecutive games varies (e.g. Thursday one week,
  // Sunday the next), so this looks up that team's actual previous game
  // relative to the matchup being rendered, not a season-week number.
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

  // Everything a team trained strictly after their own previous game
  // through (and including) this matchup's date - a team's very first
  // game of the season has no lower bound. Shown as small item sprites
  // under that team's name, one icon per session, in the order trained.
  const trainingSinceLastGame = (uid, currentMatchup) => {
    if (!currentMatchup.date) return [];
    const prev = previousMatchupFor(uid, currentMatchup);
    const startMs = prev && prev.date ? prev.date.toMillis() : null;
    const endMs = currentMatchup.date.toMillis();
    return trainingLog
      .filter((log) => log.uid === uid)
      .filter((log) => {
        const logMs = new Date(`${log.date}T12:00:00`).getTime();
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
      <span class="matchup-team-name">${escapeHtml(teamName(uid))}</span>
      ${trainingSpriteRow(uid, currentMatchup)}
    </span>
  `;

  const matchupLabel = (m) => {
    const homeWon = m.status === "final" && m.winnerUid === m.homeUid;
    const awayWon = m.status === "final" && m.winnerUid === m.awayUid;
    return `${matchupTeamBlock(m.homeUid, m, homeWon)} @ ${matchupTeamBlock(m.awayUid, m, awayWon)}`;
  };

  const roundLabel = (round) =>
    ({ regular: "Regular Season", quarterfinal: "Quarterfinal", semifinal: "Semifinal", pokebowl: "PokéBowl" }[round] || round);

  // Thursday Night Football, then the Sunday slate, then Monday Night
  // Football last - the order NFL weeks actually play in, not the order
  // matchup docs happened to be created in.
  const dayOrder = { thu: 0, sun: 1, mon: 2 };
  const dayLabel = { thu: "Thursday", sun: "Sunday", mon: "Monday" };

  const formatMatchupDate = (date) => {
    if (!date) return "";
    return date.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

  const teamCsvSection = (uid, label, currentMatchup) => {
    const team = teamsByUid.get(uid) || {};
    const training = team.training || {};
    const seasonCounts = countByType(trainingLog.filter((log) => log.uid === uid).flatMap((log) => log.types || []));
    const sinceLastCounts = countByType(trainingSinceLastGame(uid, currentMatchup));

    let csv = "";
    csv += csvRow([`${label} Team`, team.teamName || "Unnamed Team"]);
    csv += csvRow(["Training Streak (days)", training.currentStreak || 0]);
    csv += csvRow(["Bonus Sessions Banked", training.bonusSessionsAvailable || 0]);
    csv += "\r\n";

    csv += csvRow(["Training Since Last Game", "Count"]);
    trainingTypeList.forEach((type) => (csv += csvRow([type.label, sinceLastCounts.get(type.key) || 0])));
    csv += "\r\n";

    csv += csvRow(["Training Totals (Season)", "Count"]);
    trainingTypeList.forEach((type) => (csv += csvRow([type.label, seasonCounts.get(type.key) || 0])));
    csv += "\r\n";

    csv += csvRow(["Roster Position", "Pokemon ID", "Pokemon Name"]);
    (config.pokemonPositions || []).forEach((position) => {
      const pick = (team.slots || {})[position];
      csv += csvRow([position, pick ? pick.pokemonId : "", pick ? pick.pokemonName : ""]);
    });
    return csv;
  };

  const exportMatchupCsv = (matchup) => {
    let csv = "";
    csv += csvRow(["Matchup", `Week ${matchup.week} - ${dayLabel[matchup.day] || matchup.day}, ${formatMatchupDate(matchup.date)}`]);
    csv += csvRow(["Home Team", teamName(matchup.homeUid)]);
    csv += csvRow(["Away Team", teamName(matchup.awayUid)]);
    csv += "\r\n";
    csv += teamCsvSection(matchup.homeUid, "Home", matchup);
    csv += "\r\n";
    csv += teamCsvSection(matchup.awayUid, "Away", matchup);

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

    weeksEl.innerHTML = weeks
      .map((week) => {
        const weekMatchups = byWeek
          .get(week)
          .sort((a, b) => (dayOrder[a.day] ?? 99) - (dayOrder[b.day] ?? 99) || a.id.localeCompare(b.id));
        const heading =
          weekMatchups[0].round === "regular"
            ? `Week ${week}`
            : `${roundLabel(weekMatchups[0].round)} (Week ${week})`;
        const cards = weekMatchups
          .map((m) => {
            const scoreText = m.status === "final" ? `${m.homeScore} – ${m.awayScore}` : "";
            const declareBtn =
              isAdmin() && m.status === "scheduled"
                ? `<button type="button" class="btn btn-secondary result-open-btn" data-id="${m.id}">Declare Result</button>`
                : m.status === "final" && isAdmin()
                ? `<button type="button" class="btn btn-secondary result-open-btn" data-id="${m.id}">Edit Result</button>`
                : "";
            const exportBtn = isAdmin()
              ? `<button type="button" class="btn btn-secondary export-matchup-btn" data-id="${m.id}">Export</button>`
              : "";
            const summaryLine = m.status === "final" && m.shortSummary
              ? `<p class="matchup-summary">${escapeHtml(m.shortSummary)}</p>`
              : "";
            return `<div class="card matchup-card">
                      <span class="matchup-day">${dayLabel[m.day] || m.day}, ${formatMatchupDate(m.date)}</span>
                      <span class="matchup-teams">${matchupLabel(m)}</span>
                      <span class="matchup-score">${scoreText}</span>
                      ${declareBtn}
                      ${exportBtn}
                      ${summaryLine}
                    </div>`;
          })
          .join("");
        return `<h3 class="matchup-week-heading">${escapeHtml(heading)}</h3>${cards}`;
      })
      .join("");

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

  const rosterInjuryChecklist = (uid, label) => {
    const team = teamsByUid.get(uid);
    const slots = (team && team.slots) || {};
    const entries = Object.entries(slots).filter(([, pick]) => pick);
    if (!entries.length) return `<p>${escapeHtml(label)}: no filled roster slots.</p>`;
    return `<p style="margin-top:0.75rem;"><strong>${escapeHtml(label)}</strong></p>
      <div class="injury-checklist">
        ${entries
          .map(
            ([slot, pick]) =>
              `<label><input type="checkbox" data-uid="${uid}" data-slot="${escapeHtml(slot)}" /> ${escapeHtml(pick.pokemonName)} (${escapeHtml(slot)})</label>`
          )
          .join("")}
      </div>`;
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
    resultInjuryAreaEl.innerHTML =
      rosterInjuryChecklist(matchup.homeUid, teamName(matchup.homeUid)) +
      rosterInjuryChecklist(matchup.awayUid, teamName(matchup.awayUid));
    resultModalEl.hidden = false;

    boxScoreMessageEl.hidden = true;
    boxScoreInputEl.value = "Loading existing box score (if any)…";
    boxScoreInputEl.disabled = true;
    db.collection("boxScores")
      .doc(matchupId)
      .get()
      .then((doc) => {
        if (pendingMatchupId !== matchupId) return; // modal moved on to a different game
        boxScoreInputEl.disabled = false;
        boxScoreInputEl.value = doc.exists ? JSON.stringify({ home: doc.data().home, away: doc.data().away }, null, 2) : "";
      })
      .catch(() => {
        if (pendingMatchupId !== matchupId) return;
        boxScoreInputEl.disabled = false;
        boxScoreInputEl.value = "";
      });
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

    const homeScore = Number(resultHomeScoreEl.value);
    const awayScore = Number(resultAwayScoreEl.value);
    if (Number.isNaN(homeScore) || Number.isNaN(awayScore)) {
      showResultMessage("Enter both scores.", true);
      return;
    }
    const winnerUid = homeScore === awayScore ? null : homeScore > awayScore ? matchup.homeUid : matchup.awayUid;

    const injured = [...resultInjuryAreaEl.querySelectorAll("input[type=checkbox]:checked")].map((input) => ({
      uid: input.dataset.uid,
      slot: input.dataset.slot,
    }));

    // A losing team banks a bonus training session for the weeks ahead; a
    // winning team's banked sessions reset to zero. Only applied the first
    // time a matchup goes final, not on a later "Edit Result", so
    // re-declaring the same matchup never double-credits a bonus.
    const isFirstDeclaration = matchup.status !== "final";

    // Firestore batches reject more than one write to the same document,
    // so every field touched for a given team - injury flags, training
    // bonus - has to land in a single merged update() call per uid.
    const teamUpdates = new Map();
    const mergeTeamUpdate = (uid, fields) => {
      teamUpdates.set(uid, Object.assign(teamUpdates.get(uid) || {}, fields));
    };

    injured.forEach(({ uid, slot }) => {
      mergeTeamUpdate(uid, { [`slots.${slot}.outForWeek`]: matchup.week + 1 });
    });

    if (isFirstDeclaration && winnerUid) {
      const loserUid = winnerUid === matchup.homeUid ? matchup.awayUid : matchup.homeUid;
      mergeTeamUpdate(winnerUid, { "training.bonusSessionsAvailable": 0 });
      mergeTeamUpdate(loserUid, { "training.bonusSessionsAvailable": firebase.firestore.FieldValue.increment(1) });
    }

    const resultText = winnerUid
      ? `${teamName(winnerUid)} defeated ${teamName(winnerUid === matchup.homeUid ? matchup.awayUid : matchup.homeUid)} ${Math.max(homeScore, awayScore)}-${Math.min(homeScore, awayScore)} (Week ${matchup.week})`
      : `${teamName(matchup.homeUid)} and ${teamName(matchup.awayUid)} tied ${homeScore}-${awayScore} (Week ${matchup.week})`;

    try {
      const batch = db.batch();
      batch.update(db.collection("matchups").doc(pendingMatchupId), {
        homeScore,
        awayScore,
        winnerUid,
        driveSummary: resultDriveSummaryEl.value.trim(),
        shortSummary: resultShortSummaryEl.value.trim(),
        status: "final",
      });
      teamUpdates.forEach((fields, uid) => {
        batch.update(db.collection("teams").doc(uid), fields);
      });
      if (isFirstDeclaration) {
        batch.set(db.collection("chatMessages").doc(), {
          uid: auth.currentUser.uid,
          system: true,
          text: resultText,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      if (isFirstDeclaration) notifyDiscord(resultText);
      closeResultModal();
    } catch (error) {
      showResultMessage(error.message, true);
    }
  }

  resultSubmitBtnEl.addEventListener("click", submitResult);

  const showBoxScoreMessage = (text, isError) => {
    boxScoreMessageEl.hidden = false;
    boxScoreMessageEl.className = `status${isError ? " error" : ""}`;
    boxScoreMessageEl.textContent = text;
  };

  // Validates loosely on purpose - this is admin-pasted JSON from an LLM,
  // not user input needing strict defense. Just enough checking to catch a
  // malformed paste before it reaches Firestore: both sides present as
  // arrays, every entry has a slot that's a real non-bench position and a
  // pokemonName, and stats (if present) is a plain object.
  const validateBoxScoreSide = (side, label) => {
    if (!Array.isArray(side)) throw new Error(`"${label}" must be an array.`);
    const validSlots = config.pokemonPositions || [];
    const benchSlots = new Set((config.positionGroups && config.positionGroups.bench) || []);
    side.forEach((entry, i) => {
      if (!entry || typeof entry !== "object") throw new Error(`${label}[${i}] isn't an object.`);
      if (!entry.slot || !validSlots.includes(entry.slot)) throw new Error(`${label}[${i}] has an invalid "slot": ${entry.slot}`);
      if (benchSlots.has(entry.slot)) throw new Error(`${label}[${i}] is a bench slot (${entry.slot}) - only starters get box score stats.`);
      if (!entry.pokemonName) throw new Error(`${label}[${i}] is missing "pokemonName".`);
      if (entry.stats && typeof entry.stats !== "object") throw new Error(`${label}[${i}].stats must be an object.`);
    });
  };

  async function saveBoxScore() {
    if (!pendingMatchupId) return;
    const raw = boxScoreInputEl.value.trim();
    if (!raw) {
      showBoxScoreMessage("Paste the box score JSON first.", true);
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      showBoxScoreMessage(`Invalid JSON: ${error.message}`, true);
      return;
    }
    try {
      validateBoxScoreSide(parsed.home, "home");
      validateBoxScoreSide(parsed.away, "away");
    } catch (error) {
      showBoxScoreMessage(error.message, true);
      return;
    }
    try {
      await db.collection("boxScores").doc(pendingMatchupId).set({
        home: parsed.home,
        away: parsed.away,
        enteredAt: firebase.firestore.FieldValue.serverTimestamp(),
        enteredBy: auth.currentUser.uid,
      });
      showBoxScoreMessage("Box score saved.", false);
    } catch (error) {
      showBoxScoreMessage(error.message, true);
    }
  }

  if (boxScoreSaveBtnEl) boxScoreSaveBtnEl.addEventListener("click", saveBoxScore);

  // --- Playoffs ---

  const allFinal = (round) => {
    const roundMatchups = matchups.filter((m) => m.round === round);
    return roundMatchups.length > 0 && roundMatchups.every((m) => m.status === "final");
  };

  const winnersOf = (round) =>
    matchups
      .filter((m) => m.round === round)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => m.winnerUid);

  async function generateQuarterfinals() {
    const teamsSnapshot = await db.collection("teams").orderBy("createdAt").get();
    const uidsWithData = teamsSnapshot.docs.filter((doc) => !doc.data().hidden).map((doc) => doc.id);
    if (uidsWithData.length < 8) {
      playoffAdminAreaEl.innerHTML = `<p class="status error">Need at least 8 teams to generate an 8-team playoff bracket.</p>`;
      return;
    }
    const standings = computeStandings();
    const seeds = standings.slice(0, 8).map((s) => s.uid);
    const pairs = [
      [seeds[0], seeds[7]],
      [seeds[1], seeds[6]],
      [seeds[2], seeds[5]],
      [seeds[3], seeds[4]],
    ];
    const startDate = seasonState.startDate.toDate();
    const assigned = assignDays(pairs, 0);
    const batch = db.batch();
    assigned.forEach(({ pair, day }, idx) => {
      batch.set(db.collection("matchups").doc(`w14-m${idx + 1}`), {
        week: 14,
        round: "quarterfinal",
        day,
        date: firebase.firestore.Timestamp.fromDate(dateForDay(startDate, 14, day)),
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
    batch.set(db.collection("seasonState").doc("current"), { phase: "playoffs", playoffSeeds: seeds, currentWeek: 14 }, { merge: true });
    await batch.commit();
  }

  async function generateSemifinals() {
    const winners = winnersOf("quarterfinal");
    const pairs = [[winners[0], winners[1]], [winners[2], winners[3]]];
    const startDate = seasonState.startDate.toDate();
    const assigned = assignDays(pairs, 0);
    const batch = db.batch();
    assigned.forEach(({ pair, day }, idx) => {
      batch.set(db.collection("matchups").doc(`w15-m${idx + 1}`), {
        week: 15,
        round: "semifinal",
        day,
        date: firebase.firestore.Timestamp.fromDate(dateForDay(startDate, 15, day)),
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
    batch.set(db.collection("seasonState").doc("current"), { currentWeek: 15 }, { merge: true });
    await batch.commit();
  }

  async function generatePokeBowl() {
    const winners = winnersOf("semifinal");
    const startDate = seasonState.startDate.toDate();
    await db.collection("matchups").doc("w16-m1").set({
      week: 16,
      round: "pokebowl",
      day: "sun",
      date: firebase.firestore.Timestamp.fromDate(dateForDay(startDate, 16, "sun")),
      homeUid: winners[0],
      awayUid: winners[1],
      homeScore: null,
      awayScore: null,
      winnerUid: null,
      driveSummary: "",
      shortSummary: "",
      status: "scheduled",
    });
    await db.collection("seasonState").doc("current").set({ currentWeek: 16 }, { merge: true });
  }

  const renderPlayoffAdmin = () => {
    if (!isAdmin() || !seasonState) {
      playoffAdminCardEl.hidden = true;
      return;
    }
    let html = "";
    if (seasonState.phase === "regular" && allFinal("regular")) {
      html = `<button type="button" class="btn" id="gen-qf-btn">Generate Quarterfinals (top 8 seeds)</button>`;
    } else if (seasonState.phase === "playoffs" && matchups.some((m) => m.round === "quarterfinal") && allFinal("quarterfinal") && !matchups.some((m) => m.round === "semifinal")) {
      html = `<button type="button" class="btn" id="gen-sf-btn">Generate Semifinals</button>`;
    } else if (seasonState.phase === "playoffs" && matchups.some((m) => m.round === "semifinal") && allFinal("semifinal") && !matchups.some((m) => m.round === "pokebowl")) {
      html = `<button type="button" class="btn" id="gen-pb-btn">Generate PokéBowl</button>`;
    } else if (matchups.some((m) => m.round === "pokebowl") && allFinal("pokebowl")) {
      html = `<p>🏆 The season is complete! Champion: ${escapeHtml(teamName(matchups.find((m) => m.round === "pokebowl").winnerUid))}</p>`;
    } else {
      html = `<p class="status">Nothing to advance yet.</p>`;
    }
    playoffAdminCardEl.hidden = false;
    playoffAdminAreaEl.innerHTML = html;
    const qfBtn = document.getElementById("gen-qf-btn");
    if (qfBtn) qfBtn.addEventListener("click", generateQuarterfinals);
    const sfBtn = document.getElementById("gen-sf-btn");
    if (sfBtn) sfBtn.addEventListener("click", generateSemifinals);
    const pbBtn = document.getElementById("gen-pb-btn");
    if (pbBtn) pbBtn.addEventListener("click", generatePokeBowl);
  };

  const renderBracket = () => {
    const playoffMatchups = matchups.filter((m) => m.round !== "regular");
    if (!playoffMatchups.length) {
      bracketCardEl.hidden = true;
      return;
    }
    bracketCardEl.hidden = false;
    const rounds = ["quarterfinal", "semifinal", "pokebowl"];
    bracketAreaEl.innerHTML = rounds
      .map((round) => {
        const roundMatchups = playoffMatchups.filter((m) => m.round === round).sort((a, b) => a.id.localeCompare(b.id));
        if (!roundMatchups.length) return "";
        return `<div class="bracket-round">
          <h3 class="matchup-week-heading">${roundLabel(round)}</h3>
          ${roundMatchups
            .map(
              (m) => `<div class="card matchup-card">
                <span class="matchup-teams">${matchupLabel(m)}</span>
                <span class="matchup-score">${m.status === "final" ? `${m.homeScore} – ${m.awayScore}` : "TBD"}</span>
                ${isAdmin() ? `<button type="button" class="btn btn-secondary export-matchup-btn" data-id="${m.id}">Export</button>` : ""}
              </div>`
            )
            .join("")}
        </div>`;
      })
      .join("");

    bracketAreaEl.querySelectorAll(".export-matchup-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const matchup = matchups.find((m) => m.id === btn.dataset.id);
        if (matchup) exportMatchupCsv(matchup);
      });
    });
  };

  // --- Live listeners ---

  let unsubscribeTeams = null;
  let unsubscribeMatchups = null;
  let unsubscribeSeason = null;
  let unsubscribeTrainingLog = null;

  const renderAll = () => {
    renderStandings();
    renderWeeks();
    renderPlayoffAdmin();
    renderBracket();
  };

  const subscribe = () => {
    [unsubscribeTeams, unsubscribeMatchups, unsubscribeSeason, unsubscribeTrainingLog].forEach(
      (unsubscribe) => unsubscribe && unsubscribe()
    );
    unsubscribeTeams = unsubscribeMatchups = unsubscribeSeason = unsubscribeTrainingLog = null;

    if (!currentUser) {
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.innerHTML = `Sign in on the <a href="pokemon-league.html">League Home</a> page to view the schedule.`;
      generateCardEl.hidden = true;
      resetSeasonCardEl.hidden = true;
      resetTrainingCardEl.hidden = true;
      standingsCardEl.hidden = true;
      playoffAdminCardEl.hidden = true;
      bracketCardEl.hidden = true;
      weeksEl.innerHTML = "";
      return;
    }

    statusEl.hidden = true;
    resetTrainingCardEl.hidden = !isAdmin();
    if (isAdmin() && trainingCutoffEl && !trainingCutoffEl.value) {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      trainingCutoffEl.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }

    unsubscribeTeams = db.collection("teams").onSnapshot(
      (snapshot) => {
        teamsByUid = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
        renderAll();
      },
      () => {}
    );

    unsubscribeTrainingLog = db.collection("trainingLog").onSnapshot(
      (snapshot) => {
        trainingLog = snapshot.docs.map((doc) => doc.data());
        renderAll();
      },
      () => {}
    );

    unsubscribeMatchups = db.collection("matchups").onSnapshot(
      (snapshot) => {
        matchups = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        updateGenerateCardVisibility();
        renderAll();
      },
      () => {}
    );

    unsubscribeSeason = db
      .collection("seasonState")
      .doc("current")
      .onSnapshot(
        (doc) => {
          seasonState = doc.exists ? doc.data() : null;
          updateGenerateCardVisibility();
          if (generateBtnEl) generateBtnEl.textContent = seasonState ? "Regenerate Schedule" : "Generate Schedule";
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
