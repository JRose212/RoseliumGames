(function () {
  const config = window.siteConfig || {};
  const turnNameEl = document.getElementById("turn-tracker-name");
  const turnMetaEl = document.getElementById("turn-tracker-meta");
  const turnTrackerEl = document.getElementById("turn-tracker");
  const turnCountdownEl = document.getElementById("turn-tracker-countdown");
  const autodraftAreaEl = document.getElementById("autodraft-area");
  const searchCardEl = document.getElementById("picker-search-card");
  const searchEl = document.getElementById("picker-search");
  const pickerStatusEl = document.getElementById("picker-status");
  const gridEl = document.getElementById("picker-grid");
  const modalEl = document.getElementById("slot-picker-modal");
  const modalNameEl = document.getElementById("slot-picker-pokemon-name");
  const modalGridEl = document.getElementById("slot-picker-grid");
  const modalMessageEl = document.getElementById("slot-picker-message");
  const modalCancelEl = document.getElementById("slot-picker-cancel");
  const rankingsCardEl = document.getElementById("rankings-card");
  const rankingsCountEl = document.getElementById("rankings-count");
  const rankingsListEl = document.getElementById("rankings-list");
  const rankingsSearchEl = document.getElementById("rankings-search");
  const rankingsStatusEl = document.getElementById("rankings-status");
  const rankingsGridEl = document.getElementById("rankings-grid");

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
    // v2: added heightM/weightKg - must match the cache key version used by
    // pokemon-dex.js, since both pages share the same localStorage origin.
    const cacheKey = `pokedex:detail:${id}:v2`;
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
      heightM: payload.height / 10,
      weightKg: payload.weight / 10,
    };
    writeCache(cacheKey, detail);
    return detail;
  };

  // heightM/weightKg are stored metric (that's what PokeAPI returns), but
  // displayed in feet/inches and pounds.
  const formatImperial = (heightM, weightKg) => {
    const totalInches = Math.round(heightM * 39.3701);
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    const lbs = (weightKg * 2.20462).toFixed(1);
    return `${feet}'${inches}" · ${lbs} lbs`;
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
      const dimensionsEl = card.querySelector(".poke-card-dimensions");
      if (dimensionsEl) {
        dimensionsEl.textContent = formatImperial(detail.heightM, detail.weightKg);
      }
    } catch (error) {
      // Leave placeholder card; a reload will retry.
    }
  };

  // --- League state ---

  const MAX_RANKINGS = 30;
  let fullList = [];
  let draftState = null;
  let teamsByUid = new Map();
  let draftedMap = new Map();
  let currentUser = null;
  let myRankings = [];

  const nameForId = (id) => fullList.find((entry) => entry.id === id)?.name || `#${id}`;

  const newDeadline = () =>
    firebase.firestore.Timestamp.fromMillis(Date.now() + (config.autodraftTimeoutMs || 2 * 60 * 1000));

  const myTurn = () => draftState && draftState.status === "drafting" && currentUser && draftState.currentUid === currentUser.uid;

  // --- Sound effects (generated via Web Audio, no asset files needed) ---

  let audioCtx = null;
  const getAudioCtx = () => {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  };

  const beep = (freq, durationMs, volume) => {
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.value = volume;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
      osc.stop(ctx.currentTime + durationMs / 1000 + 0.02);
    } catch (error) {
      // Audio blocked/unavailable - non-fatal, the draft still works fine.
    }
  };

  const playDing = () => {
    beep(880, 280, 0.25);
    setTimeout(() => beep(1320, 220, 0.2), 130);
  };

  const playTick = () => beep(1000, 70, 0.12);

  // Pick/autodraft/skip events are posted into the shared league chat
  // (pokemon-chat.js renders them as italic system messages) instead of a
  // dedicated pick-history UI on this page.
  const postSystemMessage = (tx, text) => {
    tx.set(db.collection("chatMessages").doc(), {
      uid: currentUser.uid,
      system: true,
      text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  };

  const renderTurnTracker = () => {
    turnTrackerEl.classList.toggle("draft-turn-tracker--mine", Boolean(myTurn()));
    turnTrackerEl.classList.toggle("draft-turn-tracker--active", Boolean(draftState && draftState.status === "drafting"));

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

  // --- Turn countdown + autodraft trigger ---

  const renderCountdown = () => {
    if (!draftState || draftState.status !== "drafting" || !draftState.pickDeadlineAt) {
      turnCountdownEl.hidden = true;
      autodraftAreaEl.innerHTML = "";
      return;
    }
    const deadlineMillis = draftState.pickDeadlineAt.toMillis();
    const remainingMs = deadlineMillis - Date.now();
    turnCountdownEl.hidden = false;

    if (remainingMs > 0) {
      const seconds = Math.ceil(remainingMs / 1000);
      turnCountdownEl.textContent = `Time left: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
      autodraftAreaEl.innerHTML = "";
      return;
    }

    const onTheClockName = teamsByUid.get(draftState.currentUid)?.teamName || "this manager";
    turnCountdownEl.textContent = "Pick deadline passed.";
    if (!document.getElementById("autodraft-btn")) {
      autodraftAreaEl.innerHTML = `<button type="button" class="btn autodraft-btn" id="autodraft-btn">Autodraft for ${escapeHtml(
        onTheClockName
      )}</button><p class="status" id="autodraft-message" hidden></p>`;
      document.getElementById("autodraft-btn").addEventListener("click", autodraftPick);
    }
  };

  setInterval(renderCountdown, 1000);

  // Ticking sound that speeds up as the deadline approaches - a separate
  // self-rescheduling timer from the 1s visual countdown above, since the
  // tick cadence itself needs to go faster than once per second near the end.
  let tickTimeoutId = null;

  const stopTicking = () => {
    if (tickTimeoutId) {
      clearTimeout(tickTimeoutId);
      tickTimeoutId = null;
    }
  };

  const scheduleTick = () => {
    if (!draftState || draftState.status !== "drafting" || !draftState.pickDeadlineAt) {
      stopTicking();
      return;
    }
    const remainingMs = draftState.pickDeadlineAt.toMillis() - Date.now();
    if (remainingMs <= 0) {
      stopTicking();
      return;
    }
    // Only the manager actually on the clock hears the countdown ticking -
    // everyone else still sees the big visual countdown, just silently.
    if (myTurn()) playTick();
    const delay = remainingMs > 10000 ? 1000 : remainingMs > 5000 ? 500 : 250;
    tickTimeoutId = setTimeout(scheduleTick, Math.min(delay, remainingMs));
  };

  // --- Pre-draft rankings ---

  const renderRankingsList = () => {
    if (rankingsCountEl) rankingsCountEl.textContent = `${myRankings.length}/${MAX_RANKINGS}`;
    if (!myRankings.length) {
      rankingsListEl.innerHTML = `<li class="status">No Pokémon ranked yet.</li>`;
      return;
    }
    const canDraftFromList = Boolean(myTurn());
    rankingsListEl.innerHTML = myRankings
      .map(
        (id, index) => `
          <li class="ranking-item" data-id="${id}">
            <span class="ranking-item-rank">${index + 1}</span>
            <span class="ranking-item-name${canDraftFromList ? " ranking-item-name--pickable" : ""}" data-id="${id}" data-name="${escapeHtml(
          nameForId(id)
        )}" title="${canDraftFromList ? "Click to draft this Pokémon" : ""}">${escapeHtml(nameForId(id))}</span>
            <div class="ranking-item-actions">
              <button type="button" data-action="up" data-id="${id}" ${index === 0 ? "disabled" : ""}>▲</button>
              <button type="button" data-action="down" data-id="${id}" ${index === myRankings.length - 1 ? "disabled" : ""}>▼</button>
              <button type="button" data-action="remove" data-id="${id}">✕</button>
            </div>
          </li>
        `
      )
      .join("");
    rankingsListEl.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.id);
        const index = myRankings.indexOf(id);
        if (index === -1) return;
        if (btn.dataset.action === "remove") {
          myRankings.splice(index, 1);
        } else if (btn.dataset.action === "up" && index > 0) {
          [myRankings[index - 1], myRankings[index]] = [myRankings[index], myRankings[index - 1]];
        } else if (btn.dataset.action === "down" && index < myRankings.length - 1) {
          [myRankings[index + 1], myRankings[index]] = [myRankings[index], myRankings[index + 1]];
        }
        saveRankings();
      });
    });
    if (canDraftFromList) {
      rankingsListEl.querySelectorAll(".ranking-item-name--pickable").forEach((nameEl) => {
        nameEl.addEventListener("click", () => {
          selectForDraft(Number(nameEl.dataset.id), nameEl.dataset.name);
        });
      });
    }
    renderSelectionUI();
  };

  let rankingsStatusTimeout = null;
  const showRankingsStatus = (text, isError) => {
    rankingsStatusEl.hidden = false;
    rankingsStatusEl.className = `status${isError ? " error" : ""}`;
    rankingsStatusEl.textContent = text;
    clearTimeout(rankingsStatusTimeout);
    rankingsStatusTimeout = setTimeout(() => {
      rankingsStatusEl.hidden = true;
    }, 4000);
  };

  async function saveRankings() {
    if (!currentUser) return;
    try {
      await db.collection("predraftRankings").doc(currentUser.uid).set({
        uid: currentUser.uid,
        pokemonIds: myRankings,
      });
    } catch (error) {
      showRankingsStatus(error.message, true);
    }
  }

  // If a Pokemon on your private ranking gets drafted by someone else
  // before your own turn reaches it, drop it from your list automatically
  // so the list only ever shows what's still actually available.
  const pruneMyRankings = () => {
    if (!myRankings.length) return;
    const stillAvailable = myRankings.filter((id) => !draftedMap.has(id));
    if (stillAvailable.length === myRankings.length) return;
    myRankings = stillAvailable;
    renderRankingsList();
    applyRankingPickableState();
    saveRankings();
  };

  const applyRankingPickableState = () => {
    rankingsGridEl.querySelectorAll(".poke-card").forEach((card) => {
      const id = Number(card.dataset.id);
      const rankIndex = myRankings.indexOf(id);
      const ribbonEl = card.querySelector(".poke-card-drafted-by");
      if (rankIndex !== -1) {
        card.classList.add("poke-card--drafted");
        if (!ribbonEl) {
          const ribbon = document.createElement("p");
          ribbon.className = "poke-card-drafted-by";
          card.appendChild(ribbon);
        }
        card.querySelector(".poke-card-drafted-by").textContent = `Ranked #${rankIndex + 1}`;
      } else {
        card.classList.remove("poke-card--drafted");
        if (ribbonEl) ribbonEl.remove();
      }
    });
  };

  const renderRankingsGrid = (entries) => {
    rankingsGridEl.innerHTML = entries
      .map(
        (entry) => `
          <article class="card poke-card poke-card--pickable" data-id="${entry.id}" data-name="${escapeHtml(entry.name)}">
            <span class="poke-card-number">#${String(entry.id).padStart(4, "0")}</span>
            <img class="poke-sprite" alt="${escapeHtml(entry.name)}" loading="lazy" />
            <span class="poke-card-name">${escapeHtml(entry.name)}</span>
            <div class="poke-card-types"></div>
            <span class="poke-card-dimensions"></span>
          </article>
        `
      )
      .join("");
    rankingsGridEl.querySelectorAll(".poke-card").forEach((card) => {
      detailObserver.observe(card);
      card.addEventListener("click", () => {
        const id = Number(card.dataset.id);
        if (myRankings.includes(id)) return;
        if (myRankings.length >= MAX_RANKINGS) {
          showRankingsStatus(`You can only rank up to ${MAX_RANKINGS} Pokémon.`, true);
          return;
        }
        myRankings.push(id);
        renderRankingsList();
        applyRankingPickableState();
        saveRankings();
      });
    });
    applyRankingPickableState();
  };

  let rankingsSearchDebounce = null;
  const applyRankingsSearch = () => {
    const query = rankingsSearchEl.value.trim().toLowerCase();
    if (!query) {
      rankingsGridEl.innerHTML = "";
      return;
    }
    const filtered = fullList.filter((entry) => entry.name.includes(query));
    renderRankingsGrid(filtered.slice(0, 200));
  };

  rankingsSearchEl.addEventListener("input", () => {
    clearTimeout(rankingsSearchDebounce);
    rankingsSearchDebounce = setTimeout(applyRankingsSearch, 150);
  });

  // Click a pickable Pokemon - either in the live grid below or directly
  // in your own pre-draft rankings list - to select it (shows an inline
  // "Draft This Pokemon" confirm button wherever it's currently shown);
  // click again to change your mind. Only the confirm button actually
  // opens the slot-choice modal, so one accidental click can't start a
  // pick. Tracked by id/name rather than a DOM reference so it survives
  // either list re-rendering out from under it.
  let selectedPickId = null;
  let selectedPickName = null;

  const clearSelection = () => {
    selectedPickId = null;
    selectedPickName = null;
    document.querySelectorAll(".poke-card--selected, .ranking-item--selected").forEach((el) => {
      el.classList.remove("poke-card--selected", "ranking-item--selected");
      const btn = el.querySelector(".poke-card-draft-btn");
      if (btn) btn.remove();
    });
  };

  const renderSelectionUI = () => {
    if (selectedPickId === null) return;
    // Attach the confirm button to every place this Pokemon is currently
    // rendered (the live grid AND the rankings list, if both happen to
    // show it) rather than just the first match - otherwise selecting it
    // from the rankings list would only show the button on the grid card
    // below, defeating the point of not having to scroll to find it.
    const targets = [
      [gridEl.querySelector(`.poke-card[data-id="${selectedPickId}"]`), "poke-card--selected"],
      [rankingsListEl.querySelector(`.ranking-item[data-id="${selectedPickId}"]`), "ranking-item--selected"],
    ].filter(([el]) => el);

    if (!targets.length) {
      // No longer rendered anywhere (drafted, pruned, filtered out by
      // search) - the selection no longer makes sense.
      selectedPickId = null;
      selectedPickName = null;
      return;
    }

    targets.forEach(([el, selectedClass]) => {
      el.classList.add(selectedClass);
      if (!el.querySelector(".poke-card-draft-btn")) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn poke-card-draft-btn";
        btn.textContent = "Draft This Pokémon";
        btn.addEventListener("click", (event) => {
          event.stopPropagation();
          openSlotPicker(selectedPickId, selectedPickName);
        });
        el.appendChild(btn);
      }
    });
  };

  const selectForDraft = (id, name) => {
    if (selectedPickId === id) {
      clearSelection();
      return;
    }
    clearSelection();
    selectedPickId = id;
    selectedPickName = name;
    renderSelectionUI();
  };

  const applyPickableState = () => {
    if (!myTurn()) clearSelection();
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
            <span class="poke-card-dimensions"></span>
          </article>
        `
      )
      .join("");
    gridEl.querySelectorAll(".poke-card").forEach((card) => {
      detailObserver.observe(card);
      card.addEventListener("click", () => {
        if (!card.classList.contains("poke-card--pickable")) return;
        selectForDraft(Number(card.dataset.id), card.dataset.name);
      });
    });
    applyPickableState();
    renderSelectionUI();
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
    clearSelection();
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

        postSystemMessage(tx, `${team.teamName} drafted ${pokemonName} (${slot})`);

        tx.update(stateRef, {
          currentPickIndex: nextIndex,
          currentUid: nextUid,
          currentRound: nextRound,
          status: nextUid ? "drafting" : "complete",
          completedAt: nextUid ? null : firebase.firestore.FieldValue.serverTimestamp(),
          pickDeadlineAt: nextUid ? newDeadline() : null,
        });
      });
      closeSlotPicker();
    } catch (error) {
      showError(error.message);
    }
  }

  // --- Autodraft: triggered by any signed-in manager once the current
  // pick's deadline has passed. Fills the absent manager's highest-ranked
  // still-undrafted Pokemon into their first empty slot; if their ranking
  // is empty or exhausted, skips the pick entirely (slot stays blank until
  // they fill it later via free agency on the Rosters page). ---

  async function autodraftPick() {
    const messageEl = document.getElementById("autodraft-message");
    const showError = (text) => {
      if (!messageEl) return;
      messageEl.hidden = false;
      messageEl.className = "status error";
      messageEl.textContent = text;
    };

    const stateRef = db.collection("draftState").doc("current");

    try {
      // predraftRankings is read here, outside the transaction, rather
      // than via tx.get() inside it below - a manager's own ranking
      // changing mid-autodraft is an acceptable race (unlike the
      // uniqueness check further down, which does stay inside the
      // transaction).
      const preStateSnap = await stateRef.get();
      const preState = preStateSnap.data();
      if (!preState || preState.status !== "drafting") throw new Error("The draft isn't active right now.");
      const preTargetUid = preState.currentUid;
      const preRankingSnap = await db.collection("predraftRankings").doc(preTargetUid).get();
      const preRankedIds = (preRankingSnap.exists && preRankingSnap.data().pokemonIds) || [];

      await db.runTransaction(async (tx) => {
        const stateSnap = await tx.get(stateRef);
        const state = stateSnap.data();
        if (!state || state.status !== "drafting") throw new Error("The draft isn't active right now.");
        if (Date.now() <= state.pickDeadlineAt.toMillis()) throw new Error("The deadline hasn't passed yet.");

        const targetUid = state.currentUid;
        if (targetUid !== preTargetUid) throw new Error("The draft moved on - try again.");

        const teamRef = db.collection("teams").doc(targetUid);
        const teamSnap = await tx.get(teamRef);

        const team = teamSnap.data();
        if (!team || !team.slots) throw new Error("Team not found.");
        const openSlot = positions.find((position) => !team.slots[position]);

        const rankedIds = preRankedIds;
        let chosenId = null;
        for (const id of rankedIds) {
          const draftedSnap = await tx.get(db.collection("draftedPokemon").doc(String(id)));
          if (!draftedSnap.exists) {
            chosenId = id;
            break;
          }
        }

        const pickNumber = state.currentPickIndex + 1;
        const nextIndex = state.currentPickIndex + 1;
        const nextUid = nextIndex < state.pickOrder.length ? state.pickOrder[nextIndex] : null;
        const nextRound = Math.floor(nextIndex / state.participants.length) + 1;

        if (chosenId !== null && openSlot) {
          const pokemonName = nameForId(chosenId);
          const draftedRef = db.collection("draftedPokemon").doc(String(chosenId));

          tx.set(draftedRef, {
            pokemonId: chosenId,
            pokemonName,
            uid: targetUid,
            teamName: team.teamName,
            slot: openSlot,
            pickNumber,
            pickedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
          tx.update(teamRef, { [`slots.${openSlot}`]: { pokemonId: chosenId, pokemonName, pickNumber } });
          tx.set(db.collection("draftPicks").doc(String(pickNumber).padStart(4, "0")), {
            pickNumber,
            round: state.currentRound,
            uid: targetUid,
            teamName: team.teamName,
            pokemonId: chosenId,
            pokemonName,
            slot: openSlot,
            autodrafted: true,
            triggeredBy: currentUser.uid,
            pickedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
          postSystemMessage(tx, `${team.teamName} drafted ${pokemonName} (${openSlot}) — autodraft`);
        } else {
          // Nothing usable left on their list (or no open slot, which
          // shouldn't happen while drafting) - skip this pick entirely.
          tx.set(db.collection("draftPicks").doc(String(pickNumber).padStart(4, "0")), {
            pickNumber,
            round: state.currentRound,
            uid: targetUid,
            teamName: team.teamName,
            pokemonId: null,
            pokemonName: null,
            slot: null,
            autodrafted: true,
            skipped: true,
            triggeredBy: currentUser.uid,
            pickedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
          postSystemMessage(tx, `${team.teamName}'s pick was skipped (missed deadline)`);
        }

        tx.update(stateRef, {
          currentPickIndex: nextIndex,
          currentUid: nextUid,
          currentRound: nextRound,
          status: nextUid ? "drafting" : "complete",
          completedAt: nextUid ? null : firebase.firestore.FieldValue.serverTimestamp(),
          pickDeadlineAt: nextUid ? newDeadline() : null,
        });
      });
    } catch (error) {
      showError(error.message);
    }
  }

  // --- Live listeners ---
  //
  // These all require being signed in per the security rules. A listener
  // that errors out (e.g. because it started before auth had resolved)
  // doesn't retry on its own, so they're only (re)started once we actually
  // know the sign-in state, and torn down/restarted whenever it changes.

  let unsubscribeTeams = null;
  let unsubscribeDrafted = null;
  let unsubscribeDraftState = null;
  let lastCurrentUid = undefined;
  let lastDeadlineMillis = undefined;
  let unsubscribeMyRankings = null;

  const subscribeDraftRoom = () => {
    [unsubscribeTeams, unsubscribeDrafted, unsubscribeDraftState, unsubscribeMyRankings].forEach(
      (unsubscribe) => unsubscribe && unsubscribe()
    );
    unsubscribeTeams = unsubscribeDrafted = unsubscribeDraftState = unsubscribeMyRankings = null;

    if (!currentUser) {
      teamsByUid = new Map();
      draftedMap = new Map();
      draftState = null;
      myRankings = [];
      renderTurnTracker();
      return;
    }

    unsubscribeMyRankings = db
      .collection("predraftRankings")
      .doc(currentUser.uid)
      .onSnapshot(
        (doc) => {
          myRankings = (doc.exists && doc.data().pokemonIds) || [];
          renderRankingsList();
          applyRankingPickableState();
        },
        () => {}
      );

    unsubscribeTeams = db.collection("teams").onSnapshot(
      (snapshot) => {
        teamsByUid = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
        renderTurnTracker();
        applyPickableState();
      },
      () => {}
    );

    unsubscribeDrafted = db.collection("draftedPokemon").onSnapshot(
      (snapshot) => {
        draftedMap = new Map();
        snapshot.forEach((doc) => draftedMap.set(Number(doc.id), doc.data()));
        applyPickableState();
        pruneMyRankings();
      },
      () => {}
    );

    unsubscribeDraftState = db
      .collection("draftState")
      .doc("current")
      .onSnapshot(
        (doc) => {
          draftState = doc.exists ? doc.data() : null;
          const active = draftState && draftState.status !== "pending";
          searchCardEl.hidden = !active;
          gridEl.hidden = !active;

          const newUid = draftState ? draftState.currentUid : undefined;
          const newDeadlineMillis =
            draftState && draftState.pickDeadlineAt ? draftState.pickDeadlineAt.toMillis() : undefined;
          const turnChanged = lastCurrentUid !== undefined && newUid !== lastCurrentUid;
          const deadlineChanged = newDeadlineMillis !== lastDeadlineMillis;
          lastCurrentUid = newUid;
          lastDeadlineMillis = newDeadlineMillis;

          if (turnChanged && draftState && draftState.status === "drafting") playDing();
          if (deadlineChanged) {
            stopTicking();
            if (newDeadlineMillis) scheduleTick();
          }

          renderTurnTracker();
          applyPickableState();
          renderRankingsList();
        },
        (error) => {
          turnNameEl.textContent = "Unable to load draft status";
          turnMetaEl.textContent = error.message;
        }
      );
  };

  auth.onAuthStateChanged(async (user) => {
    currentUser = user;
    renderTurnTracker();
    subscribeDraftRoom();
    rankingsCardEl.hidden = !user;

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
        renderRankingsList();
      } catch (error) {
        pickerStatusEl.hidden = false;
        pickerStatusEl.className = "status error";
        pickerStatusEl.textContent = `Unable to load the Pokédex. ${error.message}`;
      }
    } else {
      applyPickableState();
      renderRankingsList();
    }
  });
})();
