(function () {
  const config = window.siteConfig || {};
  const statusEl = document.getElementById("myteam-status");
  const rosterCardEl = document.getElementById("myteam-roster-card");
  const rosterLockEl = document.getElementById("myteam-roster-lock");
  const selectionBarEl = document.getElementById("myteam-selection-bar");
  const offenseGridEl = document.getElementById("myteam-offense-grid");
  const defenseGridEl = document.getElementById("myteam-defense-grid");
  const offenseRadarEl = document.getElementById("myteam-offense-radar");
  const defenseRadarEl = document.getElementById("myteam-defense-radar");
  const oppRadarsEl = document.getElementById("myteam-opp-radars");
  const matchupCardEl = document.getElementById("myteam-matchup-card");
  const matchupMetaEl = document.getElementById("myteam-matchup-meta");
  const oppHeadingEl = document.getElementById("myteam-opp-heading");
  const oppListEl = document.getElementById("myteam-opp-list");
  const matchupTrainingEl = document.getElementById("myteam-matchup-training");
  const trainingCardEl = document.getElementById("training-card");
  const trainingInfoBtnEl = document.getElementById("training-info-btn");
  const trainingInfoPopoverEl = document.getElementById("training-info-popover");
  const trainingMetaEl = document.getElementById("training-meta");
  const trainingButtonsEl = document.getElementById("training-buttons");
  const trainingMessageEl = document.getElementById("training-message");
  const myTrainingBadgesEl = document.getElementById("myteam-training-badges");
  const cheerAreaEl = document.getElementById("cheer-area");
  const cheerConfirmModalEl = document.getElementById("cheer-confirm-modal");
  const cheerConfirmYesBtnEl = document.getElementById("cheer-confirm-yes-btn");
  const cheerConfirmNoBtnEl = document.getElementById("cheer-confirm-no-btn");
  const cheerPickModalEl = document.getElementById("cheer-pick-modal");
  const cheerPickCloseBtnEl = document.getElementById("cheer-pick-close-btn");
  const cheerPickSearchEl = document.getElementById("cheer-pick-search");
  const cheerPickGridEl = document.getElementById("cheer-pick-grid");
  const cheerPickStatusEl = document.getElementById("cheer-pick-status");
  const cheerPickRemoveAreaEl = document.getElementById("cheer-pick-remove-area");
  const slotPickModalEl = document.getElementById("slot-pick-modal");
  const slotPickTitleEl = document.getElementById("slot-pick-title");
  const slotPickCloseBtnEl = document.getElementById("slot-pick-close-btn");
  const slotPickSearchEl = document.getElementById("slot-pick-search");
  const slotPickGridEl = document.getElementById("slot-pick-grid");
  const slotPickStatusEl = document.getElementById("slot-pick-status");

  if (!rosterCardEl) return;

  const escapeHtml = (value) => {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  const teamAvatarHtml = (team, sizeClass = "") => {
    const name = (team && team.teamName) || "?";
    const cls = `team-avatar${sizeClass ? ` ${sizeClass}` : ""}`;
    if (team && team.photoURL) {
      return `<img class="${cls}" src="${escapeHtml(team.photoURL)}" alt="${escapeHtml(name)}" loading="lazy" />`;
    }
    return `<span class="${cls} team-avatar-placeholder">${escapeHtml(name.charAt(0) || "?")}</span>`;
  };

  const smallSpriteUrl = (pokemonId) =>
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemonId}.png`;
  const largeSpriteUrl = (pokemonId) =>
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokemonId}.png`;
  const itemSpriteUrl = (item) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${item}.png`;

  // --- PokeAPI list/detail caching, duplicated from pokemon-dex.js by this
  // repo's one-file-per-page convention. Same cache keys, so a browser that
  // already visited the Pokedex hits localStorage instead of the network. ---

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
  const listTtl = config.pokemonListCacheTtlMs || 30 * 24 * 60 * 60 * 1000;
  const apiBase = config.pokeApiBaseUrl || "https://pokeapi.co/api/v2";
  const legendaryIds = new Set(config.legendaryPokemonIds || []);

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

  // --- Type-composition radar chart (duplicated from pokemon-teams.js by
  // this repo's one-file-per-page convention) ---

  const typeWheelOrder = config.typeWheelOrder || [];

  const typeCountsForPicks = async (picks) => {
    const counts = {};
    typeWheelOrder.forEach((t) => (counts[t] = 0));
    await Promise.all(
      picks.map(async (pick) => {
        try {
          const detail = await fetchDetail(pick.pokemonId);
          (detail.types || []).forEach((t) => {
            if (counts[t] !== undefined) counts[t] += 1;
          });
        } catch (error) {
          // Skip Pokemon whose detail fails to load.
        }
      })
    );
    return counts;
  };

  const typeRadarSvgMarkup = (counts, size, labeled) => {
    const n = typeWheelOrder.length;
    if (!n) return null;
    const center = size / 2;
    // The labeled (popup) version needs real margin between the data
    // shape and the canvas edge for full type names (up to 8 characters,
    // e.g. "fighting") not to clip - 34px wasn't nearly enough.
    const radius = labeled ? size / 2 - 60 : size / 2 - 14;
    const max = Math.max(0, ...typeWheelOrder.map((t) => counts[t] || 0));
    if (max === 0) return null;

    const pointFor = (i, value) => {
      const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
      const r = (value / max) * radius;
      return [center + r * Math.cos(angle), center + r * Math.sin(angle)];
    };

    const rings = [0.33, 0.66, 1]
      .map((frac) => {
        const pts = typeWheelOrder.map((t, i) => pointFor(i, max * frac).map((v) => v.toFixed(1)).join(",")).join(" ");
        return `<polygon points="${pts}" class="type-radar-ring" />`;
      })
      .join("");

    const spokes = typeWheelOrder
      .map((t, i) => {
        const [x, y] = pointFor(i, max);
        return `<line x1="${center}" y1="${center}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="type-radar-spoke" />`;
      })
      .join("");

    const dataPoints = typeWheelOrder.map((t, i) => pointFor(i, counts[t] || 0));
    const polygon = dataPoints.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ");

    const dots = typeWheelOrder
      .map((t, i) => {
        const [x, y] = dataPoints[i];
        const count = counts[t] || 0;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${labeled ? 4.5 : 3.5}" class="type-radar-point type-radar-point--${t}" data-type="${t}" data-count="${count}"><title>${escapeHtml(
          t
        )}: ${count}</title></circle>`;
      })
      .join("");

    const labels = labeled
      ? typeWheelOrder
          .map((t, i) => {
            const [x, y] = pointFor(i, max * 1.18);
            return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="type-radar-type-label" text-anchor="middle" dominant-baseline="middle">${escapeHtml(
              t
            )}</text>`;
          })
          .join("")
      : "";

    return `<svg class="type-radar${labeled ? " type-radar--labeled" : ""}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      ${rings}${spokes}<polygon points="${polygon}" class="type-radar-shape" />${dots}${labels}
    </svg>`;
  };

  const typeRadarChartHtml = (counts, caption, smallSize = 150) => {
    const small = typeRadarSvgMarkup(counts, smallSize, false);
    if (!small) {
      return `<div class="type-radar-wrap"><p class="type-radar-empty">No Pokémon yet</p>${
        caption ? `<span class="type-radar-caption">${escapeHtml(caption)}</span>` : ""
      }</div>`;
    }
    return `<div class="type-radar-wrap">${small}${
      caption ? `<span class="type-radar-caption">${escapeHtml(caption)}</span>` : ""
    }</div>`;
  };

  // Click opens a shared popup (one per page, reused for whichever chart
  // was clicked) with a bigger version that has every type labeled -
  // simpler than expanding the chart in place, which fought with page
  // layout (an expanded chart taking its compact sibling's spot out of
  // flow shifted everything below it up).
  const typeRadarModalEl = document.getElementById("type-radar-modal");
  const typeRadarModalCaptionEl = document.getElementById("type-radar-modal-caption");
  const typeRadarModalChartEl = document.getElementById("type-radar-modal-chart");
  const typeRadarModalCloseBtnEl = document.getElementById("type-radar-modal-close-btn");

  const closeTypeRadarModal = () => {
    if (typeRadarModalEl) typeRadarModalEl.hidden = true;
  };
  if (typeRadarModalCloseBtnEl) typeRadarModalCloseBtnEl.addEventListener("click", closeTypeRadarModal);

  const openTypeRadarModal = (counts, caption) => {
    if (!typeRadarModalEl) return;
    typeRadarModalCaptionEl.textContent = caption || "Type Composition";
    typeRadarModalChartEl.innerHTML =
      typeRadarSvgMarkup(counts, 320, true) || `<p class="type-radar-empty">No Pokémon yet</p>`;
    typeRadarModalEl.hidden = false;
  };

  const wireTypeRadarClick = (wrapEl, counts, caption) => {
    if (!wrapEl) return;
    const max = Math.max(0, ...typeWheelOrder.map((t) => counts[t] || 0));
    if (max === 0) return;
    wrapEl.addEventListener("click", () => openTypeRadarModal(counts, caption));
  };

  // --- Pokemon detail popup (click an opponent's Pokemon) ---

  const pokeDetailModalEl = document.getElementById("poke-detail-modal");
  const pokeDetailCloseBtnEl = document.getElementById("poke-detail-close-btn");
  const pokeDetailSpriteEl = document.getElementById("poke-detail-sprite");
  const pokeDetailNameEl = document.getElementById("poke-detail-name");
  const pokeDetailTypesEl = document.getElementById("poke-detail-types");
  const pokeDetailDimsEl = document.getElementById("poke-detail-dims");

  const closePokeDetail = () => {
    if (pokeDetailModalEl) pokeDetailModalEl.hidden = true;
  };
  if (pokeDetailCloseBtnEl) pokeDetailCloseBtnEl.addEventListener("click", closePokeDetail);

  const openPokeDetail = async (pokemonId, pokemonName) => {
    if (!pokeDetailModalEl) return;
    pokeDetailNameEl.textContent = pokemonName;
    pokeDetailSpriteEl.src = largeSpriteUrl(pokemonId);
    pokeDetailSpriteEl.alt = pokemonName;
    pokeDetailTypesEl.innerHTML = "";
    pokeDetailDimsEl.textContent = "Loading…";
    pokeDetailModalEl.hidden = false;
    try {
      const detail = await fetchDetail(pokemonId);
      pokeDetailTypesEl.innerHTML = typeBadgesHtml(detail.types);
      pokeDetailDimsEl.textContent = formatImperial(detail.heightM, detail.weightKg);
    } catch (error) {
      pokeDetailDimsEl.textContent = "Unable to load details.";
    }
  };


  const trainingTypes = config.trainingTypes || [];
  const trainingTypeByKey = new Map(trainingTypes.map((t) => [t.key, t]));

  // Local calendar day, not a rolling 24h window - 11:59pm and 12:01am the
  // next day are two different training days.
  const dateKey = (offsetDays = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  if (!config.firebaseConfig || config.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") {
    statusEl.className = "status error";
    statusEl.textContent = "The Powderpuff League isn't set up yet.";
    return;
  }

  firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const groups = config.positionGroups || { offense: [], defense: [] };
  const positions = config.pokemonPositions || [];
  const positionLabels = config.positionLabels || {};

  let currentUser = null;
  let teamsByUid = new Map();
  let matchups = [];
  let todayLog = null;
  let trainingLog = [];
  let leagueSettings = null;

  // --- Roster rules: picks open/closed (admin switch), the admin's
  // roster-lock switch, and which Pokemon are playable. firestore.rules
  // enforces the first two; playability is checked here and on the
  // Pokedex page. ---

  const picksOpen = () => Boolean(leagueSettings && leagueSettings.rosterPicksOpen);

  const isRosterLocked = () => Boolean(leagueSettings && leagueSettings.rostersLocked);

  // null when the roster can be edited, otherwise why it can't.
  const rosterLockReason = () => {
    if (!picksOpen()) return "Roster picks aren't open yet - the admin will open them soon.";
    if (isRosterLocked()) return "Rosters are locked right now - come back once the admin unlocks them to make changes.";
    return null;
  };

  // Every Pokemon starts playable except Legendaries/Mythicals; the
  // admin's per-Pokemon overrides (Pokedex page) win over that default.
  const isPlayable = (pokemonId) => {
    const overrides = (leagueSettings && leagueSettings.playable) || {};
    const override = overrides[String(pokemonId)];
    return typeof override === "boolean" ? override : !legendaryIds.has(pokemonId);
  };

  // --- Training ---

  // A team's "week" of training runs from when its previous game's result
  // went in to when this game's result goes in - so game-day Sunday
  // training counts toward that day's game until the admin posts it.
  const previousMatchupFor = (uid, currentMatchup) => {
    if (!currentMatchup.date) return null;
    return (
      matchups
        .filter(
          (m) => (m.homeUid === uid || m.awayUid === uid) && m.date && m.date.toMillis() < currentMatchup.date.toMillis()
        )
        .sort((a, b) => b.date.toMillis() - a.date.toMillis())[0] || null
    );
  };

  // Training counts toward a game until its result is entered: a game
  // still "scheduled" has no cutoff yet, and a final one cuts off when the
  // result first went in (finalizedAt). Games finalized before that field
  // existed fall back to their stored date (start of game-day Sunday).
  const trainingCutoffMs = (m) => {
    if (m.status !== "final") return Infinity;
    if (m.finalizedAt) return m.finalizedAt.toMillis();
    return m.date ? m.date.toMillis() : Infinity;
  };

  const trainingSinceLastGame = (uid, currentMatchup) => {
    if (!currentMatchup.date) return [];
    const prev = previousMatchupFor(uid, currentMatchup);
    const startMs = prev ? trainingCutoffMs(prev) : null;
    const endMs = trainingCutoffMs(currentMatchup);
    return trainingLog
      .filter((log) => log.uid === uid)
      .filter((log) => {
        const logMs = log.loggedAt ? log.loggedAt.toMillis() : new Date(`${log.date}T12:00:00`).getTime();
        return (startMs === null || logMs > startMs) && logMs <= endMs;
      })
      .sort((a, b) => a.date.localeCompare(b.date))
      .flatMap((log) => log.types || []);
  };

  const trainingSpriteRowHtml = (uid, currentMatchup) => {
    const icons = trainingSinceLastGame(uid, currentMatchup)
      .map((key) => trainingTypeByKey.get(key))
      .filter(Boolean)
      .map(
        (type) =>
          `<img class="matchup-training-sprite" src="${itemSpriteUrl(type.item)}" alt="${escapeHtml(type.label)}" title="${escapeHtml(type.label)}" loading="lazy" />`
      )
      .join("");
    return `<span class="matchup-training-row">${icons}</span>`;
  };

  // A stored streak only updates when a team trains, so it counts as 0 once
  // the team's last session is older than yesterday.
  const activeStreak = (training) => {
    const t = training || {};
    return t.lastTrainedDate && t.lastTrainedDate >= dateKey(-1) ? t.currentStreak || 0 : 0;
  };

  const trainingBadgesHtml = (training) => {
    const t = training || {};
    const streak = activeStreak(t);
    const bonus = t.bonusSessionsAvailable || 0;
    const parts = [];
    if (streak > 0) parts.push(`<span class="training-badge training-badge--streak">🌟 ${streak}-day training streak</span>`);
    if (bonus > 0) parts.push(`<span class="training-badge training-badge--bonus">+${bonus} bonus session${bonus === 1 ? "" : "s"}</span>`);
    return parts.join("");
  };

  let trainingMessageTimeout = null;
  const showTrainingMessage = (text, isError) => {
    trainingMessageEl.hidden = false;
    trainingMessageEl.className = `status${isError ? " error" : ""}`;
    trainingMessageEl.textContent = text;
    clearTimeout(trainingMessageTimeout);
    trainingMessageTimeout = setTimeout(() => {
      trainingMessageEl.hidden = true;
    }, 5000);
  };

  const renderTraining = () => {
    if (!currentUser) {
      trainingCardEl.hidden = true;
      return;
    }
    const myTeam = teamsByUid.get(currentUser.uid);
    if (!myTeam) {
      trainingCardEl.hidden = true;
      return;
    }
    trainingCardEl.hidden = false;

    const training = myTeam.training || {};
    const bonusAvailable = training.bonusSessionsAvailable || 0;
    const doneToday = (todayLog && todayLog.types) || [];
    const maxToday = bonusAvailable > 0 ? 2 : 1;
    const quotaUsed = doneToday.length >= maxToday;

    if (doneToday.length === 0) {
      trainingMetaEl.textContent =
        bonusAvailable > 0 ? `You have a bonus session banked - pick up to 2 today.` : `Pick today's training session.`;
    } else if (!quotaUsed) {
      trainingMetaEl.textContent = `One more session available today (bonus session banked).`;
    } else {
      trainingMetaEl.textContent = `Today's training is done. Come back tomorrow.`;
    }

    trainingButtonsEl.innerHTML = trainingTypes
      .map((type) => {
        const alreadyDone = doneToday.includes(type.key);
        const disabled = alreadyDone || quotaUsed;
        return `<div class="training-option">
                  <button type="button" class="training-btn${alreadyDone ? " training-btn--done" : ""}" data-key="${type.key}"
                    style="--training-color: ${type.color}" ${disabled ? "disabled" : ""}>
                    <img class="training-btn-sprite" src="${itemSpriteUrl(type.item)}" alt="" loading="lazy" />
                    <span>${escapeHtml(type.label)}</span>
                    ${alreadyDone ? `<span class="training-btn-check">✓ Done today</span>` : ""}
                  </button>
                  <button type="button" class="info-tooltip-btn training-type-info-btn" data-info-key="${type.key}"
                    aria-label="What is ${escapeHtml(type.label)}?">?</button>
                  <div class="info-tooltip-popover training-type-info-popover" data-info-key="${type.key}" hidden>
                    <p>${escapeHtml(type.description || "")}</p>
                  </div>
                </div>`;
      })
      .join("");

    trainingButtonsEl.querySelectorAll(".training-btn:not([disabled])").forEach((btn) => {
      btn.addEventListener("click", () => logTraining(btn.dataset.key));
    });

    // Per-type "what does this do" tooltip - same toggle-on-click,
    // close-on-outside-click pattern as the overall training-info one
    // below, just scoped to one popover at a time among the six.
    trainingButtonsEl.querySelectorAll(".training-type-info-btn").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const popover = btn.nextElementSibling;
        const willShow = popover.hidden;
        trainingButtonsEl.querySelectorAll(".training-type-info-popover").forEach((p) => (p.hidden = true));
        popover.hidden = !willShow;
      });
    });

    renderCheerArea(myTeam);
  };

  async function logTraining(typeKey) {
    if (!currentUser) return;
    const type = trainingTypeByKey.get(typeKey);
    if (!type) return;

    const today = dateKey();
    const yesterday = dateKey(-1);
    const logRef = db.collection("trainingLog").doc(`${currentUser.uid}_${today}`);
    const teamRef = db.collection("teams").doc(currentUser.uid);

    try {
      await db.runTransaction(async (tx) => {
        const [logSnap, teamSnap] = await Promise.all([tx.get(logRef), tx.get(teamRef)]);
        const team = teamSnap.data();
        const training = (team && team.training) || {};
        const bonusAvailable = training.bonusSessionsAvailable || 0;

        if (!logSnap.exists) {
          const prevStreak = training.lastTrainedDate === yesterday ? training.currentStreak || 0 : 0;
          tx.set(logRef, {
            uid: currentUser.uid,
            date: today,
            types: [typeKey],
            loggedAt: firebase.firestore.FieldValue.serverTimestamp(),
          });
          tx.update(teamRef, {
            "training.lastTrainedDate": today,
            "training.currentStreak": prevStreak + 1,
          });
          return;
        }

        const existing = logSnap.data();
        if (existing.types.includes(typeKey)) throw new Error("You've already done that session today.");
        if (existing.types.length >= 2) throw new Error("No more training sessions available today.");
        if (bonusAvailable <= 0) throw new Error("No more training sessions available today.");

        tx.update(logRef, { types: firebase.firestore.FieldValue.arrayUnion(typeKey) });
        tx.update(teamRef, { "training.bonusSessionsAvailable": firebase.firestore.FieldValue.increment(-1) });
      });
      showTrainingMessage(`Your team had a lovely ${type.label} session today!`);
    } catch (error) {
      showTrainingMessage(error.message, true);
    }
  }

  trainingInfoBtnEl.addEventListener("click", (event) => {
    event.stopPropagation();
    trainingInfoPopoverEl.hidden = !trainingInfoPopoverEl.hidden;
  });
  document.addEventListener("click", (event) => {
    if (!trainingInfoPopoverEl.hidden && !trainingInfoPopoverEl.contains(event.target) && event.target !== trainingInfoBtnEl) {
      trainingInfoPopoverEl.hidden = true;
    }
    if (!event.target.closest(".training-option")) {
      trainingButtonsEl.querySelectorAll(".training-type-info-popover").forEach((p) => (p.hidden = true));
    }
  });
  if (trainingInfoPopoverEl) {
    trainingInfoPopoverEl.innerHTML = (config.trainingInfoBlurb || "")
      .split("\n\n")
      .map((para) => `<p>${escapeHtml(para)}</p>`)
      .join("");
  }

  // --- Cheerleaders: purely cosmetic. A team that opts in gets 5 small
  // slots (teams/{uid}.cheerSlots, a map keyed "0".."4") that can hold any
  // Pokemon at all - Legendaries and unplayable Pokemon included. ---

  let pendingCheerSlot = null;
  let pokemonList = null; // lazy-loaded full Pokedex name/id list

  const loadPokemonList = async () => {
    if (!pokemonList) pokemonList = await fetchList();
    return pokemonList;
  };

  const renderCheerArea = (myTeam) => {
    if (!cheerAreaEl) return;
    if (!myTeam.cheerSlots) {
      cheerAreaEl.innerHTML = `<button type="button" class="cheer-toggle-btn" id="cheer-add-btn">Add cheerleaders?</button>`;
      const btn = document.getElementById("cheer-add-btn");
      if (btn) btn.addEventListener("click", () => (cheerConfirmModalEl.hidden = false));
      return;
    }
    const slots = myTeam.cheerSlots;
    cheerAreaEl.innerHTML = `<div class="cheer-slots-row">${[0, 1, 2, 3, 4]
      .map((i) => {
        const pick = slots[String(i)];
        return pick
          ? `<button type="button" class="cheer-slot" data-slot="${i}" title="${escapeHtml(pick.pokemonName)}"><img class="cheer-slot-sprite" src="${smallSpriteUrl(pick.pokemonId)}" alt="${escapeHtml(pick.pokemonName)}" loading="lazy" /></button>`
          : `<button type="button" class="cheer-slot" data-slot="${i}" title="Add a cheerleader"><span class="cheer-slot-empty">+</span></button>`;
      })
      .join("")}</div>`;
    cheerAreaEl.querySelectorAll(".cheer-slot").forEach((btn) => {
      btn.addEventListener("click", () => openCheerPickModal(Number(btn.dataset.slot), slots[btn.dataset.slot] || null));
    });
  };

  if (cheerConfirmYesBtnEl) {
    cheerConfirmYesBtnEl.addEventListener("click", async () => {
      if (!currentUser) return;
      try {
        await db.collection("teams").doc(currentUser.uid).update({
          cheerSlots: { 0: null, 1: null, 2: null, 3: null, 4: null },
        });
      } catch (error) {
        window.alert(`Unable to add cheerleaders: ${error.message}`);
      }
      cheerConfirmModalEl.hidden = true;
    });
  }
  if (cheerConfirmNoBtnEl) {
    cheerConfirmNoBtnEl.addEventListener("click", () => (cheerConfirmModalEl.hidden = true));
  }

  const openCheerPickModal = async (slotIndex, currentPick) => {
    if (!cheerPickModalEl) return;
    pendingCheerSlot = slotIndex;
    cheerPickSearchEl.value = "";
    cheerPickGridEl.innerHTML = "";
    cheerPickStatusEl.hidden = false;
    cheerPickStatusEl.className = "status";
    cheerPickStatusEl.textContent = "Loading…";
    cheerPickRemoveAreaEl.innerHTML = currentPick
      ? `<button type="button" class="btn btn-secondary" id="cheer-remove-btn" style="margin-bottom:0.75rem;">Remove ${escapeHtml(
          currentPick.pokemonName
        )}</button>`
      : "";
    cheerPickModalEl.hidden = false;
    cheerPickSearchEl.focus();

    const removeBtn = document.getElementById("cheer-remove-btn");
    if (removeBtn) removeBtn.addEventListener("click", () => saveCheerSlot(slotIndex, null));

    try {
      await loadPokemonList();
      cheerPickStatusEl.hidden = true;
      renderCheerPickResults(cheerPickSearchEl.value);
    } catch (error) {
      cheerPickStatusEl.textContent = `Unable to load Pokémon: ${error.message}`;
    }
  };

  const closeCheerPickModal = () => {
    cheerPickModalEl.hidden = true;
    pendingCheerSlot = null;
  };
  if (cheerPickCloseBtnEl) cheerPickCloseBtnEl.addEventListener("click", closeCheerPickModal);

  const pickGridHtml = (matches) =>
    matches
      .map(
        (p) =>
          `<div class="cheer-pick-card" data-id="${p.id}" data-name="${escapeHtml(p.name)}">
            <img src="${smallSpriteUrl(p.id)}" alt="${escapeHtml(p.name)}" loading="lazy" />
            <span>${escapeHtml(p.name)}</span>
          </div>`
      )
      .join("");

  const renderCheerPickResults = (search) => {
    if (!pokemonList) return;
    const term = search.trim().toLowerCase();
    if (!term) {
      cheerPickGridEl.innerHTML = "";
      return;
    }
    const matches = pokemonList.filter((p) => p.name.includes(term)).slice(0, 48);
    if (!matches.length) {
      cheerPickGridEl.innerHTML = `<p class="status">No Pokémon match "${escapeHtml(search)}".</p>`;
      return;
    }
    cheerPickGridEl.innerHTML = pickGridHtml(matches);
    cheerPickGridEl.querySelectorAll(".cheer-pick-card").forEach((card) => {
      card.addEventListener("click", () => {
        if (pendingCheerSlot === null) return;
        saveCheerSlot(pendingCheerSlot, { pokemonId: Number(card.dataset.id), pokemonName: card.dataset.name });
      });
    });
  };

  let cheerSearchTimeout = null;
  if (cheerPickSearchEl) {
    cheerPickSearchEl.addEventListener("input", () => {
      clearTimeout(cheerSearchTimeout);
      cheerSearchTimeout = setTimeout(() => renderCheerPickResults(cheerPickSearchEl.value), 150);
    });
  }

  async function saveCheerSlot(slotIndex, pick) {
    if (!currentUser) return;
    try {
      await db.collection("teams").doc(currentUser.uid).update({
        [`cheerSlots.${slotIndex}`]: pick,
      });
      closeCheerPickModal();
    } catch (error) {
      cheerPickStatusEl.hidden = false;
      cheerPickStatusEl.className = "status error";
      cheerPickStatusEl.textContent = error.message;
    }
  }

  // --- Picking a Pokemon for a roster spot: tap an empty spot (or
  // "Change" on a selected one) to open this picker. Only playable
  // Pokemon are offered, and duplicates are always fine. ---

  let pendingPickPosition = null;

  const openSlotPickModal = async (position) => {
    if (rosterLockReason()) return;
    pendingPickPosition = position;
    slotPickTitleEl.textContent = positionLabels[position] || position;
    slotPickSearchEl.value = "";
    slotPickGridEl.innerHTML = "";
    slotPickStatusEl.hidden = false;
    slotPickStatusEl.className = "status";
    slotPickStatusEl.textContent = "Loading…";
    slotPickModalEl.hidden = false;
    slotPickSearchEl.focus();
    try {
      await loadPokemonList();
      slotPickStatusEl.hidden = true;
      renderSlotPickResults(slotPickSearchEl.value);
    } catch (error) {
      slotPickStatusEl.textContent = `Unable to load Pokémon: ${error.message}`;
    }
  };

  const closeSlotPickModal = () => {
    slotPickModalEl.hidden = true;
    pendingPickPosition = null;
  };
  slotPickCloseBtnEl.addEventListener("click", closeSlotPickModal);
  slotPickModalEl.addEventListener("click", (event) => {
    if (event.target === slotPickModalEl) closeSlotPickModal();
  });

  const renderSlotPickResults = (search) => {
    if (!pokemonList) return;
    const term = search.trim().toLowerCase();
    if (!term) {
      slotPickGridEl.innerHTML = `<p class="status">Start typing a Pokémon's name.</p>`;
      return;
    }
    const nameMatches = pokemonList.filter((p) => p.name.includes(term));
    const matches = nameMatches.filter((p) => isPlayable(p.id)).slice(0, 48);
    if (!matches.length) {
      slotPickGridEl.innerHTML = nameMatches.length
        ? `<p class="status">No playable Pokémon match "${escapeHtml(search)}" - the ones that do aren't playable in this league.</p>`
        : `<p class="status">No Pokémon match "${escapeHtml(search)}".</p>`;
      return;
    }
    slotPickGridEl.innerHTML = pickGridHtml(matches);
    slotPickGridEl.querySelectorAll(".cheer-pick-card").forEach((card) => {
      card.addEventListener("click", () => {
        if (pendingPickPosition === null) return;
        const position = pendingPickPosition;
        closeSlotPickModal();
        setSlot(position, { pokemonId: Number(card.dataset.id), pokemonName: card.dataset.name });
      });
    });
  };

  let slotSearchTimeout = null;
  slotPickSearchEl.addEventListener("input", () => {
    clearTimeout(slotSearchTimeout);
    slotSearchTimeout = setTimeout(() => renderSlotPickResults(slotPickSearchEl.value), 150);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!slotPickModalEl.hidden) closeSlotPickModal();
    else if (cheerPickModalEl && !cheerPickModalEl.hidden) closeCheerPickModal();
    else if (selectedPosition !== null) {
      selectedPosition = null;
      renderMyRoster();
    }
  });

  async function setSlot(position, pick) {
    if (!currentUser) return;
    const reason = rosterLockReason();
    if (reason) {
      window.alert(reason);
      return;
    }
    if (pick && !isPlayable(pick.pokemonId)) {
      window.alert(`${pick.pokemonName} isn't playable in this league.`);
      return;
    }
    try {
      await db.collection("teams").doc(currentUser.uid).update({ [`slots.${position}`]: pick });
    } catch (error) {
      window.alert(`Unable to update your roster: ${error.message}`);
    }
  }

  // --- My roster: square, large-sprite slots. Tap a filled spot to select
  // it (then Change, Remove, or tap another spot to swap), tap an empty
  // spot to pick a Pokemon for it, or drag one spot onto another. ---

  const renderSlot = (position, slots, locked) => {
    const pick = slots[position];
    const label = positionLabels[position] || position;
    if (!pick) {
      return `<div class="myteam-slot${locked ? "" : " myteam-slot--pickable"}" data-position="${escapeHtml(position)}" title="${escapeHtml(label)}">
                <span class="myteam-slot-position">${escapeHtml(position)}</span>
                <span class="myteam-slot-empty">${locked ? "— empty —" : "+ Pick a Pokémon"}</span>
              </div>`;
    }
    const isSelected = position === selectedPosition;
    const unplayable = !isPlayable(pick.pokemonId);
    return `<div class="myteam-slot myteam-slot--filled${isSelected ? " myteam-slot--selected" : ""}${unplayable ? " myteam-slot--unplayable" : ""}"
              ${locked ? "" : 'draggable="true"'} data-position="${escapeHtml(position)}" title="${escapeHtml(label)}">
              <span class="myteam-slot-position">${escapeHtml(position)}</span>
              <img class="myteam-slot-sprite" src="${largeSpriteUrl(pick.pokemonId)}" alt="${escapeHtml(pick.pokemonName)}" loading="lazy" />
              <span class="myteam-slot-name">${escapeHtml(pick.pokemonName)}</span>
              <div class="myteam-slot-types" data-poke-id="${pick.pokemonId}"></div>
              <span class="myteam-slot-dims"></span>
              ${unplayable ? `<span class="myteam-out-badge">Not playable</span>` : ""}
              ${isSelected && !locked ? selectedSlotActionsHtml() : ""}
            </div>`;
  };

  // Shown right on the selected card, so changing a Pokemon never means
  // scrolling back up to a bar at the top of the roster.
  const selectedSlotActionsHtml = () => `
    <button type="button" class="pp-slot-deselect" data-slot-action="cancel" aria-label="Cancel" title="Cancel">&times;</button>
    <span class="pp-slot-actions">
      <button type="button" class="btn pp-slot-action-btn" data-slot-action="change">Change</button>
      <button type="button" class="btn btn-secondary pp-slot-action-btn" data-slot-action="remove">Remove</button>
    </span>
    <span class="pp-slot-swap-hint">or tap another spot to swap</span>`;

  // Fills in type badges + height/weight for every filled slot in a grid,
  // once it's in the DOM (only pokemonId/pokemonName are on the team doc).
  const loadSlotDetails = (gridEl) => {
    gridEl.querySelectorAll(".myteam-slot-types[data-poke-id]").forEach((el) => {
      const id = Number(el.dataset.pokeId);
      fetchDetail(id)
        .then((detail) => {
          el.innerHTML = typeBadgesHtml(detail.types);
          const dimsEl = el.parentElement.querySelector(".myteam-slot-dims");
          if (dimsEl) dimsEl.textContent = formatImperial(detail.heightM, detail.weightKg);
        })
        .catch(() => {});
    });
  };

  let draggedPosition = null;
  let selectedPosition = null;

  const wireDragAndDrop = (gridEl) => {
    gridEl.querySelectorAll(".myteam-slot").forEach((slotEl) => {
      slotEl.addEventListener("dragstart", (event) => {
        if (!slotEl.classList.contains("myteam-slot--filled") || rosterLockReason()) {
          event.preventDefault();
          return;
        }
        draggedPosition = slotEl.dataset.position;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedPosition);
      });
      slotEl.addEventListener("dragover", (event) => {
        if (draggedPosition === null || draggedPosition === slotEl.dataset.position) return;
        event.preventDefault();
        slotEl.classList.add("myteam-slot--dragover");
      });
      slotEl.addEventListener("dragleave", () => {
        slotEl.classList.remove("myteam-slot--dragover");
      });
      slotEl.addEventListener("drop", (event) => {
        event.preventDefault();
        slotEl.classList.remove("myteam-slot--dragover");
        const fromPosition = draggedPosition;
        const toPosition = slotEl.dataset.position;
        draggedPosition = null;
        if (!fromPosition || fromPosition === toPosition) return;
        swapSlots(fromPosition, toPosition);
      });
      slotEl.addEventListener("dragend", () => {
        draggedPosition = null;
        document.querySelectorAll(".myteam-slot--dragover").forEach((el) => el.classList.remove("myteam-slot--dragover"));
      });
    });
  };

  const wireSlotClicks = (gridEl) => {
    gridEl.querySelectorAll("[data-slot-action]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        const position = btn.closest(".myteam-slot").dataset.position;
        const action = btn.dataset.slotAction;
        selectedPosition = null;
        renderMyRoster();
        if (action === "change") openSlotPickModal(position);
        else if (action === "remove") setSlot(position, null);
      });
    });
    gridEl.querySelectorAll(".myteam-slot").forEach((slotEl) => {
      slotEl.addEventListener("click", () => {
        if (rosterLockReason()) return;
        const position = slotEl.dataset.position;
        const isFilled = slotEl.classList.contains("myteam-slot--filled");

        if (selectedPosition === null) {
          if (!isFilled) {
            openSlotPickModal(position);
            return;
          }
          selectedPosition = position;
          renderMyRoster();
          return;
        }

        if (position === selectedPosition) {
          selectedPosition = null;
          renderMyRoster();
          return;
        }

        const fromPosition = selectedPosition;
        selectedPosition = null;
        renderMyRoster();
        swapSlots(fromPosition, position);
      });
    });
  };

  // Change/Remove now live on the selected card itself
  // (selectedSlotActionsHtml), so the old bar above the roster stays hidden.
  const renderSelectionBar = () => {
    selectionBarEl.hidden = true;
    selectionBarEl.innerHTML = "";
  };

  const renderMyRoster = () => {
    if (!currentUser) {
      rosterCardEl.hidden = true;
      return;
    }
    const myTeam = teamsByUid.get(currentUser.uid);
    if (!myTeam) {
      rosterCardEl.hidden = true;
      return;
    }
    rosterCardEl.hidden = false;
    myTrainingBadgesEl.innerHTML = trainingBadgesHtml(myTeam.training);
    const slots = myTeam.slots || {};
    const lockReason = rosterLockReason();
    if (lockReason) selectedPosition = null;

    rosterLockEl.hidden = !lockReason;
    rosterLockEl.textContent = lockReason || "";
    const filledCount = positions.filter((p) => slots[p]).length;
    if (!lockReason && filledCount < positions.length) {
      rosterLockEl.hidden = false;
      rosterLockEl.className = "status pp-roster-note";
      rosterLockEl.textContent = `${filledCount} of ${positions.length} spots filled - tap an empty spot to pick a Pokémon.`;
    } else {
      rosterLockEl.className = "status pp-roster-note pp-roster-note--locked";
    }

    const groupRender = (gridEl, groupPositions) => {
      gridEl.innerHTML = groupPositions.map((position) => renderSlot(position, slots, Boolean(lockReason))).join("");
      wireDragAndDrop(gridEl);
      wireSlotClicks(gridEl);
      loadSlotDetails(gridEl);
    };

    groupRender(offenseGridEl, groups.offense || []);
    groupRender(defenseGridEl, groups.defense || []);
    renderSelectionBar(slots);

    const offensePicks = (groups.offense || []).map((p) => slots[p]).filter(Boolean);
    const defensePicks = (groups.defense || []).map((p) => slots[p]).filter(Boolean);
    if (offenseRadarEl) {
      typeCountsForPicks(offensePicks).then((counts) => {
        offenseRadarEl.innerHTML = typeRadarChartHtml(counts, null, 140);
        wireTypeRadarClick(offenseRadarEl.querySelector(".type-radar-wrap"), counts, "My Offense");
      });
    }
    if (defenseRadarEl) {
      typeCountsForPicks(defensePicks).then((counts) => {
        defenseRadarEl.innerHTML = typeRadarChartHtml(counts, null, 140);
        wireTypeRadarClick(defenseRadarEl.querySelector(".type-radar-wrap"), counts, "My Defense");
      });
    }
  };

  async function swapSlots(fromPosition, toPosition) {
    if (!currentUser) return;
    const reason = rosterLockReason();
    if (reason) {
      window.alert(reason);
      return;
    }
    const teamRef = db.collection("teams").doc(currentUser.uid);
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(teamRef);
        const team = snap.data();
        if (!team || !team.slots) throw new Error("Team not found.");
        const fromValue = team.slots[fromPosition] || null;
        const toValue = team.slots[toPosition] || null;
        tx.update(teamRef, {
          [`slots.${fromPosition}`]: toValue,
          [`slots.${toPosition}`]: fromValue,
        });
      });
    } catch (error) {
      window.alert(`Unable to move Pokémon: ${error.message}`);
    }
  }

  // --- Next matchup + opponent roster (small sprites, read-only) ---

  const renderOppRow = (position, slots) => {
    const pick = slots[position];
    const middle = pick
      ? `<span class="roster-row-filled roster-row-filled--clickable" data-poke-id="${pick.pokemonId}" data-poke-name="${escapeHtml(pick.pokemonName)}">
          <img class="roster-row-sprite" src="${smallSpriteUrl(pick.pokemonId)}" alt="${escapeHtml(pick.pokemonName)}" loading="lazy" />
          ${escapeHtml(pick.pokemonName)}
        </span>`
      : `<span class="roster-row-empty">— empty —</span>`;
    return `<li class="roster-row">
              <span class="roster-row-position">${escapeHtml(position)}</span>
              ${middle}
            </li>`;
  };

  const wireOppRowClicks = () => {
    oppListEl.querySelectorAll(".roster-row-filled--clickable").forEach((el) => {
      el.addEventListener("click", () => openPokeDetail(Number(el.dataset.pokeId), el.dataset.pokeName));
    });
  };

  const formatMatchupDate = (date) => {
    if (!date) return "";
    return date.toDate().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  };

  const renderNextMatchup = () => {
    if (!currentUser) {
      matchupCardEl.hidden = true;
      return;
    }
    const upcoming = matchups
      .filter((m) => m.status === "scheduled" && (m.homeUid === currentUser.uid || m.awayUid === currentUser.uid))
      .sort((a, b) => a.date.toMillis() - b.date.toMillis())[0];

    if (!upcoming) {
      matchupCardEl.hidden = false;
      matchupMetaEl.hidden = false;
      matchupMetaEl.textContent = "No upcoming matchup scheduled yet.";
      oppHeadingEl.innerHTML = `Opponent`;
      oppListEl.innerHTML = "";
      if (oppRadarsEl) oppRadarsEl.innerHTML = "";
      matchupTrainingEl.innerHTML = "";
      return;
    }

    const opponentUid = upcoming.homeUid === currentUser.uid ? upcoming.awayUid : upcoming.homeUid;
    const opponent = teamsByUid.get(opponentUid);
    const opponentSlots = (opponent && opponent.slots) || {};

    matchupCardEl.hidden = false;
    matchupMetaEl.hidden = false;
    matchupMetaEl.textContent = `Week ${upcoming.week} — ${formatMatchupDate(upcoming.date)}`;
    const opponentName = escapeHtml(opponent ? opponent.teamName || "Unnamed Team" : "Unknown team");
    oppHeadingEl.innerHTML = `${teamAvatarHtml(opponent)} ${opponentName}<span class="training-badges">${trainingBadgesHtml(opponent && opponent.training)}</span>`;

    matchupTrainingEl.innerHTML = `
      <div class="matchup-training-side">
        <span class="matchup-training-label">You since your last game</span>
        ${trainingSpriteRowHtml(currentUser.uid, upcoming)}
      </div>
      <div class="matchup-training-side">
        <span class="matchup-training-label">${opponentName} since their last game</span>
        ${trainingSpriteRowHtml(opponentUid, upcoming)}
      </div>
    `;

    oppListEl.innerHTML = positions.map((position) => renderOppRow(position, opponentSlots)).join("");
    wireOppRowClicks();

    if (oppRadarsEl) {
      const oppOffensePicks = (groups.offense || []).map((p) => opponentSlots[p]).filter(Boolean);
      const oppDefensePicks = (groups.defense || []).map((p) => opponentSlots[p]).filter(Boolean);
      oppRadarsEl.innerHTML = "";
      Promise.all([typeCountsForPicks(oppOffensePicks), typeCountsForPicks(oppDefensePicks)]).then(([offCounts, defCounts]) => {
        oppRadarsEl.innerHTML = typeRadarChartHtml(offCounts, "Offense", 130) + typeRadarChartHtml(defCounts, "Defense", 130);
        const wraps = oppRadarsEl.querySelectorAll(".type-radar-wrap");
        if (wraps[0]) wireTypeRadarClick(wraps[0], offCounts, "Opponent Offense");
        if (wraps[1]) wireTypeRadarClick(wraps[1], defCounts, "Opponent Defense");
      });
    }
  };

  const renderAll = () => {
    renderMyRoster();
    renderNextMatchup();
    renderTraining();
  };

  // --- Live listeners ---

  let unsubscribers = [];

  const subscribe = () => {
    unsubscribers.forEach((u) => u());
    unsubscribers = [];
    todayLog = null;

    if (!currentUser) {
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.innerHTML = `Sign in on the <a href="pokemon-league.html">League Home</a> page to view your team.`;
      rosterCardEl.hidden = true;
      matchupCardEl.hidden = true;
      trainingCardEl.hidden = true;
      return;
    }

    statusEl.hidden = true;

    unsubscribers.push(
      db
        .collection("trainingLog")
        .doc(`${currentUser.uid}_${dateKey()}`)
        .onSnapshot((doc) => {
          todayLog = doc.exists ? doc.data() : null;
          renderAll();
        }, () => {})
    );

    unsubscribers.push(
      db.collection("teams").onSnapshot(
        (snapshot) => {
          teamsByUid = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
          if (!teamsByUid.has(currentUser.uid)) {
            statusEl.hidden = false;
            statusEl.className = "status";
            statusEl.innerHTML = `You haven't joined the league yet - head to <a href="pokemon-league.html">League Home</a> to sign up.`;
            rosterCardEl.hidden = true;
            matchupCardEl.hidden = true;
            return;
          }
          statusEl.hidden = true;
          renderAll();
        },
        (error) => {
          statusEl.hidden = false;
          statusEl.className = "status error";
          statusEl.textContent = `Unable to load your team: ${error.message}`;
        }
      )
    );

    unsubscribers.push(
      db.collection("matchups").onSnapshot((snapshot) => {
        matchups = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        renderAll();
      }, () => {})
    );

    unsubscribers.push(
      db.collection("trainingLog").onSnapshot((snapshot) => {
        trainingLog = snapshot.docs.map((doc) => doc.data());
        renderAll();
      }, () => {})
    );

    unsubscribers.push(
      db
        .collection("leagueSettings")
        .doc("current")
        .onSnapshot((doc) => {
          leagueSettings = doc.exists ? doc.data() : null;
          renderAll();
        }, () => {})
    );
  };

  auth.onAuthStateChanged((user) => {
    currentUser = user;
    subscribe();
  });

  // If the page is left open across local midnight, re-point the today's-
  // log listener and re-render so a new day's training unlocks without a
  // manual refresh. The roster lock is now a plain admin switch, so its
  // own leagueSettings listener above already re-renders when it flips -
  // no polling needed for that part.
  let lastSeenDateKey = dateKey();
  setInterval(() => {
    const nowKey = dateKey();
    if (nowKey !== lastSeenDateKey) {
      lastSeenDateKey = nowKey;
      subscribe();
    }
  }, 30000);
})();
