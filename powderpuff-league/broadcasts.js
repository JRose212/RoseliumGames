// Radio show episodes for the Powderpuff Pokeball League. Hand-maintained:
// add one entry here, in the same commit as uploading the mp3 into
// powderpuff-league/audio/, each time a new episode is ready. Order in this
// array doesn't matter - every page that reads it sorts by date itself.
// Post the announcement to config.discordBroadcastWebhookUrl's channel by
// hand at the same time.
//
// Every game is on Sunday in this league, so the types are just a preview
// and a recap. title is optional - leave it out to get an auto-generated
// "Week N: <type label>".
window.broadcasts = [];

window.broadcastTypeLabels = {
  preview: "Week Preview",
  sunday_recap: "Sunday Recap",
  week_summary: "Week Summary",
};
