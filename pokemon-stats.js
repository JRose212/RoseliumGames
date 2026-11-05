(function () {
  const config = window.siteConfig || {};
  const statusEl = document.getElementById("stats-status");
  const leaderboardsCardEl = document.getElementById("leaderboards-card");
  const leaderboardsAreaEl = document.getElementById("leaderboards-area");
  const playerStatsCardEl = document.getElementById("player-stats-card");
  const playerStatsTabsEl = document.getElementById("player-stats-tabs");
  const playerStatsSearchEl = document.getElementById("player-stats-search");
  const playerStatsTeamEl = document.getElementById("player-stats-team");
  const playerStatsPositionWrapEl = document.getElementById("player-stats-position-wrap");
  const playerStatsPositionEl = document.getElementById("player-stats-position");
  const playerStatsScopeEl = document.getElementById("player-stats-scope");
  const playerStatsTableEl = document.getElementById("player-stats-table");
  const playerStatsEmptyEl = document.getElementById("player-stats-empty");

  if (!leaderboardsAreaEl) return;

  const escapeHtml = (value) => {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  if (!config.firebaseConfig || config.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") {
    statusEl.className = "status error";
    statusEl.textContent = "Fantasy League is not configured yet.";
    return;
  }

  firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();

  const leaderboardCategories = config.boxScoreLeaderboardCategories || [];

  let currentUser = null;
  let teamsByUid = new Map();
  let matchups = [];
  let boxScoresByMatchupId = new Map();

  const teamName = (uid) => teamsByUid.get(uid)?.teamName || "Unknown team";

  const teamAvatarHtml = (team, sizeClass = "") => {
    const name = (team && team.teamName) || "?";
    const cls = `team-avatar${sizeClass ? ` ${sizeClass}` : ""}`;
    if (team && team.photoURL) {
      return `<img class="${cls}" src="${escapeHtml(team.photoURL)}" alt="${escapeHtml(name)}" loading="lazy" />`;
    }
    return `<span class="${cls} team-avatar-placeholder">${escapeHtml(name.charAt(0) || "?")}</span>`;
  };

  // Leaderboards only - per-game summaries and box scores live on the
  // Schedule page itself, right on each matchup's own row. This page is
  // purely the season-wide aggregate, summed live from every box score
  // (same "compute from the raw collection, don't store aggregates"
  // approach the rest of the site already uses for standings).
  const renderLeaderboards = () => {
    if (!leaderboardCategories.length) {
      leaderboardsCardEl.hidden = true;
      return;
    }

    // keyed by pokemonName - totals[key][pokemonName] = { total, team }
    const totals = {};
    leaderboardCategories.forEach((cat) => (totals[cat.key] = new Map()));

    matchups.forEach((matchup) => {
      const box = boxScoresByMatchupId.get(matchup.id);
      if (!box) return;
      [
        { side: box.home, uid: matchup.homeUid },
        { side: box.away, uid: matchup.awayUid },
      ].forEach(({ side, uid }) => {
        (side || []).forEach((entry) => {
          const stats = entry.stats || {};
          leaderboardCategories.forEach((cat) => {
            // A stat key can mean different things by position - "int" is
            // thrown for a QB but caught for a defender.
            if ((cat.excludeSlots || []).includes(entry.slot)) return;
            const value = Number(stats[cat.key]) || 0;
            if (!value) return;
            const map = totals[cat.key];
            const existing = map.get(entry.pokemonName) || { total: 0, uid };
            existing.total += value;
            existing.uid = uid;
            map.set(entry.pokemonName, existing);
          });
        });
      });
    });

    const hasAnyData = leaderboardCategories.some((cat) => totals[cat.key].size > 0);
    if (!hasAnyData) {
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.textContent = "No box scores recorded yet - leaderboards show up here once games have stats.";
      leaderboardsCardEl.hidden = true;
      return;
    }
    statusEl.hidden = true;

    leaderboardsAreaEl.innerHTML = leaderboardCategories
      .map((cat) => {
        const entries = [...totals[cat.key].entries()]
          .map(([pokemonName, data]) => ({ pokemonName, ...data }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 5);
        if (!entries.length) return "";
        return `
          <div class="leaderboard-card">
            <h3>${escapeHtml(cat.label)}</h3>
            <ol>
              ${entries
                .map((e) => {
                  const team = teamsByUid.get(e.uid);
                  return `<li>${teamAvatarHtml(team, "team-avatar--sm")}<span class="leaderboard-name">${escapeHtml(e.pokemonName)}</span><span class="leaderboard-value">${e.total}</span><span class="leaderboard-team">${escapeHtml(teamName(e.uid))}</span></li>`;
                })
                .join("")}
            </ol>
          </div>
        `;
      })
      .join("");
    leaderboardsCardEl.hidden = false;
  };

  // --- Player Stats: sortable per-Pokemon season tables, summed live from
  // the same box scores as the leaderboards above. Each stat is only
  // counted from games that actually recorded it, and shows "-" if none
  // did - older box scores predate most of these fields. Rate stats (AVG,
  // CMP%, RTG) use only games that have every field they need, so a game
  // with passing yards but no attempts can't inflate yards per attempt. ---

  const hasStat = (stats, key) => stats[key] !== undefined && stats[key] !== null && stats[key] !== "" && !Number.isNaN(Number(stats[key]));

  const statTotal = (row, key) => {
    const games = row.games.filter((stats) => hasStat(stats, key));
    return games.length ? games.reduce((total, stats) => total + Number(stats[key]), 0) : null;
  };

  const statMax = (row, key) => {
    const games = row.games.filter((stats) => hasStat(stats, key));
    return games.length ? Math.max(...games.map((stats) => Number(stats[key]))) : null;
  };

  const statRatio = (row, numeratorKey, denominatorKey, scale = 1) => {
    const games = row.games.filter((stats) => hasStat(stats, numeratorKey) && hasStat(stats, denominatorKey));
    const numerator = games.reduce((total, stats) => total + Number(stats[numeratorKey]), 0);
    const denominator = games.reduce((total, stats) => total + Number(stats[denominatorKey]), 0);
    return denominator ? (numerator / denominator) * scale : null;
  };

  const statPerGame = (row, key) => {
    const games = row.games.filter((stats) => hasStat(stats, key));
    return games.length ? statTotal(row, key) / games.length : null;
  };

  // "tackles" is the total on every box score; solo + assisted only fills
  // in if a game somehow has those without it.
  const totalTackles = (row) => {
    let total = null;
    row.games.forEach((stats) => {
      let value = null;
      if (hasStat(stats, "tackles")) value = Number(stats.tackles);
      else if (hasStat(stats, "soloTackles") || hasStat(stats, "assistTackles")) {
        value = (Number(stats.soloTackles) || 0) + (Number(stats.assistTackles) || 0);
      }
      if (value !== null) total = (total || 0) + value;
    });
    return total;
  };

  // Standard NFL passer rating, from season totals rather than an average
  // of each game's rating. Runs 0 to 158.3.
  const passerRating = (row) => {
    const keys = ["passCmp", "passAtt", "passYds", "passTD", "int"];
    const games = row.games.filter((stats) => keys.every((key) => hasStat(stats, key)));
    const sum = (key) => games.reduce((total, stats) => total + Number(stats[key]), 0);
    const attempts = sum("passAtt");
    if (!attempts) return null;
    const clamp = (value) => Math.min(2.375, Math.max(0, value));
    const a = clamp((sum("passCmp") / attempts - 0.3) * 5);
    const b = clamp((sum("passYds") / attempts - 3) * 0.25);
    const c = clamp((sum("passTD") / attempts) * 20);
    const d = clamp(2.375 - (sum("int") / attempts) * 25);
    return ((a + b + c + d) / 6) * 100;
  };

  const positionLabel = (slot) => String(slot).replace(/\d+$/, "");

  const nameColumn = { key: "name", label: "Pokémon", text: true, value: (row) => row.name };
  const teamColumn = {
    key: "team",
    label: "Team",
    text: true,
    value: (row) => teamName(row.uid),
    html: (row) => `${teamAvatarHtml(teamsByUid.get(row.uid), "team-avatar--sm")} ${escapeHtml(teamName(row.uid))}`,
  };
  const posColumn = { key: "pos", label: "POS", title: "Position", text: true, value: (row) => positionLabel(row.slot) };
  const gpColumn = { key: "gp", label: "GP", title: "Games played", value: (row) => row.games.length };
  const totalColumn = (key, label, title, group) => ({ key, label, title, group, value: (row) => statTotal(row, key) });
  const maxColumn = (key, label, title, group) => ({ key, label, title, group, value: (row) => statMax(row, key) });

  const skillSlots = ["QB", "RB", "FB", "WR1", "WR2", "TE"];
  const defenseSlots = (config.positionGroups && config.positionGroups.defense) || [];

  // slots: the positions a table reads from - this is what keeps "int"
  // (thrown by a QB, caught by a defender) and "sacks" in the right table.
  // primarySlots always get a row; anyone else in slots only gets one once
  // they have a non-zero statKey (a WR with a carry, say).
  const playerStatTables = [
    {
      key: "passing",
      label: "Passing",
      slots: ["QB"],
      primarySlots: ["QB"],
      statKeys: ["passCmp", "passAtt", "passYds", "passTD"],
      defaultSort: "passYds",
      columns: [
        nameColumn,
        teamColumn,
        gpColumn,
        totalColumn("passCmp", "CMP", "Completions"),
        totalColumn("passAtt", "ATT", "Attempts"),
        { key: "cmpPct", label: "CMP%", title: "Completion percentage", digits: 1, value: (row) => statRatio(row, "passCmp", "passAtt", 100) },
        totalColumn("passYds", "YDS", "Passing yards"),
        { key: "passAvg", label: "AVG", title: "Yards per attempt", digits: 1, value: (row) => statRatio(row, "passYds", "passAtt") },
        { key: "passPerGame", label: "YDS/G", title: "Passing yards per game", digits: 1, value: (row) => statPerGame(row, "passYds") },
        maxColumn("passLong", "LNG", "Longest pass"),
        totalColumn("passTD", "TD", "Passing touchdowns"),
        totalColumn("int", "INT", "Interceptions thrown"),
        totalColumn("sacksTaken", "SACK", "Times sacked"),
        totalColumn("sackYdsLost", "SYL", "Sack yards lost"),
        { key: "rtg", label: "RTG", title: "Passer rating", digits: 1, value: passerRating },
        totalColumn("twoPtPass", "2PT", "Two-point conversions passed"),
      ],
    },
    {
      key: "rushing",
      label: "Rushing",
      slots: skillSlots,
      primarySlots: ["RB", "FB"],
      statKeys: ["rushAtt", "rushYds", "rushTD"],
      defaultSort: "rushYds",
      columns: [
        nameColumn,
        teamColumn,
        posColumn,
        gpColumn,
        totalColumn("rushAtt", "ATT", "Rushing attempts"),
        totalColumn("rushYds", "YDS", "Rushing yards"),
        { key: "rushAvg", label: "AVG", title: "Yards per carry", digits: 1, value: (row) => statRatio(row, "rushYds", "rushAtt") },
        maxColumn("rushLong", "LNG", "Longest rush"),
        totalColumn("rushBig", "BIG", "Rushes of 20+ yards"),
        totalColumn("rushTD", "TD", "Rushing touchdowns"),
        { key: "rushPerGame", label: "YDS/G", title: "Rushing yards per game", digits: 1, value: (row) => statPerGame(row, "rushYds") },
        totalColumn("rushFum", "FUM", "Fumbles"),
        totalColumn("rushFumLost", "LST", "Fumbles lost"),
        totalColumn("rushFD", "FD", "Rushing first downs"),
        totalColumn("twoPtRush", "2PT", "Two-point conversions rushed"),
      ],
    },
    {
      key: "receiving",
      label: "Receiving",
      slots: skillSlots,
      primarySlots: ["WR1", "WR2", "TE"],
      statKeys: ["targets", "receptions", "recYds", "recTD"],
      defaultSort: "recYds",
      columns: [
        nameColumn,
        teamColumn,
        posColumn,
        gpColumn,
        totalColumn("receptions", "REC", "Receptions"),
        totalColumn("targets", "TGTS", "Targets"),
        totalColumn("recYds", "YDS", "Receiving yards"),
        { key: "recAvg", label: "AVG", title: "Yards per reception", digits: 1, value: (row) => statRatio(row, "recYds", "receptions") },
        totalColumn("recTD", "TD", "Receiving touchdowns"),
        maxColumn("recLong", "LNG", "Longest reception"),
        totalColumn("recBig", "BIG", "Receptions of 20+ yards"),
        { key: "recPerGame", label: "YDS/G", title: "Receiving yards per game", digits: 1, value: (row) => statPerGame(row, "recYds") },
        totalColumn("recFum", "FUM", "Fumbles"),
        totalColumn("recFumLost", "LST", "Fumbles lost"),
        totalColumn("yac", "YAC", "Yards after catch"),
        totalColumn("recFD", "FD", "Receiving first downs"),
        totalColumn("twoPtRec", "2PT", "Two-point conversions caught"),
      ],
    },
    {
      key: "defense",
      label: "Defense",
      slots: defenseSlots,
      primarySlots: defenseSlots,
      statKeys: ["tackles", "sacks", "int"],
      defaultSort: "totalTackles",
      columns: [
        nameColumn,
        teamColumn,
        posColumn,
        gpColumn,
        totalColumn("soloTackles", "SOLO", "Solo tackles", "Tackles"),
        totalColumn("assistTackles", "AST", "Assisted tackles", "Tackles"),
        { key: "totalTackles", label: "TOT", title: "Total tackles", group: "Tackles", value: totalTackles },
        totalColumn("sacks", "SACK", "Sacks", "Sacks"),
        totalColumn("sackYds", "YDS", "Sack yards", "Sacks"),
        totalColumn("tfl", "TFL", "Tackles for loss", "Sacks"),
        totalColumn("passDeflections", "PD", "Passes defended", "Interceptions"),
        totalColumn("int", "INT", "Interceptions caught", "Interceptions"),
        totalColumn("intYds", "YDS", "Interception return yards", "Interceptions"),
        maxColumn("intLong", "LNG", "Longest interception return", "Interceptions"),
        totalColumn("intTD", "TD", "Interception return touchdowns", "Interceptions"),
        totalColumn("forcedFumbles", "FF", "Forced fumbles", "Fumbles"),
        totalColumn("fumbleRecoveries", "FR", "Fumble recoveries", "Fumbles"),
        totalColumn("fumbleTD", "FTD", "Fumble return touchdowns", "Fumbles"),
        totalColumn("safeties", "SFTY", "Safeties"),
      ],
    },
  ];

  let activePlayerTableKey = "passing";
  let playerSortKey = playerStatTables[0].defaultSort;
  let playerSortDir = "desc";

  const activePlayerTable = () => playerStatTables.find((table) => table.key === activePlayerTableKey);

  const matchupMillis = (matchup) => (matchup.date && matchup.date.toMillis ? matchup.date.toMillis() : 0);

  // Oldest game first, so each row ends up with the team and position from
  // that Pokemon's latest game, even after a trade or a position change.
  const buildPlayerRows = (table) => {
    const scope = playerStatsScopeEl.value;
    const rows = new Map();
    [...matchups]
      .sort((a, b) => matchupMillis(a) - matchupMillis(b) || a.id.localeCompare(b.id))
      .forEach((matchup) => {
        const box = boxScoresByMatchupId.get(matchup.id);
        if (!box) return;
        if (scope === "regular" && matchup.round !== "regular") return;
        if (scope === "playoffs" && matchup.round === "regular") return;
        [
          { side: box.home, uid: matchup.homeUid },
          { side: box.away, uid: matchup.awayUid },
        ].forEach(({ side, uid }) => {
          (side || []).forEach((entry) => {
            if (!table.slots.includes(entry.slot)) return;
            const name = String(entry.pokemonName || "").trim();
            if (!name) return;
            const stats = entry.stats || {};
            const rowKey = name.toLowerCase();
            const row = rows.get(rowKey) || { name, games: [], primary: false, active: false };
            row.uid = uid;
            row.slot = entry.slot;
            row.primary = row.primary || table.primarySlots.includes(entry.slot);
            row.active = row.active || table.statKeys.some((key) => Number(stats[key]) > 0);
            row.games.push(stats);
            rows.set(rowKey, row);
          });
        });
      });
    return [...rows.values()].filter((row) => row.primary || row.active);
  };

  // Rebuilt on every render, keeping the current choice when it still
  // exists (the list changes with each table and box score).
  const setFilterOptions = (selectEl, allLabel, options) => {
    const previous = selectEl.value;
    selectEl.innerHTML =
      `<option value="">${escapeHtml(allLabel)}</option>` +
      options.map(({ value, label }) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
    selectEl.value = options.some((option) => option.value === previous) ? previous : "";
  };

  const formatPlayerStat = (value, digits) => {
    if (value === null || value === undefined) return "-";
    return digits ? value.toFixed(digits) : String(value);
  };

  const playerStatsHeaderHtml = (table) => {
    const hasGroups = table.columns.some((column) => column.group);
    let groupRow = "";
    if (hasGroups) {
      const cells = [];
      table.columns.forEach((column) => {
        const last = cells[cells.length - 1];
        if (last && last.group === column.group) last.span += 1;
        else cells.push({ group: column.group, span: 1 });
      });
      groupRow = `<tr>${cells
        .map((cell) => `<th colspan="${cell.span}" class="player-stats-group">${escapeHtml(cell.group || "")}</th>`)
        .join("")}</tr>`;
    }
    const columnRow = table.columns
      .map((column) => {
        const sorted = column.key === playerSortKey;
        const ariaSort = sorted ? (playerSortDir === "asc" ? "ascending" : "descending") : "none";
        const arrow = sorted ? (playerSortDir === "asc" ? " ▲" : " ▼") : "";
        return `<th aria-sort="${ariaSort}"${column.text ? ' class="player-stats-text"' : ""}><button type="button" class="player-stats-sort-btn" data-key="${column.key}" title="${escapeHtml(
          column.title || column.label
        )}">${escapeHtml(column.label)}${arrow}</button></th>`;
      })
      .join("");
    return `<thead>${groupRow}<tr>${columnRow}</tr></thead>`;
  };

  const renderPlayerStats = () => {
    const table = activePlayerTable();
    const hasBoxScores = matchups.some((matchup) => boxScoresByMatchupId.has(matchup.id));
    playerStatsCardEl.hidden = !hasBoxScores;
    if (!hasBoxScores) return;

    playerStatsTabsEl.querySelectorAll(".player-stats-tab").forEach((tab) => {
      const active = tab.dataset.table === table.key;
      tab.classList.toggle("player-stats-tab--active", active);
      tab.setAttribute("aria-pressed", String(active));
    });

    const rows = buildPlayerRows(table);
    const hasPositionColumn = table.columns.includes(posColumn);
    playerStatsPositionWrapEl.hidden = !hasPositionColumn;

    const teamOptions = [...new Set(rows.map((row) => row.uid))]
      .map((uid) => ({ value: uid, label: teamName(uid) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    setFilterOptions(playerStatsTeamEl, "All Teams", teamOptions);

    const positionOrder = [...new Set((config.pokemonPositions || []).map(positionLabel))];
    const positionOptions = [...new Set(rows.map((row) => positionLabel(row.slot)))]
      .sort((a, b) => positionOrder.indexOf(a) - positionOrder.indexOf(b))
      .map((position) => ({ value: position, label: position }));
    setFilterOptions(playerStatsPositionEl, "All Positions", positionOptions);

    const search = playerStatsSearchEl.value.trim().toLowerCase();
    const team = playerStatsTeamEl.value;
    const position = hasPositionColumn ? playerStatsPositionEl.value : "";
    const sortColumn = table.columns.find((column) => column.key === playerSortKey) || table.columns[0];
    const direction = playerSortDir === "asc" ? 1 : -1;

    const visibleRows = rows
      .filter((row) => !search || row.name.toLowerCase().includes(search))
      .filter((row) => !team || row.uid === team)
      .filter((row) => !position || positionLabel(row.slot) === position)
      .sort((a, b) => {
        const left = sortColumn.value(a);
        const right = sortColumn.value(b);
        // Missing stats always sink to the bottom, whichever way it's sorted.
        if (left === null && right === null) return a.name.localeCompare(b.name);
        if (left === null) return 1;
        if (right === null) return -1;
        const compared = sortColumn.text ? String(left).localeCompare(String(right)) : left - right;
        return compared * direction || a.name.localeCompare(b.name);
      });

    const bodyRows = visibleRows
      .map(
        (row) =>
          `<tr>${table.columns
            .map((column) => {
              const content = column.html ? column.html(row) : escapeHtml(formatPlayerStat(column.value(row), column.digits));
              return `<td${column.text ? ' class="player-stats-text"' : ""}>${content}</td>`;
            })
            .join("")}</tr>`
      )
      .join("");

    playerStatsTableEl.innerHTML = `${playerStatsHeaderHtml(table)}<tbody>${bodyRows}</tbody>`;
    playerStatsEmptyEl.hidden = visibleRows.length > 0;
  };

  const renderStats = () => {
    renderLeaderboards();
    renderPlayerStats();
  };

  playerStatsTabsEl.innerHTML = playerStatTables
    .map(
      (table) =>
        `<button type="button" class="btn btn-secondary player-stats-tab" data-table="${table.key}">${escapeHtml(table.label)}</button>`
    )
    .join("");

  playerStatsTabsEl.addEventListener("click", (event) => {
    const tab = event.target.closest(".player-stats-tab");
    if (!tab) return;
    activePlayerTableKey = tab.dataset.table;
    playerSortKey = activePlayerTable().defaultSort;
    playerSortDir = "desc";
    playerStatsPositionEl.value = "";
    renderPlayerStats();
  });

  playerStatsTableEl.addEventListener("click", (event) => {
    const button = event.target.closest(".player-stats-sort-btn");
    if (!button) return;
    const column = activePlayerTable().columns.find((candidate) => candidate.key === button.dataset.key);
    if (!column) return;
    if (playerSortKey === column.key) {
      playerSortDir = playerSortDir === "asc" ? "desc" : "asc";
    } else {
      playerSortKey = column.key;
      playerSortDir = column.text ? "asc" : "desc";
    }
    renderPlayerStats();
  });

  playerStatsSearchEl.addEventListener("input", renderPlayerStats);
  [playerStatsTeamEl, playerStatsPositionEl, playerStatsScopeEl].forEach((selectEl) => {
    selectEl.addEventListener("change", renderPlayerStats);
  });

  let unsubscribeTeams = null;
  let unsubscribeMatchups = null;
  let unsubscribeBoxScores = null;

  const subscribe = () => {
    [unsubscribeTeams, unsubscribeMatchups, unsubscribeBoxScores].forEach((u) => u && u());
    unsubscribeTeams = unsubscribeMatchups = unsubscribeBoxScores = null;

    if (!currentUser) {
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.innerHTML = `Sign in on the <a href="pokemon-league.html">League Home</a> page to view stats.`;
      leaderboardsCardEl.hidden = true;
      playerStatsCardEl.hidden = true;
      return;
    }

    statusEl.hidden = false;
    statusEl.className = "status";
    statusEl.textContent = "Loading…";

    unsubscribeTeams = db.collection("teams").onSnapshot(
      (snapshot) => {
        teamsByUid = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
        renderStats();
      },
      () => {}
    );

    unsubscribeMatchups = db.collection("matchups").onSnapshot(
      (snapshot) => {
        matchups = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        renderStats();
      },
      () => {}
    );

    unsubscribeBoxScores = db.collection("boxScores").onSnapshot(
      (snapshot) => {
        boxScoresByMatchupId = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
        renderStats();
      },
      () => {}
    );
  };

  auth.onAuthStateChanged((user) => {
    currentUser = user;
    subscribe();
  });
})();
