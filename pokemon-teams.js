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

  if (!config.firebaseConfig || config.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") {
    statusEl.className = "status error";
    statusEl.textContent = "Fantasy League is not configured yet.";
    return;
  }

  firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const positions = config.pokemonPositions || [];

  const renderTeams = (teams) => {
    if (!teams.length) {
      listEl.innerHTML = "";
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.textContent = "No teams yet.";
      return;
    }
    statusEl.hidden = true;
    listEl.innerHTML = teams
      .map((team) => {
        const slots = team.slots || {};
        const slotCards = positions
          .map((position) => {
            const pick = slots[position];
            const inner = pick
              ? `<div class="roster-slot-filled">
                   <img src="${spriteUrl(pick.pokemonId)}" alt="${escapeHtml(pick.pokemonName)}" loading="lazy" />
                   <span class="roster-slot-filled-name">${escapeHtml(pick.pokemonName)}</span>
                 </div>`
              : `<span class="roster-slot-empty">— empty —</span>`;
            return `<article class="card roster-slot">
                      <span class="roster-slot-position">${escapeHtml(position)}</span>
                      ${inner}
                    </article>`;
          })
          .join("");
        return `<section class="card">
                  <h2>${escapeHtml(team.teamName || "Unnamed Team")}</h2>
                  <div class="rules-grid roster-slot-grid">${slotCards}</div>
                </section>`;
      })
      .join("");
  };

  let unsubscribe = null;

  auth.onAuthStateChanged((user) => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    if (!user) {
      listEl.innerHTML = "";
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.innerHTML = `Sign in on the <a href="pokemon-league.html">League Home</a> page to view rosters.`;
      return;
    }

    statusEl.hidden = false;
    statusEl.className = "status";
    statusEl.textContent = "Loading rosters…";

    unsubscribe = db
      .collection("teams")
      .orderBy("createdAt")
      .onSnapshot(
        (snapshot) => {
          renderTeams(snapshot.docs.map((doc) => doc.data()));
        },
        (error) => {
          statusEl.hidden = false;
          statusEl.className = "status error";
          statusEl.textContent = `Unable to load rosters: ${error.message}`;
        }
      );
  });
})();
