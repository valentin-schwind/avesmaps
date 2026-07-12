# Abenteuer-Editor P2 (Editor-UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a capability-gated Abenteuer-Editor overlay (create/edit adventures + manage their places) wired to the LIVE P1 endpoints, reachable via an "Abenteuereditor" button under "Dump holen".

**Architecture:** A self-contained iframe page `html/adventure-editor.html` (mirrors the settlement editor), built from the owner-approved on-token mockup, 3-column layout (Liste | Stammdaten | Orte). Pure client on the existing `POST /api/edit/map/adventures.php` actions (`list`, `detail`, `upsert_adventure`, `add_place`, `set_place`, `suppress_place`, `resolve_place`) — **no backend changes**. Every mutation re-fetches `detail` and re-renders (simplicity over cleverness; editor is not perf-critical).

**Tech Stack:** Vanilla JS (no build), inline in the HTML; the shell links `/css/base/tokens.css` + `/css/base/fonts.css`. Opener registered in `js/app/bootstrap.js` (jQuery), button in `index.html`.

**Spec:** `docs/abenteuer-editor-ui-spec.md`. **Reference mockup (committed):** `html/adventure-editor-mockup.html`.

## Global Constraints

- **CORE invariant:** Ort order = start places on top, **never auto-reorder** — only manual ▲▼ (`sort_order` via `set_place`).
- **Only tokens, no blue** — no hardcoded hex/radius/spacing; use `var(--…)` from `css/base/tokens.css` (AGENTS.md §12).
- **`?v=Date.now()`** on the iframe `src` — the editor asset is dynamically loaded; **no `ASSET_VERSION` bump** (C1).
- **Gold-Contract envelope:** every call expects `{ok:true,…}` / `{ok:false,error:{code,message}}`; surface `error.message`.
- **STRATO:** probe endpoints with a **single request**, never loop.
- **Shared working tree:** `git status` first; stage **only your own files by explicit path**, never `git add -A`.
- **Autocomplete is P3** — in P2 a place is added by raw name + optional kind, then resolved server-side via `resolve_place`.
- **Verification pattern:** this feature has no unit tests (the settlement-editor template has none); verify via headless smoke (static shell) + a browser acceptance checklist against the backend on **localhost** (single requests). UI logic lives in one self-contained file by design.

---

### Task 1: Editor shell + styles (`html/adventure-editor.html`)

Create the real editor page from the committed mockup: keep all CSS + the layout-C structure, **strip the mockup harness** (the `.mock-bar` switcher, the demo place/adventure content), leave empty column bodies with a "Lädt…" placeholder, and add the JS scaffolding constants. This task ships a page that renders the 3-column shell on tokens with no data.

**Files:**
- Create: `html/adventure-editor.html` (base copied from `html/adventure-editor-mockup.html`)

**Interfaces:**
- Produces (global element ids/classes later tasks rely on): container `.ae-dialog`; columns `.ae-list` (with `#aeSearch`, `#aeNew`, `#aeListCount`, `#aeListScroll`), `.ae-panel--stamm` (`#aeStammBody`), `.ae-panel--orte` (`#aeOrteBody`); detail head `#aeDetailHead`; savebar `#aeSaveBar` (`#aeSaveState`, `#aeDiscard`, `#aeSave`).
- Produces (JS globals): `ADVENTURE_EDIT_API`, `adventurePost(body)`.

- [ ] **Step 1: Copy the mockup to the real editor path**

```bash
cp html/adventure-editor-mockup.html html/adventure-editor.html
```

- [ ] **Step 2: Remove the mockup harness**

In `html/adventure-editor.html` delete the entire `<div class="mock-bar">…</div>` block and the `.mock-bar`/`.mock-seg`/`.mock-hint` CSS rules and the layout-switcher/theme-toggle/hash-preselect JS. Keep the `data-layout="c"` on `<body>` but the A/B variant CSS can stay (harmless, unreachable) OR be removed for cleanliness — removing is preferred. Keep the tab-switch JS only if you keep variant B; for C-only it is dead, remove it.

- [ ] **Step 3: Replace the static list/detail/orte content with empty containers + ids**

