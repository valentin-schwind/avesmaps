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

// 🔴 Der NAME VORN kommt aus feature-source-markup.js (featureSourceVornName) -- dieselbe Regel, die
// die Infobox fuer den Besucher anwendet: Korpusname bei einer Belegstelle, sonst der Titel.
// Owner 03.09.2026: „kannst du bei der auflistung von quellen im backend den titel grundsätzlich an
// dem anpassen, was im frontend zu sehen ist? die editoren sagen, dass sie verwirrt sind, dass das
// was anderes steht." Derselbe Weiterreicher wie bei der Seitenkuerzung, aus denselben Gruenden.
function featureSourceNameVorn(source, korpus) {
  var geteilt = (typeof module !== "undefined" && module.exports)
    ? require("../ui/feature-source-markup.js").featureSourceVornName
    : (typeof featureSourceVornName === "function" ? featureSourceVornName : null);
  if (typeof geteilt !== "function") {
    throw new Error("feature-source-markup.js fehlt -- sie traegt die Regel, welcher Name vorn steht");
  }
  return geteilt(source, korpus);
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
/**
 * Die Marke „12 von 56 Abschnitten“ -- NUR bei einer Teilmenge.
 *
 * 🔴 Ein Weg liegt auf der Karte in Abschnitten, und die Quelle haengt am Abschnitt; die Sammelliste
 * der Weg-Ebene sagt je Katalogzeile, an wie vielen der Abschnitte sie haengt (`segments` /
 * `segments_of`). An ALLEN ist der Normalfall (2.347 von 2.511 Wegquellen, live gemessen 03.09.2026)
 * und bekommt keine Marke; eine Zeile ohne Zaehler (die Liste eines einzelnen Abschnitts) auch nicht.
 * ⚠️ Sie steht IM Titel-Feld, hinter dem Link -- keine achte Rasterspalte, die alle uebrigen Listen
 * mittragen muessten (Entwurf docs/superpowers/specs/2026-09-03-quellen-wege-design.md §3.2).
 */
function renderFeatureSourceSegmentsMark(source, escape, tr) {
  const n = Number(source && source.segments);
  const von = Number(source && source.segments_of);
  if (!Number.isFinite(n) || !Number.isFinite(von) || von <= 0 || n >= von) {
    return "";
  }
  const kurz = tr("sources.segments.short", "{n} von {m} Abschnitten").replace("{n}", String(n)).replace("{m}", String(von));
  const lang = tr("sources.segments.title", "Diese Quelle hängt an {n} von {m} Abschnitten dieses Weges")
    .replace("{n}", String(n)).replace("{m}", String(von));
  return ' <span class="fs-row__segments" title="' + escape(lang) + '">' + escape(kurz) + "</span>";
}

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
  const marke = renderFeatureSourceSegmentsMark(source, escape, tr);
  // 🔴 VORN STEHT, WAS DER BESUCHER SIEHT (Owner 03.09.2026): bei einer Belegstelle der Korpusname, sonst
  // der Titel -- ueber die EINE Regel der Infobox. Der Seitentitel geht in den Tooltip des Links
  // („Baronie Hirschfurten — Garetien-Wiki"), und nur, wenn er vorn nicht steht (Owner: „du kannst den
  // Titel in den Tooltip des links verlagern"). Vollstaendig steht er ohnehin im ✎.
  const name = featureSourceNameVorn(source, source.corpus || null);
  const tooltip = name.titel ? ' title="' + escape(name.titel + " — " + name.vorn) + '"' : "";
  return (
    '<div class="fs-row" data-source-id="' + escape(source.source_id) + '">' +
    // 💣 MIT Marke darf der Link UMBRECHEN (`.fs-row__link--marke`): der Link ellipsiert sonst am TEXT
    // (`white-space: nowrap; text-overflow: ellipsis`), und eine Marke hinter dem Text laege bei einem
    // langen Titel HINTER den drei Punkten -- im Browser gemessen (Rasterstufe ab 670px: Marke bei 305px,
    // Zelle endet bei 211px). Ein Flex-Kasten mit ellipsiertem Titel-Span liess vom Titel 51px uebrig
    // („Geogr…“); der Umbruch haelt den Namen lesbar, und der Fall ist selten (12 Wege live, nur auf der
    // Weg-Ebene). Ohne Marke bleibt das Markup zeichengleich zu vorher.
    (marke
      ? '<a class="fs-row__link fs-row__link--marke" href="' + escape(source.url) + '"' + tooltip + ' target="_blank" rel="noopener">'
        + escape(name.vorn || source.url) + " ↗" + marke + "</a>"
      : '<a class="fs-row__link" href="' + escape(source.url) + '"' + tooltip + ' target="_blank" rel="noopener">'
        + escape(name.vorn || source.url) + " ↗</a>") +
    '<span class="fs-row__badge">' + escape(featureSourceTypeLabel(source.type)) + officialMark + "</span>" +
    kind +
    pages +
    license +
    edit +
    '<button type="button" class="fs-row__remove" data-remove-source-id="' + escape(source.source_id) + '">✕</button>' +
    "</div>"
  );
}

/**
 * Ein Zeitstempel als Datum — „2026-09-02 17:04:00.000" wird „02.09.2026".
 *
 * 🔴 KEIN `new Date(...)`. Der Server schickt einen MySQL-Zeitstempel ohne Zonenangabe; `Date`
 * liest ihn je nach Browser als UTC oder als Ortszeit und verschiebt ihn dabei um Stunden — was
 * um Mitternacht den TAG ändert. Hier wird nur zerlegt, nie umgerechnet.
 * ⚠️ Was nicht wie ein Datum aussieht, kommt unverändert zurück statt als „NaN.NaN.NaN".
 */
function featureSourceDatum(wann) {
  const treffer = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(wann == null ? "" : wann).trim());
  return treffer ? treffer[3] + "." + treffer[2] + "." + treffer[1] : String(wann == null ? "" : wann).trim();
}

/**
 * Die Herkunftszeile einer Reichweite: „Eingetragen von Vali am 02.09.2026".
 *
 * 🔴 NUR LESBAR (Owner 02.09.2026: „die felder können nur eingesehen, nicht verändert werden").
 * Deshalb ein `<p>` und kein Feld — es gibt keinen Schreibweg, und ein Eingabefeld, das nichts
 * annimmt, verspricht einen.
 * ⚠️ OHNE NAMEN NUR DAS DATUM. Der Bestand von vor der Anmeldepflicht trägt `created_by = NULL`,
 * und „von unbekannt" ist keine Auskunft, sondern ein Platzhalter, der wie ein Fehler aussieht.
 * ⚠️ Ohne Datum GAR KEINE Zeile — der Server liefert dann `null` (`avesmapsFeatureSourceHerkunft`).
 */
