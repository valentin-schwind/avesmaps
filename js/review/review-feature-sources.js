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

function renderFeatureSourceRow(source, escape, tr) {
  const officialMark = source.official ? " *" : "";
  const pages = source.pages ? '<span class="fs-row__pages">S. ' + escape(source.pages) + "</span>" : "";
  // Coverage classification badge (only when set) -- tells the editor which publication tab this row
  // renders in on the public popup. Empty reference_kind -> no badge (source shows on the flat line).
  const kind = source.reference_kind
    ? '<span class="fs-row__kind">' + escape(featureSourceReferenceKindLabel(source.reference_kind)) + "</span>"
    : "";
  return (
    '<div class="fs-row" data-source-id="' + escape(source.source_id) + '">' +
    '<a class="fs-row__link" href="' + escape(source.url) + '" target="_blank" rel="noopener">' +
    escape(source.label || source.url) + " ↗</a>" +
    '<span class="fs-row__badge">' + escape(featureSourceTypeLabel(source.type)) + officialMark + "</span>" +
    kind +
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
  const sourceRows = otherSources.map((source) => renderFeatureSourceRow(source, escape, tr)).join("");
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
    return {
      url: String((urlInput && urlInput.value) || "").trim(),
      label: String((labelInput && labelInput.value) || "").trim(),
      source_type: String((typeSelect && typeSelect.value) || "sonstiges"),
      reference_kind: String((kindSelect && kindSelect.value) || ""),
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
    refs.push({ source_id: source.source_id, pages: source.pages || "", reference_kind: source.reference_kind || "" });
  }
  window.__featureSourceRefs[`${entityType}:${entityPublicId}`] = refs;
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
