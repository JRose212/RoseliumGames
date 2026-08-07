(function () {
  const page = document.body?.dataset?.page;
  const statusEl = document.getElementById("table-status");
  const tableEl = document.getElementById("records-table");
  const gameSelect = document.getElementById("game-select");

  if (!statusEl || !tableEl) {
    return;
  }

  // Debug logging
  console.log("Page:", page);
  console.log("siteConfig:", window.siteConfig);

  const config = window.siteConfig || {};

  const getCsvUrl = () => {
    if (page === "characters") {
      const selectedGame = gameSelect?.value || "dice-throne";
      return selectedGame === "unmatched"
        ? config.unmatchedCharactersCsvUrl
        : config.diceThroneCharactersCsvUrl;
    }

    return config.playersCsvUrl;
  };

  const setStatus = (message, isError = false) => {
    statusEl.hidden = false;
    statusEl.textContent = message;
    statusEl.classList.toggle("error", isError);
  };

  const parseCsv = async () => {
    setStatus("Loading records…");
    tableEl.innerHTML = "";

    const csvUrl = getCsvUrl();
    if (!csvUrl) {
      setStatus("No records feed is configured yet for this view.", true);
      return;
    }

    try {
      const response = await fetch(csvUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Unable to load records (${response.status})`);
      }

      const csvText = await response.text();
      const parsed = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
      });

      if (parsed.errors?.length) {
        console.warn("CSV parse warnings", parsed.errors);
      }

      const rows = parsed.data.filter(Boolean);
      if (!rows.length) {
        throw new Error("The CSV did not contain any rows.");
      }

      renderTable(rows);
      setStatus("");
      statusEl.hidden = true;
    } catch (error) {
      console.error(error);
      setStatus(`Unable to load records. ${error.message}`, true);
      tableEl.innerHTML = "";
    }
  };

  const renderTable = (rows) => {
    const columns = getColumns(rows);
    const headerRow = columns
      .map((column) => `<th data-key="${column}">${formatHeader(column)}</th>`)
      .join("");
    const bodyRows = rows.map((row) => {
      return `<tr>${columns
        .map((column) => `<td>${escapeHtml(getCellValue(row, column))}</td>`)
        .join("")}</tr>`;
    });

    tableEl.innerHTML = `<thead><tr>${headerRow}</tr></thead><tbody>${bodyRows.join("")}</tbody>`;

    tableEl.querySelectorAll("th").forEach((header) => {
      header.addEventListener("click", () => {
        sortRows(rows, header.dataset.key);
      });
    });
  };

  const getColumns = (rows) => {
    const keys = new Set();
    rows.forEach((row) => Object.keys(row).forEach((key) => keys.add(key)));
    return Array.from(keys);
  };

  const getCellValue = (row, column) => {
    const value = row[column];
    if (value === undefined || value === null) {
      return "";
    }
    return String(value).trim();
  };

  const formatHeader = (column) => {
    return column.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  };

  const sortRows = (rows, key) => {
    const sortedRows = [...rows].sort((a, b) => {
      const left = parseNumericValue(getCellValue(a, key));
      const right = parseNumericValue(getCellValue(b, key));
      if (!Number.isNaN(left) && !Number.isNaN(right)) {
        return right - left;
      }
      return getCellValue(a, key).localeCompare(getCellValue(b, key));
    });

    renderTable(sortedRows);
  };

  const parseNumericValue = (value) => {
    const normalized = String(value).replace(/[^0-9.\-]/g, "");
    return Number(normalized);
  };

  const escapeHtml = (value) => {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  gameSelect?.addEventListener("change", parseCsv);
  parseCsv();
})();
