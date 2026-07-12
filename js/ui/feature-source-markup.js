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

function buildSourceListMarkup(wikiUrl, sources, opts) {
  opts = opts || {};
  var wikiLabel = opts.wikiLabel || "Wiki";
  var officialTooltip = opts.officialTooltip || "offizielle Quelle";
  var esc = opts.escape || function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };
  var typeLabel = function (t) {
    var key = String(t == null ? "" : t).trim();
    return key ? (FEATURE_SOURCE_MARKUP_TYPE_LABELS[key] || key) : "";
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
    var value = String(p == null ? "" : p).trim();
    return value ? '<span class="fs-src-pages">S. ' + esc(value) + "</span>" : "";
  };
  var link = function (url, inner) {
    return '<a class="fs-src-a" href="' + esc(url) + '" target="_blank" rel="noopener">' + inner + ' <span class="fs-src-ext" aria-hidden="true">↗</span></a>';
  };

  var list = Array.isArray(sources) ? sources.filter(function (s) { return s && (s.label || s.url); }) : [];
  // A wiki publication carries a reference_kind; anything without one is a direct/own source.
  var publications = list.filter(function (s) { return s.reference_kind; });
  var direct = list.filter(function (s) { return !s.reference_kind; });

  var blocks = [];

  // ----- Line 1: Quelle(n) — the wiki page link + direct/own sources -----
  var items = [];
  if (wikiUrl) {
    items.push(link(wikiUrl, esc(wikiLabel)));
  }
  direct.forEach(function (s) {
    var label = esc(s.label || s.url || "");
    var meta = typeTag(s.type) + pagesInline(s.pages);
    if (s.url) {
      items.push(link(s.url, label + star(s.official)) + meta);
    } else {
      items.push('<span class="fs-src-plain">' + label + star(s.official) + "</span>" + meta);
    }
  });
  if (items.length) {
    var lbl = items.length > 1 ? "Quellen" : "Quelle";
    blocks.push('<div class="fs-src-direct">' + lbl + ": " + items.join('<span class="fs-src-sep">·</span>') + "</div>");
  }

  // ----- Line 2: Publikationen — collapsible tabbed Titel/Typ/Seiten table -----
  // opts.omitPublications drops this whole block (keeps line 1 "Quelle:") -- used by the floating
  // map box in infopanel mode, where the publication tabs live only in the right panel.
  if (publications.length && !opts.omitPublications) {
    var off = publications.filter(function (s) { return s.reference_kind !== "erwaehnung"; });
    var erw = publications.filter(function (s) { return s.reference_kind === "erwaehnung"; });
    var tab = function (key, name, n) {
      return '<span class="fs-src-tab" data-fs-tab="' + key + '" role="button" tabindex="0"' +
        ' onclick="avesmapsToggleSourceTab(this)" onkeydown="avesmapsSourceTabKeydown(event,this)">' +
        name + ' <span class="fs-src-n">(' + n + ")</span></span>";
    };
    var tabs = [];
    if (off.length) tabs.push(tab("off", "Offiziell", off.length));
    if (erw.length) tabs.push(tab("erw", "Erwähnt", erw.length));

    var table = function (rows, key) {
      var body = rows.map(function (s) {
        var label = esc(s.label || s.url || "");
        var titleCell = s.url ? link(s.url, label) : '<span class="fs-src-plain">' + label + "</span>";
        var pages = esc(String(s.pages == null ? "" : s.pages).trim());
        return "<tr><td>" + titleCell + '</td><td class="fs-src-c-type">' + esc(typeLabel(s.type)) +
          '</td><td class="fs-src-c-pages">' + pages + "</td></tr>";
      }).join("");
      return '<table class="fs-src-table" data-fs-panel="' + key + '" hidden>' +
        '<colgroup><col class="fs-src-col-title"><col class="fs-src-col-type"><col class="fs-src-col-pages"></colgroup>' +
        '<thead><tr><th>Titel</th><th>Typ</th><th class="fs-src-th-r">Seiten</th></tr></thead><tbody>' + body + "</tbody></table>";
    };
    var tables = "";
    if (off.length) tables += table(off, "off");
    if (erw.length) tables += table(erw, "erw");

    blocks.push('<div class="fs-src-pub"><span class="fs-src-publabel">Publikationen:</span>' +
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
  module.exports = { buildSourceListMarkup: buildSourceListMarkup, FEATURE_SOURCE_MARKUP_TYPE_LABELS: FEATURE_SOURCE_MARKUP_TYPE_LABELS };
}
if (typeof window !== "undefined") {
  window.buildSourceListMarkup = buildSourceListMarkup;
  window.avesmapsToggleSourceTab = avesmapsToggleSourceTab;
  window.avesmapsSourceTabKeydown = avesmapsSourceTabKeydown;
}
