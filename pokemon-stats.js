(function () {
  const config = window.siteConfig || {};
  const statusEl = document.getElementById("stats-status");
  const leaderboardsCardEl = document.getElementById("leaderboards-card");
  const leaderboardsAreaEl = document.getElementById("leaderboards-area");
  const weeksEl = document.getElementById("box-scores-weeks");

  if (!weeksEl) return;

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

  firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  const statFields = config.boxScoreStatFields || {};
  const statLabels = config.boxScoreStatLabels || {};
  const leaderboardCategories = config.boxScoreLeaderboardCategories || [];
  const positionOrder = config.pokemonPositions || [];

  let currentUser = null;
  let teamsByUid = new Map();
  let matchups = [];
  let boxScoresByMatchupId = new Map();

  const teamName = (uid) => teamsByUid.get(uid)?.teamName || "Unknown team";

  // --- Leaderboards: summed live from every box score on the page, same
  // "compute from the raw collection, don't store aggregates" approach the
  // rest of the site already uses for standings. ---

  const renderLeaderboards = () => {
    if (!leaderboardCategories.length) {
      leaderboardsCardEl.hidden = true;
      return;
    }

    // keyed by pokemonName - totals[key][pokemonName] = { total, team }
    const totals = {};
    leaderboardCategories.forEach((cat) => (totals[cat.key] = new Map()));

    matchups.forEach((matchup) => {
      const box = boxScoresByMatchupId.get(matchup.id);
      if (!box) return;
      [
        { side: box.home, uid: matchup.homeUid },
        { side: box.away, uid: matchup.awayUid },
      ].forEach(({ side, uid }) => {
        (side || []).forEach((entry) => {
          const stats = entry.stats || {};
          leaderboardCategories.forEach((cat) => {
            const value = Number(stats[cat.key]) || 0;
            if (!value) return;
            const map = totals[cat.key];
            const existing = map.get(entry.pokemonName) || { total: 0, team: teamName(uid) };
            existing.total += value;
            existing.team = teamName(uid);
            map.set(entry.pokemonName, existing);
          });
        });
      });
    });

    const hasAnyData = leaderboardCategories.some((cat) => totals[cat.key].size > 0);
    if (!hasAnyData) {
      leaderboardsCardEl.hidden = true;
      return;
    }

    leaderboardsAreaEl.innerHTML = leaderboardCategories
      .map((cat) => {
        const entries = [...totals[cat.key].entries()]
          .map(([pokemonName, data]) => ({ pokemonName, ...data }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 5);
        if (!entries.length) return "";
        return `
          <div class="leaderboard-card">
            <h3>${escapeHtml(cat.label)}</h3>
            <ol>
              ${entries
                .map(
                  (e) =>
                    `<li><span class="leaderboard-name">${escapeHtml(e.pokemonName)}</span><span class="leaderboard-team">${escapeHtml(e.team)}</span><span class="leaderboard-value">${e.total}</span></li>`
                )
                .join("")}
            </ol>
          </div>
        `;
      })
      .join("");
    leaderboardsCardEl.hidden = false;
  };

  // --- Per-game box score tables ---

  const formatStatLine = (slot, stats) => {
    const fields = statFields[slot] || [];
    const parts = fields
      .map((key) => {
        const value = Number((stats || {})[key]) || 0;
        if (!value) return null;
        return `${value} ${statLabels[key] || key}`;
      })
      .filter(Boolean);
    return parts.length ? parts.join(", ") : "—";
  };

  const sideTableHtml = (label, side) => {
    const bySlot = new Map((side || []).map((entry) => [entry.slot, entry]));
    const rows = positionOrder
      .filter((slot) => bySlot.has(slot))
      .map((slot) => {
        const entry = bySlot.get(slot);
        return `<tr>
                  <td>${escapeHtml(slot)}</td>
                  <td>${escapeHtml(entry.pokemonName)}</td>
                  <td>${escapeHtml(formatStatLine(slot, entry.stats))}</td>
                </tr>`;
      })
      .join("");
    return `
      <div class="box-score-side">
        <h4>${escapeHtml(label)}</h4>
        <div class="table-wrap">
          <table class="standings-table">
            <thead><tr><th>Pos</th><th>Pokémon</th><th>Stats</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  };

  const matchupRowHtml = (matchup) => {
    const box = boxScoresByMatchupId.get(matchup.id);
    const scoreText =
      matchup.homeScore != null && matchup.awayScore != null ? `Final ${matchup.homeScore}-${matchup.awayScore}` : "Final";
    const body = box
      ? `<div class="box-score-sides">${sideTableHtml(teamName(matchup.homeUid), box.home)}${sideTableHtml(teamName(matchup.awayUid), box.away)}</div>`
      : `<p class="status">No box score entered for this game yet.</p>`;
    return `
      <details class="roster-set">
        <summary class="roster-set-title">${escapeHtml(teamName(matchup.homeUid))} vs ${escapeHtml(teamName(matchup.awayUid))}<span class="roster-set-count">${escapeHtml(scoreText)}</span></summary>
        <div class="roster-set-group">${body}</div>
      </details>
    `;
  };

  const renderWeeks = () => {
    const finalMatchups = matchups.filter((m) => m.status === "final").sort((a, b) => a.week - b.week);
    if (!finalMatchups.length) {
      weeksEl.innerHTML = `<p class="status">No completed games yet - box scores show up here once results are declared on the Schedule page.</p>`;
      return;
    }
    const byWeek = new Map();
    finalMatchups.forEach((m) => {
      if (!byWeek.has(m.week)) byWeek.set(m.week, []);
      byWeek.get(m.week).push(m);
    });
    weeksEl.innerHTML = [...byWeek.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(
        ([week, weekMatchups]) => `
          <section class="card">
            <h2>Week ${week}</h2>
            ${weekMatchups.map(matchupRowHtml).join("")}
          </section>
        `
      )
      .join("");
  };

  const renderAll = () => {
    renderLeaderboards();
    renderWeeks();
  };

  let unsubscribeTeams = null;
  let unsubscribeMatchups = null;
  let unsubscribeBoxScores = null;

  const subscribe = () => {
    [unsubscribeTeams, unsubscribeMatchups, unsubscribeBoxScores].forEach((u) => u && u());
    unsubscribeTeams = unsubscribeMatchups = unsubscribeBoxScores = null;

    if (!currentUser) {
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.innerHTML = `Sign in on the <a href="pokemon-league.html">League Home</a> page to view stats.`;
      leaderboardsCardEl.hidden = true;
      weeksEl.innerHTML = "";
      return;
    }

    statusEl.hidden = true;

    unsubscribeTeams = db.collection("teams").onSnapshot(
      (snapshot) => {
        teamsByUid = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
        renderAll();
      },
      () => {}
    );

    unsubscribeMatchups = db.collection("matchups").onSnapshot(
      (snapshot) => {
        matchups = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        renderAll();
      },
      () => {}
    );

    unsubscribeBoxScores = db.collection("boxScores").onSnapshot(
      (snapshot) => {
        boxScoresByMatchupId = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
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
