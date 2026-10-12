window.siteConfig = {
  playersCsvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRUSV8rqQT0DIb8xkeVcFxCv8ImYTb0KbRyhcKaLMqw9IA-erXFBCzyySFinxGe529jrA8Yw11Qzrjx/pub?gid=701366900&single=true&output=csv",
  diceThroneCharactersCsvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRUSV8rqQT0DIb8xkeVcFxCv8ImYTb0KbRyhcKaLMqw9IA-erXFBCzyySFinxGe529jrA8Yw11Qzrjx/pub?gid=0&single=true&output=csv",
  unmatchedCharactersCsvUrl: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRUSV8rqQT0DIb8xkeVcFxCv8ImYTb0KbRyhcKaLMqw9IA-erXFBCzyySFinxGe529jrA8Yw11Qzrjx/pub?gid=1410128693&single=true&output=csv",
  googleCalendarId: "840188158400048b02ec5482ae4b0571ceffb3210167cd0cab4532605b70b20d@group.calendar.google.com",
  googleCalendarApiKey: "AIzaSyCbZI-jOv-WBXT2yMOBsSyMCeTve9ZQcow",

  // Fantasy Pokemon League config. Paste the Firebase web app config from
  // Firebase Console > Project settings > General > Your apps here.
  firebaseConfig: {
    apiKey: "AIzaSyBlhD8kJ41PHg-C00mVMSSzwFbtlAIWch0",
    authDomain: "pokemon-fantasy-football.firebaseapp.com",
    projectId: "pokemon-fantasy-football",
    storageBucket: "pokemon-fantasy-football.firebasestorage.app",
    messagingSenderId: "592103385042",
    appId: "1:592103385042:web:96baa24c0c401bed9b0a0b",
  },

  // One slot per roster position. Easy to edit if the league's position
  // list changes - nothing else in the app hardcodes these names.
  pokemonPositions: [
    "QB", "RB", "FB", "WR1", "WR2", "TE", "LT", "RT", "LG", "RG", "C",
    "DE", "DT", "NT", "ILB1", "ILB2", "OLB1", "OLB2", "CB1", "CB2", "FS", "SS",
    "K",
    "BENCH1", "BENCH2", "BENCH3",
  ],

  // Same slots as pokemonPositions, grouped for the roster page's
  // offense/defense list layout. Keep in sync with pokemonPositions above
  // if the position list ever changes. Bench slots have no position
  // restriction, same as every other slot - they're just filled/displayed
  // last.
  positionGroups: {
    offense: ["QB", "RB", "FB", "WR1", "WR2", "TE", "LT", "RT", "LG", "RG", "C"],
    defense: ["DE", "DT", "NT", "ILB1", "ILB2", "OLB1", "OLB2", "CB1", "CB2", "FS", "SS"],
    specialTeams: ["K"],
    bench: ["BENCH1", "BENCH2", "BENCH3"],
  },

  // Daily team training (My Team page). Each type's "item" is the PokeAPI
  // sprites repo item slug shown on its button - chosen to fit the
  // training concept rather than being literally about that item (the
  // stat-boosting vitamins map 1:1 onto attack/defense/sp.atk/sp.def,
  // which lines up neatly with run/pass offense/defense).
  trainingTypes: [
    { key: "passOffense", label: "Pass Offense", color: "#2f6fed", item: "calcium" },
    { key: "runOffense", label: "Run Offense", color: "#d9542f", item: "protein" },
    { key: "passDefense", label: "Pass Defense", color: "#2fa7c7", item: "zinc" },
    { key: "runDefense", label: "Run Defense", color: "#3f9e52", item: "iron" },
    { key: "filmSession", label: "Film Session", color: "#8e5fd9", item: "tm-normal" },
    { key: "teamBonding", label: "Team Bonding", color: "#d9a62f", item: "exp-share" },
  ],
  trainingInfoBlurb:
    'Train your Team daily to enhance their abilities in their upcoming matchup. You are allowed to do one training session per day so choose wisely between "Pass Defense", "Run Defense", "Pass Offense", "Run Offense", "Film Session", "Team Bonding". Each training type provides different benefits to your team to edge out your opponent. Training more than your opponent for the week does not guarantee you win the matchup but it does help tip the scales. Determine your best training regiment and log in daily to get them right.\n\nLosing a matchup grants you a bonus practice session for the upcoming week, so be sure to use them. Bonus training sessions stack per week until your team wins a game.',

  pokeApiBaseUrl: "https://pokeapi.co/api/v2",
  pokemonListCacheTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  pokemonDetailCacheTtlMs: 90 * 24 * 60 * 60 * 1000, // 90 days
  minManagersToStartDraft: 8,

  // Client-side only - just controls whether admin buttons/screens are
  // shown. The real enforcement is isAdmin() in firestore.rules, which
  // has to hardcode this same uid separately since rules can't read this file.
  adminUid: "x9IEoSPGiDfg2xeYpLIX34Muqmh2",
  autodraftTimeoutMs: 30 * 1000, // 30 seconds - live draft night
  regularSeasonWeeks: 13,
};
