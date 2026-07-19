// Shared source typeahead (docs/quellen-wiki-key-instruction.md section 5a).
//
// Every form that accepts a source can offer the EXISTING catalog entries instead of a blank field,
// so the same publication stops arriving as a third new row. Dedup today happens only server-side
// over url_hash -- which cannot catch a community report that carries a NAME and no URL at all, and
// that is exactly how "Blutmond I" got into the catalog as its own row.
//
// Split like js/review/review-feature-sources.js: a pure render (testable under Node, no DOM) plus
// the DOM wiring. Root-absolute endpoint because the widget is also mounted inside the editor
// iframes under html/, where a relative path would resolve to html/api/...
const SOURCE_AUTOCOMPLETE_API_URL = "/api/app/source-search.php";
const SOURCE_AUTOCOMPLETE_MIN_CHARS = 2;
const SOURCE_AUTOCOMPLETE_DEBOUNCE_MS = 220;
const SOURCE_AUTOCOMPLETE_LIMIT = 8;

function sourceAutocompleteDefaultEscape(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sourceAutocompleteDefaultTr(_key, fallback) {
  return fallback;
}

// Type slugs are shared with the multi-source widget; reuse its labels when that file is loaded
// (it is, on every surface that has an add-row) and fall back to the raw slug otherwise, so this
// module never hard-depends on it.
function sourceAutocompleteTypeLabel(type) {
  if (typeof featureSourceTypeLabel === "function") {
    return featureSourceTypeLabel(type);
  }
  return type || "";
}

// Highlights every occurrence of the typed term inside a label. Splitting on the ALREADY-ESCAPED
// label would let a "&amp;" boundary land mid-entity, so the split happens on the raw string and
// each piece is escaped separately.
function renderSourceAutocompleteLabel(label, query, escape) {
  const raw = String(label || "");
  const term = String(query || "").trim();
  if (term === "") {
    return escape(raw);
  }
  const lowerRaw = raw.toLowerCase();
  const lowerTerm = term.toLowerCase();
  let out = "";
  let cursor = 0;
  let hit = lowerRaw.indexOf(lowerTerm);
  while (hit !== -1) {
    out += escape(raw.slice(cursor, hit)) + "<mark>" + escape(raw.slice(hit, hit + term.length)) + "</mark>";
    cursor = hit + term.length;
    hit = lowerRaw.indexOf(lowerTerm, cursor);
  }
  return out + escape(raw.slice(cursor));
}

// Pure render. state = { items:[{source_id,label,url,type,official,uses}], activeIndex, query }.
// opts = { escape, tr } (both injectable; the defaults are DOM-free so this runs under Node).
function renderSourceAutocompleteHtml(state, opts) {
  const options = opts || {};
  const escape = options.escape || sourceAutocompleteDefaultEscape;
  const tr = options.tr || sourceAutocompleteDefaultTr;
  const safeState = state || {};
  const items = Array.isArray(safeState.items) ? safeState.items : [];
  const query = String(safeState.query || "");

  const rows = items
    .map((item, index) => {
      const active = index === safeState.activeIndex;
      // "uses" is the signal that tells an editor they picked the right row. A source nobody cites
      // yet is a legitimate hit, so 0 is rendered as nothing rather than "an 0 Orten".
      const uses = Number(item.uses) > 0
        ? '<span class="sac-uses">' + escape(tr("sources.ac.uses", "an {n} Orten").replace("{n}", String(item.uses))) + "</span>"
        : "";
      const official = item.official
        ? '<span class="sac-badge sac-badge--official">' + escape(tr("sources.ac.official", "offiziell")) + "</span>"
        : "";
      return (
        '<li class="sac-item' + (active ? " is-active" : "") + '" role="option"' +
        ' id="sac-opt-' + escape(item.source_id) + '"' +
        ' aria-selected="' + (active ? "true" : "false") + '"' +
        ' data-sac-index="' + index + '">' +
        '<span class="sac-name">' + renderSourceAutocompleteLabel(item.label, query, escape) + "</span>" +
        '<span class="sac-badge">' + escape(sourceAutocompleteTypeLabel(item.type)) + "</span>" +
        official + uses +
        "</li>"
      );
    })
    .join("");

  const heading = '<div class="sac-head">' + escape(tr("sources.ac.heading", "Aus dem Quellenkatalog")) + "</div>";
  // The freetext escape hatch is spelled out rather than implied: an unknown work must stay
  // reportable, and the editor should be able to see that is what they are about to do.
  const newRow =
    '<div class="sac-new" data-sac-dismiss>' +
    '<span class="sac-plus" aria-hidden="true">+</span><span>' +
    // „ / “ are the German quotation marks. Written as escapes on purpose: typed
    // literally, the closing one is one careless keystroke away from an ASCII " that silently
    // ends the string literal instead.
    escape(tr("sources.ac.createNew", "„{q}“ als neue Quelle anlegen").replace("{q}", query)) +
    "</span></div>";

  return heading + '<ul class="sac-list" role="listbox">' + rows + "</ul>" + newRow;
}

// Attach the typeahead to a text input. opts:
//   onPick(item)  -- required; receives the chosen catalog row
//   tr, escape    -- optional injectables, same contract as the render
//   limit         -- optional, defaults to SOURCE_AUTOCOMPLETE_LIMIT
// Returns a detach() that removes every listener and the dropdown node.
function attachSourceAutocomplete(inputEl, opts) {
  if (!inputEl || typeof document === "undefined") {
    return function noop() {};
  }
  const options = opts || {};
  const doc = inputEl.ownerDocument || document;
  const limit = Number(options.limit) > 0 ? Number(options.limit) : SOURCE_AUTOCOMPLETE_LIMIT;

  const box = doc.createElement("div");
  box.className = "sac";
  box.hidden = true;
  doc.body.appendChild(box);

  let items = [];
  let activeIndex = -1;
  let open = false;
  let debounceTimer = 0;
  let controller = null;
  // Responses can land out of order; only the newest request may paint.
  let requestSeq = 0;

  inputEl.setAttribute("role", "combobox");
  inputEl.setAttribute("aria-autocomplete", "list");
  inputEl.setAttribute("aria-expanded", "false");
  inputEl.setAttribute("autocomplete", "off");

  function position() {
    const rect = inputEl.getBoundingClientRect();
    box.style.left = rect.left + "px";
    box.style.top = rect.bottom + 4 + "px";
    box.style.minWidth = rect.width + "px";
  }

  function paint() {
    box.innerHTML = renderSourceAutocompleteHtml(
      { items: items, activeIndex: activeIndex, query: inputEl.value },
      options
    );
    const activeId = activeIndex >= 0 && items[activeIndex] ? "sac-opt-" + items[activeIndex].source_id : "";
    if (activeId) {
      inputEl.setAttribute("aria-activedescendant", activeId);
    } else {
      inputEl.removeAttribute("aria-activedescendant");
    }
  }

  function show() {
    if (!items.length) {
      hide();
      return;
    }
    open = true;
    box.hidden = false;
    inputEl.setAttribute("aria-expanded", "true");
    position();
    paint();
  }

  function hide() {
    open = false;
    box.hidden = true;
    activeIndex = -1;
    inputEl.setAttribute("aria-expanded", "false");
    inputEl.removeAttribute("aria-activedescendant");
  }

  function pick(index) {
    const item = items[index];
    if (!item) {
      return;
    }
    hide();
    if (typeof options.onPick === "function") {
      options.onPick(item);
    }
  }

  async function search(term) {
    if (controller) {
      controller.abort();
    }
    controller = typeof AbortController === "function" ? new AbortController() : null;
    const seq = ++requestSeq;
    try {
      const url = SOURCE_AUTOCOMPLETE_API_URL + "?q=" + encodeURIComponent(term) + "&limit=" + limit;
      const response = await fetch(url, {
        credentials: "same-origin",
        signal: controller ? controller.signal : undefined,
      });
      const data = await response.json();
      if (seq !== requestSeq) {
        return; // a newer keystroke already won
      }
      const groups = data && data.ok === true && Array.isArray(data.groups) ? data.groups : [];
      // Flattened on purpose: the endpoint will grow an adventures/citymaps group once
      // sources.wiki_key exists (steps 1+2) and this list renders it without a change here.
      items = groups.reduce((all, group) => all.concat(Array.isArray(group.items) ? group.items : []), []);
      activeIndex = -1;
      show();
    } catch (error) {
      if (seq === requestSeq) {
        items = [];
        hide(); // a failed lookup must never block typing -- the freetext path still works
      }
    }
  }

  function onInput() {
    const term = String(inputEl.value || "").trim();
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    if (term.length < SOURCE_AUTOCOMPLETE_MIN_CHARS) {
      items = [];
      hide();
      return;
    }
    debounceTimer = setTimeout(() => search(term), SOURCE_AUTOCOMPLETE_DEBOUNCE_MS);
  }

  function onKeyDown(event) {
    if (!open || !items.length) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      activeIndex = (activeIndex + step + items.length) % items.length;
      paint();
      return;
    }
    if (event.key === "Enter" && activeIndex >= 0) {
      // stopImmediatePropagation, not stopPropagation: the community report form binds its OWN
      // Enter handler to this very input ("Enter adds the source", js/app/bootstrap.js), and
      // stopPropagation does not stop sibling listeners on the same element -- it would add the
      // half-filled source a moment before the pick lands. This also keeps Enter from submitting
      // the surrounding form. Sibling listeners registered BEFORE this one still run, which is why
      // the mount is wired ahead of that binding.
      event.preventDefault();
      event.stopImmediatePropagation();
      pick(activeIndex);
      return;
    }
    if (event.key === "Escape") {
      // Same reasoning: Escape closes the list, and must not also reach the dialog behind it.
      event.preventDefault();
      event.stopImmediatePropagation();
      hide();
      return;
    }
    if (event.key === "Tab") {
      hide();
    }
  }

  // mousedown (not click) with preventDefault: the input must not blur before the pick lands.
  function onBoxMouseDown(event) {
    event.preventDefault();
    if (event.target.closest("[data-sac-dismiss]")) {
      hide();
      return;
    }
    const row = event.target.closest("[data-sac-index]");
    if (row) {
      pick(Number(row.getAttribute("data-sac-index")));
    }
  }

  function onDocMouseDown(event) {
    if (open && event.target !== inputEl && !box.contains(event.target)) {
      hide();
    }
  }

  function onReposition() {
    if (open) {
      position();
    }
  }

  inputEl.addEventListener("input", onInput);
  inputEl.addEventListener("keydown", onKeyDown);
  box.addEventListener("mousedown", onBoxMouseDown);
  doc.addEventListener("mousedown", onDocMouseDown);
  // capture: catches scrolling of any ancestor panel, not just the document.
  doc.addEventListener("scroll", onReposition, true);
  (doc.defaultView || window).addEventListener("resize", onReposition);

  return function detach() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    if (controller) {
      controller.abort();
    }
    inputEl.removeEventListener("input", onInput);
    inputEl.removeEventListener("keydown", onKeyDown);
    box.removeEventListener("mousedown", onBoxMouseDown);
    doc.removeEventListener("mousedown", onDocMouseDown);
    doc.removeEventListener("scroll", onReposition, true);
    (doc.defaultView || window).removeEventListener("resize", onReposition);
    if (box.parentNode) {
      box.parentNode.removeChild(box);
    }
  };
}

if (typeof window !== "undefined") {
  window.renderSourceAutocompleteHtml = renderSourceAutocompleteHtml;
  window.attachSourceAutocomplete = attachSourceAutocomplete;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { renderSourceAutocompleteHtml, renderSourceAutocompleteLabel };
}