Left column body becomes:
```html
<p class="ae-list__count" id="aeListCount">Lädt…</p>
<div class="ae-list__scroll" id="aeListScroll"></div>
```
The search input gets `id="aeSearch"`, the "+ Neu" button `id="aeNew"`. Detail head becomes `<div class="ae-detail__head" id="aeDetailHead"></div>`. Stammdaten panel body becomes `<div class="ae-panel ae-panel--stamm" id="aeStammBody"></div>`; Orte panel body `<div class="ae-panel ae-panel--orte" id="aeOrteBody"></div>`. Savebar ids: `#aeSaveBar`, `#aeSaveState`, `#aeDiscard`, `#aeSave`. Show a neutral placeholder in `#aeStammBody`/`#aeOrteBody`: `<p style="color:var(--color-text-muted);padding:var(--space-16)">Abenteuer links wählen oder neu anlegen.</p>`.

- [ ] **Step 4: Add the API constant + POST helper (mirror `settlementDetailPost`)**

In the `<script>` at the top:
```js
const ADVENTURE_EDIT_API = "/api/edit/map/adventures.php";
async function adventurePost(body) {
  const response = await fetch(ADVENTURE_EDIT_API, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.ok !== true) {
    throw new Error((payload && payload.error && payload.error.message) || `HTTP ${response.status}`);
  }
  return payload;
}
function aeEscape(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
```

- [ ] **Step 5: Verify the shell renders (automated headless smoke)**

Run (Windows PowerShell):
```powershell
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
$f = "C:/GIT/avesmaps/.claude/worktrees/bridge-cse_01AnynVS5ZZudvviatza2UKd/html/adventure-editor.html"
& $edge --headless=new --disable-gpu --dump-dom "file:///$f" > "$env:TEMP\aedom.html" 2>$null
Select-String -Path "$env:TEMP\aedom.html" -Pattern 'ae-list|ae-panel--stamm|ae-panel--orte|aeSaveBar' | Measure-Object | % Count
```
Expected: count ≥ 4 (all four regions present). Also screenshot with the `--screenshot` command from the mockup session and eyeball: 3 columns, warm/token palette, no blue, no console errors.

- [ ] **Step 6: Commit**

```bash
git status --short
git add html/adventure-editor.html
git commit -m "feat(adventures): P2 editor shell (layout C, on tokens) from approved mockup"
```

---

### Task 2: Entry point — button, opener, bootstrap wiring

Make the editor reachable: an "Abenteuereditor" button under "Dump holen", an overlay opener mirroring the settlement editor (iframe + `?v=Date.now()`), and the bootstrap click handler.

**Files:**
- Modify: `index.html` (inside `.wiki-sync-dump-central`, ~line 342–355)
- Modify: `js/review/review-settlement-list.js` (add opener next to `openAvesmapsSettlementEditorOverlay`, ~line 483–527) — or a new sibling; reuse the same overlay CSS classes.
- Modify: `js/app/bootstrap.js` (add click handler next to line 267)

**Interfaces:**
- Consumes: `html/adventure-editor.html` (Task 1).
- Produces: `window.openAvesmapsAdventureEditorOverlay()`; `#adventure-editor-open` button; `#adventure-editor-synced` span.

- [ ] **Step 1: Add the button + synced span in `index.html`**

Inside `<div class="wiki-sync-dump-central">`, immediately after the existing `<div class="wiki-sync-panel__actions wiki-sync-dump-actions">…</div>` row, insert:
```html
<div class="wiki-sync-panel__actions">
  <button id="adventure-editor-open" class="wiki-sync-panel__start" type="button"
    title="Öffnet den Abenteuereditor (anlegen/bearbeiten, Orte zuordnen).">🗺️ Abenteuereditor</button>
  <span id="adventure-editor-synced" class="wiki-sync-panel__summary" hidden></span>
</div>
```

- [ ] **Step 2: Add the opener (mirror `openAvesmapsSettlementEditorOverlay`)**

