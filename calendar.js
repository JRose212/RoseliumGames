(function () {
  const config = window.siteConfig || {};
  const nextNameEl = document.getElementById("next-event-name");
  const nextDateEl = document.getElementById("next-event-date");
  const nextDescriptionEl = document.getElementById("next-event-description");
  const agendaListEl = document.getElementById("agenda-list");

  if (!agendaListEl) {
    return;
  }

  const escapeHtml = (value) => {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  const setStatus = (message, isError = false) => {
    agendaListEl.innerHTML = `<p class="status${isError ? " error" : ""}">${escapeHtml(message)}</p>`;
  };

  // Google Calendar returns descriptions as HTML (links added in the
  // Calendar UI come through as <a> tags). Sanitize instead of trusting it
  // outright, since anyone with edit access to the calendar can populate it.
  const ALLOWED_TAGS = new Set(["A", "B", "STRONG", "I", "EM", "BR", "SPAN"]);
  const ALLOWED_ATTRS = { A: ["href"] };

  const sanitizeDescriptionHtml = (html) => {
    const template = document.createElement("template");
    template.innerHTML = html;

    const clean = (node) => {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          return;
        }
        if (child.nodeType !== Node.ELEMENT_NODE || !ALLOWED_TAGS.has(child.tagName)) {
          child.replaceWith(document.createTextNode(child.textContent || ""));
          return;
        }
        [...child.attributes].forEach((attr) => {
          const allowed = ALLOWED_ATTRS[child.tagName] || [];
          if (!allowed.includes(attr.name.toLowerCase())) {
            child.removeAttribute(attr.name);
          }
        });
        if (child.tagName === "A") {
          const href = child.getAttribute("href") || "";
          if (!/^https?:\/\//i.test(href)) {
            child.removeAttribute("href");
          } else {
            child.setAttribute("target", "_blank");
            child.setAttribute("rel", "noopener noreferrer");
          }
        }
        clean(child);
      });
    };

    clean(template.content);
    return template.innerHTML;
  };

  const formatEventDate = (event) => {
    const isAllDay = !event.start?.dateTime;
    const start = new Date(event.start?.dateTime || event.start?.date);
    const dateStr = start.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "America/New_York",
    });

    if (isAllDay) {
      return dateStr;
    }

    const timeOptions = { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" };
    const startTime = start.toLocaleTimeString("en-US", timeOptions);
    const end = event.end?.dateTime ? new Date(event.end.dateTime) : null;
    const endTime = end ? end.toLocaleTimeString("en-US", timeOptions) : "";

    return endTime ? `${dateStr} · ${startTime}–${endTime}` : `${dateStr} · ${startTime}`;
  };

  const renderAgenda = (events) => {
    if (!events.length) {
      setStatus("No upcoming events on the calendar.");
      if (nextNameEl) nextNameEl.textContent = "No upcoming events";
      if (nextDateEl) nextDateEl.textContent = "";
      return;
    }

    const [next, ...rest] = events;
    if (nextNameEl) nextNameEl.textContent = next.summary || "Untitled event";
    if (nextDateEl) nextDateEl.textContent = formatEventDate(next);
    if (nextDescriptionEl) {
      nextDescriptionEl.innerHTML = next.description
        ? sanitizeDescriptionHtml(next.description)
        : "";
    }

    if (!rest.length) {
      setStatus("Nothing else on the calendar yet.");
      return;
    }

    const items = rest
      .slice(0, 6)
      .map((event) => {
        const description = event.description
          ? `<div class="agenda-item-description">${sanitizeDescriptionHtml(event.description)}</div>`
          : "";
        return `<li class="agenda-item"><div class="agenda-item-main"><span class="agenda-item-date">${formatEventDate(
          event
        )}</span><span class="agenda-item-name">${escapeHtml(
          event.summary || "Untitled event"
        )}</span></div>${description}</li>`;
      })
      .join("");

    agendaListEl.innerHTML = `<ul class="agenda-items">${items}</ul>`;
  };

  const loadEvents = async () => {
    const apiKey = config.googleCalendarApiKey;
    const calendarId = config.googleCalendarId;

    if (!apiKey || !calendarId || apiKey === "YOUR_GOOGLE_CALENDAR_API_KEY") {
      setStatus("Calendar is not configured yet.", true);
      if (nextNameEl) nextNameEl.textContent = "Calendar not configured";
      if (nextDateEl) nextDateEl.textContent = "";
      return;
    }

    setStatus("Loading events…");

    const timeMin = encodeURIComponent(new Date().toISOString());
    const url =
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events` +
      `?key=${encodeURIComponent(apiKey)}&singleEvents=true&orderBy=startTime&timeMin=${timeMin}&maxResults=10`;

    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Unable to load calendar (${response.status})`);
      }
      const data = await response.json();
      renderAgenda(data.items || []);
    } catch (error) {
      console.error(error);
      setStatus(`Unable to load calendar events. ${error.message}`, true);
      if (nextNameEl) nextNameEl.textContent = "Unable to load";
      if (nextDateEl) nextDateEl.textContent = "";
    }
  };

  loadEvents();
})();
