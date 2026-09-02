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

// Ab wie vielen zitierenden Objekten eine Katalogaenderung nachgefragt wird.
// 💣 SPIEGEL von AVESMAPS_FEATURE_SOURCE_CONFIRM_THRESHOLD (api/_internal/app/feature-sources.php).
// Zwei Zahlen fuer eine Regel -- der Server ist der Riegel, dieser hier ist die Frage davor. Laufen
// sie auseinander, fragt der Client entweder umsonst oder der Server lehnt eine Aenderung ab, die
// der Editor fuer bestaetigt haelt. Zusammengehalten von quellen-bearbeiten-form.test.js.
const FEATURE_SOURCE_CONFIRM_THRESHOLD = 10;

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

// 🔴 Die Zeile traegt seit dem 01.09.2026 ZWEI Knoepfe: `✎` bearbeiten, `✕` entfernen.
// `bearbeitbar` ist false fuer die noch nicht gespeicherten Zeilen des Anlege-Puffers -- die haengen
// an keiner Katalogzeile, haben also weder eine Reichweite noch etwas, das ein Server aendern
// koennte; dort bleibt „entfernen und neu eintragen" der Weg.
function renderFeatureSourceRow(source, escape, tr, bearbeitbar) {
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
  // 💣 Eine LEERE Zelle, wenn nicht bearbeitet werden darf -- nicht gar keine. Das Raster gibt
  // jeder Zeile dieselbe siebenspaltige Vorlage; faellt eine Zelle weg, rutscht das `✕` unter die
  // Lizenzspalte. Dieselbe Begruendung wie bei Seiten, Art und Lizenz darueber.
  const edit = bearbeitbar === false
    ? '<span class="fs-row__edit-cell"></span>'
    : '<button type="button" class="fs-row__edit" data-fs-edit-id="' + escape(source.source_id) + '"'
      + ' title="' + escape(tr("sources.edit", "Bearbeiten")) + '"'
      + ' aria-label="' + escape(tr("sources.edit", "Bearbeiten")) + '">✎</button>';
  return (
    '<div class="fs-row" data-source-id="' + escape(source.source_id) + '">' +
    '<a class="fs-row__link" href="' + escape(source.url) + '" target="_blank" rel="noopener">' +
    escape(source.label || source.url) + " ↗</a>" +
    '<span class="fs-row__badge">' + escape(featureSourceTypeLabel(source.type)) + officialMark + "</span>" +
    kind +
    pages +
    license +
    edit +
    '<button type="button" class="fs-row__remove" data-remove-source-id="' + escape(source.source_id) + '">✕</button>' +
    "</div>"
  );
}