function featureSourceHerkunftZeile(herkunft, wortlaut, escape, tr) {
  if (!herkunft || !herkunft.at) {
    return "";
  }
  const datum = featureSourceDatum(herkunft.at);
  const wer = String(herkunft.by == null ? "" : herkunft.by).trim();
  const text = wer
    ? tr(wortlaut.mitName, wortlaut.mitNameText).replace("{wer}", wer).replace("{wann}", datum)
    : tr(wortlaut.ohneName, wortlaut.ohneNameText).replace("{wann}", datum);
  // 🔴 `.fs-scope__by` -- der Name aus dem Vertrag. Sie hiess `.fs-edit__by` und war damit
  // an den ✎ gebunden, obwohl die Eingabezeile dieselbe Zeile bekommen soll.
  return '<p class="fs-scope__by">' + escape(text) + "</p>";
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
// ⚠️ `wegGruppe` ({anzahl, fest}) wie beim Eingabeformular: auf der WEG-EBENE (fest) schreibt „Speichern“ Seite(n)
// und Abdeckung an ALLE Abschnitte -- der dritte Rahmen muss das sagen, sonst verspricht er „Nur an diesem
// Objekt“ und ueberschreibt wortlos 56 Seitenangaben (Befund des Pruefagenten, 03.09.2026).
function renderFeatureSourceEditPanel(source, escape, tr, wegGruppe) {
  const usage = Number(source.usage_count) || 1;
  const wikiOwned = source.wiki_owned === true;
  // 🔴 WELCHE KORPUSFELDER DIESE ZEILE SELBST BESITZT. Owner 02.09.2026: „Quelle soll optional
  // noch haben: Abweichende Lizenz, Abweichende Namensnennung" -- auf Nachfrage auf alle vier
  // korpuseigenen Felder erweitert, weil die einzigen Abweichungen im Bestand ausgerechnet die
  // zwei anderen sind (Art und „offiziell" an „Der Preis der Macht").
  const eigen = Array.isArray(source.own_fields) ? source.own_fields.slice() : [];
  // 🔴 DIE ADRESSE TRAEGT AUCH HIER `.fs-url` -- der auffaellige Rahmen gehoert dem FELD, nicht
  // dem Formular (Owner 02.09.2026: „auffaelligen rahmen"). Ohne diese Zeile sah dasselbe Feld in
  // der Eingabezeile braun umrandet aus und im ✎ wie jedes andere: gemessen rgb(122,90,58) gegen
  // rgb(221,211,195). Der letzte Unterschied zwischen den zwei Formularen.
  const feld = (name, wert, markup) =>
    '<label class="fs-field' + (name === "url" ? " fs-field--full fs-url" : (name === "label" || name === "attribution" ? " fs-field--grow" : "")) + '">'
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



  const objekte = usage === 1
    ? escape(tr("sources.edit.scopeOne", "zurzeit nur dieses Objekt"))
    : escape(tr("sources.edit.scopeMany", "zurzeit ")) + "<b>"
      + escape(String(usage) + " " + tr("sources.edit.objects", "Objekte")) + "</b>";

  // ⚠️ OHNE Korpus (eine Quelle ohne Adresse -- 357 Wiki-Publikationen sind das) heisst die
  // Gruppe schlicht „Gilt für den ganzen Korpus"; es gibt dann keinen Wirt, den sie nennen
  // könnte, und eine erfundene Zahl wäre schlimmer als keine.
  const korpus = source.corpus || null;
  const korpusTitel = korpus && korpus.label
    ? tr("sources.edit.corpusScope", "Gilt für den ganzen Korpus „{name}“").replace("{name}", String(korpus.label))
    : tr("sources.edit.corpusScopePlain", "Gilt für den ganzen Korpus");
  const korpusObjekte = korpus ? Number(korpus.objects) || 0 : 0;
  const korpusReichweite = korpusObjekte > 0
    ? escape(tr("sources.edit.corpusReach", "{q} Quellen · {n} Objekte")
      .replace("{q}", String(Number(korpus.sources) || 0)).replace("{n}", String(korpusObjekte)))
    : "";

  // 🔴 IM KORPUSKASTEN STEHEN DIE WERTE DES KORPUS, nicht die dieser einen Zeile (Owner
  // 02.09.2026: „ich will, dass die einstellungen dran stehen, die ich eingegeben habe"). Sonst
  // behauptet die Ueberschrift Korpus-Reichweite und zeigt darunter etwas anderes -- und wer den
  // gezeigten Wert stehen laesst, glaubt, er habe den Korpus bestaetigt.
  // ⚠️ Nur bei einem BEKANNTEN Korpus. Gibt es keinen, bleibt die Zeile ihre eigene Wahrheit.
  // 🔴 EIN BESESSENES FELD ZEIGT SEINEN EIGENEN WERT, nicht den des Korpus. Ohne diese Zeile stand
  // im Bild „Quellenart: Briefspiel" mit einem durchgestrichenen „Briefspiel" daneben -- derselbe
  // Wert zweimal, einmal als Bestand und einmal als das, wovon er angeblich abweicht. Der Kasten
  // widersprach sich selbst; gefunden hat es der Blick, nicht der Test.
  // 🔴 Steht diese Quelle bewusst OHNE Korpus? (Owner 02.09.2026)
  const ohneKorpus = source.no_corpus === true || source.no_corpus === 1;
  // Der Kanon des KORPUS -- der Rahmen zeigt seinen Wert, nicht den der Zeile.
  // ⚠️ `offiziell` ist seit dem 03.09.2026 nicht mehr ueberschreibbar (Owner: „offiziell
  // braucht nicht ueberschrieben werden“) -- es gibt hier also nur EINEN Wert, keinen zweiten
  // daneben, von dem er abweichen koennte.
  const korpusKanon = (korpus && korpus.known === true && korpus.is_official !== undefined)
    ? korpus.is_official === true
    : source.official === true;

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
  // ── Die drei Reichweiten, gebaut mit dem GETEILTEN Rahmen ─────────────────────────────────
  // 🔴 GLEICHE Namen, GLEICHE Reihenfolge, GLEICHE Form wie in der Eingabezeile (Owner
  // 02.09.2026: „du kriegst es jedesmal hin, dass es anders ist, obwohl man denselben scheiss
  // eingibt"). Der einzige Unterschied ist, was schon ausgefüllt ist.
  const rahmenQuelle = avesmapsSourceScopeFrame({
    escape,
    titel: tr("sources.scope.source", "Gilt für alle Objekte, die diese Quelle zitieren"),
    reichweite: objekte,
    felder:
      (wikiOwned ? "" : feld("url", tr("sources.edit.url", "Adresse"),
        text("url", String(source.url || ""), "https://…", false)))
      + feld("label", tr("sources.colTitle", "Titel"), text("label", String(source.label || ""), "", wikiOwned))
      // 🔴 „Kein Korpus verwenden" (Owner 02.09.2026), Vorgabe AUS. Angehakt gehört die Quelle zu
      // keinem Korpus: der Rahmen darunter verschwindet, und der Server schreibt keinen Wirt mehr
      // — was sonst alle ANDEREN Quellen dieses Wirts träfe.
      + '<label class="fs-af fs-af--w fs-check"><input type="checkbox" data-fs-field="no_corpus"'
      + ' data-fs-orig="' + (ohneKorpus ? "1" : "0") + '"' + (ohneKorpus ? " checked" : "")
      + (wikiOwned ? " disabled" : "") + "> "
      + escape(tr("sources.add.noCorpus", "Kein Korpus verwenden"))
      + '<span class="fs-af__meta"> — '
      + escape(tr("sources.add.noCorpusHint", "diese Quelle steht für sich")) + "</span></label>",
    // 🔴 DIE HERKUNFT STEHT AN IHRER REICHWEITE, nicht gesammelt am Fuss. „Wer hat das hier
    // angehängt" und „wer hat die Quelle angelegt" sind zwei verschiedene Menschen und zwei
    // verschiedene Zeitpunkte; unter einer gemeinsamen Überschrift wäre nicht zu sehen, welche
    // Angabe zu welcher Hälfte gehört.
    fuss: adresse + featureSourceHerkunftZeile(source.created && source.created.source, {
      mitName: "sources.edit.bySource", mitNameText: "In den Katalog gelegt von {wer} am {wann}",
      ohneName: "sources.edit.bySourceAnon", ohneNameText: "In den Katalog gelegt am {wann}",
    }, escape, tr) + hinweis,
  });

  // 🔴 DER KORPUSRAHMEN — und er ist eine BERICHTIGUNG, keine Zierde. Art, Lizenz, Nennung und
  // Kanon gehören dem KORPUS: eine Änderung daran trifft jede Quelle dieses Wirts. In der Gruppe
  // darüber gestanden, versprach die Überschrift „gilt für alle Objekte, die diese Quelle
  // zitieren · zurzeit nur dieses Objekt" — während ein Griff zur Lizenz 39 Quellen und 50
  // Objekte umgeschrieben hätte. Owner-Bild 02.09.2026.
  // 💣 SEINE FELDER HEISSEN `corpus_*` UND MEINEN DAMIT IMMER DEN KORPUS. Der blanke Name
  // (`license`) gehört seit dem 03.09.2026 der ABWEICHUNG im Rahmen darunter; trügen beide
  // denselben Namen, liessen sie sich nicht in EINEM Speichern ändern.
  const korpusFeldEdit = (name, beschriftung, markup) =>
    '<label class="fs-field' + (name === "attribution" ? " fs-field--grow" : "") + '">'
    + "<span>" + escape(beschriftung) + "</span>" + markup + "</label>";
  const korpusAnzeige = (name, rueckfall) =>
    (korpus && korpus.known === true && korpus[name] !== undefined && korpus[name] !== "")
      ? String(korpus[name]) : String(rueckfall);
  const rahmenKorpus = avesmapsSourceScopeFrame({
    escape,
    attr: "data-fs-korpus-gruppe",
    hidden: ohneKorpus,
    titel: korpusTitel,
    reichweite: korpusReichweite,
    felder:
      // 🔴 DIE FORM — sie ist die EINE Eigenschaft, die ein Korpus tragen muss: sie entscheidet,
      // welcher der beiden Namen dem Besucher vorn steht — bei einem WERK der Titel („Geographia
      // Aventurica"), bei einer BELEGSTELLE der Korpusname („Herzogtum Weiden").
      // 💣 DREI Werte, nicht zwei. „— noch offen —" ist ein eigener Zustand und verhält sich wie
      // „Werk": bei einem frischen Korpus mit einer Zeile sagt das Verhältnis Titel/Zeilen nichts,
      // und wer die Form dort rät, trifft in gut der Hälfte der Fälle daneben.
      korpusFeldEdit("form", tr("sources.edit.formLabel", "Form"),
        auswahl("corpus_form", String((korpus && korpus.form) || ""), [
          { wert: "", text: tr("sources.add.formOpen", "— noch offen —") },
          { wert: "werk", text: tr("sources.add.formWork", "Werke (Titel vorn)") },
          { wert: "belegstelle", text: tr("sources.add.formCite", "Belegstellen (Korpus vorn)") },
        ], !(korpus && korpus.known === true)))
      + korpusFeldEdit("source_type", tr("sources.colType", "Quellenart"),
        auswahl("corpus_source_type", korpusAnzeige("source_type", source.type || "sonstiges"),
          typEintraege, false))
      + korpusFeldEdit("license", tr("sources.colLicense", "Lizenz"),
        auswahl("corpus_license", korpusAnzeige("license", source.license || ""), lizenzEintraege, false))
      + korpusFeldEdit("attribution", tr("sources.add.attribution", "Namensnennung"),
        text("corpus_attribution", korpusAnzeige("attribution", source.attribution || ""),
          tr("sources.edit.attributionHint", "z. B. VolkoV / garetien.de"), false))
      + '<label class="fs-af fs-af--w fs-check">'
      + '<input type="checkbox" data-fs-field="corpus_is_official" data-fs-orig="'
      + (korpusKanon ? "1" : "0") + '"' + (korpusKanon ? " checked" : "") + (wikiOwned ? " disabled" : "")
      + "> " + escape(tr("sources.add.official", "offiziell")) + "</label>",
    // Die DRITTE Herkunft — wer den Korpus zuletzt angefasst hat. Ohne sie schwiege der Kasten
    // ausgerechnet bei der Gruppe, deren Änderung am weitesten reicht.
    fuss: featureSourceHerkunftZeile(korpus && korpus.updated, {
      mitName: "sources.edit.byCorpus", mitNameText: "Korpus zuletzt geändert von {wer} am {wann}",
      ohneName: "sources.edit.byCorpusAnon", ohneNameText: "Korpus zuletzt geändert am {wann}",
    }, escape, tr),
  });

  const gruppeFest = wegGruppe && wegGruppe.fest === true && Number(wegGruppe.anzahl) > 1 ? wegGruppe : null;
  const rahmenObjekt = avesmapsSourceScopeFrame({
    escape,
    titel: gruppeFest
      ? tr("sources.scope.wayAll", "An allen {n} Abschnitten dieses Weges").replace("{n}", String(Number(gruppeFest.anzahl)))
      : tr("sources.edit.linkScope", "Nur an diesem Objekt"),
    felder:
      feld("pages", tr("sources.colPages", "Seite(n)"), text("pages", String(source.pages || ""), "", false))
      + feld("reference_kind", tr("sources.colKind", "Abdeckung"),
        auswahl("reference_kind", String(source.reference_kind || ""), kindEintraege, false))
      // 🔴 DIE ABWEICHUNG — dasselbe Bauteil wie in der Eingabezeile, nur mit Werten.
      // ⚠️ Vorbelegt wird NUR, was diese Quelle wirklich besitzt (`own_fields`). Ein Feld, das
      // erbt, startet leer — leer heisst „wie der Korpus".
      + featureSourceAbweichungsBlock(escape, tr, {
        source_type: eigen.indexOf("source_type") !== -1 ? String(source.type || "") : "",
        license: eigen.indexOf("license") !== -1 ? String(source.license || "") : "",
        attribution: eigen.indexOf("attribution") !== -1 ? String(source.attribution || "") : "",
      }),
    fuss: featureSourceHerkunftZeile(source.created && source.created.link, {
      mitName: "sources.edit.byLink", mitNameText: "Hier angehängt von {wer} am {wann}",
      ohneName: "sources.edit.byLinkAnon", ohneNameText: "Hier angehängt am {wann}",
    }, escape, tr),
  });

  return (
    '<div class="fs-edit" data-fs-edit-panel="' + escape(source.source_id) + '">'
    + rahmenQuelle + rahmenKorpus + rahmenObjekt
    // 🔴 SPEICHERN / ABBRECHEN — dieselbe Knopfleiste wie in der Eingabezeile, `--radius-md`.
    + '<div class="fs-actions">'
    + '<button type="button" class="fs-actions__prim" data-fs-edit-save="' + escape(source.source_id) + '">'
    + escape(tr("sources.edit.save", "Speichern")) + "</button>"
    + '<button type="button" class="fs-actions__sek" data-fs-edit-cancel>'
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
    // ⚠️ „Quelle", nicht „Titel": vorn steht seit dem 03.09.2026 der Name, den der Besucher sieht --
    // bei einer Belegstelle der Korpusname, und der ist kein Titel.
    + kopf("sources.colTitle", "Quelle")
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

/**
 * DER REICHWEITEN-RAHMEN — EIN Bauteil, sechs Verwender.
 *
 * 💣 WARUM ES DAS GIBT. Bis zum 02.09.2026 baute jedes Formular seinen Rahmen selbst: vier
 * Rezepturen fuer eine Form (`.fs-adresse`, `.fs-eintrag`, `.fs-korpus`, `.fs-edit__group`), im
 * Browser gemessen 10px/normal gegen 11px/fett, 8px gegen 10px Polster, solid gegen dashed. Der
 * Owner sah es sofort: „du kriegst es jedesmal hin, dass es anders ist, obwohl man denselben
 * scheiss eingibt." — Und in ZWEI der vier stand die Warnung schon da („eine zweite Rezeptur
 * waere die Divergenz"). Eine Warnung hinzuschreiben ersetzt das Bauteil nicht.
 *
 * 🔴 ANLEGEN UND BEARBEITEN SIND DASSELBE FORMULAR: gleiche Reichweiten, gleiche Namen,
 * gleiche Reihenfolge (von weit nach eng: die Quelle — der Korpus — dieses Objekt). Der einzige
 * Unterschied ist, was schon ausgefuellt ist. Wer einen zweiten Rahmen braucht, ruft DIESE
 * Funktion; wer ihre Werte abschreibt, baut die fuenfte Rezeptur.
 *
 * ⚠️ `reichweite` und `felder` sind fertiges MARKUP und werden NICHT maskiert — der
 * ✎-Kasten setzt dort ein `<b>` um die Objektzahl. Alles, was aus Benutzereingabe stammt,
 * maskiert der Aufrufer, bevor er es hereinreicht. `titel` und `hinweis` sind Text und werden
 * hier maskiert.
 *
 * @param {{titel: string, reichweite?: string, reichweiteAttr?: string, hinweis?: string,
 *          felder: string, fuss?: string, hidden?: boolean, attr?: string,
 *          escape?: (s: string) => string}} opts
 * @returns {string}
 */
/**
 * DIE ABWEICHUNG VOM KORPUS — drei Felder, kein Häkchen.
 *
 * 🔴 Owner 02.09.2026: „eigentlich braucht es die häkchen nicht NUR felder. wenn ich die
 * quellenart änder gilt eine andere … ich will nur änderungen vornehmen können für diese eine
 * quelle." Der erste Eintrag (bzw. der Platzhalter) IST der Korpuswert; wer etwas anderes
 * einstellt, weicht ab, wer zurückstellt, erbt wieder.
 *
 * 💣 DAMIT GIBT ES KEINEN ZWEITEN ZUSTAND NEBEN DEM WERT. Die Fassung davor trug ein Häkchen
 * UND einen Wert; die beiden konnten auseinanderlaufen (angehakt, aber leer), und die Anzeige
 * musste raten, welcher von beiden gilt. Dieselbe Regel wie beim Hintergrundklick, wo `hidden`
 * der ganze Zustand ist.
 *
 * 💣 UND DAS FELD MARKIERT SICH, WENN ES ABWEICHT — aber NICHT nur durch Farbe. Gemessen sind
 * `--color-accent-brown` (#7a5a3a) und `--color-text-muted` (#706557) im hellen Thema fast
 * dasselbe Braun: die Markierung war da und trotzdem unsichtbar. Sie wird deshalb BENANNT
 * („Lizenz · abweichend", `.fs-field--abw > span::after` im CSS).
 *
 * ⚠️ `offiziell` fehlt hier absichtlich (Owner: „offiziell braucht nicht überschrieben
 * werden") — es gehört allein dem Korpus.
 * ⚠️ Die Beschriftung des ERSTEN Eintrags entsteht erst zur Laufzeit („wie Korpus (Briefspiel)"
 * bzw. „— keine Angabe —" ohne Korpus): sie hängt am Korpus, den erst die Adresse verrät.
 * Der leere `value` ist der Zustand „erbt" — er wird NICHT aus der Beschriftung gelesen.
 *
 * @param {(s: string) => string} escape
 * @param {(k: string, f: string) => string} tr
 * @param {string} typOptionen fertige `<option>`-Liste der Quellenarten
 * @param {string} lizenzOptionen fertige `<option>`-Liste der Lizenzen
 * @returns {string}
 */
function featureSourceAbweichungsBlock(escape, tr, werte) {
  const w = werte || {};
  const lizenzTafel = featureSourceLicenseTable();
  // 🔴 Der erste Eintrag traegt IMMER `value=""` -- das ist „erbt". Sein Text wird zur
  // Laufzeit gesetzt (`zeigeAbweichung`), weil er am Korpus haengt, den erst die Adresse verraet.
  const liste = (eintraege, gewaehlt) =>
    ['<option value="">' + escape(tr("sources.abw.inherit", "wie Korpus")) + "</option>"]
      .concat(eintraege.map((e) => '<option value="' + escape(e.wert) + '"'
        + (e.wert === gewaehlt && gewaehlt !== "" ? " selected" : "") + ">" + escape(e.text) + "</option>"))
      .join("");
  // 💣 DIE LISTEN ENTSTEHEN HIER, nicht beim Aufrufer. Die erste Fassung liess sich die
  // fertigen `<option>`-Ketten hereinreichen -- und der Bearbeiten-Kasten haette dafuer seine
  // eigenen gebaut, mit seiner eigenen Vorauswahl. Zwei Erzeuger fuer dieselbe Liste sind genau
  // die Divergenz, die dieser Umbau beseitigt.
  const arten = FEATURE_SOURCE_TYPES.map((t) => ({ wert: t, text: featureSourceTypeLabel(t) }));
  const lizenzen = Object.keys(lizenzTafel).map((k) => ({ wert: k, text: lizenzTafel[k].label }));
  // 🔴 ZWEI Marker je Feld, und beide werden gebraucht: `data-fs-field` bringt den Wert zum
  // Server (und `own_fields` schickt ihn dort in `sources` statt in den Korpus), `data-fs-abw-wert`
  // sagt dem Sammler, dass ein gefuellter Wert eine ABWEICHUNG ist.
  const wert = (name) => String(w[name] || "");
  // 💣 DIE MARKE STEHT SCHON IM MARKUP, nicht erst zur Laufzeit. `zeigeAbweichung` setzt sie beim
  // Tippen -- aber der ✎ zeichnet eine BESTEHENDE Abweichung, und ohne diese Zeile stand die
  // fremde Lizenz unmarkiert da, so als erbte sie. Im Bild gesehen, von keinem Test.
  const feld = (name, klasse, beschriftung, markup) =>
    '<label class="fs-af ' + klasse + (wert(name) !== "" ? " fs-field--abw" : "")
    + '" data-fs-abw-feld="' + escape(name) + '"><span class="fs-af__l">'
    + escape(beschriftung) + "</span>" + markup + "</label>";
  const auswahl = (name, eintraege) =>
    '<select data-fs-field="' + name + '" data-fs-abw-wert="' + name + '"'
    + ' data-fs-orig="' + escape(wert(name)) + '" data-fs-abw-orig="' + escape(wert(name)) + '">'
    + liste(eintraege, wert(name)) + "</select>";
  return '<div class="abw" data-fs-abw>'
    + '<div class="abw__t" data-fs-abw-text></div>'
    + '<div class="abw__f">'
    + feld("source_type", "fs-af--art", tr("sources.add.typeLabel", "Quellenart"),
      auswahl("source_type", arten))
    + feld("license", "fs-af--license", tr("sources.add.licenseLabel", "Lizenz"),
      auswahl("license", lizenzen))
    + feld("attribution", "fs-af--grow",
      tr("sources.add.attributionLabel", "Namensnennung bzw. mit freundlicher Genehmigung von"),
      '<input type="text" data-fs-field="attribution" data-fs-abw-wert="attribution"'
      + ' data-fs-orig="' + escape(wert("attribution")) + '"'
      + ' data-fs-abw-orig="' + escape(wert("attribution")) + '"'
      + ' value="' + escape(wert("attribution")) + '">')
    + "</div></div>";
}

function avesmapsSourceScopeFrame(opts) {
  const o = opts || {};
  const esc = o.escape || featureSourceDefaultEscape;
  return '<div class="fs-scope"' + (o.hidden ? " hidden" : "") + (o.attr ? " " + o.attr : "") + ">"
    + '<div class="fs-scope__head"><span class="fs-scope__title"'
    + (o.titelAttr ? " " + o.titelAttr : "") + ">" + esc(o.titel || "") + "</span>"
    + (o.reichweite
      ? '<span class="fs-scope__reach"' + (o.reichweiteAttr ? " " + o.reichweiteAttr : "") + ">"
        + o.reichweite + "</span>"
      : "")
    + "</div>"
    + (o.hinweis ? '<p class="fs-scope__hint">' + esc(o.hinweis) + "</p>" : "")
    + '<div class="fs-scope__fields">' + (o.felder || "") + "</div>"
    + (o.fuss || "")
    + "</div>";
}

// Jeder Aufbau bekommt einen eigenen Radionamen: zwei Quellen-Editoren auf einer Seite (Karte mit
// zwei offenen Dialogen, Editorfenster mit Abschnitt UND Weg-Ebene) duerfen sich die Wahl nicht teilen.
let featureSourceScopeRadioZaehler = 0;

function renderFeatureSourceAddRow(escape, tr, wegGruppe) {
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

  // Ein Korpusfeld der Eingabezeile: Beschriftung, Marker „· vom Korpus", Bedienelement.
  // ⚠️ Der Marker hängt an `hidden` und wird gesetzt, wenn der Korpus den Wert wirklich vorgibt.
  // Ein dauerhaft sichtbarer Marker wäre eine Behauptung.
  const korpusFeldAdd = (name, klasse, beschriftung, markup) =>
    '<label class="fs-af ' + klasse + '"><span class="fs-af__l">' + escape(beschriftung)
    + '<span class="fs-af__from" data-fs-from="' + escape(name) + '" hidden> · '
    + escape(tr("sources.add.fromCorpus", "vom Korpus")) + "</span></span>" + markup + "</label>";

  // ── Die drei Reichweiten, gebaut mit dem GETEILTEN Rahmen ─────────────────────────
  // 🔴 Von weit nach eng, und in DERSELBEN Reihenfolge wie im ✎ (Owner 02.09.2026): die
  // QUELLE (Adresse, Titel) — der KORPUS — DIESES OBJEKT. „Nur an diesem Objekt" steht unten,
  // damit man den Korpuswert sieht, bevor man davon abweicht.
  const rahmenQuelle = avesmapsSourceScopeFrame({
    escape,
    titel: tr("sources.scope.source", "Gilt für alle Objekte, die diese Quelle zitieren"),
    reichweite: escape(tr("sources.add.scopeNew", "— noch kein Objekt")),
    // 🔴 DIE ANLEITUNG STEHT DRIN, NICHT IN DER AUFSCHRIFT (Owner 02.09.2026, Wortlaut). Als
    // Rahmenname belegte sie den Platz der Reichweite, und die beiden Formulare hießen dann an
    // derselben Stelle verschieden — genau das, was dieser Umbau beseitigt.
    // 🔴 KURZ, weil sie in einem 400px-Panel steht (Owner 03.09.2026: „ist zu lang und bricht
    // leider um"). Der Vorgänger nannte zusätzlich die automatische Korpuserkennung — die sagt
    // der Rahmen darunter mit seinem eigenen Namen und seiner Reichweite ohnehin.
    hinweis: tr("sources.add.pasteHint", "Hier Adresse (URL) zur Quelle einfügen"),
    felder:
      // Adresse — das einzige Feld, das ein Editor im Normalfall wirklich tippt.
      // 💣 Der Platzhalter nennt die GENAUE SEITE und warnt vor der Startseite: live zeigen
      // vier Katalogzeilen auf `wiki.punin.de/`, und eine (`liebliches-feld.net`) auf eine
      // beliebige Bilddatei — für 31 der 32 Objekte, an denen sie hängt, ist das die falsche.
      '<label class="fs-af fs-url"><span class="fs-af__l">'
      + escape(tr("sources.add.urlLabel", "Adresse — die genaue Seite")) + "</span>"
      + '<span class="fs-url__zeile"><span class="fs-url__feld">'
      + '<input type="text" class="fs-add-url" inputmode="url" spellcheck="false" placeholder="'
      + escape(tr("sources.add.urlPlaceholder",
        "https://… — die Seite über DIESES Objekt, nicht die Startseite")) + '">'
      // ⭐ DER GRÜNE HAKEN, und er sitzt IM Feld. Als Geschwister der Beschriftung landete er im
      // Umbruch der Flex-Zeile und schob den Titel eine Zeile tiefer — im Bild gesehen, von
      // keinem Test. 🔴 Er ist NICHT dasselbe wie der Prüfknopf: der sagt „ich habe
      // nachgesehen", der Haken sagt „es wurde etwas gelesen". ⚠️ `aria-hidden`, weil der Satz
      // darunter (`data-fs-note`, `role=status`) es bereits in Worten sagt.
      + '<span class="fs-url__ok" data-fs-ok hidden aria-hidden="true">✓</span></span>'
      // Der Prüfknopf. 🔴 Er ist der Grund, warum das Formular NIE auf einen fremden Server
      // wartet: der Abruf ist ein Handgriff, kein Nebeneffekt des Tippens. Einfügen und Enter
      // lösen ihn ebenfalls aus.
      // 💣 DREI Zustände, nicht zwei: „erreichbar, aber nichts zu lesen" ist weder Erfolg
      // noch Fehlschlag. Wäre es rot, suchte der Editor einen Fehler am Link, den es nicht gibt.
      + '<button type="button" class="fs-add-check fs-url__neu" data-fs-check title="'
      + escape(tr("sources.add.checkHint", "Adresse prüfen und Titel übernehmen")) + '" aria-label="'
      + escape(tr("sources.add.checkHint", "Adresse prüfen und Titel übernehmen")) + '">⟳</button>'
      + "</span></label>"
      + '<label class="fs-af fs-af--grow"><span class="fs-af__l">'
      + escape(tr("sources.add.labelLabel", "Titel — wie diese Seite heißt")) + "</span>"
      + '<input type="text" class="fs-add-label" placeholder="'
      + escape(tr("sources.add.label", "Quellenname")) + '"></label>'
      // 🔴 „KEIN KORPUS VERWENDEN" (Owner 02.09.2026), Vorgabe AUS. Angehakt entsteht für
      // diese Quelle kein Korpus, und der Korpusrahmen verschwindet — Art, Lizenz und Nennung
      // bleiben aber stehen (im Rahmen darunter): verschwänden sie mit, hätte eine korpuslose
      // Quelle GAR KEINE Lizenz, und die ist das rechtlich Tragende.
      + '<label class="fs-af fs-af--w fs-check"><input type="checkbox" data-fs-no-corpus> '
      + escape(tr("sources.add.noCorpus", "Kein Korpus verwenden"))
      + '<span class="fs-af__meta"> — '
      + escape(tr("sources.add.noCorpusHint", "diese Quelle steht für sich")) + "</span></label>",
  });

  // 🔴 DER KORPUSRAHMEN STEHT IMMER (außer bei „Kein Korpus verwenden"). Er war einen Tag
  // lang `hidden`, bis eine Adresse einen Korpus ergab — und hat dabei Art, Lizenz und
  // Namensnennung mitversteckt, die mit dem Korpus nichts zu tun haben: die leere Maske konnte
  // danach WENIGER als vor dem Umbau, und der Owner meldete „wieso habe ich jetzt wieder das alte
  // Eingabeformular".
  // 💣 DIE AUFSCHRIFT TRÄGT DIE REICHWEITE. „Gilt für den ganzen Korpus" ohne Größe ist
  // keine Warnung — dieselbe Regel wie im ✎. Drei Zustände, siehe `uebernehmeKorpus`.
  // ⚠️ DIE FORM STEHT HIER NICHT (Owner 02.09.2026: „zieh die form ins ✎"). Sie wird EINMAL je
  // Korpus entschieden, und beim ERSTEN Eintrag eines Wirts kann man sie ohnehin nicht wissen:
  // bei einer einzigen Zeile sagt das Verhältnis Titel/Zeilen nichts.
  const rahmenKorpus = avesmapsSourceScopeFrame({
    escape,
    attr: "data-fs-korpus-gruppe",
    // 🔴 DER WIRTSNAME GEHÖRT IN DEN TITEL, in BEIDEN Formularen. Bis zum 03.09.2026 stand er
    // hier in der REICHWEITE („AlberniaWiki“ — 39 Quellen · 50 Objekte) und im ✎ im Titel — also
    // einmal als fett-braune Versalzeile und einmal als gedämpftes Beiwort, für dasselbe Ding.
    // Gefunden hat das der Prüfagent, nicht der Blick: im Einzelbild sieht jede Seite für sich
    // richtig aus.
    // ⚠️ Der Anfangstext nennt noch keinen Wirt — den verrät erst die Adresse; `uebernehmeKorpus`
    // schreibt ihn nach.
    titelAttr: "data-fs-korpus-titel",
    titel: tr("sources.add.corpusGroup", "Gilt für den ganzen Korpus"),
    // ⚠️ Der Anfangstext steht IM MARKUP, nicht in einem Aufruf danach: `uebernehmeKorpus(null)`
    // läuft beim Zurücksetzen, aber nicht zwangsläufig nach dem ersten Zeichnen — und ein leerer
    // Zusatz läse sich als „gilt für alle" ohne jede Einschränkung.
    reichweiteAttr: "data-fs-korpus-scope",
    reichweite: "— " + escape(tr("sources.add.corpusScopeNone", "welcher, sagt die Adresse")),
    felder:
      '<label class="fs-af fs-af--korpus"><span class="fs-af__l">'
      + escape(tr("sources.add.corpusLabel", "Name des Korpus"))
      + '<span class="fs-af__meta" data-fs-corpus-meta></span></span>'
      + '<input type="text" class="fs-add-corpus" data-fs-corpus placeholder="'
      + escape(tr("sources.add.corpusPlaceholder", "aus der Adresse")) + '"></label>'
      // Instruction 5a: das Formular muss SAGEN, welcher Fall eingetreten ist — sonst weiß ein
      // Editor nicht, ob er die bestehende Quelle zitiert oder eine Dublette angelegt hat.
      + '<span class="fs-add-picked" data-fs-picked hidden>'
      + escape(tr("sources.add.picked", "bestehende Quelle"))
      + '<button type="button" class="fs-add-picked__x" data-fs-unpick aria-label="'
      + escape(tr("sources.add.unpick", "Auswahl aufheben")) + '">✕</button></span>'
      + korpusFeldAdd("type", "fs-af--art", tr("sources.add.typeLabel", "Quellenart"),
        '<select class="fs-add-type">' + options + "</select>")
      + korpusFeldAdd("license", "fs-af--license", tr("sources.add.licenseLabel", "Lizenz"),
        '<select class="fs-add-license" title="'
        + escape(tr("sources.add.licenseHint",
          "Unter welcher Lizenz steht die Quelle? Leer heißt „nicht erfasst“, nicht „keine Lizenz“."))
        + '">' + licenseOptions + "</select>")
      + korpusFeldAdd("attribution", "fs-af--grow",
        tr("sources.add.attributionLabel", "Namensnennung bzw. mit freundlicher Genehmigung von"),
        '<input type="text" class="fs-add-attribution" placeholder="'
        + escape(tr("sources.add.attribution", "Namensnennung")) + '" title="'
        + escape(tr("sources.add.attributionHint",
          "Wen die Lizenz zu nennen verlangt, z. B. „VolkoV / garetien.de“.")) + '">')
      // 🔴 `offiziell` ist NICHT mehr überschreibbar (Owner 02.09.2026: „offiziell braucht
      // nicht überschrieben werden") — es hat deshalb kein Abweichungsfeld im Rahmen darunter.
      + '<label class="fs-af fs-af--w fs-check fs-add-official-label">'
      + '<input type="checkbox" class="fs-add-official"> '
      + escape(tr("sources.add.official", "offiziell"))
      + '<span class="fs-af__from" data-fs-from="official" hidden> · '
      + escape(tr("sources.add.fromCorpus", "vom Korpus")) + "</span></label>",
  });

  // 🔴 „NUR AN DIESEM OBJEKT" — Seiten und Abdeckung, dazu die Abweichungen (Owner
  // 02.09.2026: „eigentlich braucht es die häkchen nicht NUR felder").
  // ⚠️ `data-fs-meins` markiert die zwei Felder, die NUR an dieser Fundstelle gelten. Bei einer
  // bekannten Seite sind sie das Einzige, was noch zu füllen ist — dann werden sie hervorgehoben.
  // 🔴 DER VERTEILER (Entwurf docs/superpowers/specs/2026-09-03-quellen-wege-design.md §3.2): ein Weg
  // liegt in Abschnitten, und die Quelle haengt am Abschnitt. Am ABSCHNITT (nicht fest) fragt der
  // Rahmen „An diesem Weg" mit der Wahl „alle N Abschnitte dieses Weges" (Vorgabe) / „nur dieser
  // Abschnitt"; auf der WEG-EBENE (fest) sagt der Titel „An allen N Abschnitten dieses Weges" und es
  // gibt nichts zu waehlen. Ein einteiliger Weg (N = 1) und jede andere Objektart sehen den Rahmen
  // wie bisher: „Nur an diesem Objekt".
  // ⚠️ Die Wahl steht VOR Seite(n) und Abdeckung: sie sagt, WOHIN die zwei gelten.
  const gruppe = wegGruppe && Number(wegGruppe.anzahl) > 1 ? wegGruppe : null;
  const anzahl = gruppe ? String(Number(gruppe.anzahl)) : "";
  const radioName = gruppe && !gruppe.fest ? "fs-scope-" + (++featureSourceScopeRadioZaehler) : "";
  const wahlAbschnitte = gruppe && !gruppe.fest
    ? '<div class="fs-scope__choice" data-fs-scope-choice>'
      + '<label><input type="radio" name="' + radioName + '" value="alle" checked> '
      + escape(tr("sources.scope.allSegments", "alle {n} Abschnitte dieses Weges").replace("{n}", anzahl)) + "</label>"
      + '<label><input type="radio" name="' + radioName + '" value="einer"> '
      + escape(tr("sources.scope.oneSegment", "nur dieser Abschnitt")) + "</label>"
      + "</div>"
    : "";
  const rahmenObjekt = avesmapsSourceScopeFrame({
    escape,
    titel: !gruppe
      ? tr("sources.scope.link", "Nur an diesem Objekt")
      : (gruppe.fest
        ? tr("sources.scope.wayAll", "An allen {n} Abschnitten dieses Weges").replace("{n}", anzahl)
        : tr("sources.scope.way", "An diesem Weg")),
    felder:
      wahlAbschnitte
      + '<label class="fs-af fs-af--pages" data-fs-meins><span class="fs-af__l">'
      + escape(tr("sources.add.pages", "Seite(n)")) + "</span>"
      + '<input type="text" class="fs-add-pages" placeholder="'
      + escape(tr("sources.add.pagesHint", "optional")) + '"></label>'
      + '<label class="fs-af fs-af--kind" data-fs-meins><span class="fs-af__l">'
      + escape(tr("sources.add.kindLabel", "Abdeckung")) + "</span>"
      + '<select class="fs-add-kind" title="'
      + escape(tr("sources.add.kind",
        "Abdeckung: Ausführlich/Ergänzend → Offiziell-Tab, Erwähnung → Erwähnt-Tab, sonst normale Quellenzeile"))
      + '">' + kindOptions + "</select></label>"
      + featureSourceAbweichungsBlock(escape, tr, {}),
  });

  return (
    '<div class="fs-row fs-row--add" data-fs-add>'
    + rahmenQuelle + rahmenKorpus + rahmenObjekt
    // 🔴 SPEICHERN / ABBRECHEN, in BEIDEN Formularen gleich (Owner 02.09.2026: „Der button
    // soll auch nicht verknüpfen sondern Speichern heißen"). Was gerade passiert ist — angelegt
    // oder verknüpft —, steht in der Rückmeldung darunter, nicht auf dem Knopf.
    // ⚠️ `--radius-md`, keine Pille: die Designsprache verbietet sie in zwei Zeilen, und live
    // standen acht `999px` in dieser einen Datei.
    + '<div class="fs-actions">'
    + '<button type="button" class="fs-actions__prim" data-fs-add-submit>'
    + escape(tr("sources.add.submit", "Speichern")) + "</button>"
    + '<button type="button" class="fs-actions__sek" data-fs-add-cancel>'
    + escape(tr("sources.add.cancel", "Abbrechen")) + "</button>"
    + "</div>"
    + "</div>"
  );
}

/**
 * Die Meldezeile der Eingabezeile -- Platz fuer Absage UND Bestaetigung („Hinzugefuegt: „X“.“). Ohne
 * sie verschluckte der Knopf den Klick wortlos, sobald die URL fehlte -- der haeufigste Fall beim
 * Anlegen.
 *
 * 🔴 SIE STEHT AUSSERHALB DER FALTE. Die Falte „Neue Quelle einfuegen“ ist nach jedem Eintrag wieder
 * ZU (Owner 03.09.2026: „klapptext zu beim öffnen und nach dem eintrag“); stuende die Meldung darin,
 * verschwaende die Bestaetigung genau in dem Moment, in dem sie gebraucht wird -- und der Owner
 * saehe wieder nur eine geleerte Maske (dieselbe Meldung wie am 03.09.2026 frueh, 625c20f84).
 */
function renderFeatureSourceAddNote() {
  return '<p class="fs-add-note" data-fs-note hidden></p>';
}

/**
 * Die Falte um Hinweis und Eingabeformular: „Neue Quelle einfuegen“.
 *
 * 🔴 NATIV `<details>/<summary>`, dieselbe Bauform und dieselbe Rezeptur wie „n weitere Quellen“
 * (.fs-more): Strg+F findet den Text auch zugeklappt, Fokus und Tastatur kommen vom Element.
 * 🔴 IMMER ZU -- beim Oeffnen des Kastens wie nach jedem Eintrag (Owner 03.09.2026: „immer mit
 * klappe zu“). Das Bauteil zeichnet nach jedem Schreibvorgang aus der Serverantwort neu, und dieser
 * Bauer setzt nie `open`: damit ist „zu nach dem Eintrag“ keine zweite Regel, sondern dieselbe.
 * Wer je einen Zustand dafuer einfuehrt, baut den Modulzustand, an dem Anzeige-Menue und
 * Ansichts-Kacheln schon gescheitert sind (AGENTS.md §11).
 * ⚠️ Der Hinweistext liegt MIT in der Falte: er erklaert das Eintragen, nicht die Liste.
 * 💣 EIN Bauteil, neun Montagestellen: die Falte liegt HIER, im geteilten Bauer -- Territoriumseditor,
 * Ortseditor, Sync-Monitor und die Kartendialoge haben sie damit ohne eine Zeile bei sich.
 */
// 🔴 Die EINE Ausnahme von „immer zu": solange Quellen aus einer MELDUNG warten (`meldung.offen`, Entwurf
// 2026-09-03-quellen-meldeformular §5.4), steht die Falte offen, und ueber dem Formular sagt eine Zeile,
// die wievielte gemeldete Quelle gerade darin steht. `open` kommt aus genau diesem Zustand, nie aus einem
// zweiten Merker; nach der letzten Quelle zeichnet das Bauteil wie immer aus der Antwort neu -- zu.
function renderFeatureSourceAddFold(hint, addRow, escape, tr, meldung) {
  const offen = Boolean(meldung && meldung.offen === true);
  const zeile = meldung && meldung.zeile ? String(meldung.zeile) : "";
  return '<details class="fs-add-fold"' + (offen ? " open" : "") + '>'
    + '<summary class="fs-add-fold__toggle">' + escape(tr("sources.add.fold", "Neue Quelle einfügen")) + '</summary>'
    + '<div class="fs-add-fold__body">' + hint + zeile + addRow + '</div>'
    + '</details>';
}

/**
 * Die Warteschlangen-Zeile ueber dem Formular: welche gemeldete Quelle steht darin, und was der Server
 * ueber sie weiss (Vorbelegung, api/_internal/app/report-sources.php). Rein, ohne DOM.
 *
 * @param {object} quelle    { url, source_id, label, license, attribution, vorbelegung: { state, corpus, existing } }
 * @param {boolean} vorschau  in der Review-Karte (schreibgeschuetzt) statt im Annahme-Dialog
 */
function featureSourceMeldungZeile(quelle, nummer, gesamt, tr, escape, vorschau) {
  const q = quelle || {};
  const v = q.vorbelegung || {};
  const korpus = v.corpus || null;
  const korpusName = korpus ? String(korpus.label || korpus.corpus_key || "") : "";
  let stand;
  if (v.state === "bekannt") {
    stand = tr("sources.meldung.bekannt", "steht schon im Katalog — wird verknüpft");
  } else if (v.state === "katalog") {
    stand = tr("sources.meldung.katalog", "aus dem Katalog gewählt — wird verknüpft");
  } else if (v.state === "neu" && korpus && korpus.known === true) {
    stand = tr("sources.meldung.neuBekannterKorpus", "neue Seite, bekannter Korpus „{korpus}“").replace("{korpus}", korpusName);
  } else if (v.state === "neu") {
    stand = tr("sources.meldung.neuerWirt", "unbekannter Wirt {wirt} — ein neuer Korpus, wenn du ihn anlegst").replace("{wirt}", korpusName);
  } else {
    stand = tr("sources.meldung.ohneLink", "ohne Adresse (Altform) — nicht verknüpfbar");
  }
  const angebote = [];
  if (String(q.label || "").trim() !== "" && v.state !== "bekannt" && v.state !== "katalog") angebote.push(tr("sources.meldung.angebotTitel", "Titel"));
  if (String(q.license || "").trim() !== "") angebote.push(tr("sources.meldung.angebotLizenz", "Lizenz"));
  if (String(q.attribution || "").trim() !== "") angebote.push(tr("sources.meldung.angebotNennung", "Namensnennung"));
  const zusatz = angebote.length ? " · " + tr("sources.meldung.vomMelder", "{was} vom Melder").replace("{was}", angebote.join(", ")) : "";
  const kopf = vorschau
    ? tr("sources.meldung.vorschauKopf", "Quelle {n} von {gesamt}").replace("{n}", String(nummer)).replace("{gesamt}", String(gesamt))
    : tr("sources.meldung.kopf", "Aus der Meldung: Quelle {n} von {gesamt}").replace("{n}", String(nummer)).replace("{gesamt}", String(gesamt));
  const schluss = vorschau ? "" : " — " + tr("sources.meldung.tun", "prüfen, ergänzen, Speichern");
  return '<p class="fs-add-queue"><b>' + escape(kopf) + '</b> · ' + escape(stand + zusatz + schluss) + '</p>';
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
  const addRow = renderFeatureSourceAddRow(escape, tr, options.wegGruppe);

  // Die Anleitung ueber der Quellenliste, auf allen acht Montageflaechen. Sie ist als HTML
  // eingesetzt statt maskiert: der Text darf Hervorhebungen tragen und ist Entwickler-/i18n-Text,
  // nie Benutzereingabe.
  //
  // 🪤 NEU GESCHRIEBEN AM 03.09.2026 (Owner-Wortlaut), weil der alte Text den Umbau nicht
  // ueberlebt hat. Er sagte drei Dinge, von denen zwei falsch geworden waren:
  //   „Tragt … den Veröffentlichungstitel ein"  -- den holt jetzt ⟳ aus der Seite, und bei einer
  //     BELEGSTELLE sieht der Besucher ohnehin den Korpusnamen, nicht den Titel.
  //   „Achtet darauf, ob es eine offizielle Quelle ist" -- `offiziell` gehoert seit dem 02.09.2026
  //     dem KORPUS. Wer dort „aufpasst", aendert es fuer JEDE Quelle des Wirts.
  // 💣 Eine Anleitung, die dem Formular widerspricht, ist schlimmer als keine: sie verlangt
  // Handgriffe, die es nicht mehr gibt, und laesst die weite Wirkung eines Korpusfeldes wie eine
  // Kleinigkeit aussehen. Genau davor sollte sie warnen.
  //
  // ⚠️ „sofern wir ihn listen" ist bewusst so knapp: bei der ART trifft es alle acht Korpora, bei
  // der LIZENZ vier von acht, bei der NAMENSNENNUNG keines (live gemessen 03.09.2026). Den genauen
  // Stand sagt das Formular selbst -- der Marker „· vom Korpus" erscheint nur, wo der Korpus den
  // Wert wirklich vorgibt.
  const hint = '<div class="fs-hint">' + tr("sources.hint",
    "Tragt immer den direkten Link (z. B. zu einem Wiki-Artikel) ein — Titel und Korpus werden "
    + "daraus automatisch erkannt. Art, Lizenz und Namensnennung kommen vom Korpus, sofern wir ihn "
    + "listen. Änderungen am Korpus wirken sich auf alle Quellen aus, die auf ihn verweisen "
    + "(z. B. wenn der Wiki-Name geändert wird).") + "</div>";
  // Reihenfolge: Wiki-Zeile, Listen, dann die Falte mit Hinweis und Formular, dann die Meldezeile
  // (ausserhalb der Falte, siehe renderFeatureSourceAddNote). Quellen stehen ueberall UNTEN, und das
  // Eintragen steht unter den Quellen.
  return '<div class="fs-editor">' + wikiRow + pendingGroup + wikiAutoGroup + sourceRows
    + renderFeatureSourceAddFold(hint, addRow, escape, tr, options.meldung || null) + renderFeatureSourceAddNote() + "</div>";
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
  // 🪤 UMFORMULIERT am 03.09.2026 (Owner am Livelauf): der Satz stand ALLEIN da, nachdem die
  // Zeile bereits angelegt und das Formular geleert war — und las sich dadurch wie ein Einwand
  // gegen eine leere Maske, nicht wie das Ergebnis. „schön wärs gewesen ‚Erfolgreich
  // hinzugefügt‘ zu lesen."
  // 🔴 Er ist deshalb ein ZUSATZ, kein eigener Satz: `zeigeErgebnis` stellt IMMER die Erfolgs-
  // meldung voran und hängt diesen Halbsatz nur an, wenn wirklich verknüpft wurde.
  let text = linked.typed_label
    // Der eingetippte Titel wurde verworfen -- der Fall, der ohne Erklaerung wie ein Fehler
    // aussieht: man tippt „X" und in der Liste steht „Y".
    ? uebersetze("sources.add.linkedRenamed",
      "Die Adresse stand schon im Katalog — verknüpft statt neu angelegt. Dein Titel „{typed}“ wurde nicht übernommen, denn der Katalog führt sie unter „{label}“.")
      .replace("{label}", String(linked.label || "")).replace("{typed}", String(linked.typed_label))
    : uebersetze("sources.add.linked",
      "Die Adresse stand schon im Katalog — verknüpft statt neu angelegt.");
  if (linked.official_changed) {
    // 💣 Der Haken hat den Katalogwert umgelegt, und das gilt ueberall, wo die Quelle steht.
    text += " " + uebersetze("sources.add.linkedOfficial",
      "Achtung: „offiziell“ steht jetzt auf {wert} — das gilt überall, wo diese Quelle steht.")
      .replace("{wert}", linked.official_now
        ? uebersetze("sources.add.officialYes", "ja")
        : uebersetze("sources.add.officialNo", "nein"));
  }
  if (linked.official_refused) {
    // Der Haken war gesetzt, die Zeile pflegt aber der Wiki-Abgleich -- nicht uebernommen, gesagt.
    text += " " + uebersetze("sources.add.linkedOfficialRefused",
      "„offiziell“ pflegt bei dieser Quelle der Wiki-Abgleich — dein Häkchen wurde nicht übernommen.");
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
 * @returns {{zustand:string, meldung:string, titel:string, titelGewinnt:boolean}}
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
        "Diese Seite steht schon im Katalog als „{label}“ — sie wird verknüpft. Stimmt etwas daran nicht, ändere es hier: die Korrektur geht an den Katalogeintrag.")
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
      meldung: uebersetze("sources.add.checkReachable",
        "Erreichbar, aber auf der Seite war kein Titel zu finden — trag ihn selbst ein."),
    };
  }

  const status = Number(daten.http_status) || 0;
  return {
    zustand: "unerreichbar",
    titel: "",
    titelGewinnt: false,
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
    const istHaken = el.type === "checkbox";
    const wert = istHaken ? (el.checked ? "1" : "0") : String(el.value || "");
    if (wert !== orig) {
      // 🔴 EIN HAEKCHEN REIST ALS BOOLEAN, und die Regel haengt an der ART des Bedienelements,
      // nicht an seinem NAMEN. Bis zum 03.09.2026 stand hier `name === "is_official"` -- eine
      // Liste mit genau einem Eintrag. Mit `corpus_is_official` und `no_corpus` waeren es drei
      // gewesen, und die naechste Kachel die vierte: genau die Bauform, an der in diesem Haus
      // schon die Verkehrsmittel-Sperre und der Korpus-Erzeuger gescheitert sind.
      felder[name] = istHaken ? wert === "1" : wert;
    }
  });
  return felder;
}

