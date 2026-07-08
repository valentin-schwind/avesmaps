// Shared feature-source editor widget (multi-source system #2). Renders a read-only Wiki
// Aventurica row (when the entity has a wiki link) plus a deletable list of catalog sources
// plus an "add source" row, and mounts that markup with a delegated add/remove click handler
// wired to POST /api/edit/map/feature-sources.php. Used by every edit surface (settlement,
// region, path, territory editors) via the shared entity_type/entity_public_id contract.
//
// renderFeatureSourceEditorHtml(state, opts) is pure/DOM-free so it is Node-testable
// (mirrors js/map-features/map-features-point-in-polygon.js's module/window export pattern).

const FEATURE_SOURCE_API_URL = "/api/edit/map/feature-sources.php";
const FEATURE_SOURCE_TYPES = ["regionalband", "abenteuer", "briefspiel", "sonstiges"];
const FEATURE_SOURCE_TYPE_LABELS = {
  regionalband: "Regionalband",
  abenteuer: "Abenteuer",
  briefspiel: "Briefspiel",
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
  return (
    '<div class="fs-row" data-source-id="' + escape(source.source_id) + '">' +
    '<a class="fs-row__link" href="' + escape(source.url) + '" target="_blank" rel="noopener">' +
    escape(source.label || source.url) + " ↗</a>" +
    '<span class="fs-row__badge">' + escape(featureSourceTypeLabel(source.type)) + officialMark + "</span>" +
    '<button type="button" class="fs-row__remove" data-remove-source-id="' + escape(source.source_id) + '">✕</button>' +
    "</div>"
  );
}

function renderFeatureSourceAddRow(escape, tr) {
  const options = FEATURE_SOURCE_TYPES.map(
    (type) => '<option value="' + escape(type) + '">' + escape(featureSourceTypeLabel(type)) + "</option>"
  ).join("");
  return (
    '<div class="fs-row fs-row--add" data-fs-add>' +
    '<input type="text" class="fs-add-url" placeholder="' + escape(tr("sources.add.url", "URL")) + '">' +
    '<input type="text" class="fs-add-label" placeholder="' + escape(tr("sources.add.label", "Quellenname")) + '">' +
    '<select class="fs-add-type">' + options + "</select>" +
    '<label class="fs-add-official-label">' +
    '<input type="checkbox" class="fs-add-official"> ' + escape(tr("sources.add.official", "offiziell")) +
    "</label>" +
    '<button type="button" class="fs-row__add" data-fs-add-submit>' + escape(tr("sources.add.submit", "Hinzufügen")) + "</button>" +
    "</div>"
  );
}

// Pure render: state = { wiki_url, sources:[{source_id,url,label,type,official}] }.
// opts = { escape, tr } (both injectable; defaults are DOM-free so this runs under Node).
function renderFeatureSourceEditorHtml(state, opts) {
  const options = opts || {};
  const escape = options.escape || featureSourceDefaultEscape;
  const tr = options.tr || featureSourceDefaultTr;
  const safeState = state || {};
  const sources = Array.isArray(safeState.sources) ? safeState.sources : [];

  const wikiRow = renderFeatureSourceWikiRow(safeState.wiki_url, escape, tr);
  const sourceRows = sources.map((source) => renderFeatureSourceRow(source, escape, tr)).join("");
  const addRow = renderFeatureSourceAddRow(escape, tr);

  return '<div class="fs-editor">' + wikiRow + sourceRows + addRow + "</div>";
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
  }

  function readAddRowValues() {
    const urlInput = containerEl.querySelector(".fs-add-url");
    const labelInput = containerEl.querySelector(".fs-add-label");
    const typeSelect = containerEl.querySelector(".fs-add-type");
    const officialInput = containerEl.querySelector(".fs-add-official");
    return {
      url: String((urlInput && urlInput.value) || "").trim(),
      label: String((labelInput && labelInput.value) || "").trim(),
      source_type: String((typeSelect && typeSelect.value) || "sonstiges"),
      is_official: Boolean(officialInput && officialInput.checked),
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

if (typeof window !== "undefined") {
  window.renderFeatureSourceEditorHtml = renderFeatureSourceEditorHtml;
  window.mountFeatureSourceEditor = mountFeatureSourceEditor;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { renderFeatureSourceEditorHtml };
}
