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

  // Best-effort only - never block the real action on this.
  const notifyDiscord = (text) => {
    if (!config.discordWebhookUrl) return;
    fetch(config.discordWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    }).catch(() => {});
  };

  const spriteUrl = (pokemonId) =>
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemonId}.png`;

  const teamAvatarHtml = (team, sizeClass = "") => {
    const name = (team && team.teamName) || "?";
    const cls = `team-avatar${sizeClass ? ` ${sizeClass}` : ""}`;
    if (team && team.photoURL) {
      return `<img class="${cls}" src="${escapeHtml(team.photoURL)}" alt="${escapeHtml(name)}" loading="lazy" />`;
    }
    return `<span class="${cls} team-avatar-placeholder">${escapeHtml(name.charAt(0) || "?")}</span>`;
  };

  // --- PokeAPI detail caching + type-composition radar chart (duplicated
  // per this repo's one-file-per-page convention). ---

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

  const typeWheelOrder = config.typeWheelOrder || [];

  // picks: array of filled slot values ({pokemonId, ...}) for one
  // position group. A dual-type Pokemon counts toward both of its types.
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

  // Per-team, per-group scale: the furthest point on the wheel is that
  // group's own highest type count, not a fixed/shared value - a team
  // with 5 Ice-types maxes its wheel the same way one with 10 Fire-types
  // maxes its own. labeled=true (the expanded/hovered view) also draws
  // each type's name - fine at a bigger size, but 18 of them at the
  // compact size is just clutter, so the compact view leaves them out.
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
          const [x, y] = pointFor(i, max * 1.1);
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
    if (max === 0) return; // nothing to show - leave it non-interactive
    wrapEl.addEventListener("click", () => openTypeRadarModal(counts, caption));
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

  if (!config.firebaseConfig || config.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") {
    statusEl.className = "status error";
    statusEl.textContent = "Fantasy League is not configured yet.";
    return;
  }

  firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const groups = config.positionGroups || { offense: [], defense: [], specialTeams: [] };
  const trainingTypeList = config.trainingTypes || [];

  const isAdmin = () =>
    Boolean(currentUser && config.adminUid && config.adminUid !== "YOUR_ADMIN_UID" && currentUser.uid === config.adminUid);

  let currentUser = null;
  let myTeam = null;
  let draftedMap = new Map();
  let currentWeek = null;
  let draftState = null;
  let seasonState = null;

  const draftIsComplete = () => Boolean(draftState && draftState.status === "complete");

  // --- Admin export: roster + training, for feeding into an external
  // results tool. Training "since last game" uses the same per-team
  // previous-matchup lookup as the Schedule/My Team pages (a game ends a
  // team's training window, not a fixed calendar week), plus a season-to-
  // date total per type for the fuller picture. ---

  let matchups = [];
  let trainingLog = [];

  const previousMatchupFor = (uid, currentMatchup) => {
    if (!currentMatchup || !currentMatchup.date) return null;
    return (
      matchups
        .filter(
          (m) => (m.homeUid === uid || m.awayUid === uid) && m.date && m.date.toMillis() < currentMatchup.date.toMillis()
        )
        .sort((a, b) => b.date.toMillis() - a.date.toMillis())[0] || null
    );
  };

  const nextMatchupFor = (uid) =>
    matchups
      .filter((m) => m.status === "scheduled" && (m.homeUid === uid || m.awayUid === uid) && m.date)
      .sort((a, b) => a.date.toMillis() - b.date.toMillis())[0] || null;

  const trainingSinceLastGame = (uid, currentMatchup) => {
    if (!currentMatchup || !currentMatchup.date) return [];
    const prev = previousMatchupFor(uid, currentMatchup);
    const startMs = prev && prev.date ? prev.date.toMillis() : null;
    const endMs = currentMatchup.date.toMillis();
    return trainingLog
      .filter((log) => log.uid === uid)
      .filter((log) => {
        const logMs = new Date(`${log.date}T12:00:00`).getTime();
        return (startMs === null || logMs > startMs) && logMs <= endMs;
      })
      .flatMap((log) => log.types || []);
  };

  // --- Trading ---

  // The regular season's "active" week - the earliest week number that
  // still has an unplayed game. Not seasonState.currentWeek, since nothing
  // auto-advances that during the regular season (only playoffs do) - this
  // derives it live from the matchups themselves instead.
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

  // Blocked only when exactly one side has already played this week and
  // the other hasn't - that's the only way a traded Pokemon could
  // effectively play twice in the same week for two different teams. Two
  // teams that are both pre-game or both post-game for the week can trade
  // freely.
  const tradeEligible = (uidA, uidB) => hasPlayedActiveWeek(uidA) === hasPlayedActiveWeek(uidB);

  const countByType = (typeKeys) => {
    const counts = new Map();
    typeKeys.forEach((key) => counts.set(key, (counts.get(key) || 0) + 1));
    return counts;
  };

  const csvField = (value) => {
    const str = String(value ?? "");
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const csvRow = (values) => values.map(csvField).join(",") + "\r\n";

  const exportTeamCsv = (team) => {
    const uid = team.uid;
    const training = team.training || {};
    const seasonCounts = countByType(trainingLog.filter((log) => log.uid === uid).flatMap((log) => log.types || []));
    const upcoming = nextMatchupFor(uid);
    const sinceLastCounts = countByType(upcoming ? trainingSinceLastGame(uid, upcoming) : []);

    let csv = "";
    csv += csvRow(["Team", team.teamName || "Unnamed Team"]);
    csv += csvRow(["Training Streak (days)", training.currentStreak || 0]);
    csv += csvRow(["Bonus Sessions Banked", training.bonusSessionsAvailable || 0]);
    csv += csvRow([
      "Next Matchup",
      upcoming ? `Week ${upcoming.week} - ${upcoming.date.toDate().toLocaleDateString("en-US")}` : "None scheduled",
    ]);
    csv += "\r\n";

    csv += csvRow(["Training Since Last Game", "Count"]);
    trainingTypeList.forEach((type) => csv += csvRow([type.label, sinceLastCounts.get(type.key) || 0]));
    csv += "\r\n";

    csv += csvRow(["Training Totals (Season)", "Count"]);
    trainingTypeList.forEach((type) => csv += csvRow([type.label, seasonCounts.get(type.key) || 0]));
    csv += "\r\n";

    csv += csvRow(["Roster Position", "Pokemon ID", "Pokemon Name"]);
    (config.pokemonPositions || []).forEach((position) => {
      const pick = (team.slots || {})[position];
      csv += csvRow([position, pick ? pick.pokemonId : "", pick ? pick.pokemonName : ""]);
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const safeName = (team.teamName || "team").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    link.download = `${safeName}-roster-training.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const pokemonInPendingTrade = (teamUid, pokemonId) =>
    pendingTrades.some(
      (t) =>
        (t.fromUid === teamUid && t.give.some((item) => item.pokemonId === pokemonId)) ||
        (t.toUid === teamUid && t.receive.some((item) => item.pokemonId === pokemonId))
    );

  const renderRow = (position, slots, isMine, teamUid) => {
    const pick = slots[position];
    const isOut = pick && currentWeek !== null && pick.outForWeek === currentWeek;
    let middle;
    if (pick) {
      const locked = pokemonInPendingTrade(teamUid, pick.pokemonId);
      const canPropose = !isMine && currentUser && draftIsComplete() && !locked;
      middle = `<span class="roster-row-filled${canPropose ? " roster-row-filled--tradeable" : ""}"${
        canPropose
          ? ` data-trade-target="1" data-uid="${escapeHtml(teamUid)}" data-slot="${escapeHtml(position)}" data-id="${pick.pokemonId}" data-name="${escapeHtml(pick.pokemonName)}" title="Click to propose a trade for this Pokémon"`
          : ""
      }>
          <img class="roster-row-sprite" src="${spriteUrl(pick.pokemonId)}" alt="${escapeHtml(pick.pokemonName)}" loading="lazy" />
          ${escapeHtml(pick.pokemonName)}
        </span>
        ${isMine ? `<button type="button" class="roster-remove-btn" data-slot="${escapeHtml(position)}" data-id="${pick.pokemonId}" data-name="${escapeHtml(pick.pokemonName)}" title="Remove from roster">✕</button>` : ""}
        ${!isMine && locked ? `<span class="roster-row-empty" style="flex: 0;">(trade pending)</span>` : ""}`;
    } else if (isMine && draftIsComplete()) {
      middle = `<span class="roster-row-empty">— empty — (sign a free agent from the <a href="pokemon-dex.html">Pokédex</a>)</span>`;
    } else if (isMine) {
      middle = `<span class="roster-row-empty">— empty — (free agency opens after the draft)</span>`;
    } else {
      middle = `<span class="roster-row-empty">— empty —</span>`;
    }
    return `<li class="roster-row">
              <span class="roster-row-position">${escapeHtml(position)}</span>
              ${middle}
              ${isOut ? `<span class="out-badge">OUT — Week ${pick.outForWeek}</span>` : ""}
            </li>`;
  };

  const renderTeams = (teams) => {
    const isAdminViewer = isAdmin();
    // Hidden teams (admin-only toggle) stay off everyone else's view -
    // the admin still sees them here, badged, to be able to unhide later.
    const visibleTeams = teams.filter((team) => !team.hidden || isAdminViewer);

    if (!visibleTeams.length) {
      listEl.innerHTML = "";
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.textContent = "No teams yet.";
      return;
    }
    statusEl.hidden = true;
    listEl.innerHTML = visibleTeams
      .map((team) => {
        const isMine = currentUser && team.ownerUid === currentUser.uid;
        const slots = team.slots || {};
        const offenseRows = groups.offense.map((p) => renderRow(p, slots, isMine, team.uid)).join("");
        const defenseRows = groups.defense.map((p) => renderRow(p, slots, isMine, team.uid)).join("");
        const kickerRows = groups.specialTeams.map((p) => renderRow(p, slots, isMine, team.uid)).join("");
        const benchRows = (groups.bench || []).map((p) => renderRow(p, slots, isMine, team.uid)).join("");
        const exportBtn = isAdminViewer
          ? `<button type="button" class="btn btn-secondary export-team-btn" data-uid="${escapeHtml(team.uid)}">Export</button>`
          : "";
        const hideBtn = isAdminViewer
          ? `<button type="button" class="btn btn-secondary hide-team-btn" data-uid="${escapeHtml(team.uid)}" data-hidden="${team.hidden ? "true" : "false"}">${team.hidden ? "Show" : "Hide"}</button>`
          : "";
        const hiddenBadge = team.hidden ? `<span class="training-badge training-badge--hidden">HIDDEN</span>` : "";
        return `<section class="card">
                  <h2>${teamAvatarHtml(team)} ${escapeHtml(team.teamName || "Unnamed Team")}<span class="training-badges">${trainingBadgesHtml(team.training)}${hiddenBadge}</span>${exportBtn}${hideBtn}</h2>
                  <div class="roster-columns">
                    <div class="roster-column">
                      <h3 class="roster-column-heading">Offense</h3>
                      <div class="type-radar-slot" data-radar-uid="${escapeHtml(team.uid)}" data-radar-group="offense"></div>
                      <ul class="roster-list">${offenseRows}</ul>
                    </div>
                    <div class="roster-column">
                      <h3 class="roster-column-heading">Defense</h3>
                      <div class="type-radar-slot" data-radar-uid="${escapeHtml(team.uid)}" data-radar-group="defense"></div>
                      <ul class="roster-list">${defenseRows}</ul>
                    </div>
                  </div>
                  <div class="roster-columns" style="margin-top: 1.5rem;">
                    <div class="roster-column">
                      <h3 class="roster-column-heading">Kicker</h3>
                      <ul class="roster-list">${kickerRows}</ul>
                    </div>
                    <div class="roster-column">
                      <h3 class="roster-column-heading">Bench</h3>
                      <ul class="roster-list">${benchRows}</ul>
                    </div>
                  </div>
                </section>`;
      })
      .join("");

    listEl.querySelectorAll(".type-radar-slot").forEach((el) => {
      const team = visibleTeams.find((t) => t.uid === el.dataset.radarUid);
      if (!team) return;
      const slots = team.slots || {};
      const positions = groups[el.dataset.radarGroup === "offense" ? "offense" : "defense"] || [];
      const picks = positions.map((p) => slots[p]).filter(Boolean);
      const groupLabel = el.dataset.radarGroup === "offense" ? "Offense" : "Defense";
      const caption = `${team.teamName || "Unnamed Team"} — ${groupLabel}`;
      typeCountsForPicks(picks).then((counts) => {
        el.innerHTML = typeRadarChartHtml(counts, null, 150);
        wireTypeRadarClick(el.querySelector(".type-radar-wrap"), counts, caption);
      });
    });

    if (isAdminViewer) {
      listEl.querySelectorAll(".export-team-btn").forEach((btn) => {
        const team = teams.find((t) => t.uid === btn.dataset.uid);
        if (team) btn.addEventListener("click", () => exportTeamCsv(team));
      });
      listEl.querySelectorAll(".hide-team-btn").forEach((btn) => {
        btn.addEventListener("click", () => toggleTeamHidden(btn.dataset.uid, btn.dataset.hidden === "true"));
      });
    }
    listEl.querySelectorAll(".roster-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () =>
        removeFromRoster(btn.dataset.slot, Number(btn.dataset.id), btn.dataset.name)
      );
    });
    listEl.querySelectorAll("[data-trade-target]").forEach((el) => {
      el.addEventListener("click", () => {
        const team = teams.find((t) => t.uid === el.dataset.uid);
        if (team) openTradeModal(team, { position: el.dataset.slot, pokemonId: Number(el.dataset.id), pokemonName: el.dataset.name });
      });
    });
  };

  // --- Propose trade modal ---
  //
  // Destination slots for whatever each side ends up receiving are only
  // decided inside the accept transaction (pokemon-myteam.js), never here -
  // a pending proposal doesn't touch anyone's roster yet, so there's
  // nothing to assign a slot for until it's actually accepted.

  const tradeModalEl = document.getElementById("trade-modal");
  const tradeOtherNameEl = document.getElementById("trade-other-team-name");
  const tradeMessageEl = document.getElementById("trade-message");
  const tradeReceiveGridEl = document.getElementById("trade-receive-grid");
  const tradeGiveGridEl = document.getElementById("trade-give-grid");
  const tradeSendBtnEl = document.getElementById("trade-send-btn");
  const tradeCancelBtnEl = document.getElementById("trade-cancel-btn");

  let tradeOtherTeam = null;
  let tradeReceiveSelected = new Map(); // pokemonId -> {position, pokemonId, pokemonName}
  let tradeGiveSelected = new Map();

  const showTradeMessage = (text, isError) => {
    tradeMessageEl.hidden = false;
    tradeMessageEl.className = `status${isError ? " error" : ""}`;
    tradeMessageEl.textContent = text;
  };

  const filledSlotsOf = (team) =>
    (config.pokemonPositions || [])
      .map((position) => ({ position, pick: (team.slots || {})[position] }))
      .filter((entry) => entry.pick);

  const renderTradePickGrid = (el, team, selectedMap, disabledIds) => {
    const entries = filledSlotsOf(team);
    el.innerHTML = entries
      .map(({ position, pick }) => {
        const checked = selectedMap.has(pick.pokemonId);
        const disabled = disabledIds && disabledIds.has(pick.pokemonId);
        return `<label class="trade-pick-item${disabled ? " trade-pick-item--disabled" : ""}">
                  <input type="checkbox" data-id="${pick.pokemonId}" data-position="${escapeHtml(position)}" data-name="${escapeHtml(pick.pokemonName)}" ${checked ? "checked" : ""} ${disabled ? "disabled" : ""} />
                  <img class="roster-row-sprite" src="${spriteUrl(pick.pokemonId)}" alt="" loading="lazy" />
                  <span>${escapeHtml(pick.pokemonName)} <span class="roster-row-position">(${escapeHtml(position)})</span></span>
                </label>`;
      })
      .join("");
    el.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.addEventListener("change", () => {
        const id = Number(input.dataset.id);
        if (input.checked) {
          selectedMap.set(id, { position: input.dataset.position, pokemonId: id, pokemonName: input.dataset.name });
        } else {
          selectedMap.delete(id);
        }
        validateTradeSelection();
      });
    });
  };

  const validateTradeSelection = () => {
    tradeMessageEl.hidden = true;
    tradeSendBtnEl.disabled = false;

    if (!tradeReceiveSelected.size || !tradeGiveSelected.size) {
      tradeSendBtnEl.disabled = true;
      return;
    }

    if (!tradeEligible(currentUser.uid, tradeOtherTeam.uid)) {
      showTradeMessage(
        "This trade is blocked for now - one of your teams has already played this week and the other hasn't.",
        true
      );
      tradeSendBtnEl.disabled = true;
      return;
    }

    const myTeamData = latestTeams.find((t) => t.uid === currentUser.uid);
    const myEmptySlots = (config.pokemonPositions || []).filter((p) => !(myTeamData.slots || {})[p]).length;
    const myCapacity = tradeGiveSelected.size + myEmptySlots;
    if (tradeReceiveSelected.size > myCapacity) {
      showTradeMessage(
        `You don't have enough open roster slots - receiving ${tradeReceiveSelected.size} needs ${tradeReceiveSelected.size - myCapacity} more open slot(s) than you currently have.`,
        true
      );
      tradeSendBtnEl.disabled = true;
      return;
    }

    const theirEmptySlots = (config.pokemonPositions || []).filter((p) => !(tradeOtherTeam.slots || {})[p]).length;
    const theirCapacity = tradeReceiveSelected.size + theirEmptySlots;
    if (tradeGiveSelected.size > theirCapacity) {
      showTradeMessage(
        `${tradeOtherTeam.teamName} doesn't have enough open roster slots to receive this many Pokémon.`,
        true
      );
      tradeSendBtnEl.disabled = true;
    }
  };

  const openTradeModal = (otherTeam, preselected) => {
    if (!currentUser) return;
    tradeOtherTeam = otherTeam;
    tradeReceiveSelected = new Map();
    tradeGiveSelected = new Map();
    if (preselected) {
      tradeReceiveSelected.set(preselected.pokemonId, preselected);
    }
    tradeOtherNameEl.textContent = otherTeam.teamName || "Unnamed Team";
    tradeMessageEl.hidden = true;

    const myTeamData = latestTeams.find((t) => t.uid === currentUser.uid);
    const lockedForOther = new Set(
      filledSlotsOf(otherTeam)
        .filter(({ pick }) => pokemonInPendingTrade(otherTeam.uid, pick.pokemonId))
        .map(({ pick }) => pick.pokemonId)
    );
    const lockedForMe = new Set(
      filledSlotsOf(myTeamData)
        .filter(({ pick }) => pokemonInPendingTrade(myTeamData.uid, pick.pokemonId))
        .map(({ pick }) => pick.pokemonId)
    );
    renderTradePickGrid(tradeReceiveGridEl, otherTeam, tradeReceiveSelected, lockedForOther);
    renderTradePickGrid(tradeGiveGridEl, myTeamData, tradeGiveSelected, lockedForMe);
    validateTradeSelection();
    tradeModalEl.hidden = false;
  };

  const closeTradeModal = () => {
    tradeModalEl.hidden = true;
    tradeOtherTeam = null;
  };

  tradeCancelBtnEl.addEventListener("click", closeTradeModal);

  async function sendTradeProposal() {
    if (!currentUser || !tradeOtherTeam) return;
    const myTeamData = latestTeams.find((t) => t.uid === currentUser.uid);
    const give = [...tradeGiveSelected.values()];
    const receive = [...tradeReceiveSelected.values()];

    try {
      await db.collection("trades").add({
        fromUid: currentUser.uid,
        fromTeamName: myTeamData.teamName || "Unnamed Team",
        toUid: tradeOtherTeam.uid,
        toTeamName: tradeOtherTeam.teamName || "Unnamed Team",
        give,
        receive,
        status: "pending",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        resolvedAt: null,
      });

      const giveNames = give.map((p) => p.pokemonName).join(", ");
      const receiveNames = receive.map((p) => p.pokemonName).join(", ");
      const announceText = `${myTeamData.teamName} proposes a trade to ${tradeOtherTeam.teamName}: ${giveNames} for ${receiveNames}`;
      await db.collection("chatMessages").add({
        uid: currentUser.uid,
        system: true,
        text: announceText,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      notifyDiscord(announceText);

      closeTradeModal();
    } catch (error) {
      showTradeMessage(error.message, true);
    }
  }

  tradeSendBtnEl.addEventListener("click", sendTradeProposal);

  async function toggleTeamHidden(uid, currentlyHidden) {
    try {
      await db.collection("teams").doc(uid).update({ hidden: !currentlyHidden });
    } catch (error) {
      window.alert(`Unable to update: ${error.message}`);
    }
  }

  async function removeFromRoster(slot, pokemonId, pokemonName) {
    if (!currentUser) return;
    const confirmed = window.confirm(`Remove ${pokemonName} from your roster and return it to the free agent pool?`);
    if (!confirmed) return;

    const teamRef = db.collection("teams").doc(currentUser.uid);
    const draftedRef = db.collection("draftedPokemon").doc(String(pokemonId));

    try {
      await db.runTransaction(async (tx) => {
        const teamSnap = await tx.get(teamRef);
        const team = teamSnap.data();
        if (!team || !team.slots || !team.slots[slot]) throw new Error("That slot is already empty.");
        tx.delete(draftedRef);
        tx.update(teamRef, { [`slots.${slot}`]: null });
      });
    } catch (error) {
      window.alert(`Unable to remove: ${error.message}`);
    }
  }

  // --- Live listeners ---

  let unsubscribeTeams = null;
  let unsubscribeDrafted = null;
  let unsubscribeSeason = null;
  let unsubscribeDraftState = null;
  let unsubscribeMatchups = null;
  let unsubscribeTrainingLog = null;
  let unsubscribeTrades = null;
  let latestTeams = [];
  let pendingTrades = [];

  const subscribe = () => {
    [
      unsubscribeTeams,
      unsubscribeDrafted,
      unsubscribeSeason,
      unsubscribeDraftState,
      unsubscribeMatchups,
      unsubscribeTrainingLog,
      unsubscribeTrades,
    ].forEach((unsubscribe) => unsubscribe && unsubscribe());
    unsubscribeTeams =
      unsubscribeDrafted =
      unsubscribeSeason =
      unsubscribeDraftState =
      unsubscribeMatchups =
      unsubscribeTrainingLog =
      unsubscribeTrades =
        null;

    if (!currentUser) {
      listEl.innerHTML = "";
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.innerHTML = `Sign in on the <a href="pokemon-league.html">League Home</a> page to view rosters.`;
      return;
    }

    statusEl.hidden = false;
    statusEl.className = "status";
    statusEl.textContent = "Loading rosters…";

    unsubscribeTeams = db
      .collection("teams")
      .orderBy("createdAt")
      .onSnapshot(
        (snapshot) => {
          latestTeams = snapshot.docs.map((doc) => ({ uid: doc.id, ...doc.data() }));
          renderTeams(latestTeams);
        },
        (error) => {
          statusEl.hidden = false;
          statusEl.className = "status error";
          statusEl.textContent = `Unable to load rosters: ${error.message}`;
        }
      );

    unsubscribeDrafted = db.collection("draftedPokemon").onSnapshot(
      (snapshot) => {
        draftedMap = new Map();
        snapshot.forEach((doc) => draftedMap.set(Number(doc.id), doc.data()));
      },
      () => {}
    );

    unsubscribeSeason = db
      .collection("seasonState")
      .doc("current")
      .onSnapshot(
        (doc) => {
          seasonState = doc.exists ? doc.data() : null;
          currentWeek = seasonState ? seasonState.currentWeek ?? null : null;
          renderTeams(latestTeams);
        },
        () => {}
      );

    unsubscribeDraftState = db
      .collection("draftState")
      .doc("current")
      .onSnapshot(
        (doc) => {
          draftState = doc.exists ? doc.data() : null;
          renderTeams(latestTeams);
        },
        () => {}
      );

    // matchups is needed by everyone now (trade eligibility), not just the
    // admin export button.
    unsubscribeMatchups = db.collection("matchups").onSnapshot((snapshot) => {
      matchups = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      renderTeams(latestTeams);
    }, () => {});

    if (isAdmin()) {
      unsubscribeTrainingLog = db.collection("trainingLog").onSnapshot((snapshot) => {
        trainingLog = snapshot.docs.map((doc) => doc.data());
      }, () => {});
    }

    unsubscribeTrades = db
      .collection("trades")
      .where("status", "==", "pending")
      .onSnapshot((snapshot) => {
        pendingTrades = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        renderTeams(latestTeams);
      }, () => {});
  };

  auth.onAuthStateChanged((user) => {
    currentUser = user;
    subscribe();
  });
})();
