// Shared feature-source editor widget (multi-source system #2). Renders a read-only Wiki
// Aventurica row (when the entity has a wiki link) plus a deletable list of catalog sources
// plus an "add source" row, and mounts that markup with a delegated add/remove click handler
// wired to POST /api/edit/map/feature-sources.php. Used by every edit surface (settlement,
// region, path, territory editors) via the shared entity_type/entity_public_id contract.
//
// Catalog sources split into two groups: rows with origin === "wiki_publication" (populated by
// the WikiSync publication reconcile) render under an "Aus dem Wiki (automatisch)" heading;
// manual/community rows render below as before. Both use the identical remove control -- the
// server (not this renderer) decides whether a remove is a suppression (wiki-origin, tombstoned
// so the next sync doesn't re-add it) or a hard delete (manual/community), keyed off the row's
// origin (api/_internal/app/feature-sources.php:avesmapsRemoveFeatureSource).
//
// renderFeatureSourceEditorHtml(state, opts) is pure/DOM-free so it is Node-testable
// (mirrors js/map-features/map-features-point-in-polygon.js's module/window export pattern).

const FEATURE_SOURCE_API_URL = "/api/edit/map/feature-sources.php";
// 8-value taxonomy -- must mirror the PHP whitelist in avesmapsFeatureSourceUpsert
// (api/_internal/app/feature-sources.php). Order here is the dropdown order. "regionalband"
// (the old 4-value enum) is retired; featureSourceTypeLabel() below still falls back to
// "Sonstiges" for that or any other legacy/unknown stored value, so old rows keep rendering.
const FEATURE_SOURCE_TYPES = [
  "regionalspielhilfe",
  "abenteuer",
  "aventurischer_bote",
  "quellenband",
  "roman",
  "briefspiel",
  "regelbuch",
  "sonstiges",
];
const FEATURE_SOURCE_TYPE_LABELS = {
  regionalspielhilfe: "Regionalspielhilfe",
  abenteuer: "Abenteuer",
  aventurischer_bote: "Aventurischer Bote",
  quellenband: "Quellenband",
  roman: "Roman",
  briefspiel: "Briefspiel",
  regelbuch: "Regelbuch",
  sonstiges: "Sonstiges",
};
// Optional coverage classification -- mirrors Wiki Aventurica's ==Publikationen== subsections
// (Ausführliche/Ergänzende Quellen, Erwähnungen) AND the popup's tab split (feature-source-markup.js):
// '' -> flat "Quelle(n):" line; ausfuehrlich/ergaenzend -> "Offiziell" tab; erwaehnung -> "Erwähnt" tab.
// Server whitelist mirror: avesmapsAddFeatureSource (api/_internal/app/feature-sources.php).
const FEATURE_SOURCE_REFERENCE_KINDS = ["", "ausfuehrlich", "ergaenzend", "erwaehnung"];
const FEATURE_SOURCE_REFERENCE_KIND_LABELS = {
  "": "Standardquelle",
  ausfuehrlich: "Ausführlich",
  ergaenzend: "Ergänzend",
  erwaehnung: "Nur Erwähnung",
};
function featureSourceReferenceKindLabel(kind) {
  return FEATURE_SOURCE_REFERENCE_KIND_LABELS[kind || ""] || FEATURE_SOURCE_REFERENCE_KIND_LABELS[""];
}

