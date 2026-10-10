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
    "QB", "RB", "WR1", "WR2", "TE",
    "LT", "LG", "C", "RG", "RT",
    "DL1", "DL2", "LB", "CB", "S", "K",
  ],

  pokeApiBaseUrl: "https://pokeapi.co/api/v2",
  pokemonListCacheTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  pokemonDetailCacheTtlMs: 90 * 24 * 60 * 60 * 1000, // 90 days
  minManagersToStartDraft: 8,
};
