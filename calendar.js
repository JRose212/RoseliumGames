(function () {
  const config = window.siteConfig || {};
  const nextNameEl = document.getElementById("next-event-name");
  const nextDateEl = document.getElementById("next-event-date");
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

    if (!rest.length) {
      setStatus("Nothing else on the calendar yet.");
      return;
    }

    const items = rest
      .slice(0, 6)
      .map(
        (event) =>
          `<li class="agenda-item"><span class="agenda-item-date">${formatEventDate(
            event
          )}</span><span class="agenda-item-name">${escapeHtml(
            event.summary || "Untitled event"
          )}</span></li>`
      )
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