// ══ DER BEARBEITEN-KASTEN ═══════════════════════════════════════════════════════════════════════
// Entwurf: docs/quellen-bearbeiten-mockup.html (Owner-GO 01.09.2026)
//
// 🔴 ZWEI BEREICHE, durch Linie und Ueberschrift getrennt -- nicht durch gerahmte Kaesten (§12).
// Oben, was nur an diesem Objekt gilt (Seiten, Abdeckung); unten, was an ALLEN Objekten gilt, die
// diese Quelle zitieren. Die zweite Ueberschrift traegt die ZAHL: ohne sie ist „gilt ueberall" ein
// Wort ohne Groesse, und live gemessen steht dahinter ein Median von 6 und ein Maximum von 1.549.
//
// 💣 Jedes Eingabefeld traegt seinen Ausgangswert in `data-fs-orig`. Daraus liest der Speichern-
// Knopf, was sich WIRKLICH geaendert hat, und schickt nur das -- die Regel, an der
// `avesmapsUpsertGameLiterature` schon einmal gescheitert ist (dort stempelte jedes mitgeschickte
// Feld, und das Formular schickt alle mit). Am Wert haengt sie, nicht an einem Modulzustand
// daneben, der beim naechsten Neuzeichnen auseinanderlaufen koennte.
function renderFeatureSourceEditPanel(source, escape, tr) {
  const usage = Number(source.usage_count) || 1;
  const wikiOwned = source.wiki_owned === true;
  const feld = (name, wert, markup) =>
    '<label class="fs-field' + (name === "url" ? " fs-field--full" : (name === "label" || name === "attribution" ? " fs-field--grow" : "")) + '">'
    + "<span>" + escape(wert) + "</span>" + markup + "</label>";
  const text = (name, wert, platzhalter, gesperrt) =>
    '<input type="text" data-fs-field="' + name + '" data-fs-orig="' + escape(wert) + '"'
    + ' value="' + escape(wert) + '"'
    + (platzhalter ? ' placeholder="' + escape(platzhalter) + '"' : "")
    + (gesperrt ? " disabled" : "") + ">";
  const auswahl = (name, wert, eintraege, gesperrt) =>
    '<select data-fs-field="' + name + '" data-fs-orig="' + escape(wert) + '"' + (gesperrt ? " disabled" : "") + ">"
    + eintraege.map((e) =>
      '<option value="' + escape(e.wert) + '"' + (e.wert === wert ? " selected" : "") + ">"
      + escape(e.text) + "</option>").join("")
    + "</select>";

  const kindEintraege = FEATURE_SOURCE_REFERENCE_KINDS.map(
    (k) => ({ wert: k, text: featureSourceReferenceKindLabel(k) })
  );
  // 🔴 KEIN leerer Eintrag bei der Art -- anders als in der Eingabezeile. Eine Katalogzeile TRAEGT
  // immer eine Art; „keine Aussage" hiesse hier, eine vorhandene Angabe zu loeschen, und das ist
  // keine Korrektur. Der Server lehnt '' an dieser Stelle ebenfalls ab.
  const typEintraege = FEATURE_SOURCE_TYPES.map((t) => ({ wert: t, text: featureSourceTypeLabel(t) }));
  const lizenzTafel = featureSourceLicenseTable();
  const lizenzEintraege = [{ wert: "", text: tr("sources.add.licenseNone", "Lizenz …") }].concat(
    Object.keys(lizenzTafel).map((k) => ({ wert: k, text: lizenzTafel[k].label }))
  );

  const kopf = (titel, reichweite) =>
    '<div class="fs-edit__head"><span class="fs-edit__title">' + escape(titel) + "</span>"
    + (reichweite ? '<span class="fs-edit__scope">' + reichweite + "</span>" : "") + "</div>";

  const objekte = usage === 1
    ? escape(tr("sources.edit.scopeOne", "zurzeit nur dieses Objekt"))
    : escape(tr("sources.edit.scopeMany", "zurzeit ")) + "<b>"
      + escape(String(usage) + " " + tr("sources.edit.objects", "Objekte")) + "</b>";

  const hinweis = wikiOwned
    ? '<div class="fs-edit__note fs-edit__note--locked">'
      + escape(tr("sources.edit.wikiOwned",
        "Adresse, Titel und „offiziell“ gehören bei einer Wiki-Publikation dem Abgleich — von Hand geändert stünde beim nächsten Lauf wieder sein Wert da, und eine geänderte Adresse ergäbe sogar eine zweite Katalogzeile für dasselbe Werk."))
      + "</div>"
    : (usage > FEATURE_SOURCE_CONFIRM_THRESHOLD
      ? '<div class="fs-edit__note">'
        + escape(tr("sources.edit.catalogWarn", "Diese Felder ändern die Quelle im ganzen Katalog — „Speichern“ fragt vorher nach."))
        + "</div>"
      : "");

  // 🔴 DIE ADRESSE IST SEIT DEM 01.09.2026 EIN EINGABEFELD (Owner: „mach auch, dass die URL
  // korrigiert werden kann"). Sie steht in der KATALOG-Haelfte, denn sie gilt ueberall -- und bei
  // einer Wiki-Publikation ist sie fest, weil dort der Abgleich die Identitaet besitzt.
  // ⚠️ Sie steht als erstes Feld dieser Haelfte und ueber die volle Breite: eine Adresse ist der
  // laengste Wert der Zeile (live gemessen bis 120 Zeichen), und in einer halben Spalte sieht man
  // beim Korrigieren nicht, was man korrigiert.
  const adresse = wikiOwned
    ? '<p class="fs-edit__url"><b>' + escape(tr("sources.edit.url", "Adresse:")) + "</b> "
      + escape(source.url || tr("sources.edit.noUrl", "(ohne Adresse — Wiki-Publikation)"))
      + "</p>"
    : "";
  return (
    '<div class="fs-edit" data-fs-edit-panel="' + escape(source.source_id) + '">'
    + '<div class="fs-edit__group">'
    + kopf(tr("sources.edit.linkScope", "Nur an diesem Objekt"), "")
    + '<div class="fs-edit__fields">'
    + feld("pages", tr("sources.colPages", "Seite(n)"), text("pages", String(source.pages || ""), "", false))
    + feld("reference_kind", tr("sources.colKind", "Abdeckung"), auswahl("reference_kind", String(source.reference_kind || ""), kindEintraege, false))
    + "</div></div>"
    + '<div class="fs-edit__group">'
    + kopf(tr("sources.edit.catalogScope", "Gilt für alle Objekte, die diese Quelle zitieren"), objekte)
    + adresse
    + '<div class="fs-edit__fields">'
    + (wikiOwned ? "" : feld("url", tr("sources.edit.url", "Adresse"), text("url", String(source.url || ""), "https://…", false)))
    + feld("label", tr("sources.colTitle", "Titel"), text("label", String(source.label || ""), "", wikiOwned))
    + feld("source_type", tr("sources.colType", "Quellenart"), auswahl("source_type", String(source.type || "sonstiges"), typEintraege, false))
    + feld("license", tr("sources.colLicense", "Lizenz"), auswahl("license", String(source.license || ""), lizenzEintraege, false))
    + feld("attribution", tr("sources.add.attribution", "Namensnennung"), text("attribution", String(source.attribution || ""), tr("sources.edit.attributionHint", "z. B. VolkoV / garetien.de"), false))
    + '<label class="fs-check"><input type="checkbox" data-fs-field="is_official" data-fs-orig="'
    + (source.official ? "1" : "0") + '"' + (source.official ? " checked" : "") + (wikiOwned ? " disabled" : "")
    + "> " + escape(tr("sources.add.official", "offiziell")) + "</label>"
    + "</div>" + hinweis + "</div>"
    + '<div class="fs-edit__foot">'
    + '<button type="button" class="fs-edit__save" data-fs-edit-save="' + escape(source.source_id) + '">'
    + escape(tr("sources.edit.save", "Speichern")) + "</button>"
    + '<button type="button" class="fs-edit__cancel" data-fs-edit-cancel>'
    + escape(tr("sources.edit.cancel", "Abbrechen")) + "</button>"
    + '<span class="fs-edit__msg" data-fs-edit-msg></span>'
    + "</div></div>"
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
    // 💣 ZWEI leere Zellen -- eine je Knopf (`✎` und `✕`). Die Ueberschrift traegt dieselbe
    // Rastervorlage wie ihre Zeilen; fehlt eine, stehen ab hier alle Ueberschriften neben ihren
    // Spalten. Das ist die Falle, an der die Spaltenliste am 24.08.2026 schon einmal haengen blieb.
    + "<span></span><span></span>"
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
  // ⚠️ KEIN `✎`: diese Zeilen liegen nur im Puffer und haengen an keiner Katalogzeile -- es gibt
  // weder eine Reichweite zu nennen noch etwas, das ein Server aendern koennte.
  const rows = pendingSources.map((source) => renderFeatureSourceRow(source, escape, tr, false)).join("");
  return '<div class="fs-group fs-group--pending" data-fs-group="pending">' + heading + rows + "</div>";
}

function renderFeatureSourceAddRow(escape, tr) {
  // 🔴 Der erste Eintrag ist LEER und damit vorausgewaehlt: „Art …" heisst „keine Aussage".
  // 💣 Ohne ihn stand 'regionalspielhilfe' vorausgewaehlt da -- die erste Art der Liste --, und
  // wer die Auswahl nie anfasste, legte eine Behauptung an, die er nie getroffen hat. Genau so kam
  // „Briefspiel Rommilyser Mark" als Regionalspielhilfe in den Katalog (Meldung #105, Nottel,
  // 29.08.2026). Dieselbe Form wie bei der Lizenz daneben; der Server macht daraus beim ANLEGEN
  // 'sonstiges' und laesst eine bereits bekannte Quelle unberuehrt.
  const options = '<option value="">' + escape(tr("sources.add.typeNone", "Art …")) + "</option>" +
    FEATURE_SOURCE_TYPES.map(
      (type) => '<option value="' + escape(type) + '">' + escape(featureSourceTypeLabel(type)) + "</option>"
    ).join("");
  // Coverage classification -> which publication tab the source lands in (empty = flat line).
  const kindOptions = FEATURE_SOURCE_REFERENCE_KINDS.map(
    (kind) => '<option value="' + escape(kind) + '">' + escape(featureSourceReferenceKindLabel(kind)) + "</option>"
  ).join("");
  // 🔴 Die Lizenz der QUELLE (Owner 27.08.2026: „quellen fehlt das lizenz-feld").
  // ⚠️ Die leere Auswahl heisst „nicht erfasst" und ist die Vorgabe -- NICHT „keine Lizenz".
  // Wer das sagen will, waehlt „Keine freie Lizenz". Die beiden gleichzusetzen waere eine
  // Rechtsaussage, die niemand getroffen hat, und sie stuende an 1374 Quellen.
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
    // Der Prüfknopf (Owner 02.09.2026). 🔴 Er ist der Grund, warum das Formular NIE auf einen
    // fremden Server wartet: der Abruf ist ein Handgriff, kein Nebeneffekt des Tippens. Einfügen
    // und Enter lösen ihn ebenfalls aus -- das Feld steht in keinem <form>, Enter war bis hierher
    // wirkungslos, es wird also keine Gewohnheit gebrochen.
    // 💣 DREI Zustände, nicht zwei: „erreichbar, aber nichts zu lesen" ist weder Erfolg noch
    // Fehlschlag. Wäre es rot, suchte der Editor einen Fehler am Link, den es nicht gibt.
    '<button type="button" class="fs-add-check" data-fs-check title="' +
    escape(tr("sources.add.checkHint", "Adresse prüfen und Titel übernehmen")) + '" aria-label="' +
    escape(tr("sources.add.checkHint", "Adresse prüfen und Titel übernehmen")) + '">⟳</button>' +
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

/**
 * Der Satz, der sagt: diese ADRESSE gab es schon, es wurde VERKNUEPFT statt angelegt.
 *
 * 🔴 Der Katalog dedupliziert ueber `url_hash` (UNIQUE) -- gewollt und richtig, aber bis zum
 * 01.09.2026 stumm. Die Kachel „bestehende Quelle" daneben haengt an der NAMENS-Vorschlagsliste;
 * wer eine Adresse einfuegte, sah nicht, welcher der beiden Faelle eintrat.
 * ⚠️ `""` (nichts sagen) heisst „neu angelegt" -- die frische Zeile zeigt genau das Eingetippte,
 * eine Meldung dafuer waere Laerm auf dem haeufigen Weg. Dieselbe Regel wie bei `retyped`.
 * 🪤 Und NICHT beim Treffer aus der Vorschlagsliste: der laeuft ueber `add_existing`, wo der Editor
 * die bestehende Quelle ausdruecklich gewaehlt hat -- die Kachel sagt es dort bereits.
 *
 * Rein und DOM-frei, damit ein Test ihn wirklich ausfuehrt statt seinen Quelltext zu lesen.
 */
function featureSourceLinkedMessage(linked, tr) {
  const uebersetze = typeof tr === "function" ? tr : featureSourceDefaultTr;
  if (!linked) {
    return "";
  }
  let text = linked.typed_label
    // Der eingetippte Titel wurde verworfen -- der Fall, der ohne Erklaerung wie ein Fehler
    // aussieht: man tippt „X" und in der Liste steht „Y".
    ? uebersetze("sources.add.linkedRenamed",
      "Diese Adresse gibt es schon — verknüpft mit „{label}“. Dein Titel „{typed}“ wurde nicht übernommen, denn der Katalog führt sie unter ihrem gespeicherten Namen.")
      .replace("{label}", String(linked.label || "")).replace("{typed}", String(linked.typed_label))
    : uebersetze("sources.add.linked",
      "Diese Adresse gibt es schon — verknüpft mit „{label}“ statt eine neue Quelle anzulegen.")
      .replace("{label}", String(linked.label || ""));
  if (linked.official_changed) {
    // 💣 Der Haken hat den Katalogwert umgelegt, und das gilt ueberall, wo die Quelle steht.
    text += " " + uebersetze("sources.add.linkedOfficial",
      "Achtung: „offiziell“ steht jetzt auf {wert} — das gilt überall, wo diese Quelle steht.")
      .replace("{wert}", linked.official_now
        ? uebersetze("sources.add.officialYes", "ja")
        : uebersetze("sources.add.officialNo", "nein"));
  }
  return text;
}

/**
 * Was die Adressauskunft für die Eingabezeile bedeutet: Farbe, Meldung, Titel, Sperre.
 *
 * 🔴 REIN -- kein DOM, kein fetch, kein Modulzustand. Genau darum steht sie hier auf Modulebene
 * und nicht in der Closure von `mountFeatureSourceEditor`: die Zuordnung „Zustand → was der
 * Editor sieht" ist die eigentliche Regel dieses Umbaus, und eine Regel, die nur im Browser
 * läuft, ist nicht prüfbar.
 *
 * 💣 VIER Zustände hinein, DREI Farben heraus: `bekannt` und `gelesen` tragen dasselbe Grün, weil
 * für den Editor beides denselben Befund bedeutet -- die Zeile ist fertig. Der Unterschied steht
 * in der MELDUNG, nicht in der Farbe.
 *
 * @returns {{zustand:string, meldung:string, titel:string, titelGewinnt:boolean, sperren:boolean}}
 */
function featureSourceInspectView(auskunft, tr) {
  const uebersetze = typeof tr === "function" ? tr : featureSourceDefaultTr;
  const daten = auskunft || {};
  const zustand = String(daten.state || "");

  if (zustand === "bekannt") {
    const vorhanden = daten.existing || {};
    const anzahl = Number(vorhanden.usage_count) || 0;
    // 🔴 Die bestehende Zeile wird VERKNÜPFT, nicht neu angelegt -- das tut der Katalog ohnehin
    // (`url_hash` ist UNIQUE), es wurde bis zum 01.09.2026 nur nicht gesagt. Jetzt steht es da,
    // BEVOR jemand Felder ausfüllt, deren Inhalt anschließend verworfen würde.
    return {
      zustand: "bekannt",
      titel: String(vorhanden.label || ""),
      titelGewinnt: true,
      sperren: true,
      // 💣 DIE GESPERRTEN FELDER MÜSSEN ZEIGEN, WAS GILT. Owner-Meldung 02.09.2026 („der rest
      // fehlt irgendwie"): die Zeile sperrte Art, Lizenz und Namensnennung und liess sie dabei
      // LEER stehen -- ein gesperrtes leeres Feld behauptet „da steht nichts", wo in Wahrheit
      // etwas steht. Gesperrt UND gefüllt ist eine Auskunft; gesperrt und leer ist ein Fehler.
      felder: {
        label: String(vorhanden.label || ""),
        source_type: String(vorhanden.source_type || ""),
        license: String(vorhanden.license || ""),
        attribution: String(vorhanden.attribution || ""),
        is_official: Boolean(vorhanden.is_official),
      },
      meldung: uebersetze("sources.add.checkKnown",
        "Diese Seite steht schon im Katalog als „{label}“ — sie wird verknüpft. Du füllst nur noch Seite(n) und Abdeckung.")
        .replace("{label}", String(vorhanden.label || ""))
        // ⚠️ Einzahl und Mehrzahl getrennt: „Zitiert an 1 Objekten" stand live da und liest sich
        // wie ein Programmierfehler -- weil es einer ist.
        + (anzahl === 1
          ? " " + uebersetze("sources.add.checkKnownUsageOne",
            "Zitiert an 1 Objekt — Änderungen am Eintrag gehen über das ✎.")
          : "")
        + (anzahl > 1
          ? " " + uebersetze("sources.add.checkKnownUsage",
            "Zitiert an {n} Objekten — Änderungen am Eintrag gehen über das ✎.").replace("{n}", String(anzahl))
          : ""),
    };
  }

  if (zustand === "gelesen") {
    const korpus = daten.corpus || {};
    const vorschlag = String(korpus.label_suggestion || "");
    return {
      zustand: "gelesen",
      titel: String(daten.title || ""),
      titelGewinnt: false,
      sperren: false,
      meldung: uebersetze("sources.add.checkRead", "Erreichbar — Titel „{title}“ aus der Seite gelesen.")
        .replace("{title}", String(daten.title || ""))
        // ⭐ Der `<title>`-Zusatz nennt den Korpus. Er wird VORGESCHLAGEN, nie gesetzt: der Server
        // liefert ihn nur, wo der Korpus noch unbekannt ist.
        + (vorschlag !== ""
          ? " " + uebersetze("sources.add.checkSite", "Die Seite nennt sich „{site}“ — das wäre der Name des Korpus.")
            .replace("{site}", vorschlag)
          : ""),
    };
  }

  if (zustand === "erreichbar") {
    // 💣 NICHT rot. Der Link ist in Ordnung; nur der Titel muss von Hand kommen. Wäre das rot,
    // suchte der Editor einen Fehler am Link, den es nicht gibt.
    return {
      zustand: "erreichbar",
      titel: "",
      titelGewinnt: false,
      sperren: false,
      meldung: uebersetze("sources.add.checkReachable",
        "Erreichbar, aber auf der Seite war kein Titel zu finden — trag ihn selbst ein."),
    };
  }

  const status = Number(daten.http_status) || 0;
  return {
    zustand: "unerreichbar",
    titel: "",
    titelGewinnt: false,
    sperren: false,
    meldung: status > 0
      ? uebersetze("sources.add.checkDeadStatus", "Die Adresse antwortet mit {status} — stimmt der Link?")
        .replace("{status}", String(status))
      : uebersetze("sources.add.checkDead", "Die Adresse war nicht erreichbar — stimmt der Link?"),
  };
}

/**
 * Nur die Felder, deren Wert sich vom Ausgangswert (`data-fs-orig`) unterscheidet.
 *
 * 💣 DAS IST DIE TRAGENDE REGEL DES BEARBEITEN-KASTENS. Ein vollstaendig mitgeschicktes Formular
 * schriebe jedes Feld -- und weil fuenf davon der KATALOGZEILE gehoeren, machte ein einziges
 * versehentlich geleertes Feld eine gepflegte Angabe an bis zu 1.549 Objekten platt. Genau in
 * diese Falle ist `avesmapsUpsertGameLiterature` am 17.08.2026 gelaufen (es stempelte jedes
 * MITGESCHICKTE Feld, und das Formular schickt alle mit); hier waere der Schaden groesser.
 *
 * ⚠️ Gesperrte Felder (`disabled`) reisen NIE mit: ihr Wert ist der Bestand, und der Server lehnt
 * sie ohnehin ab (`wiki_owned_field`).
 *
 * 🔴 Ausserhalb von `mountFeatureSourceEditor`, damit sie ohne DOM und ohne Netz gefahren werden
 * kann -- sie braucht vom Panel nur `querySelectorAll`. Eine Regel dieses Gewichts darf nicht in
 * einer Closure liegen, in der sie kein Test je ausfuehrt.
 */
function featureSourceChangedFields(panel) {
  const felder = {};
  if (!panel || typeof panel.querySelectorAll !== "function") {
    return felder;
  }
  Array.prototype.forEach.call(panel.querySelectorAll("[data-fs-field]"), (el) => {
    if (el.disabled) {
      return;
    }
    const name = el.getAttribute("data-fs-field");
    const orig = el.getAttribute("data-fs-orig") || "";
    const wert = el.type === "checkbox" ? (el.checked ? "1" : "0") : String(el.value || "");
    if (wert !== orig) {
      felder[name] = name === "is_official" ? wert === "1" : wert;
    }
  });
  return felder;
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
    // ⚠️ Auch der FEHLSCHLAG wird festgehalten -- der Bearbeiten-Kasten braucht den Grund
    // („diese Änderung gilt für 1.042 Objekte", „das pflegt der Wiki-Abgleich"), und der steht nur
    // hier. 🔴 Der Rueckgabewert bleibt trotzdem `undefined`: mehrere Aufrufer lesen `data.revision`
    // und wuerden bei einem durchgereichten Fehlerumschlag stillschweigend etwas anderes lesen.
    letzteAntwort = data || null;
    if (!data || data.ok !== true) {
      return; // keep the prior render on any failure -- never blank the widget
    }
    letzteQuellen = Array.isArray(data.sources) ? data.sources : [];
    containerEl.innerHTML = renderFeatureSourceEditorHtml(data, opts);
    wireAutocomplete();
    wireAdressPruefung();
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

  // Sagt, was der Klick am GETEILTEN Katalog geaendert hat. Eine richtiggestellte Art gilt
  // ueberall, wo die Quelle zitiert wird; das gehoert gesagt, nicht bemerkt -- und es ist die
  // Gegenprobe zur stillen Nicht-Aenderung, aus der #105 entstand.
  function zeigeUmtypung(daten) {
    const umtyp = daten && daten.retyped;
    if (!umtyp) {
      return;
    }
    showAddRowNote(
      tr("sources.add.retyped", "Art von „{label}“ auf „{to}“ geändert (war „{from}“) — das gilt überall, wo diese Quelle steht.")
        .replace("{label}", String(umtyp.label || ""))
        .replace("{to}", featureSourceTypeLabel(umtyp.to))
        .replace("{from}", featureSourceTypeLabel(umtyp.from))
    );
  }

  /**
   * Sagt, dass eine EINGEFUEGTE ADRESSE mit einer bestehenden Katalogzeile verknuepft wurde,
   * statt eine neue anzulegen.
   *
   * 🔴 Der Katalog dedupliziert ueber `url_hash` (UNIQUE) -- das ist gewollt und richtig, es war
   * nur stumm. Die Kachel „bestehende Quelle" daneben haengt an der NAMENS-Vorschlagsliste; wer
   * eine Adresse einfuegt, sah bis zum 01.09.2026 nicht, welcher der beiden Faelle eintrat.
   * ⚠️ Gemeldet wird NUR das Verknuepfen. Beim Anlegen zeigt die neue Zeile genau das Eingetippte
   * -- eine Meldung dafuer waere Laerm auf dem haeufigen Weg. Dieselbe Regel wie bei `retyped`.
   * 🪤 Und NICHT beim Treffer aus der Vorschlagsliste: der laeuft ueber `add_existing`, und dort
   * hat der Editor die bestehende Quelle ausdruecklich gewaehlt -- die Kachel sagt es bereits.
   */
  function zeigeVerknuepfung(daten) {
    const text = featureSourceLinkedMessage(daten && daten.linked, tr);
    if (text) {
      showAddRowNote(text);
    }
  }

  // ── Die Adressauskunft ─────────────────────────────────────────────────────────────────────
  // Entwurf: docs/superpowers/specs/2026-09-01-bekannte-quellen-design.md §3.4 + §4.
  //
  // 🔴 DREI ZUSTÄNDE, und jeder heißt genau eine Sache (Owner-Entscheid 02.09.2026 zum Knopf, mit
  // dieser Korrektur): `gelesen`/`bekannt` grün · `erreichbar` neutral-warm · `unerreichbar` rot.
  // „Erreichbar, aber nichts zu lesen" ist der Fall, den ein zweifarbiger Knopf falsch erzählt.
  const ADRESS_ZUSTAENDE = ["bekannt", "gelesen", "erreichbar", "unerreichbar"];

  // 🔴 Die Katalogfelder gehören dem KORPUS bzw. der bekannten Zeile -- was der Editor dort
  // hineinschreibt, wird entweder verworfen (Titel füllt nur eine Lücke) oder wirkt katalogweit
  // (`is_official` überschreibt der Upsert UNBEDINGT). Deshalb werden sie gesperrt, statt hinterher
  // zu erklären, warum die Eingabe nichts bewirkt hat.
  const ADRESS_KATALOGFELDER = [".fs-add-label", ".fs-add-type", ".fs-add-license", ".fs-add-attribution", ".fs-add-official"];

  function setzeKatalogfelderGesperrt(gesperrt) {
    ADRESS_KATALOGFELDER.forEach((selektor) => {
      const el = containerEl.querySelector(selektor);
      if (el) {
        el.disabled = Boolean(gesperrt);
      }
    });
    const zeile = containerEl.querySelector("[data-fs-add]");
    if (zeile) {
      zeile.classList.toggle("fs-row--add-bekannt", Boolean(gesperrt));
    }
  }

  // Setzt Knopffarbe und Meldung. `null` = zurück auf unbestimmt (der Editor tippt weiter).
  function setzeAdressZustand(zustand, meldung) {
    const knopf = containerEl.querySelector("[data-fs-check]");
    if (knopf) {
      ADRESS_ZUSTAENDE.forEach((z) => knopf.classList.remove("fs-add-check--" + z));
      if (zustand) {
        knopf.classList.add("fs-add-check--" + zustand);
      }
      knopf.classList.remove("fs-add-check--laeuft");
    }
    const note = containerEl.querySelector("[data-fs-note]");
    if (note) {
      // textContent: die Meldung zitiert Titel und Adresse, also Fremdtext.
      note.textContent = meldung || "";
      note.hidden = !meldung;
      // 💣 Der Kasten ist von Haus aus BERNSTEIN -- er war die Absage („URL fehlt"). Eine gute
      // Nachricht darin läse sich wie ein Problem, also folgt seine Farbe demselben Zustand wie
      // der Knopf. Ohne Zustand bleibt er die Absage, wie bisher.
      note.classList.remove("fs-add-note--ok", "fs-add-note--bad");
      if (zustand === "gelesen" || zustand === "bekannt") {
        note.classList.add("fs-add-note--ok");
      } else if (zustand === "unerreichbar") {
        note.classList.add("fs-add-note--bad");
      }
    }
  }

  let adressPruefungLaeuft = false;

  async function pruefeAdresse() {
    const urlInput = containerEl.querySelector(".fs-add-url");
    const url = String((urlInput && urlInput.value) || "").trim();
    if (url === "" || adressPruefungLaeuft) {
      return;
    }
    adressPruefungLaeuft = true;
    const knopf = containerEl.querySelector("[data-fs-check]");
    if (knopf) {
      ADRESS_ZUSTAENDE.forEach((z) => knopf.classList.remove("fs-add-check--" + z));
      knopf.classList.add("fs-add-check--laeuft");
    }
    // 🔴 IMMER über die Leitung, nie über den Anlege-Puffer: der beantwortet Fragen zum OBJEKT,
    // und diese hier gilt einer ADRESSE. Der Endpunkt lässt sie deshalb auch ohne
    // `entity_public_id` zu -- sonst könnte man beim Anlegen keinen Link prüfen.
    const daten = await featureSourceFetch({
      action: "inspect_url",
      entity_type: entityType,
      entity_public_id: typeof publicIdGetter === "function" ? (publicIdGetter() || "") : (publicIdGetter || ""),
      url,
      fetch: true,
    });
    adressPruefungLaeuft = false;
    const auskunft = daten && daten.ok === true ? daten.inspect : null;
    if (!auskunft) {
      // ⚠️ Ein Fehlschlag der PRÜFUNG ist kein Fehlschlag der Adresse. Der Knopf bleibt farblos,
      // und „Hinzufügen" bleibt benutzbar -- sonst hinge das Eintragen an einem fremden Server.
      setzeAdressZustand(null, tr("sources.add.checkFailed", "Die Adresse ließ sich gerade nicht prüfen — eintragen geht trotzdem."));
      return;
    }
    uebernehmeAuskunft(auskunft);
  }

  function uebernehmeAuskunft(auskunft) {
    const labelInput = containerEl.querySelector(".fs-add-label");
    const sicht = featureSourceInspectView(auskunft, tr);
    setzeKatalogfelderGesperrt(sicht.sperren);
    // ⚠️ Der Titel wird nur EINGESETZT, wo noch nichts steht -- wer schon getippt hat, meinte das.
    // 🔴 Ausnahme: eine BEKANNTE Zeile gewinnt immer, denn ihr gespeicherter Titel gewinnt auch im
    // Katalog (`label` füllt dort nur eine Lücke). Ein abweichender Tippfehler daneben wäre eine
    // Anzeige, die nach dem Speichern etwas anderes behauptet als die Liste darüber.
    if (labelInput && sicht.titel !== "" && (sicht.titelGewinnt || String(labelInput.value || "").trim() === "")) {
      labelInput.value = sicht.titel;
    }
    // 💣 GESPERRT UND GEFÜLLT, nie gesperrt und leer. Ein ausgegrautes „Art …" behauptet, der
    // Katalog wisse nichts -- dabei sperrt die Zeile genau deshalb, WEIL er es weiß.
    // Owner-Meldung 02.09.2026: „der rest fehlt irgendwie".
    if (sicht.felder) {
      const setzeWert = (selektor, wert) => {
        const el = containerEl.querySelector(selektor);
        if (el) {
          el.value = wert;
        }
      };
      setzeWert(".fs-add-type", sicht.felder.source_type);
      setzeWert(".fs-add-license", sicht.felder.license);
      setzeWert(".fs-add-attribution", sicht.felder.attribution);
      const haken = containerEl.querySelector(".fs-add-official");
      if (haken) {
        haken.checked = sicht.felder.is_official;
      }
    }
    setzeAdressZustand(sicht.zustand, sicht.meldung);
  }

  // Nach jedem Neuzeichnen: das Adressfeld ist ein neues Element, direkte Listener sind weg.
  // 🔴 Bewusst NICHT in `wireAutocomplete`: die steigt oben aus, wenn die Vorschlagsliste auf
  // dieser Oberfläche gar nicht geladen ist -- die Adressprüfung fiele dann still mit aus.
  function wireAdressPruefung() {
    const urlInput = containerEl.querySelector(".fs-add-url");
    if (!urlInput) {
      return;
    }
    // 💣 Beim Einfügen steht der Wert erst NACH dem Ereignis im Feld -- ohne den Aufschub prüften
    // wir den Stand von davor (meist die leere Zeichenkette).
    urlInput.addEventListener("paste", () => {
      setTimeout(pruefeAdresse, 0);
    });
    urlInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        // ⚠️ Enter war hier bisher wirkungslos (die Zeile steht in keinem <form>); abgefangen wird
        // es trotzdem, damit eine umgebende Seite es nicht als Absenden liest.
        event.preventDefault();
        pruefeAdresse();
      }
    });
    // Sobald die Adresse wieder verändert wird, gilt die Auskunft nicht mehr -- und die gesperrten
    // Felder müssen zurück, sonst bleibt die Zeile für eine ANDERE Adresse halb gesperrt.
    urlInput.addEventListener("input", () => {
      setzeAdressZustand(null, "");
      setzeKatalogfelderGesperrt(false);
    });
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
    // '' = niemand hat eine Art gewaehlt. Der fruehere Rueckfall auf "sonstiges" machte aus dem
    // Nichtstun eine Aussage -- dieselbe Falle wie die Vorauswahl im Feld selbst.
    const gewaehlteArt = String((typeSelect && typeSelect.value) || "");
    return {
      url: String((urlInput && urlInput.value) || "").trim(),
      label: String((labelInput && labelInput.value) || "").trim(),
      source_type: gewaehlteArt,
      // 🔴 EIGENER Schluessel statt eines Rueckschlusses aus dem Wert. Der Server stellt die Art
      // einer BEKANNTEN Quelle nur danach richtig; ein alter, zwischengespeicherter Client kennt ihn
      // nicht und kann darum keine katalogweit geteilte Zeile umschreiben, obwohl er die
      // vorausgewaehlte erste Art mitschickt.
      source_type_chosen: gewaehlteArt !== "",
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

  // ── Der Bearbeiten-Kasten ────────────────────────────────────────────────────────────────────
  // 🔴 DER ZUSTAND IST DAS VORHANDENSEIN DES KASTENS IM DOM, sonst nichts. Kein Modulzustand
  // daneben, der beim naechsten Neuzeichnen auseinanderlaufen kann -- an genau dem sind das
  // Anzeige-Menue der Karte und die Ansichts-Kacheln schon gescheitert (AGENTS.md §11).
  // ⚠️ Und darum ueberlebt der Kasten ein `renderFromServer` bewusst NICHT: die Antwort ist die
  // frische Wahrheit, ein darueber stehengelassenes Formular zeigte die alte.
  function schliesseBearbeiten() {
    const offen = containerEl.querySelector("[data-fs-edit-panel]");
    if (offen) {
      offen.remove();
    }
    containerEl.querySelectorAll(".fs-row--open").forEach((row) => row.classList.remove("fs-row--open"));
  }

  // Die zuletzt vom Server gelieferten Zeilen -- daraus wird der Kasten gebaut. ⚠️ Nicht aus dem
  // DOM zurueckgelesen: dort steht die GEKUERZTE Seitenangabe („S. 16 ff."), und die als
  // Ausgangswert zu nehmen hiesse, beim ersten Speichern 27 Seiten durch drei zu ersetzen.
  let letzteQuellen = [];
  // Die zuletzt empfangene Antwort, auch eine abgelehnte -- nur dort steht der Grund einer Absage.
  let letzteAntwort = null;

  function oeffneBearbeiten(sourceId) {
    const zeile = containerEl.querySelector('.fs-row[data-source-id="' + sourceId + '"]');
    const quelle = letzteQuellen.find((s) => String(s.source_id) === String(sourceId));
    if (!zeile || !quelle) {
      return;
    }
    // ⚠️ EIN Kasten zur Zeit. Zwei offene Formulare auf derselben geteilten Katalogzeile waeren
    // zwei Wahrheiten, und der zweite ueberschriebe beim Speichern den ersten.
    const warOffen = containerEl.querySelector('[data-fs-edit-panel="' + sourceId + '"]') !== null;
    schliesseBearbeiten();
    if (warOffen) {
      return; // derselbe Knopf noch einmal = zuklappen
    }
    zeile.classList.add("fs-row--open");
    zeile.insertAdjacentHTML("afterend", renderFeatureSourceEditPanel(quelle, opts && opts.escape ? opts.escape : featureSourceDefaultEscape, tr));
  }

  function zeigeKastenMeldung(panel, text) {
    const msg = panel.querySelector("[data-fs-edit-msg]");
    if (msg) {
      msg.textContent = text; // textContent: die Meldung zitiert eingetippte Werte
    }
  }

  async function speichereBearbeiten(sourceId) {
    const panel = containerEl.querySelector('[data-fs-edit-panel="' + sourceId + '"]');
    if (!panel) {
      return;
    }
    const felder = featureSourceChangedFields(panel);
    if (Object.keys(felder).length === 0) {
      // ⚠️ Gesagt, nicht verschluckt: ein Knopf, der wortlos nichts tut, ist von einem kaputten
      // nicht zu unterscheiden -- die Lehre aus #105.
      zeigeKastenMeldung(panel, tr("sources.edit.nothing", "Nichts geändert."));
      return;
    }
    const quelle = letzteQuellen.find((s) => String(s.source_id) === String(sourceId)) || {};
    const katalogFelder = Object.keys(felder).filter((n) => n !== "pages" && n !== "reference_kind");
    const usage = Number(quelle.usage_count) || 1;
    // 🔴 Die Rueckfrage nennt die ZAHL. „Gilt überall" ohne Groesse ist keine Warnung -- und
    // der Server verlangt zusaetzlich das Haekchen `confirm_catalog`, der Knopf allein ist kein
    // Riegel (dieselbe Regel wie beim Loeschriegel der Uebernahme-Vorschau).
    if (katalogFelder.length > 0 && usage > FEATURE_SOURCE_CONFIRM_THRESHOLD) {
      const frage = tr("sources.edit.confirm",
        "„{label}“ wird an {n} Objekten zitiert. Die Änderung gilt überall dort. Fortfahren?")
        .replace("{label}", String(quelle.label || quelle.url || ""))
        .replace("{n}", String(usage));
      if (!window.confirm(frage)) {
        return;
      }
    }
    const daten = await renderFromServer("update", {
      source_id: Number(sourceId),
      fields: felder,
      confirm_catalog: katalogFelder.length > 0,
    });
    // renderFromServer haelt bei einem Fehlschlag die vorige Darstellung -- der Kasten steht also
    // noch, und die Absage gehoert hinein statt in die Eingabezeile darunter.
    if (!daten) {
      const nochDa = containerEl.querySelector('[data-fs-edit-panel="' + sourceId + '"]');
      if (nochDa) {
        // 🔴 Den GRUND nennen, nicht „hat nicht geklappt". Der Server unterscheidet
        // `wiki_owned_field` von `catalog_confirm_required` von einem echten Fehler, und genau
        // diese Unterscheidung ist das, was der Editor wissen muss.
        const fehler = letzteAntwort && letzteAntwort.error ? letzteAntwort.error : null;
        zeigeKastenMeldung(nochDa, (fehler && fehler.message)
          ? String(fehler.message)
          : tr("sources.edit.failed", "Konnte nicht gespeichert werden."));
      }
    }
  }

  containerEl.addEventListener("click", async (event) => {
    const editTarget = event.target.closest("[data-fs-edit-id]");
    if (editTarget) {
      oeffneBearbeiten(editTarget.getAttribute("data-fs-edit-id"));
      return;
    }
    if (event.target.closest("[data-fs-edit-cancel]")) {
      schliesseBearbeiten();
      return;
    }
    const saveTarget = event.target.closest("[data-fs-edit-save]");
    if (saveTarget) {
      await speichereBearbeiten(saveTarget.getAttribute("data-fs-edit-save"));
      return;
    }
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
    if (event.target.closest("[data-fs-check]")) {
      await pruefeAdresse();
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
        // travel too. Over the wire the server resolves the row by id.
        // 🔴 Die AUSDRUECKLICHE Wahl der Art reist auch hier mit: wer den Titel tippt und den
        // Treffer waehlt, meint dasselbe wie einer, der die Adresse eintraegt. Eine Regel, die
        // einen von zwei Erzeugern bindet, ist keine Regel (AGENTS.md §11).
        const daten = await renderFromServer("add_existing", Object.assign(
          {
            source_id: pickedSourceId,
            pages: values.pages,
            reference_kind: values.reference_kind,
            source_type: values.source_type,
            source_type_chosen: values.source_type_chosen,
          },
          pendingStore
            ? { url: values.url, label: values.label, is_official: values.is_official }
            : {}
        ));
        zeigeUmtypung(daten);
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
      // 🔴 BEIDE Rueckmeldungen, und in dieser Reihenfolge: die Verknuepfung ueberschreibt die
      // Umtypung in derselben Zeile, weil sie die umfassendere Auskunft ist -- wer erfaehrt,
      // dass er eine FREMDE Katalogzeile getroffen hat, muss das zuerst wissen.
      const daten = await renderFromServer("add", values);
      zeigeUmtypung(daten);
      zeigeVerknuepfung(daten);
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
      // 💣 LIZENZ UND NAMENSNENNUNG GEHOEREN DAZU, und ihr Fehlen war lange unsichtbar.
      // js/ui/feature-source-markup.js liest `s.license`/`s.attribution` aus GENAU DIESEM Eintrag
      // und zeichnet daraus den Lizenzbaustein. Ohne die zwei Zeilen erscheint eine frisch
      // eingetragene Quelle zwar, aber OHNE ihre Lizenz -- und die traegt die Rechtsfolge (der
      // Garetien-Import haengt `cc-by-nc-sa-3.0` / „VolkoV / garetien.de" an jedes Objekt).
      // Bis zum vollstaendigen Neuladen sah es aus wie eine Quelle ohne Lizenzangabe, also wie
      // eine schlechter erfasste Quelle -- nicht wie ein Anzeigefehler.
      license: source.license || "",
      attribution: source.attribution || "",
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
  // 🔴 Damit der Garetien-Importer DIESE Fassung ruft statt einer eigenen. Er legt Quellen an
  // Objekten an, die die geladene Karte noch nicht mit Quelle kennt; ohne den Abgleich stuende
  // seine Quelle erst nach einem vollstaendigen Neuladen in der Infobox.
  window.syncFeatureSourcesToClientCache = syncFeatureSourcesToClientCache;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    renderFeatureSourceEditorHtml, createPendingFeatureSourceStore, syncFeatureSourcesToClientCache,
    // Der Bearbeiten-Kasten und seine Schwelle -- der Kasten ist rein (kein DOM, kein fetch) und
    // damit unter Node fahrbar; die Schwelle wird gegen die PHP-Konstante gehalten.
    renderFeatureSourceEditPanel, FEATURE_SOURCE_CONFIRM_THRESHOLD, featureSourceChangedFields,
    featureSourceLinkedMessage,
    // Die Adressauskunft der Eingabezeile: rein, damit „Zustand → was der Editor sieht" prüfbar
    // ist, statt nur im Browser zu gelten.
    featureSourceInspectView,
  };
}
