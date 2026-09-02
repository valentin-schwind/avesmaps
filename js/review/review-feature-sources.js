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
  return '<p class="fs-edit__by">' + escape(text) + "</p>";
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
  // 🔴 WELCHE KORPUSFELDER DIESE ZEILE SELBST BESITZT. Owner 02.09.2026: „Quelle soll optional
  // noch haben: Abweichende Lizenz, Abweichende Namensnennung" -- auf Nachfrage auf alle vier
  // korpuseigenen Felder erweitert, weil die einzigen Abweichungen im Bestand ausgerechnet die
  // zwei anderen sind (Art und „offiziell" an „Der Preis der Macht").
  const eigen = Array.isArray(source.own_fields) ? source.own_fields.slice() : [];
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

  /**
   * Ein korpuseigenes Feld — mit dem Häkchen, das es der Quelle zuschlägt.
   *
   * 🔴 EIN Eingabefeld, nicht zwei. Der naheliegende Entwurf (ein zweiter Kasten „Nur für diese
   * Quelle" mit denselben vier Feldern) legte zwei Elemente mit demselben `data-fs-field` an --
   * und `featureSourceChangedFields` liest sie beide. Welcher Wert gewinnt, entschiede dann die
   * DOM-Reihenfolge. Das Feld bleibt also, wo es ist; das Häkchen sagt, für wen es gilt.
   * 💣 Und es sagt es AM FELD, nicht in der Überschrift: die Gruppe heißt weiter „Gilt für den
   * ganzen Korpus", und ohne den Marker am Feld wäre ein angehaktes Feld eine stille Ausnahme
   * unter einer Überschrift, die das Gegenteil verspricht.
   * ⚠️ Der durchgestrichene Korpuswert erscheint nur, wenn er sich WIRKLICH unterscheidet und
   * nicht leer ist -- ein durchgestrichenes Nichts ist keine Auskunft. Bauteil und Optik sind
   * `wiki-override.css` (`.wiki-alt`, `.dt-old`): der Korpus verhält sich zur Quelle wie das Wiki
   * zum Kartenobjekt, und dafür gibt es die Form längst.
   */
  // 💣 VERGLICHEN WIRD DER SCHLÜSSEL, ANGEZEIGT DER TEXT. Die erste Fassung hielt `source.license`
  // („cc-by-sa-4.0") gegen die Beschriftung des Korpuswertes („CC BY-SA 4.0") -- die sind NIE
  // gleich, also stand über jedem angehakten Feld eine Abweichung, auch wo es keine gab. Gefangen
  // hat das der Test, nicht der Blick: im Bild sieht ein zu viel durchgestrichener Wert plausibel aus.
  const korpusFeld = (name, beschriftung, markup, eigenerWert, korpusRoh, korpusText) => {
    const istEigen = eigen.indexOf(name) !== -1;
    const abweichend = istEigen && String(korpusText || "") !== "" && String(eigenerWert || "") !== String(korpusRoh || "");
    return '<label class="fs-field' + (name === "attribution" ? " fs-field--grow" : "")
      + (istEigen ? " fs-field--eigen" : "") + '">'
      + "<span>" + escape(beschriftung)
      + (abweichend
        ? '<span class="wiki-alt"><span class="dt-old">' + escape(korpusText) + "</span></span>"
        : "")
      + "</span>" + markup
      + '<span class="fs-eigen"><input type="checkbox" data-fs-own="' + escape(name) + '"'
      + ' data-fs-own-orig="' + (istEigen ? "1" : "0") + '"' + (istEigen ? " checked" : "")
      + "> " + escape(tr("sources.edit.ownField", "nur diese Quelle")) + "</span>"
      + "</label>";
  };

  const kopf = (titel, reichweite) =>
    '<div class="fs-edit__head"><span class="fs-edit__title">' + escape(titel) + "</span>"
    + (reichweite ? '<span class="fs-edit__scope">' + reichweite + "</span>" : "") + "</div>";

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
  const korpusWert = (feldName, rueckfall) => {
    if (eigen.indexOf(feldName) !== -1) {
      return String(rueckfall);
    }
    if (korpus && korpus.known === true && korpus[feldName] !== undefined && korpus[feldName] !== "") {
      return String(korpus[feldName]);
    }
    return String(rueckfall);
  };
  const korpusHaken = eigen.indexOf("is_official") !== -1
    ? source.official === true
    : ((korpus && korpus.known === true && korpus.is_official !== undefined)
      ? korpus.is_official === true
      : source.official === true);

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
    + "</div>"
    // 🔴 DIE HERKUNFT STEHT AN IHRER REICHWEITE, nicht gesammelt am Fuss. „Wer hat das hier
    // angehängt" und „wer hat die Quelle angelegt" sind zwei verschiedene Menschen und zwei
    // verschiedene Zeitpunkte; unter einer gemeinsamen Überschrift wäre nicht zu sehen, welche
    // Angabe zu welcher Hälfte gehört.
    + featureSourceHerkunftZeile(source.created && source.created.link, {
      mitName: "sources.edit.byLink", mitNameText: "Hier angehängt von {wer} am {wann}",
      ohneName: "sources.edit.byLinkAnon", ohneNameText: "Hier angehängt am {wann}",
    }, escape, tr)
    + "</div>"
    + '<div class="fs-edit__group">'
    + kopf(tr("sources.edit.catalogScope", "Gilt für alle Objekte, die diese Quelle zitieren"), objekte)
    + adresse
    + '<div class="fs-edit__fields">'
    + (wikiOwned ? "" : feld("url", tr("sources.edit.url", "Adresse"), text("url", String(source.url || ""), "https://…", false)))
    + feld("label", tr("sources.colTitle", "Titel"), text("label", String(source.label || ""), "", wikiOwned))
    + "</div>"
    + featureSourceHerkunftZeile(source.created && source.created.source, {
      mitName: "sources.edit.bySource", mitNameText: "In den Katalog gelegt von {wer} am {wann}",
      ohneName: "sources.edit.bySourceAnon", ohneNameText: "In den Katalog gelegt am {wann}",
    }, escape, tr)
    + hinweis + "</div>"
    // 🔴 DIE DRITTE GRUPPE -- und sie ist eine BERICHTIGUNG, keine Zierde. Art, Lizenz, Nennung
    // und Kanon gehören seit dem 02.09.2026 dem KORPUS: eine Änderung daran trifft jede Quelle
    // dieses Wirts. In der Gruppe darüber gestanden, versprach die Überschrift „gilt für alle
    // Objekte, die diese Quelle zitieren · zurzeit nur dieses Objekt" — während ein Griff zur
    // Lizenz 39 Quellen und 50 Objekte umgeschrieben hätte. Owner-Bild 02.09.2026.
    + '<div class="fs-edit__group">'
    + kopf(korpusTitel, korpusReichweite)
    + '<div class="fs-edit__fields">'
    + korpusFeld("source_type", tr("sources.colType", "Quellenart"),
      auswahl("source_type", korpusWert("source_type", source.type || "sonstiges"), typEintraege, false),
      source.type || "", String((korpus && korpus.source_type) || ""),
      featureSourceTypeLabel(korpus && korpus.source_type))
    + korpusFeld("license", tr("sources.colLicense", "Lizenz"),
      auswahl("license", korpusWert("license", source.license || ""), lizenzEintraege, false),
      source.license || "", String((korpus && korpus.license) || ""),
      (lizenzTafel[String((korpus && korpus.license) || "")] || {}).label || "")
    + korpusFeld("attribution", tr("sources.add.attribution", "Namensnennung"),
      text("attribution", korpusWert("attribution", source.attribution || ""), tr("sources.edit.attributionHint", "z. B. VolkoV / garetien.de"), false),
      source.attribution || "", String((korpus && korpus.attribution) || ""),
      String((korpus && korpus.attribution) || ""))
    // ⚠️ Der Kanon-Haken traegt sein „nur diese Quelle" ebenso -- er ist das Feld, das der Upsert
    // bis zum 02.09.2026 als EINZIGES bedingungslos ueberschrieb, und damit das gefaehrlichste.
    + '<label class="fs-check' + (eigen.indexOf("is_official") !== -1 ? " fs-field--eigen" : "") + '">'
    + '<input type="checkbox" data-fs-field="is_official" data-fs-orig="'
    + (korpusHaken ? "1" : "0") + '"' + (korpusHaken ? " checked" : "") + (wikiOwned ? " disabled" : "")
    + "> " + escape(tr("sources.add.official", "offiziell"))
    // ⚠️ Auch hier der Korpuswert durchgestrichen, wenn er wirklich abweicht -- sonst ist „nur
    // diese Quelle" angehakt und niemand sieht, WOVON abgewichen wird.
    + ((eigen.indexOf("is_official") !== -1 && korpus && korpus.known === true
        && (korpus.is_official === true) !== (source.official === true))
      ? '<span class="wiki-alt"><span class="dt-old">'
        + escape(korpus.is_official === true ? tr("sources.edit.yes", "offiziell") : tr("sources.edit.no", "nicht offiziell"))
        + "</span></span>"
      : "")
    + '<span class="fs-eigen"><input type="checkbox" data-fs-own="is_official"'
    + ' data-fs-own-orig="' + (eigen.indexOf("is_official") !== -1 ? "1" : "0") + '"'
    + (eigen.indexOf("is_official") !== -1 ? " checked" : "")
    + "> " + escape(tr("sources.edit.ownField", "nur diese Quelle")) + "</span>"
    + "</label>"
    + "</div>"
    // Die DRITTE Herkunft -- wer den Korpus zuletzt angefasst hat. Ohne sie schwiege der Kasten
    // ausgerechnet bei der Gruppe, deren Änderung am weitesten reicht.
    + featureSourceHerkunftZeile(korpus && korpus.updated, {
      mitName: "sources.edit.byCorpus", mitNameText: "Korpus zuletzt geändert von {wer} am {wann}",
      ohneName: "sources.edit.byCorpusAnon", ohneNameText: "Korpus zuletzt geändert am {wann}",
    }, escape, tr)
    + "</div>"
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
    // 🔴 BESCHRIFTETE FELDER, nicht nur Platzhalter (Owner 02.09.2026 am Mockup: „das war das
    // mockup"). Ein Platzhalter verschwindet, sobald jemand tippt -- und danach weiss niemand mehr,
    // welches der acht Felder er gerade fuellt. Die Vorlage ist
    // docs/bekannte-quellen-mockup.html, Schritt 2.
    // ⚠️ Die Klassen der Bedienelemente bleiben unveraendert (`.fs-add-url`, `.fs-add-label`, …):
    // an ihnen haengen fuenf Tests und die ganze Verdrahtung. Neu ist nur die Huelle darum.
    '<div class="fs-row fs-row--add" data-fs-add>' +
    // 🔴 DIE ADRESSE BEKOMMT IHREN EIGENEN RAHMEN, und seine Aufschrift ist die ANLEITUNG (Owner
    // 02.09.2026, Wortlaut): sie steht dort, wo sie gilt, statt in einem Hinweistext daneben. Der
    // Rahmen sagt zugleich, wie weit das Einfügen reicht -- Adresse UND Titel entstehen daraus.
    '<span class="fs-adresse">' +
    '<span class="fs-adresse__l">' +
    escape(tr("sources.add.pasteGroup", "Nur Adresse (URL) der Quelle einfügen — automatische Erkennung des Korpus")) +
    "</span>" +
    // Adresse — das einzige Feld, das der Editor im Normalfall wirklich tippt.
    // 💣 Der Platzhalter nennt die GENAUE SEITE und warnt vor der Startseite: live zeigen vier
    // Katalogzeilen auf `wiki.punin.de/`, und eine (`liebliches-feld.net`) auf eine beliebige
    // Bilddatei -- für 31 der 32 Objekte, an denen sie hängt, ist das die falsche Adresse.
    '<label class="fs-af fs-af--url"><span class="fs-af__l">' +
    escape(tr("sources.add.urlLabel", "Adresse — die genaue Seite")) + "</span>" +
    '<input type="text" class="fs-add-url" inputmode="url" spellcheck="false" placeholder="' +
    escape(tr("sources.add.urlPlaceholder", "https://… — die Seite über DIESES Objekt, nicht die Startseite")) +
    '">' +
    // ⭐ DER GRÜNE HAKEN (Owner 02.09.2026), und er sitzt IM Feld, nicht daneben. Als Geschwister
    // der Beschriftung landete er im Umbruch der Flex-Zeile und schob den Titel eine Zeile tiefer
    // — im Bild gesehen, von keinem Test.
    // 🔴 Er ist NICHT dasselbe wie der grüne Prüfknopf: der sagt „ich habe nachgesehen", der Haken
    // sagt „es wurde etwas gelesen". ⚠️ `aria-hidden`, weil der Satz darunter (`data-fs-note`,
    // `role=status`) es bereits in Worten sagt — ein Vorleser bekäme es sonst zweimal.
    '<span class="fs-add-ok" data-fs-ok hidden aria-hidden="true">✓</span></label>' +
    // Der Prüfknopf (Owner 02.09.2026). 🔴 Er ist der Grund, warum das Formular NIE auf einen
    // fremden Server wartet: der Abruf ist ein Handgriff, kein Nebeneffekt des Tippens. Einfügen
    // und Enter lösen ihn ebenfalls aus -- das Feld steht in keinem <form>, Enter war bis hierher
    // wirkungslos, es wird also keine Gewohnheit gebrochen.
    // 💣 DREI Zustände, nicht zwei: „erreichbar, aber nichts zu lesen" ist weder Erfolg noch
    // Fehlschlag. Wäre es rot, suchte der Editor einen Fehler am Link, den es nicht gibt.
    // ⚠️ Er steht NEBEN dem Label, nicht darin: ein `<button>` in einem `<label>` erbt dessen
    // Aktivierungsverhalten, und der Klick gälte dann auch dem Eingabefeld.
    '<button type="button" class="fs-add-check" data-fs-check title="' +
    escape(tr("sources.add.checkHint", "Adresse prüfen und Titel übernehmen")) + '" aria-label="' +
    escape(tr("sources.add.checkHint", "Adresse prüfen und Titel übernehmen")) + '">⟳</button>' +
    '<label class="fs-af fs-af--grow"><span class="fs-af__l">' +
    escape(tr("sources.add.labelLabel", "Titel — wie diese Seite heißt")) + "</span>" +
    '<input type="text" class="fs-add-label" placeholder="' + escape(tr("sources.add.label", "Quellenname")) + '"></label>' +
    "</span>" +
    // 🔴 DER KORPUS -- die Sammlung, aus der die Seite stammt. Sein SCHLÜSSEL ist die registrierbare
    // Domain und wird gerechnet, nie getippt; hier steht nur seine BESCHRIFTUNG. Die Meta-Zeile
    // daneben nennt den Schlüssel und die Reichweite, damit sichtbar ist, was eine Umbenennung
    // trifft (Entwurf §3, Mockup Schritt 2).
    // 🔴 DER RAHMEN ZIEHT DIE GRENZE (Owner 02.09.2026: „du kannst gerne alles einrahmen, was zum
    // korpus gehört (seiten z.b. nicht)"). Was hier drinsteht, gilt fuer ALLE Belege dieses Wirts;
    // was draussen steht, gehoert dieser einen Fundstelle. Ohne die sichtbare Grenze sieht ein
    // Editor der Zeile nicht an, dass ein Griff zur Lizenz 50 Objekte trifft.
    // ⚠️ VOR dem Korpuskasten, nicht dahinter (Owner-Pfeil im Bild vom 02.09.2026): erst das, was
    // DIESE Fundstelle beschreibt, dann der Wirt. Dieselbe Ordnung wie im Bearbeiten-Kasten, wo
    // „Nur an diesem Objekt" ebenfalls oben steht -- „für edit/neu", sagte der Owner.
    // ⚠️ `data-fs-meins` markiert die zwei Felder, die NUR an dieser Fundstelle gelten. Bei einer
    // bekannten Seite sind sie das Einzige, was der Editor noch zu füllen hat — dann werden sie
    // hervorgehoben. Der Marker steht im Markup, damit die Hervorhebung keine Selektorliste
    // pflegen muss, die beim nächsten Feld auseinanderläuft.
    '<label class="fs-af fs-af--pages" data-fs-meins><span class="fs-af__l">' +
    escape(tr("sources.add.pages", "Seite(n)")) + "</span>" +
    '<input type="text" class="fs-add-pages" placeholder="' + escape(tr("sources.add.pagesHint", "optional")) + '"></label>' +
    '<label class="fs-af fs-af--kind" data-fs-meins><span class="fs-af__l">' + escape(tr("sources.add.kindLabel", "Abdeckung")) + "</span>" +
    '<select class="fs-add-kind" title="' + escape(tr("sources.add.kind", "Abdeckung: Ausführlich/Ergänzend → Offiziell-Tab, Erwähnung → Erwähnt-Tab, sonst normale Quellenzeile")) + '">' + kindOptions + "</select></label>" +
    // 🔴 DER RAHMEN STEHT IMMER. Er war einen Tag lang `hidden`, bis eine Adresse einen Korpus
    // ergab -- und hat dabei Art, Lizenz und Namensnennung mitversteckt, die mit dem Korpus nichts
    // zu tun haben: die leere Maske konnte danach WENIGER als vor dem ganzen Umbau (vier Felder),
    // und der Owner meldete „wieso habe ich jetzt wieder das alte Eingabeformular". Der Riegel
    // gehörte an EIN Feld (den Korpusnamen), nicht an den Kasten.
    // 🔴 GEBLIEBEN IST DER RAHMEN SELBST (Owner 02.09.2026: „Gilt für den ganzen Korpus finde ich
    // gut, weil man dann weiß: wenn ich da was änder, änderts das für alle quellen aus dem
    // korpus"). Was hier drinsteht, gilt ALLEN Belegen dieses Wirts; was draussen steht, gehört
    // dieser einen Fundstelle.
    // 💣 UND DIE AUFSCHRIFT TRÄGT DIE REICHWEITE. „Gilt für den ganzen Korpus" ohne Grösse ist
    // keine Warnung -- dieselbe Regel wie bei `.fs-edit__scope` im ✎, wo die Zahl seit dem
    // 01.09.2026 danebensteht. Drei Zustände, siehe `uebernehmeKorpus`.
    '<span class="fs-korpus" data-fs-korpus-gruppe>' +
    // ⚠️ Der Anfangstext steht IM MARKUP, nicht in einem Aufruf danach: `uebernehmeKorpus(null)`
    // läuft beim Zurücksetzen, aber nicht zwangsläufig nach dem ersten Zeichnen -- und ein leerer
    // Zusatz läse sich als „gilt für alle" ohne jede Einschränkung.
    '<span class="fs-korpus__l">' + escape(tr("sources.add.corpusGroup", "Gilt für den ganzen Korpus")) +
    '<span class="fs-korpus__scope" data-fs-korpus-scope> — ' +
    escape(tr("sources.add.corpusScopeNone", "welcher, sagt die Adresse")) + "</span></span>" +
    '<label class="fs-af fs-af--korpus"><span class="fs-af__l">' +
    escape(tr("sources.add.corpusLabel", "Name des Korpus")) +
    '<span class="fs-af__meta" data-fs-corpus-meta></span></span>' +
    '<input type="text" class="fs-add-corpus" data-fs-corpus placeholder="' +
    escape(tr("sources.add.corpusPlaceholder", "aus der Adresse")) + '"></label>' +
    // 🔴 DIE FORM -- die EINE Eigenschaft, die ein Korpus tragen MUSS: sie entscheidet, welcher
    // der beiden Namen dem Besucher vorn steht. Bei einem WERK der Titel („Geographia
    // Aventurica"), bei einer BELEGSTELLE der Korpusname („Briefspiel (Weiden)").
    // 💣 DREI Werte, nicht zwei. „— noch offen —" ist ein eigener Zustand und verhält sich wie
    // „Werk", also wie heute: bei einem frischen Korpus mit einer Zeile sagt das Verhältnis
    // Titel/Zeilen nichts, und wer die Form dort rät, trifft in gut der Hälfte der Fälle daneben
    // und behauptet dabei, es gemessen zu haben.
    '<label class="fs-af fs-af--form"><span class="fs-af__l">' +
    escape(tr("sources.add.formLabel", "Form")) +
    '<span class="fs-af__meta" data-fs-form-meta></span></span>' +
    '<select class="fs-add-form" data-fs-form>' +
    '<option value="">' + escape(tr("sources.add.formOpen", "— noch offen —")) + "</option>" +
    '<option value="werk">' + escape(tr("sources.add.formWork", "Werke (Titel vorn)")) + "</option>" +
    '<option value="belegstelle">' + escape(tr("sources.add.formCite", "Belegstellen (Korpus vorn)")) + "</option>" +
    "</select></label>" +
    // Instruction 5a requires the form to SAY which case occurred -- without this an editor cannot
    // tell whether they just referenced the existing source or minted a duplicate.
    '<span class="fs-add-picked" data-fs-picked hidden>' +
    escape(tr("sources.add.picked", "bestehende Quelle")) +
    '<button type="button" class="fs-add-picked__x" data-fs-unpick aria-label="' +
    escape(tr("sources.add.unpick", "Auswahl aufheben")) + '">✕</button>' +
    "</span>" +
    // ⚠️ Die vier Marker „· vom Korpus" hängen an einem `hidden`-Attribut und werden gesetzt, wenn
    // der Korpus den Wert wirklich vorgibt. Ein dauerhaft sichtbarer Marker wäre eine Behauptung.
    '<label class="fs-af fs-af--art"><span class="fs-af__l">' + escape(tr("sources.add.typeLabel", "Art")) +
    '<span class="fs-af__from" data-fs-from="type" hidden> · ' + escape(tr("sources.add.fromCorpus", "vom Korpus")) + "</span></span>" +
    '<select class="fs-add-type">' + options + "</select></label>" +
    '<label class="fs-af fs-af--license"><span class="fs-af__l">' + escape(tr("sources.add.licenseLabel", "Lizenz")) +
    '<span class="fs-af__from" data-fs-from="license" hidden> · ' + escape(tr("sources.add.fromCorpus", "vom Korpus")) + "</span></span>" +
    '<select class="fs-add-license" title="' + escape(tr("sources.add.licenseHint", "Unter welcher Lizenz steht die Quelle? Leer heißt „nicht erfasst“, nicht „keine Lizenz“.")) + '">' + licenseOptions + "</select></label>" +
    '<label class="fs-af fs-af--grow"><span class="fs-af__l">' +
    escape(tr("sources.add.attributionLabel", "Namensnennung bzw. mit freundlicher Genehmigung von")) +
    '<span class="fs-af__from" data-fs-from="attribution" hidden> · ' + escape(tr("sources.add.fromCorpus", "vom Korpus")) + "</span></span>" +
    '<input type="text" class="fs-add-attribution" placeholder="' + escape(tr("sources.add.attribution", "Namensnennung")) + '" title="' + escape(tr("sources.add.attributionHint", "Wen die Lizenz zu nennen verlangt, z. B. „VolkoV / garetien.de“.")) + '"></label>' +
    '<label class="fs-add-official-label">' +
    '<input type="checkbox" class="fs-add-official"> ' + escape(tr("sources.add.official", "offiziell")) +
    '<span class="fs-af__from" data-fs-from="official" hidden> · ' + escape(tr("sources.add.fromCorpus", "vom Korpus")) + "</span>" +
    "</label>" +
    "</span>" +
    '<button type="button" class="fs-row__add" data-fs-add-submit>' + escape(tr("sources.add.submit", "Hinzufügen")) + "</button>" +
    // ⚠️ Ein Abbrechen daneben (Owner 02.09.2026). Es LEERT die Zeile -- es schliesst nichts, denn
    // die Eingabezeile ist kein Fenster, sondern der Fuss der Liste. Weich statt gefuellt: eine
    // Zeilenhandlung ist nie die Haupthandlung der Seite (AGENTS.md §12).
    '<button type="button" class="fs-row__cancel" data-fs-add-cancel>' + escape(tr("sources.add.cancel", "Abbrechen")) + "</button>" +
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
    const wert = el.type === "checkbox" ? (el.checked ? "1" : "0") : String(el.value || "");
    if (wert !== orig) {
      felder[name] = name === "is_official" ? wert === "1" : wert;
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
 * ⚠️ Gesperrte Häkchen zählen nicht mit -- sie tragen den Bestand, nicht eine Wahl.
 */
function featureSourceOwnFieldsFromPanel(panel) {
  const liste = [];
  let geaendert = false;
  if (!panel || typeof panel.querySelectorAll !== "function") {
    return { liste, geaendert };
  }
  Array.prototype.forEach.call(panel.querySelectorAll("[data-fs-own]"), (el) => {
    if (el.disabled) {
      return;
    }
    const name = el.getAttribute("data-fs-own");
    const jetzt = el.checked === true;
    if (jetzt) {
      liste.push(name);
    }
    if (jetzt !== (el.getAttribute("data-fs-own-orig") === "1")) {
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
    feld.classList.toggle("fs-add-url--gut", wert !== "" && featureSourceUrlLooksValid(wert));
    feld.classList.toggle("fs-add-url--schlecht", wert !== "" && !featureSourceUrlLooksValid(wert));
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
    const knopf = containerEl.querySelector("[data-fs-add-submit]");
    if (knopf) {
      knopf.textContent = an
        ? tr("sources.add.link", "Verknüpfen")
        : tr("sources.add.submit", "Hinzufügen");
    }
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
  function uebernehmeKorpus(korpus) {
    letzterKorpus = korpus || null;
    const feld = containerEl.querySelector("[data-fs-corpus]");
    const meta = containerEl.querySelector("[data-fs-corpus-meta]");
    const scope = containerEl.querySelector("[data-fs-korpus-scope]");
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
      ["type", "license", "attribution", "official"].forEach((n) => marker(n, false));
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
      scope.textContent = objekte === 0
        ? " — " + tr("sources.add.corpusScopeNew", "{key} ist neu, du legst ihn hiermit an")
          .replace("{key}", String(korpus.corpus_key || ""))
        : " „" + name + "“ — "
          + tr("sources.add.corpusScopeReach", "{q} Quellen · {n} Objekte")
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

    // Die Form und ihr Vorschlag. ⚠️ Vorgeschlagen wird NUR gerechnet, nie gesetzt: der Server
    // schlägt ab drei Zeilen vor (`avesmapsSourceCorpusFormSuggestion`), darunter schweigt er.
    const formFeld = containerEl.querySelector("[data-fs-form]");
    if (formFeld) {
      formFeld.value = String(korpus.form || "");
    }
    const formMeta = containerEl.querySelector("[data-fs-form-meta]");
    if (formMeta) {
      const vorschlag = String(korpus.form_suggestion || "");
      formMeta.textContent = (!korpus.form && vorschlag)
        ? " · " + tr("sources.add.formHint", "sieht nach {was} aus")
          .replace("{was}", vorschlag === "belegstelle"
            ? tr("sources.add.formCiteShort", "Belegstellen")
            : tr("sources.add.formWorkShort", "Werken"))
        : "";
    }
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
    // 🔴 Die FORM nur, wenn ein Mensch sie ausdrücklich gewählt hat. Sie wird nie gerechnet:
    // bei einem frischen Korpus mit einer Zeile sagt das Verhältnis Titel/Zeilen nichts, und ein
    // geratener Wert entscheidet, welcher Name dem Besucher vorn steht.
    // ⚠️ Ohne diese Zeile fiele die Wahl still weg: `speichereKorpusFeld` greift nur bei einem
    // BEKANNTEN Korpus, und beim ersten Eintrag ist er das per Definition nicht.
    const formFeld = containerEl.querySelector("[data-fs-form]");
    const gewaehlteForm = String((formFeld && formFeld.value) || "");
    if (gewaehlteForm !== "") {
      felder.form = gewaehlteForm;
    }
    return Object.keys(felder).length > 0 ? { key: korpus.corpus_key, felder: felder } : null;
  }

  /**
   * Legt den Korpus an. ⚠️ Still im Erfolgsfall: der Editor hat gerade eine Quelle eingetragen,
   * und dass dabei nebenbei ein Wirt bekannt wurde, ist keine Nachricht für ihn -- sichtbar wird
   * es beim NÄCHSTEN Eintrag derselben Domain, und genau dort gehört es hin.
   * 🔴 Ein Fehlschlag wird dagegen gesagt: sonst wundert sich beim nächsten Mal jemand, warum
   * nichts vorbelegt ist.
   */
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
    // ⚠️ Die Form steht mit in der Liste, WIRD aber nicht auf die Quellen durchgeschrieben --
    // sie sagt, welcher Name vorn steht, und ist keine Eigenschaft einer einzelnen Quelle.
    // Der Server entscheidet das (AVESMAPS_SOURCE_CORPUS_OWNED_FIELDS), nicht diese Liste.
    { selektor: ".fs-add-form", feld: "form" },
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
    if (event.target.closest("[data-fs-add-cancel]")) {
      // ⚠️ Es LEERT, es schliesst nicht: die Eingabezeile ist der Fuss der Liste und bleibt stehen.
      // 💣 Der Korpuskasten muss MIT weg -- er gehoert der Adresse, die gerade verworfen wurde;
      // bliebe er stehen, stuende der Wirt der alten Adresse ueber einem leeren Feld und die
      // naechste Eingabe uebernaehme lautlos dessen Art und Lizenz.
      leereAddZeile();
      return;
    }
    const addTarget = event.target.closest("[data-fs-add-submit]");
    if (addTarget) {
      const values = readAddRowValues();
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
      // 🔴 DER ERSTE EINTRAG AUF EINER DOMAIN LEGT IHREN KORPUS AN -- sonst gäbe es ihn NIE.
      // Bis hierher entstand eine Korpuszeile nur beim Umbenennen; wer den vorgeschlagenen Namen
      // stehen liess (der Normalfall, er stimmt ja), speicherte nichts. Die nächste Seite desselben
      // Wirts sah damit wieder die nackte Domain, und Schritt 2 des Entwurfs -- „alles andere steht
      // schon da" -- trat nie ein. Owner-Bild 02.09.2026, IST gegen SOLL.
      // ⚠️ VOR dem Anlegen gelesen, denn `renderFromServer` zeichnet die Zeile neu und leert sie.
      const korpusAusZeile = korpusAnlageAusZeile(values);
      const korrektur = korrekturAusZeile(values);
      const daten = await renderFromServer("add", values);
      zeigeUmtypung(daten);
      zeigeVerknuepfung(daten);
      // ⚠️ BEIDES NACH dem Verknüpfen: `update` verlangt die Verknüpfung, und ein Korpus für eine
      // Quelle, die gar nicht angelegt wurde, wäre eine Leiche.
      if (daten && korrektur) {
        await wendeKorrekturAn(korrektur);
      }
      if (daten && korpusAusZeile) {
        await legeKorpusAn(korpusAusZeile);
      }
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