// Default HTML-escape (DOM-free -- safe under Node). Callers embedded in the browser may
// still inject a document-based escaper via opts.escape; both behave identically for markup
// purposes, this one just doesn't need a live DOM to do it.
function featureSourceDefaultEscape(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Default translation passthrough: (key, fallback) -> fallback. Callers may inject a real
// tr() (e.g. a future i18n layer) without changing this module.
function featureSourceDefaultTr(_key, fallback) {
  return fallback;
}

function featureSourceTypeLabel(type) {
  return FEATURE_SOURCE_TYPE_LABELS[type] || FEATURE_SOURCE_TYPE_LABELS.sonstiges;
}

function renderFeatureSourceWikiRow(wikiUrl, escape, tr) {
  if (!wikiUrl) {
    return "";
  }
  const label = tr("popup.wiki", "Wiki Aventurica");
  return (
    '<div class="fs-row fs-row--wiki" data-fs-readonly="wiki">' +
    '<a class="fs-row__link" href="' + escape(wikiUrl) + '" target="_blank" rel="noopener">' +
    escape(label) + " ↗</a>" +
    '<span class="fs-row__badge fs-row__badge--readonly">' + escape(tr("sources.readonly", "fest")) + "</span>" +
    "</div>"
  );
}

// 💣 `featureSourceShortenPages` steht in `js/ui/feature-source-markup.js` und NICHT hier: es gilt
// fuer dieselbe Spalte derselben Zeile in ZWEI Oberflaechen -- der Infobox, die jeder Besucher
// sieht, und diesem Editor. Zwei Fassungen liefen beim ersten abweichenden Sonderfall auseinander.
//
// 💣 ZWEI Ladewege, und der zweite ist beim Umzug fast durchgerutscht: im Browser laedt jede der
// fuenf Seiten `feature-source-markup.js` DAVOR, und beide Skripte teilen sich den globalen Raum --
// unter Node aber `require`t man diese Datei, und dort gibt es keinen. Zwei fremde Tests taten genau
// das und fielen mit `ReferenceError` um; gefunden hat es das GANZE Testfeld, nicht die eigenen.
//
// 🪤 Und der Name ist ABSICHTLICH ein anderer: zwei `function` desselben Namens im globalen Raum
// sind gueltiges JS, die spaeter geladene gewinnt -- ein gleichnamiger Weiterreicher, der
// `window.featureSourceShortenPages` aufruft, ruft SICH SELBST auf.
//
// ⚠️ Nachgeschlagen wird bei JEDEM Aufruf, nicht einmal beim Laden: sonst haelt der Verweis eine
// Fassung fest, und ein Test, der die geteilte Funktion ersetzt, misst weiter die alte.
// 🔴 KEIN stiller Rueckfall: fehlt die Datei, gibt es einen lauten Fehler. Eine Ersatzfassung waere
// genau die zweite Wahrheit, die dieser Umzug beseitigt.
function featureSourcePagesShorten(pages) {
  var geteilt = (typeof module !== "undefined" && module.exports)
    ? require("../ui/feature-source-markup.js").featureSourceShortenPages
    : (typeof featureSourceShortenPages === "function" ? featureSourceShortenPages : null);
  if (typeof geteilt !== "function") {
    throw new Error("feature-source-markup.js fehlt -- sie traegt die Kuerzung der Seitenangabe");
  }
  return geteilt(pages);
}

// 🔴 Die Lizenztafel und der Lizenztext kommen aus feature-source-markup.js, wie die
// Seitenkuerzung darueber und aus demselben Grund: eine Regel, die einen von zwei Erzeugern
// bindet, ist keine. Die Infobox und dieser Editor zeigen dieselbe Angabe derselben Quelle.
// 🔴 KEIN stiller Rueckfall auf eine leere Liste: die waere ein Auswahlfeld ohne Auswahl, und
// niemand saehe, dass die Datei fehlt -- er saehe nur, dass es keine Lizenzen gibt.
// ⚠️ Nachgeschlagen bei JEDEM Aufruf, nicht einmal beim Laden (siehe featureSourcePagesShorten).
function featureSourceLicenseTable() {
  var geteilt = (typeof module !== "undefined" && module.exports)
    ? require("../ui/feature-source-markup.js").FEATURE_SOURCE_LICENSES
    : (typeof FEATURE_SOURCE_LICENSES !== "undefined" ? FEATURE_SOURCE_LICENSES : null);
  if (!geteilt || typeof geteilt !== "object") {
    throw new Error("feature-source-markup.js fehlt -- sie traegt die Lizenztafel");
  }
  return geteilt;
}

function featureSourceLicenseLine(source) {
  var geteilt = (typeof module !== "undefined" && module.exports)
    ? require("../ui/feature-source-markup.js").featureSourceLicenseText
    : (typeof featureSourceLicenseText === "function" ? featureSourceLicenseText : null);
  if (typeof geteilt !== "function") {
    throw new Error("feature-source-markup.js fehlt -- sie traegt die Lizenzangabe");
  }
  return geteilt(source);
}

function renderFeatureSourceRow(source, escape, tr) {
  const officialMark = source.official ? " *" : "";
  // 🔴 Gekuerzt ANGEZEIGT, vollstaendig im Titel. Eine Wiki-Publikation nennt schnell zwoelf
  // Einzelseiten („S. 16, 19, 27, 28, 39, 63, 96, 102, 104, 105, 114, 122"), und die schoben in
  // der Zeile alles andere aus dem Blick.
  // 💣 Eine LEERE Zelle, wenn es keine Seitenangabe gibt -- nicht gar keine. Das Raster gibt jeder
  // Zeile dieselbe Spaltenvorlage; faellt eine Zelle weg, rutscht alles rechts davon eine Spalte
  // nach links. Dieselbe Falle steht bei der Bandtabelle schon angeschrieben.
  const seiten = featureSourcePagesShorten(source.pages);
  const pages = seiten.kurz
    ? '<span class="fs-row__pages"'
      + (seiten.gekuerzt ? ' title="' + escape("S. " + seiten.voll) + '"' : "")
      + ">S. " + escape(seiten.kurz) + "</span>"
    : '<span class="fs-row__pages"></span>';
  // Coverage classification badge (only when set) -- tells the editor which publication tab this row
  // renders in on the public popup. Empty reference_kind -> no badge (source shows on the flat line).
  // 💣 Auch hier eine LEERE Zelle statt keiner -- siehe die Begruendung bei den Seiten.
  const kind = source.reference_kind
    ? '<span class="fs-row__kind">' + escape(featureSourceReferenceKindLabel(source.reference_kind)) + "</span>"
    : '<span class="fs-row__kind"></span>';
  // 💣 Auch hier eine LEERE Zelle statt keiner -- das Raster gibt jeder Zeile dieselbe
  // Spaltenvorlage. ⚠️ Und leer heisst „nicht erfasst", nie „keine Lizenz": deshalb steht dort
  // nichts und nicht etwa ein Strich, der wie eine Aussage aussaehe.
  const lizenz = featureSourceLicenseLine(source);
  const license = lizenz.text
    ? '<span class="fs-row__license">' + escape(lizenz.text) + "</span>"
    : '<span class="fs-row__license"></span>';
  return (
    '<div class="fs-row" data-source-id="' + escape(source.source_id) + '">' +
    '<a class="fs-row__link" href="' + escape(source.url) + '" target="_blank" rel="noopener">' +
    escape(source.label || source.url) + " ↗</a>" +
    '<span class="fs-row__badge">' + escape(featureSourceTypeLabel(source.type)) + officialMark + "</span>" +
    kind +
    pages +
    license +
    '<button type="button" class="fs-row__remove" data-remove-source-id="' + escape(source.source_id) + '">✕</button>' +
    "</div>"
  );
}

// Sources auto-populated by the WikiSync publication reconcile (origin === "wiki_publication")
// render together under their own heading so editors can tell "the wiki put this here" apart
// from what they curated by hand. No rows -> no heading (never render an empty group). Each row
// uses the same renderFeatureSourceRow as the manual list -- the remove button is identical;
// only the server-side interpretation of "remove" differs by origin.
// Ab wie vielen Quellen der Rest zusammengeklappt wird. 🔴 Owner 24.08.2026: „wenn mehr wie 5
// quellen dranstehen, ist der rest zusammengeklappt" -- die Listen werden im Wiki-Zweig schnell
// zwanzig Zeilen lang und schoben alles darunter aus dem Blick.
// ⚠️ Die Regel gilt AUSNAHMSLOS ab 6: bei genau sechs verbirgt der Knopf eine einzige Zeile und
// kostet dabei etwa so viel Platz, wie er spart. Das ist bewusst nicht wegoptimiert -- eine Regel
// mit einer Ausnahme bei 6 ist schwerer zu erklaeren als die Regel selbst, und der haeufige Fall
// sind zwanzig, nicht sechs.
const FEATURE_SOURCE_COLLAPSE_AFTER = 5;

/**
 * Aus einer Zeilenliste: die ersten fuenf offen, der Rest in einem aufklappbaren Kasten.
 *
 * 🔴 NATIV, und nichts anderes -- `<details>/<summary>`. Nur damit findet Strg+F den Text einer
 * ZUgeklappten Quelle und klappt sie selbst auf; ein selbstgebautes Auf- und Zuklappen mit
 * `hidden` nimmt der Seitensuche den Text weg. Dieselbe Begruendung wie beim Fenster „Hinweise"
 * (AGENTS.md §11). Fokus, Enter/Leertaste und `aria-expanded` kommen ebenfalls vom Element.
 *
 * ⚠️ Die Zahl steht IM Knopf („12 weitere"), nicht daneben. Ein „mehr anzeigen" ohne Zahl
 * zwingt zum Aufklappen, nur um zu sehen, ob sich das Aufklappen lohnt.
 *
 * @param {string[]} zeilen fertige Zeilen-HTML-Schnipsel
 * @returns {string} HTML
 */
function renderFeatureSourceCollapsedRows(zeilen, escape, tr) {
  const alle = Array.isArray(zeilen) ? zeilen : [];
  if (alle.length <= FEATURE_SOURCE_COLLAPSE_AFTER) {
    return alle.join("");
  }
  const offen = alle.slice(0, FEATURE_SOURCE_COLLAPSE_AFTER).join("");
  const rest = alle.slice(FEATURE_SOURCE_COLLAPSE_AFTER);
  const wort = rest.length === 1
    ? tr("sources.moreOne", "eine weitere Quelle")
    : String(rest.length) + " " + tr("sources.moreMany", "weitere Quellen");
  return offen
    + '<details class="fs-more">'
    + '<summary class="fs-more__toggle">' + escape(wort) + "</summary>"
    + '<div class="fs-more__rest">' + rest.join("") + "</div>"
    + "</details>";
}

/**
 * Die Spaltenueberschrift einer Quellenliste.
 *
 * 🔴 Sie liegt auf DEMSELBEN Raster wie die Zeilen (`.fs-col-heads` traegt dieselbe
 * `grid-template-columns` wie `.fs-row`) -- eine zweite Vorlage liefe beim ersten geaenderten
 * Spaltenmass auseinander, und dann stuenden die Ueberschriften neben ihren Spalten.
 * ⚠️ Erst ab zwei Zeilen: ueber einer einzelnen Quelle sind vier Ueberschriften mehr Text als
 * Inhalt.
 */
function renderFeatureSourceColumnHeads(anzahl, escape, tr) {
  if (anzahl < 2) {
    return "";
  }
  const kopf = (schluessel, vorgabe) => "<span>" + escape(tr(schluessel, vorgabe)) + "</span>";
  return '<div class="fs-col-heads" aria-hidden="true">'
    + kopf("sources.colTitle", "Titel")
    + kopf("sources.colType", "Typ")
    + kopf("sources.colKind", "Art")
    + kopf("sources.colPages", "Seiten")
    + kopf("sources.colLicense", "Lizenz")
    + "<span></span>"
    + "</div>";
}

function renderFeatureSourceWikiAutoGroup(wikiAutoSources, escape, tr) {
  if (!wikiAutoSources.length) {
    return "";
  }
  const heading =
    '<div class="fs-group-heading">' + escape(tr("sources.wikiAuto", "Aus dem Wiki (automatisch)")) + "</div>";
  // 🔴 Die laengste Liste im Haus: der Wiki-Zweig traegt bei gepflegten Objekten zwanzig und mehr
  // Eintraege und schob alles darunter aus dem Blick.
  const rows = renderFeatureSourceCollapsedRows(
    wikiAutoSources.map((source) => renderFeatureSourceRow(source, escape, tr)), escape, tr);
  return '<div class="fs-group fs-group--wiki-auto" data-fs-group="wiki-auto">' + heading + renderFeatureSourceColumnHeads(wikiAutoSources.length, escape, tr) + rows + "</div>";
}

// Sources an editor added while the entity does not exist yet (bug #41: creating a place). They
// live only in a local buffer until create_point returns a public_id, so they get their own
// heading -- an editor must be able to tell "this is already stored" from "this goes in when I
// save". Same row renderer as everywhere else, so the remove button works identically; here it
// just splices the buffer instead of reaching the server.
function renderFeatureSourcePendingGroup(pendingSources, escape, tr) {
  if (!pendingSources.length) {
    return "";
  }
  const heading =
    '<div class="fs-group-heading">' + escape(tr("sources.pending", "Wird beim Anlegen übernommen")) + "</div>";
  const rows = pendingSources.map((source) => renderFeatureSourceRow(source, escape, tr)).join("");
  return '<div class="fs-group fs-group--pending" data-fs-group="pending">' + heading + rows + "</div>";
}

function renderFeatureSourceAddRow(escape, tr) {
  const options = FEATURE_SOURCE_TYPES.map(
    (type) => '<option value="' + escape(type) + '">' + escape(featureSourceTypeLabel(type)) + "</option>"
  ).join("");
  // Coverage classification -> which publication tab the source lands in (empty = flat line).
  const kindOptions = FEATURE_SOURCE_REFERENCE_KINDS.map(
    (kind) => '<option value="' + escape(kind) + '">' + escape(featureSourceReferenceKindLabel(kind)) + "</option>"
  ).join("");
  // 🔴 Die Lizenz der QUELLE (Owner 27.08.2026: „quellen fehlt das lizenz-feld").
  // ⚠️ Die leere Auswahl heisst „nicht erfasst" und ist die Vorgabe -- NICHT „keine Lizenz".
  // Wer das sagen will, waehlt „Keine freie Lizenz". Die beiden gleichzusetzen waere eine
  // Rechtsaussage, die niemand getroffen hat, und sie stuende an 1694 Quellen.
  // 💣 Die Liste kommt aus feature-source-markup.js, nicht aus einer Kopie hier: dieselbe Regel
  // wie bei der Seitenkuerzung -- eine Liste, die einen von zwei Erzeugern bindet, ist keine.
  const lizenzTafel = featureSourceLicenseTable();
  const licenseOptions = '<option value="">' + escape(tr("sources.add.licenseNone", "Lizenz …")) + "</option>" +
    Object.keys(lizenzTafel).map(
      (key) => '<option value="' + escape(key) + '">' + escape(lizenzTafel[key].label) + "</option>"
    ).join("");
  return (
    '<div class="fs-row fs-row--add" data-fs-add>' +
    '<input type="text" class="fs-add-url" placeholder="' + escape(tr("sources.add.url", "URL")) + '">' +
    '<input type="text" class="fs-add-label" placeholder="' + escape(tr("sources.add.label", "Quellenname")) + '">' +
    // Instruction 5a requires the form to SAY which case occurred -- without this an editor cannot
    // tell whether they just referenced the existing source or minted a duplicate.
    '<span class="fs-add-picked" data-fs-picked hidden>' +
    escape(tr("sources.add.picked", "bestehende Quelle")) +
    '<button type="button" class="fs-add-picked__x" data-fs-unpick aria-label="' +
    escape(tr("sources.add.unpick", "Auswahl aufheben")) + '">✕</button>' +
    "</span>" +
    '<input type="text" class="fs-add-pages" placeholder="' + escape(tr("sources.add.pages", "Seite(n)")) + '">' +
    '<select class="fs-add-type">' + options + "</select>" +
    '<select class="fs-add-kind" title="' + escape(tr("sources.add.kind", "Abdeckung: Ausführlich/Ergänzend → Offiziell-Tab, Erwähnung → Erwähnt-Tab, sonst normale Quellenzeile")) + '">' + kindOptions + "</select>" +
    '<select class="fs-add-license" title="' + escape(tr("sources.add.licenseHint", "Unter welcher Lizenz steht die Quelle? Leer heißt „nicht erfasst“, nicht „keine Lizenz“.")) + '">' + licenseOptions + "</select>" +
    '<input type="text" class="fs-add-attribution" placeholder="' + escape(tr("sources.add.attribution", "Namensnennung")) + '" title="' + escape(tr("sources.add.attributionHint", "Wen die Lizenz zu nennen verlangt, z. B. „VolkoV / garetien.de“.")) + '">' +
    '<label class="fs-add-official-label">' +
    '<input type="checkbox" class="fs-add-official"> ' + escape(tr("sources.add.official", "offiziell")) +
    "</label>" +
    '<button type="button" class="fs-row__add" data-fs-add-submit>' + escape(tr("sources.add.submit", "Hinzufügen")) + "</button>" +
    "</div>" +
    // Platz für die Absage. Ohne ihn verschluckte der Knopf den Klick wortlos, sobald die URL fehlte
    // -- der häufigste Fall beim Anlegen, wo man einen Buchtitel im Kopf hat und keinen Link.
    '<p class="fs-add-note" data-fs-note hidden></p>'
  );
}

// Pure render: state = { wiki_url, sources:[{source_id,url,label,type,official,origin}] }.
// origin is optional for backward compatibility (older cached responses/tests without it are
// treated as non-wiki, i.e. rendered in the manual/community group).
// opts = { escape, tr } (both injectable; defaults are DOM-free so this runs under Node).
function renderFeatureSourceEditorHtml(state, opts) {
  const options = opts || {};
  const escape = options.escape || featureSourceDefaultEscape;
  const tr = options.tr || featureSourceDefaultTr;
  const safeState = state || {};
  const sources = Array.isArray(safeState.sources) ? safeState.sources : [];

  // Split into "wiki-automatic" (origin === "wiki_publication") vs everything else
  // (manual/community rows, and legacy rows with no origin field yet) so they render as two groups.
  const wikiAutoSources = sources.filter((source) => source && source.origin === "wiki_publication");
  // Not-yet-saved rows (origin "pending", from createPendingFeatureSourceStore) are their own group
  // and must not fall into the manual list -- they are not stored anywhere yet.
  const pendingSources = sources.filter((source) => source && source.origin === "pending");
  const otherSources = sources.filter(
    (source) => !(source && (source.origin === "wiki_publication" || source.origin === "pending"))
  );

  const wikiRow = renderFeatureSourceWikiRow(safeState.wiki_url, escape, tr);
  const wikiAutoGroup = renderFeatureSourceWikiAutoGroup(wikiAutoSources, escape, tr);
  const pendingGroup = renderFeatureSourcePendingGroup(pendingSources, escape, tr);
  // ⚠️ Dieselbe Regel fuer die von Hand gepflegten Quellen. Sie sind meist kuerzer -- aber eine
  // Klappregel, die nur eine von zwei Listen bindet, ist keine Regel (die Lehre der
  // Verkehrsmittel-Sperre, AGENTS.md).
  const sourceRows = renderFeatureSourceCollapsedRows(
    otherSources.map((source) => renderFeatureSourceRow(source, escape, tr)), escape, tr);
  const addRow = renderFeatureSourceAddRow(escape, tr);

  // Reviewer/editor guidance shown above the source list (all mount surfaces). The copy carries an
  // intentional <strong> emphasis and is trusted developer/i18n text (never user input), so it is
  // inserted as HTML rather than escaped.
  const hint = '<div class="fs-hint">' + tr("sources.hint",
    "Tragt bei Quellen immer den eigentlichen <strong>Veröffentlichungstitel der Quelle</strong> und den Link ein. Achtet darauf, ob es sich um eine offizielle Quelle handelt.") + "</div>";
  return '<div class="fs-editor">' + hint + wikiRow + pendingGroup + wikiAutoGroup + sourceRows + addRow + "</div>";
}

// POST helper: returns the parsed JSON body, or null on any transport/parse failure so the
// mount handler can guard non-ok responses without ever throwing into the click handler.
async function featureSourceFetch(body) {
  try {
    const response = await fetch(FEATURE_SOURCE_API_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await response.json();
  } catch (error) {
    return null;
  }
}

// A drop-in stand-in for the server, for the one case where there is no server to talk to yet:
// the entity does not exist (bug #41 -- "Quelle beim Anlegen"). It answers the same four actions
// with the same envelope the endpoint returns, so mountFeatureSourceEditor cannot tell the
// difference and needs no create-mode of its own.
//
// Every buffered row gets a fresh NEGATIVE display id. Real catalog ids are positive, so the two
// can never collide, and picking the same catalog source twice still yields two independently
// removable rows. The picked catalog id (0 when the editor typed a new source) rides along in
// catalog_source_id and is what toSuggestions() hands to the replay.
function createPendingFeatureSourceStore() {
  const entries = [];
  let nextLocalId = -1;

  // Copies, not the live objects: the widget writes the result straight into its render path and
  // must not be able to mutate the buffer by accident.
  function snapshot() {
    return { ok: true, wiki_url: "", sources: entries.map((entry) => Object.assign({}, entry)) };
  }

  return {
    async request(action, body) {
      const payload = body || {};
      if (action === "add" || action === "add_existing") {
        entries.push({
          source_id: nextLocalId--,
          catalog_source_id: Number(payload.source_id) || 0,
          url: String(payload.url || ""),
          label: String(payload.label || ""),
          type: String(payload.source_type || "sonstiges"),
          official: Boolean(payload.is_official),
          pages: String(payload.pages || ""),
          reference_kind: String(payload.reference_kind || ""),
          origin: "pending",
        });
      } else if (action === "remove") {
        const id = Number(payload.source_id);
        const index = entries.findIndex((entry) => entry.source_id === id);
        if (index >= 0) {
          entries.splice(index, 1);
        }
      }
      return snapshot();
    },
    // The shape linkCommunityReportSource() consumes -- a non-zero source_id routes to
    // add_existing, a zero one to add. Same replay path an accepted community report uses.
    toSuggestions() {
      return entries.map((entry) => ({
        source_id: entry.catalog_source_id,
        url: entry.url,
        label: entry.label,
        source_type: entry.type,
        reference_kind: entry.reference_kind,
        is_official: entry.official,
        pages: entry.pages,
      }));
    },
    count() {
      return entries.length;
    },
  };
}

// Mount the widget into containerEl and wire add/remove. entityType is fixed for the mount's
// lifetime; publicIdGetter is called fresh on every request so the same mounted widget can
// track a selection that changes after opening (e.g. the settlement editor's selected feature).
// opts.store swaps the server for a local buffer (createPendingFeatureSourceStore) -- used by the
// create case, where there is no entity_public_id to POST against yet.
function mountFeatureSourceEditor(containerEl, entityType, publicIdGetter, opts) {
  if (!containerEl) {
    return;
  }

  // Present only in the create case: every request is answered locally instead of over the wire.
  const pendingStore = (opts && opts.store) || null;
  const tr = (opts && opts.tr) || featureSourceDefaultTr;

  // Sagt, warum ein Klick nicht zum Ziel führte. textContent, nicht innerHTML: die Meldung zitiert
  // den eingetippten Quellennamen, also Nutzereingabe.
  function showAddRowNote(message) {
    const note = containerEl.querySelector("[data-fs-note]");
    if (note) {
      note.textContent = message;
      note.hidden = false;
    }
  }

  // Re-mounting the SAME node (rather than a fresh one) must not leave the previous mount's
  // dropdown behind either -- see the note at the end of wireAutocomplete below.
  if (typeof containerEl.__fsDetachAutocomplete === "function") {
    containerEl.__fsDetachAutocomplete();
    containerEl.__fsDetachAutocomplete = null;
  }

  // Instruction 5a state: the catalog row the editor picked from the typeahead, if any. Reset on
  // every re-render and cleared the moment they edit url/label by hand (then they no longer mean
  // that row).
  let detachAutocomplete = null;
  let pickedSourceId = 0;

  function clearPick() {
    pickedSourceId = 0;
    const badge = containerEl.querySelector("[data-fs-picked]");
    if (badge) {
      badge.hidden = true;
    }
  }

  // The widget re-renders from the server after every add/remove, which destroys the add-row and
  // its input. So re-attach after each render -- and detach FIRST, or every render stacks another
  // listener set plus another orphaned dropdown node on the page.
  function wireAutocomplete() {
    if (detachAutocomplete) {
      detachAutocomplete();
      detachAutocomplete = null;
    }
    pickedSourceId = 0;
    if (typeof attachSourceAutocomplete !== "function") {
      return; // component not loaded on this surface -- typing a new source still works
    }
    const labelInput = containerEl.querySelector(".fs-add-label");
    const urlInput = containerEl.querySelector(".fs-add-url");
    if (!labelInput) {
      return;
    }
    labelInput.addEventListener("input", clearPick);
    if (urlInput) {
      urlInput.addEventListener("input", clearPick);
    }
    detachAutocomplete = attachSourceAutocomplete(
      labelInput,
      Object.assign({}, opts, {
        onPick(item) {
          pickedSourceId = Number(item.source_id) || 0;
          labelInput.value = item.label || "";
          if (urlInput) {
            urlInput.value = item.url || "";
          }
          const typeSelect = containerEl.querySelector(".fs-add-type");
          if (typeSelect && item.type) {
            typeSelect.value = item.type;
          }
          const officialInput = containerEl.querySelector(".fs-add-official");
          if (officialInput) {
            officialInput.checked = Boolean(item.official);
          }
          const badge = containerEl.querySelector("[data-fs-picked]");
          if (badge) {
            badge.hidden = false;
          }
          // Focus the page field: it is the one value belonging to THIS link rather than to the
          // work itself, so it is the only thing still worth typing.
          const pagesInput = containerEl.querySelector(".fs-add-pages");
          if (pagesInput) {
            pagesInput.focus();
          }
        },
      })
    );
    // Published on the container so a caller that DESTROYS this node can still tear the dropdown
    // down first. attachSourceAutocomplete appends its .sac box to document.body, so a node that
    // is thrown away without detaching leaves that box orphaned there forever. Surfaces that mount
    // once (settlement/region/path/territory/citymap dialogs) never need this; the lore editor
    // re-renders its whole detail pane on every field save, and without it each save would stack
    // another dead dropdown on the page -- the exact failure the comment above wireAutocomplete
    // warns about, one level further out.
    containerEl.__fsDetachAutocomplete = detachAutocomplete;
  }

  async function renderFromServer(action, extra) {
    const publicId = typeof publicIdGetter === "function" ? publicIdGetter() : publicIdGetter;
    const body = Object.assign({ action, entity_type: entityType, entity_public_id: publicId }, extra || {});
    const data = pendingStore ? await pendingStore.request(action, body) : await featureSourceFetch(body);
    if (!data || data.ok !== true) {
      return; // keep the prior render on any failure -- never blank the widget
    }
    containerEl.innerHTML = renderFeatureSourceEditorHtml(data, opts);
    wireAutocomplete();
    // 💣 DER EINE TRICHTER -- hier muendet JEDE Aktion des Editors (list, add, add_existing, remove).
    // Vorher zeichnete er nur sein eigenes Fenster neu, und die Infobox der Karte liest ihre Quellen
    // aus zwei Fenster-Globals, die AUSSCHLIESSLICH beim Laden der Kartennutzlast geschrieben werden.
    // Eine gerade hinzugefuegte Quelle war damit bis zum naechsten F5 unsichtbar (Owner 28.08.2026).
    // Der Helfer dafuer gab es laengst -- mit genau einem Aufrufer, dem Meldungs-Weg fuer Siedlungen.
    //
    // 🔴 An DIESER Stelle, nicht an den Klick-Handlern: haengte er dort, waere er beim naechsten
    // Knopf vergessen. Dieselbe Begruendung wie beim Trichter renderLoreDetail (AGENTS.md §11).
    //
    // ⚠️ NICHT im Anlege-Modus: der Puffer vergibt negative Platzhalter-Ids fuer ein Objekt, das es
    // serverseitig noch gar nicht gibt -- die im Kartenspeicher zeigten auf nichts.
    if (!pendingStore) {
      syncFeatureSourcesToClientCache(entityType, publicId, data.sources);
      // Das offene Infopanel neu zeichnen -- dasselbe, was Kartensammlung, Literatur und Kraftlinien
      // nach einer Aenderung tun. ⚠️ Nur nach einem SCHREIBvorgang: beim blossen Auflisten hat sich
      // nichts geaendert, und ein Neuzeichnen waere Arbeit ohne Aussage.
      const werkzeugFenster = featureSourceKartenfenster();
      if (action !== "list" && werkzeugFenster && typeof werkzeugFenster.avesmapsRefreshInfopanel === "function") {
        werkzeugFenster.avesmapsRefreshInfopanel();
      }
    }
    // Return the server payload so a caller can react to it (e.g. the "Ort bearbeiten" dialog
    // reads data.revision to refresh its optimistic-locking token after the list's takeover).
    return data;
  }

  function readAddRowValues() {
    const urlInput = containerEl.querySelector(".fs-add-url");
    const labelInput = containerEl.querySelector(".fs-add-label");
    const typeSelect = containerEl.querySelector(".fs-add-type");
    const kindSelect = containerEl.querySelector(".fs-add-kind");
    const officialInput = containerEl.querySelector(".fs-add-official");
    const pagesInput = containerEl.querySelector(".fs-add-pages");
    const licenseSelect = containerEl.querySelector(".fs-add-license");
    const attributionInput = containerEl.querySelector(".fs-add-attribution");
    return {
      url: String((urlInput && urlInput.value) || "").trim(),
      label: String((labelInput && labelInput.value) || "").trim(),
      source_type: String((typeSelect && typeSelect.value) || "sonstiges"),
      reference_kind: String((kindSelect && kindSelect.value) || ""),
      is_official: Boolean(officialInput && officialInput.checked),
      pages: String((pagesInput && pagesInput.value) || "").trim(),
      // ⚠️ Lizenz und Namensnennung beschreiben die QUELLE, nicht diese Verknuepfung -- anders
      // als `pages` und `reference_kind` daneben. Deshalb reisen sie beim Anlegen mit und beim
      // Verknuepfen einer bestehenden Quelle NICHT: die traegt ihre eigene schon.
      license: String((licenseSelect && licenseSelect.value) || ""),
      attribution: String((attributionInput && attributionInput.value) || "").trim(),
    };
  }

  containerEl.addEventListener("click", async (event) => {
    const removeTarget = event.target.closest("[data-remove-source-id]");
    if (removeTarget) {
      const sourceId = Number(removeTarget.getAttribute("data-remove-source-id"));
      await renderFromServer("remove", { source_id: sourceId });
      return;
    }
    if (event.target.closest("[data-fs-unpick]")) {
      clearPick();
      return;
    }
    const addTarget = event.target.closest("[data-fs-add-submit]");
    if (addTarget) {
      const values = readAddRowValues();
      // A picked catalog row is linked BY ID (instruction 5a, "direkte Zuweisung"): it is already
      // the right source, and a wiki publication may have no URL to re-upsert by at all. Pages and
      // coverage still travel -- those describe this link, not the work.
      if (pickedSourceId > 0) {
        // The buffer has no catalog to look the row up in, so in create mode the display fields
        // travel too. Over the wire the payload stays byte-identical to before -- the server
        // resolves the row by id and never saw these keys.
        await renderFromServer("add_existing", Object.assign(
          {
            source_id: pickedSourceId,
            pages: values.pages,
            reference_kind: values.reference_kind,
          },
          pendingStore
            ? { url: values.url, label: values.label, source_type: values.source_type, is_official: values.is_official }
            : {}
        ));
        return;
      }
      // Die URL bleibt Pflicht -- der Katalog erkennt Dubletten über den URL-Hash, ohne Link
      // entstünde dasselbe Werk beliebig oft neu. Aber die Absage wird jetzt ausgesprochen statt
      // verschluckt, und sie zeigt den Ausweg: ein Treffer aus der Vorschlagsliste wird über seine
      // Katalog-ID verknüpft und braucht selbst gar keine URL.
      if (!values.url) {
        showAddRowNote(
          values.label
            ? tr("sources.add.needUrlPicked", "Für „{label}“ fehlt der Link. Trag ihn ein — oder wähle den Titel aus der Vorschlagsliste, dann wird die bestehende Quelle verknüpft.").replace("{label}", values.label)
            : tr("sources.add.needUrl", "Ohne Link geht es nicht: trag die URL ein, oder wähle den Titel aus der Vorschlagsliste.")
        );
        const urlInput = containerEl.querySelector(".fs-add-url");
        if (urlInput) {
          urlInput.focus();
        }
        return;
      }
      await renderFromServer("add", values);
    }
  });

  return renderFromServer("list");
}

// Multi-source #3 change-report gap fix: a change report's proposed source(s) are only linked
// server-side on save (linkCommunityReportSource below) -- until then they live in
// activeReviewReportSourceSuggestions and were never shown anywhere, so the reviewer had no way to
// see what a report proposed before saving. This renders them as a distinct "Vorschlag" group inside
// the mounted Quellen editor (appended after the server-rendered list resolves, since mounting
// already overwrites containerEl.innerHTML) so the reviewer sees the diff at a glance, same as the
// red-outlined name/type/wiki-url fields (js/review/review-report-flow.js markChangeReportFields).
function renderProposedFeatureSourceRow(source, escape, tr) {
  const officialMark = source.is_official ? " *" : "";
  const pages = source.pages ? '<span class="fs-row__pages">S. ' + escape(source.pages) + "</span>" : "";
  return (
    '<div class="fs-row fs-row--proposed">' +
    '<a class="fs-row__link" href="' + escape(source.url) + '" target="_blank" rel="noopener">' +
    escape(source.label || source.url) + " ↗</a>" +
    '<span class="fs-row__badge fs-row__badge--proposed">' +
    escape(tr("sources.proposed", "Vorschlag (Meldung)")) + officialMark + "</span>" +
    pages +
    "</div>"
  );
}

function renderProposedFeatureSourceGroup(suggestions, escape, tr) {
  if (!suggestions.length) {
    return "";
  }
  const heading = '<div class="fs-group-heading fs-group-heading--proposed">' +
    escape(tr("sources.proposedHeading", "Aus der Meldung (wird beim Speichern übernommen)")) + "</div>";
  const rows = suggestions.map((source) => renderProposedFeatureSourceRow(source, escape, tr)).join("");
  return '<div class="fs-group fs-group--proposed" data-fs-group="proposed">' + heading + rows + "</div>";
}

// Appends the proposed group right after the hint line so it reads before the entity's existing
// sources. No-op when there is nothing proposed (the common case -- a normal, non-report edit).
function appendProposedFeatureSources(containerEl, suggestions, opts) {
  if (!containerEl || !Array.isArray(suggestions) || !suggestions.length) {
    return;
  }
  const options = opts || {};
  const escape = options.escape || featureSourceDefaultEscape;
  const tr = options.tr || featureSourceDefaultTr;
  const markup = renderProposedFeatureSourceGroup(suggestions, escape, tr);
  if (!markup) {
    return;
  }
  const editorEl = containerEl.querySelector(".fs-editor") || containerEl;
  const hintEl = editorEl.querySelector(".fs-hint");
  if (hintEl) {
    hintEl.insertAdjacentHTML("afterend", markup);
  } else {
    editorEl.insertAdjacentHTML("afterbegin", markup);
  }
}

// Multi-source #3: link a community-reported source to a freshly created feature as a catalog source
// -- the SAME server add path (POST feature-sources.php `add`) the editor's "Hinzufügen" button uses,
// so an accepted community report's source shows up in the QUELLEN section exactly like a manual one.
// Best-effort: no publicId/url -> no-op; transport/non-ok failures are swallowed so a create is never
// broken by this. Returns true only on a confirmed add.
async function linkCommunityReportSource(entityPublicId, suggestion) {
  if (!entityPublicId || !suggestion) {
    return false;
  }
  // Instruction 5a: a reporter who PICKED an existing catalog row sent its id along. Link that row
  // directly -- it is already the right source, and it may legitimately have no URL at all (a wiki
  // publication is identified by its wiki key, not by a link). Without this branch such a source is
  // dropped by the url guard below, which is precisely how a hand-typed "Blutmond I" ends up as its
  // own catalog row instead of the adventure it names.
  const pickedSourceId = Number(suggestion.source_id) || 0;
  if (!pickedSourceId && !suggestion.url) {
    return false;
  }
  const data = await featureSourceFetch(
    pickedSourceId > 0
      ? {
          action: "add_existing",
          entity_type: "settlement",
          entity_public_id: entityPublicId,
          source_id: pickedSourceId,
          reference_kind: String(suggestion.reference_kind || ""),
          pages: String(suggestion.pages || ""),
        }
      : {
          action: "add",
          entity_type: "settlement",
          entity_public_id: entityPublicId,
          url: String(suggestion.url || ""),
          label: String(suggestion.label || ""),
          source_type: String(suggestion.source_type || "sonstiges"),
          reference_kind: String(suggestion.reference_kind || ""),
          is_official: Boolean(suggestion.is_official),
          pages: String(suggestion.pages || ""),
        }
  );
  if (!(data && data.ok === true)) {
    return false;
  }
  // Keep the popup's synchronous source globals in sync so the JUST-created place shows its new sources
  // immediately, WITHOUT a full map-features reload. resolveFeatureSourceList (js/ui/popups.js) reads
  // window.__sourceCatalog / __featureSourceRefs, which are set only at map-features load -- the new
  // place was not in that payload, so without this its popup would show just the Wiki line until reload.
  syncFeatureSourcesToClientCache("settlement", entityPublicId, data.sources);
  return true;
}

// Das Fenster, in dem die KARTE liegt -- und damit ihre beiden Quellen-Globals.
//
// 💣 Die Editorseiten (html/citymap-editor.html, html/landschaften-editor.html, …) sind
// eigenstaendige iframe-Dokumente IM Kartenfenster. Ihr eigenes `window` traegt `__sourceCatalog`
// und `__featureSourceRefs` NICHT -- ein Abgleich dorthin waere eine stille Nulloperation, und die
// Infobox der Karte bliebe genauso alt wie vorher. Erkannt wird das Kartenfenster daran, dass es
// die Globals wirklich FUEHRT, nicht daran, dass es ein Elternfenster ist.
//
// ⚠️ Der Zugriff auf `window.parent` kann bei fremder Herkunft werfen -- dann gilt das eigene
// Fenster. Und liegt die Kartennutzlast noch gar nicht (Globals fehlen ueberall), faellt es
// ebenfalls auf das eigene zurueck: der laufende Ladevorgang bringt den frischen Stand ohnehin mit.
function featureSourceKartenfenster() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    if (window.parent && window.parent !== window && window.parent.__featureSourceRefs) {
      return window.parent;
    }
  } catch (error) {
    // fremde Herkunft -> das eigene Fenster
  }
  return window;
}