/**
 * Sieht eine Zeichenkette nach einer Web-Adresse aus?
 *
 * 🔴 NUR `http`/`https`. Der Katalog verlangt eine anklickbare Quelle; `ftp:` oder `javascript:`
 * gehören dort nicht hin, und die zweite Form wäre in einer Infobox, die den Wert als Link
 * ausgibt, ein offenes Scheunentor.
 * 💣 KEIN `new URL()` ALLEIN. Der Konstruktor nimmt „https://" ohne Wirt klaglos an (Host leer)
 * und lehnt umgekehrt nichts ab, was ein Mensch als halbe Eingabe erkennt. Geprüft wird deshalb
 * zusätzlich, dass ein Wirt mit einem Punkt darin dasteht.
 * ⚠️ Absichtlich GROSSZÜGIG: sie soll Tippfehler auffangen, nicht ungewöhnliche Adressen
 * verhindern. Eine Validierung, die eine gültige Quelle ablehnt, kostet mehr als sie spart.
 */
function featureSourceUrlLooksValid(wert) {
  const roh = String(wert == null ? "" : wert).trim();
  if (roh === "") {
    return false;
  }
  try {
    const adresse = new URL(roh);
    if (adresse.protocol !== "http:" && adresse.protocol !== "https:") {
      return false;
    }
    return adresse.hostname.indexOf(".") > 0;
  } catch (e) {
    return false;
  }
}

