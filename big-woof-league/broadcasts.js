// Weekly sports-analyst audio broadcasts for Big Woof League (if this
// league gets its own show - leave empty otherwise). Hand-maintained:
// add one entry here, in the same commit as uploading the actual mp3
// into audio/, each time a new episode is ready. Order in this array
// doesn't matter - every page that reads it sorts by date itself.
//
// type is one of "preview" | "thursday_recap" | "sunday_recap" |
// "monday_recap" | "week_summary" (see broadcastTypeLabels below for how
// each displays). title is optional - leave it out to get an
// auto-generated "Week N: <type label>".
window.broadcasts = [];

window.broadcastTypeLabels = {
  preview: "Week Preview",
  thursday_recap: "Thursday Recap",
  sunday_recap: "Sunday Recap",
  monday_recap: "Monday Night Recap",
  week_summary: "Week Summary",
};
