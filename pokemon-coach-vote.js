// Legendary Coach Voting - shared across all 11 pokemon-*.html pages, same
// convention as pokemon-chat.js. Managers vote on which Legendaries make the
// final 8 playoff coach options: 8 votes each, at most one per Legendary,
// saved in as many batches as they like - but every saved vote is final.
//
// - The voting popup opens from the League Home button, or from any page
//   via #coach-voting in the URL.
// - A manager with votes left gets a reminder popup once per browser
//   session, on whichever Pokemon page they land on first.
// - The live leaderboard shows vote totals only, never who voted for what.
//   Totals are counted from every ballot (coachVotes/{uid}) rather than a
//   separate tally doc, so they can't drift or be tampered with - which
//   means ballots are readable by signed-in managers at the database level
//   even though the site never displays them.
// - Voting closes automatically once every regular-season game is final.
//   firestore.rules enforces the ballot shape and finality (8 max, no
//   repeats, only these 35, picks can only be added); the close itself is
//   enforced here, since rules can't check every matchup.
(function () {
  const config = window.siteConfig || {};
  if (!config.firebaseConfig || config.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") return;
  if (!String(document.body.dataset.page || "").startsWith("pokemon-")) return;

  if (!firebase.apps.length) firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  const MAX_VOTES = 8;
  const FINALISTS = 8;
  const HASH = "#coach-voting";

  // Hand-picked by the admin, in Pokedex order. Keep in sync with the id
  // list in firestore.rules (validCoachBallot).
  const candidates = [
    { id: 144, name: "Articuno" },
    { id: 145, name: "Zapdos" },
    { id: 146, name: "Moltres" },
    { id: 150, name: "Mewtwo" },
    { id: 151, name: "Mew" },
    { id: 243, name: "Raikou" },
    { id: 244, name: "Entei" },
    { id: 245, name: "Suicune" },
    { id: 249, name: "Lugia" },
    { id: 250, name: "Ho-Oh" },
    { id: 251, name: "Celebi" },
    { id: 380, name: "Latias" },
    { id: 381, name: "Latios" },
    { id: 382, name: "Kyogre" },
    { id: 383, name: "Groudon" },
    { id: 384, name: "Rayquaza" },
    { id: 385, name: "Jirachi" },
    { id: 386, name: "Deoxys" },
    { id: 483, name: "Dialga" },
    { id: 484, name: "Palkia" },
    { id: 486, name: "Regigigas" },
    { id: 487, name: "Giratina" },
    { id: 488, name: "Cresselia" },
    { id: 491, name: "Darkrai" },
    { id: 493, name: "Arceus" },
    { id: 638, name: "Cobalion" },
    { id: 640, name: "Virizion" },
    { id: 643, name: "Reshiram" },
    { id: 646, name: "Kyurem" },
    { id: 716, name: "Xerneas" },
    { id: 717, name: "Yveltal" },
    { id: 718, name: "Zygarde" },
    { id: 721, name: "Volcanion" },
    { id: 800, name: "Necrozma" },
    { id: 1007, name: "Koraidon" },
  ];
  const candidateById = new Map(candidates.map((c) => [c.id, c]));

  const artUrl = (id) =>
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;

  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  // --- Markup (injected, so the 11 pages only need the script tag) ---

  document.body.insertAdjacentHTML(
    "beforeend",
    `
    <div class="coach-vote-modal" id="coach-vote-modal" hidden>
      <div class="card coach-vote-panel" role="dialog" aria-modal="true" aria-labelledby="coach-vote-title">
        <button type="button" class="rules-modal-close" id="coach-vote-close" aria-label="Close">✕</button>
        <h2 id="coach-vote-title">⚡ Legendary Coach Voting</h2>
        <p class="coach-vote-intro">
          Coming in the playoffs: every team can recruit a <strong>Legendary coach</strong>, each giving its
          own themed buff. Help decide which <strong>${FINALISTS}</strong> Legendaries make the final list.
          You get <strong>${MAX_VOTES} votes</strong>, one per Legendary, and voting stays open until the
          regular season ends.
        </p>
        <div id="coach-vote-body"></div>
      </div>
    </div>

    <div class="coach-vote-modal coach-vote-reminder" id="coach-vote-reminder" hidden>
      <div class="card coach-vote-reminder-panel" role="dialog" aria-modal="true" aria-labelledby="coach-vote-reminder-title">
        <button type="button" class="rules-modal-close" id="coach-vote-reminder-close" aria-label="Close">✕</button>
        <h2 id="coach-vote-reminder-title">⚡ Legendary Coach Voting is open</h2>
        <p id="coach-vote-reminder-text"></p>
        <a class="btn coach-vote-reminder-link" id="coach-vote-reminder-link" href="pokemon-league.html${HASH}">Go vote</a>
      </div>
    </div>
    `
  );

  const modalEl = document.getElementById("coach-vote-modal");
  const bodyEl = document.getElementById("coach-vote-body");
  const reminderEl = document.getElementById("coach-vote-reminder");
  const reminderTextEl = document.getElementById("coach-vote-reminder-text");
  const homeBtnEl = document.getElementById("coach-vote-btn"); // League Home only

  // --- State ---

  let currentUser = null;
  let teamsByUid = new Map();
  let ballots = new Map(); // uid -> [pokemonId]
  let matchups = [];
  let loaded = { teams: false, ballots: false, matchups: false };
  let selected = new Set();
  let saving = false;
  let message = null; // { text, isError }
  let loadError = null;
  let unsubscribers = [];

  const isAdmin = () =>
    Boolean(
      currentUser &&
        config.adminUid &&
        currentUser.uid === config.adminUid &&
        localStorage.getItem(`adminViewMode:${currentUser.uid}`) !== "user"
    );

  const votingClosed = () => {
    const regular = matchups.filter((m) => m.round === "regular");
    return regular.length > 0 && regular.every((m) => m.status === "final");
  };
  const hasTeam = () => Boolean(currentUser && teamsByUid.has(currentUser.uid));
  const myPicks = () => (currentUser && ballots.get(currentUser.uid)) || [];
  const votesLeft = () => MAX_VOTES - myPicks().length;
  const canVote = () => hasTeam() && !votingClosed() && votesLeft() > 0;
  const allLoaded = () => loaded.teams && loaded.ballots && loaded.matchups;

  // --- Leaderboard ---

  const tallies = () => {
    const counts = new Map();
    ballots.forEach((picks) => picks.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1)));
    return [...counts.entries()]
      .filter(([id]) => candidateById.has(id))
      .map(([id, count]) => ({ ...candidateById.get(id), count }))
      .sort((a, b) => b.count - a.count || a.id - b.id);
  };

  // "in" = currently in the top 8; "tie" = tied at the 8th-place line with
  // more Legendaries than there are spots left.
  const finalistStatus = (rows) => {
    const status = new Map();
    if (!rows.length) return status;
    const cutoff = rows[Math.min(FINALISTS, rows.length) - 1].count;
    const atOrAbove = rows.filter((r) => r.count >= cutoff).length;
    rows.forEach((r) => {
      if (r.count > cutoff || (r.count === cutoff && atOrAbove <= FINALISTS)) status.set(r.id, "in");
      else if (r.count === cutoff) status.set(r.id, "tie");
    });
    return status;
  };

  const leaderboardHtml = () => {
    const rows = tallies();
    const voters = [...ballots.values()].filter((picks) => picks.length).length;
    const totalVotes = rows.reduce((sum, r) => sum + r.count, 0);
    const closed = votingClosed();
    if (!rows.length) {
      return `<h3>${closed ? "Final Results" : "Live Leaderboard"}</h3><p class="status">No votes yet - be the first!</p>`;
    }
    const status = finalistStatus(rows);
    const max = rows[0].count;
    const noVotes = candidates.length - rows.length;
    return `
      <h3>${closed ? "Final Results" : "Live Leaderboard"}</h3>
      <p class="status coach-vote-board-meta">${voters} manager${voters === 1 ? "" : "s"} voted · ${totalVotes} vote${totalVotes === 1 ? "" : "s"} cast</p>
      <ol class="coach-vote-board">
        ${rows
          .map((r, i) => {
            const s = status.get(r.id);
            const badge = s === "in" ? `<span class="coach-vote-board-badge">Top ${FINALISTS}</span>` : s === "tie" ? `<span class="coach-vote-board-badge coach-vote-board-badge--tie">Tied for ${FINALISTS}th</span>` : "";
            const divider = i === FINALISTS && rows.length > FINALISTS ? " coach-vote-board-row--cutline" : "";
            return `<li class="coach-vote-board-row${s === "in" ? " coach-vote-board-row--in" : ""}${divider}">
                <img src="${artUrl(r.id)}" alt="" loading="lazy" />
                <span class="coach-vote-board-name">${escapeHtml(r.name)} ${badge}</span>
                <span class="coach-vote-board-bar"><span style="width:${Math.round((r.count / max) * 100)}%"></span></span>
                <span class="coach-vote-board-count">${r.count}</span>
              </li>`;
          })
          .join("")}
      </ol>
      ${noVotes ? `<p class="status">${noVotes} Legendar${noVotes === 1 ? "y has" : "ies have"} no votes yet.</p>` : ""}
    `;
  };

  // Admin-only: how many votes each team has used (never which ones).
  const adminStatusHtml = () => {
    if (!isAdmin()) return "";
    const teams = [...teamsByUid.entries()]
      .map(([uid, team]) => ({ name: team.teamName || "Unnamed Team", used: (ballots.get(uid) || []).length }))
      .sort((a, b) => a.used - b.used || a.name.localeCompare(b.name));
    const done = teams.filter((t) => t.used >= MAX_VOTES).length;
    return `
      <details class="coach-vote-admin">
        <summary>Admin: ballot status (${done} of ${teams.length} teams finished)</summary>
        <ul>${teams.map((t) => `<li>${escapeHtml(t.name)} - ${t.used}/${MAX_VOTES} votes used</li>`).join("")}</ul>
      </details>
    `;
  };

  // --- Voting popup ---

  const render = () => {
    updateHomeButton();
    if (modalEl.hidden) return;

    if (!currentUser) {
      bodyEl.innerHTML = `<p class="status">Sign in on <a href="pokemon-league.html">League Home</a> to vote.</p>`;
      return;
    }
    if (loadError) {
      bodyEl.innerHTML = `<p class="status error">Voting isn't available right now: ${escapeHtml(loadError)}</p>`;
      return;
    }
    if (!allLoaded()) {
      bodyEl.innerHTML = `<p class="status">Loading votes…</p>`;
      return;
    }

    const closed = votingClosed();
    const picks = new Set(myPicks());
    const left = votesLeft();
    const roomLeft = left - selected.size;
    const interactive = canVote();

    let statusLine;
    if (closed) statusLine = `Voting has closed - the regular season is over. Here's how it finished.`;
    else if (!hasTeam()) statusLine = `Only managers with a team can vote, but you can still follow the leaderboard.`;
    else if (left === 0) statusLine = `You've used all ${MAX_VOTES} votes - thanks! Keep an eye on the leaderboard.`;
    else
      statusLine = `You've used <strong>${picks.size}</strong> of ${MAX_VOTES} votes. Selected: <strong>${selected.size}</strong>${
        roomLeft > 0 ? ` (you can pick ${roomLeft} more)` : " - that's all your remaining votes"
      }.`;

    const cardsHtml = candidates
      .map((c) => {
        const voted = picks.has(c.id);
        const isSelected = selected.has(c.id);
        const disabled = voted || !interactive || (!isSelected && roomLeft <= 0);
        const cls = ["coach-vote-card", voted ? "coach-vote-card--voted" : "", isSelected ? "coach-vote-card--selected" : ""]
          .filter(Boolean)
          .join(" ");
        const tag = voted ? `<span class="coach-vote-card-tag">✓ Your vote</span>` : isSelected ? `<span class="coach-vote-card-tag">Selected</span>` : "";
        return `<button type="button" class="${cls}" data-id="${c.id}" aria-pressed="${isSelected || voted}" ${disabled ? "disabled" : ""}>
            ${tag}
            <img src="${artUrl(c.id)}" alt="" loading="lazy" />
            <span class="coach-vote-card-name">${escapeHtml(c.name)}</span>
            <span class="coach-vote-card-number">#${String(c.id).padStart(4, "0")}</span>
          </button>`;
      })
      .join("");

    const actionsHtml = interactive
      ? `
        <p class="coach-vote-warning">⚠️ <strong>Votes are final.</strong> Once you save, you can't undo or change them.</p>
        <div class="coach-vote-actions">
          <button type="button" class="btn" id="coach-vote-save" ${selected.size && !saving ? "" : "disabled"}>${
            saving ? "Saving…" : `Save ${selected.size || ""} vote${selected.size === 1 ? "" : "s"}`
          }</button>
          <button type="button" class="btn btn-secondary" id="coach-vote-clear" ${selected.size && !saving ? "" : "disabled"}>Clear selection</button>
        </div>`
      : "";

    bodyEl.innerHTML = `
      <div class="coach-vote-layout">
        <div class="coach-vote-main">
          <p class="coach-vote-status">${statusLine}</p>
          ${message ? `<p class="status${message.isError ? " error" : ""}">${escapeHtml(message.text)}</p>` : ""}
          <div class="coach-vote-grid">${cardsHtml}</div>
          ${actionsHtml}
        </div>
        <aside class="coach-vote-side">
          ${leaderboardHtml()}
          ${adminStatusHtml()}
        </aside>
      </div>
    `;

    bodyEl.querySelectorAll(".coach-vote-card:not([disabled])").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.id);
        if (selected.has(id)) selected.delete(id);
        else if (selected.size < votesLeft()) selected.add(id);
        message = null;
        render();
      });
    });
    const saveBtn = document.getElementById("coach-vote-save");
    if (saveBtn) saveBtn.addEventListener("click", saveVotes);
    const clearBtn = document.getElementById("coach-vote-clear");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        selected.clear();
        message = null;
        render();
      });
    }
  };

  async function saveVotes() {
    if (!selected.size || saving || !canVote()) return;
    const picksToAdd = [...selected].sort((a, b) => a - b);
    const names = picksToAdd.map((id) => candidateById.get(id).name).join(", ");
    const remainingAfter = votesLeft() - picksToAdd.length;
    const ok = window.confirm(
      `Save ${picksToAdd.length} vote${picksToAdd.length === 1 ? "" : "s"} for: ${names}?\n\n` +
        `This is final - saved votes can't be undone or changed.` +
        (remainingAfter > 0 ? `\nYou'll still have ${remainingAfter} vote${remainingAfter === 1 ? "" : "s"} left to use later.` : "")
    );
    if (!ok) return;

    saving = true;
    message = null;
    render();
    const ref = db.collection("coachVotes").doc(currentUser.uid);
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const existing = snap.exists ? snap.data().picks || [] : [];
        const merged = [...new Set([...existing, ...picksToAdd])].sort((a, b) => a - b);
        if (merged.length > MAX_VOTES) throw new Error(`That would be more than ${MAX_VOTES} votes.`);
        tx.set(ref, { uid: currentUser.uid, picks: merged, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      });
      selected.clear();
      message = { text: "Votes saved - thanks for voting!", isError: false };
    } catch (error) {
      message = { text: `Couldn't save your votes: ${error.message}`, isError: true };
    }
    saving = false;
    render();
  }

  const openModal = () => {
    hideReminder();
    modalEl.hidden = false;
    message = null;
    render();
  };
  const closeModal = () => {
    modalEl.hidden = true;
    if (location.hash === HASH) history.replaceState(null, "", location.pathname + location.search);
  };

  document.getElementById("coach-vote-close").addEventListener("click", closeModal);
  modalEl.addEventListener("click", (event) => {
    if (event.target === modalEl) closeModal();
  });
  window.addEventListener("hashchange", () => {
    if (location.hash === HASH) openModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!modalEl.hidden) closeModal();
    else if (!reminderEl.hidden) hideReminder();
  });
  if (homeBtnEl) {
    homeBtnEl.addEventListener("click", (event) => {
      event.preventDefault();
      if (location.hash === HASH) openModal();
      else location.hash = HASH.slice(1);
    });
  }
  if (location.hash === HASH) openModal();

  // --- League Home button: hidden when signed out, glows while you still
  // have votes to cast. ---

  function updateHomeButton() {
    if (!homeBtnEl) return;
    homeBtnEl.hidden = !currentUser;
    homeBtnEl.classList.toggle("coach-vote-btn--glow", allLoaded() && canVote());
  }

  // --- Once-per-session reminder ---

  const reminderKey = () => `coachVoteReminderShown:${currentUser.uid}`;

  function hideReminder() {
    reminderEl.hidden = true;
  }

  const maybeShowReminder = () => {
    if (!currentUser || !allLoaded() || !canVote() || !modalEl.hidden) return;
    try {
      if (sessionStorage.getItem(reminderKey())) return;
      sessionStorage.setItem(reminderKey(), "1");
    } catch (error) {
      // Storage blocked - show it anyway, just can't remember it.
    }
    const left = votesLeft();
    reminderTextEl.textContent =
      left === MAX_VOTES
        ? `Help choose the ${FINALISTS} Legendary coaches for the playoffs - you have ${MAX_VOTES} votes to cast before the regular season ends.`
        : `You still have ${left} of your ${MAX_VOTES} votes left to help choose the ${FINALISTS} Legendary coaches for the playoffs.`;
    reminderEl.hidden = false;
  };

  document.getElementById("coach-vote-reminder-close").addEventListener("click", hideReminder);
  reminderEl.addEventListener("click", (event) => {
    if (event.target === reminderEl) hideReminder();
  });
  // Already on League Home: open the popup in place instead of reloading.
  document.getElementById("coach-vote-reminder-link").addEventListener("click", (event) => {
    if (!homeBtnEl) return;
    event.preventDefault();
    hideReminder();
    if (location.hash === HASH) openModal();
    else location.hash = HASH.slice(1);
  });

  // --- Data ---

  const onData = () => {
    render();
    maybeShowReminder();
  };

  auth.onAuthStateChanged((user) => {
    unsubscribers.forEach((u) => u());
    unsubscribers = [];
    currentUser = user;
    teamsByUid = new Map();
    ballots = new Map();
    matchups = [];
    loaded = { teams: false, ballots: false, matchups: false };
    loadError = null;
    selected.clear();
    hideReminder();
    if (!user) {
      render();
      return;
    }
    render();

    unsubscribers.push(
      db.collection("teams").onSnapshot(
        (snapshot) => {
          teamsByUid = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
          loaded.teams = true;
          onData();
        },
        () => {}
      ),
      db.collection("coachVotes").onSnapshot(
        (snapshot) => {
          loadError = null;
          ballots = new Map(snapshot.docs.map((doc) => [doc.id, (doc.data().picks || []).map(Number)]));
          // Drop anything already saved (e.g. from another tab).
          myPicks().forEach((id) => selected.delete(id));
          loaded.ballots = true;
          onData();
        },
        (error) => {
          loadError = error.message;
          render();
        }
      ),
      db.collection("matchups").onSnapshot(
        (snapshot) => {
          matchups = snapshot.docs.map((doc) => doc.data());
          loaded.matchups = true;
          onData();
        },
        () => {}
      )
    );
  });
})();
