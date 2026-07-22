// Ortsname-Typeahead für den Anlegen-Dialog (Bug #41, Folgewunsch): beim Tippen des Ortsnamens
// schlägt die Wiki-Registry passende Siedlungen vor, und jede Zeile sagt, ob sie noch zu vergeben
// ist.
//
// 💣 Die Belegung wird NICHT vom Server geholt. Jeder geladene Ort trägt seine Zuordnung bereits
// mit (`location.wikiSettlement`, js/routing/routing.js:77), also steht die Antwort im Browser
// schon bereit -- ein Server-Feld dafür wäre eine zweite Wahrheit und eine Abfrage pro Tastendruck.
// Es ist bewusst reine Anzeige: eine belegte Zeile bleibt wählbar, und geprüft wird serverseitig
// nichts (Owner-Entscheidung 2026-07-22). Wer hier sperrt, sperrt an der falschen Schicht.
//
// Aufbau wie js/ui/source-autocomplete.js: reine Render-Funktionen (unter Node testbar) plus ein
// dünner Aufsatz auf attachTypeahead -- die Dropdown-Mechanik wird geteilt, nicht kopiert.

const SETTLEMENT_AUTOCOMPLETE_API_URL = "/api/edit/wiki/settlements.php";
const SETTLEMENT_AUTOCOMPLETE_LIMIT = 8;
const SETTLEMENT_AUTOCOMPLETE_MIN_CHARS = 2;

