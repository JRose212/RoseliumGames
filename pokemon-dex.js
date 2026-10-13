(function () {
  const config = window.siteConfig || {};
  const statusEl = document.getElementById("dex-status");
  const faLimitStatusEl = document.getElementById("fa-limit-status");
  const gridEl = document.getElementById("dex-grid");
  const searchEl = document.getElementById("dex-search");
  const typeFilterEl = document.getElementById("dex-type-filter");
  const faModalEl = document.getElementById("fa-sign-modal");
  const faModalNameEl = document.getElementById("fa-sign-pokemon-name");
  const faModalMessageEl = document.getElementById("fa-sign-message");
  const faModalGridEl = document.getElementById("fa-sign-slot-grid");
  const faModalConfirmEl = document.getElementById("fa-sign-confirm-btn");
  const faModalCancelEl = document.getElementById("fa-sign-cancel-btn");
  const legendaryIds = new Set(config.legendaryPokemonIds || []);
  const positions = config.pokemonPositions || [];
  const MAX_SIGNINGS_PER_WEEK = 2;

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
    // v2: added heightM/weightKg - bumped so caches from before that existed
    // (missing those fields, served for up to 90 days otherwise) get refetched.
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

  // --- Firebase (drafted overlay + free agency) ---

  let db = null;
  let auth = null;
  let currentUser = null;
  let myTeam = null;
  let seasonState = null;
  let draftedMap = new Map();

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

  const seasonHasStarted = () => Boolean(seasonState);

  const signingsUsedThisWeek = () => {
    if (!myTeam || !seasonState) return 0;
    const fa = myTeam.freeAgency || {};
    return fa.week === seasonState.currentWeek ? fa.signings || 0 : 0;
  };

  const canSignFreeAgents = () => Boolean(currentUser && myTeam && seasonHasStarted());

  const isSignable = (id) => canSignFreeAgents() && !legendaryIds.has(id) && !draftedMap.has(id);

  const renderFaLimitStatus = () => {
    if (!faLimitStatusEl) return;
    if (!currentUser) {
      faLimitStatusEl.hidden = true;
      return;
    }
    if (!seasonHasStarted()) {
      faLimitStatusEl.hidden = false;
      faLimitStatusEl.className = "status";
      faLimitStatusEl.textContent = "Free agency opens once the season starts.";
      return;
    }
    const used = signingsUsedThisWeek();
    faLimitStatusEl.hidden = false;
    faLimitStatusEl.className = "status";
    faLimitStatusEl.textContent = `Free agent signings used this week: ${used}/${MAX_SIGNINGS_PER_WEEK}`;
  };

  const applyDraftedOverlay = () => {
    gridEl.querySelectorAll(".poke-card").forEach((card) => {
      const id = Number(card.dataset.id);
      const drafted = draftedMap.get(id);
      const existingRibbon = card.querySelector(".poke-card-drafted-by, .poke-card-legendary-badge");
      if (legendaryIds.has(id)) {
        card.classList.remove("poke-card--drafted", "poke-card--pickable");
        card.classList.add("poke-card--legendary");
        if (!existingRibbon || existingRibbon.className !== "poke-card-legendary-badge") {
          if (existingRibbon) existingRibbon.remove();
          const badge = document.createElement("p");
          badge.className = "poke-card-legendary-badge";
          badge.textContent = "Legendary";
          card.appendChild(badge);
        }
      } else if (drafted) {
        card.classList.remove("poke-card--legendary", "poke-card--pickable");
        card.classList.add("poke-card--drafted");
        if (!existingRibbon || existingRibbon.className !== "poke-card-drafted-by") {
          if (existingRibbon) existingRibbon.remove();
          const ribbon = document.createElement("p");
          ribbon.className = "poke-card-drafted-by";
          ribbon.textContent = `Drafted by ${drafted.teamName}`;
          card.appendChild(ribbon);
        }
      } else {
        card.classList.remove("poke-card--drafted", "poke-card--legendary");
        if (existingRibbon) existingRibbon.remove();
        card.classList.toggle("poke-card--pickable", canSignFreeAgents());
      }
    });
    renderSelectionUI();
    renderFaLimitStatus();
  };

  if (db && auth) {
    let unsubscribeDrafted = null;
    let unsubscribeTeam = null;
    let unsubscribeSeason = null;

    auth.onAuthStateChanged((user) => {
      currentUser = user;
      [unsubscribeDrafted, unsubscribeTeam, unsubscribeSeason].forEach((u) => u && u());
      unsubscribeDrafted = unsubscribeTeam = unsubscribeSeason = null;

      if (!user) {
        draftedMap = new Map();
        myTeam = null;
        seasonState = null;
        clearSelection();
        applyDraftedOverlay();
        return;
      }

      unsubscribeDrafted = db.collection("draftedPokemon").onSnapshot(
        (snapshot) => {
          draftedMap = new Map();
          snapshot.forEach((doc) => draftedMap.set(Number(doc.id), doc.data()));
          applyDraftedOverlay();
        },
        () => {}
      );

      unsubscribeTeam = db
        .collection("teams")
        .doc(user.uid)
        .onSnapshot(
          (doc) => {
            myTeam = doc.exists ? doc.data() : null;
            applyDraftedOverlay();
          },
          () => {}
        );

      unsubscribeSeason = db
        .collection("seasonState")
        .doc("current")
        .onSnapshot(
          (doc) => {
            seasonState = doc.exists ? doc.data() : null;
            applyDraftedOverlay();
          },
          () => {}
        );
    });
  }

  // --- Click-to-select-then-confirm, same pattern as the Draft Room's
  // live picker: clicking an eligible card shows an inline "Sign Free
  // Agent" button; only that button opens the drop-slot modal. ---

  let selectedSignId = null;
  let selectedSignName = null;

  const clearSelection = () => {
    selectedSignId = null;
    selectedSignName = null;
    gridEl.querySelectorAll(".poke-card--selected").forEach((el) => {
      el.classList.remove("poke-card--selected");
      const btn = el.querySelector(".poke-card-draft-btn");
      if (btn) btn.remove();
    });
  };

  function renderSelectionUI() {
    if (selectedSignId === null) return;
    const card = gridEl.querySelector(`.poke-card[data-id="${selectedSignId}"]`);
    if (!card || !card.classList.contains("poke-card--pickable")) {
      selectedSignId = null;
      selectedSignName = null;
      return;
    }
    card.classList.add("poke-card--selected");
    if (!card.querySelector(".poke-card-draft-btn")) {
      const limitReached = signingsUsedThisWeek() >= MAX_SIGNINGS_PER_WEEK;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn poke-card-draft-btn";
      btn.textContent = limitReached ? "Weekly Limit Reached" : "Sign Free Agent";
      btn.disabled = limitReached;
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        openFreeAgentSignModal(selectedSignId, selectedSignName);
      });
      card.appendChild(btn);
    }
  }

  const selectForSigning = (id, name) => {
    if (selectedSignId === id) {
      clearSelection();
      return;
    }
    clearSelection();
    selectedSignId = id;
    selectedSignName = name;
    renderSelectionUI();
  };

  // --- Sign/drop modal ---

  let pendingSign = null;

  const showFaModalMessage = (text, isError) => {
    faModalMessageEl.hidden = false;
    faModalMessageEl.className = `status${isError ? " error" : ""}`;
    faModalMessageEl.textContent = text;
  };

  const openFreeAgentSignModal = (pokemonId, pokemonName) => {
    if (!myTeam || !myTeam.slots) return;
    pendingSign = { pokemonId, pokemonName, slot: null };
    faModalNameEl.textContent = pokemonName;
    faModalMessageEl.hidden = true;
    faModalConfirmEl.disabled = true;
    faModalGridEl.innerHTML = positions
      .map((position) => {
        const filled = myTeam.slots[position];
        return `<button type="button" class="slot-picker-slot" data-slot="${escapeHtml(position)}">
                  <span class="slot-picker-slot-position">${escapeHtml(position)}</span>
                  <span class="slot-picker-slot-value">${filled ? `Drop ${escapeHtml(filled.pokemonName)}` : "— empty —"}</span>
                </button>`;
      })
      .join("");
    faModalGridEl.querySelectorAll(".slot-picker-slot").forEach((btn) => {
      btn.addEventListener("click", () => {
        faModalGridEl.querySelectorAll(".slot-picker-slot--selected").forEach((el) => el.classList.remove("slot-picker-slot--selected"));
        btn.classList.add("slot-picker-slot--selected");
        pendingSign.slot = btn.dataset.slot;
        faModalConfirmEl.disabled = false;
      });
    });
    faModalEl.hidden = false;
  };

  const closeFreeAgentSignModal = () => {
    faModalEl.hidden = true;
    pendingSign = null;
  };

  faModalCancelEl.addEventListener("click", closeFreeAgentSignModal);

  async function confirmFreeAgentSign() {
    if (!pendingSign || !pendingSign.slot || !currentUser) return;
    const { pokemonId, pokemonName, slot } = pendingSign;
    const teamRef = db.collection("teams").doc(currentUser.uid);
    const newDraftedRef = db.collection("draftedPokemon").doc(String(pokemonId));

    try {
      await db.runTransaction(async (tx) => {
        const [teamSnap, newDraftedSnap] = await Promise.all([tx.get(teamRef), tx.get(newDraftedRef)]);
        const team = teamSnap.data();
        if (!team || !team.slots) throw new Error("Team not found.");
        if (newDraftedSnap.exists) throw new Error("That Pokémon was just signed by someone else.");

        const state = seasonState;
        if (!state) throw new Error("Free agency opens once the season starts.");

        const fa = team.freeAgency || {};
        const signingsSoFar = fa.week === state.currentWeek ? fa.signings || 0 : 0;
        if (signingsSoFar >= MAX_SIGNINGS_PER_WEEK) {
          throw new Error("You've already used both free agent signings this week.");
        }

        const dropped = team.slots[slot];
        if (dropped) tx.delete(db.collection("draftedPokemon").doc(String(dropped.pokemonId)));

        tx.set(newDraftedRef, {
          pokemonId,
          pokemonName,
          uid: currentUser.uid,
          teamName: team.teamName,
          slot,
          freeAgent: true,
          pickedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        tx.update(teamRef, {
          [`slots.${slot}`]: { pokemonId, pokemonName, freeAgent: true },
          "freeAgency.week": state.currentWeek,
          "freeAgency.signings": signingsSoFar + 1,
        });
        tx.set(db.collection("chatMessages").doc(), {
          uid: currentUser.uid,
          system: true,
          text: dropped
            ? `${team.teamName} dropped ${dropped.pokemonName} for ${pokemonName}`
            : `${team.teamName} signed ${pokemonName} as a free agent`,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
      closeFreeAgentSignModal();
      clearSelection();
    } catch (error) {
      showFaModalMessage(error.message, true);
    }
  }

  faModalConfirmEl.addEventListener("click", confirmFreeAgentSign);

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
      if (spriteEl && detail.sprite) {
        spriteEl.src = detail.sprite;
      }
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
      // Leave the placeholder card as-is on failure; scrolling away/back retries nothing,
      // but a page reload will attempt the fetch again.
    }
  };

  const renderGrid = (entries) => {
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
        selectForSigning(Number(card.dataset.id), card.dataset.name);
      });
    });
    applyDraftedOverlay();
  };

  let fullList = [];
  let searchDebounce = null;
  let activeTypeIds = null; // null = no type filter active

  const applySearch = () => {
    const query = searchEl.value.trim().toLowerCase();
    let filtered = query ? fullList.filter((entry) => entry.name.includes(query)) : fullList;
    if (activeTypeIds) {
      filtered = filtered.filter((entry) => activeTypeIds.has(entry.id));
    }
    statusEl.hidden = true;
    renderGrid(filtered.slice(0, 500));
    if (filtered.length > 500) {
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.textContent = `Showing the first 500 of ${filtered.length} matches — refine your search to narrow it down.`;
    }
  };

  searchEl.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(applySearch, 150);
  });

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
