// Real validator for Gamecast play-by-play payloads, replacing the loose
// structural check that used to live in pokemon-schedule.js. Shared by
// both leagues (no league-specific content) and loaded on any page that
// publishes a Gamecast.
//
// Checks everything that's mechanically verifiable from the payload alone
// - continuity of field position/down/distance, clock direction, stat
// reconciliation, speaker whitelisting, and the stat keys a slot is
// allowed to carry (pulled straight from config.boxScoreStatFields, so
// this can't drift out of sync with what the Stats page actually shows).
//
// One rule from the agreed spec is deliberately NOT covered here: h1/h2
// segment continuity, since there's no segment concept yet - this only
// validates single "full" play lists. The gameId-matches-matchup
// cross-check IS covered, but only when the caller passes both
// options.expectedGame (the matchup's own week/home/away) and
// options.payloadGame (the pasted JSON's "game" field) - without those,
// that check is silently skipped.
window.validateGamecastPlays = function validateGamecastPlays(plays, options) {
  const config = (options && options.config) || window.siteConfig || {};
  const expectedGame = options && options.expectedGame;
  const errors = [];

  if (!Array.isArray(plays) || !plays.length) {
    errors.push(`"plays" must be a non-empty array.`);
    return errors;
  }

  // Rule: the payload's own "game" descriptor has to match the matchup
  // it's being published against - catches pasting the wrong game's
  // output into the wrong matchup's admin panel.
  if (expectedGame && options.payloadGame) {
    const game = options.payloadGame;
    if (game.week !== undefined && expectedGame.week !== undefined && game.week !== expectedGame.week) {
      errors.push(`game.week (${game.week}) doesn't match this matchup's week (${expectedGame.week}).`);
    }
    if (game.home !== undefined && expectedGame.home !== undefined && game.home !== expectedGame.home) {
      errors.push(`game.home ("${game.home}") doesn't match this matchup's home team ("${expectedGame.home}").`);
    }
    if (game.away !== undefined && expectedGame.away !== undefined && game.away !== expectedGame.away) {
      errors.push(`game.away ("${game.away}") doesn't match this matchup's away team ("${expectedGame.away}").`);
    }
  }

  const scrimmageTypes = ["run", "pass", "sack", "scramble", "kneel", "spike", "penalty"];
  const turnoverResults = ["int", "fumble_lost", "turnover_on_downs"];
  const scoreResults = ["td", "fg_good", "safety"];
  const possHandoffTypes = ["punt", "kickoff"];
  const clockToSeconds = (clock) => {
    const parts = String(clock || "0:00").split(":");
    return (Number(parts[0]) || 0) * 60 + (Number(parts[1]) || 0);
  };

  let homeScore = 0;
  let awayScore = 0;
  let prevQ = null;
  let prevClockSec = null;

  plays.forEach((play, i) => {
    const tag = `plays[${i}] (Q${play && play.q}, ${play && play.clock}, ${play && play.type}/${play && play.result})`;
    const next = plays[i + 1];

    if (!play || typeof play !== "object") {
      errors.push(`plays[${i}] isn't an object.`);
      return;
    }
    if (play.poss !== "home" && play.poss !== "away") {
      errors.push(`${tag}: invalid "poss": ${play.poss}`);
    }
    if (play.stats !== undefined && !Array.isArray(play.stats)) {
      errors.push(`${tag}: "stats" must be an array.`);
    }

    // Rule: clock never increases within a quarter.
    const clockSec = clockToSeconds(play.clock);
    if (prevQ === play.q && clockSec > prevClockSec) {
      errors.push(`${tag}: clock went up within the same quarter (${prevClockSec}s -> ${clockSec}s).`);
    }
    prevQ = play.q;
    prevClockSec = clockSec;

    // Rule: stat-key whitelist per slot, pulled from config.boxScoreStatFields.
    (play.stats || []).forEach((entry, j) => {
      const entryTag = `${tag}.stats[${j}]`;
      if (!entry || typeof entry !== "object") {
        errors.push(`${entryTag} isn't an object.`);
        return;
      }
      if (entry.team !== "home" && entry.team !== "away") {
        errors.push(`${entryTag}: invalid "team": ${entry.team}`);
      }
      if (!entry.slot || !entry.pokemonName) {
        errors.push(`${entryTag}: missing "slot" or "pokemonName".`);
        return;
      }
      const allowed = config.boxScoreStatFields && config.boxScoreStatFields[entry.slot];
      if (!allowed) {
        errors.push(`${entryTag}: unknown slot "${entry.slot}" (${entry.pokemonName}).`);
        return;
      }
      Object.keys(entry.stats || {}).forEach((key) => {
        if (!allowed.includes(key)) {
          errors.push(`${entryTag}: key "${key}" isn't allowed for slot ${entry.slot} (${entry.pokemonName}).`);
        }
      });
    });

    // Rule: sum(passYds) across this play's stats must equal sum(recYds).
    let passYds = 0;
    let recYds = 0;
    (play.stats || []).forEach((entry) => {
      if (entry && entry.stats) {
        if (typeof entry.stats.passYds === "number") passYds += entry.stats.passYds;
        if (typeof entry.stats.recYds === "number") recYds += entry.stats.recYds;
      }
    });
    if (passYds !== recYds) {
      errors.push(`${tag}: passYds sum (${passYds}) != recYds sum (${recYds}).`);
    }

    // Rule: INT reciprocity - a play that resulted in an interception needs
    // exactly one offensive "int" debit and one defensive "int" credit.
    if (play.result === "int") {
      const intCredits = (play.stats || []).filter((entry) => entry && entry.stats && entry.stats.int === 1).length;
      if (intCredits !== 2) {
        errors.push(`${tag}: result is "int" but found ${intCredits} stats entries with int:1 (expected 2 - thrower and defender).`);
      }
    }

    // Rule: field position / down / distance continuity for scrimmage
    // plays that don't change possession, turn the ball over, or score.
    if (
      next &&
      scrimmageTypes.includes(play.type) &&
      play.poss === next.poss &&
      !turnoverResults.includes(play.result) &&
      !scoreResults.includes(play.result)
    ) {
      const expectedBallOn = play.ballOn + play.yards;
      if (play.type === "penalty" && play.penalty && play.penalty.accepted) {
        if (next.down !== play.down) {
          errors.push(`${tag}: accepted pre-snap penalty should keep the same down (was ${play.down}, next is ${next.down}).`);
        }
      } else {
        const gainedFirst = play.yards >= play.dist;
        if (gainedFirst) {
          if (next.down !== 1) {
            errors.push(`${tag}: gained ${play.yards} on ${play.down} & ${play.dist} but next down is ${next.down}, expected 1st.`);
          }
        } else {
          const expectedDown = play.down + 1;
          const expectedDist = play.dist - play.yards;
          if (next.down !== expectedDown) {
            errors.push(`${tag}: expected next down ${expectedDown}, got ${next.down}.`);
          }
          if (next.dist !== expectedDist) {
            errors.push(`${tag}: expected next distance ${expectedDist}, got ${next.dist}.`);
          }
        }
      }
      if (next.ballOn !== expectedBallOn) {
        errors.push(`${tag}: expected next ballOn ${expectedBallOn} (${play.ballOn} + ${play.yards}), got ${next.ballOn}.`);
      }
    }

    // Rule: possession can only flip between consecutive plays for a
    // legal reason - a turnover, a score, or an explicit special-teams
    // handoff play (punt/kickoff) - or across a quarter boundary, where a
    // kickoff may have been left out of the log.
    if (next && play.poss !== next.poss) {
      const legal =
        turnoverResults.includes(play.result) ||
        scoreResults.includes(play.result) ||
        possHandoffTypes.includes(play.type) ||
        possHandoffTypes.includes(next.type) ||
        next.q !== play.q;
      if (!legal) {
        errors.push(`${tag}: possession changes to the next play with no turnover, score, or punt/kickoff to explain it.`);
      }
    }

    // Rule: running cumulative score must match this play's scoreAfter.
    const scoringTeam = { td: play.poss, xp_good: play.poss, fg_good: play.poss, safety: play.poss === "home" ? "away" : "home" };
    const points = { td: 6, xp_good: 1, fg_good: 3, safety: 2 };
    if (points[play.result]) {
      if (scoringTeam[play.result] === "home") homeScore += points[play.result];
      else awayScore += points[play.result];
    }
    if (play.scoreAfter && (play.scoreAfter.home !== homeScore || play.scoreAfter.away !== awayScore)) {
      errors.push(`${tag}: running score ${homeScore}-${awayScore} != scoreAfter ${play.scoreAfter.home}-${play.scoreAfter.away}.`);
    }

    // Rule: call lines are Tara-only.
    (play.call || []).forEach((line, j) => {
      if (line.speaker !== "tara") {
        errors.push(`${tag}.call[${j}]: speaker "${line.speaker}" should be "tara".`);
      }
    });
  });

  return errors;
};

// Validates the studio "breaks" object (pregame/endQ1/halftime/endQ3/postgame
// -> lines), separate from the play list since it's a sibling field on the
// payload, not part of "plays".
window.validateGamecastBreaks = function validateGamecastBreaks(breaks) {
  const errors = [];
  if (!breaks) return errors;
  Object.keys(breaks).forEach((segment) => {
    (breaks[segment] || []).forEach((line, i) => {
      if (line.speaker !== "walt" && line.speaker !== "marcus") {
        errors.push(`breaks.${segment}[${i}]: speaker "${line.speaker}" should be "walt" or "marcus".`);
      }
    });
  });
  return errors;
};
