// Past episodes of the show - standalone, same as the latest-episode
// cards on League Home/Schedule: reads window.broadcasts directly, no
// Firebase/auth dependency, so it shows for signed-out visitors too.
// Deliberately excludes the single latest episode - that one stays
// featured on League Home and the Schedule page, not duplicated here.
(function () {
  const listEl = document.getElementById("kj-show-list");
  const emptyEl = document.getElementById("kj-show-empty");
  if (!listEl) return;

  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const broadcasts = window.broadcasts || [];
  const typeLabels = window.broadcastTypeLabels || {};
  const sorted = [...broadcasts].sort((a, b) => b.date.localeCompare(a.date));
  const past = sorted.slice(1); // drop the latest - it lives elsewhere

  if (!past.length) {
    emptyEl.hidden = false;
    return;
  }

  listEl.innerHTML = past
    .map((b) => {
      const title = b.title || `Week ${b.week}: ${typeLabels[b.type] || b.type}`;
      return `<div class="broadcast-archive-item">
                <p>${escapeHtml(title)} <span class="matchup-day">${escapeHtml(b.date)}</span></p>
                <audio controls src="${escapeHtml(b.file)}" style="width: 100%;"></audio>
              </div>`;
    })
    .join("");
})();
