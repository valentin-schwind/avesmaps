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

function renderFeatureSourceRow(source, escape, tr) {
  const officialMark = source.official ? " *" : "";
  const pages = source.pages ? '<span class="fs-row__pages">S. ' + escape(source.pages) + "</span>" : "";
  return (
    '<div class="fs-row" data-source-id="' + escape(source.source_id) + '">' +
    '<a class="fs-row__link" href="' + escape(source.url) + '" target="_blank" rel="noopener">' +
    escape(source.label || source.url) + " ↗</a>" +
    '<span class="fs-row__badge">' + escape(featureSourceTypeLabel(source.type)) + officialMark + "</span>" +
    pages +
    '<button type="button" class="fs-row__remove" data-remove-source-id="' + escape(source.source_id) + '">✕</button>' +
    "</div>"
  );
}

// Sources auto-populated by the WikiSync publication reconcile (origin === "wiki_publication")
// render together under their own heading so editors can tell "the wiki put this here" apart
// from what they curated by hand. No rows -> no heading (never render an empty group). Each row
// uses the same renderFeatureSourceRow as the manual list -- the remove button is identical;
// only the server-side interpretation of "remove" differs by origin.
function renderFeatureSourceWikiAutoGroup(wikiAutoSources, escape, tr) {
  if (!wikiAutoSources.length) {
    return "";
  }
  const heading =
    '<div class="fs-group-heading">' + escape(tr("sources.wikiAuto", "Aus dem Wiki (automatisch)")) + "</div>";
  const rows = wikiAutoSources.map((source) => renderFeatureSourceRow(source, escape, tr)).join("");
  return '<div class="fs-group fs-group--wiki-auto" data-fs-group="wiki-auto">' + heading + rows + "</div>";
}