/**
 * Welche korpuseigenen Felder hat der Editor dieser Zeile zugeschlagen — und hat er das GEÄNDERT?
 *
 * 🔴 DIE VOLLE MENGE, kein Delta. Ein Delta liesse offen, ob ein fehlender Name „unverändert" oder
 * „zurückgegeben" heisst; der Server schreibt `own_fields` als Ganzes.
 * 💣 Und `geaendert` ist eine EIGENE Frage: ohne sie schickte jedes Speichern `own_fields` mit, und
 * ein alter, zwischengespeicherter Client ohne diese Häkchen schriebe die Abweichungen still weg.
 * Dieselbe Regel wie bei `source_type_chosen` (29.08.2026): „da steht ein Wert" heisst nie
 * „ein Mensch hat ihn gewählt".
 * 🔴 GELESEN WIRD DER WERT, NICHT EIN HÄKCHEN (Owner 02.09.2026: „eigentlich braucht es
 * die häkchen nicht NUR felder"). Ein gefülltes Abweichungsfeld IST die Abweichung; damit gibt
 * es keinen zweiten Zustand daneben, der auseinanderlaufen könnte (angehakt, aber leer).
 * ⚠️ Gesperrte Felder zählen nicht mit -- sie tragen den Bestand, nicht eine Wahl.
 */