In `js/review/review-settlement-list.js`, after the settlement opener, add:
```js
window.openAvesmapsAdventureEditorOverlay = window.openAvesmapsAdventureEditorOverlay || function openAvesmapsAdventureEditorOverlay() {
	const overlayId = "avesmaps-adventure-editor-overlay";
	const buildSrc = () => "/html/adventure-editor.html?v=" + Date.now();
	let overlay = document.getElementById(overlayId);
	if (overlay) { overlay.hidden = false; document.body.style.overflow = "hidden"; return; }
	overlay = document.createElement("div");
	overlay.id = overlayId;
	overlay.className = "political-territory-editor-overlay";
	overlay.style.zIndex = "1500";
	const dialog = document.createElement("div");
	dialog.className = "political-territory-editor-dialog";
	dialog.style.width = "min(1400px, calc(100vw - 24px))";
	dialog.style.height = "min(880px, calc(100vh - 24px))";
	const header = document.createElement("div");
	header.className = "political-territory-editor-dialog__header";
	const headingEl = document.createElement("h2");
	headingEl.textContent = "Abenteuer anlegen und editieren";
	const closeButton = document.createElement("button");
	closeButton.type = "button";
	closeButton.className = "political-territory-editor-dialog__close";
	closeButton.setAttribute("aria-label", "Schließen");
	closeButton.textContent = "✕";
	const closeOverlay = () => { overlay.hidden = true; document.body.style.overflow = ""; };
	closeButton.addEventListener("click", closeOverlay);
	header.appendChild(headingEl); header.appendChild(closeButton);
	const frame = document.createElement("iframe");
	frame.className = "political-territory-editor-dialog__frame";
	frame.src = buildSrc();
	frame.title = "Abenteuereditor";
	dialog.appendChild(header); dialog.appendChild(frame);
	overlay.appendChild(dialog);
	overlay.addEventListener("click", (event) => { if (event.target === overlay) closeOverlay(); });
	document.body.appendChild(overlay);
	document.body.style.overflow = "hidden";
};
```

- [ ] **Step 3: Wire the click in `bootstrap.js`**

After line 267 (`$("#settlement-editor-open")…`) add:
```js
$("#adventure-editor-open").on("click", () => openAvesmapsAdventureEditorOverlay());
```

- [ ] **Step 4: Verify (browser, localhost)**

Open the app on localhost with the editor panel visible. Click "🗺️ Abenteuereditor". Expected: centered overlay opens, iframe loads `adventure-editor.html`, the 3-column shell shows, header "Abenteuer anlegen und editieren", ✕ and backdrop-click both close it. Confirm the iframe `src` carries `?v=`.

- [ ] **Step 5: Commit**

```bash
git status --short
git add index.html js/review/review-settlement-list.js js/app/bootstrap.js
git commit -m "feat(adventures): entry point — Abenteuereditor button + overlay opener"
```

---

### Task 3: Left list (`list` action) + search + selection + "+ Neu"

On load, fetch `list`, render the adventure rows, filter by the search box, select a row (loads its detail in Tasks 4/5), and start a fresh adventure with "+ Neu".

**Files:**
- Modify: `html/adventure-editor.html` (script)

**Interfaces:**
- Consumes: `adventurePost`, `#aeListScroll`, `#aeListCount`, `#aeSearch`, `#aeNew`.
- Produces: `state.adventures`, `state.selectedId`; functions `loadList()`, `renderList()`, `selectAdventure(publicId)` (Task 4/5 implement the detail side of `selectAdventure`), `newAdventure()`.

- [ ] **Step 1: Add editor state + list load/render**

```js
const state = { adventures: [], selectedId: null, detail: null };

async function loadList() {
  try {
    const { adventures } = await adventurePost({ action: "list" });
    state.adventures = adventures || [];
    renderList();
  } catch (e) {
    document.getElementById("aeListCount").textContent = "Fehler: " + e.message;
  }
}

function renderList() {
  const q = (document.getElementById("aeSearch").value || "").trim().toLowerCase();
  const rows = state.adventures.filter((a) => !q || a.title.toLowerCase().includes(q));
  document.getElementById("aeListCount").textContent = `${rows.length} von ${state.adventures.length}`;
  const scroll = document.getElementById("aeListScroll");
  scroll.innerHTML = rows.map((a) => {
    const draft = a.status !== "approved";
    const manual = a.origin === "manual" ? ` · <span class="pill pill--manual">manuell</span>` : "";
    return `<button class="ae-item${a.public_id === state.selectedId ? " is-selected" : ""}${draft ? " is-draft" : ""}" data-id="${aeEscape(a.public_id)}">
      <span class="ae-item__l1"><span class="ae-item__title">${aeEscape(a.title)}</span></span>
      <span class="ae-item__l2"><span class="pill pill--kind">${aeEscape(a.product_type)}</span> ${aeEscape(a.bf_label || "—")} · ${a.place_count} Orte${manual}</span>
    </button>`;
  }).join("") || `<p class="ae-empty" style="color:var(--color-text-muted);padding:var(--space-8)">Keine Abenteuer.</p>`;
}
```

