// Offense/Defense Coordinator (My Team). A sandbox: swaps here only touch
// a local draft of your own slots, never Firestore, until "Save to
// Roster" runs the same kind of per-key transactional merge the plain My
// Team roster editor uses. The two halves are pinned to their own shape
// (offense bottom, defense top) regardless of mode - only which team's
// roster fills a half, and whether it's editable, changes. Whichever half
// isn't yours is always the opponent's real, live roster - read-only, no
// local draft on their side at all.
(function () {
  const config = window.siteConfig || {};
  const statusEl = document.getElementById("coord-status");
  const cardEl = document.getElementById("coord-card");
  const tabOffenseEl = document.getElementById("coord-tab-offense");
  const tabDefenseEl = document.getElementById("coord-tab-defense");
  const matchupLabelEl = document.getElementById("coord-matchup-label");
  const fieldDefenseEl = document.getElementById("coord-field-defense");
  const fieldOffenseEl = document.getElementById("coord-field-offense");
  const poolEl = document.getElementById("coord-pool");
  const saveBtnEl = document.getElementById("coord-save-btn");
  const resetBtnEl = document.getElementById("coord-reset-btn");
  const actionsStatusEl = document.getElementById("coord-actions-status");
  const detailModalEl = document.getElementById("coord-detail-modal");
  const detailCloseBtnEl = document.getElementById("coord-detail-close-btn");
  const detailSpriteEl = document.getElementById("coord-detail-sprite");
  const detailNameEl = document.getElementById("coord-detail-name");
  const detailTypesEl = document.getElementById("coord-detail-types");
  const detailDimsEl = document.getElementById("coord-detail-dims");

  if (!cardEl) return;

  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const smallSpriteUrl = (pokemonId) =>
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemonId}.png`;
  const largeSpriteUrl = (pokemonId) =>
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokemonId}.png`;

  // --- PokeAPI detail caching, duplicated from pokemon-myteam.js by this
  // repo's one-file-per-page convention. Same cache keys/TTLs. ---

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

  const detailTtl = config.pokemonDetailCacheTtlMs || 90 * 24 * 60 * 60 * 1000;
  const apiBase = config.pokeApiBaseUrl || "https://pokeapi.co/api/v2";

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

  const formatImperial = (heightM, weightKg) => {
    const totalInches = Math.round(heightM * 39.3701);
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    const lbs = (weightKg * 2.20462).toFixed(1);
    return `${feet}'${inches}" · ${lbs} lbs`;
  };

  const typeBadgesHtml = (types) =>
    (types || []).map((type) => `<span class="type-badge type-badge--${escapeHtml(type)}">${escapeHtml(type)}</span>`).join("");

  // Mirrors the hex values in .type-badge--* (pokemon.css) exactly, so a
  // box's border reads as the same color as that type's badge everywhere
  // else on the site.
  const typeColorHex = {
    normal: "#8f96a3",
    fire: "#d1591f",
    water: "#2f6fed",
    electric: "#ffcb05",
    grass: "#3f8f4f",
    ice: "#5fb8c9",
    fighting: "#a3272a",
    poison: "#7a3e9e",
    ground: "#b7914a",
    flying: "#7c93d6",
    psychic: "#c0477a",
    bug: "#7c9420",
    rock: "#93873a",
    ghost: "#5a4a80",
    dragon: "#4b3fc9",
    dark: "#4a4440",
    steel: "#a8b4c2",
    fairy: "#c56f98",
  };

  const NEUTRAL_COLOR = "#3a3f46";

  // A box's border is split diagonally by its own mitered corners - the
  // top/left edges carry the first type's color, bottom/right carry the
  // second (or the same color twice for a single type), so the two meet
  // at a natural 45deg diagonal at the top-right and bottom-left corners.
  const colorsForTypes = (types) => {
    const a = (types && typeColorHex[types[0]]) || NEUTRAL_COLOR;
    const b = (types && typeColorHex[types[1]]) || a;
    return { a, b };
  };

  // --- Position groups/formation coordinates ---

  const positionGroups = config.positionGroups || {};
  const offensePositions = [...(positionGroups.offense || []), ...(positionGroups.specialTeams || [])];
  const defensePositions = [...(positionGroups.defense || [])];
  const allPositions = config.pokemonPositions || [];
  const fieldFormations = config.fieldFormations || { offense: {}, defense: {} };
  // Matches pokemon.css's own mobile breakpoint for this page.
  const mobileQuery = window.matchMedia("(max-width: 640px)");
  const offenseCoords = () =>
    mobileQuery.matches && fieldFormations.offenseMobile ? fieldFormations.offenseMobile : fieldFormations.offense;
  const defenseCoords = () =>
    mobileQuery.matches && fieldFormations.defenseMobile ? fieldFormations.defenseMobile : fieldFormations.defense;

  const shortLabel = (position) => (position.startsWith("BENCH") ? `B${position.slice(5)}` : position);

  if (!firebase.apps.length) firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  let currentUser = null;
  let teamsByUid = new Map();
  let matchups = [];
  let mode = "offense"; // "offense" | "defense"

  // draftSlots is the sandbox's working copy of the whole slots map (all
  // 26 positions) - a cross-unit swap (e.g. testing a defender at WR)
  // touches keys outside the unit currently on screen, so one shared
  // draft covers everything rather than one per mode. baselineSlots is
  // what it was last synced from (page load, or right after a save) -
  // that's what Reset reverts to and what Save diffs against.
  let draftSlots = null;
  let baselineSlots = null;
  let selected = null; // { position } or null

  const cloneSlots = (slots) => JSON.parse(JSON.stringify(slots || {}));

  const isDirty = () => {
    if (!draftSlots || !baselineSlots) return false;
    return allPositions.some((p) => JSON.stringify(draftSlots[p] || null) !== JSON.stringify(baselineSlots[p] || null));
  };

  const findOpponentMatchup = () => {
    if (!currentUser) return null;
    return (
      matchups
        .filter((m) => m.status === "scheduled" && (m.homeUid === currentUser.uid || m.awayUid === currentUser.uid) && m.date)
        .sort((a, b) => a.date.toMillis() - b.date.toMillis())[0] || null
    );
  };

  // --- Detail popup (read-only, for the opponent's static side) ---

  const closeDetail = () => {
    detailModalEl.hidden = true;
  };
  detailCloseBtnEl.addEventListener("click", closeDetail);

  const openDetail = async (pokemonId, pokemonName) => {
    detailNameEl.textContent = pokemonName;
    detailSpriteEl.src = largeSpriteUrl(pokemonId);
    detailSpriteEl.alt = pokemonName;
    detailTypesEl.innerHTML = "";
    detailDimsEl.textContent = "Loading…";
    detailModalEl.hidden = false;
    try {
      const detail = await fetchDetail(pokemonId);
      detailTypesEl.innerHTML = typeBadgesHtml(detail.types);
      detailDimsEl.textContent = formatImperial(detail.heightM, detail.weightKg);
    } catch (error) {
      detailDimsEl.textContent = "Unable to load details.";
    }
  };

  // --- Rendering ---

  const boxHtml = (position, pick, { editable, coords, mirrored }) => {
    const empty = !pick;
    const classes = ["coord-box"];
    if (empty) classes.push("coord-box--empty");
    if (!editable) classes.push("coord-box--readonly");
    if (selected && selected.position === position) classes.push("coord-box--selected");
    // coords.y is 0 at that unit's own line of scrimmage, increasing into
    // their own territory. The opponent's half sits on top, so their y=0
    // needs to land at the BOTTOM of their container (right against the
    // shared divider) rather than the top - mirrored flips that axis.
    const top = mirrored ? 100 - coords.y : coords.y;
    const style = `left:${coords.x}%; top:${top}%;`;
    if (empty) {
      return `<div class="${classes.join(" ")}" style="${style}" data-position="${escapeHtml(position)}">
                <span class="coord-box-position">${escapeHtml(shortLabel(position))}</span>
                <span class="coord-box-empty-label">—</span>
              </div>`;
    }
    return `<div class="${classes.join(" ")}" style="${style}" data-position="${escapeHtml(position)}" data-poke-id="${pick.pokemonId}" data-poke-name="${escapeHtml(pick.pokemonName)}">
              <span class="coord-box-position">${escapeHtml(shortLabel(position))}</span>
              <img class="coord-box-sprite" src="${smallSpriteUrl(pick.pokemonId)}" alt="${escapeHtml(pick.pokemonName)}" loading="lazy" />
            </div>`;
  };

  const setBoxColors = (el, colors) => {
    el.style.setProperty("--coord-color-a", colors.a);
    el.style.setProperty("--coord-color-b", colors.b);
  };

  const applyBoxBorders = (containerEl) => {
    containerEl.querySelectorAll("[data-poke-id]").forEach((el) => {
      setBoxColors(el, { a: NEUTRAL_COLOR, b: NEUTRAL_COLOR });
      fetchDetail(Number(el.dataset.pokeId))
        .then((detail) => setBoxColors(el, colorsForTypes(detail.types)))
        .catch(() => {});
    });
  };

  const poolItemHtml = (position, pick) => {
    const classes = ["coord-pool-item"];
    if (selected && selected.position === position) classes.push("coord-pool-item--selected");
    if (!pick) {
      classes.push("coord-pool-item--empty");
      return `<div class="${classes.join(" ")}" data-position="${escapeHtml(position)}">
                <span>${escapeHtml(shortLabel(position))}</span>
                <span style="font-size:0.6rem; color:var(--muted);">— empty —</span>
              </div>`;
    }
    return `<div class="${classes.join(" ")}" data-position="${escapeHtml(position)}" data-poke-id="${pick.pokemonId}" data-poke-name="${escapeHtml(pick.pokemonName)}">
              <span>${escapeHtml(shortLabel(position))}</span>
              <img src="${smallSpriteUrl(pick.pokemonId)}" alt="${escapeHtml(pick.pokemonName)}" loading="lazy" />
            </div>`;
  };

  const render = () => {
    if (!currentUser || !draftSlots) return;

    const matchup = findOpponentMatchup();

    if (!matchup) {
      cardEl.hidden = true;
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.textContent = "No upcoming matchup scheduled yet - the Coordinator needs an opponent to compare against.";
      return;
    }

    const opponentUid = matchup.homeUid === currentUser.uid ? matchup.awayUid : matchup.homeUid;
    const opponent = teamsByUid.get(opponentUid);
    const opponentSlots = (opponent && opponent.slots) || {};

    statusEl.hidden = true;
    cardEl.hidden = false;

    matchupLabelEl.textContent = `Week ${matchup.week} vs. ${opponent ? opponent.teamName || "Unnamed Team" : "Unknown team"}`;

    tabOffenseEl.classList.toggle("coord-mode-tab--active", mode === "offense");
    tabDefenseEl.classList.toggle("coord-mode-tab--active", mode === "defense");

    // The two halves are pinned to their own shape and screen position -
    // the offense formation always sits at the bottom, the defense
    // formation always at the top - so switching tabs never rearranges
    // the diagram itself. Only which team's roster fills each half, and
    // which one you can edit, changes. Realistic facing still holds:
    // Offensive Coordinator makes the bottom (offense) yours and the top
    // (defense) your opponent's; Defensive Coordinator flips that.
    const myPositions = mode === "offense" ? offensePositions : defensePositions;
    const offenseSlots = mode === "offense" ? draftSlots : opponentSlots;
    const defenseSlots = mode === "offense" ? opponentSlots : draftSlots;
    const offenseEditable = mode === "offense";
    const defenseEditable = mode === "defense";

    const renderHalf = (containerEl, positions, slotsSource, coordsMap, editable, mirrored) => {
      containerEl.innerHTML = positions
        .map((position) => boxHtml(position, slotsSource[position], { editable, coords: coordsMap[position], mirrored }))
        .join("");
      containerEl.querySelectorAll(".coord-box").forEach((el) => {
        if (editable) {
          el.addEventListener("click", () => handleSlotClick(el.dataset.position));
        } else if (el.dataset.pokeId) {
          el.addEventListener("click", () => openDetail(Number(el.dataset.pokeId), el.dataset.pokeName));
        }
      });
      applyBoxBorders(containerEl);
    };

    renderHalf(fieldDefenseEl, defensePositions, defenseSlots, defenseCoords(), defenseEditable, true);
    renderHalf(fieldOffenseEl, offensePositions, offenseSlots, offenseCoords(), offenseEditable, false);

    const poolPositions = allPositions.filter((p) => !myPositions.includes(p));
    poolEl.innerHTML = poolPositions.map((position) => poolItemHtml(position, draftSlots[position])).join("");
    poolEl.querySelectorAll(".coord-pool-item").forEach((el) => {
      el.addEventListener("click", () => handleSlotClick(el.dataset.position));
    });
    applyBoxBorders(poolEl);

    const dirty = isDirty();
    saveBtnEl.disabled = !dirty;
    resetBtnEl.disabled = !dirty;
    actionsStatusEl.textContent = dirty ? "Unsaved test changes - not yet on your real roster." : "";
  };

  const handleSlotClick = (position) => {
    const pick = draftSlots[position];
    if (selected === null) {
      if (!pick) return;
      selected = { position };
      render();
      return;
    }
    if (selected.position === position) {
      selected = null;
      render();
      return;
    }
    const fromPosition = selected.position;
    selected = null;
    const fromValue = draftSlots[fromPosition] || null;
    const toValue = draftSlots[position] || null;
    draftSlots[fromPosition] = toValue;
    draftSlots[position] = fromValue;
    render();
  };

  // Re-pick desktop vs. mobile offense coordinates on rotation/resize
  // across the breakpoint (e.g. turning a phone sideways).
  mobileQuery.addEventListener("change", () => render());

  tabOffenseEl.addEventListener("click", () => {
    if (mode === "offense") return;
    mode = "offense";
    selected = null;
    render();
  });
  tabDefenseEl.addEventListener("click", () => {
    if (mode === "defense") return;
    mode = "defense";
    selected = null;
    render();
  });

  resetBtnEl.addEventListener("click", () => {
    draftSlots = cloneSlots(baselineSlots);
    selected = null;
    render();
  });

  saveBtnEl.addEventListener("click", async () => {
    if (!currentUser || !draftSlots || !baselineSlots) return;
    const changedPositions = allPositions.filter(
      (p) => JSON.stringify(draftSlots[p] || null) !== JSON.stringify(baselineSlots[p] || null)
    );
    if (!changedPositions.length) return;
    saveBtnEl.disabled = true;
    actionsStatusEl.textContent = "Saving…";
    try {
      const teamRef = db.collection("teams").doc(currentUser.uid);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(teamRef);
        if (!snap.exists) throw new Error("Team not found.");
        const updates = {};
        changedPositions.forEach((p) => {
          updates[`slots.${p}`] = draftSlots[p] || null;
        });
        tx.update(teamRef, updates);
      });
      baselineSlots = cloneSlots(draftSlots);
      actionsStatusEl.textContent = "Saved to your real roster.";
      render();
    } catch (error) {
      actionsStatusEl.textContent = `Unable to save: ${error.message}`;
      saveBtnEl.disabled = false;
    }
  });

  // --- Live data ---

  let unsubscribeTeams = null;
  let unsubscribeMatchups = null;

  const subscribe = () => {
    [unsubscribeTeams, unsubscribeMatchups].forEach((u) => u && u());
    unsubscribeTeams = unsubscribeMatchups = null;
    draftSlots = null;
    baselineSlots = null;
    selected = null;

    if (!currentUser) {
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.innerHTML = `Sign in on the <a href="pokemon-league.html">League Home</a> page to use the Coordinator.`;
      cardEl.hidden = true;
      return;
    }

    statusEl.hidden = false;
    statusEl.textContent = "Loading…";

    unsubscribeTeams = db.collection("teams").onSnapshot(
      (snapshot) => {
        teamsByUid = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
        const myTeam = teamsByUid.get(currentUser.uid);
        if (!myTeam) {
          statusEl.hidden = false;
          statusEl.className = "status";
          statusEl.innerHTML = `You haven't joined the league yet - head to <a href="pokemon-league.html">League Home</a> to sign up.`;
          cardEl.hidden = true;
          return;
        }
        // Only adopt the live roster as the sandbox's baseline on first
        // load - once you're mid-test, further remote changes (an admin
        // injury flag, a trade) shouldn't silently overwrite what you're
        // trying out. Reset or reloading the page re-syncs.
        if (!baselineSlots) {
          baselineSlots = cloneSlots(myTeam.slots || {});
          draftSlots = cloneSlots(myTeam.slots || {});
        }
        render();
      },
      (error) => {
        statusEl.hidden = false;
        statusEl.className = "status error";
        statusEl.textContent = `Unable to load your team: ${error.message}`;
      }
    );

    unsubscribeMatchups = db.collection("matchups").onSnapshot(
      (snapshot) => {
        matchups = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        render();
      },
      () => {}
    );
  };

  auth.onAuthStateChanged((user) => {
    currentUser = user;
    subscribe();
  });
})();
