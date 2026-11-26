// Holiday themes for every league page (Pokeball, Big Woof, Powderpuff).
// Purely additive: on a US holiday it sets data-holiday on <html> and adds
// a header stripe, a greeting banner, a small emoji on the league badge and
// a few drifting emoji - the league's own theme stays as it is. It only
// applies on the holiday itself (viewer's local date) and an open tab
// switches over at midnight, so the next day everything is back to normal.
//
// Preview any theme with ?holiday=<key> (e.g. ?holiday=halloween), or
// ?holiday=none to turn it off for that page load.
(function () {
  const nthWeekday = (year, month, weekday, n) => {
    const first = new Date(year, month, 1).getDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  };
  const lastWeekday = (year, month, weekday) => {
    const lastDate = new Date(year, month + 1, 0);
    return lastDate.getDate() - ((lastDate.getDay() - weekday + 7) % 7);
  };
  // Easter Sunday (Anonymous Gregorian algorithm) as [month, day].
  const easter = (year) => {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return [month, day];
  };

  const SUN = 0, MON = 1, THU = 4;

  // key, greeting, emoji (first one goes on the badge), colors [a, b, c],
  // and when it falls: (year) => [monthIndex, day].
  const holidays = [
    { key: "new-years-day", greeting: "Happy New Year!", emoji: ["🎉", "🎊", "✨", "🥂"], colors: ["#f5c542", "#c0c0c0", "#1d1d3b"], date: () => [0, 1] },
    { key: "mlk-day", greeting: "Honoring Dr. Martin Luther King Jr.", emoji: ["🕊️", "✊", "⭐"], colors: ["#3b3b98", "#f5c542", "#e2e2f0"], date: (y) => [0, nthWeekday(y, 0, MON, 3)] },
    { key: "valentines-day", greeting: "Happy Valentine's Day!", emoji: ["💖", "💘", "💕", "🌹"], colors: ["#e63973", "#ff9ec4", "#b5174f"], date: () => [1, 14] },
    { key: "presidents-day", greeting: "Happy Presidents' Day!", emoji: ["🇺🇸", "⭐", "🎩"], colors: ["#b22234", "#f5f5f5", "#3c3b6e"], date: (y) => [1, nthWeekday(y, 1, MON, 3)] },
    { key: "st-patricks-day", greeting: "Happy St. Patrick's Day!", emoji: ["☘️", "🍀", "🌈", "🪙"], colors: ["#169b62", "#7ed957", "#f5c542"], date: () => [2, 17] },
    { key: "easter", greeting: "Happy Easter!", emoji: ["🐣", "🥚", "🐰", "🌷"], colors: ["#c9a7f5", "#ffe58a", "#9ee6c4"], date: (y) => easter(y) },
    { key: "mothers-day", greeting: "Happy Mother's Day!", emoji: ["💐", "🌸", "💗"], colors: ["#f49ac1", "#ffd1e3", "#b05c8f"], date: (y) => [4, nthWeekday(y, 4, SUN, 2)] },
    { key: "memorial-day", greeting: "Memorial Day - remembering those who served.", emoji: ["🇺🇸", "🌺", "⭐"], colors: ["#b22234", "#f5f5f5", "#3c3b6e"], date: (y) => [4, lastWeekday(y, 4, MON)] },
    { key: "fathers-day", greeting: "Happy Father's Day!", emoji: ["👔", "🏆", "💙"], colors: ["#2f6fb5", "#9cc7ef", "#1b3c64"], date: (y) => [5, nthWeekday(y, 5, SUN, 3)] },
    { key: "juneteenth", greeting: "Happy Juneteenth!", emoji: ["✊🏾", "⭐", "🎉"], colors: ["#d62828", "#1f1f1f", "#2a9d4a"], date: () => [5, 19] },
    { key: "independence-day", greeting: "Happy 4th of July!", emoji: ["🎆", "🇺🇸", "🎇", "⭐"], colors: ["#b22234", "#f5f5f5", "#3c3b6e"], date: () => [6, 4] },
    { key: "labor-day", greeting: "Happy Labor Day!", emoji: ["🛠️", "🇺🇸", "⭐"], colors: ["#3c3b6e", "#f5c542", "#b22234"], date: (y) => [8, nthWeekday(y, 8, MON, 1)] },
    { key: "indigenous-peoples-day", greeting: "Indigenous Peoples' Day", emoji: ["🪶", "🌾", "🍂"], colors: ["#b5562c", "#e8b04a", "#2f6b4f"], date: (y) => [9, nthWeekday(y, 9, MON, 2)] },
    { key: "halloween", greeting: "Happy Halloween!", emoji: ["🎃", "👻", "🦇", "🕸️"], colors: ["#ff7a1a", "#6b2fb3", "#1a1a1a"], date: () => [9, 31] },
    { key: "veterans-day", greeting: "Thank you, veterans.", emoji: ["🇺🇸", "🎖️", "⭐"], colors: ["#b22234", "#f5f5f5", "#3c3b6e"], date: () => [10, 11] },
    { key: "thanksgiving", greeting: "Happy Thanksgiving!", emoji: ["🦃", "🍁", "🍂", "🥧"], colors: ["#e8742a", "#a8323e", "#e9b83c"], date: (y) => [10, nthWeekday(y, 10, THU, 4)] },
    { key: "christmas-eve", greeting: "Merry Christmas Eve!", emoji: ["🎄", "❄️", "⭐", "🎁"], colors: ["#c8102e", "#1e7b3c", "#f5f5f5"], date: () => [11, 24] },
    { key: "christmas", greeting: "Merry Christmas!", emoji: ["🎄", "🎁", "❄️", "⛄"], colors: ["#c8102e", "#1e7b3c", "#f5f5f5"], date: () => [11, 25] },
    { key: "new-years-eve", greeting: "Happy New Year's Eve!", emoji: ["🥳", "🎆", "✨", "🎊"], colors: ["#f5c542", "#8a5cf6", "#1d1d3b"], date: () => [11, 31] },
  ];

  const holidayFor = (date) => {
    const y = date.getFullYear();
    return holidays.find((h) => {
      const [month, day] = h.date(y);
      return month === date.getMonth() && day === date.getDate();
    }) || null;
  };

  const override = new URLSearchParams(window.location.search).get("holiday");
  const pickHoliday = () => {
    if (override === "none") return null;
    if (override) return holidays.find((h) => h.key === override) || null;
    return holidayFor(new Date());
  };

  const root = document.documentElement;
  let decorations = [];

  const clear = () => {
    delete root.dataset.holiday;
    ["--holiday-a", "--holiday-b", "--holiday-c"].forEach((v) => root.style.removeProperty(v));
    decorations.forEach((el) => el.remove());
    decorations = [];
  };

  // Runs in <head> so data-holiday is on the page before first paint.
  const applyRootTheme = (h) => {
    root.dataset.holiday = h.key;
    root.style.setProperty("--holiday-a", h.colors[0]);
    root.style.setProperty("--holiday-b", h.colors[1]);
    root.style.setProperty("--holiday-c", h.colors[2]);
  };

  const make = (tag, className, text) => {
    const el = document.createElement(tag);
    el.className = className;
    if (text) el.textContent = text;
    decorations.push(el);
    return el;
  };

  const addDecorations = (h) => {
    const stickyTop = document.querySelector(".sticky-top");
    if (stickyTop) {
      stickyTop.appendChild(make("div", "holiday-stripe"));
      const banner = make("div", "holiday-banner");
      banner.setAttribute("role", "note");
      const text = document.createElement("span");
      text.className = "holiday-banner-text";
      text.textContent = `${h.emoji[0]} ${h.greeting} ${h.emoji[0]}`;
      banner.appendChild(text);
      stickyTop.insertAdjacentElement("afterend", banner);
    }

    const badge = document.querySelector(".pokemon-nav-badge");
    if (badge) {
      const mark = make("span", "holiday-badge-mark", h.emoji[0]);
      mark.setAttribute("aria-hidden", "true");
      badge.appendChild(mark);
    }

    const layer = make("div", "holiday-drift");
    layer.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 14; i++) {
      const piece = document.createElement("span");
      piece.className = "holiday-drift-piece";
      piece.textContent = h.emoji[i % h.emoji.length];
      piece.style.left = `${(i * 7.1 + (i % 3) * 2.3) % 100}%`;
      piece.style.animationDelay = `${-(i * 1.7) % 22}s`;
      piece.style.animationDuration = `${16 + (i % 5) * 2.5}s`;
      piece.style.fontSize = `${0.9 + (i % 4) * 0.25}rem`;
      layer.appendChild(piece);
    }
    document.body.appendChild(layer);
  };

  const apply = () => {
    clear();
    const h = pickHoliday();
    if (!h) return;
    applyRootTheme(h);
    if (document.body) addDecorations(h);
    else document.addEventListener("DOMContentLoaded", () => { if (root.dataset.holiday === h.key) addDecorations(h); }, { once: true });
  };

  // Re-check just after each local midnight so an open tab picks up (or
  // drops) a holiday without a reload.
  const scheduleMidnight = () => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
    setTimeout(() => {
      apply();
      scheduleMidnight();
    }, next - now);
  };

  apply();
  if (!override) {
    scheduleMidnight();
    // A laptop that slept through midnight can fire the timer late, so
    // also re-check whenever the tab comes back into view.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      const h = pickHoliday();
      if ((h ? h.key : undefined) !== root.dataset.holiday) apply();
    });
  }
})();