- [ ] **Step 2: Wire search, row click, "+ Neu", and initial load**

```js
document.getElementById("aeSearch").addEventListener("input", renderList);
document.getElementById("aeListScroll").addEventListener("click", (e) => {
  const b = e.target.closest(".ae-item"); if (!b) return;
  selectAdventure(b.dataset.id);
});
document.getElementById("aeNew").addEventListener("click", newAdventure);
loadList();
```

- [ ] **Step 3: Add a minimal `selectAdventure` + `newAdventure` (detail bodies filled in Tasks 4/5)**

```js
async function selectAdventure(publicId) {
  state.selectedId = publicId;
  renderList();
  try {
    state.detail = await adventurePost({ action: "detail", public_id: publicId });
    renderDetail(); renderPlaces();
  } catch (e) {
    document.getElementById("aeStammBody").innerHTML = `<p style="color:var(--color-danger);padding:var(--space-16)">Fehler: ${aeEscape(e.message)}</p>`;
  }
}
function newAdventure() {
  state.selectedId = null; state.detail = null; renderList();
  renderDetail(); renderPlaces();
}
```
(Provide temporary no-op `renderDetail`/`renderPlaces` stubs if implementing tasks strictly in order — Task 4/5 replace them.)

- [ ] **Step 4: Verify (browser, localhost)**

Open the editor. Expected: list populates from `list`, count "N von M", type pills + bf + place counts show, typing filters live, clicking a row highlights it and triggers a `detail` fetch (Network: one POST, `action:"detail"`). "+ Neu" clears the selection. (Single requests only.)

- [ ] **Step 5: Commit**

```bash
git status --short
git add html/adventure-editor.html
git commit -m "feat(adventures): editor left list — list/search/select/new"
```

---

### Task 4: Detail / Stammdaten (`detail` render + `upsert_adventure`)

Render the detail head + three field groups from `state.detail`, mark manual fields, save all fields via `upsert_adventure`, and handle the create (empty) form.

**Files:**
- Modify: `html/adventure-editor.html` (script)

**Interfaces:**
- Consumes: `state.detail`, `adventurePost`, `#aeDetailHead`, `#aeStammBody`, `#aeSaveState`, `#aeSave`, `#aeDiscard`.
- Produces: `renderDetail()`, `gatherStamm()`, `saveStammdaten()`. Field inputs carry `data-field="<column>"`.

- [ ] **Step 1: Implement `renderDetail` (head + grouped fields + manual badges)**

