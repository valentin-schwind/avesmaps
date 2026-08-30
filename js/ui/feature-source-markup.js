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
 * Rechtsaussage, die niemand getroffen hat -- und sie stuende dann an 1694 Quellen.
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
  var star = function (official) {
    return official ? '<span class="fs-src-star" title="' + esc(officialTooltip) + '">*</span>' : "";
  };
  var typeTag = function (t) {
    var label = typeLabel(t);
    return label ? '<span class="fs-src-type">' + esc(label) + "</span>" : "";
  };
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
    items.push(link(wikiUrl, esc(wikiLabel)) + wikiLicenseMarkup());
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
  var attributionMarkup = function (s) {
    var wer = String((s && s.attribution) == null ? "" : s.attribution).trim();
    return wer ? '<span class="fs-src-lic fs-src-lic--attrib">' + esc(wer) + "</span>" : "";
  };
  var licenseBadgeMarkup = function (s) {
    var eintrag = FEATURE_SOURCE_LICENSES[String((s && s.license) || "").trim()] || null;
    if (!eintrag) { return ""; }
    // --attrib: sie darf umbrechen, der kurze Wiki-Hinweis nicht (css/features/feature-sources.css).
    // ⚠️ Ohne Adresse ein <span>, kein Link ins Leere -- "Gemeinfrei" und "Keine freie Lizenz"
    // haben nichts zu verlinken.
    if (!eintrag.url) {
      return '<span class="fs-src-lic fs-src-lic--attrib">' + esc(eintrag.label) + "</span>";
    }
    return '<a class="fs-src-lic fs-src-lic--attrib" href="' + esc(eintrag.url) +
      '" target="_blank" rel="noopener">' + esc(eintrag.label) +
      ' <span class="fs-src-ext" aria-hidden="true">↗</span></a>';
  };
  var lizenzMarkup = function (s) {
    var attrib = attributionMarkup(s);
    var lic = licenseBadgeMarkup(s);
    if (!attrib) { return lic; }
    if (!lic) { return attrib; }
    return attrib + ", " + lic;
  };
  direct.forEach(function (s) {
    var label = esc(s.label || s.url || "");
    var namensnennung = lizenzMarkup(s);
    var meta = typeTag(s.type) + pagesInline(s.pages) + namensnennung;
    var eintrag = s.url
      ? link(s.url, label + star(s.official)) + meta
      : '<span class="fs-src-plain">' + label + star(s.official) + "</span>" + meta;
    // 💣 EINE NAMENSNENNUNG DARF NICHT VON IHRER QUELLE ABREISSEN. Sie ist lang genug, um
    // umzubrechen -- und dann stand sie im Browser gemessen (27.08.2026) in einer Zeile mit der
    // NAECHSTEN Quelle: "VolkoV / garetien.de, CC BY-NC-SA 3.0 · Kosch:Bodrin". Wer das liest,
    // haengt die Lizenz an das falsche Stueck, und damit ist die Namensnennung nicht erfuellt,
    // sondern irrefuehrend. Als inline-block bricht der Browser ZWISCHEN den Eintraegen um und
    // erst dann innerhalb eines einzelnen.
    // ⚠️ Nur der betroffene Eintrag wird eingepackt: alles andere rendert unveraendert weiter.
    items.push(namensnennung ? '<span class="fs-src-item">' + eintrag + "</span>" : eintrag);
  });
  if (items.length) {
    var lbl = items.length > 1 ? sourceLabelPlural : sourceLabelSingular;
    blocks.push('<div class="fs-src-direct">' + esc(lbl) + ": " + items.join('<span class="fs-src-sep">·</span>') + "</div>");
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
  return '<div class="fs-src">' + blocks.join("") + "</div>";
}

// Browser-only: toggle one publication tab's table open, or collapse it if the tab was already
// active. Scoped to the clicked tab's own .fs-src block, so multiple open popups never interfere.
function avesmapsToggleSourceTab(tabEl) {
  if (!tabEl || !tabEl.closest) return;
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
  module.exports = { buildSourceListMarkup: buildSourceListMarkup, FEATURE_SOURCE_MARKUP_TYPE_LABELS: FEATURE_SOURCE_MARKUP_TYPE_LABELS, featureSourceShortenPages: featureSourceShortenPages, featureSourceLicenseText: featureSourceLicenseText, FEATURE_SOURCE_LICENSES: FEATURE_SOURCE_LICENSES };
}
if (typeof window !== "undefined") {
  window.buildSourceListMarkup = buildSourceListMarkup;
  window.featureSourceShortenPages = featureSourceShortenPages;
  window.avesmapsToggleSourceTab = avesmapsToggleSourceTab;
  window.avesmapsSourceTabKeydown = avesmapsSourceTabKeydown;
}
