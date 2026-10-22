// Weekly sports-analyst audio broadcasts (ElevenLabs-generated). Hand-
// maintained: add one entry here, in the same commit as uploading the
// actual mp3 into audio/, each time a new episode is ready. Order in this
// array doesn't matter - every page that reads it sorts by date itself.
// Also post the announcement to config.discordBroadcastWebhookUrl's
// channel by hand at the same time - that's a separate manual step too,
// not something any site code triggers automatically.
//
// type is one of "preview" | "thursday_recap" | "sunday_recap" |
// "monday_recap" | "week_summary" (see broadcastTypeLabels below for how
// each displays). title is optional - leave it out to get an
// auto-generated "Week N: <type label>".
window.broadcasts = [
  { type: "preview", week: 1, file: "audio/week01-preview.mp3", title: "Fantasy Pokeball Season Preview — Week 1", date: "2026-10-14" },
  { type: "thursday_recap", week: 1, file: "audio/week01-thursday-recap.mp3", title: "Week 1: Thursday Night Primetime Recap", date: "2026-10-15" },
  { type: "sunday_recap", week: 1, file: "audio/week01-sunday-recap.mp3", title: "Week 1: Sunday Slate Recap", date: "2026-10-18" },
  { type: "monday_recap", week: 1, file: "audio/week01-monday-recap.mp3", title: "Week 1: Monday Night Football Recap", date: "2026-10-19" },
  { type: "preview", week: 2, file: "audio/week02-preview.mp3", title: "Fantasy Pokeball Week 2 Preview", date: "2026-10-21" },
  { type: "thursday_recap", week: 2, file: "audio/week02-thursday-recap.mp3", title: "Week 2: Thursday Night Primetime Recap", date: "2026-10-22" },
];

window.broadcastTypeLabels = {
  preview: "Week Preview",
  thursday_recap: "Thursday Recap",
  sunday_recap: "Sunday Recap",
  monday_recap: "Monday Night Recap",
  week_summary: "Week Summary",
};
