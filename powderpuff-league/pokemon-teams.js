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
    if (max === 0) return; // nothing to show - leave it non-interactive
    wrapEl.addEventListener("click", () => openTypeRadarModal(counts, caption));
  };

  // A stored streak only updates when a team trains, so it counts as 0 once
  // the team's last session is older than yesterday. A team that hasn't
  // trained yet today still has until the end of the day to keep it.
  const activeStreak = (training) => {
    const t = training || {};
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const pad = (n) => String(n).padStart(2, "0");
    const yesterdayKey = `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`;
    return t.lastTrainedDate && t.lastTrainedDate >= yesterdayKey ? t.currentStreak || 0 : 0;
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

  // Read-only - the Rosters page just shows whichever cheerleaders a team
  // has set, no editing here (that's My Team's job). Empty slots are
  // skipped entirely rather than shown as placeholders.
  const cheerSpritesHtml = (cheerSlots) => {
    if (!cheerSlots) return "";
    const picks = [0, 1, 2, 3, 4].map((i) => cheerSlots[String(i)]).filter(Boolean);
    if (!picks.length) return "";
    return `<span class="cheer-slots-row cheer-slots-row--display">${picks
      .map(
        (pick) =>
          `<img class="cheer-slot-sprite" src="${spriteUrl(pick.pokemonId)}" alt="${escapeHtml(pick.pokemonName)}" title="${escapeHtml(pick.pokemonName)}" loading="lazy" />`
      )
      .join("")}</span>`;
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
  const positionLabels = config.positionLabels || {};
  const trainingTypeList = config.trainingTypes || [];
  const legendaryIds = new Set(config.legendaryPokemonIds || []);

  let currentUser = null;
  let leagueSettings = null;

  const isRealAdmin = () =>
    Boolean(currentUser && config.adminUid && config.adminUid !== "YOUR_ADMIN_UID" && currentUser.uid === config.adminUid);
  // Admin Mode toggle (pokemon-admin-toggle.js) - only hides admin-only UI.
  const isAdmin = () => isRealAdmin() && localStorage.getItem(`adminViewMode:${currentUser.uid}`) !== "user";

  const isPlayable = (pokemonId) => {
    const overrides = (leagueSettings && leagueSettings.playable) || {};
    const override = overrides[String(pokemonId)];
    return typeof override === "boolean" ? override : !legendaryIds.has(pokemonId);
  };

  // --- Admin export: roster + training, for feeding into an external
  // results tool. "Since last game" uses the same per-team previous-
  // matchup lookup as the Schedule/My Team pages. ---

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
    if (!currentMatchup || !currentMatchup.date) return [];
    const prev = previousMatchupFor(uid, currentMatchup);
    const startMs = prev ? trainingCutoffMs(prev) : null;
    const endMs = trainingCutoffMs(currentMatchup);
    return trainingLog
      .filter((log) => log.uid === uid)
      .filter((log) => {
        const logMs = log.loggedAt ? log.loggedAt.toMillis() : new Date(`${log.date}T12:00:00`).getTime();
        return (startMs === null || logMs > startMs) && logMs <= endMs;
      })
      .flatMap((log) => log.types || []);
  };

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
    csv += csvRow(["Training Streak (days)", activeStreak(training)]);
    csv += csvRow(["Bonus Sessions Banked", training.bonusSessionsAvailable || 0]);
    csv += csvRow([
      "Next Matchup",
      upcoming ? `Week ${upcoming.week} - ${upcoming.date.toDate().toLocaleDateString("en-US")}` : "None scheduled",
    ]);
    csv += "\r\n";

    csv += csvRow(["Training Since Last Game", "Count"]);
    trainingTypeList.forEach((type) => (csv += csvRow([type.label, sinceLastCounts.get(type.key) || 0])));
    csv += "\r\n";

    csv += csvRow(["Training Totals (Season)", "Count"]);
    trainingTypeList.forEach((type) => (csv += csvRow([type.label, seasonCounts.get(type.key) || 0])));
    csv += "\r\n";

    csv += csvRow(["Roster Position", "Pokemon ID", "Pokemon Name"]);
    (config.pokemonPositions || []).forEach((position) => {
      const pick = (team.slots || {})[position];
      csv += csvRow([positionLabels[position] || position, pick ? pick.pokemonId : "", pick ? pick.pokemonName : ""]);
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

  // Admin "Export All Rosters": every team (hidden ones included) in one
  // flat CSV, one row per roster position, so it opens cleanly as a single
  // sortable/filterable sheet.
  const exportAllRostersCsv = (teams) => {
    const positions = config.pokemonPositions || [];
    const sorted = [...teams].sort((a, b) => (a.teamName || "").localeCompare(b.teamName || ""));
    let csv = csvRow(["Team", "Hidden", "Roster Position", "Position Name", "Pokemon ID", "Pokemon Name", "Playable"]);
    sorted.forEach((team) => {
      const slots = team.slots || {};
      positions.forEach((position) => {
        const pick = slots[position];
        csv += csvRow([
          team.teamName || "Unnamed Team",
          team.hidden ? "Yes" : "",
          position,
          positionLabels[position] || position,
          pick ? pick.pokemonId : "",
          pick ? pick.pokemonName : "",
          pick ? (isPlayable(pick.pokemonId) ? "Yes" : "No") : "",
        ]);
      });
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `all-rosters-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  // --- Rendering (view-only - rosters are edited on My Team) ---

  const renderRow = (position, slots) => {
    const pick = slots[position];
    const middle = pick
      ? `<span class="roster-row-filled">
          <img class="roster-row-sprite" src="${spriteUrl(pick.pokemonId)}" alt="${escapeHtml(pick.pokemonName)}" loading="lazy" />
          ${escapeHtml(pick.pokemonName)}
        </span>
        ${isPlayable(pick.pokemonId) ? "" : `<span class="out-badge">Not playable</span>`}`
      : `<span class="roster-row-empty">— empty —</span>`;
    return `<li class="roster-row" title="${escapeHtml(positionLabels[position] || position)}">
              <span class="roster-row-position">${escapeHtml(position)}</span>
              ${middle}
            </li>`;
  };

  const renderTeams = (teams) => {
    const isAdminViewer = isAdmin();
    // Hidden teams (admin-only toggle) stay off everyone else's view - the
    // admin still sees them here, badged, to be able to unhide later.
    const visibleTeams = teams.filter((team) => !team.hidden || isAdminViewer);

    if (!visibleTeams.length) {
      listEl.innerHTML = "";
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.textContent = "No teams yet.";
      return;
    }
    statusEl.hidden = true;
    const adminToolbar = isAdminViewer
      ? `<div class="admin-export-all-bar" style="display: flex; justify-content: flex-end;">
           <button type="button" class="btn btn-secondary" id="export-all-rosters-btn">Export All Rosters</button>
         </div>`
      : "";
    listEl.innerHTML = adminToolbar + visibleTeams
      .map((team) => {
        const isMine = currentUser && team.ownerUid === currentUser.uid;
        const slots = team.slots || {};
        const offenseRows = groups.offense.map((p) => renderRow(p, slots)).join("");
        const defenseRows = groups.defense.map((p) => renderRow(p, slots)).join("");
        const exportBtn = isAdminViewer
          ? `<button type="button" class="btn btn-secondary export-team-btn" data-uid="${escapeHtml(team.uid)}">Export</button>`
          : "";
        const hideBtn = isAdminViewer
          ? `<button type="button" class="btn btn-secondary hide-team-btn" data-uid="${escapeHtml(team.uid)}" data-hidden="${team.hidden ? "true" : "false"}">${team.hidden ? "Show" : "Hide"}</button>`
          : "";
        const hiddenBadge = team.hidden ? `<span class="training-badge training-badge--hidden">HIDDEN</span>` : "";
        const editLink = isMine ? `<a class="btn btn-secondary" href="pokemon-myteam.html">Edit on My Team</a>` : "";
        return `<section class="card">
                  <h2>${teamAvatarHtml(team)} ${escapeHtml(team.teamName || "Unnamed Team")}<span class="training-badges">${trainingBadgesHtml(team.training)}${hiddenBadge}</span>${cheerSpritesHtml(team.cheerSlots)}${editLink}${exportBtn}${hideBtn}</h2>
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
                </section>`;
      })
      .join("");

    listEl.querySelectorAll(".type-radar-slot").forEach((el) => {
      const team = visibleTeams.find((t) => t.uid === el.dataset.radarUid);
      if (!team) return;
      const slots = team.slots || {};
      const groupPositions = groups[el.dataset.radarGroup === "offense" ? "offense" : "defense"] || [];
      const picks = groupPositions.map((p) => slots[p]).filter(Boolean);
      const groupLabel = el.dataset.radarGroup === "offense" ? "Offense" : "Defense";
      const caption = `${team.teamName || "Unnamed Team"} — ${groupLabel}`;
      typeCountsForPicks(picks).then((counts) => {
        el.innerHTML = typeRadarChartHtml(counts, null, 150);
        wireTypeRadarClick(el.querySelector(".type-radar-wrap"), counts, caption);
      });
    });

    if (isAdminViewer) {
      const exportAllBtn = document.getElementById("export-all-rosters-btn");
      if (exportAllBtn) exportAllBtn.addEventListener("click", () => exportAllRostersCsv(teams));
      listEl.querySelectorAll(".export-team-btn").forEach((btn) => {
        const team = teams.find((t) => t.uid === btn.dataset.uid);
        if (team) btn.addEventListener("click", () => exportTeamCsv(team));
      });
      listEl.querySelectorAll(".hide-team-btn").forEach((btn) => {
        btn.addEventListener("click", () => toggleTeamHidden(btn.dataset.uid, btn.dataset.hidden === "true"));
      });
    }
  };

  async function toggleTeamHidden(uid, currentlyHidden) {
    try {
      await db.collection("teams").doc(uid).update({ hidden: !currentlyHidden });
    } catch (error) {
      window.alert(`Unable to update: ${error.message}`);
    }
  }

  // --- Live listeners ---

  let unsubscribers = [];
  let latestTeams = [];

  const subscribe = () => {
    unsubscribers.forEach((u) => u());
    unsubscribers = [];

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

    unsubscribers.push(
      db
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
        )
    );

    unsubscribers.push(
      db
        .collection("leagueSettings")
        .doc("current")
        .onSnapshot((doc) => {
          leagueSettings = doc.exists ? doc.data() : null;
          renderTeams(latestTeams);
        }, () => {})
    );

    if (isAdmin()) {
      unsubscribers.push(
        db.collection("matchups").onSnapshot((snapshot) => {
          // Exhibitions (Thanksgiving specials) are just for fun - never a
          // team's next game or a training cutoff here.
          matchups = snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .filter((m) => m.round !== "exhibition" && m.special !== "thanksgiving");
        }, () => {})
      );
      unsubscribers.push(
        db.collection("trainingLog").onSnapshot((snapshot) => {
          trainingLog = snapshot.docs.map((doc) => doc.data());
        }, () => {})
      );
    }
  };

  auth.onAuthStateChanged((user) => {
    currentUser = user;
    subscribe();
  });
})();