```js
const PRODUCT_TYPES = ["gruppenabenteuer","soloabenteuer","kurzabenteuer","szenario","anthologie","kampagne"];
const EDITIONS = ["","DSA1","DSA2","DSA3","DSA4","DSA5"];
function aeField(label, field, value, origins, opts = {}) {
  const manual = origins && origins[field] === "manual"
    ? ` <span class="badge-manual" title="Manuell gesetzt — ein Wiki-Sync fasst dieses Feld nicht mehr an.">manuell</span>` : "";
  let control;
  if (opts.select) {
    control = `<select class="ae-select" data-field="${field}">${opts.select.map((o) =>
      `<option${o === (value || "") ? " selected" : ""}>${aeEscape(o)}</option>`).join("")}</select>`;
  } else if (opts.checkbox) {
    control = `<label class="ae-check"><input type="checkbox" data-field="${field}"${value ? " checked" : ""}> ${aeEscape(label)}</label>`;
    return `<div class="ae-field${opts.wide ? " is-wide" : ""}">${control}</div>`;
  } else {
    control = `<input class="ae-input" data-field="${field}"${opts.number ? ' type="number"' : ""} value="${aeEscape(value)}">`;
  }
  return `<div class="ae-field${opts.wide ? " is-wide" : ""}"><label>${aeEscape(label)}${manual}</label>${control}</div>`;
}

function renderDetail() {
  const d = state.detail;
  const head = document.getElementById("aeDetailHead");
  const body = document.getElementById("aeStammBody");
  document.getElementById("aeSaveBar").hidden = false;
  document.getElementById("aeSaveState").textContent = "";
  if (!d) {
    head.innerHTML = `<div class="ae-detail__head-main"><h2 class="ae-detail__title">Neues Abenteuer</h2>
      <div class="ae-detail__meta">Noch nicht gespeichert</div></div>`;
    d = null;
  } else {
    const originPill = d.origin === "manual" ? "Manuell" : "Wiki";
    head.innerHTML = `<div class="ae-detail__head-main">
      <h2 class="ae-detail__title">${aeEscape(d.title || "—")}</h2>
      <div class="ae-detail__meta"><span class="pill pill--kind">${aeEscape(d.product_type)}</span>
        <span>${aeEscape(d.edition || "")} ${aeEscape(d.bf_label || "")}</span>
        <span class="pill pill--wiki">Quelle: ${originPill}</span>
        ${d.wiki_key ? `<span>wiki_key: <code>${aeEscape(d.wiki_key)}</code></span>` : ""}</div></div>`;
  }
  const v = d || {}; const o = (d && d.field_origins) || {};
  body.innerHTML = `
    <div class="ae-grp"><p class="ae-grp__title">Identität</p><div class="ae-fields">
      ${aeField("Titel *","title",v.title||"",o,{wide:true})}
      ${aeField("Produkttyp","product_type",v.product_type||"gruppenabenteuer",o,{select:PRODUCT_TYPES})}
      ${aeField("Regelsystem","edition",v.edition||"",o,{select:EDITIONS})}
      ${aeField("Offizielles Produkt","is_official",v.is_official!==false,o,{checkbox:true})}
      ${aeField("Serie / Reihe","series",v.series||"",o)}
    </div></div>
    <div class="ae-grp"><p class="ae-grp__title">Datierung &amp; Einordnung</p><div class="ae-fields">
      ${aeField("BF-Jahr","bf_year",v.bf_year==null?"":v.bf_year,o,{number:true})}
      ${aeField("BF-Label","bf_label",v.bf_label||"",o)}
      ${aeField("Genre","genre",v.genre||"",o)}
      ${aeField("Komplexität (SL)","complexity_gm",v.complexity_gm||"",o)}
      ${aeField("Komplexität (Spieler)","complexity_pl",v.complexity_pl||"",o)}
      ${aeField("Autoren","authors",v.authors||"",o,{wide:true})}
    </div></div>
    <div class="ae-grp"><p class="ae-grp__title">Wiki &amp; F-Shop</p><div class="ae-fields">
      ${aeField("Wiki-URL","wiki_url",v.wiki_url||"",o,{wide:true})}
      ${aeField("F-Shop-Code","fshop_code",v.fshop_code||"",o)}
      ${aeField("Cover-URL","cover_url",v.cover_url||"",o)}
    </div></div>`;
}
```

- [ ] **Step 2: Implement gather + save (all fields → `upsert_adventure`)**

```js
function gatherStamm() {
  const out = {};
  document.querySelectorAll("#aeStammBody [data-field]").forEach((el) => {
    const f = el.dataset.field;
    out[f] = el.type === "checkbox" ? el.checked : el.value;
  });
  if (state.selectedId) out.public_id = state.selectedId;
  return out;
}
async function saveStammdaten() {
  const adventure = gatherStamm();
  if (!adventure.title || !adventure.title.trim()) { document.getElementById("aeSaveState").textContent = "Titel fehlt."; return; }
  try {
    const { public_id } = await adventurePost({ action: "upsert_adventure", adventure });
    state.selectedId = public_id;
    await loadList();
    await selectAdventure(public_id);
    document.getElementById("aeSaveState").textContent = "✓ gespeichert";
  } catch (e) {
    document.getElementById("aeSaveState").textContent = "Fehler: " + e.message;
  }
}
document.getElementById("aeSave").addEventListener("click", saveStammdaten);
document.getElementById("aeDiscard").addEventListener("click", () => { if (state.selectedId) selectAdventure(state.selectedId); else newAdventure(); });
```

- [ ] **Step 3: Verify (browser, localhost)**

Select an adventure: head + all three groups fill; a wiki-synced field the owner previously edited shows the `manuell` badge. Edit the title, click "Stammdaten speichern" → "✓ gespeichert", list refreshes, reload of the overlay keeps the change. "+ Neu" → empty form, save with a title creates a new row (appears in list). Confirm each save is a single POST `upsert_adventure`.

- [ ] **Step 4: Commit**

```bash
git status --short
git add html/adventure-editor.html
git commit -m "feat(adventures): editor Stammdaten — detail render + upsert + manual badges"
```

---

### Task 5: Orte (places render + add/resolve/start/reorder/suppress/restore)

