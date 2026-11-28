// Gamecast - reveals a pre-simulated play-by-play on a timer instead of
// all at once. Storage is a lightweight pointer doc at
// gamePlays/{matchupId} (segments.full.activeVersion/revealStart/
// secondsPerPlay) plus the heavy play list in a versioned subcollection
// doc at gamePlays/{matchupId}/versions/full_v{N} - see
// pokemon-schedule.js's Publish Gamecast admin tool, which is what
// creates these. Every visitor's browser just compares now() against
// each play's own computed reveal time (revealStart + index *
// secondsPerPlay) - no server push needed, so it works on a static site
// with no backend.
//
// Admin-only for now, on purpose - this is being saved for the PokéBowl,
// not turned on for regular games yet. Also carries a small admin-only
// test harness (publishes to a fixed gamePlays/gamecast-test doc, not
// tied to any real matchup) so it can be tried out with two arbitrary
// teams before the real thing matters.
(function () {
  const config = window.siteConfig || {};
  const statusEl = document.getElementById("gamecast-status");
  const cardEl = document.getElementById("gamecast-card");
  const scorebugEl = document.getElementById("gamecast-scorebug");
  const feedEl = document.getElementById("gamecast-feed");
  const testCardEl = document.getElementById("gamecast-test-card");
  const testHomeEl = document.getElementById("gamecast-test-home");
  const testAwayEl = document.getElementById("gamecast-test-away");
  const testInputEl = document.getElementById("gamecast-test-input");
  const testSecondsPerPlayEl = document.getElementById("gamecast-test-seconds-per-play");
  const testMessageEl = document.getElementById("gamecast-test-message");
  const testPublishBtnEl = document.getElementById("gamecast-test-publish-btn");
  const audioBarEl = document.getElementById("gamecast-audio-bar");
  const audioBtnEl = document.getElementById("gamecast-audio-btn");
  const audioStatusEl = document.getElementById("gamecast-audio-status");
  const audioAdminCardEl = document.getElementById("gamecast-audio-admin");
  const audioFilesEl = document.getElementById("gamecast-audio-files");
  const audioUploadBtnEl = document.getElementById("gamecast-audio-upload-btn");
  const audioClearBtnEl = document.getElementById("gamecast-audio-clear-btn");
  const audioMessageEl = document.getElementById("gamecast-audio-message");
  const audioSummaryEl = document.getElementById("gamecast-audio-summary");

  if (!cardEl) return;

  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const TEST_MATCHUP_ID = "gamecast-test";
  const matchupId = new URLSearchParams(location.search).get("matchup");

  if (!config.firebaseConfig || config.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") {
    statusEl.className = "status error";
    statusEl.textContent = "Fantasy League is not configured yet.";
    return;
  }

  if (!firebase.apps.length) firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();
  const db = firebase.firestore();
  const storage = firebase.storage ? firebase.storage() : null;

  let currentUser = null;
  let gameDoc = null;
  let teamsByUid = new Map();
  let tickTimer = null;

  const isRealAdmin = () =>
    Boolean(currentUser && config.adminUid && config.adminUid !== "YOUR_ADMIN_UID" && currentUser.uid === config.adminUid);
  // Admin Mode toggle (pokemon-admin-toggle.js) - when switched to user
  // view, this page hides itself exactly like a non-admin would see it,
  // same as every other admin-gated page.
  const isAdmin = () => isRealAdmin() && localStorage.getItem(`adminViewMode:${currentUser.uid}`) !== "user";

  const resultLabels = {
    td: "TOUCHDOWN",
    int: "INTERCEPTION",
    fumble_lost: "FUMBLE",
    fg_good: "FIELD GOAL GOOD",
    fg_miss: "FIELD GOAL NO GOOD",
    xp_good: "EXTRA POINT GOOD",
    xp_miss: "EXTRA POINT NO GOOD",
    safety: "SAFETY",
    turnover_on_downs: "TURNOVER ON DOWNS",
  };

  const teamName = (uid) => (teamsByUid.get(uid) && teamsByUid.get(uid).teamName) || "Unknown team";

  const formatDownDist = (down, dist) => {
    if (down === null || down === undefined || dist === null || dist === undefined) return "";
    const ordinal = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th" }[down] || `${down}th`;
    return `${ordinal} &amp; ${dist}`;
  };

  const revealCount = () => {
    if (!gameDoc || !gameDoc.revealStart) return 0;
    const kickoffMs = gameDoc.revealStart.toMillis();
    const perPlayMs = (gameDoc.secondsPerPlay || 20) * 1000;
    const elapsed = Date.now() - kickoffMs;
    if (elapsed < 0) return 0;
    return Math.min(gameDoc.plays.length, Math.floor(elapsed / perPlayMs) + 1);
  };

  const playCardHtml = (play, isLatest) => {
    const teamKey = play.poss === "home" ? gameDoc.homeUid : gameDoc.awayUid;
    const downDist = formatDownDist(play.down, play.dist);
    const resultText = resultLabels[play.result];
    const classes = ["gamecast-play"];
    if (play.highlight) classes.push("gamecast-play--highlight");
    if (isLatest) classes.push("gamecast-play--latest");
    return `
      <div class="${classes.join(" ")}">
        <div class="gamecast-play-meta">
          <span>Q${play.q} &middot; ${escapeHtml(play.clock || "")}</span>
          <span>${escapeHtml(teamName(teamKey))}${downDist ? ` &middot; ${downDist}` : ""}</span>
        </div>
        ${resultText ? `<p class="gamecast-play-result">${escapeHtml(resultText)}</p>` : ""}
        <p class="gamecast-play-desc">${escapeHtml(play.desc || "")}</p>
        ${linesHtml(play.call)}
      </div>
    `;
  };

  // --- Commentary: Tara's play calls (play.call) and the Walt & Marcus
  // studio segments (payload.breaks) - shown as text in the feed, and
  // played as audio clips when the admin has uploaded them. ---

  const speakerNames = { tara: "Tara", walt: "Walt", marcus: "Marcus" };
  const lineText = (line) => (line && (line.text || line.line)) || "";

  const linesHtml = (lines) =>
    (lines || [])
      .filter((line) => lineText(line))
      .map(
        (line) => `
          <p class="gamecast-line">
            <span class="gamecast-line-speaker">${escapeHtml(speakerNames[line.speaker] || line.speaker || "")}:</span>
            ${escapeHtml(lineText(line))}
          </p>
        `
      )
      .join("");

  const breakTitles = {
    pregame: "Pregame",
    endQ1: "End of the 1st Quarter",
    halftime: "Halftime",
    endQ3: "End of the 3rd Quarter",
    postgame: "Postgame",
  };

  // Which studio segment (if any) comes right before plays[i] - pregame
  // before the first play, then one at each quarter change. Overtime
  // quarters get no segment.
  const breakKeyBefore = (i) => {
    if (i === 0) return "pregame";
    const prevQ = gameDoc.plays[i - 1].q;
    if (gameDoc.plays[i].q === prevQ) return null;
    return { 1: "endQ1", 2: "halftime", 3: "endQ3" }[prevQ] || null;
  };

  const breakCardHtml = (key) => {
    const lines = (key && gameDoc.breaks && gameDoc.breaks[key]) || [];
    if (!lines.some((line) => lineText(line))) return "";
    return `
      <div class="gamecast-break">
        <p class="gamecast-break-title">🎙️ ${escapeHtml(breakTitles[key] || key)} - In the Studio</p>
        ${linesHtml(lines)}
      </div>
    `;
  };

  const render = () => {
    if (!gameDoc) return;
    const count = revealCount();
    const revealed = gameDoc.plays.slice(0, count);
    const latest = revealed[revealed.length - 1];
    const score = latest ? latest.scoreAfter : { home: 0, away: 0 };

    cardEl.hidden = false;
    statusEl.hidden = true;

    if (count === 0) {
      scorebugEl.innerHTML = `
        <div class="gamecast-score-row">
          <span>${escapeHtml(teamName(gameDoc.homeUid))}</span>
          <span class="gamecast-score-value">0 - 0</span>
          <span>${escapeHtml(teamName(gameDoc.awayUid))}</span>
        </div>
        <p class="status">Kickoff hasn't happened yet - check back once it's underway.</p>
      `;
      feedEl.innerHTML = "";
      return;
    }

    const isFinal = count >= gameDoc.plays.length;
    scorebugEl.innerHTML = `
      <div class="gamecast-score-row">
        <span>${escapeHtml(teamName(gameDoc.homeUid))}</span>
        <span class="gamecast-score-value">${score.home} - ${score.away}</span>
        <span>${escapeHtml(teamName(gameDoc.awayUid))}</span>
      </div>
      <p class="status">${isFinal ? "FINAL" : `Q${latest.q} &middot; ${escapeHtml(latest.clock || "")}`}</p>
    `;

    // Newest play first, so the latest action is always visible without
    // scrolling - this re-renders the whole feed on every tick, which is
    // fine at this scale (a game tops out around 150 plays).
    // Built oldest-first (each studio segment right before the play it
    // leads into, postgame after the last play), then flipped.
    const items = [];
    revealed.forEach((play, i) => {
      items.push(breakCardHtml(breakKeyBefore(i)));
      items.push(playCardHtml(play, i === revealed.length - 1));
    });
    if (isFinal) items.push(breakCardHtml("postgame"));
    feedEl.innerHTML = items.reverse().join("");
  };

  // --- Live audio ---
  // Clips live in Storage at gamecastAudio/{matchupId}/v{N}/..., listed on
  // the pointer doc as audio: { version, clips: { "play-12": [urls],
  // "halftime": [urls], ... } }. Clips only count if audio.version matches
  // the active play-list version - a resim can renumber plays, and
  // republishing (which rewrites the pointer doc) drops the audio map
  // anyway. Browsers block sound that starts on its own, so nothing plays
  // until the viewer clicks Listen live; from then on each clip plays as
  // its play is revealed, one at a time, never overlapping.

  // A tiny silent clip played inside the click, so phones (iOS especially)
  // count this audio element as started by the user and let later clips
  // play on their own.
  const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
  const audioEl = new Audio();
  let audioOn = false;
  let audioQueue = [];
  let audioBusy = false;
  let audioHandledCount = 0;
  let postgameQueued = false;

  const audioClips = () => {
    const audio = gameDoc && gameDoc.audio;
    if (!audio || audio.version !== gameDoc.activeVersion || !audio.clips) return {};
    return audio.clips;
  };
  const clipsFor = (key) => (key && audioClips()[key]) || [];
  const hasAnyAudio = () => Object.keys(audioClips()).length > 0;

  const playNextClip = () => {
    if (!audioOn || audioBusy) return;
    const url = audioQueue.shift();
    if (!url) return;
    audioBusy = true;
    audioEl.src = url;
    audioEl.play().catch(() => {
      audioBusy = false;
      playNextClip();
    });
  };
  const finishClip = () => {
    if (!audioBusy) return;
    audioBusy = false;
    playNextClip();
  };
  audioEl.addEventListener("ended", finishClip);
  audioEl.addEventListener("error", finishClip);

  const queueClips = (urls) => {
    audioQueue.push(...urls);
    playNextClip();
  };

  const queueAudioFor = (count) => {
    if (!audioOn || !gameDoc) return;
    if (count > audioHandledCount) {
      // More than a few plays at once means the viewer fell behind (tab
      // in the background, phone asleep) - jump to the newest play rather
      // than reading out a backlog of old ones.
      let from = audioHandledCount;
      if (count - audioHandledCount > 3) {
        from = count - 1;
        audioQueue = [];
      }
      for (let i = from; i < count; i++) {
        queueClips(clipsFor(breakKeyBefore(i)));
        queueClips(clipsFor(`play-${i}`));
      }
      audioHandledCount = count;
    }
    if (count >= gameDoc.plays.length && !postgameQueued) {
      postgameQueued = true;
      queueClips(clipsFor("postgame"));
    }
  };

  const renderAudioBar = () => {
    if (!audioBarEl) return;
    audioBarEl.hidden = !hasAnyAudio();
    audioBtnEl.textContent = audioOn ? "🔇 Mute" : "🔊 Listen live";
    audioStatusEl.textContent = audioOn ? "Audio on - you'll hear each call as it happens." : "";
  };

  const setAudioOn = (on) => {
    audioOn = on;
    audioQueue = [];
    audioBusy = false;
    audioEl.pause();
    if (on) {
      audioEl.src = SILENT_WAV;
      audioEl.play().catch(() => {});
      const count = revealCount();
      const isFinal = gameDoc && count >= gameDoc.plays.length;
      // Live game: start with the play that's on screen now. Finished
      // game: just the postgame segment.
      audioHandledCount = isFinal ? count : Math.max(0, count - 1);
      postgameQueued = false;
      queueAudioFor(count);
    }
    renderAudioBar();
  };

  if (audioBtnEl) audioBtnEl.addEventListener("click", () => setAudioOn(!audioOn));

  const tick = () => {
    render();
    queueAudioFor(revealCount());
    if (gameDoc && revealCount() >= gameDoc.plays.length) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };

  const startTicking = () => {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = setInterval(tick, 2000);
    tick();
  };

  // --- Admin test harness ---

  const populateTestTeamSelects = () => {
    const options = [...teamsByUid.entries()]
      .map(([uid, team]) => `<option value="${uid}">${escapeHtml((team && team.teamName) || uid)}</option>`)
      .join("");
    [testHomeEl, testAwayEl].forEach((selectEl) => {
      const previous = selectEl.value;
      selectEl.innerHTML = options;
      if (previous && teamsByUid.has(previous)) selectEl.value = previous;
    });
  };

  const showTestMessage = (text, isError) => {
    testMessageEl.hidden = false;
    testMessageEl.className = `status${isError ? " error" : ""}`;
    testMessageEl.textContent = text;
  };

  async function publishTestGamecast() {
    const homeUid = testHomeEl.value;
    const awayUid = testAwayEl.value;
    if (!homeUid || !awayUid || homeUid === awayUid) {
      showTestMessage("Pick two different teams.", true);
      return;
    }
    const raw = testInputEl.value.trim();
    if (!raw) {
      showTestMessage("Paste the play-by-play JSON first.", true);
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      showTestMessage(`Invalid JSON: ${error.message}`, true);
      return;
    }
    const errors = [
      ...window.validateGamecastPlays(parsed.plays, {}),
      ...window.validateGamecastBreaks(parsed.breaks),
    ];
    if (errors.length) {
      const shown = errors.slice(0, 10).join("\n");
      const more = errors.length > 10 ? `\n...and ${errors.length - 10} more.` : "";
      showTestMessage(`${errors.length} issue(s) found:\n${shown}${more}`, true);
      return;
    }
    const secondsPerPlay = Number(testSecondsPerPlayEl.value) || 20;

    // The test slot always publishes as version 1 and overwrites itself -
    // it's a sandbox, not a real matchup, so none of the resim-lock
    // concerns that apply to savePlays() in pokemon-schedule.js apply here.
    try {
      const batch = db.batch();
      batch.set(db.collection("gamePlays").doc(TEST_MATCHUP_ID).collection("versions").doc("full_v1"), {
        schemaVersion: parsed.schemaVersion || 1,
        game: parsed.game || null,
        plays: parsed.plays,
        breaks: parsed.breaks || null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        enteredBy: currentUser.uid,
      });
      batch.set(db.collection("gamePlays").doc(TEST_MATCHUP_ID), {
        homeUid,
        awayUid,
        segments: {
          full: {
            activeVersion: 1,
            revealStart: firebase.firestore.Timestamp.now(),
            secondsPerPlay,
          },
        },
        enteredAt: firebase.firestore.FieldValue.serverTimestamp(),
        enteredBy: currentUser.uid,
      });
      await batch.commit();
      showTestMessage("Test Gamecast published - kickoff is now. Open \"View Test Gamecast\" to watch it.", false);
    } catch (error) {
      showTestMessage(error.message, true);
    }
  }

  if (testPublishBtnEl) testPublishBtnEl.addEventListener("click", publishTestGamecast);

  // --- Admin: audio clip upload ---
  // Clips are matched to plays by file name, so a whole game's worth can
  // be picked in one go:
  //   play-12.mp3       Tara's call for plays[12] (counting from 0, the
  //                     same numbering the validator's messages use)
  //   pregame.mp3, endQ1.mp3, halftime.mp3, endQ3.mp3, postgame.mp3
  //                     the studio segments
  // Add -2, -3... (play-12-2.mp3, halftime-2.mp3) to split one spot into
  // several clips that play back to back. Uploading a name again
  // replaces that spot's clips; spots not in the upload are kept.

  const breakKeysByLower = { pregame: "pregame", endq1: "endQ1", halftime: "halftime", endq3: "endQ3", postgame: "postgame" };

  const clipSpotFromFileName = (fileName) => {
    const base = fileName.replace(/\.[^.]+$/, "").trim();
    let match = base.match(/^play[-_ ]?0*(\d+)(?:[-_ ](\d+))?$/i);
    if (match) return { key: `play-${Number(match[1])}`, part: Number(match[2] || 1), playIndex: Number(match[1]) };
    match = base.match(/^(pregame|endq1|halftime|endq3|postgame)(?:[-_ ](\d+))?$/i);
    if (match) return { key: breakKeysByLower[match[1].toLowerCase()], part: Number(match[2] || 1) };
    return null;
  };

  const showAudioMessage = (text, isError) => {
    audioMessageEl.hidden = false;
    audioMessageEl.className = `status${isError ? " error" : ""}`;
    audioMessageEl.textContent = text;
  };

  const renderAudioAdmin = () => {
    if (!audioAdminCardEl) return;
    audioAdminCardEl.hidden = !(isAdmin() && gameDoc);
    if (audioAdminCardEl.hidden) return;
    const clips = audioClips();
    const keys = Object.keys(clips);
    const playSpots = keys.filter((key) => key.startsWith("play-")).length;
    const breakSpots = keys.length - playSpots;
    const playsWithCalls = gameDoc.plays.filter((play) => (play.call || []).some((line) => lineText(line))).length;
    audioSummaryEl.textContent = keys.length
      ? `Attached: clips for ${playSpots} play(s) and ${breakSpots} studio segment(s). ${playsWithCalls} play(s) in this game have a call written.`
      : `No clips attached yet. ${playsWithCalls} play(s) in this game have a call written.`;
  };

  async function uploadAudioClips() {
    if (!gameDoc || !matchupId) return;
    if (!storage) {
      showAudioMessage("File storage didn't load on this page - refresh and try again.", true);
      return;
    }
    const files = [...(audioFilesEl.files || [])];
    if (!files.length) {
      showAudioMessage("Choose the clip files first.", true);
      return;
    }

    const problems = [];
    const parsed = files.map((file) => {
      const spot = clipSpotFromFileName(file.name);
      if (!spot) problems.push(`${file.name}: name doesn't match play-N or pregame/endQ1/halftime/endQ3/postgame.`);
      else if (spot.playIndex !== undefined && spot.playIndex >= gameDoc.plays.length)
        problems.push(`${file.name}: this game only has plays 0-${gameDoc.plays.length - 1}.`);
      else if (!(file.type || "").startsWith("audio/")) problems.push(`${file.name}: not an audio file.`);
      return { file, spot };
    });
    if (problems.length) {
      showAudioMessage(`Nothing uploaded - fix these first:\n${problems.slice(0, 10).join("\n")}`, true);
      return;
    }

    const version = gameDoc.activeVersion;
    audioUploadBtnEl.disabled = true;
    try {
      const uploaded = {};
      for (let i = 0; i < parsed.length; i++) {
        const { file, spot } = parsed[i];
        showAudioMessage(`Uploading ${i + 1} of ${parsed.length}: ${file.name}…`, false);
        const ref = storage.ref(`gamecastAudio/${matchupId}/v${version}/${file.name}`);
        await ref.put(file, { contentType: file.type });
        const url = await ref.getDownloadURL();
        (uploaded[spot.key] = uploaded[spot.key] || []).push({ part: spot.part, url });
      }

      // Re-read the pointer right before writing, so this merges onto
      // whatever is attached now rather than what was loaded earlier.
      const pointerDoc = await db.collection("gamePlays").doc(matchupId).get();
      const pointer = pointerDoc.data() || {};
      const activeVersion = pointer.segments && pointer.segments.full && pointer.segments.full.activeVersion;
      if (activeVersion !== version) {
        showAudioMessage("This game was republished while uploading - the play numbering may have changed. Upload the clips again.", true);
        return;
      }
      const clips = { ...((pointer.audio && pointer.audio.version === version && pointer.audio.clips) || {}) };
      Object.entries(uploaded).forEach(([key, entries]) => {
        clips[key] = entries.sort((a, b) => a.part - b.part).map((entry) => entry.url);
      });
      await db.collection("gamePlays").doc(matchupId).update({ audio: { version, clips } });
      audioFilesEl.value = "";
      showAudioMessage(`Uploaded ${parsed.length} clip(s) across ${Object.keys(uploaded).length} spot(s).`, false);
    } catch (error) {
      showAudioMessage(error.message, true);
    } finally {
      audioUploadBtnEl.disabled = false;
    }
  }

  async function clearAudioClips() {
    if (!gameDoc || !matchupId) return;
    if (!window.confirm("Remove every audio clip from this game? (The files stay in storage; the game just stops playing them.)")) return;
    try {
      await db.collection("gamePlays").doc(matchupId).update({ audio: firebase.firestore.FieldValue.delete() });
      showAudioMessage("All clips removed from this game.", false);
    } catch (error) {
      showAudioMessage(error.message, true);
    }
  }

  if (audioUploadBtnEl) audioUploadBtnEl.addEventListener("click", uploadAudioClips);
  if (audioClearBtnEl) audioClearBtnEl.addEventListener("click", clearAudioClips);

  // --- Live data ---

  let unsubscribeGamePlays = null;

  const subscribe = () => {
    if (unsubscribeGamePlays) {
      unsubscribeGamePlays();
      unsubscribeGamePlays = null;
    }
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }

    if (!isAdmin()) {
      cardEl.hidden = true;
      testCardEl.hidden = true;
      if (audioAdminCardEl) audioAdminCardEl.hidden = true;
      statusEl.hidden = false;
      statusEl.className = "status";
      statusEl.textContent = "Gamecast isn't available yet - check back during a live game.";
      return;
    }

    testCardEl.hidden = false;

    statusEl.hidden = false;
    statusEl.className = "status";
    statusEl.textContent = matchupId ? "Loading…" : "Pick a game above, or open this page from a \"Watch Gamecast\" link.";

    db.collection("teams")
      .get()
      .then((snapshot) => {
        teamsByUid = new Map(snapshot.docs.map((doc) => [doc.id, doc.data()]));
        populateTestTeamSelects();
        render();
      })
      .catch(() => {});

    if (!matchupId) return;

    // Storage: gamePlays/{matchupId} is a lightweight pointer doc
    // (segments.full.activeVersion/revealStart/secondsPerPlay); the heavy
    // play list lives in gamePlays/{matchupId}/versions/full_v{N}. A
    // resim bumps the pointer to a new version rather than overwriting an
    // old one, so this always re-fetches whichever version is current
    // rather than assuming the one it already has is still active.
    unsubscribeGamePlays = db
      .collection("gamePlays")
      .doc(matchupId)
      .onSnapshot(
        (pointerDoc) => {
          if (!pointerDoc.exists) {
            statusEl.hidden = false;
            statusEl.className = "status";
            statusEl.textContent = "No Gamecast has been published for this game yet.";
            cardEl.hidden = true;
            return;
          }
          const pointer = pointerDoc.data();
          const segment = pointer.segments && pointer.segments.full;
          if (!segment || !segment.activeVersion) {
            statusEl.hidden = false;
            statusEl.className = "status";
            statusEl.textContent = "No Gamecast has been published for this game yet.";
            cardEl.hidden = true;
            return;
          }
          db.collection("gamePlays")
            .doc(matchupId)
            .collection("versions")
            .doc(`full_v${segment.activeVersion}`)
            .get()
            .then((versionDoc) => {
              if (!versionDoc.exists) {
                statusEl.hidden = false;
                statusEl.className = "status error";
                statusEl.textContent = "This Gamecast's active version is missing - check with the admin.";
                cardEl.hidden = true;
                return;
              }
              const version = versionDoc.data();
              gameDoc = {
                homeUid: pointer.homeUid,
                awayUid: pointer.awayUid,
                revealStart: segment.revealStart,
                secondsPerPlay: segment.secondsPerPlay,
                plays: version.plays,
                game: version.game,
                breaks: version.breaks || null,
                activeVersion: segment.activeVersion,
                audio: pointer.audio || null,
              };
              // Reloads happen mid-game (e.g. the admin uploading clips) -
              // carry on from what's on screen rather than replaying it.
              if (audioOn) audioHandledCount = revealCount();
              renderAudioBar();
              renderAudioAdmin();
              startTicking();
            })
            .catch((error) => {
              statusEl.hidden = false;
              statusEl.className = "status error";
              statusEl.textContent = `Unable to load this Gamecast: ${error.message}`;
            });
        },
        (error) => {
          statusEl.hidden = false;
          statusEl.className = "status error";
          statusEl.textContent = `Unable to load this Gamecast: ${error.message}`;
        }
      );
  };

  auth.onAuthStateChanged((user) => {
    currentUser = user;
    subscribe();
  });
})();
