// Gamecast - reveals a pre-simulated play-by-play (gamePlays/{matchupId},
// see pokemon-schedule.js's Publish Gamecast admin tool) on a timer
// instead of all at once. Every visitor's browser just compares now()
// against each play's own computed reveal time (kickoffAt + index *
// secondsPerPlay) - no server push needed, so it works on a static site
// with no backend.
(function () {
  const config = window.siteConfig || {};
  const statusEl = document.getElementById("gamecast-status");
  const cardEl = document.getElementById("gamecast-card");
  const scorebugEl = document.getElementById("gamecast-scorebug");
  const feedEl = document.getElementById("gamecast-feed");

  if (!cardEl) return;

  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const matchupId = new URLSearchParams(location.search).get("matchup");
  if (!matchupId) {
    statusEl.textContent = "No game specified - open this page from a \"Watch Gamecast\" link on the Schedule page.";
    return;
  }

  if (!config.firebaseConfig || config.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") {
    statusEl.className = "status error";
    statusEl.textContent = "Fantasy League is not configured yet.";
    return;
  }

  if (!firebase.apps.length) firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  let currentUser = null;
  let gameDoc = null;
  let teamsByUid = new Map();
  let tickTimer = null;

  const typeLabels = { fg: "Field Goal", xp: "Extra Point", kickoff: "Kickoff", punt: "Punt" };
  const resultLabels = {
    td: "TOUCHDOWN",
    int: "INTERCEPTION",
    fumble_lost: "FUMBLE",
    fg_good: "FIELD GOAL GOOD",
    fg_miss: "FIELD GOAL NO GOOD",
    xp_good: "EXTRA POINT GOOD",
    xp_miss: "EXTRA POINT NO GOOD",
    safety: "SAFETY",
    turnover_on_downs: "TURNOVER ON DOWNS",
  };

  const teamName = (uid) => (teamsByUid.get(uid) && teamsByUid.get(uid).teamName) || "Unknown team";

  const formatDownDist = (down, dist) => {
    if (down === null || down === undefined || dist === null || dist === undefined) return "";
    const ordinal = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th" }[down] || `${down}th`;
    return `${ordinal} &amp; ${dist}`;
  };

  const revealCount = () => {
    if (!gameDoc || !gameDoc.kickoffAt) return 0;
    const kickoffMs = gameDoc.kickoffAt.toMillis();
    const perPlayMs = (gameDoc.secondsPerPlay || 20) * 1000;
    const elapsed = Date.now() - kickoffMs;
    if (elapsed < 0) return 0;
    return Math.min(gameDoc.plays.length, Math.floor(elapsed / perPlayMs) + 1);
  };

  const playCardHtml = (play, isLatest) => {
    const teamKey = play.poss === "home" ? gameDoc.homeUid : gameDoc.awayUid;
    const downDist = formatDownDist(play.down, play.dist);
    const resultText = resultLabels[play.result];
    const classes = ["gamecast-play"];
    if (play.highlight) classes.push("gamecast-play--highlight");
    if (isLatest) classes.push("gamecast-play--latest");
    return `
      <div class="${classes.join(" ")}">
        <div class="gamecast-play-meta">
          <span>Q${play.q} &middot; ${escapeHtml(play.clock || "")}</span>
          <span>${escapeHtml(teamName(teamKey))}${downDist ? ` &middot; ${downDist}` : ""}</span>
        </div>
        ${resultText ? `<p class="gamecast-play-result">${escapeHtml(resultText)}</p>` : ""}
        <p class="gamecast-play-desc">${escapeHtml(play.desc || "")}</p>
      </div>
    `;
  };

  const render = () => {
    if (!gameDoc) return;
    const count = revealCount();
    const revealed = gameDoc.plays.slice(0, count);
    const latest = revealed[revealed.length - 1];
    const score = latest ? latest.scoreAfter : { home: 0, away: 0 };

    cardEl.hidden = false;
    statusEl.hidden = true;

    if (count === 0) {
      scorebugEl.innerHTML = `
        <div class="gamecast-score-row">
          <span>${escapeHtml(teamName(gameDoc.homeUid))}</span>
          <span class="gamecast-score-value">0 - 0</span>
          <span>${escapeHtml(teamName(gameDoc.awayUid))}</span>
        </div>
        <p class="status">Kickoff hasn't happened yet - check back once it's underway.</p>
      `;
      feedEl.innerHTML = "";
      return;
    }

    const isFinal = count >= gameDoc.plays.length;
    scorebugEl.innerHTML = `
      <div class="gamecast-score-row">
        <span>${escapeHtml(teamName(gameDoc.homeUid))}</span>
        <span class="gamecast-score-value">${score.home} - ${score.away}</span>
        <span>${escapeHtml(teamName(gameDoc.awayUid))}</span>
      </div>
      <p class="status">${isFinal ? "FINAL" : `Q${latest.q} &middot; ${escapeHtml(latest.clock || "")}`}</p>
    `;

    // Newest play first, so the latest action is always visible without
    // scrolling - this re-renders the whole feed on every tick, which is
    // fine at this scale (a game tops out around 150 plays).
    feedEl.innerHTML = revealed
      .slice()
      .reverse()
      .map((play, i) => playCardHtml(play, i === 0))
      .join("");
  };

  const tick = () => {
    render();
    if (gameDoc && revealCount() >= gameDoc.plays.length) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };

  const startTicking = () => {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(tick, 2000);
    tick();
  };

  let unsubscribeGamePlays = null;

  const subscribe = () => {
    if (unsubscribeGamePlays) {
      unsubscribeGamePlays();
      unsubscribeGamePlays = null;
    }
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }

    if (!currentUser) {
      cardEl.hidden = true;
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.innerHTML = `Sign in on the <a href="pokemon-league.html">League Home</a> page to watch the Gamecast.`;
      return;
    }

    statusEl.hidden = false;
    statusEl.className = "status";
    statusEl.textContent = "Loading…";

    db.collection("teams")
      .get()
      .then((snapshot) => {
        teamsByUid = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
        render();
      })
      .catch(() => {});

    unsubscribeGamePlays = db
      .collection("gamePlays")
      .doc(matchupId)
      .onSnapshot(
        (doc) => {
          if (!doc.exists) {
            statusEl.hidden = false;
            statusEl.className = "status";
            statusEl.textContent = "No Gamecast has been published for this game yet.";
            cardEl.hidden = true;
            return;
          }
          gameDoc = doc.data();
          startTicking();
        },
        (error) => {
          statusEl.hidden = false;
          statusEl.className = "status error";
          statusEl.textContent = `Unable to load this Gamecast: ${error.message}`;
        }
      );
  };

  auth.onAuthStateChanged((user) => {
    currentUser = user;
    subscribe();
  });
})();
