(function () {
  const config = window.siteConfig || {};
  const turnNameEl = document.getElementById("turn-tracker-name");
  const turnMetaEl = document.getElementById("turn-tracker-meta");
  const turnTrackerEl = document.getElementById("turn-tracker");
  const historyCardEl = document.getElementById("pick-history-card");
  const historyListEl = document.getElementById("pick-history-list");
  const searchCardEl = document.getElementById("picker-search-card");
  const searchEl = document.getElementById("picker-search");
  const pickerStatusEl = document.getElementById("picker-status");
  const gridEl = document.getElementById("picker-grid");
  const modalEl = document.getElementById("slot-picker-modal");
  const modalNameEl = document.getElementById("slot-picker-pokemon-name");
  const modalGridEl = document.getElementById("slot-picker-grid");
  const modalMessageEl = document.getElementById("slot-picker-message");
  const modalCancelEl = document.getElementById("slot-picker-cancel");

  if (!gridEl) return;

  const escapeHtml = (value) => {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  if (!config.firebaseConfig || config.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") {
    turnNameEl.textContent = "Not configured";
    turnMetaEl.textContent = "Fantasy League is not configured yet.";
    return;
  }

  firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const positions = config.pokemonPositions || [];

  // --- PokeAPI list/detail caching (duplicated from pokemon-dex.js by this
  // repo's one-self-contained-file-per-page convention). ---

  const readCache = (key, ttlMs) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.fetchedAt > ttlMs) return null;
      return parsed.data;
    } catch (error) {
      return null;
    }
  };

  const writeCache = (key, data) => {
    try {
      localStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), data }));
    } catch (error) {
      // Non-fatal.
    }
  };

  const listTtl = config.pokemonListCacheTtlMs || 30 * 24 * 60 * 60 * 1000;
  const detailTtl = config.pokemonDetailCacheTtlMs || 90 * 24 * 60 * 60 * 1000;
  const apiBase = config.pokeApiBaseUrl || "https://pokeapi.co/api/v2";

  const fetchList = async () => {
    const cached = readCache("pokedex:list:v1", listTtl);
    if (cached) return cached;
    const response = await fetch(`${apiBase}/pokemon?limit=1025`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to load Pokédex list (${response.status})`);
    const payload = await response.json();
    const list = payload.results
      .map((entry) => {
        const match = entry.url.match(/\/pokemon\/(\d+)\/?$/);
        return match ? { id: Number(match[1]), name: entry.name } : null;
      })
      .filter(Boolean);
    writeCache("pokedex:list:v1", list);
    return list;
  };

  const fetchDetail = async (id) => {
    const cacheKey = `pokedex:detail:${id}:v1`;
    const cached = readCache(cacheKey, detailTtl);
    if (cached) return cached;
    const response = await fetch(`${apiBase}/pokemon/${id}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to load Pokémon #${id} (${response.status})`);
    const payload = await response.json();
    const detail = {
      id,
      name: payload.name,
      sprite: payload.sprites?.front_default || "",
      types: (payload.types || []).map((t) => t.type.name),
    };
    writeCache(cacheKey, detail);
    return detail;
  };

  const detailObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const card = entry.target;
        detailObserver.unobserve(card);
        loadCardDetail(card);
      });
    },
    { rootMargin: "200px" }
  );

  const loadCardDetail = async (card) => {
    const id = Number(card.dataset.id);
    try {
      const detail = await fetchDetail(id);
      const spriteEl = card.querySelector(".poke-sprite");
      if (spriteEl && detail.sprite) spriteEl.src = detail.sprite;
      const typesEl = card.querySelector(".poke-card-types");
      if (typesEl) {
        typesEl.innerHTML = detail.types
          .map((type) => `<span class="type-badge type-badge--${escapeHtml(type)}">${escapeHtml(type)}</span>`)
          .join("");
      }
    } catch (error) {
      // Leave placeholder card; a reload will retry.
    }
  };

  // --- League state ---

  let fullList = [];
  let draftState = null;
  let teamsByUid = new Map();
  let draftedMap = new Map();
  let currentUser = null;

  const myTurn = () => draftState && draftState.status === "drafting" && currentUser && draftState.currentUid === currentUser.uid;

  const renderTurnTracker = () => {
    turnTrackerEl.classList.toggle("draft-turn-tracker--mine", Boolean(myTurn()));

    if (!draftState) {
      turnNameEl.textContent = "Draft not set up yet";
      turnMetaEl.textContent = "";
      return;
    }
    if (draftState.status === "pending") {
      turnNameEl.textContent = "Draft hasn't started";
      turnMetaEl.innerHTML = `Head to <a href="pokemon-league.html">League Home</a> to start it once enough managers have joined.`;
      return;
    }
    if (draftState.status === "complete") {
      turnNameEl.textContent = "Draft complete";
      turnMetaEl.innerHTML = `See the final rosters on the <a href="pokemon-teams.html">Rosters</a> page.`;
      return;
    }

    const total = draftState.pickOrder.length;
    const pickNumber = draftState.currentPickIndex + 1;
    const onTheClockName = teamsByUid.get(draftState.currentUid)?.teamName || "Unknown manager";
    turnNameEl.textContent = myTurn() ? "You're on the clock!" : `On the clock: ${onTheClockName}`;
    turnMetaEl.textContent = `Round ${draftState.currentRound} · Pick ${pickNumber} of ${total}`;
  };

  const renderPickHistory = (picks) => {
    historyCardEl.hidden = !picks.length;
    historyListEl.innerHTML = picks
      .slice()
      .reverse()
      .map(
        (pick) => `<li class="agenda-item"><div class="agenda-item-main"><span class="agenda-item-date">Pick ${pick.pickNumber} · ${escapeHtml(
          pick.slot
        )}</span><span class="agenda-item-name">${escapeHtml(pick.pokemonName)} — ${escapeHtml(pick.teamName)}</span></div></li>`
      )
      .join("");
  };

  const applyPickableState = () => {
    gridEl.querySelectorAll(".poke-card").forEach((card) => {
      const id = Number(card.dataset.id);
      const drafted = draftedMap.get(id);
      const ribbonEl = card.querySelector(".poke-card-drafted-by");
      if (drafted) {
        card.classList.add("poke-card--drafted");
        card.classList.remove("poke-card--pickable");
        if (!ribbonEl) {
          const ribbon = document.createElement("p");
          ribbon.className = "poke-card-drafted-by";
          ribbon.textContent = `Drafted by ${drafted.teamName}`;
          card.appendChild(ribbon);
        }
      } else {
        card.classList.remove("poke-card--drafted");
        if (ribbonEl) ribbonEl.remove();
        card.classList.toggle("poke-card--pickable", Boolean(myTurn()));
      }
    });
  };

  const renderPickerGrid = (entries) => {
    gridEl.innerHTML = entries
      .map(
        (entry) => `
          <article class="card poke-card" data-id="${entry.id}" data-name="${escapeHtml(entry.name)}">
            <span class="poke-card-number">#${String(entry.id).padStart(4, "0")}</span>
            <img class="poke-sprite" alt="${escapeHtml(entry.name)}" loading="lazy" />
            <span class="poke-card-name">${escapeHtml(entry.name)}</span>
            <div class="poke-card-types"></div>
          </article>
        `
      )
      .join("");
    gridEl.querySelectorAll(".poke-card").forEach((card) => {
      detailObserver.observe(card);
      card.addEventListener("click", () => {
        if (!card.classList.contains("poke-card--pickable")) return;
        openSlotPicker(Number(card.dataset.id), card.dataset.name);
      });
    });
    applyPickableState();
  };

  let searchDebounce = null;
  const applySearch = () => {
    const query = searchEl.value.trim().toLowerCase();
    const filtered = query ? fullList.filter((entry) => entry.name.includes(query)) : fullList;
    renderPickerGrid(filtered.slice(0, 500));
  };

  searchEl.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(applySearch, 150);
  });

  // --- Slot picker modal ---

  let pendingPick = null;

  const openSlotPicker = (pokemonId, pokemonName) => {
    const myTeam = currentUser && teamsByUid.get(currentUser.uid);
    if (!myTeam) return;
    pendingPick = { pokemonId, pokemonName };
    modalNameEl.textContent = pokemonName;
    modalMessageEl.hidden = true;
    modalGridEl.innerHTML = positions
      .map((position) => {
        const filled = myTeam.slots && myTeam.slots[position];
        return `<button type="button" class="slot-picker-slot" data-slot="${escapeHtml(position)}" ${filled ? "disabled" : ""}>
                  <span class="slot-picker-slot-position">${escapeHtml(position)}</span>
                  <span class="slot-picker-slot-value">${filled ? escapeHtml(filled.pokemonName) : "— empty —"}</span>
                </button>`;
      })
      .join("");
    modalGridEl.querySelectorAll(".slot-picker-slot").forEach((btn) => {
      btn.addEventListener("click", () => makePick(btn.dataset.slot));
    });
    modalEl.hidden = false;
  };

  const closeSlotPicker = () => {
    modalEl.hidden = true;
    pendingPick = null;
  };

  modalCancelEl.addEventListener("click", closeSlotPicker);

  // --- The pick transaction ---

  async function makePick(slot) {
    if (!pendingPick || !currentUser) return;
    const { pokemonId, pokemonName } = pendingPick;
    const showError = (text) => {
      modalMessageEl.hidden = false;
      modalMessageEl.className = "status error";
      modalMessageEl.textContent = text;
    };

    const stateRef = db.collection("draftState").doc("current");
    const teamRef = db.collection("teams").doc(currentUser.uid);
    const draftedRef = db.collection("draftedPokemon").doc(String(pokemonId));

    try {
      await db.runTransaction(async (tx) => {
        const [stateSnap, teamSnap, draftedSnap] = await Promise.all([
          tx.get(stateRef),
          tx.get(teamRef),
          tx.get(draftedRef),
        ]);

        const state = stateSnap.data();
        if (!state || state.status !== "drafting") throw new Error("The draft isn't active right now.");
        if (state.currentUid !== currentUser.uid) throw new Error("It's not your turn.");

        const team = teamSnap.data();
        if (!team || !team.slots || team.slots[slot]) throw new Error("That slot is already filled.");

        if (draftedSnap.exists) throw new Error("That Pokémon was just drafted by someone else.");

        const pickNumber = state.currentPickIndex + 1;
        const nextIndex = state.currentPickIndex + 1;
        const nextUid = nextIndex < state.pickOrder.length ? state.pickOrder[nextIndex] : null;
        const nextRound = Math.floor(nextIndex / state.participants.length) + 1;

        tx.set(draftedRef, {
          pokemonId,
          pokemonName,
          uid: currentUser.uid,
          teamName: team.teamName,
          slot,
          pickNumber,
          pickedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });

        tx.update(teamRef, { [`slots.${slot}`]: { pokemonId, pokemonName, pickNumber } });

        tx.set(db.collection("draftPicks").doc(String(pickNumber).padStart(4, "0")), {
          pickNumber,
          round: state.currentRound,
          uid: currentUser.uid,
          teamName: team.teamName,
          pokemonId,
          pokemonName,
          slot,
          pickedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });

        tx.update(stateRef, {
          currentPickIndex: nextIndex,
          currentUid: nextUid,
          currentRound: nextRound,
          status: nextUid ? "drafting" : "complete",
          completedAt: nextUid ? null : firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
      closeSlotPicker();
    } catch (error) {
      showError(error.message);
    }
  }

  // --- Live listeners ---

  db.collection("teams").onSnapshot(
    (snapshot) => {
      teamsByUid = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
      renderTurnTracker();
      applyPickableState();
    },
    () => {}
  );

  db.collection("draftedPokemon").onSnapshot(
    (snapshot) => {
      draftedMap = new Map();
      snapshot.forEach((doc) => draftedMap.set(Number(doc.id), doc.data()));
      applyPickableState();
    },
    () => {}
  );

  db.collection("draftPicks")
    .orderBy("pickNumber")
    .onSnapshot(
      (snapshot) => renderPickHistory(snapshot.docs.map((doc) => doc.data())),
      () => {}
    );

  db.collection("draftState")
    .doc("current")
    .onSnapshot(
      (doc) => {
        draftState = doc.exists ? doc.data() : null;
        const active = draftState && draftState.status !== "pending";
        searchCardEl.hidden = !active;
        gridEl.hidden = !active;
        renderTurnTracker();
        applyPickableState();
      },
      (error) => {
        turnNameEl.textContent = "Unable to load draft status";
        turnMetaEl.textContent = error.message;
      }
    );

  auth.onAuthStateChanged(async (user) => {
    currentUser = user;
    renderTurnTracker();
    if (!user) {
      searchCardEl.hidden = true;
      gridEl.hidden = true;
      pickerStatusEl.hidden = false;
      pickerStatusEl.className = "status";
      pickerStatusEl.innerHTML = `Sign in on <a href="pokemon-league.html">League Home</a> to view and join the draft.`;
      return;
    }
    pickerStatusEl.hidden = true;

    if (!fullList.length) {
      try {
        fullList = await fetchList();
        applySearch();
      } catch (error) {
        pickerStatusEl.hidden = false;
        pickerStatusEl.className = "status error";
        pickerStatusEl.textContent = `Unable to load the Pokédex. ${error.message}`;
      }
    } else {
      applyPickableState();
    }
  });
})();
