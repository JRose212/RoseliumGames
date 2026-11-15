window.siteConfig = {
  // Powderpuff Pokeball League - its own Firebase project, fully separate
  // from the Pokeball and Big Woof leagues' data (separate sign-ups too).
  firebaseConfig: {
    apiKey: "AIzaSyBeD7I0-EfGotHu2IQv3jdEBJGGrfDAf5Y",
    authDomain: "powderpuff-league.firebaseapp.com",
    projectId: "powderpuff-league",
    storageBucket: "powderpuff-league.firebasestorage.app",
    messagingSenderId: "964051727934",
    appId: "1:964051727934:web:3da934e5ea58e9a9fec36f",
  },

  leagueName: "Powderpuff Pokéball League",

  // 7-on-7, no bench, no kicker. Any Pokemon can play any slot, and the
  // same Pokemon can fill every slot (a whole team of Pikachu is fine) -
  // nothing in this league checks for duplicates, within a team or
  // across teams.
  pokemonPositions: ["QB", "RB", "BLK1", "BLK2", "BLK3", "WR1", "WR2", "S", "LB", "T1", "T2", "T3", "CB1", "CB2"],

  positionGroups: {
    offense: ["QB", "RB", "BLK1", "BLK2", "BLK3", "WR1", "WR2"],
    defense: ["S", "LB", "T1", "T2", "T3", "CB1", "CB2"],
  },

  // Full names for the short slot keys above, for anywhere there's room
  // to spell them out (My Team slot cards, the rules).
  positionLabels: {
    QB: "Quarterback",
    RB: "Running Back",
    BLK1: "Blocker 1",
    BLK2: "Blocker 2",
    BLK3: "Blocker 3",
    WR1: "Wide Receiver 1",
    WR2: "Wide Receiver 2",
    S: "Safety",
    LB: "Linebacker",
    T1: "Tackle 1",
    T2: "Tackle 2",
    T3: "Tackle 3",
    CB1: "Cornerback 1",
    CB2: "Cornerback 2",
  },

  // Coordinator page formation, as percentages within each unit's own
  // half (x: 0-100 left to right, y: 0 at the line of scrimmage up to 100
  // deep in that unit's own territory). Same conventions as the other
  // leagues' configs - see big-woof-league/config.js for why line
  // positions keep real distance from y=0. 7-on-7: three blockers/tackles
  // on the line with the receivers/corners split wide, QB and RB stacked
  // behind on offense, the LB and S stacked behind on defense.
  fieldFormations: {
    offense: {
      WR1: { x: 8, y: 9 },
      BLK1: { x: 34, y: 9 },
      BLK2: { x: 50, y: 9 },
      BLK3: { x: 66, y: 9 },
      WR2: { x: 92, y: 9 },
      QB: { x: 50, y: 40 },
      RB: { x: 50, y: 68 },
    },
    defense: {
      CB1: { x: 8, y: 9 },
      T1: { x: 34, y: 9 },
      T2: { x: 50, y: 9 },
      T3: { x: 66, y: 9 },
      CB2: { x: 92, y: 9 },
      LB: { x: 50, y: 36 },
      S: { x: 50, y: 72 },
    },
  },

  // Legendary and Mythical Pokemon (same hand-maintained list as the other
  // leagues). Here they only set the starting point for what's playable -
  // every Pokemon starts playable except these, and the admin can flip any
  // Pokemon either way from the Pokedex page (stored in Firestore,
  // leagueSettings/current.playable). Cheerleaders ignore playability
  // entirely: any Pokemon at all can cheer.
  legendaryPokemonIds: [
    144, 145, 146, 150, 151,
    243, 244, 245, 249, 250, 251,
    377, 378, 379, 380, 381, 382, 383, 384, 385, 386,
    480, 481, 482, 483, 484, 485, 486, 487, 488, 490, 491, 492, 493,
    494, 638, 639, 640, 641, 642, 643, 644, 645, 646, 647, 648, 649,
    716, 717, 718, 719, 720, 721,
    785, 786, 787, 788, 789, 790, 791, 792, 793, 794, 795, 796, 797, 798,
    799, 800, 801, 802, 803, 804, 805, 806, 807, 808, 809,
    888, 889, 890, 893, 894, 895, 896, 897, 898,
    1001, 1002, 1003, 1004, 1007, 1008, 1014, 1015, 1016, 1017, 1024, 1025,
  ],

  // Daily team training (My Team page). Same mechanics as the other
  // leagues (one session a day, a bonus session banked per loss), with
  // this league's own six activities. "item" is the PokeAPI sprites repo
  // item slug shown on each button.
  trainingTypes: [
    { key: "teamHike", label: "Team Hike", color: "#7cc89a", item: "leaf-stone" },
    { key: "touchdownChoreo", label: "Touchdown Celebration Choreo", color: "#f49ac1", item: "silk-scarf" },
    { key: "spaDay", label: "Spa Day", color: "#9ad4f0", item: "heal-ball" },
    { key: "teamYoga", label: "Team Yoga", color: "#c3a6ec", item: "lax-incense" },
    { key: "playOutside", label: "Play Outside", color: "#f6d36b", item: "miracle-seed" },
    { key: "gameplanning", label: "Gameplanning", color: "#f6a98a", item: "town-map" },
  ],

  trainingInfoBlurb:
    'Train your team every day to get them ready for Sunday. You get one session per day, so choose between "Team Hike", "Touchdown Celebration Choreo", "Spa Day", "Team Yoga", "Play Outside", and "Gameplanning". Each one helps your team in its own way. Training more than your opponent doesn\'t guarantee a win, but it can tip the scales.\n\nLosing a game banks a bonus session for the week ahead, so be sure to use it. Bonus sessions stack until your team wins.',

  // Same Discord channels as the Pokeball League (the admin's choice - one
  // shared server). League activity posts here are prefixed with the
  // league name so they're distinguishable from Pokeball's.
  discordWebhookUrl: "https://discord.com/api/webhooks/1560029114906443787/G4kdRTUO-smng_vuodGEcDHmLa7KN_F1bi4vSe4I8AxUZybusZhUWEQXAgnxybJFN-QB",
  discordMessagePrefix: "🎀 Powderpuff: ",
  // Broadcast announcements are posted by hand at publish time (see
  // broadcasts.js) - kept here so the URL is on hand.
  discordBroadcastWebhookUrl: "https://discord.com/api/webhooks/1560033449048416316/Jx4lRD4VJ8aSiHKb_uHx18FXz4XznXDniYXttzRlPfAdOt834QlQ7vLCgmn2nuEOvzuH",

  pokeApiBaseUrl: "https://pokeapi.co/api/v2",
  pokemonListCacheTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  pokemonDetailCacheTtlMs: 90 * 24 * 60 * 60 * 1000, // 90 days

  // Client-side only - controls whether admin buttons/screens are shown.
  // The real enforcement is isAdmin() in firestore.rules/storage.rules,
  // which hardcode this same uid separately - keep all three in sync.
  adminUid: "7pr4oGgKMtaB8vaPWhBEYAfU0Mk1",

  // Season shape: every game is on Sunday, 6 regular-season weeks, at
  // least 4 teams before a schedule can be generated, and every team
  // makes the playoffs (seeded by standings; top seeds get byes when the
  // team count isn't a power of 2).
  regularSeasonWeeks: 6,
  minTeamsToGenerateSchedule: 4,
  touchdownPoints: 7,

  // No roster changes on Sundays (game day), judged in this time zone so
  // every manager hits the same cutoff wherever they are. firestore.rules
  // enforces the same window with a fixed UTC-5 offset (rules have no
  // time zone support) - see the note there.
  rosterLockTimeZone: "America/New_York",

  // Fixed circular axis order for the type-composition radar charts -
  // same computed ordering as the other leagues (a function of type
  // effectiveness, nothing league-specific).
  typeWheelOrder: [
    "ghost", "poison", "rock", "normal", "ice", "water", "steel", "dark",
    "psychic", "electric", "grass", "dragon", "fire", "flying", "ground",
    "fairy", "fighting", "bug",
  ],
};
