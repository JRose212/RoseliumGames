// Gamecast - reveals a pre-simulated play-by-play (gamePlays/{matchupId},
// see pokemon-schedule.js's Publish Gamecast admin tool) on a timer
// instead of all at once. Every visitor's browser just compares now()
// against each play's own computed reveal time (kickoffAt + index *
// secondsPerPlay) - no server push needed, so it works on a static site
// with no backend.
//
// Admin-only for now, on purpose - this is being saved for the PokéBowl,
// not turned on for regular games yet. Also carries a small admin-only
// test harness (publishes to a fixed gamePlays/gamecast-test doc, not
// tied to any real matchup) so it can be tried out with two arbitrary
// teams before the real thing matters.
(function () {
  const config = window.siteConfig || {};
  const statusEl = document.getElementById("gamecast-status");
  const cardEl = document.getElementById("gamecast-card");
  const scorebugEl = document.getElementById("gamecast-scorebug");
  const feedEl = document.getElementById("gamecast-feed");
  const testCardEl = document.getElementById("gamecast-test-card");
  const testHomeEl = document.getElementById("gamecast-test-home");
  const testAwayEl = document.getElementById("gamecast-test-away");
  const testInputEl = document.getElementById("gamecast-test-input");
  const testSecondsPerPlayEl = document.getElementById("gamecast-test-seconds-per-play");
  const testMessageEl = document.getElementById("gamecast-test-message");
  const testPublishBtnEl = document.getElementById("gamecast-test-publish-btn");

  if (!cardEl) return;

  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const TEST_MATCHUP_ID = "gamecast-test";
  const matchupId = new URLSearchParams(location.search).get("matchup");

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

  const isRealAdmin = () =>
    Boolean(currentUser && config.adminUid && config.adminUid !== "YOUR_ADMIN_UID" && currentUser.uid === config.adminUid);
  // Admin Mode toggle (pokemon-admin-toggle.js) - when switched to user
  // view, this page hides itself exactly like a non-admin would see it,
  // same as every other admin-gated page.
  const isAdmin = () => isRealAdmin() && localStorage.getItem(`adminViewMode:${currentUser.uid}`) !== "user";

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

  // --- Admin test harness ---

  const populateTestTeamSelects = () => {
    const options = [...teamsByUid.entries()]
      .map(([uid, team]) => `<option value="${uid}">${escapeHtml((team && team.teamName) || uid)}</option>`)
      .join("");
    [testHomeEl, testAwayEl].forEach((selectEl) => {
      const previous = selectEl.value;
      selectEl.innerHTML = options;
      if (previous && teamsByUid.has(previous)) selectEl.value = previous;
    });
  };

  const showTestMessage = (text, isError) => {
    testMessageEl.hidden = false;
    testMessageEl.className = `status${isError ? " error" : ""}`;
    testMessageEl.textContent = text;
  };

  async function publishTestGamecast() {
    const homeUid = testHomeEl.value;
    const awayUid = testAwayEl.value;
    if (!homeUid || !awayUid || homeUid === awayUid) {
      showTestMessage("Pick two different teams.", true);
      return;
    }
    const raw = testInputEl.value.trim();
    if (!raw) {
      showTestMessage("Paste the play-by-play JSON first.", true);
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      showTestMessage(`Invalid JSON: ${error.message}`, true);
      return;
    }
    if (!Array.isArray(parsed.plays) || !parsed.plays.length) {
      showTestMessage(`"plays" must be a non-empty array.`, true);
      return;
    }
    const secondsPerPlay = Number(testSecondsPerPlayEl.value) || 20;

    try {
      await db
        .collection("gamePlays")
        .doc(TEST_MATCHUP_ID)
        .set({
          schemaVersion: parsed.schemaVersion || 1,
          game: parsed.game || null,
          homeUid,
          awayUid,
          plays: parsed.plays,
          kickoffAt: firebase.firestore.Timestamp.now(),
          secondsPerPlay,
          enteredAt: firebase.firestore.FieldValue.serverTimestamp(),
          enteredBy: currentUser.uid,
        });
      showTestMessage("Test Gamecast published - kickoff is now. Open \"View Test Gamecast\" to watch it.", false);
    } catch (error) {
      showTestMessage(error.message, true);
    }
  }

  if (testPublishBtnEl) testPublishBtnEl.addEventListener("click", publishTestGamecast);

  // --- Live data ---

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

    if (!isAdmin()) {
      cardEl.hidden = true;
      testCardEl.hidden = true;
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.textContent = "Gamecast isn't available yet - check back during a live game.";
      return;
    }

    testCardEl.hidden = false;

    statusEl.hidden = false;
    statusEl.className = "status";
    statusEl.textContent = matchupId ? "Loading…" : "Pick a game above, or open this page from a \"Watch Gamecast\" link.";

    db.collection("teams")
      .get()
      .then((snapshot) => {
        teamsByUid = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
        populateTestTeamSelects();
        render();
      })
      .catch(() => {});

    if (!matchupId) return;

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
