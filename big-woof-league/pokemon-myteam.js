(function () {
  const config = window.siteConfig || {};
  const statusEl = document.getElementById("myteam-status");
  const rosterCardEl = document.getElementById("myteam-roster-card");
  const offenseGridEl = document.getElementById("myteam-offense-grid");
  const defenseGridEl = document.getElementById("myteam-defense-grid");
  const offenseRadarEl = document.getElementById("myteam-offense-radar");
  const defenseRadarEl = document.getElementById("myteam-defense-radar");
  const oppRadarsEl = document.getElementById("myteam-opp-radars");
  const specialGridEl = document.getElementById("myteam-special-grid");
  const benchGridEl = document.getElementById("myteam-bench-grid");
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
  const tradesCardEl = document.getElementById("trades-card");
  const tradesIncomingAreaEl = document.getElementById("trades-incoming-area");
  const tradesOutgoingAreaEl = document.getElementById("trades-outgoing-area");
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

  // Best-effort only - never block the real action on this. Called AFTER
  // a transaction commits, never from inside its callback (which Firestore
  // can retry on contention - a fetch() isn't part of the transaction's
  // buffered writes, so calling it inside would risk duplicate posts).
  const notifyDiscord = (text) => {
    if (!config.discordWebhookUrl) return;
    fetch(config.discordWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    }).catch(() => {});
  };

  const smallSpriteUrl = (pokemonId) =>
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemonId}.png`;
  const largeSpriteUrl = (pokemonId) =>
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokemonId}.png`;
  const itemSpriteUrl = (item) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${item}.png`;

  // --- PokeAPI detail (type/height/weight) caching, duplicated from
  // pokemon-dex.js by this repo's one-file-per-page convention. Uses the
  // same cache keys, so a browser that already visited the Pokedex often
  // hits localStorage instead of the network here. ---

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

  // heightM/weightKg are stored metric (what PokeAPI returns), displayed
  // in feet/inches and pounds.
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
    statusEl.textContent = "Fantasy League is not configured yet.";
    return;
  }

  firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const groups = config.positionGroups || { offense: [], defense: [], specialTeams: [], bench: [] };

  let currentUser = null;
  let teamsByUid = new Map();
  let matchups = [];
  let currentWeek = null;
  let todayLog = null;
  let seasonState = null;
  let trainingLog = [];
  let pendingTrades = [];

  // --- Training ---

  // A team's "week" of training isn't a fixed calendar block - a game ends
  // it. Teams rotate through Thu/Sun/Mon, so the gap between a team's own
  // two consecutive games varies (Thursday one week, Sunday the next) -
  // this looks up that team's actual previous game relative to the
  // matchup being shown, same logic as the Schedule page. Resets to empty
  // every new game by design, unlike the streak/bonus badges above, which
  // intentionally persist across games.
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

  const trainingSinceLastGame = (uid, currentMatchup) => {
    if (!currentMatchup.date) return [];
    const prev = previousMatchupFor(uid, currentMatchup);
    const startMs = prev && prev.date ? prev.date.toMillis() : null;
    const endMs = currentMatchup.date.toMillis();
    return trainingLog
      .filter((log) => log.uid === uid)
      .filter((log) => {
        const logMs = new Date(`${log.date}T12:00:00`).getTime();
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

  const trainingBadgesHtml = (training) => {
    const t = training || {};
    const streak = t.currentStreak || 0;
    const bonus = t.bonusSessionsAvailable || 0;
    const parts = [];
    if (streak > 0) parts.push(`<span class="training-badge training-badge--streak">🔥 ${streak}-day training streak</span>`);
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
        bonusAvailable > 0
          ? `You have a bonus session banked - pick up to 2 today.`
          : `Pick today's training session.`;
    } else if (!quotaUsed) {
      trainingMetaEl.textContent = `One more session available today (bonus session banked).`;
    } else {
      trainingMetaEl.textContent = `Today's training is done. Come back tomorrow.`;
    }

    trainingButtonsEl.innerHTML = trainingTypes
      .map((type) => {
        const alreadyDone = doneToday.includes(type.key);
        const disabled = alreadyDone || quotaUsed;
        return `<button type="button" class="training-btn${alreadyDone ? " training-btn--done" : ""}" data-key="${type.key}"
                  style="--training-color: ${type.color}" ${disabled ? "disabled" : ""}>
                  <img class="training-btn-sprite" src="${itemSpriteUrl(type.item)}" alt="" loading="lazy" />
                  <span>${escapeHtml(type.label)}</span>
                  ${alreadyDone ? `<span class="training-btn-check">✓ Done today</span>` : ""}
                </button>`;
      })
      .join("");

    trainingButtonsEl.querySelectorAll(".training-btn:not([disabled])").forEach((btn) => {
      btn.addEventListener("click", () => logTraining(btn.dataset.key));
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
      showTrainingMessage(`Your team had a good ${type.label} session today!`);
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
  });
  if (trainingInfoPopoverEl) {
    trainingInfoPopoverEl.innerHTML = (config.trainingInfoBlurb || "")
      .split("\n\n")
      .map((para) => `<p>${escapeHtml(para)}</p>`)
      .join("");
  }

  // --- Cheerleaders: a purely cosmetic for-fun extra. A team that opts
  // in gets 5 small slots (teams/{uid}.cheerSlots, a map keyed "0".."4"
  // so each slot can be written independently via dot-notation - a plain
  // array can't be patched by index in Firestore) that can hold any
  // Pokemon not currently drafted - doesn't touch the real roster, the
  // draft, or scoring in any way. ---

  let pendingCheerSlot = null;

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

  let cheerPickList = null; // lazy-loaded full Pokedex name/id list
  let cheerDraftedIds = new Set(); // refreshed each time the picker opens

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

    const removeBtn = document.getElementById("cheer-remove-btn");
    if (removeBtn) removeBtn.addEventListener("click", () => saveCheerSlot(slotIndex, null));

    try {
      const [list, draftedSnapshot] = await Promise.all([
        cheerPickList ? Promise.resolve(cheerPickList) : fetchList(),
        db.collection("draftedPokemon").get(),
      ]);
      cheerPickList = list;
      cheerDraftedIds = new Set(draftedSnapshot.docs.map((doc) => Number(doc.id)));
      cheerPickStatusEl.hidden = true;
      cheerPickStatusEl.textContent = "";
      renderCheerPickResults("");
    } catch (error) {
      cheerPickStatusEl.textContent = `Unable to load Pokémon: ${error.message}`;
    }
  };

  const closeCheerPickModal = () => {
    cheerPickModalEl.hidden = true;
    pendingCheerSlot = null;
  };
  if (cheerPickCloseBtnEl) cheerPickCloseBtnEl.addEventListener("click", closeCheerPickModal);

  const renderCheerPickResults = (search) => {
    if (!cheerPickList) return;
    const term = search.trim().toLowerCase();
    if (!term) {
      cheerPickGridEl.innerHTML = "";
      return;
    }
    const matches = cheerPickList
      .filter((p) => p.name.includes(term) && !legendaryIds.has(p.id) && !cheerDraftedIds.has(p.id))
      .slice(0, 48);
    if (!matches.length) {
      cheerPickGridEl.innerHTML = `<p class="status">No undrafted Pokémon match "${escapeHtml(search)}".</p>`;
      return;
    }
    cheerPickGridEl.innerHTML = matches
      .map(
        (p) =>
          `<div class="cheer-pick-card" data-id="${p.id}" data-name="${escapeHtml(p.name)}">
            <img src="${smallSpriteUrl(p.id)}" alt="${escapeHtml(p.name)}" loading="lazy" />
            <span>${escapeHtml(p.name)}</span>
          </div>`
      )
      .join("");
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

  // --- My roster: draggable, square, large-sprite slots ---

  const renderSlot = (position, slots) => {
    const pick = slots[position];
    const isOut = pick && currentWeek !== null && pick.outForWeek === currentWeek;
    if (!pick) {
      return `<div class="myteam-slot" data-position="${escapeHtml(position)}">
                <span class="myteam-slot-position">${escapeHtml(position)}</span>
                <span class="myteam-slot-empty">— empty —</span>
              </div>`;
    }
    const isSelected = position === selectedPosition;
    return `<div class="myteam-slot myteam-slot--filled${isOut ? " myteam-slot--out" : ""}${
      isSelected ? " myteam-slot--selected" : ""
    }" draggable="true" data-position="${escapeHtml(position)}">
              <span class="myteam-slot-position">${escapeHtml(position)}</span>
              <img class="myteam-slot-sprite" src="${largeSpriteUrl(pick.pokemonId)}" alt="${escapeHtml(pick.pokemonName)}" loading="lazy" />
              <span class="myteam-slot-name">${escapeHtml(pick.pokemonName)}</span>
              <div class="myteam-slot-types" data-poke-id="${pick.pokemonId}"></div>
              <span class="myteam-slot-dims"></span>
              ${isOut ? `<span class="myteam-out-badge">OUT — Wk ${pick.outForWeek}</span>` : ""}
            </div>`;
  };

  // Fills in type badges + height/weight for every filled slot in a grid,
  // once it's in the DOM - this info isn't on the team doc itself (only
  // pokemonId/pokemonName are), so it's a PokeAPI lookup per slot, same as
  // the Pokedex page.
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
  // Click/tap alternative to drag-and-drop (native HTML5 DnD doesn't work
  // well on mobile touch). Tap a filled slot to select it, then tap any
  // other slot to swap - tapping the selected slot again deselects. A real
  // drag gesture never fires a click on the same element afterward, so this
  // coexists with wireDragAndDrop below without double-firing.
  let selectedPosition = null;

  const wireDragAndDrop = (gridEl) => {
    gridEl.querySelectorAll(".myteam-slot").forEach((slotEl) => {
      slotEl.addEventListener("dragstart", (event) => {
        if (!slotEl.classList.contains("myteam-slot--filled")) {
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
        gridEl.querySelectorAll(".myteam-slot--dragover").forEach((el) => el.classList.remove("myteam-slot--dragover"));
      });
    });
  };

  const wireClickToSwap = (gridEl) => {
    gridEl.querySelectorAll(".myteam-slot").forEach((slotEl) => {
      slotEl.addEventListener("click", () => {
        const position = slotEl.dataset.position;
        const isFilled = slotEl.classList.contains("myteam-slot--filled");

        if (selectedPosition === null) {
          if (!isFilled) return;
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

    const groupRender = (gridEl, positions) => {
      gridEl.innerHTML = positions.map((position) => renderSlot(position, slots)).join("");
      wireDragAndDrop(gridEl);
      wireClickToSwap(gridEl);
      loadSlotDetails(gridEl);
    };

    groupRender(offenseGridEl, groups.offense || []);
    groupRender(defenseGridEl, groups.defense || []);
    groupRender(specialGridEl, groups.specialTeams || []);
    groupRender(benchGridEl, groups.bench || []);

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
      oppHeadingEl.innerHTML = `Opponent<span class="training-badges" id="myteam-opp-training-badges"></span>`;
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

    const positions = config.pokemonPositions || [];
    oppListEl.innerHTML = positions.map((position) => renderOppRow(position, opponentSlots)).join("");
    wireOppRowClicks();

    if (oppRadarsEl) {
      const oppOffensePicks = (groups.offense || []).map((p) => opponentSlots[p]).filter(Boolean);
      const oppDefensePicks = (groups.defense || []).map((p) => opponentSlots[p]).filter(Boolean);
      oppRadarsEl.innerHTML = "";
      Promise.all([typeCountsForPicks(oppOffensePicks), typeCountsForPicks(oppDefensePicks)]).then(([offCounts, defCounts]) => {
        oppRadarsEl.innerHTML =
          typeRadarChartHtml(offCounts, "Offense", 130) + typeRadarChartHtml(defCounts, "Defense", 130);
        const wraps = oppRadarsEl.querySelectorAll(".type-radar-wrap");
        if (wraps[0]) wireTypeRadarClick(wraps[0], offCounts, "Opponent Offense");
        if (wraps[1]) wireTypeRadarClick(wraps[1], defCounts, "Opponent Defense");
      });
    }
  };

  // --- Trades ---

  // Same "active week" + eligibility logic as the Rosters page (where
  // trades are proposed) - a trade is blocked only when exactly one of
  // the two teams has already played its game for the active week.
  const currentActiveWeek = () => {
    const unplayed = matchups.filter((m) => m.round === "regular" && m.status !== "final");
    if (!unplayed.length) return null;
    return Math.min(...unplayed.map((m) => m.week));
  };

  const hasPlayedActiveWeek = (uid) => {
    const week = currentActiveWeek();
    if (week === null) return false;
    const matchup = matchups.find((m) => m.week === week && (m.homeUid === uid || m.awayUid === uid));
    return Boolean(matchup && matchup.status === "final");
  };

  const tradeEligible = (uidA, uidB) => hasPlayedActiveWeek(uidA) === hasPlayedActiveWeek(uidB);

  const emptySlotCount = (team) => (config.pokemonPositions || []).filter((p) => !(team.slots || {})[p]).length;

  let tradeMessageTimeout = null;
  const showTradeMessage = (text, isError) => {
    const el = document.createElement("p");
    el.className = `status${isError ? " error" : ""}`;
    el.textContent = text;
    tradesCardEl.insertBefore(el, tradesCardEl.firstChild.nextSibling);
    clearTimeout(tradeMessageTimeout);
    tradeMessageTimeout = setTimeout(() => el.remove(), 6000);
  };

  const renderTradeCard = (trade, isIncoming) => {
    const otherUid = isIncoming ? trade.fromUid : trade.toUid;
    const otherTeam = teamsByUid.get(otherUid);
    const otherName = isIncoming ? trade.fromTeamName : trade.toTeamName;
    const giveLabel = isIncoming ? "They give" : "You give";
    const receiveLabel = isIncoming ? "They receive" : "You receive";
    // From the viewer's own perspective: an incoming trade's "give" (the
    // proposer's offer) is what the viewer would receive, and vice versa.
    const viewerReceives = isIncoming ? trade.give : trade.receive;
    const viewerGives = isIncoming ? trade.receive : trade.give;
    const listNames = (items) => items.map((p) => escapeHtml(p.pokemonName)).join(", ");
    const actions = isIncoming
      ? `<button type="button" class="btn trade-accept-btn" data-id="${trade.id}">Accept</button>
         <button type="button" class="btn btn-secondary trade-deny-btn" data-id="${trade.id}">Deny</button>`
      : `<button type="button" class="btn btn-secondary trade-cancel-btn" data-id="${trade.id}">Cancel Proposal</button>`;
    return `<div class="card trade-pending-card">
              <p><strong>${isIncoming ? "From" : "To"}:</strong> ${teamAvatarHtml(otherTeam, "team-avatar--sm")} ${escapeHtml(otherName)}</p>
              <p><strong>${receiveLabel}:</strong> ${listNames(viewerReceives)}</p>
              <p><strong>${giveLabel}:</strong> ${listNames(viewerGives)}</p>
              ${actions}
            </div>`;
  };

  const renderTrades = () => {
    if (!currentUser) {
      tradesCardEl.hidden = true;
      return;
    }
    const incoming = pendingTrades.filter((t) => t.toUid === currentUser.uid);
    const outgoing = pendingTrades.filter((t) => t.fromUid === currentUser.uid);
    tradesCardEl.hidden = incoming.length === 0 && outgoing.length === 0;
    if (tradesCardEl.hidden) return;

    tradesIncomingAreaEl.innerHTML = incoming.map((t) => renderTradeCard(t, true)).join("");
    tradesOutgoingAreaEl.innerHTML = outgoing.map((t) => renderTradeCard(t, false)).join("");

    tradesIncomingAreaEl.querySelectorAll(".trade-accept-btn").forEach((btn) => {
      btn.addEventListener("click", () => acceptTrade(btn.dataset.id));
    });
    tradesIncomingAreaEl.querySelectorAll(".trade-deny-btn").forEach((btn) => {
      btn.addEventListener("click", () => resolveTrade(btn.dataset.id, "rejected"));
    });
    tradesOutgoingAreaEl.querySelectorAll(".trade-cancel-btn").forEach((btn) => {
      btn.addEventListener("click", () => resolveTrade(btn.dataset.id, "cancelled"));
    });
  };

  async function resolveTrade(tradeId, status) {
    try {
      await db.collection("trades").doc(tradeId).update({ status, resolvedAt: firebase.firestore.FieldValue.serverTimestamp() });
    } catch (error) {
      showTradeMessage(error.message, true);
    }
  }

  // Destination slots for whatever each side ends up receiving are
  // assigned here, deterministically - vacated slots first (in the order
  // offered), then any other open slots for the overflow on an uneven
  // trade. Positions carry no real restriction anywhere else in this app
  // either, so there's no "right" slot beyond "an open one."
  async function acceptTrade(tradeId) {
    if (!currentUser) return;
    const trade = pendingTrades.find((t) => t.id === tradeId);
    if (!trade) return;

    const fromRef = db.collection("teams").doc(trade.fromUid);
    const toRef = db.collection("teams").doc(trade.toUid);
    const tradeRef = db.collection("trades").doc(tradeId);
    let announceText = null;

    try {
      await db.runTransaction(async (tx) => {
        const [tradeSnap, fromSnap, toSnap] = await Promise.all([tx.get(tradeRef), tx.get(fromRef), tx.get(toRef)]);
        const freshTrade = tradeSnap.data();
        if (!freshTrade || freshTrade.status !== "pending") throw new Error("This trade is no longer pending.");

        const fromTeam = fromSnap.data();
        const toTeam = toSnap.data();
        if (!fromTeam || !toTeam) throw new Error("One of the teams in this trade no longer exists.");

        if (!tradeEligible(trade.fromUid, trade.toUid)) {
          throw new Error("This trade is blocked for now - one team has already played this week and the other hasn't.");
        }

        const give = freshTrade.give; // fromUid's pokemon -> land on toUid's roster
        const receive = freshTrade.receive; // toUid's pokemon -> land on fromUid's roster

        // Re-verify every traded Pokemon is still exactly where the
        // proposal said it was - if either roster has changed since (a
        // free-agent swap, a drag-and-drop move, another trade), this
        // trade is stale and must be re-proposed rather than silently
        // moving the wrong thing.
        const stillThere = (team, items) =>
          items.every((item) => {
            const atSlot = (team.slots || {})[item.position];
            return atSlot && atSlot.pokemonId === item.pokemonId;
          });
        if (!stillThere(fromTeam, give) || !stillThere(toTeam, receive)) {
          throw new Error("This trade is stale - one of the rosters has changed since it was proposed. Ask them to re-propose it.");
        }

        // Capacity: vacated slots first, then overflow needs open slots.
        const fromOpen = emptySlotCount(fromTeam);
        const toOpen = emptySlotCount(toTeam);
        if (receive.length > give.length + fromOpen) {
          throw new Error(`${fromTeam.teamName} doesn't have enough open roster slots to complete this trade.`);
        }
        if (give.length > receive.length + toOpen) {
          throw new Error(`${toTeam.teamName} doesn't have enough open roster slots to complete this trade.`);
        }

        const assignDestinations = (team, vacatedPositions, incomingItems) => {
          const slots = team.slots || {};
          const destinations = [...vacatedPositions];
          (config.pokemonPositions || []).forEach((p) => {
            if (!slots[p] && !destinations.includes(p)) destinations.push(p);
          });
          const assignments = new Map();
          incomingItems.forEach((item, i) => assignments.set(item.pokemonId, destinations[i]));
          return assignments;
        };

        // toTeam vacates the slots named in `receive` (what it's giving away).
        const toVacated = receive.map((i) => i.position);
        const toDest = assignDestinations(toTeam, toVacated, give);
        const fromVacated = give.map((i) => i.position);
        const fromDest = assignDestinations(fromTeam, fromVacated, receive);

        const fromSlotUpdates = {};
        const toSlotUpdates = {};
        fromVacated.forEach((position) => (fromSlotUpdates[`slots.${position}`] = null));
        toVacated.forEach((position) => (toSlotUpdates[`slots.${position}`] = null));
        give.forEach((item) => {
          const destPosition = toDest.get(item.pokemonId);
          toSlotUpdates[`slots.${destPosition}`] = { pokemonId: item.pokemonId, pokemonName: item.pokemonName, traded: true };
          tx.update(db.collection("draftedPokemon").doc(String(item.pokemonId)), {
            uid: trade.toUid,
            teamName: toTeam.teamName,
            slot: destPosition,
            tradeId,
          });
        });
        receive.forEach((item) => {
          const destPosition = fromDest.get(item.pokemonId);
          fromSlotUpdates[`slots.${destPosition}`] = { pokemonId: item.pokemonId, pokemonName: item.pokemonName, traded: true };
          tx.update(db.collection("draftedPokemon").doc(String(item.pokemonId)), {
            uid: trade.fromUid,
            teamName: fromTeam.teamName,
            slot: destPosition,
            tradeId,
          });
        });

        // tradeId lets firestore.rules verify this cross-team write is
        // tied to this specific, still-pending, mutually-agreed trade -
        // see isPendingTradeBetween in firestore.rules.
        fromSlotUpdates.tradeId = tradeId;
        toSlotUpdates.tradeId = tradeId;
        tx.update(fromRef, fromSlotUpdates);
        tx.update(toRef, toSlotUpdates);
        tx.update(tradeRef, { status: "accepted", resolvedAt: firebase.firestore.FieldValue.serverTimestamp() });
        announceText = `${fromTeam.teamName} and ${toTeam.teamName} completed a trade: ${give.map((i) => i.pokemonName).join(", ")} for ${receive.map((i) => i.pokemonName).join(", ")}`;
        tx.set(db.collection("chatMessages").doc(), {
          uid: currentUser.uid,
          system: true,
          text: announceText,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
      if (announceText) notifyDiscord(announceText);
    } catch (error) {
      showTradeMessage(error.message, true);
    }
  }

  const renderAll = () => {
    renderMyRoster();
    renderNextMatchup();
    renderTraining();
    renderTrades();
  };

  // --- Live listeners ---

  let unsubscribeTeams = null;
  let unsubscribeMatchups = null;
  let unsubscribeTodayLog = null;
  let unsubscribeSeason = null;
  let unsubscribeTrainingLog = null;
  let unsubscribeTrades = null;

  const subscribe = () => {
    [unsubscribeTeams, unsubscribeMatchups, unsubscribeSeason, unsubscribeTodayLog, unsubscribeTrainingLog, unsubscribeTrades].forEach(
      (unsubscribe) => unsubscribe && unsubscribe()
    );
    unsubscribeTeams = unsubscribeMatchups = unsubscribeSeason = unsubscribeTodayLog = unsubscribeTrainingLog = unsubscribeTrades = null;
    todayLog = null;

    if (!currentUser) {
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.innerHTML = `Sign in on the <a href="pokemon-league.html">League Home</a> page to view your team.`;
      rosterCardEl.hidden = true;
      matchupCardEl.hidden = true;
      trainingCardEl.hidden = true;
      tradesCardEl.hidden = true;
      return;
    }

    unsubscribeTodayLog = db
      .collection("trainingLog")
      .doc(`${currentUser.uid}_${dateKey()}`)
      .onSnapshot(
        (doc) => {
          todayLog = doc.exists ? doc.data() : null;
          renderAll();
        },
        () => {}
      );

    statusEl.hidden = true;

    unsubscribeTeams = db.collection("teams").onSnapshot(
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
    );

    unsubscribeMatchups = db.collection("matchups").onSnapshot(
      (snapshot) => {
        matchups = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        renderAll();
      },
      () => {}
    );

    unsubscribeTrainingLog = db.collection("trainingLog").onSnapshot(
      (snapshot) => {
        trainingLog = snapshot.docs.map((doc) => doc.data());
        renderAll();
      },
      () => {}
    );

    unsubscribeTrades = db
      .collection("trades")
      .where("status", "==", "pending")
      .onSnapshot((snapshot) => {
        pendingTrades = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        renderAll();
      }, () => {});

    unsubscribeSeason = db
      .collection("seasonState")
      .doc("current")
      .onSnapshot(
        (doc) => {
          seasonState = doc.exists ? doc.data() : null;
          currentWeek = seasonState ? seasonState.currentWeek ?? null : null;
          renderAll();
        },
        () => {}
      );
  };

  auth.onAuthStateChanged((user) => {
    currentUser = user;
    subscribe();
  });

  // If the page is left open across local midnight, re-point the today's-
  // log listener and re-render so a new day's training actually unlocks
  // without needing a manual refresh.
  let lastSeenDateKey = dateKey();
  setInterval(() => {
    const nowKey = dateKey();
    if (nowKey !== lastSeenDateKey) {
      lastSeenDateKey = nowKey;
      subscribe();
    }
  }, 30000);
})();
