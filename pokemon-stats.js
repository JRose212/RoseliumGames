(function () {
  const config = window.siteConfig || {};
  const statusEl = document.getElementById("stats-status");
  const leaderboardsCardEl = document.getElementById("leaderboards-card");
  const leaderboardsAreaEl = document.getElementById("leaderboards-area");

  if (!leaderboardsAreaEl) return;

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

  const leaderboardCategories = config.boxScoreLeaderboardCategories || [];

  let currentUser = null;
  let teamsByUid = new Map();
  let matchups = [];
  let boxScoresByMatchupId = new Map();

  const teamName = (uid) => teamsByUid.get(uid)?.teamName || "Unknown team";

  // Leaderboards only - per-game summaries and box scores live on the
  // Schedule page itself, right on each matchup's own row. This page is
  // purely the season-wide aggregate, summed live from every box score
  // (same "compute from the raw collection, don't store aggregates"
  // approach the rest of the site already uses for standings).
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
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.textContent = "No box scores recorded yet - leaderboards show up here once games have stats.";
      leaderboardsCardEl.hidden = true;
      return;
    }
    statusEl.hidden = true;

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
      return;
    }

    statusEl.hidden = false;
    statusEl.className = "status";
    statusEl.textContent = "Loading…";

    unsubscribeTeams = db.collection("teams").onSnapshot(
      (snapshot) => {
        teamsByUid = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
        renderLeaderboards();
      },
      () => {}
    );

    unsubscribeMatchups = db.collection("matchups").onSnapshot(
      (snapshot) => {
        matchups = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        renderLeaderboards();
      },
      () => {}
    );

    unsubscribeBoxScores = db.collection("boxScores").onSnapshot(
      (snapshot) => {
        boxScoresByMatchupId = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
        renderLeaderboards();
      },
      () => {}
    );
  };

  auth.onAuthStateChanged((user) => {
    currentUser = user;
    subscribe();
  });
})();