The core. Render approved places (start-first as loaded), the add-row (add + auto-resolve), the per-row start toggle (multiple allowed), manual ▲▼ reorder, remove/suppress, and the hidden-tombstones toggle with restore.

**Files:**
- Modify: `html/adventure-editor.html` (script + the Orte panel body markup from Task 1)

**Interfaces:**
- Consumes: `state.detail.places`, `adventurePost`, `#aeOrteBody`, `state.selectedId`.
- Produces: `renderPlaces()`, and action handlers keyed by `data-act` on `#aeOrteBody`.

- [ ] **Step 1: Implement `renderPlaces` (head + add-row + approved rows + hidden tombstones)**

```js
const KIND_LABEL = { settlement:"Siedlung", territory:"Territorium", region:"Region", path:"Weg", unresolved:"—" };
function placeRow(p, isFirst, isLast) {
  const start = p.role === "start";
  const kind = p.target_kind || "unresolved";
  const resolved = kind === "unresolved"
    ? `<span class="pill pill--unresolved">nicht aufgelöst</span> Rohname bleibt erhalten`
    : `→ ${aeEscape(KIND_LABEL[kind] || kind)} <code>${aeEscape(p.target_wiki_key || p.target_public_id || "")}</code>`;
  const origin = p.origin === "manual" ? `<span class="pill pill--manual">manuell</span>` : `<span class="pill pill--wiki">Wiki</span>`;
  return `<div class="ae-place${start ? " is-start" : ""}" data-place-id="${p.id}">
    <div class="ae-place__order"><span class="ord-num">${p.sort_order}</span>
      <div class="ae-place__reorder">
        <button data-act="up" title="hoch"${isFirst ? " disabled" : ""}>▲</button>
        <button data-act="down" title="runter"${isLast ? " disabled" : ""}>▼</button></div></div>
    <div class="ae-place__main">
      <div class="ae-place__name">${aeEscape(p.raw_name)}</div>
      <div class="ae-place__resolved">${resolved}</div>
      <div class="ae-place__badges">${kind !== "unresolved" ? `<span class="pill pill--kind">${aeEscape(KIND_LABEL[kind])}</span>` : ""} ${origin}</div></div>
    <div class="ae-place__ctl">
      ${kind === "unresolved" ? `<button class="btn btn--sm" data-act="resolve" title="Erneut auflösen">↻ Auflösen</button>` : ""}
      <button class="btn btn--sm start-toggle${start ? " is-on" : ""}" data-act="start" title="Startort umschalten (mehrere möglich)">${start ? "★ Startort" : "☆ Start"}</button>
      <button class="btn btn--icon btn--danger" data-act="suppress" title="Entfernen">✕</button></div></div>`;
}
function renderPlaces() {
  const body = document.getElementById("aeOrteBody");
  if (!state.detail) { body.innerHTML = `<p style="color:var(--color-text-muted);padding:var(--space-16)">Noch kein Abenteuer gewählt.</p>`; return; }
  const all = state.detail.places || [];
  const approved = all.filter((p) => p.status === "approved");
  const suppressed = all.filter((p) => p.status === "suppressed");
  body.innerHTML = `
    <div class="ae-orte__head"><h3>Orte (${approved.length})</h3>
      <span class="ae-orte__invariant" title="Startorte oben; nie automatisch umsortieren — nur manuell per ▲▼.">★ Startorte oben · manuell ordenbar (▲▼)</span>
      <span style="flex:1"></span>
      ${suppressed.length ? `<button class="btn btn--sm" data-act="toggle-sup">unterdrückte anzeigen (${suppressed.length})</button>` : ""}</div>
    <div class="ae-add">
      <input class="ae-input" id="aeAddName" placeholder="Ortsname (Wiki-Titel) hinzufügen …">
      <select class="ae-select" id="aeAddKind"><option value="unresolved">Typ: automatisch</option>
        <option>settlement</option><option>territory</option><option>region</option><option>path</option></select>
      <button class="btn btn--primary" data-act="add">+ Ort</button></div>
    <p class="ae-orte__hint" style="margin:0 0 var(--space-8)">★ = beginnt hier (Spoiler-frei) · übrige = spielt hier (Spoiler) · mehrere Startorte möglich · neuer Ort wird automatisch aufgelöst</p>
    ${approved.length ? approved.map((p, i) => placeRow(p, i === 0, i === approved.length - 1)).join("")
      : `<p style="color:var(--color-text-muted)">Noch keine Orte — oben hinzufügen.</p>`}
    <div class="ae-suppressed-wrap" hidden>${suppressed.map((p) =>
      `<div class="ae-place is-suppressed" data-place-id="${p.id}">
        <div class="ae-place__order"><span class="ord-num">—</span></div>
        <div class="ae-place__main"><div class="ae-place__name">${aeEscape(p.raw_name)}</div>
          <div class="ae-place__resolved">Wiki-Ort entfernt · ein Re-Sync fügt ihn nicht wieder hinzu</div>
          <div class="ae-place__badges"><span class="pill pill--kind">${aeEscape(KIND_LABEL[p.target_kind] || p.target_kind)}</span> <span class="pill">unterdrückt</span></div></div>
        <div class="ae-place__ctl"><button class="btn btn--sm" data-act="restore" data-raw="${aeEscape(p.raw_name)}" data-kind="${aeEscape(p.target_kind)}">↺ Zurückholen</button></div></div>`).join("")}</div>`;
}
```