// Fold an editor feature-source list (each {source_id,url,label,type,official,pages}) into the popup's
// synchronous source globals so a freshly created/edited feature renders its sources on the next popup
// open with no map-features reload. Overwrites the entity's ref list with the full server list (the add
// endpoint returns ALL of the feature's sources), and upserts each into the shared catalog by source_id.
function syncFeatureSourcesToClientCache(entityType, entityPublicId, editorSources) {
  const ziel = featureSourceKartenfenster();
  if (!ziel || !Array.isArray(editorSources) || !entityPublicId) {
    return;
  }
  ziel.__sourceCatalog = ziel.__sourceCatalog || {};
  ziel.__featureSourceRefs = ziel.__featureSourceRefs || {};
  const refs = [];
  for (const source of editorSources) {
    if (!source || source.source_id === undefined || source.source_id === null) {
      continue;
    }
    ziel.__sourceCatalog[source.source_id] = {
      url: source.url || "",
      label: source.label || "",
      official: Boolean(source.official),
      type: source.type || "",
    };
    refs.push({ source_id: source.source_id, pages: source.pages || "", reference_kind: source.reference_kind || "" });
  }
  ziel.__featureSourceRefs[`${entityType}:${entityPublicId}`] = refs;
}

if (typeof window !== "undefined") {
  window.renderFeatureSourceEditorHtml = renderFeatureSourceEditorHtml;
  window.mountFeatureSourceEditor = mountFeatureSourceEditor;
  window.linkCommunityReportSource = linkCommunityReportSource;
  window.appendProposedFeatureSources = appendProposedFeatureSources;
  window.createPendingFeatureSourceStore = createPendingFeatureSourceStore;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { renderFeatureSourceEditorHtml, createPendingFeatureSourceStore };
}
