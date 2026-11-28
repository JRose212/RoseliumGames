// Admin Mode toggle - shared verbatim across all 9 pokemon-*.html pages,
// same convention as pokemon-chat.js, since it's the same widget
// everywhere. Lets the real admin browse any page as a regular user
// would see it, then flip back to see admin-only controls again. This
// is a local display preference only (localStorage, keyed per-uid since
// it's shared across both leagues on the same origin) - it never touches
// anything server-side. Firestore rules check the real uid regardless of
// this toggle, so turning it "off" hides admin buttons in the UI without
// giving up any actual admin rights.
(function () {
  const config = window.siteConfig || {};
  const wrapEl = document.getElementById("admin-mode-toggle-wrap");
  if (!wrapEl) return;

  if (!config.firebaseConfig || config.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") return;

  if (!firebase.apps.length) firebase.initializeApp(config.firebaseConfig);
  const auth = firebase.auth();

  const storageKey = (uid) => `adminViewMode:${uid}`;

  const render = (user) => {
    const isRealAdmin = Boolean(
      user && config.adminUid && config.adminUid !== "YOUR_ADMIN_UID" && user.uid === config.adminUid
    );
    if (!isRealAdmin) {
      wrapEl.hidden = true;
      wrapEl.innerHTML = "";
      return;
    }

    const isOn = localStorage.getItem(storageKey(user.uid)) !== "user";
    wrapEl.hidden = false;
    wrapEl.innerHTML = `
      <label class="admin-mode-toggle" title="Show or hide admin-only controls on every page - a local display preference, not a security setting.">
        <input type="checkbox" id="admin-mode-checkbox" ${isOn ? "checked" : ""} />
        <span>Admin Mode</span>
      </label>
    `;

    document.getElementById("admin-mode-checkbox").addEventListener("change", (event) => {
      if (event.target.checked) {
        localStorage.removeItem(storageKey(user.uid));
      } else {
        localStorage.setItem(storageKey(user.uid), "user");
      }
      // Simplest way to make every admin-gated section on the page
      // (each computed once from its own isAdmin() at load/render time,
      // not watching a live flag) re-evaluate with the new setting.
      location.reload();
    });
  };

  auth.onAuthStateChanged((user) => render(user));
})();