- [ ] **Step 2: Implement the delegated action handler (add/resolve/start/reorder/suppress/restore/toggle)**

```js
async function reloadDetail() { state.detail = await adventurePost({ action: "detail", public_id: state.selectedId }); renderDetail(); renderPlaces(); await loadList(); }

document.getElementById("aeOrteBody").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]"); if (!btn) return;
  const act = btn.dataset.act;
  const rowEl = btn.closest("[data-place-id]");
  const placeId = rowEl ? Number(rowEl.dataset.placeId) : null;
  try {
    if (act === "toggle-sup") {
      const wrap = document.querySelector(".ae-suppressed-wrap");
      const show = wrap.hasAttribute("hidden");
      wrap.toggleAttribute("hidden", !show);
      btn.textContent = btn.textContent.replace(show ? "anzeigen" : "ausblenden", show ? "ausblenden" : "anzeigen");
      return;
    }
    if (!state.selectedId) { alert("Erst ein Abenteuer speichern/wählen."); return; }
    if (act === "add") {
      const raw = document.getElementById("aeAddName").value.trim(); if (!raw) return;
      const kind = document.getElementById("aeAddKind").value;
      const place = { raw_name: raw }; if (kind && kind !== "unresolved") place.target_kind = kind;
      const { place_id } = await adventurePost({ action: "add_place", adventure_public_id: state.selectedId, place });
      await adventurePost({ action: "resolve_place", place_id }); // auto-resolve (owner default)
    } else if (act === "resolve") {
      await adventurePost({ action: "resolve_place", place_id: placeId });
    } else if (act === "start") {
      const on = btn.classList.contains("is-on");
      await adventurePost({ action: "set_place", place_id: placeId, place: { role: on ? "play" : "start" } });
    } else if (act === "suppress") {
      await adventurePost({ action: "suppress_place", place_id: placeId });
    } else if (act === "restore") {
      const place = { raw_name: btn.dataset.raw };
      if (btn.dataset.kind && btn.dataset.kind !== "unresolved") place.target_kind = btn.dataset.kind;
      await adventurePost({ action: "add_place", adventure_public_id: state.selectedId, place });
    } else if (act === "up" || act === "down") {
      const approved = (state.detail.places || []).filter((p) => p.status === "approved");
      const idx = approved.findIndex((p) => p.id === placeId);
      const swapWith = act === "up" ? approved[idx - 1] : approved[idx + 1];
      if (!swapWith) return;
      const a = approved[idx];
      // swap sort_order of the two neighbours (never auto-reorder anything else)
      await adventurePost({ action: "set_place", place_id: a.id, place: { sort_order: swapWith.sort_order } });
      await adventurePost({ action: "set_place", place_id: swapWith.id, place: { sort_order: a.sort_order } });
    }
    await reloadDetail();
  } catch (err) { alert("Fehler: " + err.message); }
});
```

- [ ] **Step 3: Verify (browser, localhost) — the full places matrix**

Select an adventure with places. Expected, each verified against a reload:
- Add "Salderkeim" → row appears, auto-resolved to Siedlung (2 POSTs: `add_place` then `resolve_place`).
- "☆ Start" toggles to "★ Startort" (gold), row gets the gold frame; toggle a **second** row to start too (multiple allowed); untoggling sets it back to play.
- ▲▼ swaps a row with its neighbour; reload → order persists; first ▲ / last ▼ disabled. A start row can be moved too — nothing auto-reorders.
- ✕ on a **wiki** place → it vanishes from the list and appears under "unterdrückte anzeigen (N)"; ✕ on a **manual** place → hard-gone (not in tombstones).
- Toggle reveals tombstones; "↺ Zurückholen" re-adds it as a manual place (Wiki badge → manuell).
- "Auflösen" on an unresolved row updates its kind/target.
Every action is ≤2 single requests (STRATO-safe).