function featureSourceOwnFieldsFromPanel(panel) {
  const liste = [];
  let geaendert = false;
  if (!panel || typeof panel.querySelectorAll !== "function") {
    return { liste, geaendert };
  }
  Array.prototype.forEach.call(panel.querySelectorAll("[data-fs-abw-wert]"), (el) => {
    if (el.disabled) {
      return;
    }
    const name = el.getAttribute("data-fs-abw-wert");
    const jetzt = String(el.value || "").trim();
    if (jetzt !== "") {
      liste.push(name);
    }
    // ⚠️ Verglichen wird gegen den Stand, mit dem das Feld GEZEICHNET wurde — nicht gegen
    // „leer". Im ✎ kommt eine bestehende Abweichung gefuellt heraus, und ohne diesen Vergleich
    // meldete jedes Oeffnen des Kastens eine Änderung.
    if (jetzt !== String(el.getAttribute("data-fs-abw-orig") || "")) {
      geaendert = true;
    }
  });
  return { liste, geaendert };
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

  // 🔴 DER VERTEILER: `opts.gruppe = { publicIds: () => string[], fest: boolean }`. Die Kennungen
  // werden bei JEDER Anfrage gelesen (der Editor wechselt den Abschnitt, ohne neu zu montieren).
  // Am Abschnitt (nicht fest) verteilt NUR das Eintragen -- `add`/`add_existing` --, und nur bei
  // der Wahl „alle" in der Eingabezeile; ✕ und ✎ gelten dem Abschnitt, denn die Wahl steht in einer
  // zugeklappten Falte, und ein Loeschen an einer unsichtbaren Auswahl ist eine Falle. Auf der
  // Weg-Ebene (fest) traegt jede Anfrage die Liste -- dort IST der Weg das Objekt.
  const gruppe = opts && opts.gruppe && typeof opts.gruppe.publicIds === "function" ? opts.gruppe : null;
  const escapeFn = (opts && opts.escape) || featureSourceDefaultEscape;

  // 🔴 DIE WARTESCHLANGE DER MELDUNG (Entwurf 2026-09-03-quellen-meldeformular §5.3, §5.4, §6.1): `opts.meldung =
  // { quellen: [...], vorschau?: bool, nummer?, gesamt? }`. Jede gemeldete Quelle steht -- eine nach der anderen --
  // in DIESER Eingabezeile, vorausgefuellt aus der Vorbelegung des Servers, und wird mit dem normalen
  // „Speichern" angelegt oder verknuepft; „Ueberspringen" nimmt sie nicht. Nichts wird mehr still aus dem
  // Meldeformular in den Katalog geschrieben (Owner 03.09.2026: „da wollen wir natuerlich alle felder und das
  // ganz normale formular sehen"). Ein Formular nacheinander, kein zweiter Bauer fuer n Formulare.
  // `vorschau`: dieselbe Zeile schreibgeschuetzt (Review-Karte, mountFeatureSourceMeldungVorschau).
  const meldung = opts && opts.meldung && Array.isArray(opts.meldung.quellen) && opts.meldung.quellen.length
    ? { quellen: opts.meldung.quellen.slice(), index: 0, vorschau: opts.meldung.vorschau === true,
        nummer: Number(opts.meldung.nummer) || 0, gesamt: Number(opts.meldung.gesamt) || 0 }
    : null;
  function meldungAktuell() {
    return meldung && meldung.index < meldung.quellen.length ? meldung.quellen[meldung.index] : null;
  }
  function meldungRenderOptionen() {
    const q = meldungAktuell();
    if (!q) {
      return null;
    }
    return { offen: true, zeile: featureSourceMeldungZeile(q, meldung.nummer || (meldung.index + 1), meldung.gesamt || meldung.quellen.length, tr, escapeFn, meldung.vorschau) };
  }
  function gruppenKennungen() {
    if (!gruppe) {
      return [];
    }
    const ids = [];
    for (const id of gruppe.publicIds() || []) {
      const s = String(id || "").trim();
      if (s && !ids.includes(s)) {
        ids.push(s);
      }
    }
    return ids;
  }
  function verteilteKennungen(action) {
    const ids = gruppenKennungen();
    if (ids.length < 2) {
      return null;
    }
    if (gruppe.fest === true) {
      return ids;
    }
    if (action !== "add" && action !== "add_existing") {
      return null;
    }
    const wahl = containerEl.querySelector("[data-fs-scope-choice] input:checked");
    return wahl && wahl.value === "einer" ? null : ids;
  }
  function wegGruppeFuerRender() {
    if (!gruppe) {
      return null;
    }
    return { anzahl: gruppenKennungen().length, fest: gruppe.fest === true };
  }

  // Sagt, warum ein Klick nicht zum Ziel führte. textContent, nicht innerHTML: die Meldung zitiert
  // den eingetippten Quellennamen, also Nutzereingabe.
  /**
   * @param {string} art  "ok" grün · "bad" rot · sonst die bernsteinfarbene Absage
   *
   * 💣 DIE FARBE MUSS BEI JEDER MELDUNG NEU GESETZT WERDEN. Ohne das Zurücksetzen erbt die
   * nächste Meldung die Farbe der vorigen -- und am 02.09.2026 stand „Diese Quelle haengt nicht
   * an diesem Objekt." in GRÜN, weil davor eine Erfolgsmeldung dort gestanden hatte. Eine
   * Fehlermeldung in Grün ist schlimmer als gar keine: sie liest sich wie eine Bestätigung.
   */
  function showAddRowNote(message, art) {
    const note = containerEl.querySelector("[data-fs-note]");
    if (note) {
      note.textContent = message;
      note.hidden = false;
      // ⚠️ Nur wenn der Knoten eine `classList` hat: die Meldung ist die Hauptsache, die Farbe
      // die Zugabe. Eine Dokument-Attrappe ohne `classList` (so eine steht in
      // quellen-art-korrigieren.test.js) darf daran nicht sterben und den TEXT mitreissen.
      if (note.classList) {
        note.classList.remove("fs-add-note--ok", "fs-add-note--bad");
        if (art === "ok" || art === "bad") {
          note.classList.add("fs-add-note--" + art);
        }
      }
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

  // Render + Verdrahtung + Vorbelegung aus der Meldung -- EIN Zeichner fuer die Serverantwort, das Ueberspringen
  // und das Weiterruecken nach dem Speichern. ⚠️ In der Vorschau wird NICHT verdrahtet: die Review-Karte wird
  // beim 45-s-Poll neu gebaut, und jede angehaengte Vorschlagsliste bliebe als Waise am Dokument.
  function zeichneNeu(data) {
    containerEl.innerHTML = renderFeatureSourceEditorHtml(data, Object.assign({}, opts || {}, { wegGruppe: wegGruppeFuerRender(), meldung: meldungRenderOptionen() }));
    if (!(meldung && meldung.vorschau)) {
      wireAutocomplete();
      wireAdressPruefung();
    }
    fuelleAusMeldung();
  }

  /**
   * Die gemeldete Quelle in die Eingabezeile -- ueber DIESELBEN Wege wie nach dem Einfuegen einer Adresse
   * (uebernehmeAuskunft / uebernehmeKorpus), plus die Angebote des Melders in leere Felder (Rangfolge
   * Katalog > Korpus > Melder, Entwurf §5.2). In der Vorschau danach alles gesperrt.
   */
  function fuelleAusMeldung() {
    const q = meldungAktuell();
    if (!q) {
      return;
    }
    const v = q.vorbelegung || {};
    const setze = (selektor, wert) => {
      const el = containerEl.querySelector(selektor);
      if (el && wert !== undefined && wert !== null) {
        el.value = String(wert);
      }
    };
    setze(".fs-add-url", String(v.url || q.url || ""));
    if (v.state === "katalog" && v.existing) {
      // Der Katalogtreffer des Melders ist ein Pick aus der Vorschlagsliste: verknuepft per Kennung.
      pickedSourceId = Number(v.existing.source_id) || 0;
      setze(".fs-add-label", String(v.existing.label || q.label || ""));
      const badge = containerEl.querySelector("[data-fs-picked]");
      if (badge) {
        badge.hidden = false;
      }
      uebernehmeKorpus(v.corpus || null);
    } else if (v.state === "bekannt") {
      uebernehmeAuskunft(v);
    } else {
      // Neue Adresse (oder Altform): der Korpus sagt, was er weiss; der Titel kommt vom Melder oder spaeter von der Seite.
      uebernehmeKorpus(v.corpus || null);
      setzeAdressZustand(null, "");
    }
    fuelleMelderAngebote(q, v);
    zeigeAdressForm();
    const abbrechen = containerEl.querySelector("[data-fs-add-cancel]");
    if (abbrechen) {
      abbrechen.textContent = tr("sources.meldung.skip", "Überspringen");
    }
    if (meldung.vorschau) {
      containerEl.querySelectorAll("[data-fs-add] input, [data-fs-add] select, [data-fs-add] button").forEach((el) => { el.disabled = true; });
      const knoepfe = containerEl.querySelector("[data-fs-add] .fs-actions");
      if (knoepfe) {
        knoepfe.hidden = true;
      }
    }
  }

  // Die Angebote des Melders: nur LEERES fuellen, mit dem Marker „vom Melder" -- ein Katalog- oder Korpuswert
  // wird nie ueberschrieben (Owner: externe Nutzer machen nichts am Korpus). 🔴 WIDERSPRICHT das Angebot einem
  // schon gefuellten Wert, steht es als Hinweis DANEBEN („Melder: CC BY-SA 4.0", Entwurf §5.2, Falle 3): der
  // Editor sieht den Wert, den der Melder meinte, und kann den Korpus korrigieren, wenn der Melder recht hat --
  // still verworfen (so stand es bis zum Befund des Pruefagenten am 03.09.2026) liest sich das Formular, als
  // haette der Melder nichts gesagt.
  function fuelleMelderAngebote(q, v) {
    const marker = (name, text) => {
      const el = containerEl.querySelector('[data-fs-from="' + name + '"]');
      if (el) {
        el.textContent = " · " + text;
        el.hidden = false;
      }
    };
    const lizenzName = (schluessel) => {
      const tabelle = featureSourceLicenseTable();
      const eintrag = tabelle && tabelle[String(schluessel || "").trim()];
      return eintrag && eintrag.label ? String(eintrag.label) : String(schluessel || "");
    };
    const fuelle = (selektor, wert, name, anzeige) => {
      const el = containerEl.querySelector(selektor);
      const w = String(wert || "").trim();
      if (!el || w === "") {
        return;
      }
      if (String(el.value || "").trim() === "") {
        el.value = w;
        if (name) {
          marker(name, tr("sources.add.fromReporter", "vom Melder"));
        }
      } else if (name && String(el.value).trim() !== w) {
        marker(name, tr("sources.meldung.melderAngebot", "Melder: {wert}").replace("{wert}", anzeige || w));
      }
    };
    if (v.state !== "bekannt" && v.state !== "katalog") {
      fuelle(".fs-add-label", q.label, null);
    }
    fuelle(".fs-add-pages", q.pages, null);
    fuelle(".fs-add-kind", q.reference_kind, null);
    fuelle(".fs-add-license", q.license, "license", lizenzName(q.license));
    fuelle(".fs-add-attribution", q.attribution, "attribution");
  }

  // Naechste gemeldete Quelle (nach Speichern oder Ueberspringen): dieselbe Antwort neu zeichnen.
  function meldungWeiter(data) {
    if (!meldung) {
      return;
    }
    meldung.index += 1;
    zeichneNeu(data && data.ok === true ? data : { ok: true, wiki_url: "", sources: letzteQuellen });
  }

  async function renderFromServer(action, extra) {
    const publicId = typeof publicIdGetter === "function" ? publicIdGetter() : publicIdGetter;
    // ⚠️ Die Wahl wird VOR der Anfrage gelesen -- danach steht die Eingabezeile neu gebaut da.
    const kennungen = verteilteKennungen(action);
    const body = Object.assign(
      { action, entity_type: entityType, entity_public_id: publicId },
      kennungen ? { entity_public_ids: kennungen } : {},
      extra || {}
    );
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
    zeichneNeu(data);
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
      syncFeatureSourcesToClientCache(entityType, publicId, data.sources, data.by_entity);
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
  // 💣 SIE GIBT DEN SATZ ZURUECK, statt ihn zu zeigen. Am 03.09.2026 stand hier ein
  // `showAddRowNote`, und `zeigeErgebnis` daneben schrieb unmittelbar danach in DIESELBE Zeile --
  // die Umtypung war damit auf dem `add`-Weg nie mehr zu sehen, obwohl beide Funktionen einzeln
  // richtig waren und beide Tests ihrer eigenen Haelfte gruen blieben. Es gibt EINE Notizzeile,
  // also braucht es EINEN, der sie schreibt.
  function umtypungsText(daten) {
    const umtyp = daten && daten.retyped;
    if (!umtyp) {
      return "";
    }
    return tr("sources.add.retyped", "Art von „{label}“ auf „{to}“ geändert (war „{from}“) — das gilt überall, wo diese Quelle steht.")
      .replace("{label}", String(umtyp.label || ""))
      .replace("{to}", featureSourceTypeLabel(umtyp.to))
      .replace("{from}", featureSourceTypeLabel(umtyp.from));
  }

  // Der Weg ueber die Vorschlagsliste (`add_existing`) meldet nur die Umtypung: dort hat der
  // Editor die bestehende Quelle ausdruecklich gewaehlt, die Kachel daneben sagt das bereits.
  function zeigeUmtypung(daten) {
    const text = umtypungsText(daten);
    if (text) {
      showAddRowNote(text);
    }
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
  function zeigeErgebnis(daten, values) {
    // ⚠️ Ohne Antwort hat der Fehlerweg schon gesprochen -- eine Erfolgsmeldung daneben waere
    // die zweite, widersprechende Auskunft.
    if (!daten) {
      return;
    }
    const linked = daten.linked || null;
    // Der Name, unter dem die Zeile jetzt in der Liste steht: beim Verknuepfen der gespeicherte,
    // sonst der eingetippte. 🔴 Genau der, den der Editor gleich sucht.
    const name = String((linked && linked.label) || (values && values.label) || "").trim();
    const kern = name !== ""
      ? tr("sources.add.added", "Hinzugefügt: „{label}“.").replace("{label}", name)
      : tr("sources.add.addedPlain", "Hinzugefügt.");
    // 🔴 ALLE Zusaetze in DIESER Reihenfolge: was geschah (Erfolg), was am geteilten Katalog
    // dabei anders wurde (Umtypung), womit verknuepft wurde. Jeder darf fehlen.
    const zusaetze = [umtypungsText(daten), featureSourceLinkedMessage(linked, tr)];
    // 🔴 GRUEN, auch beim Verknuepfen: es ist ein Erfolg, kein Einwand. Bis zum 03.09.2026 stand
    // dort nur der Verknuepfungssatz, neutral gefaerbt, nachdem das Formular schon geleert war --
    // und las sich wie eine Beschwerde ueber eine leere Maske.
    showAddRowNote([kern].concat(zusaetze.filter(Boolean)).join(" "), "ok");
  }

  // ── Die Adressauskunft ─────────────────────────────────────────────────────────────────────
  // Entwurf: docs/superpowers/specs/2026-09-01-bekannte-quellen-design.md §3.4 + §4.
  //
  // 🔴 DREI ZUSTÄNDE, und jeder heißt genau eine Sache (Owner-Entscheid 02.09.2026 zum Knopf, mit
  // dieser Korrektur): `gelesen`/`bekannt` grün · `erreichbar` neutral-warm · `unerreichbar` rot.
  // „Erreichbar, aber nichts zu lesen" ist der Fall, den ein zweifarbiger Knopf falsch erzählt.
  const ADRESS_ZUSTAENDE = ["bekannt", "gelesen", "erreichbar", "unerreichbar"];

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
    zeigeBekannteSeite(zustand === "bekannt");
    // ⭐ Der grüne Haken: „es wurde etwas gelesen". `erreichbar` bekommt ihn NICHT -- dort ist die
    // Seite zwar da, aber nichts daraus übernommen, und ein Haken darüber wäre eine Zusage.
    const haken = containerEl.querySelector("[data-fs-ok]");
    if (haken) {
      haken.hidden = !(zustand === "gelesen" || zustand === "bekannt");
    }
  }

  /**
   * Sieht das nach einer Adresse aus? — die Rückmeldung BEIM TIPPEN, vor jedem Abruf.
   *
   * 🔴 Sie sagt nur, ob die Form stimmt, nie ob es die Seite gibt: das beantwortet der Prüfknopf.
   * Ein Feld, das „ungültig" behauptet, weil ein fremder Server gerade langsam ist, wäre schlimmer
   * als keins.
   * ⚠️ LEER IST KEIN FEHLER, sondern der Anfangszustand -- ein rotes leeres Feld beim Öffnen der
   * Liste würde jeden Editor in die Irre führen. Deshalb drei Werte, nicht zwei.
   */
  function zeigeAdressForm() {
    const feld = containerEl.querySelector(".fs-add-url");
    if (!feld) {
      return;
    }
    const wert = String(feld.value || "").trim();
    // 💣 DIE KLASSE GEHOERT AN DIE HUELLE, nicht ans Eingabefeld. Der Vertrag stylt
    // `.fs-url--gut input` — am Feld selbst gesetzt trifft dieser Selektor nie, und die
    // Faerbung bliebe lautlos aus. Dieselbe Falle wie bei `.fs-af--meins`, wo eine Kurzform
    // `border` die `border-color` zurueckgesetzt hat.
    const huelle = feld.closest ? feld.closest(".fs-url") : null;
    const ziel = huelle || feld;
    ziel.classList.toggle("fs-url--gut", wert !== "" && featureSourceUrlLooksValid(wert));
    ziel.classList.toggle("fs-url--schlecht", wert !== "" && !featureSourceUrlLooksValid(wert));
  }

  /**
   * Der DRITTE Zustand sieht anders aus als die zwei davor — die Seite steht schon im Katalog.
   *
   * 🔴 DER KNOPF IST DAS LAUTESTE SIGNAL, lauter als jede Farbe: aus „Hinzufügen" wird
   * „Verknüpfen". Es entsteht keine zweite Katalogzeile (`url_hash` ist UNIQUE) -- das tat der
   * Katalog schon immer, es wurde nur nie gesagt.
   * 🔴 GESPERRT WIRD NICHTS (Owner 02.09.2026). An einer bekannten Seite stand „Briefspiel" als
   * Titel -- die kaputte Angabe, die dieser Umbau beseitigen soll -- und sie war gesperrt. Ein
   * Feld, das den Fehler ZEIGT und ihn nicht ändern lässt, ist schlimmer als eines, das ihn
   * verschweigt. Hervorgehoben wird stattdessen, was hier NEU einzutragen ist.
   * ⚠️ Über `data-fs-meins`, nicht über eine Selektorliste: die läuft beim nächsten Feld
   * auseinander, der Marker im Markup nicht.
   */
  function zeigeBekannteSeite(an) {
    // 🔴 DER KNOPF HEISST IMMER „Speichern" (Owner 02.09.2026: „Der button soll auch
    // nicht verknuepfen sondern Speichern heissen"). Was gerade passiert — anlegen oder
    // verknuepfen —, steht in der gruenen Meldung darunter (`featureSourceLinkedMessage`), und
    // die sagt es in einem ganzen Satz statt in einem Wort auf einem Knopf.
    // ⚠️ Hervorgehoben wird stattdessen, was hier NEU einzutragen ist.
    Array.prototype.forEach.call(containerEl.querySelectorAll("[data-fs-meins]"), (el) => {
      el.classList.toggle("fs-af--meins", an === true);
    });
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
    // 🔴 NICHT MEHR SPERREN. Owner 02.09.2026: an einer bekannten Seite stand „Briefspiel" als
    // Titel -- die kaputte Angabe, die dieser Umbau beseitigen soll -- und sie war gesperrt.
    // Ein Feld, das den Fehler ZEIGT und ihn nicht ändern lässt, ist schlimmer als eines, das
    // ihn verschweigt. Die Werte stehen weiter da; was der Editor ändert, geht über
    // `korrekturAusZeile` + `wendeKorrekturAn` an den Katalog -- NACH dem Verknuepfen.
    letzteBekannteQuelle = auskunft && auskunft.existing ? auskunft.existing : null;
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
    uebernehmeKorpus(auskunft.corpus);
    setzeAdressZustand(sicht.zustand, sicht.meldung);
  }

  // Der zuletzt gemeldete Korpus -- gebraucht beim Umbenennen (welcher Schlüssel ist gemeint?)
  // und für die Rückfrage ab AVESMAPS_SOURCE_CORPUS_CONFIRM_THRESHOLD Objekten.
  let letzterKorpus = null;

  /**
   * Der Korpus in die Zeile: Name, Schlüssel, Reichweite -- und die vier Marker.
   *
   * 🔴 Vorbelegt wird nur, wo der Editor NICHTS eingetippt hat. Ein Korpus gibt eine Vorgabe,
   * keine Anweisung; wer schon etwas hingeschrieben hat, meinte das.
   * ⚠️ Und der Marker erscheint nur, wo der Korpus den Wert WIRKLICH trägt -- ein Marker über
   * einem leeren Feld behauptete, der Korpus habe dazu etwas zu sagen.
   */
  // Steht das Haekchen „Kein Korpus verwenden"? EIN Leser, drei Aufrufer -- nachgebaut waere er
  // die naechste Stelle, an der ein Zustand auseinanderlaeuft.
  const ohneKorpusGewaehlt = () => {
    const el = containerEl.querySelector("[data-fs-no-corpus]");
    return Boolean(el && el.checked);
  };

  /**
   * Die Abweichungsfelder erben ihre Beschriftung vom Korpus.
   *
   * 🔴 Der erste Eintrag IST der Korpuswert — er trägt `value=""` und heißt „wie Korpus
   * (CC BY-SA 4.0)". Wer etwas anderes einstellt, weicht ab; wer zurückstellt, erbt wieder. Der
   * ZUSTAND ist damit der Wert selbst, und es gibt nichts daneben, das auseinanderlaufen könnte.
   * 💣 GESETZT WIRD DER TEXT, NIE DER `value`. Ein Eintrag, dessen Wert sich mit dem Korpus
   * ändert, wäre beim nächsten Korpuswechsel stillschweigend eine Abweichung — der leere Wert
   * ist die einzige Stelle, an der „erbt" steht.
   * ⚠️ Ohne Korpus („Kein Korpus verwenden", oder Adresse noch unbekannt) gibt es nichts, wovon
   * man abweichen könnte: der Eintrag heißt dann „— keine Angabe —", und `.abw--frei` nimmt die
   * Marke „· abweichend" weg.
   */
  function zeigeAbweichung(korpus, ohneKorpus) {
    const kasten = containerEl.querySelector("[data-fs-abw]");
    if (!kasten) {
      return;
    }
    const frei = ohneKorpus === true || !korpus;
    kasten.classList.toggle("abw--frei", frei);
    const text = kasten.querySelector("[data-fs-abw-text]");
    const objekte = korpus ? Number(korpus.objects) || 0 : 0;
    if (text) {
      // 🔴 DIE REICHWEITE STEHT DABEI, und sie ist der Grund für diesen Satz: eine
      // abweichende Lizenz liegt an der QUELLE und wirkt an jedem Objekt, das sie zitiert —
      // nicht nur an diesem. Ohne den Zusatz läse sich der Kasten unter der Aufschrift
      // „Nur an diesem Objekt" als objektbezogen, und das wäre das einzige Versprechen in
      // diesem Formular, das die Ablage nicht einlöst.
      text.textContent = frei
        ? tr("sources.abw.free",
          "Diese Quelle gehört zu keinem Korpus — diese Angaben gelten nur für sie.")
        : (objekte > 0
          ? tr("sources.abw.reach",
            "Abweichend vom Korpus — leer heißt: wie der Korpus. Eine Abweichung gehört der Quelle und gilt an allen {n} Objekten, die sie zitieren.")
            .replace("{n}", String(objekte))
          : tr("sources.abw.hint", "Abweichend vom Korpus — leer heißt: wie der Korpus."));
    }
    const lizenzTafel = featureSourceLicenseTable();
    const beschriften = (name, wert, klartext) => {
      const el = kasten.querySelector('[data-fs-abw-wert="' + name + '"]');
      if (!el) {
        return;
      }
      const satz = frei
        ? tr("sources.abw.none", "— keine Angabe —")
        : (wert !== ""
          ? tr("sources.abw.inheritValue", "wie Korpus ({wert})").replace("{wert}", klartext)
          : tr("sources.abw.inherit", "wie Korpus"));
      if (el.tagName === "SELECT") {
        const erster = el.querySelector('option[value=""]');
        if (erster) {
          erster.textContent = satz;
        }
        return;
      }
      // ⚠️ Beim Textfeld ist der PLATZHALTER die Erbschaft — ein vorbelegter Wert wäre eine
      // Abweichung, sobald jemand das Formular nur ansieht.
      el.placeholder = satz;
    };
    const art = korpus ? String(korpus.source_type || "") : "";
    const lizenz = korpus ? String(korpus.license || "") : "";
    const nennung = korpus ? String(korpus.attribution || "") : "";
    beschriften("source_type", art, art !== "" ? featureSourceTypeLabel(art) : "");
    beschriften("license", lizenz,
      lizenz !== "" && lizenzTafel[lizenz] ? lizenzTafel[lizenz].label : lizenz);
    beschriften("attribution", nennung, nennung);
  }

  /**
   * „Kein Korpus verwenden" — der Korpusrahmen verschwindet, die Angaben bleiben.
   *
   * 🔴 Art, Lizenz und Nennung rutschen NICHT mit weg: verschwänden sie, hätte eine korpuslose
   * Quelle GAR KEINE Lizenz, und die ist das rechtlich Tragende. Sie verlieren nur ihren Eintrag
   * „wie Korpus (…)" — es gibt dann nichts, wovon man abweichen könnte.
   */
  function zeigeOhneKorpus(an) {
    const gruppe = containerEl.querySelector("[data-fs-korpus-gruppe]");
    if (gruppe) {
      gruppe.hidden = an === true;
    }
    zeigeAbweichung(letzterKorpus, an === true);
  }

  function uebernehmeKorpus(korpus) {
    letzterKorpus = korpus || null;
    const feld = containerEl.querySelector("[data-fs-corpus]");
    const meta = containerEl.querySelector("[data-fs-corpus-meta]");
    const scope = containerEl.querySelector("[data-fs-korpus-scope]");
    const titelEl = containerEl.querySelector("[data-fs-korpus-titel]");
    const marker = (name, an) => {
      const el = containerEl.querySelector('[data-fs-from="' + name + '"]');
      if (el) {
        el.hidden = !an;
      }
    };
    if (!korpus) {
      if (feld) {
        feld.value = "";
      }
      if (meta) {
        meta.textContent = "";
      }
      // 🔴 OHNE ADRESSE SAGT DIE AUFSCHRIFT, WORAUF SIE WARTET. Ein blosses „Gilt für den ganzen
      // Korpus" über einer leeren Maske behauptet einen Wirt, den niemand kennt.
      if (scope) {
        scope.textContent = " — " + tr("sources.add.corpusScopeNone", "welcher, sagt die Adresse");
      }
      if (titelEl) {
        titelEl.textContent = tr("sources.add.corpusGroup", "Gilt für den ganzen Korpus");
      }
      ["type", "license", "attribution", "official"].forEach((n) => marker(n, false));
      zeigeAbweichung(null, ohneKorpusGewaehlt());
      return;
    }
    if (feld && String(feld.value || "").trim() === "") {
      // 🔴 DER VORSCHLAG AUS DER SEITE GEHT VOR DEM NACKTEN SCHLÜSSEL. Owner-Bild 02.09.2026
      // (IST gegen SOLL): im Feld stand „westlande.de", während die Meldung darunter schon sagte
      // „Die Seite nennt sich „AlberniaWiki“". Wir kannten den Namen, erzählten ihn in Prosa und
      // trugen ihn nicht ein -- der Editor hätte ihn abtippen müssen.
      // ⚠️ Nur bei einem UNBEKANNTEN Korpus: ein gepflegter Name schlägt jeden Seitenzusatz.
      feld.value = String((korpus.known === true ? "" : korpus.label_suggestion || "")
        || korpus.label || korpus.corpus_key || "");
    }
    if (meta) {
      // Der Schlüssel bleibt sichtbar NEBEN dem Namen (Owner 01.09.2026: „lass den schlüssel
      // dranstehen") -- er ist gerechnet und nicht editierbar, und ohne ihn wäre nicht zu sehen,
      // WORAN der Name hängt.
      // ⚠️ Die REICHWEITE stand bis zum 02.09.2026 auch hier. Sie ist an die Aufschrift des
      // Rahmens gewandert: sie gilt allen fünf Feldern darin, nicht nur dem Namen daneben.
      meta.textContent = " · " + tr("sources.add.corpusKey", "(Korpusschlüssel: {key})")
        .replace("{key}", String(korpus.corpus_key || ""));
    }
    if (scope) {
      // 🔴 ZWEI ZUSTÄNDE, und der zweite ist kein Warnschild, sondern ein Versprechen: bei einem
      // NEUEN Wirt trifft die Eingabe niemanden ausser diese eine Quelle -- sie wird der erste
      // Stand des Korpus, und jede spätere Seite von dort erbt sie.
      // ⚠️ Gemessen wird an `objects`, nicht an `known`: ein angelegter Korpus ohne Belege trüge
      // sonst „0 Objekte" und läse sich wie ein Fehler.
      const objekte = Number(korpus.objects) || 0;
      const quellen = Number(korpus.sources) || 0;
      const name = String(korpus.label || korpus.corpus_key || "");
      // 🔴 DER NAME IN DEN TITEL, DIE ZAHLEN IN DIE REICHWEITE — zeichengleich zum ✎
      // (`sources.edit.corpusScope`). Bis zum 03.09.2026 stand der Wirtsname hier in der
      // REICHWEITE und im ✎ im TITEL: einmal fett-braune Versalzeile, einmal gedämpftes
      // Beiwort, für dasselbe Ding. Gefunden hat das der Prüfagent — im Einzelbild sieht jede
      // Seite für sich richtig aus.
      if (titelEl) {
        titelEl.textContent = name !== ""
          ? tr("sources.edit.corpusScope", "Gilt für den ganzen Korpus „{name}“").replace("{name}", name)
          : tr("sources.add.corpusGroup", "Gilt für den ganzen Korpus");
      }
      scope.textContent = objekte === 0
        ? tr("sources.add.corpusScopeNew", "{key} ist neu, du legst ihn hiermit an")
          .replace("{key}", String(korpus.corpus_key || ""))
        : tr("sources.add.corpusScopeReach", "{q} Quellen · {n} Objekte")
          .replace("{q}", String(quellen)).replace("{n}", String(objekte));
    }
    // 🔴 Vorbelegen NUR bei einem bekannten Korpus. Ein frisch aus der Adresse abgeleiteter trägt
    // nichts, was er vorgeben könnte -- dort wäre jeder Marker eine Behauptung.
    const bekannt = korpus.known === true;
    const setzeLeer = (selektor, wert) => {
      const el = containerEl.querySelector(selektor);
      if (el && wert !== "" && String(el.value || "").trim() === "") {
        el.value = wert;
        return true;
      }
      return Boolean(el && wert !== "" && String(el.value || "") === wert);
    };
    marker("type", bekannt && setzeLeer(".fs-add-type", String(korpus.source_type || "")));
    marker("license", bekannt && setzeLeer(".fs-add-license", String(korpus.license || "")));
    marker("attribution", bekannt && setzeLeer(".fs-add-attribution", String(korpus.attribution || "")));
    const haken = containerEl.querySelector(".fs-add-official");
    if (bekannt && haken && korpus.is_official === true && !haken.checked) {
      haken.checked = true;
    }
    marker("official", bekannt && korpus.is_official === true);

    zeigeAbweichung(korpus, ohneKorpusGewaehlt());

    // 🔴 DIE FORM STEHT NICHT MEHR IN DIESER ZEILE (Owner 02.09.2026: „zieh die form ins ✎").
    // Mit ihr ist auch ihr gerechneter Vorschlag (`form_suggestion`) hier weggefallen -- er
    // gehoert an die Stelle, an der die Form entschieden wird, und das ist der ✎.
  }

  // Die zuletzt gemeldete bekannte Katalogzeile -- gebraucht beim Korrigieren (was stand vorher da?).
  let letzteBekannteQuelle = null;

  /**
   * Weicht an einer BEKANNTEN Seite ein Katalogfeld vom gespeicherten Stand ab, wird der
   * Katalogeintrag richtiggestellt, bevor verknüpft wird.
   *
   * 🔴 Das ist die Antwort auf „gesperrt und nutzlos". Der Upsert des Anlegens fasst eine bekannte
   * Zeile nicht an (`label` füllt nur eine Lücke, `source_type` nur auf ausdrückliche Wahl) -- ein
   * editierbares Feld täte dort also nichts. Statt es deshalb zu sperren, geht die Änderung über
   * `update`, den EINEN Schreibweg für Katalogfelder, den auch das ✎ benutzt.
   *
   * ⚠️ `is_official` bleibt aussen vor: den überschreibt der Upsert ohnehin unbedingt, eine
   * zusätzliche Korrektur wäre ein zweiter Schreibweg für denselben Wert.
   *
   * 💣 SIE LAEUFT NACH DEM VERKNUEPFEN, NICHT DAVOR. `update` verlangt, dass die Quelle an DIESEM
   * Objekt haengt -- vorher gibt es die Verknuepfung noch gar nicht, und der Server antwortet
   * voellig zu Recht mit „Diese Quelle haengt nicht an diesem Objekt." (Owner-Bild 02.09.2026).
   * Erst verknuepfen, dann richtigstellen.
   *
   * @returns {{source_id:number, felder:object, label:string, usage:number}|null}
   */
  function korrekturAusZeile(values) {
    const bekannt = letzteBekannteQuelle;
    if (!bekannt || !bekannt.source_id) {
      return null;
    }
    const felder = {};
    const vergleiche = (name, jetzt, vorher) => {
      if (String(jetzt || "") !== String(vorher || "")) {
        felder[name] = jetzt;
      }
    };
    vergleiche("label", values.label, bekannt.label);
    vergleiche("source_type", values.source_type_chosen ? values.source_type : bekannt.source_type, bekannt.source_type);
    vergleiche("license", values.license, bekannt.license);
    vergleiche("attribution", values.attribution, bekannt.attribution);
    if (Object.keys(felder).length === 0) {
      return null; // nichts angefasst -- normal weiter
    }
    return {
      source_id: Number(bekannt.source_id),
      felder: felder,
      label: String(bekannt.label || ""),
      usage: Number(bekannt.usage_count) || 1,
    };
  }

  /** Wendet die vorher gerechnete Korrektur an -- NACH dem Verknuepfen. */
  async function wendeKorrekturAn(korrektur) {
    // 🔴 Die Rückfrage nennt die ZAHL. „Gilt überall" ohne Grösse ist keine Warnung -- dieselbe
    // Regel und dieselbe Schwelle wie im Bearbeiten-Kasten.
    const usage = korrektur.usage;
    if (usage > FEATURE_SOURCE_CONFIRM_THRESHOLD) {
      const frage = tr("sources.add.fixConfirm",
        "„{label}“ wird an {n} Objekten zitiert. Deine Änderung gilt überall dort. Fortfahren?")
        .replace("{label}", korrektur.label).replace("{n}", String(usage));
      if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(frage)) {
        return;
      }
    }
    const daten = await renderFromServer("update", {
      source_id: korrektur.source_id,
      fields: korrektur.felder,
      confirm_catalog: true,
    });
    if (!daten) {
      const fehler = letzteAntwort && letzteAntwort.error ? letzteAntwort.error : null;
      showAddRowNote((fehler && fehler.message)
        || tr("sources.add.fixFailed", "Der Katalogeintrag ließ sich nicht ändern."), "bad");
      return;
    }
    // ⚠️ Die Quelle HAENGT jetzt -- die Korrektur lief danach. Gesagt wird trotzdem, was am
    // geteilten Katalog geschehen ist: eine stille Aenderung an einer katalogweit zitierten Zeile
    // waere dieselbe Falle wie die stille Nicht-Aenderung davor.
    showAddRowNote(tr("sources.add.fixed",
      "Verknüpft — und der Katalogeintrag wurde dabei richtiggestellt."), "ok");
  }

  /**
   * Was der erste Eintrag einer Domain über ihren Korpus verrät — oder `null`, wenn es ihn
   * schon gibt bzw. nichts zu sagen wäre.
   *
   * 🔴 NUR beim ERSTEN Mal. Ein bekannter Korpus wird hier nie angefasst: seine Werte gehören ihm,
   * und eine einzelne Quelle darf sie nicht im Vorbeigehen umschreiben. Umbenannt wird über das
   * Korpusfeld, mit Rückfrage.
   * ⚠️ Die FORM (Werk oder Belegstelle) bleibt bewusst offen. Bei einer Zeile sagt das Verhältnis
   * Titel/Zeilen nichts -- wer sie hier setzte, ratete und sähe dabei gemessen aus.
   */
  function korpusAnlageAusZeile(values) {
    const korpus = letzterKorpus;
    if (!korpus || korpus.known === true || !korpus.corpus_key) {
      return null;
    }
    const feld = containerEl.querySelector("[data-fs-corpus]");
    const name = String((feld && feld.value) || "").trim();
    const felder = {};
    if (name !== "" && name !== korpus.corpus_key) {
      felder.label = name; // der Schlüssel als Name ist keine Aussage, sondern der Rückfall
    }
    if (values.source_type_chosen && values.source_type) {
      felder.source_type = values.source_type;
    }
    if (values.license) {
      felder.license = values.license;
    }
    if (values.attribution) {
      felder.attribution = values.attribution;
    }
    if (values.is_official) {
      felder.is_official = true;
    }
    // ⚠️ Die FORM reist hier NICHT mehr mit: sie steht seit dem 02.09.2026 im ✎. Ein frischer
    // Korpus startet damit auf „noch offen" -- und das ist richtig, denn beim ERSTEN Eintrag
    // eines Wirts sagt das Verhaeltnis Titel/Zeilen nichts. Entschieden wird sie dort, wo
    // man sie entscheiden kann.
    return Object.keys(felder).length > 0 ? { key: korpus.corpus_key, felder: felder } : null;
  }

  /**
   * Legt den Korpus an. ⚠️ Still im Erfolgsfall: der Editor hat gerade eine Quelle eingetragen,
   * und dass dabei nebenbei ein Wirt bekannt wurde, ist keine Nachricht für ihn -- sichtbar wird
   * es beim NÄCHSTEN Eintrag derselben Domain, und genau dort gehört es hin.
   * 🔴 Ein Fehlschlag wird dagegen gesagt: sonst wundert sich beim nächsten Mal jemand, warum
   * nichts vorbelegt ist.
   */
  /**
   * Die Abweichung der Eingabezeile festhalten — NACH dem Eintragen.
   *
   * ⭐ Über den vorhandenen `update`-Weg, denselben, den das ✎ nimmt. Ein 15. Parameter an `add`
   * wäre eine zweite Fassung derselben Regel gewesen; hier gibt es keine.
   * 💣 DIE ZEILE WIRD ÜBER IHRE ADRESSE WIEDERGEFUNDEN, nicht über eine Position in der Liste:
   * `add` sortiert nach `is_official`, und eine frisch angelegte Quelle steht deshalb nicht
   * zwangsläufig am Ende. Die Adresse IST die Identität (`url_hash` ist UNIQUE) — sie trifft in
   * beiden Fällen, ob gerade angelegt oder mit einer bekannten Zeile verknüpft wurde.
   * 🔴 Ein Fehlschlag wird GESAGT: die Quelle steht dann, aber ohne ihre Abweichung — und beim
   * nächsten Korpus-Speichern wäre sie still überschrieben. Genau das soll das Häkchen verhindern.
   */
  async function haltAbweichungFest(daten, url, liste) {
    const quellen = Array.isArray(daten && daten.sources) ? daten.sources : [];
    const treffer = quellen.find((s) => String(s.url || "") === String(url || ""));
    if (!treffer) {
      showAddRowNote(tr("sources.add.ownNotStored",
        "Die Quelle steht — die Abweichung ließ sich aber nicht festhalten. Sie ist über das ✎ nachzutragen."));
      return;
    }
    const antwort = await featureSourceFetch({
      action: "update",
      entity_type: entityType,
      entity_public_id: typeof publicIdGetter === "function" ? publicIdGetter() : publicIdGetter,
      ...(verteilteKennungen("update") ? { entity_public_ids: verteilteKennungen("update") } : {}),
      source_id: treffer.source_id,
      fields: { own_fields: liste },
      // ⚠️ Bestätigt: der Editor hat die Häkchen gerade selbst gesetzt, und eine Rückfrage direkt
      // nach seinem eigenen Klick wäre eine Frage nach dem, was er eben getan hat.
      confirm_catalog: true,
    });
    if (!antwort || antwort.ok !== true) {
      showAddRowNote(tr("sources.add.ownNotStored",
        "Die Quelle steht — die Abweichung ließ sich aber nicht festhalten. Sie ist über das ✎ nachzutragen."));
    }
  }

  async function legeKorpusAn(anlage) {
    const daten = await featureSourceFetch({
      action: "save_corpus",
      entity_type: entityType,
      corpus_key: anlage.key,
      fields: anlage.felder,
      confirm_corpus: true,
    });
    if (!daten || daten.ok !== true) {
      showAddRowNote(tr("sources.add.corpusNotStored",
        "Die Quelle steht — aber „{key}“ ließ sich nicht als Korpus merken. Beim nächsten Eintrag von dort ist nichts vorbelegt.")
        .replace("{key}", anlage.key));
      return;
    }
    letzterKorpus = Object.assign({}, letzterKorpus, daten.corpus || {}, { known: true });
  }

  /**
   * 🔴 DIE FELDER, DIE DEM KORPUS GEHÖREN. Owner-Entscheid 02.09.2026: „ändere ich ART, LIZENZ,
   * Namensnennung oder Name, ändert sich alles mit."
   *
   * 💣 Seiten, Abdeckung, Titel und Adresse stehen NICHT darin -- die gehören dieser einen
   * Fundstelle. Der Rahmen in der Oberfläche zeigt genau diese Grenze („du kannst gerne alles
   * einrahmen, was zum korpus gehört (seiten z.b. nicht)").
   */
  const KORPUS_FELDER = [
    { selektor: ".fs-add-type", feld: "source_type" },
    { selektor: ".fs-add-license", feld: "license" },
    { selektor: ".fs-add-attribution", feld: "attribution" },
    { selektor: ".fs-add-official", feld: "is_official", haken: true },
  ];

  /**
   * Ein Korpusfeld wurde geändert — das gilt für ALLE Belege dieses Wirts.
   *
   * ⚠️ Nur bei einem BEKANNTEN Korpus. Existiert er noch nicht, hat er auch keine anderen Belege;
   * seine Werte reisen dann mit dem ersten Eintrag mit (`korpusAnlageAusZeile`) und legen ihn an.
   * Sonst entstünde für jede halb ausgefüllte, nie abgeschickte Zeile ein Korpus.
   */
  async function speichereKorpusFeld(eintrag) {
    const korpus = letzterKorpus;
    if (!korpus || korpus.known !== true || !korpus.corpus_key) {
      return;
    }
    const el = containerEl.querySelector(eintrag.selektor);
    if (!el) {
      return;
    }
    const jetzt = eintrag.haken ? el.checked === true : String(el.value || "");
    const vorher = eintrag.haken ? korpus[eintrag.feld] === true : String(korpus[eintrag.feld] || "");
    if (jetzt === vorher) {
      return;
    }
    const felder = {};
    felder[eintrag.feld] = jetzt;
    if (!await bestaetigeKorpusAenderung(korpus)) {
      // zurücksetzen, sonst zeigt die Zeile einen Wert, den niemand gespeichert hat
      if (eintrag.haken) {
        el.checked = vorher;
      } else {
        el.value = vorher;
      }
      return;
    }
    await schreibeKorpus(korpus.corpus_key, felder);
  }

  /**
   * Schreibt zurück, was der Editor in der Eingabezeile schon stehen hatte.
   *
   * ⚠️ Ohne dieses Gegenstück kostet jede Korpusänderung die halbe Eingabe -- und der Editor
   * lernt daraus, den Korpus nicht anzufassen. Genau das soll er aber tun.
   */
  function stelleAddZeileWiederHer(werte) {
    if (!werte) {
      return;
    }
    const setze = (selektor, wert) => {
      const el = containerEl.querySelector(selektor);
      if (el && wert) {
        el.value = wert;
      }
    };
    setze(".fs-add-url", werte.url);
    setze(".fs-add-label", werte.label);
    setze(".fs-add-pages", werte.pages);
    setze(".fs-add-kind", werte.reference_kind);
  }

  /**
   * „Abbrechen" — die Eingabezeile auf den leeren Anfang zuruecksetzen (Owner 02.09.2026).
   *
   * ⚠️ Sie ist das Gegenstueck zu `stelleAddZeileWiederHer`, und die beiden muessen DIESELBEN
   * Felder kennen: kommt eines dazu, das nur einer von beiden kennt, bleibt es entweder beim
   * Abbrechen stehen oder geht bei einer Korpusaenderung verloren -- beides still.
   */
  function leereAddZeile() {
    [".fs-add-url", ".fs-add-label", ".fs-add-pages"].forEach((selektor) => {
      const el = containerEl.querySelector(selektor);
      if (el) {
        el.value = "";
      }
    });
    const kind = containerEl.querySelector(".fs-add-kind");
    if (kind) {
      kind.value = "";
    }
    // ⭐ `uebernehmeKorpus(null)` ist der vorhandene Weg, den Kasten zu schliessen -- er setzt
    // zugleich `letzterKorpus` zurueck. Ein eigenes `hidden = true` daneben liesse den gemerkten
    // Korpus stehen, und das naechste Speichern schriebe ihn auf eine Adresse, die niemand mehr
    // geprueft hat.
    uebernehmeKorpus(null);
    setzeAdressZustand(null, "");
    zeigeAdressForm();
  }

  /** Die Rückfrage — sie nennt die ZAHL, denn „gilt überall" ohne Grösse ist keine Warnung. */
  async function bestaetigeKorpusAenderung(korpus) {
    const objekte = Number(korpus.objects) || 0;
    if (objekte < FEATURE_SOURCE_CONFIRM_THRESHOLD) {
      return true;
    }
    const frage = tr("sources.add.corpusFieldConfirm",
      "Das gilt für alle {n} Objekte des Korpus „{name}“. Fortfahren?")
      .replace("{n}", String(objekte))
      .replace("{name}", String(korpus.label || korpus.corpus_key || ""));
    return typeof window === "undefined" || typeof window.confirm !== "function" || window.confirm(frage);
  }

  /** Der EINE Schreibweg zum Korpus -- Umbenennen und Feldänderung münden hier. */
  async function schreibeKorpus(key, felder) {
    const daten = await featureSourceFetch({
      action: "save_corpus",
      entity_type: entityType,
      corpus_key: key,
      fields: felder,
      confirm_corpus: true,
    });
    if (!daten || daten.ok !== true) {
      setzeAdressZustand(null, (daten && daten.error && daten.error.message)
        || tr("sources.add.corpusFailed", "Der Korpus ließ sich nicht speichern."));
      return null;
    }
    letzterKorpus = Object.assign({}, letzterKorpus, daten.corpus || {}, { known: true });
    // 🔴 DIE FELDER MÜSSEN NACHZIEHEN (Owner 02.09.2026). Der Korpus hat gerade JEDE Quelle dieses
    // Wirts umgeschrieben -- die Zeilen darüber zeigen sonst weiter den alten Stand, und der
    // Editor sieht eine Liste, die seiner eigenen Änderung widerspricht.
    // ⚠️ `renderFromServer` zeichnet die Eingabezeile mit neu und leert sie. Was der Editor dort
    // schon getippt hat, wird deshalb vorher gerettet und danach zurückgeschrieben -- sonst
    // bestraft ihn eine Korpusänderung mit dem Verlust seiner halben Eingabe.
    const gerettet = readAddRowValues();
    await renderFromServer("list");
    stelleAddZeileWiederHer(gerettet);
    uebernehmeKorpus(letzterKorpus);
    const betroffen = Number(daten.corpus && daten.corpus.objects) || 0;
    showAddRowNote(betroffen > 0
      ? tr("sources.add.corpusApplied", "Übernommen — das gilt jetzt für alle {n} Objekte dieses Korpus.")
        .replace("{n}", String(betroffen))
      : tr("sources.add.corpusStored", "Übernommen."), "ok");
    return daten;
  }

  /**
   * Den Korpus umbenennen. 🔴 Das trifft JEDEN Beleg dieses Wirts -- deshalb die Rückfrage, und
   * deshalb steht die Reichweite schon vorher neben dem Feld.
   */
  async function speichereKorpus() {
    const feld = containerEl.querySelector("[data-fs-corpus]");
    if (!feld || !letzterKorpus) {
      return;
    }
    const neu = String(feld.value || "").trim();
    const alt = String(letzterKorpus.label || letzterKorpus.corpus_key || "");
    if (neu === "" || neu === alt) {
      return; // nichts angefasst -- und ein leerer Name ist keine Umbenennung, sondern ein Versehen
    }
    const objekte = Number(letzterKorpus.objects) || 0;
    if (objekte >= FEATURE_SOURCE_CONFIRM_THRESHOLD) {
      const frage = tr("sources.add.corpusConfirm",
        "„{alt}“ in „{neu}“ umbenennen? Das gilt für alle {n} Objekte dieses Korpus.")
        .replace("{alt}", alt).replace("{neu}", neu).replace("{n}", String(objekte));
      if (typeof window !== "undefined" && typeof window.confirm === "function" && !window.confirm(frage)) {
        feld.value = alt;
        return;
      }
    }
    // 🔴 Derselbe Schreibweg wie jede andere Korpusänderung -- eine Regel, die einen von zwei
    // Erzeugern bindet, ist keine Regel.
    if (!await schreibeKorpus(letzterKorpus.corpus_key, { label: neu })) {
      feld.value = alt;
    }
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
      // Die Formpruefung laeuft beim Tippen -- sie fragt keinen fremden Server und darf
      // deshalb an jedem Tastendruck haengen, anders als der Abruf daneben.
      zeigeAdressForm();
      // ⚠️ Und die bekannte Zeile gilt nicht mehr: eine geänderte Adresse meint eine ANDERE Quelle,
      // und eine Korrektur dürfte auf keinen Fall an der alten landen.
      letzteBekannteQuelle = null;
      // ⚠️ Und der Korpuskasten mit -- er gehoert zur ALTEN Adresse. Bliebe er stehen, zeigte er
      // Werte eines Wirts, den der Editor gerade verlassen hat.
      uebernehmeKorpus(null);
    });
    // Der Korpusname wird beim Verlassen des Feldes gespeichert, nicht bei jedem Tastendruck --
    // eine Umbenennung, die alle Belege trifft, gehört nicht an ein `input`-Ereignis.
    // Jedes Korpusfeld schreibt beim Verlassen durch -- auf ALLE Belege des Wirts.
    KORPUS_FELDER.forEach((eintrag) => {
      const el = containerEl.querySelector(eintrag.selektor);
      if (el) {
        el.addEventListener("change", () => { speichereKorpusFeld(eintrag); });
      }
    });
    const korpusFeld = containerEl.querySelector("[data-fs-corpus]");
    if (korpusFeld) {
      korpusFeld.addEventListener("blur", speichereKorpus);
      korpusFeld.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          speichereKorpus();
        }
      });
    }
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
      // 🔴 EIGENER Schluessel, wie `source_type_chosen`: der Server schreibt „offiziell" einer BEKANNTEN
      // Zeile nur, wenn jemand den Haken angefasst hat. Gemerkt am Element (`data-fs-chosen`, gesetzt
      // vom change-Ereignis), nie im Modulzustand: die Zeile wird nach jedem Schreibvorgang neu gebaut.
      // Die Vorbelegung aus dem Korpus (haken.checked = true, ohne Ereignis) zaehlt damit NICHT als Wahl.
      is_official_chosen: Boolean(officialInput && officialInput.dataset && officialInput.dataset.fsChosen === "1"),
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
    zeile.insertAdjacentHTML("afterend", renderFeatureSourceEditPanel(quelle, opts && opts.escape ? opts.escape : featureSourceDefaultEscape, tr, wegGruppeFuerRender()));
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
    // 🔴 DIE ABWEICHUNG REIST NUR MIT, WENN SIE GEÄNDERT WURDE. Sonst schriebe jedes Speichern
    // `own_fields` mit -- und ein alter, zwischengespeicherter Client ohne diese Häkchen schickte
    // eine leere Liste und löschte damit still jede Abweichung des Wirts.
    const besitz = featureSourceOwnFieldsFromPanel(panel);
    if (besitz.geaendert) {
      felder.own_fields = besitz.liste;
    }
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
      return;
    }
    // 🔴 BENANNT, nicht verschwiegen: hat die Änderung über den Korpus gewirkt, hat sie JEDEN
    // Beleg dieses Wirts getroffen -- nicht nur die eine Zeile, die der Editor vor sich hatte.
    // Eine stille Änderung mit dieser Reichweite ist dieselbe Falle wie die stille
    // Nicht-Änderung, aus der Meldung #105 entstand.
    const korpus = daten.corpus_applied;
    if (korpus) {
      showAddRowNote(tr("sources.edit.corpusApplied",
        "„{feld}“ gilt dem Korpus „{name}“ — die Änderung wurde auf alle {n} Objekte übernommen.")
        .replace("{feld}", (korpus.fields || []).map(featureSourceFieldLabel).join(", "))
        .replace("{name}", String(korpus.label || korpus.corpus_key || ""))
        .replace("{n}", String(Number(korpus.objects) || 0)), "ok");
    }
  }

  /** Feldnamen für Menschen — dieselben Wörter wie die Beschriftungen der Eingabezeile. */
  function featureSourceFieldLabel(name) {
    const tafel = {
      source_type: tr("sources.add.typeLabel", "Art"),
      license: tr("sources.add.licenseLabel", "Lizenz"),
      attribution: tr("sources.add.attributionShort", "Namensnennung"),
      is_official: tr("sources.add.official", "offiziell"),
    };
    return tafel[name] || name;
  }

  // 🔴 „Jemand hat den Kanon-Haken AUSDRUECKLICH gesetzt" -- am Element vermerkt, damit `readAddRowValues`
  // es als `is_official_chosen` mitschickt. Bis zum 03.09.2026 schrieb jedes Eintragen einer bekannten
  // Adresse den Haken katalogweit in die Zeile (Geographia Aventurica, 1.319 Objekte, von ja auf nein).
  containerEl.addEventListener("change", (event) => {
    const ziel = event && event.target;
    if (ziel && typeof ziel.matches === "function" && ziel.matches(".fs-add-official") && ziel.dataset) {
      ziel.dataset.fsChosen = "1";
    }
  });
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
    // „Kein Korpus verwenden" — ein Klick, zwei sichtbare Folgen (Rahmen weg, Erbschaft weg).
    if (event.target.closest("[data-fs-no-corpus]")) {
      zeigeOhneKorpus(ohneKorpusGewaehlt());
      return;
    }
    if (event.target.closest("[data-fs-check]")) {
      await pruefeAdresse();
      return;
    }
    if (event.target.closest("[data-fs-add-cancel]")) {
      if (meldungAktuell()) {
        // „Ueberspringen": diese gemeldete Quelle wird nicht genommen, die naechste rueckt nach.
        meldungWeiter(letzteAntwort);
        return;
      }
      // ⚠️ Es LEERT, es schliesst nicht: die Eingabezeile ist der Fuss der Liste und bleibt stehen.
      // 💣 Der Korpuskasten muss MIT weg -- er gehoert der Adresse, die gerade verworfen wurde;
      // bliebe er stehen, stuende der Wirt der alten Adresse ueber einem leeren Feld und die
      // naechste Eingabe uebernaehme lautlos dessen Art und Lizenz.
      leereAddZeile();
      return;
    }
    const addTarget = event.target.closest("[data-fs-add-submit]");
    if (addTarget) {
      let values = readAddRowValues();
      const warMeldung = Boolean(meldungAktuell());
      // Der Seitentitel einer NEUEN gemeldeten Adresse: einmal von der Seite gelesen, wenn niemand ihn angeboten
      // hat (Entwurf §5.4) -- derselbe Handgriff wie der ⟳-Knopf.
      if (warMeldung && !pickedSourceId && values.url && !values.label) {
        await pruefeAdresse();
        values = readAddRowValues();
      }
      // 🔴 EINE BEKANNTE SEITE WIRD KORRIGIERT, NICHT VERWORFEN (Owner 02.09.2026: „ich kann noch
      // Titel etc. editieren - nur Name des Korpus"). Die Katalogfelder waren gesperrt, weil der
      // Upsert sie ohnehin ignoriert -- und damit kam der Editor ausgerechnet an die kaputte
      // Angabe nicht heran, die er vor sich sah: der gespeicherte Titel war „Briefspiel".
      // 💣 Gerechnet wird die Korrektur HIER (die Zeile steht noch), angewandt wird sie NACH dem
      // Verknüpfen -- siehe `wendeKorrekturAn`.
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
            ? { url: values.url, label: values.label, is_official: values.is_official, is_official_chosen: values.is_official_chosen }
            : {}
        ));
        if (daten && warMeldung) {
          meldungWeiter(daten);
        }
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
      // 🔴 EINE Rueckmeldung, die alles traegt (`zeigeErgebnis`): Erfolg, Umtypung, Verknuepfung.
      // Bis zum 03.09.2026 standen hier ZWEI Rufe hintereinander, und der zweite ueberschrieb den
      // ersten -- solange der zweite schwieg, wenn es nichts zu verknuepfen gab, ging das gut.
      // Seit die Eingabezeile den Erfolg IMMER bestaetigt, ginge die Umtypung dabei verloren.
      // 🔴 DER ERSTE EINTRAG AUF EINER DOMAIN LEGT IHREN KORPUS AN -- sonst gäbe es ihn NIE.
      // Bis hierher entstand eine Korpuszeile nur beim Umbenennen; wer den vorgeschlagenen Namen
      // stehen liess (der Normalfall, er stimmt ja), speicherte nichts. Die nächste Seite desselben
      // Wirts sah damit wieder die nackte Domain, und Schritt 2 des Entwurfs -- „alles andere steht
      // schon da" -- trat nie ein. Owner-Bild 02.09.2026, IST gegen SOLL.
      // ⚠️ VOR dem Anlegen gelesen, denn `renderFromServer` zeichnet die Zeile neu und leert sie.
      const korpusAusZeile = korpusAnlageAusZeile(values);
      const korrektur = korrekturAusZeile(values);
      // 🔴 DIE ABWEICHUNG WIRD VOR DEM ANLEGEN GELESEN und DANACH geschrieben. Vorher, weil
      // `renderFromServer` die Zeile neu zeichnet und leert; danach, weil es die Quelle vorher
      // nicht gibt.
      // ⭐ Über den vorhandenen `update`-Weg, nicht über einen 15. Parameter an `add`: derselbe
      // geprüfte Pfad, den auch das ✎ nimmt, samt seiner Rückfrage ab der Schwelle. Ein neuer
      // Parameter wäre eine zweite Fassung derselben Regel.
      const besitzAusZeile = featureSourceOwnFieldsFromPanel(containerEl);
      const daten = await renderFromServer("add", values);
      // ⚠️ VOR der Rueckmeldung weiterruecken: das Neuzeichnen leert die Meldezeile, die Bestaetigung kommt danach.
      if (daten && warMeldung) {
        meldungWeiter(daten);
      }
      zeigeErgebnis(daten, values);
      // ⚠️ ALLES DREI NACH dem Verknüpfen: `update` verlangt die Verknüpfung, und ein Korpus für
      // eine Quelle, die gar nicht angelegt wurde, wäre eine Leiche.
      if (daten && korrektur) {
        await wendeKorrekturAn(korrektur);
      }
      if (daten && korpusAusZeile) {
        await legeKorpusAn(korpusAusZeile);
      }
      if (daten && besitzAusZeile.geaendert) {
        await haltAbweichungFest(daten, values.url, besitzAusZeile.liste);
      }
    }
  });

  return renderFromServer("list");
}

