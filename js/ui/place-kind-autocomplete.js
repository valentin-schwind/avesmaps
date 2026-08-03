// Ortsart-Typeahead für das Feld „Art" im Ort-bearbeiten-Dialog.
// (docs/superpowers/specs/2026-08-02-ort-bearbeiten-ortsarten-design.md)
//
// Dünner Aufsatz auf attachTypeahead (js/ui/source-autocomplete.js) -- die Dropdown-Mechanik,
// Tastatursteuerung und ARIA werden geteilt, nicht kopiert. Zwei Abweichungen von den anderen
// Aufsätzen, beide absichtlich:
//
//   1. minChars: 0 -- ein leeres Feld zeigt beim Fokus die GANZE Liste. Bei einer Quellensuche
//      wäre das sinnlos (Millionen möglicher URLs), hier ist es der Normalfall: 83 kurze Namen,
//      und wer „Art" öffnet, weiß oft noch nicht, was zur Wahl steht.
//   2. Gefiltert wird IM SPEICHER. Die Liste wird einmal geholt und bleibt liegen -- ein
//      Netzaufruf je Tastendruck kostete mehr als die ganze Nutzlast.
//
// Die Reihenfolge kommt vom Server (nach gemessener Häufigkeit) und wird hier NICHT verändert:
// das Wiki hat einen extremen Langschwanz, alphabetisch begrübe es alles Häufige.

const PLACE_KIND_API_URL = "/api/app/place-kinds.php";
const PLACE_KIND_LIMIT = 12;

// Einmal geholt, dann wiederverwendet. Ein zweiter Dialog-Aufruf soll nicht erneut laden.
let placeKindCatalogPromise = null;

function placeKindDefaultEscape(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function placeKindDefaultTr(_key, fallback) {
  return fallback;
}

// PURE. Filtert den Katalog gegen den Suchbegriff -- dieselbe Regel wie serverseitig
// avesmapsFilterPlaceKinds: Teilstring, Groß/Klein egal. Leerer Begriff = alles (gekappt).
// Beide Seiten müssen dasselbe antworten, sonst zeigt die Liste etwas anderes als sie meint.
function filterPlaceKinds(kinds, term, limit) {
  const list = Array.isArray(kinds) ? kinds : [];
  const max = Number(limit) > 0 ? Number(limit) : PLACE_KIND_LIMIT;
  const needle = String(term || "").trim().toLowerCase();
  if (needle === "") {
    return list.slice(0, max);
  }
  return list.filter((entry) => String(entry && entry.kind || "").toLowerCase().indexOf(needle) !== -1).slice(0, max);
}

function placeKindItemId(item, index) {
  return "pk-" + index;
}

// Hebt den getippten Teil im Namen hervor. Gesplittet wird auf dem ROHEN String und jedes Stück
// einzeln escaped -- auf dem bereits escapten Text könnte die Grenze mitten in einer Entity liegen.
function placeKindHighlight(label, query, escape) {
  const text = String(label || "");
  const needle = String(query || "").trim();
  if (needle === "") {
    return escape(text);
  }
  const lower = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let out = "";
  let cursor = 0;
  for (;;) {
    const hit = lower.indexOf(lowerNeedle, cursor);
    if (hit === -1) {
      out += escape(text.slice(cursor));
      break;
    }
    out += escape(text.slice(cursor, hit));
    out += "<mark>" + escape(text.slice(hit, hit + needle.length)) + "</mark>";
    cursor = hit + needle.length;
  }
  return out;
}

// state = { items:[{kind,count}], activeIndex, query }
function renderPlaceKindAutocompleteHtml(state, opts) {
  const options = opts || {};
  const escape = options.escape || placeKindDefaultEscape;
  const tr = options.tr || placeKindDefaultTr;
  const safeState = state || {};
  const items = Array.isArray(safeState.items) ? safeState.items : [];
  const query = String(safeState.query || "");

  const rows = items
    .map((item, index) => {
      const active = index === safeState.activeIndex;
      // Die Zahl steht dabei, weil sie die Reihenfolge ERKLÄRT. Ohne sie sähe die Sortierung
      // willkürlich aus. „—" statt „0": noch nie benutzt ist kein Messwert, sondern ein Anfang.
      const count = Number(item && item.count) || 0;
      const countLabel = count > 0
        ? '<span class="sac-uses">' + escape(String(count)) + "</span>"
        : '<span class="sac-uses sac-uses--none">' + escape(tr("placeKind.ac.unused", "—")) + "</span>";
      return (
        '<li class="sac-item' + (active ? " is-active" : "") + '" role="option"' +
        ' id="' + escape(placeKindItemId(item, index)) + '"' +
        ' aria-selected="' + (active ? "true" : "false") + '"' +
        ' data-sac-index="' + index + '">' +
        '<span class="sac-name">' + placeKindHighlight(item && item.kind, query, escape) + "</span>" +
        countLabel +
        "</li>"
      );
    })
    .join("");

  const heading = '<div class="sac-head">' + escape(tr("placeKind.ac.heading", "Ortsarten aus dem Wiki")) + "</div>";
  return heading + '<ul class="sac-list" role="listbox">' + rows + "</ul>";
}

// Holt den Katalog einmal. Scheitert der Aufruf, ist das Feld ein normales Textfeld -- ohne
// Vorschläge, aber tippbar. Ein Editor, der nichts eingeben kann, wäre schlechter dran als einer
// ohne Liste.
function loadPlaceKindCatalog() {
  if (placeKindCatalogPromise) {
    return placeKindCatalogPromise;
  }
  placeKindCatalogPromise = fetch(PLACE_KIND_API_URL, { credentials: "same-origin" })
    .then((response) => (response.ok ? response.json() : null))
    .then((payload) => (payload && payload.ok && Array.isArray(payload.kinds) ? payload.kinds : []))
    .catch(() => []);
  return placeKindCatalogPromise;
}

// Hängt den Typeahead an ein Ortsart-Feld. opts: { escape, tr, limit } -- alle optional.
// Rückgabe: detach().
function attachPlaceKindAutocomplete(inputEl, opts) {
  if (typeof attachTypeahead !== "function") {
    return function noop() {}; // Motor nicht geladen -- Tippen bleibt normal möglich
  }
  const options = opts || {};
  const limit = Number(options.limit) > 0 ? Number(options.limit) : PLACE_KIND_LIMIT;
  return attachTypeahead(inputEl, Object.assign({}, options, {
    // 0, nicht 2: siehe Kopf der Datei.
    minChars: 0,
    // Kein Netzverkehr je Tastendruck -> auch keine Wartezeit vor dem Zeichnen.
    debounceMs: 0,
    renderHtml: renderPlaceKindAutocompleteHtml,
    itemId: placeKindItemId,
    onPick(item) {
      inputEl.value = String(item && item.kind || "");
      if (typeof options.onPick === "function") {
        options.onPick(item);
      }
    },
    async search(term) {
      const kinds = await loadPlaceKindCatalog();
      return filterPlaceKinds(kinds, term, limit);
    },
  }));
}

if (typeof window !== "undefined") {
  window.filterPlaceKinds = filterPlaceKinds;
  window.renderPlaceKindAutocompleteHtml = renderPlaceKindAutocompleteHtml;
  window.attachPlaceKindAutocomplete = attachPlaceKindAutocomplete;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { filterPlaceKinds, renderPlaceKindAutocompleteHtml, placeKindHighlight };
}