- [ ] **Step 4: Commit**

```bash
git status --short
git add html/adventure-editor.html
git commit -m "feat(adventures): editor Orte — add/resolve/start/reorder/suppress/restore"
```

---

### Task 6: Acceptance pass, polish, cleanup

Full end-to-end walkthrough, dark-theme + no-blue audit, remove the throwaway mockup, confirm the cache-bust.

**Files:**
- Delete: `html/adventure-editor-mockup.html`
- Modify (if audit finds a stray literal): `html/adventure-editor.html`

- [ ] **Step 1: End-to-end acceptance (browser, localhost)**

Create a new adventure ("+ Neu" → title → save), add 3 places, mark 1–2 as start, reorder a play place, remove one (suppress), toggle tombstones + restore, edit a Stammdaten field. Close and reopen the overlay → everything persisted. No console errors; every network action is a single request.

- [ ] **Step 2: Design audit**

Grep the editor for hardcoded colours (should be none new): `Select-String -Path html/adventure-editor.html -Pattern '#[0-9a-fA-F]{3,6}'` → only expect matches inside sample/placeholder text, not CSS. Toggle `document.documentElement.dataset.theme='dark'` in the iframe console → panel stays warm, readable, no blue. Fix any stray literal by swapping to the matching token.

- [ ] **Step 3: Confirm cache-bust**

Verify the opener builds `src` with `?v=` + a timestamp (no `ASSET_VERSION` involved). One hard reload after editing `bootstrap.js`/`review-settlement-list.js` (loaded without `?v=`).

- [ ] **Step 4: Remove the mockup + commit**

```bash
git rm html/adventure-editor-mockup.html
git status --short
git commit -m "chore(adventures): drop P2 editor mockup (superseded by adventure-editor.html)"
```

- [ ] **Step 5: Update the memory/doc pointer**

Update the memory `adventures-feature-phase1.md` Phase-3 block: P2 (Editor-UI) LIVE. Update `docs/abenteuer-instruction.md` §Phase 3 status note if desired (P2 done, P3 autocomplete next).

---

## Self-Review

**Spec coverage** (`docs/abenteuer-editor-ui-spec.md`):
- §1 owner decisions → layout C (T1), multiple starts (T5 start toggle), manual reorder (T5 ▲▼), hidden tombstones (T5), tokens (T1/T6). ✓
- §2 shell/hosting → T1 (tokens+fonts, `?v=` in T2 opener). ✓
- §3 layout C → T1. ✓
- §4 list → T3. ✓
- §5 Stammdaten + save + manual badges + P2 limit → T4. ✓
- §6 Orte (add/auto-resolve/start/reorder/suppress/restore/tombstone toggle) → T5. ✓
- §7 badge/token language → rendered in T3/T4/T5, audited in T6. ✓
- §8 button + opener + empty/create states → T2 (button/opener), T3/T4 (create/empty). ✓
- §9 invariants (CORE reorder, tokens, `?v=`, STRATO single-request, shared-tree) → Global Constraints + per-task verify. ✓
- §10 file map → T1 create, T2 modify bootstrap/index/review, T6 delete mockup. ✓

**Placeholder scan:** temporary no-op `renderDetail`/`renderPlaces` stubs in T3 Step 3 are explicitly replaced in T4/T5 — not a plan gap (noted inline).

**Type consistency:** `adventurePost`, `state`, `loadList`, `renderList`, `selectAdventure`, `renderDetail`, `renderPlaces`, `reloadDetail`, `gatherStamm`, `saveStammdaten` used with consistent signatures across T3–T5; place action keys (`add`/`resolve`/`start`/`up`/`down`/`suppress`/`restore`/`toggle-sup`) consistent between `renderPlaces` markup (T5S1) and the handler (T5S2); ids (`aeSearch`,`aeListScroll`,`aeStammBody`,`aeOrteBody`,`aeSave`,`aeSaveState`,`aeDetailHead`) consistent T1↔T3↔T4↔T5. ✓