function renderFeatureSourceAddRow(escape, tr) {
  const options = FEATURE_SOURCE_TYPES.map(
    (type) => '<option value="' + escape(type) + '">' + escape(featureSourceTypeLabel(type)) + "</option>"
  ).join("");
  return (
    '<div class="fs-row fs-row--add" data-fs-add>' +
    '<input type="text" class="fs-add-url" placeholder="' + escape(tr("sources.add.url", "URL")) + '">' +
    '<input type="text" class="fs-add-label" placeholder="' + escape(tr("sources.add.label", "Quellenname")) + '">' +
    '<input type="text" class="fs-add-pages" placeholder="' + escape(tr("sources.add.pages", "Seite(n)")) + '">' +
    '<select class="fs-add-type">' + options + "</select>" +
    '<label class="fs-add-official-label">' +
    '<input type="checkbox" class="fs-add-official"> ' + escape(tr("sources.add.official", "offiziell")) +
    "</label>" +
    '<button type="button" class="fs-row__add" data-fs-add-submit>' + escape(tr("sources.add.submit", "Hinzufügen")) + "</button>" +
    "</div>"
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
  const otherSources = sources.filter((source) => !(source && source.origin === "wiki_publication"));

  const wikiRow = renderFeatureSourceWikiRow(safeState.wiki_url, escape, tr);
  const wikiAutoGroup = renderFeatureSourceWikiAutoGroup(wikiAutoSources, escape, tr);
  const sourceRows = otherSources.map((source) => renderFeatureSourceRow(source, escape, tr)).join("");
  const addRow = renderFeatureSourceAddRow(escape, tr);

  // Reviewer/editor guidance shown above the source list (all mount surfaces). The copy carries an
  // intentional <strong> emphasis and is trusted developer/i18n text (never user input), so it is
  // inserted as HTML rather than escaped.
  const hint = '<div class="fs-hint">' + tr("sources.hint",
    "Tragt bei Quellen immer den eigentlichen <strong>Veröffentlichungstitel der Quelle</strong> und den Link ein. Achtet darauf, ob es sich um eine offizielle Quelle handelt.") + "</div>";
  return '<div class="fs-editor">' + hint + wikiRow + wikiAutoGroup + sourceRows + addRow + "</div>";
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

// Mount the widget into containerEl and wire add/remove. entityType is fixed for the mount's
// lifetime; publicIdGetter is called fresh on every request so the same mounted widget can
// track a selection that changes after opening (e.g. the settlement editor's selected feature).
function mountFeatureSourceEditor(containerEl, entityType, publicIdGetter, opts) {
  if (!containerEl) {
    return;
  }

  async function renderFromServer(action, extra) {
    const publicId = typeof publicIdGetter === "function" ? publicIdGetter() : publicIdGetter;
    const body = Object.assign({ action, entity_type: entityType, entity_public_id: publicId }, extra || {});
    const data = await featureSourceFetch(body);
    if (!data || data.ok !== true) {
      return; // keep the prior render on any failure -- never blank the widget
    }
    containerEl.innerHTML = renderFeatureSourceEditorHtml(data, opts);
    // Return the server payload so a caller can react to it (e.g. the "Ort bearbeiten" dialog
    // reads data.revision to refresh its optimistic-locking token after the list's takeover).
    return data;
  }

  function readAddRowValues() {
    const urlInput = containerEl.querySelector(".fs-add-url");
    const labelInput = containerEl.querySelector(".fs-add-label");
    const typeSelect = containerEl.querySelector(".fs-add-type");
    const officialInput = containerEl.querySelector(".fs-add-official");
    const pagesInput = containerEl.querySelector(".fs-add-pages");
    return {
      url: String((urlInput && urlInput.value) || "").trim(),
      label: String((labelInput && labelInput.value) || "").trim(),
      source_type: String((typeSelect && typeSelect.value) || "sonstiges"),
      is_official: Boolean(officialInput && officialInput.checked),
      pages: String((pagesInput && pagesInput.value) || "").trim(),
    };
  }

  containerEl.addEventListener("click", async (event) => {
    const removeTarget = event.target.closest("[data-remove-source-id]");
    if (removeTarget) {
      const sourceId = Number(removeTarget.getAttribute("data-remove-source-id"));
      await renderFromServer("remove", { source_id: sourceId });
      return;
    }
    const addTarget = event.target.closest("[data-fs-add-submit]");
    if (addTarget) {
      const values = readAddRowValues();
      if (!values.url) {
        return; // url required -- no-op instead of a failed round trip
      }
      await renderFromServer("add", values);
    }
  });

  return renderFromServer("list");
}

// Multi-source #3: link a community-reported source to a freshly created feature as a catalog source
// -- the SAME server add path (POST feature-sources.php `add`) the editor's "Hinzufügen" button uses,
// so an accepted community report's source shows up in the QUELLEN section exactly like a manual one.
// Best-effort: no publicId/url -> no-op; transport/non-ok failures are swallowed so a create is never
// broken by this. Returns true only on a confirmed add.
async function linkCommunityReportSource(entityPublicId, suggestion) {
  if (!entityPublicId || !suggestion || !suggestion.url) {
    return false;
  }
  const data = await featureSourceFetch({
    action: "add",
    entity_type: "settlement",
    entity_public_id: entityPublicId,
    url: String(suggestion.url || ""),
    label: String(suggestion.label || ""),
    source_type: String(suggestion.source_type || "sonstiges"),
    is_official: Boolean(suggestion.is_official),
    pages: String(suggestion.pages || ""),
  });
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

// Fold an editor feature-source list (each {source_id,url,label,type,official,pages}) into the popup's
// synchronous source globals so a freshly created/edited feature renders its sources on the next popup
// open with no map-features reload. Overwrites the entity's ref list with the full server list (the add
// endpoint returns ALL of the feature's sources), and upserts each into the shared catalog by source_id.
function syncFeatureSourcesToClientCache(entityType, entityPublicId, editorSources) {
  if (typeof window === "undefined" || !Array.isArray(editorSources) || !entityPublicId) {
    return;
  }
  window.__sourceCatalog = window.__sourceCatalog || {};
  window.__featureSourceRefs = window.__featureSourceRefs || {};
  const refs = [];
  for (const source of editorSources) {
    if (!source || source.source_id === undefined || source.source_id === null) {
      continue;
    }
    window.__sourceCatalog[source.source_id] = {
      url: source.url || "",
      label: source.label || "",
      official: Boolean(source.official),
      type: source.type || "",
    };
    refs.push({ source_id: source.source_id, pages: source.pages || "" });
  }
  window.__featureSourceRefs[`${entityType}:${entityPublicId}`] = refs;
}

if (typeof window !== "undefined") {
  window.renderFeatureSourceEditorHtml = renderFeatureSourceEditorHtml;
  window.mountFeatureSourceEditor = mountFeatureSourceEditor;
  window.linkCommunityReportSource = linkCommunityReportSource;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { renderFeatureSourceEditorHtml };
}
