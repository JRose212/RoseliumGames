(function () {
  const config = window.siteConfig || {};
  const statusEl = document.getElementById("dex-status");
  const pickStatusEl = document.getElementById("dex-pick-status");
  const gridEl = document.getElementById("dex-grid");
  const searchEl = document.getElementById("dex-search");
  const typeFilterEl = document.getElementById("dex-type-filter");
  const playableFilterEl = document.getElementById("dex-playable-filter");
  const addModalEl = document.getElementById("dex-add-modal");
  const addModalNameEl = document.getElementById("dex-add-pokemon-name");
  const addModalMessageEl = document.getElementById("dex-add-message");
  const addModalGridEl = document.getElementById("dex-add-slot-grid");
  const addModalConfirmEl = document.getElementById("dex-add-confirm-btn");
  const addModalCancelEl = document.getElementById("dex-add-cancel-btn");
  const legendaryIds = new Set(config.legendaryPokemonIds || []);
  const positions = config.pokemonPositions || [];
  const positionLabels = config.positionLabels || {};

  if (!gridEl) return;

  const escapeHtml = (value) => {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

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
      // localStorage can be full/unavailable (private browsing); non-fatal.
    }
  };

  const listTtl = config.pokemonListCacheTtlMs || 30 * 24 * 60 * 60 * 1000;
  const detailTtl = config.pokemonDetailCacheTtlMs || 90 * 24 * 60 * 60 * 1000;
  const apiBase = config.pokeApiBaseUrl || "https://pokeapi.co/api/v2";

  // The 1025 species plus config.regionalForms, each form placed right
  // after its regular version (dexNumber = the base species' number).
  const regionalForms = (config.regionalForms || []).map(([id, dexNumber, name]) => ({ id, dexNumber, name }));
  const withRegionalForms = (list) =>
    [...list, ...regionalForms].sort((a, b) => (a.dexNumber || a.id) - (b.dexNumber || b.id) || a.id - b.id);

  const fetchList = async () => withRegionalForms(await fetchSpeciesList());

  const fetchSpeciesList = async () => {
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

  const fetchTypeMemberIds = async (typeName) => {
    const cacheKey = `pokedex:type:${typeName}:v1`;
    const cached = readCache(cacheKey, listTtl);
    if (cached) return new Set(cached);
    const response = await fetch(`${apiBase}/type/${typeName}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Unable to load type "${typeName}" (${response.status})`);
    const payload = await response.json();
    const ids = payload.pokemon
      .map((entry) => {
        const match = entry.pokemon.url.match(/\/pokemon\/(\d+)\/?$/);
        return match ? Number(match[1]) : null;
      })
      .filter(Boolean);
    writeCache(cacheKey, ids);
    return new Set(ids);
  };

  // --- Firebase: playable list, picks switch, my roster ---

  let db = null;
  let auth = null;
  let currentUser = null;
  let myTeam = null;
  let leagueSettings = null;

  const firebaseReady = Boolean(config.firebaseConfig && config.firebaseConfig.apiKey !== "YOUR_FIREBASE_API_KEY");
  if (firebaseReady) {
    try {
      firebase.initializeApp(config.firebaseConfig);
      db = firebase.firestore();
      auth = firebase.auth();
    } catch (error) {
      db = null;
      auth = null;
    }
  }

  const isRealAdmin = () =>
    Boolean(currentUser && config.adminUid && config.adminUid !== "YOUR_ADMIN_UID" && currentUser.uid === config.adminUid);
  // Admin Mode toggle (pokemon-admin-toggle.js) - only hides admin-only UI.
  const isAdmin = () => isRealAdmin() && localStorage.getItem(`adminViewMode:${currentUser.uid}`) !== "user";

  // The admin, or an account given just this one job in config.js.
  const canEditPlayable = () =>
    isAdmin() || Boolean(currentUser && (config.playableEditorUids || []).includes(currentUser.uid));

  // Every Pokemon starts playable except Legendaries/Mythicals; the admin's
  // per-Pokemon overrides (leagueSettings/current.playable) win.
  const isPlayable = (id) => {
    const overrides = (leagueSettings && leagueSettings.playable) || {};
    const override = overrides[String(id)];
    return typeof override === "boolean" ? override : !legendaryIds.has(id);
  };

  const picksOpen = () => Boolean(leagueSettings && leagueSettings.rosterPicksOpen);
  const isRosterLocked = () => Boolean(leagueSettings && leagueSettings.rostersLocked);
  const canPick = () => Boolean(currentUser && myTeam && picksOpen() && !isRosterLocked());

  const renderPickStatus = () => {
    if (!pickStatusEl) return;
    if (!currentUser || !myTeam) {
      pickStatusEl.hidden = true;
      return;
    }
    pickStatusEl.hidden = false;
    pickStatusEl.className = "status";
    if (!picksOpen()) pickStatusEl.textContent = "Roster picks aren't open yet - browse away, and the admin will open them soon.";
    else if (isRosterLocked()) pickStatusEl.textContent = "Rosters are locked right now - come back once the admin unlocks them to pick.";
    else pickStatusEl.textContent = "Tap any playable Pokémon to put it on your team.";
  };

  const cardBadgeHtml = (id) =>
    isPlayable(id)
      ? `<p class="pp-playable-badge pp-playable-badge--yes">Playable</p>`
      : `<p class="pp-playable-badge pp-playable-badge--no">${legendaryIds.has(id) ? "Legendary · " : ""}Not playable</p>`;

  const applyOverlay = () => {
    const admin = canEditPlayable();
    gridEl.querySelectorAll(".poke-card").forEach((card) => {
      const id = Number(card.dataset.id);
      const playable = isPlayable(id);
      card.classList.toggle("poke-card--unplayable", !playable);
      card.classList.toggle("poke-card--pickable", playable && canPick());

      let badgeArea = card.querySelector(".pp-card-badge-area");
      if (!badgeArea) {
        badgeArea = document.createElement("div");
        badgeArea.className = "pp-card-badge-area";
        card.appendChild(badgeArea);
      }
      badgeArea.innerHTML =
        cardBadgeHtml(id) +
        (admin
          ? `<button type="button" class="btn btn-secondary pp-playable-toggle" data-id="${id}" data-playable="${playable}">${
              playable ? "Make not playable" : "Make playable"
            }</button>`
          : "");
      const toggle = badgeArea.querySelector(".pp-playable-toggle");
      if (toggle) {
        toggle.addEventListener("click", (event) => {
          event.stopPropagation();
          setPlayable(id, !playable);
        });
      }
    });
    renderSelectionUI();
    renderPickStatus();
  };

  async function setPlayable(id, playable) {
    try {
      await db
        .collection("leagueSettings")
        .doc("current")
        .set({ playable: { [String(id)]: playable } }, { merge: true });
    } catch (error) {
      window.alert(`Unable to update: ${error.message}`);
    }
  }

  if (db && auth) {
    let unsubscribers = [];

    auth.onAuthStateChanged((user) => {
      currentUser = user;
      unsubscribers.forEach((u) => u());
      unsubscribers = [];

      if (!user) {
        myTeam = null;
        leagueSettings = null;
        clearSelection();
        applyOverlay();
        return;
      }

      unsubscribers.push(
        db
          .collection("teams")
          .doc(user.uid)
          .onSnapshot((doc) => {
            myTeam = doc.exists ? doc.data() : null;
            applyOverlay();
          }, () => {})
      );

      unsubscribers.push(
        db
          .collection("leagueSettings")
          .doc("current")
          .onSnapshot((doc) => {
            leagueSettings = doc.exists ? doc.data() : null;
            // The playable filter depends on this, so re-filter too.
            if (playableFilterEl && playableFilterEl.value) applySearch();
            else applyOverlay();
          }, () => {})
      );
    });
  }

  // --- Click a playable card to select it, then "Put on My Team" opens
  // the slot chooser (same click-then-confirm pattern as the other
  // leagues' free agency). ---

  let selectedId = null;
  let selectedName = null;

  const clearSelection = () => {
    selectedId = null;
    selectedName = null;
    gridEl.querySelectorAll(".poke-card--selected").forEach((el) => {
      el.classList.remove("poke-card--selected");
      const btn = el.querySelector(".poke-card-draft-btn");
      if (btn) btn.remove();
    });
  };

  function renderSelectionUI() {
    if (selectedId === null) return;
    const card = gridEl.querySelector(`.poke-card[data-id="${selectedId}"]`);
    if (!card || !card.classList.contains("poke-card--pickable")) {
      clearSelection();
      return;
    }
    card.classList.add("poke-card--selected");
    if (!card.querySelector(".poke-card-draft-btn")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn poke-card-draft-btn";
      btn.textContent = "Put on My Team";
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        openAddModal(selectedId, selectedName);
      });
      card.appendChild(btn);
    }
  }

  const selectCard = (id, name) => {
    if (selectedId === id) {
      clearSelection();
      return;
    }
    clearSelection();
    selectedId = id;
    selectedName = name;
    renderSelectionUI();
  };

  let pendingAdd = null;

  const showAddMessage = (text, isError) => {
    addModalMessageEl.hidden = false;
    addModalMessageEl.className = `status${isError ? " error" : ""}`;
    addModalMessageEl.textContent = text;
  };

  const openAddModal = (pokemonId, pokemonName) => {
    if (!myTeam) return;
    const slots = myTeam.slots || {};
    pendingAdd = { pokemonId, pokemonName, slot: null };
    addModalNameEl.textContent = pokemonName;
    addModalMessageEl.hidden = true;
    addModalConfirmEl.disabled = true;
    addModalGridEl.innerHTML = positions
      .map((position) => {
        const filled = slots[position];
        return `<button type="button" class="slot-picker-slot" data-slot="${escapeHtml(position)}">
                  <span class="slot-picker-slot-position">${escapeHtml(positionLabels[position] || position)}</span>
                  <span class="slot-picker-slot-value">${filled ? `Replace ${escapeHtml(filled.pokemonName)}` : "— empty —"}</span>
                </button>`;
      })
      .join("");
    addModalGridEl.querySelectorAll(".slot-picker-slot").forEach((btn) => {
      btn.addEventListener("click", () => {
        addModalGridEl.querySelectorAll(".slot-picker-slot--selected").forEach((el) => el.classList.remove("slot-picker-slot--selected"));
        btn.classList.add("slot-picker-slot--selected");
        pendingAdd.slot = btn.dataset.slot;
        addModalConfirmEl.disabled = false;
      });
    });
    addModalEl.hidden = false;
  };

  const closeAddModal = () => {
    addModalEl.hidden = true;
    pendingAdd = null;
  };

  addModalCancelEl.addEventListener("click", closeAddModal);
  addModalEl.addEventListener("click", (event) => {
    if (event.target === addModalEl) closeAddModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !addModalEl.hidden) closeAddModal();
  });

  async function confirmAdd() {
    if (!pendingAdd || !pendingAdd.slot || !currentUser) return;
    const { pokemonId, pokemonName, slot } = pendingAdd;
    if (!canPick()) {
      showAddMessage(isRosterLocked() ? "Rosters are locked right now." : "Roster picks aren't open right now.", true);
      return;
    }
    if (!isPlayable(pokemonId)) {
      showAddMessage(`${pokemonName} isn't playable in this league.`, true);
      return;
    }
    try {
      await db.collection("teams").doc(currentUser.uid).update({ [`slots.${slot}`]: { pokemonId, pokemonName } });
      closeAddModal();
      clearSelection();
    } catch (error) {
      showAddMessage(error.message, true);
    }
  }

  addModalConfirmEl.addEventListener("click", confirmAdd);

  // --- Grid ---

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
      if (dimensionsEl) dimensionsEl.textContent = formatImperial(detail.heightM, detail.weightKg);
    } catch (error) {
      // Leave the placeholder card as-is; a reload retries.
    }
  };

  const renderGrid = (entries) => {
    gridEl.innerHTML = entries
      .map(
        (entry) => `
          <article class="card poke-card" data-id="${entry.id}" data-name="${escapeHtml(entry.name)}">
            <span class="poke-card-number">#${String(entry.dexNumber || entry.id).padStart(4, "0")}</span>
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
        selectCard(Number(card.dataset.id), card.dataset.name);
      });
    });
    applyOverlay();
  };

  let fullList = [];
  let searchDebounce = null;
  let activeTypeIds = null; // null = no type filter active

  function applySearch() {
    const query = searchEl.value.trim().toLowerCase();
    let filtered = query ? fullList.filter((entry) => entry.name.includes(query)) : fullList;
    if (activeTypeIds) filtered = filtered.filter((entry) => activeTypeIds.has(entry.id));
    const playableFilter = playableFilterEl ? playableFilterEl.value : "";
    if (playableFilter === "yes") filtered = filtered.filter((entry) => isPlayable(entry.id));
    if (playableFilter === "no") filtered = filtered.filter((entry) => !isPlayable(entry.id));
    statusEl.hidden = true;
    renderGrid(filtered.slice(0, 500));
    if (filtered.length > 500) {
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.textContent = `Showing the first 500 of ${filtered.length} matches — refine your search to narrow it down.`;
    } else if (!filtered.length) {
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.textContent = "No Pokémon match those filters.";
    }
  }

  searchEl.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(applySearch, 150);
  });

  if (playableFilterEl) playableFilterEl.addEventListener("change", applySearch);

  typeFilterEl.addEventListener("change", async () => {
    const typeName = typeFilterEl.value;
    if (!typeName) {
      activeTypeIds = null;
      applySearch();
      return;
    }
    try {
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.textContent = `Loading ${typeName} type…`;
      activeTypeIds = await fetchTypeMemberIds(typeName);
      applySearch();
    } catch (error) {
      statusEl.hidden = false;
      statusEl.className = "status error";
      statusEl.textContent = `Unable to load that type. ${error.message}`;
    }
  });

  (async () => {
    try {
      fullList = await fetchList();
      statusEl.hidden = true;
      applySearch();
    } catch (error) {
      statusEl.hidden = false;
      statusEl.className = "status error";
      statusEl.textContent = `Unable to load the Pokédex. ${error.message}`;
    }
  })();
})();
