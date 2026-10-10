(function () {
  const config = window.siteConfig || {};
  const statusEl = document.getElementById("dex-status");
  const gridEl = document.getElementById("dex-grid");
  const searchEl = document.getElementById("dex-search");
  const typeFilterEl = document.getElementById("dex-type-filter");

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

  let draftedMap = new Map();

  const applyDraftedOverlay = () => {
    gridEl.querySelectorAll(".poke-card").forEach((card) => {
      const id = Number(card.dataset.id);
      const drafted = draftedMap.get(id);
      const existingRibbon = card.querySelector(".poke-card-drafted-by");
      if (drafted) {
        card.classList.add("poke-card--drafted");
        if (!existingRibbon) {
          const ribbon = document.createElement("p");
          ribbon.className = "poke-card-drafted-by";
          ribbon.textContent = `Drafted by ${drafted.teamName}`;
          card.appendChild(ribbon);
        }
      } else {
        card.classList.remove("poke-card--drafted");
        if (existingRibbon) existingRibbon.remove();
      }
    });
  };

  if (config.firebaseConfig && config.firebaseConfig.apiKey !== "YOUR_FIREBASE_API_KEY") {
    try {
      firebase.initializeApp(config.firebaseConfig);
      const db = firebase.firestore();
      let unsubscribeDrafted = null;

      // Wait for auth to actually resolve before subscribing - a listener
      // that starts too early (before a saved login rehydrates) gets a
      // permission error and never retries, even after sign-in completes.
      firebase.auth().onAuthStateChanged((user) => {
        if (unsubscribeDrafted) {
          unsubscribeDrafted();
          unsubscribeDrafted = null;
        }
        if (!user) {
          draftedMap = new Map();
          applyDraftedOverlay();
          return;
        }
        unsubscribeDrafted = db.collection("draftedPokemon").onSnapshot(
          (snapshot) => {
            draftedMap = new Map();
            snapshot.forEach((doc) => {
              const data = doc.data();
              draftedMap.set(Number(doc.id), data);
            });
            applyDraftedOverlay();
          },
          () => {
            // Non-fatal - the dex still works fine without the overlay.
          }
        );
      });
    } catch (error) {
      // Firebase not configured or unreachable - the dex still works without the overlay.
    }
  }

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
          <article class="card poke-card" data-id="${entry.id}">
            <span class="poke-card-number">#${String(entry.id).padStart(4, "0")}</span>
            <img class="poke-sprite" alt="${escapeHtml(entry.name)}" loading="lazy" />
            <span class="poke-card-name">${escapeHtml(entry.name)}</span>
            <div class="poke-card-types"></div>
            <span class="poke-card-dimensions"></span>
          </article>
        `
      )
      .join("");
    gridEl.querySelectorAll(".poke-card").forEach((card) => detailObserver.observe(card));
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