function settlementAutocompleteDefaultEscape(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function settlementAutocompleteDefaultTr(_key, fallback) {
  return fallback;
}

// Der Treffer-Hervorheber der Quellen-Liste, geteilt statt nachgebaut. Im Browser ein Global; unter
// Node installiert ihn der Test (Muster: die Tests setzen die ECHTEN Globals, keine Attrappen).
function settlementAutocompleteHighlight(label, query, escape) {
  if (typeof renderSourceAutocompleteLabel === "function") {
    return renderSourceAutocompleteLabel(label, query, escape);
  }
  return escape(String(label === null || label === undefined ? "" : label));
}

function settlementAutocompleteItemId(_item, index) {
  return "sac-opt-settlement-" + index;
}

// title -> Name des Orts, der ihn hält. Aus den bereits geladenen Markern, kein Netzverkehr.
// excludePublicId lässt den gerade bearbeiteten Ort aus: seine eigene Zuordnung ist keine fremde
// Belegung, und ohne das meldete der Bearbeiten-Dialog jede Siedlung als "vergeben an sich selbst".
function buildAssignedWikiSettlementIndex(markerEntries, excludePublicId) {
  const index = new Map();
  const entries = Array.isArray(markerEntries) ? markerEntries : [];
  const skip = String(excludePublicId || "");
  entries.forEach((entry) => {
    if (!entry || !entry.location) {
      return;
    }
    if (skip !== "" && String(entry.publicId || "") === skip) {
      return;
    }
    const wiki = entry.location.wikiSettlement;
    const title = wiki && wiki.title ? String(wiki.title) : "";
    if (title === "") {
      return;
    }
    // Erster Fund gewinnt. Dass ein Titel doppelt belegt ist, kommt vor (die 1:1-Regel ist nirgends
    // durchgesetzt) -- dann irgendeinen Halter zu nennen ist besser als gar keinen.
    if (!index.has(title)) {
      index.set(title, String(entry.location.name || entry.name || ""));
    }
  });
  return index;
}

// state = { items:[{title,name,settlement_label,assignedTo}], activeIndex, query }
function renderSettlementAutocompleteHtml(state, opts) {
  const options = opts || {};
  const escape = options.escape || settlementAutocompleteDefaultEscape;
  const tr = options.tr || settlementAutocompleteDefaultTr;
  const safeState = state || {};
  const items = Array.isArray(safeState.items) ? safeState.items : [];
  const query = String(safeState.query || "");

  const rows = items
    .map((item, index) => {
      const active = index === safeState.activeIndex;
      const holder = String(item.assignedTo || "");
      const taken = holder !== "";
      // Beide Zustände werden ausgesprochen. "Frei" nur durch fehlendes Abzeichen anzudeuten hieße,
      // eine geladene und eine noch nicht geladene Karte sähen gleich aus.
      const status = taken
        ? '<span class="sac-badge sac-badge--taken">' +
          escape(tr("settlement.ac.taken", "vergeben an {n}").replace("{n}", holder)) + "</span>"
        : '<span class="sac-badge sac-badge--free">' + escape(tr("settlement.ac.free", "frei")) + "</span>";
      const kind = item.settlement_label
        ? '<span class="sac-uses">' + escape(item.settlement_label) + "</span>"
        : "";
      return (
        '<li class="sac-item' + (active ? " is-active" : "") + (taken ? " is-taken" : "") + '" role="option"' +
        ' id="' + escape(settlementAutocompleteItemId(item, index)) + '"' +
        ' aria-selected="' + (active ? "true" : "false") + '"' +
        ' data-sac-index="' + index + '">' +
        '<span class="sac-name">' + settlementAutocompleteHighlight(item.name, query, escape) + "</span>" +
        kind + status +
        "</li>"
      );
    })
    .join("");

  const heading = '<div class="sac-head">' + escape(tr("settlement.ac.heading", "Siedlungen aus dem Wiki")) + "</div>";
  return heading + '<ul class="sac-list" role="listbox">' + rows + "</ul>";
}

// Hängt den Typeahead an ein Ortsnamen-Feld. opts:
//   onPick(item)        -- erhält die gewählte Wiki-Siedlung
//   excludePublicId()   -- optional; Getter auf den gerade bearbeiteten Ort
//   tr, escape, limit   -- optional
function attachSettlementNameAutocomplete(inputEl, opts) {
  if (typeof attachTypeahead !== "function") {
    return function noop() {}; // Motor nicht geladen -- Tippen bleibt normal möglich
  }
  const options = opts || {};
  const limit = Number(options.limit) > 0 ? Number(options.limit) : SETTLEMENT_AUTOCOMPLETE_LIMIT;
  return attachTypeahead(inputEl, Object.assign({}, options, {
    minChars: SETTLEMENT_AUTOCOMPLETE_MIN_CHARS,
    renderHtml: renderSettlementAutocompleteHtml,
    itemId: settlementAutocompleteItemId,
    async search(term, signal) {
      const url = SETTLEMENT_AUTOCOMPLETE_API_URL +
        "?action=search&q=" + encodeURIComponent(term) + "&limit=" + limit;
      const response = await fetch(url, { credentials: "same-origin", signal: signal });
      const data = await response.json();
      const rows = data && data.ok === true && Array.isArray(data.rows) ? data.rows : [];
      // Der Belegt-Index wird pro Anfrage frisch gebaut, nicht pro Zeile: er entsteht aus einem
      // Array, das ohnehin im Speicher liegt, und eine zwischengespeicherte Fassung wäre nach dem
      // nächsten Zuweisen falsch.
      const assigned = buildAssignedWikiSettlementIndex(
        typeof locationMarkers !== "undefined" ? locationMarkers : [],
        typeof options.excludePublicId === "function" ? options.excludePublicId() : ""
      );
      return rows.map((row) => Object.assign({}, row, { assignedTo: assigned.get(String(row.title || "")) || "" }));
    },
  }));
}

if (typeof window !== "undefined") {
  window.buildAssignedWikiSettlementIndex = buildAssignedWikiSettlementIndex;
  window.renderSettlementAutocompleteHtml = renderSettlementAutocompleteHtml;
  window.attachSettlementNameAutocomplete = attachSettlementNameAutocomplete;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildAssignedWikiSettlementIndex, renderSettlementAutocompleteHtml };
}
