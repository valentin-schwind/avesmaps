// Pure, DOM-free source renderer for map popups/infoboxes. Two zones, each rendered ONLY when it
// has content:
//   Line 1 "Quelle(n):" — the Wiki-Aventurica page link + any hand-added (non-wiki-publication)
//     sources; always visible. Label is "Quelle:" for one item, "Quellen:" for several.
//   Line 2 "Publikationen (N):" — the wiki-reconciled publications, split into two collapsible tabs
//     (Offizielle = substantive references, Erwaehnungen = reference_kind 'erwaehnung'), each shown
//     as a Titel/Typ/Seiten table. A source counts as a wiki publication iff it carries a
//     reference_kind; everything else (manual / community / legacy other_source) is a direct source.
// Empty input (no wiki link, no sources) returns "" so the caller renders nothing.
// Injectable `escape` keeps it Node-testable. Tab expand/collapse uses a browser-only inline handler
// (avesmapsToggleSourceTab), which is re-render-safe: it survives Leaflet popup re-renders
// (autopan/zoom) because the handler lives on the element, not on a document-level listener.

var FEATURE_SOURCE_MARKUP_TYPE_LABELS = {
  regionalspielhilfe: "Regionalspielhilfe",
  abenteuer: "Abenteuer",
  aventurischer_bote: "Aventurischer Bote",
  quellenband: "Quellenband",
  roman: "Roman",
  briefspiel: "Briefspiel",
  regelbuch: "Regelbuch",
  sonstiges: "Sonstiges",
};

