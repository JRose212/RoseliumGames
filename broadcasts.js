// Weekly sports-analyst audio broadcasts (ElevenLabs-generated). Hand-
// maintained: add one entry here, in the same commit as uploading the
// actual mp3 into audio/, each time a new episode is ready. Order in this
// array doesn't matter - every page that reads it sorts by date itself.
// Also post the announcement to config.discordBroadcastWebhookUrl's
// channel by hand at the same time - that's a separate manual step too,
// not something any site code triggers automatically.
//
// type is one of "preview" | "thursday_recap" | "week_summary" (see
// broadcastTypeLabels below for how each displays). title is optional -
// leave it out to get an auto-generated "Week N: <type label>".
window.broadcasts = [
  { type: "preview", week: 1, file: "audio/week01-preview.mp3", title: "Fantasy Pokeball Season Preview — Week 1", date: "2026-10-14" },
];

window.broadcastTypeLabels = {
  preview: "Week Preview",
  thursday_recap: "Thursday Recap",
  week_summary: "Week Summary",
};