// 🔴 Die Vorschlagsgruppe „Aus der Meldung (wird beim Speichern uebernommen)" ist am 03.09.2026 gefallen: die
// gemeldete Quelle steht seither in der Eingabezeile selbst (opts.meldung), und was der Editor nicht
// gespeichert hat, wird nicht angelegt. linkCommunityReportSource darunter bleibt: es spielt den
// Anlege-Puffer (Bug #41) nach dem Anlegen eines Ortes ein.

/**
 * Die schreibgeschuetzte Vorschau der gemeldeten Quellen in der Review-Karte (Entwurf §5.3): je Quelle das
 * normale Formular, vorausgefuellt aus der Vorbelegung, alle Felder gesperrt -- ueber DENSELBEN Mount wie
 * der Annahme-Dialog, mit einem Puffer, der die Liste leer beantwortet. Kein zweiter Bauer.
 * @returns {number} wie viele Quellen gezeigt werden -- auch die Altform ohne Adresse und Kennung
 */
function mountFeatureSourceMeldungVorschau(containerEl, quellen, opts) {
  if (!containerEl || !Array.isArray(quellen)) {
    return 0;
  }
  // ⚠️ AUCH die Altform ohne Link: die Zeile darueber sagt „nicht verknuepfbar", Titel und Seite sind trotzdem
  // Information fuer den, der die Meldung sichtet -- gefiltert wird erst die Warteschlange des Annahme-Dialogs
  // (review-report-flow.js), denn dort wuerde ein Speichern ins Leere laufen.
  const liste = quellen.filter((q) => q && typeof q === "object");
  containerEl.innerHTML = "";
  liste.forEach((q, i) => {
    const wirt = document.createElement("div");
    wirt.className = "fs-meldung-vorschau";
    containerEl.appendChild(wirt);
    void mountFeatureSourceEditor(wirt, "settlement", () => "", Object.assign({}, opts || {}, {
      store: { request: async () => ({ ok: true, wiki_url: "", sources: [] }), toSuggestions: () => [], count: () => 0 },
      meldung: { quellen: [q], nummer: i + 1, gesamt: liste.length, vorschau: true },
    }));
  });
  return liste.length;
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
/**
 * @param {object} [byEntity]  Die Verweise JE KENNUNG aus der Sammelliste (`by_entity`): dann wird jede
 *   genannte Kennung nachgezogen, mit IHREN Seiten und IHRER Abdeckung -- und nie die Vereinigung an
 *   alle gehaengt (eine Quelle an 12 von 56 Abschnitten stuende sonst ploetzlich an allen 56). Ohne sie
 *   bekommt der Anker die Liste, wie bisher.
 */
function syncFeatureSourcesToClientCache(entityType, entityPublicId, editorSources, byEntity) {
  const ziel = featureSourceKartenfenster();
  if (!ziel || !Array.isArray(editorSources) || !entityPublicId) {
    return;
  }
  ziel.__sourceCatalog = ziel.__sourceCatalog || {};
  ziel.__featureSourceRefs = ziel.__featureSourceRefs || {};
  ziel.__sourceCorpora = ziel.__sourceCorpora || {};
  const refs = [];
  for (const source of editorSources) {
    if (!source || source.source_id === undefined || source.source_id === null) {
      continue;
    }
    // 🔴 DER KORPUSSCHLUESSEL GEHOERT DAZU -- die dritte Zeile dieser Art (nach Lizenz und Namensnennung).
    // Die Infobox stellt bei einer Belegstelle den KORPUSNAMEN vorn (featureSourceVornName, ueber
    // `corpora[s.corpus]` in js/ui/feature-source-markup.js); die Kartennutzlast traegt `corpus` als
    // Schluessel, die Editor-Liste als Objekt (`corpus.corpus_key`). Ohne diese Zeile zeigte die Infobox
    // nach JEDEM Oeffnen des Quellen-Editors -- nicht erst nach einem Speichern -- den Titel („Apfeldorn")
    // statt des Korpus („AlberniaWiki"), bis die Seite neu lud (Owner 03.09.2026: „wenn ich die seite
    // aktualisiere stimmts"). Ein Korpus, den die Nutzlast noch nicht kannte (in dieser Sitzung angelegt),
    // wird hier gleich mit eingetragen; ein bekannter ueberschreibt einen unbekannten Platzhalter.
    const korpusZeile = source.corpus && typeof source.corpus === "object" ? source.corpus : null;
    const korpusKey = korpusZeile && korpusZeile.corpus_key ? String(korpusZeile.corpus_key) : "";
    if (korpusKey !== "" && (korpusZeile.known === true || !ziel.__sourceCorpora[korpusKey])) {
      ziel.__sourceCorpora[korpusKey] = {
        label: String(korpusZeile.label || korpusKey),
        form: String(korpusZeile.form || ""),
        source_type: String(korpusZeile.source_type || ""),
        license: String(korpusZeile.license || ""),
        attribution: String(korpusZeile.attribution || ""),
        is_official: korpusZeile.is_official === true,
      };
    }
    ziel.__sourceCatalog[source.source_id] = {
      corpus: korpusKey,
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
  if (byEntity && typeof byEntity === "object" && !Array.isArray(byEntity)) {
    for (const [kennung, verweise] of Object.entries(byEntity)) {
      ziel.__featureSourceRefs[`${entityType}:${kennung}`] = (Array.isArray(verweise) ? verweise : [])
        .filter((v) => v && v.source_id !== undefined && v.source_id !== null)
        .map((v) => ({ source_id: v.source_id, pages: v.pages || "", reference_kind: v.reference_kind || "" }));
    }
    return;
  }
  ziel.__featureSourceRefs[`${entityType}:${entityPublicId}`] = refs;
}

if (typeof window !== "undefined") {
  window.renderFeatureSourceEditorHtml = renderFeatureSourceEditorHtml;
  window.mountFeatureSourceEditor = mountFeatureSourceEditor;
  window.linkCommunityReportSource = linkCommunityReportSource;
  window.mountFeatureSourceMeldungVorschau = mountFeatureSourceMeldungVorschau;
  window.featureSourceMeldungZeile = featureSourceMeldungZeile;
  window.createPendingFeatureSourceStore = createPendingFeatureSourceStore;
  // 🔴 Damit der Garetien-Importer DIESE Fassung ruft statt einer eigenen. Er legt Quellen an
  // Objekten an, die die geladene Karte noch nicht mit Quelle kennt; ohne den Abgleich stuende
  // seine Quelle erst nach einem vollstaendigen Neuladen in der Infobox.
  window.syncFeatureSourcesToClientCache = syncFeatureSourcesToClientCache;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    // Der Zeilenbauer -- fuer quellenzeile-name-vorn.test.js, das beide Erzeuger des Namens gegeneinander haelt.
    renderFeatureSourceRow,
    // Die Warteschlangen-Zeile der Meldung und der Mount (fuer meldung-im-quellenkasten.test.js).
    featureSourceMeldungZeile, mountFeatureSourceEditor, mountFeatureSourceMeldungVorschau,
    renderFeatureSourceEditorHtml, createPendingFeatureSourceStore, syncFeatureSourcesToClientCache,
    // Der Bearbeiten-Kasten und seine Schwelle -- der Kasten ist rein (kein DOM, kein fetch) und
    // damit unter Node fahrbar; die Schwelle wird gegen die PHP-Konstante gehalten.
    renderFeatureSourceEditPanel, FEATURE_SOURCE_CONFIRM_THRESHOLD, featureSourceChangedFields,
    // Die zwei reinen Helfer der Herkunftszeile -- ohne DOM fahrbar, damit die Datumszerlegung
    // und die „ohne Namen nur das Datum"-Regel einzeln geprueft werden koennen.
    featureSourceDatum, featureSourceHerkunftZeile,
    // Die Abweichung: welche Korpusfelder gehören dieser Zeile selbst -- rein, ohne DOM-Zustand.
    featureSourceOwnFieldsFromPanel, featureSourceUrlLooksValid,
    featureSourceLinkedMessage,
    // Die Adressauskunft der Eingabezeile: rein, damit „Zustand → was der Editor sieht" prüfbar
    // ist, statt nur im Browser zu gelten.
    featureSourceInspectView,
  };
}