// 🔴 DIE LIZENZEN, die eine Quelle tragen kann -- Beschriftung und Adresse.
//
// 💣 SIE SIND DATEN GEWORDEN (Owner 27.08.2026: "quellen fehlt das lizenz-feld"). Bis dahin
// stand hier eine Wirt-Tabelle: garetien.de -> "VolkoV / garetien.de, CC BY-NC-SA 3.0", fest
// verdrahtet. Das war fuer zwei Wirte richtig und beim dritten falsch -- jede weitere Quelle
// haette eine Zeile im Renderer gebraucht, und der Editor haette die Lizenz nirgends eintragen
// koennen. Jetzt steht sie an der Quelle (`sources.license`, `sources.attribution`), und hier
// steht nur noch, wie ein Schluessel heisst und wohin er zeigt.
//
// ⚠️ Der SCHLUESSEL wird gespeichert, nie der Text: sonst laesst sich die Beschriftung nie
// umformulieren, ohne den Bestand anzufassen. Dieselbe Trennung wie beim source_type, dessen
// Whitelist in PHP steht und dessen Beschriftung hier.
// 🔴 `unfree` hat KEINE Adresse -- es gibt nichts zu verlinken, und ein Link ins Leere waere
// schlimmer als keiner.
var FEATURE_SOURCE_LICENSES = {
  "cc-by-sa-3.0": { label: "CC BY-SA 3.0", url: "https://creativecommons.org/licenses/by-sa/3.0/deed.de" },
  "cc-by-nc-sa-3.0": { label: "CC BY-NC-SA 3.0", url: "https://creativecommons.org/licenses/by-nc-sa/3.0/deed.de" },
  "cc-by-4.0": { label: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/deed.de" },
  "cc-by-sa-4.0": { label: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/deed.de" },
  "cc0-1.0": { label: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/deed.de" },
  "public-domain": { label: "Gemeinfrei", url: "" },
  unfree: { label: "Keine freie Lizenz", url: "" },
};

/**
 * Die Lizenzangabe einer Quelle als Text -- "" wenn nichts erfasst ist.
 *
 * ⚠️ LEER IST NICHT "KEINE LIZENZ". Eine Quelle ohne Eintrag zeigt gar nichts; wer "keine freie
 * Lizenz" sagen will, sagt es mit dem Schluessel `unfree`. Die beiden zu verwechseln waere eine
 * Rechtsaussage, die niemand getroffen hat -- und sie stuende dann an 1374 Quellen.
 *
 * ⚠️ Die Namensnennung allein reicht ebenfalls: eine Quelle darf sagen, wen sie nennt, ohne dass
 * jemand die Lizenz eingetragen hat. Beides sind getrennte Angaben, weil CC beides getrennt
 * verlangt -- WAS gilt und WEN man nennt.
 */
function featureSourceLicenseText(source) {
  var s = source || {};
  var eintrag = FEATURE_SOURCE_LICENSES[String(s.license || "").trim()] || null;
  var wer = String(s.attribution == null ? "" : s.attribution).trim();
  if (!eintrag && !wer) { return { text: "", url: "" }; }
  var teile = [];
  if (wer) { teile.push(wer); }
  if (eintrag) { teile.push(eintrag.label); }

  return { text: teile.join(", "), url: eintrag ? eintrag.url : "" };
}

// Ab wie vielen Einzelseiten eine Angabe gekuerzt wird. 🔴 Owner 24.08.2026: „lange seitenzahl-
// angaben mit ... abkuerzen (oder 1. seite und dann mit ff.)".
// ⚠️ DREI bleiben stehen: „S. 91, 92" und „S. 8, 15, 80" liest man in einem Blick, und `ff.` waere
// dort eine Verschlechterung -- es sagt „und folgende" und behauptet eine Fortsetzung, die es nicht
// gibt. Am Livebestand 24.08.2026 gemessen: 54.571 Angaben, 17,2 % davon ueber drei Einzelseiten,
// die laengste 31 Eintraege / 120 Zeichen.
var FEATURE_SOURCE_PAGES_MAX = 3;

// 💣 DIESE Datei ist die EINE Stelle. Die Angabe steht in ZWEI Oberflaechen -- der Infobox, die
// jeder Besucher sieht (hier), und dem Quellen-Editor (`js/review/review-feature-sources.js`) --,
// und beide zeigen dieselbe Spalte derselben Zeile. Eine Regel, die einen von zwei Erzeugern
// bindet, ist keine Regel; deshalb laedt jede Seite mit dem Editor auch diese Datei.
//
// 🔴 `ff.` statt `…`: es ist die uebliche Zitierform und sagt AUS, was es meint -- „und folgende".
// Drei Punkte sagen nur „hier fehlt etwas" und laden zum Raten ein, wie viel.
// ⚠️ Die VOLLE Angabe geht nicht verloren, sie wandert in den Titel des Elements. Eine Kuerzung,
// die das Gekuerzte wegwirft, ist Datenverlust in der Anzeige.
// 💣 Ein BEREICH wird nie gekuerzt: „16-122" ist schon kurz, und `ff.` machte daraus eine andere
// Aussage -- offenes Ende statt bekanntem Ende. Er traegt kein Komma und faellt schon durch die
// Zaehlung heraus.
function featureSourceShortenPages(pages) {
  var voll = String(pages == null ? "" : pages).trim();
  if (voll === "") {
    return { kurz: "", voll: "", gekuerzt: false };
  }
  var teile = voll.split(",").map(function (t) { return t.trim(); })
    .filter(function (t) { return t !== ""; });
  if (teile.length <= FEATURE_SOURCE_PAGES_MAX) {
    return { kurz: teile.join(", "), voll: voll, gekuerzt: false };
  }
  return { kurz: teile[0] + " ff.", voll: voll, gekuerzt: true };
}

/**
 * DER KANON-STEMPEL an einer einzelnen Quelle.
 * Entwurf: docs/superpowers/specs/2026-08-27-kanon-etikett-design.md
 *
 * 🔴 ER ERSETZT DEN STERN. Bis zum 01.09.2026 markierte ein `*` die offizielle Quelle --
 * unerklaert, unerklaerbar klein, und in einer gemischten Liste trug er die ganze Last. Ein Wort
 * muss niemand nachschlagen.
 *
 * 💣 UND ER BEFREIT DIE TYPMARKE. Die trug vorher ZWEI Aussagen: was fuer eine Quelle das ist
 * (Beschriftung) und ob sie im Kanon steht (Farbe). Eine Bedeutung zu viel fuer ein Element --
 * seit der Stempel den Kanon sagt, ist die Typmarke neutral, und Farbe traegt auf der ganzen
 * Flaeche genau eine Bedeutung: Gold = im Kanon, Blaugruen = nicht.
 *
 * ⚠️ Farbe allein ist keine Auszeichnung: der Wortlaut steht IM Element, nicht nur im `title`.
 */
function featureSourceKanonMarkup(official, esc, labels) {
  var offiziell = Boolean(official);
  var text = offiziell ? (labels.official || "Offiziell") : (labels.unofficial || "Inoffiziell");
  return '<span class="fs-kanon fs-kanon--' + (offiziell ? "off" : "inoff") + '">' + esc(text) + "</span>";
}

/**
 * DER BEZEICHNER als Text -- „von wem stammt das?". Leer, wenn die Ableitung keinen mitgibt.
 *
 * 🔴 DER TEXT ENTSTEHT HIER, NICHT IM SERVER. Die Ableitung schickt DATEN: entweder
 * `bezeichner_label` (alle inoffiziellen Quellen tragen denselben Namen -- der haeufige Fall,
 * „Briefspiel (Garetien)") oder `bezeichner_type` + `bezeichner_count`, aus denen hier
 * „Briefspiel (2)" wird. Dieselbe Trennung wie beim `source_type`: wer den fertigen Satz
 * speichert, kann ihn nie uebersetzen und nie umformulieren, ohne den Bestand anzufassen.
 *
 * ⚠️ Nur die ANZAHL ohne Typ ergibt keinen Bezeichner. „(2)" allein sagt nichts darueber, von
 * wem etwas stammt -- dann bleibt es bei der einfachen Pille ohne zweites Feld.
 */
function featureKanonBezeichnerText(kanon, typeLabels) {
  if (!kanon) {
    return "";
  }
  var label = String(kanon.bezeichner_label == null ? "" : kanon.bezeichner_label).trim();
  if (label) {
    return label;
  }
  var typ = String(kanon.bezeichner_type == null ? "" : kanon.bezeichner_type).trim();
  if (!typ) {
    return "";
  }
  var name = (typeLabels && typeLabels[typ]) || typ;
  var anzahl = Number(kanon.bezeichner_count);
  return anzahl > 1 ? name + " (" + anzahl + ")" : name;
}

/**
 * DAS KOPF-ETIKETT -- die Halbpille aus dem Objektkopf. "" wenn nichts anzuzeigen ist.
 * Entwurf: docs/superpowers/specs/2026-08-27-kanon-etikett-design.md §3, §4.1
 *
 * ⭐ DIE HALBPILLE IST GEWAEHLT, WEIL SIE DIE UNVOLLSTAENDIGKEIT DES EINTRAGS UNTERSTREICHT
 * (Owner 27.08.2026). Ein Chip, dessen zweites Feld sagt, dass hier noch etwas offen ist: wer
 * geschrieben hat, was nicht im Kanon steht.
 *
 * 🔴 DAS RECHTE FELD IST NEUTRAL, NIE BLAUGRUEN. Neben einem blaugruenen INOFFIZIELL stossen
 * sonst zwei Blaugruen aneinander und der Chip wird ein Farbfeld mit einer Naht darin. Neutral
 * traegt er in beiden Kanonlagen dieselbe Form.
 *
 * 🔴 KEIN ROT FUER „INOFFIZIELL". Die Briefspiele sind der Grund, warum wir die Inhalte
 * ueberhaupt haben; ein Warnrot machte aus einer HERKUNFTSANGABE eine Qualitaetsaussage. Rot
 * bleibt Fehlern vorbehalten.
 *
 * ⚠️ OHNE BEZEICHNER BLEIBT ES EINE GANZE PILLE. Ein leeres zweites Feld waere eine Naht ohne
 * Inhalt -- der haeufigste Fall ist genau das: „offiziell" trennt nichts auf.
 *
 * ⚠️ Farbe allein ist keine Auszeichnung: der Wortlaut steht IM Element. Die zwei Felder sind
 * durch ein `·` im `aria-label` getrennt, weil ein Vorleser die Naht sonst nicht hoert.
 */
function featureKanonBadgeMarkup(kanon, esc, labels, typeLabels) {
  if (!kanon || !kanon.kanon) {
    return "";
  }
  var offiziell = kanon.kanon === "offiziell";
  var zustand = offiziell ? (labels.official || "Offiziell") : (labels.unofficial || "Inoffiziell");
  var bezeichner = featureKanonBezeichnerText(kanon, typeLabels);
  var art = offiziell ? "off" : "inoff";
  if (!bezeichner) {
    return '<span class="fs-kanon fs-kanon--' + art + '">' + esc(zustand) + "</span>";
  }
  return '<span class="fs-kanon fs-kanon--' + art + ' fs-kanon--split" aria-label="'
    + esc(zustand + " · " + bezeichner) + '">'
    + '<span class="fs-kanon__state">' + esc(zustand) + "</span>"
    + '<span class="fs-kanon__by">' + esc(bezeichner) + "</span>"
    + "</span>";
}

function buildSourceListMarkup(wikiUrl, sources, opts) {
  opts = opts || {};
  var wikiLabel = opts.wikiLabel || "Wiki";
  var wikiLicenseLabel = opts.wikiLicenseLabel || "";
  var wikiLicenseUrl = opts.wikiLicenseUrl || "";
  var officialTooltip = opts.officialTooltip || "offizielle Quelle";
  var mentionTooltip = opts.mentionTooltip || "";
  var sourceLabelSingular = opts.sourceLabelSingular || "Quelle";
  var sourceLabelPlural = opts.sourceLabelPlural || "Quellen";
  var publicationsLabel = opts.publicationsLabel || "Publikationen:";
  var officialTabLabel = opts.officialTabLabel || "Offiziell";
  var mentionedTabLabel = opts.mentionedTabLabel || "Erwähnt";
  // Die Rechtetafel hinter dem ⓘ. Wie alle Beschriftungen hier injizierbar, damit die i18n-
  // Schicht (M8) sie uebersetzen kann, ohne diese Datei anzufassen.
  var rightsButtonLabel = opts.rightsButtonLabel || "Rechte und Namensnennung";
  var rightsAttributionLabel = opts.rightsAttributionLabel || "Nennung";
  // Die zwei Saetze, die erklaeren, was das Kanon-Etikett behauptet (Owner-Wortlaut 02.09.2026).
  // `{art}` ist die Art der Quelle in Klammern -- oder leer, wo sie keine Aussage ist.
  // 🔴 DIE KORPORA -- Schluessel → { label, form }. Sie entscheiden, welcher der beiden Namen dem
  // Besucher vorn steht. ⚠️ Fehlen sie (alter Client, Korpus-Modul aus, Fehler beim Lesen), bleibt
  // die Anzeige exakt wie vor dem Umbau: Titel vorn. Der Rueckfall ist der bisherige Zustand, nie
  // ein leerer Name.
  var corpora = (opts.corpora && typeof opts.corpora === "object") ? opts.corpora : {};
  var rightsKanonLabel = opts.rightsKanonLabel || "Kanon";
  var rightsTitleLabel = opts.rightsTitleLabel || "Titel";
  var kanonOfficialText = opts.kanonOfficialText
    || "Offiziell — bei Ulisses erschienen. In offiziellen Nachschlagwerken nachzulesen.";
  var kanonUnofficialText = opts.kanonUnofficialText
    || "Inoffiziell — Fanmaterial{art}. In offiziellen Nachschlagwerken steht es so nicht.";
  var rightsLicenseLabel = opts.rightsLicenseLabel || "Lizenz";
  var rightsUrlLabel = opts.rightsUrlLabel || "Adresse";
  var tableHeaders = opts.tableHeaders || {};
  var titleHeader = tableHeaders.title || "Titel";
  var typeHeader = tableHeaders.type || "Typ";
  var pagesHeader = tableHeaders.pages || "Seiten";
  var typeLabels = opts.typeLabels || FEATURE_SOURCE_MARKUP_TYPE_LABELS;
  var esc = opts.escape || function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };
  var typeLabel = function (t) {
    var key = String(t == null ? "" : t).trim();
    return key ? (typeLabels[key] || key) : "";
  };
  // 🔴 Eine eigene Typmarke (`.fs-src-type`) gibt es in der Quellenzeile NICHT mehr: die Art der
  // Quelle ist das zweite Feld der Halbpille (siehe unten). `typeLabel` bleibt -- die
  // Publikationstabelle hat eine eigene Spalte „Typ" und braucht dort reinen Text, keinen Chip.
  // Line-1 page citation for a direct/own source (e.g. a manually added publication). The tabbed
  // publication table has its own "Seiten" column, so this "S. …" form is only for line 1.
  var pagesInline = function (p) {
    var s = featureSourceShortenPages(p);
    if (!s.kurz) { return ""; }
    var titel = s.gekuerzt ? ' title="S. ' + esc(s.voll) + '"' : "";
    return '<span class="fs-src-pages"' + titel + ">S. " + esc(s.kurz) + "</span>";
  };
  var link = function (url, inner) {
    return '<a class="fs-src-a" href="' + esc(url) + '" target="_blank" rel="noopener">' + inner + ' <span class="fs-src-ext" aria-hidden="true">↗</span></a>';
  };
  // Gedaempfte Variante fuer den Lizenzhinweis: er steht NEBEN der Quelle, ist aber selbst keine.
  // Ohne Beschriftung oder Adresse rendert er nichts -- der reine Renderer behauptet keine Lizenz,
  // die ihm niemand mitgegeben hat.
  var wikiLicenseMarkup = function () {
    if (!wikiLicenseLabel || !wikiLicenseUrl) {
      return "";
    }
    return '<a class="fs-src-lic" href="' + esc(wikiLicenseUrl) + '" target="_blank" rel="noopener">' +
      esc(wikiLicenseLabel) + ' <span class="fs-src-ext" aria-hidden="true">↗</span></a>';
  };

  var kanonLabels = opts.kanonLabels || {};
  // 🔴 DER KASTEN. Der Quellenblock klemmte bisher zwischen der letzten Datenzeile und der
  // naechsten Ueberschrift und las sich wie eine weitere Datenzeile -- obwohl er etwas anderes
  // tut: er sagt, WOHER alles darueber stammt. Owner 27.08.2026.
  /**
   * Eine Quelle, eine Zeile: links Titel (kuerzt) und Lizenz (kuerzt NIE), rechts die feste Gruppe
   * aus ⓘ und Etikett. Die Rechtetafel steht als Geschwister UNTER der Zeile, aber INNERHALB des
   * <li> -- bei zwei Quellen waere sonst nicht zu sehen, wessen Rechte dort stehen, und das sind
   * zuordnungspflichtige Angaben (Entwurf 2026-08-27-kanon-etikett-design.md §4.4).
   */
  var zeile = function (titel, lizenz, marken, tafel) {
    return '<li><span class="fs-src-row"><span class="fs-src-main">' +
      '<span class="fs-src-title">' + titel + "</span>" + lizenz + "</span>" +
      '<span class="fs-src-marks">' + marken + "</span></span>" + (tafel || "") + "</li>";
  };

  /**
   * Der Knopf ⓘ und seine Tafel — sie tragen, was die Zeile nicht mehr traegt.
   *
   * 🔴 SEIT DEM 02.09.2026 TRAEGT ER IMMER ETWAS, und deshalb steht er auch immer da. Bis dahin war
   * die NAMENSNENNUNG der Ausloeser -- live tragen 3 von 1374 Katalogzeilen eine, das ⓘ war also
   * praktisch nie zu sehen. Jetzt traegt es den KANON (immer bekannt), die LIZENZ (aus der Zeile
   * hierher gewandert, Owner: „lizenz ins ⓘ, über nennung") und bei einer Belegstelle den TITEL
   * der Seite, weil vorn der Korpusname steht.
   * 💣 Die alte Regel „nur wo es etwas zu zeigen gibt" ist damit nicht gefallen, sondern erfuellt:
   * es gibt jetzt immer etwas. Wer den Kanon je wieder herausnimmt, muss den Ausloeser
   * zurueckbauen -- sonst oeffnet der Knopf bei den meisten Zeilen eine fast leere Tafel.
   *
   * 💣 INLINE-`onclick`, kein delegierter Zuhoerer. Leaflet ruft den Popup-Inhalt bei jedem
   * `_updateContent` neu auf und ersetzt das Markup; ein an einen Behaelter gehaengter Zuhoerer
   * waere danach weg. Dieselbe Begruendung wie bei `avesmapsToggleSourceTab` daneben — die Falle
   * hat dieses Haus 2026-07-08 schon einmal bezahlt („FALLE Popup-Revert").
   */
  var rechteMarkup = function (s, index, titelZusatz) {
    var wer = String((s && s.attribution) == null ? "" : s.attribution).trim();
    var id = "fsr-" + index;
    var lizEintrag = FEATURE_SOURCE_LICENSES[String((s && s.license) || "").trim()] || null;
    // 🔴 DER KANON ZUERST -- er erklaert die Pille, die in der Zeile am auffaelligsten ist.
    // Wortlaut vom Owner (02.09.2026). Er trifft die Frage, die der Kanon-Entwurf vom 27.08.
    // selbst stellt ("Gibt es das im gedruckten Aventurien?") und bleibt eine HERKUNFTSANGABE,
    // keine Wertung -- "die Briefspiele sind der Grund, warum wir die Inhalte haben".
    // ⚠️ Die Art in Klammern entfaellt bei `sonstiges` und bei fehlender Art: `sonstiges` IST die
    // Nicht-Aussage (avesmapsNormalizeSourceType), und "Fanmaterial (Sonstiges)" waere eine
    // Aussage ueber nichts. Es ist derselbe Wert wie die rechte Haelfte der Pille daneben, die
    // beiden koennen also nicht auseinanderlaufen.
    var artSchluessel = String((s && s.type) || "").trim();
    var artZusatz = (artSchluessel === "" || artSchluessel === "sonstiges")
      ? "" : " (" + typeLabel(artSchluessel) + ")";
    var zeilen = "<dt>" + esc(rightsKanonLabel) + "</dt><dd>" + esc(
      (s && s.official === true)
        ? kanonOfficialText
        : kanonUnofficialText.replace("{art}", artZusatz)
    ) + "</dd>";
    if (lizEintrag) {
      zeilen += "<dt>" + esc(rightsLicenseLabel) + "</dt><dd>" + (lizEintrag.url
        ? '<a href="' + esc(lizEintrag.url) + '" target="_blank" rel="noopener">' + esc(lizEintrag.label) +
          ' <span class="fs-src-ext" aria-hidden="true">↗</span></a>'
        : esc(lizEintrag.label)) + "</dd>";
    }
    // 🔴 DER TITEL -- nur, wenn vorn der KORPUSNAME steht. Sonst stuende er zweimal da.
    // Ohne diese Zeile ginge er bei einer Belegstelle ganz verloren, und das waere der teuerste
    // Fehler dieses Umbaus: die Seite haette dann keinen Namen mehr.
    if (titelZusatz) {
      zeilen += "<dt>" + esc(rightsTitleLabel) + "</dt><dd>" + esc(titelZusatz) + "</dd>";
    }
    if (wer) {
      zeilen += "<dt>" + esc(rightsAttributionLabel) + "</dt><dd>" + esc(wer) + "</dd>";
    }
    // 🔴 Die Adresse ist ANKLICKBAR (Owner 01.09.2026). Sie steht hier vollstaendig, waehrend der
    // Titel oben kuerzt -- und ein Link, den man sieht, aber nicht folgen kann, ist eine Sackgasse.
    if (s && s.url) {
      zeilen += "<dt>" + esc(rightsUrlLabel) + '</dt><dd><a class="fs-src-rights-url" href="' + esc(s.url) +
        '" target="_blank" rel="noopener">' + esc(s.url) +
        ' <span class="fs-src-ext" aria-hidden="true">↗</span></a></dd>';
    }
    return {
      knopf: '<button type="button" class="fs-src-info" aria-expanded="false" aria-controls="' + id +
        '" title="' + esc(rightsButtonLabel) + '" aria-label="' + esc(rightsButtonLabel) +
        '" onclick="avesmapsToggleSourceRights(this)">i</button>',
      tafel: '<div class="fs-src-rights" id="' + id + '" hidden><dl>' + zeilen + "</dl></div>"
    };
  };

  var list = Array.isArray(sources) ? sources.filter(function (s) { return s && (s.label || s.url); }) : [];
  // A wiki publication carries a reference_kind; anything without one is a direct/own source.
  var publications = list.filter(function (s) { return s.reference_kind; });
  var direct = list.filter(function (s) { return !s.reference_kind; });

  var blocks = [];

  // ----- Line 1: Quelle(n) — the wiki page link + direct/own sources -----
  var items = [];
  if (wikiUrl) {
    // 💣 Der Lizenzhinweis haengt am WIKI-Eintrag, nie an der Zeile. Wiki-Aventurica-TEXTE stehen
    // unter CC BY-SA 3.0, die uebrigen Quellen daneben (Publikationen, Briefspiele, eigene) NICHT --
    // eine Fussnote unter der ganzen Zeile behauptete die Lizenz fuer alle. Die Lizenz verlangt an
    // jeder Kopie zweierlei: die Namensnennung (der Artikel-Link) UND den Lizenzhinweis; bis zum
    // 14.08.2026 stand nur die erste Haelfte da.
    // ⚠️ DIE WIKI-ZEILE TRAEGT KEINE TYPMARKE -- sie ist gar keine Katalogquelle, sondern
    // `properties.wiki_url` am Objekt und hat deshalb keinen `source_type`. Ihr Kanon kommt vom
    // NAMENSRAUM ihres Artikels (opts.wikiOfficial), nicht aus dem Katalog.
    // ⚠️ KEIN ⓘ an der Wiki-Zeile: sie traegt keine Namensnennung (der Artikel-Link IST sie) und
    // ihre Lizenz steht schon sichtbar daneben. Es gaebe nichts aufzuklappen.
    items.push(zeile(
      link(wikiUrl, esc(wikiLabel)),
      wikiLicenseMarkup(),
      opts.wikiOfficial === undefined ? "" : featureSourceKanonMarkup(opts.wikiOfficial, esc, kanonLabels),
      ""
    ));
  }
  // Lizenz und Namensnennung einer Quelle -- ZWEI unabhaengige Verweise, keiner zeigt auf den
  // anderen. Meldung (30.08.2026): bis dahin klebte hier EIN Text aus beidem zusammen
  // ("VolkoV / garetien.de, CC BY-NC-SA 3.0") und der GANZE Text zeigte auf die Lizenzadresse --
  // ein Klick auf den Urhebernamen landete beim CC-Lizenztext, nicht beim Urheber. Jetzt rendert
  // jede Haelfte fuer sich: die Namensnennung als reiner (noch unverlinkter -- es gibt keine
  // Spalte fuer eine Urheber-Adresse) Text, die Lizenz als eigener Link auf ihre Beschreibung.
  // Fehlt eine Haelfte, entfaellt nur sie: eine Quelle darf NUR genannt werden oder NUR eine
  // Lizenz tragen, das ist kein halber Zustand (featureSourceLicenseText weiter oben).
  // 🔴 Beide stehen am EINZELNEN Eintrag, nie unter der Zeile: eine Fussnote unter der ganzen
  // Quellenzeile behauptete die Angabe auch fuer alles andere, was dort steht.
  var licenseBadgeMarkup = function (s) {
    var eintrag = FEATURE_SOURCE_LICENSES[String((s && s.license) || "").trim()] || null;
    if (!eintrag) { return ""; }
    // --attrib: sie darf umbrechen, der kurze Wiki-Hinweis nicht (css/features/feature-sources.css).
    // ⚠️ Ohne Adresse ein <span>, kein Link ins Leere -- "Gemeinfrei" und "Keine freie Lizenz"
    // haben nichts zu verlinken.
    if (!eintrag.url) {
      return '<span class="fs-src-lic">' + esc(eintrag.label) + "</span>";
    }
    return '<a class="fs-src-lic" href="' + esc(eintrag.url) +
      '" target="_blank" rel="noopener">' + esc(eintrag.label) +
      ' <span class="fs-src-ext" aria-hidden="true">↗</span></a>';
  };
  // 🔴 DIE NAMENSNENNUNG STEHT NICHT MEHR IN DER ZEILE -- sie steht hinter dem ⓘ (Owner
  // 01.09.2026: „die URL bringt um"). Sie ist der laengste Wert der Zeile, und sie durfte als
  // einzige umbrechen (`.fs-src-lic--attrib { white-space: normal }`, 27.08.2026) -- was seit der
  // einzeiligen Zeile vom 01.09. GENAU der gemeldete Fehler ist: die erste Haelfte schneidet die
  // Ellipse, die zweite rutscht darunter. Zwei Regeln aus zwei Entwurfsstufen.
  // ⚠️ Die LIZENZ bleibt sichtbar und ein echter Link: CC verlangt den Lizenzverweis an der Kopie,
  // und einen Klick tief ist er das nicht mehr (Entwurf §4.4).
  var lizenzMarkup = function (s) {
    return licenseBadgeMarkup(s);
  };
  direct.forEach(function (s, index) {
    // 🔴 WELCHER NAME STEHT VORN? Bei einer BELEGSTELLE der Korpusname („Herzogtum Weiden"), bei
    // einem WERK der Titel („Geographia Aventurica"). Owner-Entscheid, Entwurf §3.1.
    // 💣 Gemessen, warum das die Anzeige rettet: von 133 Belegstellen-Zeilen heissen live 33
    // schlicht „Briefspiel", 24 „AlmadaWiki", 32 tragen als Titel den Dateinamen
    // „Datei : Ponterra detailliert.jpg" -- und 15 gar keinen. Der Titel sagt dem Besucher dort
    // nichts; der Wirt sagt ihm, WOHER es kommt.
    // ⚠️ NUR bei `form === "belegstelle"`. Ein WERK-Korpus (f-shop, ulisses: 879 der 1384 Zeilen)
    // behaelt seinen Titel -- dort waere „f-shop.de" die schlechtere Auskunft. Und ein Korpus ohne
    // entschiedene Form verhaelt sich wie ein Werk, also wie vor diesem Umbau.
    // ⚠️ Der Link zeigt weiter auf die GENAUE Seite, nicht auf die Startseite des Wirts: wer auf
    // „Herzogtum Weiden" klickt, will die Seite ueber DIESES Objekt.
    var korpus = (s && s.corpus && corpora[s.corpus]) ? corpora[s.corpus] : null;
    var korpusName = (korpus && korpus.form === "belegstelle") ? String(korpus.label || "").trim() : "";
    var eigenerTitel = String(s.label || "").trim();
    var vorn = korpusName !== "" ? korpusName : (eigenerTitel || s.url || "");
    // Der Titel wandert nur dann ins ⓘ, wenn er vorn NICHT mehr steht -- und nur, wenn es ihn gibt.
    var titelInsInfo = (korpusName !== "" && eigenerTitel !== "" && eigenerTitel !== korpusName)
      ? eigenerTitel : "";
    var label = esc(vorn);
    // 🔴 DIE LIZENZ IST AUS DER ZEILE IN DAS ⓘ GEWANDERT (Owner 02.09.2026). CC BY-SA 4.0 §3(a)(2)
    // erlaubt das ausdruecklich: die Pflichtangaben duerfen „in any reasonable manner based on the
    // medium" erfuellt werden, und als Beispiel nennt die Lizenz selbst einen LINK auf eine
    // Ressource, die sie enthaelt. Eine Tafel auf DERSELBEN Seite, immer vorhanden, einen Klick
    // entfernt, ist mindestens so gut. ⚠️ Bedingung dafuer ist, dass das ⓘ IMMER da ist -- siehe
    // `rechteMarkup`. Wer den Ausloeser je wieder verengt, nimmt die Lizenzangabe mit.
    var namensnennung = "";
    // 🔴 KEIN STERN MEHR hinter dem Titel -- der Kanon steht rechts als Stempel. Und die
    // Seitenangabe bleibt bei der Quelle, weil sie zu IHR gehoert.
    // 💣 TITEL UND BEIPACK REISEN GETRENNT. Lagen sie in EINEM ellipsierenden Kasten, schnitt die
    // Ellipse, was hinten steht -- und hinten steht die Lizenz. Ein abgeschnittenes „CC B…" ist
    // kein Lizenzverweis, und CC verlangt ihn an der Kopie. Jetzt kuerzt der TITEL (§4.2:
    // „kuerzt der Titel mit Ellipse"), die Lizenz nie.
    var meta = pagesInline(s.pages) + namensnennung;
    var eintrag = s.url
      ? link(s.url, label)
      : '<span class="fs-src-plain">' + label + "</span>";
    // 💣 EINE NAMENSNENNUNG DARF NICHT VON IHRER QUELLE ABREISSEN. Sie ist lang genug, um
    // umzubrechen -- und dann stand sie im Browser gemessen (27.08.2026) in einer Zeile mit der
    // NAECHSTEN Quelle: "VolkoV / garetien.de, CC BY-NC-SA 3.0 · Kosch:Bodrin". Wer das liest,
    // haengt die Lizenz an das falsche Stueck, und damit ist die Namensnennung nicht erfuellt,
    // sondern irrefuehrend. Als inline-block bricht der Browser ZWISCHEN den Eintraegen um und
    // erst dann innerhalb eines einzelnen.
    // ⚠️ Nur der betroffene Eintrag wird eingepackt: alles andere rendert unveraendert weiter.
    // ⭐ DER `inline-block`-KNIFF VON FRUEHER ENTFAELLT. Er stand hier, damit die Namensnennung
    // nicht von ihrer Quelle abriss und in einer Zeile mit der NAECHSTEN landete -- wer das las,
    // haengte die Lizenz an das falsche Stueck. Bei einer Quelle je Zeile ist die Trennung die
    // Zeile selbst.
    // 🔴 EINE HALBPILLE, NICHT ZWEI KAPSELN. Hier standen Stempel und Typmarke als zwei Elemente
    // nebeneinander ("[INOFFIZIELL] [Briefspiel]") -- der Entwurf §3 sagt aber ausdruecklich
    // „Halbpille … Objektkopf UND Quellenzeile", und der Owner hat es am 01.09.2026 an Trallop
    // gemeldet: „das soll so aussehn wie die anderen". Zwei Chips lesen sich als zwei Aussagen;
    // es ist eine.
    // ⚠️ Der Bezeichner ist hier die ART DER QUELLE, nicht ihr Name: in dieser Zeile steht der
    // Name schon links davor. Im Objektkopf ist es umgekehrt -- dort gibt es keine Zeile, also
    // traegt das Etikett den Namen.
    // ⚠️ Ohne Art bleibt es eine ganze Pille (seit 30.08.2026 darf eine Quelle typlos sein) --
    // dieselbe Regel wie beim Wiki-Artikel weiter oben, der gar keine Katalogzeile ist.
    var rechte = rechteMarkup(s, index, titelInsInfo);
    items.push(zeile(eintrag, meta, rechte.knopf + featureKanonBadgeMarkup(
      { kanon: s.official ? "offiziell" : "inoffiziell", bezeichner_type: s.type },
      esc, kanonLabels, typeLabels
    ), rechte.tafel));
  });
  if (items.length) {
    var lbl = items.length > 1 ? sourceLabelPlural : sourceLabelSingular;
    blocks.push('<p class="fs-src-label">' + esc(lbl) + ":</p><ul class=\"fs-src-list\">" + items.join("") + "</ul>");
  }

  // ----- Line 2: Publikationen — collapsible tabbed Titel/Typ/Seiten table -----
  // opts.omitPublications drops this whole block (keeps line 1 "Quelle:") -- used by the floating
  // map box in infopanel mode, where the publication tabs live only in the right panel.
  if (publications.length && !opts.omitPublications) {
    var off = publications.filter(function (s) { return s.reference_kind !== "erwaehnung"; });
    var erw = publications.filter(function (s) { return s.reference_kind === "erwaehnung"; });
    var tab = function (key, name, n, tooltip) {
      var titleAttr = tooltip ? ' title="' + esc(tooltip) + '"' : "";
      return '<span class="fs-src-tab" data-fs-tab="' + key + '" role="button" tabindex="0"' + titleAttr +
        ' onclick="avesmapsToggleSourceTab(this)" onkeydown="avesmapsSourceTabKeydown(event,this)">' +
        esc(name) + ' <span class="fs-src-n">(' + n + ")</span></span>";
    };
    var tabs = [];
    if (off.length) tabs.push(tab("off", officialTabLabel, off.length));
    if (erw.length) tabs.push(tab("erw", mentionedTabLabel, erw.length, mentionTooltip));

    var table = function (rows, key) {
      var body = rows.map(function (s) {
        var label = esc(s.label || s.url || "");
        var titleCell = s.url ? link(s.url, label) : '<span class="fs-src-plain">' + label + "</span>";
        // ⚠️ Die Spalte ist schmal und fest (`fs-src-col-pages`); eine Angabe mit 31 Eintraegen
        // brach dort ueber ein halbes Dutzend Zeilen um und schob die Tabelle auseinander.
        var s2 = featureSourceShortenPages(s.pages);
        var pagesTitel = s2.gekuerzt ? ' title="' + esc(s2.voll) + '"' : "";
        return "<tr><td>" + titleCell + '</td><td class="fs-src-c-type">' + esc(typeLabel(s.type)) +
          '</td><td class="fs-src-c-pages"' + pagesTitel + ">" + esc(s2.kurz) + "</td></tr>";
      }).join("");
      return '<table class="fs-src-table" data-fs-panel="' + key + '" hidden>' +
        '<colgroup><col class="fs-src-col-title"><col class="fs-src-col-type"><col class="fs-src-col-pages"></colgroup>' +
        '<thead><tr><th>' + esc(titleHeader) + '</th><th>' + esc(typeHeader) + '</th><th class="fs-src-th-r">' + esc(pagesHeader) + '</th></tr></thead><tbody>' + body + "</tbody></table>";
    };
    var tables = "";
    if (off.length) tables += table(off, "off");
    if (erw.length) tables += table(erw, "erw");

    blocks.push('<div class="fs-src-pub"><span class="fs-src-publabel">' + esc(publicationsLabel) + '</span>' +
      tabs.join("") + "</div>");
    blocks.push('<div class="fs-src-tablewrap" hidden>' + tables + "</div>");
  }

  if (!blocks.length) return "";
  return '<div class="fs-src fs-src--box">' + blocks.join("") + "</div>";
}

// Browser-only: toggle one publication tab's table open, or collapse it if the tab was already
// active. Scoped to the clicked tab's own .fs-src block, so multiple open popups never interfere.
/**
 * Klappt die Rechtetafel EINER Quellenzeile auf und zu.
 *
 * 💣 INLINE-`onclick` wie bei den Publikationsreitern darunter, und aus demselben Grund: Leaflet
 * ruft den Popup-Inhalt bei jedem `_updateContent` neu auf und ersetzt das Markup. Ein an einen
 * Behaelter gehaengter Zuhoerer waere danach weg -- die „FALLE Popup-Revert", die dieses Haus am
 * 08.07.2026 schon einmal bezahlt hat.
 *
 * 🔴 Die Tafel liegt im EIGENEN <li>, nicht unter der Liste: bei zwei Quellen waere sonst nicht zu
 * sehen, wessen Rechte dort stehen -- und das sind zuordnungspflichtige Angaben.
 * ⚠️ `aria-expanded` wandert mit, sonst sagt der Knopf einem Screenreader nichts ueber seinen
 * Zustand.
 */
function avesmapsToggleSourceRights(btn) {
  if (!btn || !btn.closest) return;
  var li = btn.closest("li");
  if (!li) return;
  var tafel = li.querySelector(".fs-src-rights");
  if (!tafel) return;
  var offen = tafel.hidden === false;
  tafel.hidden = offen;
  btn.setAttribute("aria-expanded", offen ? "false" : "true");
}

function avesmapsToggleSourceTab(tabEl) {  if (!tabEl || !tabEl.closest) return;
  var block = tabEl.closest(".fs-src");
  if (!block) return;
  var key = tabEl.getAttribute("data-fs-tab");
  var wrap = block.querySelector(".fs-src-tablewrap");
  var wasActive = tabEl.classList.contains("is-active");
  var tabs = block.querySelectorAll(".fs-src-tab");
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove("is-active");
  if (wasActive) {
    if (wrap) wrap.hidden = true;
    return;
  }
  tabEl.classList.add("is-active");
  var tables = block.querySelectorAll(".fs-src-table");
  for (var j = 0; j < tables.length; j++) {
    tables[j].hidden = tables[j].getAttribute("data-fs-panel") !== key;
  }
  if (wrap) wrap.hidden = false;
}

function avesmapsSourceTabKeydown(event, tabEl) {
  if (event && (event.key === "Enter" || event.key === " " || event.key === "Spacebar")) {
    event.preventDefault();
    avesmapsToggleSourceTab(tabEl);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildSourceListMarkup: buildSourceListMarkup, FEATURE_SOURCE_MARKUP_TYPE_LABELS: FEATURE_SOURCE_MARKUP_TYPE_LABELS, featureSourceShortenPages: featureSourceShortenPages, featureSourceLicenseText: featureSourceLicenseText, FEATURE_SOURCE_LICENSES: FEATURE_SOURCE_LICENSES, featureKanonBadgeMarkup: featureKanonBadgeMarkup, featureKanonBezeichnerText: featureKanonBezeichnerText, avesmapsToggleSourceRights,};
}
if (typeof window !== "undefined") {
  window.buildSourceListMarkup = buildSourceListMarkup;
  window.featureSourceShortenPages = featureSourceShortenPages;
  window.featureKanonBadgeMarkup = featureKanonBadgeMarkup;
  window.avesmapsToggleSourceTab = avesmapsToggleSourceTab;
  // 🔴 MUSS global stehen: das Markup ruft ihn per Inline-`onclick`, und der wird im
  // globalen Raum aufgeloest. Ohne diese Zeile klappt das ⓘ nicht auf -- lautlos.
  window.avesmapsToggleSourceRights = avesmapsToggleSourceRights;
  window.avesmapsSourceTabKeydown = avesmapsSourceTabKeydown;
}
