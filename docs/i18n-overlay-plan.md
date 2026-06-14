# `?lang=en` i18n Overlay Implementation Plan (v1 — planner core)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in English overlay (`?lang=en`) over a small slice of the public route planner, proving a keyed `data-i18n` + `tr()` mechanism that German stays the default for and that extends cleanly later.

**Architecture:** A new engine (`js/app/i18n.js`) reads `?lang=en` and, when active, sets `<html lang="en">`, runs a DOM pass that overwrites `[data-i18n*]` elements from an English override table (`js/app/i18n-en.js`), and exposes `window.tr(key, germanDefault, params)` for dynamically built strings. German literals are never removed from source; English is purely additive; a missing key falls back to German. The annotation IS the scope — only tagged elements are touched, so map/domain content is never affected.

**Tech stack:** Vanilla ES5-compatible JS, no build, classic `<script>` includes in `index.html` (auto-`?v=`-stamped on deploy). jQuery 3.6 is present. **There is no unit-test framework** (no bundler, no runner) — per the project convention, each task is verified with `node --check` (syntax) plus, after deploy, a manual browser smoke (noted per task; the human runs the browser checks, the agent runs `node --check` + `curl`).

**Spec:** `docs/i18n-overlay-design.md`.

**Scope of v1 (locked):**
- IN (static, `data-i18n`): `#searchButton` "Suche", `#toggle-button` "Routenplaner", route mode "Schnellste/Kürzeste Route", "Umsteigen minimieren", "Rastzeiten", "Stunden pro Tag", `#overview` default text.
- IN (dynamic, `tr()`): the route summary in `route-plan.js`, the route description in `route-view-model.js`, the "Route wird berechnet..." status in `route-engine.js`, and the `resetOverview()` default in `map-features.js`.
- IN (behavior): exclude `lang` from generated share links.
- OUT (stays German, by design): the whole **transport section** (heading "Transportmittel", the Land/Fluss/Meer filter labels, the native `<select>`s + their `aria-label`s + the per-JS custom combobox/menu with km/h values) — a nested subsystem, deferred to the first extension; the right-click context menus; the legal/Hinweise dialog; spotlight search; reviews; report dialog; editor; WikiSync; admin; SEO/meta/JSON-LD; all map labels & domain content (place names, `BF`, slugs, `<option value>` slugs, `PATH_SUBTYPE_KEYS`, `entry.type`).

---

## File structure

- **Create** `js/app/i18n.js` — engine: lang detection, `tr()`, `applyI18nOverlay()`, `<html lang>` flip, DOMContentLoaded hook. ~75 lines.
- **Create** `js/app/i18n-en.js` — data: `window.AVESMAPS_I18N_EN = { ... }`. English override strings only.
- **Modify** `index.html` — load the two new scripts after `config.js`; add `data-i18n*` attributes / wrapping `<span>`s to the 8 in-scope planner elements.
- **Modify** `js/routing/route-plan.js` — wrap summary UI words with `tr()`.
- **Modify** `js/routing/route-view-model.js` — wrap route-description connectors with `tr()`.
- **Modify** `js/routing/route-engine.js` — wrap the "Route wird berechnet..." status with `tr()`.
- **Modify** `js/map-features/map-features.js` — wrap the `resetOverview()` default text with `tr()`.
- **Modify** `js/app/share-link.js` — add `lang` to the share-link strip list.

---

## Task 1: i18n engine + English data table, wired into index.html

**Files:**
- Create: `js/app/i18n.js`
- Create: `js/app/i18n-en.js`
- Modify: `index.html:1086` (insert two `<script>` tags after `config.js`)

- [ ] **Step 1: Create the English data table** `js/app/i18n-en.js`

```js
/*
 * English override strings for the ?lang=en overlay (v1: planner core).
 * Keyed by stable i18n key; German stays the inline / tr() default elsewhere.
 * Add entries here as coverage grows. Domain content is never keyed.
 */
window.AVESMAPS_I18N_EN = {
	// --- planner: static chrome (data-i18n) ---
	"planner.search": "Search",
	"planner.toggle": "Route planner",
	"planner.route.fastest": "Fastest route",
	"planner.route.shortest": "Shortest route",
	"planner.minimizeTransfers": "Minimize transfers",
	"planner.rests": "Rest periods",
	"planner.restHoursSuffix": "hours per day",
	"planner.overview.default": "Waypoints and travel time are shown here.",

	// --- planner: dynamic overview/summary (tr) ---
	"planner.overview.calculating": "Calculating route...",
	"planner.journey.prefix": "The journey",
	"planner.journey.from": "from",
	"planner.journey.to": "to",
	"planner.journey.via": "via",
	"planner.leg.offroad": "Rough terrain",
	"planner.leg.via": "via",
	"planner.leg.from": "from",
	"planner.leg.to": "to",
	"planner.leg.in": "in",
	"planner.summary.distance": "Distance",
	"planner.summary.airDistance": "As the dragon flies",
	"planner.summary.travelTime": "Travel time",
	"planner.summary.restTime": "Rest time",
	"planner.summary.totalTime": "Total time",
	"planner.shareRoute": "Copy link for this route",
	"planner.unit.miles": "miles",
	"planner.unit.hours": "hours",
	"planner.unit.days": "days",
};
```

- [ ] **Step 2: Create the engine** `js/app/i18n.js`

```js
/*
 * i18n overlay engine. German is the default; English (?lang=en) is an additive,
 * keyed override. Inert under German. See docs/i18n-overlay-design.md.
 */
(function () {
	"use strict";

	function detectLang() {
		try {
			return new URLSearchParams(window.location.search).get("lang") === "en" ? "en" : "de";
		} catch (error) {
			return "de";
		}
	}

	var ACTIVE_LANG = detectLang();

	function table() {
		return window.AVESMAPS_I18N_EN || {};
	}

	function formatTemplate(template, params) {
		if (!params || template == null) {
			return template;
		}
		return String(template).replace(/\{(\w+)\}/g, function (match, key) {
			return Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match;
		});
	}

	function warnMissing(key) {
		if (window.console && typeof console.warn === "function") {
			console.warn("[i18n] missing English key:", key);
		}
	}

	// tr(key, germanDefault, params?) -> string. German: returns germanDefault.
	function tr(key, germanDefault, params) {
		if (ACTIVE_LANG !== "en") {
			return formatTemplate(germanDefault, params);
		}
		var en = table();
		if (!Object.prototype.hasOwnProperty.call(en, key)) {
			warnMissing(key);
			return formatTemplate(germanDefault, params);
		}
		return formatTemplate(en[key], params);
	}

	var ATTR_TARGETS = [
		{ attr: "data-i18n", apply: function (el, v) { el.textContent = v; } },
		{ attr: "data-i18n-title", apply: function (el, v) { el.setAttribute("title", v); } },
		{ attr: "data-i18n-placeholder", apply: function (el, v) { el.setAttribute("placeholder", v); } },
		{ attr: "data-i18n-aria-label", apply: function (el, v) { el.setAttribute("aria-label", v); } },
		{ attr: "data-i18n-value", apply: function (el, v) { el.setAttribute("value", v); } },
	];

	// applyI18nOverlay(root=document): overwrite tagged nodes from the EN table. No-op under German.
	function applyI18nOverlay(root) {
		if (ACTIVE_LANG !== "en") {
			return;
		}
		var scope = root || document;
		var en = table();
		ATTR_TARGETS.forEach(function (target) {
			var nodes = scope.querySelectorAll("[" + target.attr + "]");
			Array.prototype.forEach.call(nodes, function (el) {
				var key = el.getAttribute(target.attr);
				if (!key) {
					return;
				}
				if (!Object.prototype.hasOwnProperty.call(en, key)) {
					warnMissing(key);
					return;
				}
				target.apply(el, en[key]);
			});
		});
	}

	window.tr = tr;
	window.applyI18nOverlay = applyI18nOverlay;
	window.avesmapsActiveLang = ACTIVE_LANG;

	if (ACTIVE_LANG === "en") {
		try {
			document.documentElement.lang = "en";
		} catch (error) {
			/* noop */
		}
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", function () {
				applyI18nOverlay(document);
			});
		} else {
			applyI18nOverlay(document);
		}
	}
})();
```

- [ ] **Step 3: Load both scripts in `index.html`** after `config.js`

Find (`index.html:1086`):

```html
		<script src="js/config.js"></script>
```

Replace with:

```html
		<script src="js/config.js"></script>
		<script src="js/app/i18n-en.js"></script>
		<script src="js/app/i18n.js"></script>
```

- [ ] **Step 4: Syntax-check both new files**

Run: `node --check js/app/i18n.js` and `node --check js/app/i18n-en.js`
Expected: no output (exit 0) for both.

- [ ] **Step 5: Commit**

```bash
git add js/app/i18n.js js/app/i18n-en.js index.html
git commit -m "feat(i18n): add ?lang=en overlay engine + English table (M8)"
```

- [ ] **Step 6: Deploy + smoke (after push)**

Agent (curl): `curl -s -o /dev/null -w "%{http_code}\n" "https://avesmaps.de/js/app/i18n.js"` → `200`; confirm `index.html` references `js/app/i18n.js?v=...` (stamped).
Human (browser): open `https://avesmaps.de/?lang=en` → `document.documentElement.lang === "en"`, `typeof window.tr === "function"`, no console errors. Open `https://avesmaps.de/` → `lang` stays `de`. (No visible text change yet — no elements tagged.)

---

## Task 2: Tag the static planner strings (`data-i18n`)

**Files:**
- Modify: `index.html` (8 in-scope planner elements around lines 936–1013)

Two of the targets are plain-text elements (tag directly); the rest are `<label>`s wrapping a control + a text node — for those, wrap ONLY the text in a `<span data-i18n="…">` so the control is not clobbered.

- [ ] **Step 1: Tag `#searchButton` (plain text)** — `index.html:936`

Find:
```html
			<button id="searchButton">Suche</button>
```
Replace:
```html
			<button id="searchButton" data-i18n="planner.search">Suche</button>
```

- [ ] **Step 2: Tag `#toggle-button` (plain text)** — `index.html:989`

Find:
```html
			<button id="toggle-button">Routenplaner</button>
```
Replace:
```html
			<button id="toggle-button" data-i18n="planner.toggle">Routenplaner</button>
```

- [ ] **Step 3: Wrap the two route-mode labels** — `index.html:991-998`

Find:
```html
				<label>
					<input type="radio" name="pathType" value="fastest" id="fastestPath" checked />
					Schnellste Route
				</label>
				<label>
					<input type="radio" name="pathType" value="shortest" id="shortestPath" />
					Kürzeste Route
				</label>
```
Replace:
```html
				<label>
					<input type="radio" name="pathType" value="fastest" id="fastestPath" checked />
					<span data-i18n="planner.route.fastest">Schnellste Route</span>
				</label>
				<label>
					<input type="radio" name="pathType" value="shortest" id="shortestPath" />
					<span data-i18n="planner.route.shortest">Kürzeste Route</span>
				</label>
```

- [ ] **Step 4: Wrap "Umsteigen minimieren"** — `index.html:1001-1004`

Find:
```html
				<label>
					<input type="checkbox" id="minimizeTransfers" />
					Umsteigen minimieren
				</label>
```
Replace:
```html
				<label>
					<input type="checkbox" id="minimizeTransfers" />
					<span data-i18n="planner.minimizeTransfers">Umsteigen minimieren</span>
				</label>
```

- [ ] **Step 5: Wrap "Rastzeiten" and "Stunden pro Tag"** — `index.html:1006-1012`

Find:
```html
				<label>
					<input type="checkbox" id="includeRests" checked />
					Rastzeiten
				</label>
				<input type="number" id="restHours" value="12" min="0.5" max="23.5" step="0.5" style="width: 40px" /> Stunden pro Tag
```
Replace:
```html
				<label>
					<input type="checkbox" id="includeRests" checked />
					<span data-i18n="planner.rests">Rastzeiten</span>
				</label>
				<input type="number" id="restHours" value="12" min="0.5" max="23.5" step="0.5" style="width: 40px" /> <span data-i18n="planner.restHoursSuffix">Stunden pro Tag</span>
```

- [ ] **Step 6: Tag `#overview` default (plain text)** — `index.html:1013`

Find:
```html
			<div id="overview">Wegpunkte und Dauer der Reise werden hier angezeigt.</div>
```
Replace:
```html
			<div id="overview" data-i18n="planner.overview.default">Wegpunkte und Dauer der Reise werden hier angezeigt.</div>
```

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat(i18n): tag static planner strings with data-i18n (M8)"
```

- [ ] **Step 8: Deploy + smoke (after push)**

Human (browser): `https://avesmaps.de/?lang=en` → the search button reads "Search", the planner toggle "Route planner", route modes "Fastest route"/"Shortest route", "Minimize transfers", "Rest periods", "hours per day", and the empty overview reads "Waypoints and travel time are shown here." `https://avesmaps.de/` → all of these still German. No console "missing English key" warnings.

---

## Task 3: Wrap the dynamic planner strings (`tr()`)

**Files:**
- Modify: `js/routing/route-engine.js:449`
- Modify: `js/map-features/map-features.js:62`
- Modify: `js/routing/route-view-model.js:9-21`
- Modify: `js/routing/route-plan.js:354-385`

`entry.type` (a `PATH_SUBTYPE_KEYS` value) and all place names stay verbatim — only UI words are wrapped.

- [ ] **Step 1: Wrap the "calculating" status** — `js/routing/route-engine.js:449`

Find:
```js
		$("#overview").text("Route wird berechnet...");
```
Replace:
```js
		$("#overview").text(tr("planner.overview.calculating", "Route wird berechnet..."));
```

- [ ] **Step 2: Wrap the overview reset default** — `js/map-features/map-features.js:62`

Find:
```js
	$("#overview").html(DEFAULT_OVERVIEW_TEXT);
```
Replace:
```js
	$("#overview").html(tr("planner.overview.default", DEFAULT_OVERVIEW_TEXT));
```

- [ ] **Step 3: Wrap the route-description connectors** — `js/routing/route-view-model.js:9-21`

Find:
```js
	const routeDescription = routeDescriptionSource
		.map((routeName, index) => {
			if (index === 0) {
				return `von <strong>${routeName}</strong>`;
			}

			if (index === routeDescriptionSource.length - 1) {
				return `nach <strong>${routeName}</strong>`;
			}

			return `&uuml;ber ${routeName}`;
		})
		.join(" ");
```
Replace:
```js
	const routeDescription = routeDescriptionSource
		.map((routeName, index) => {
			if (index === 0) {
				return `${tr("planner.journey.from", "von")} <strong>${routeName}</strong>`;
			}

			if (index === routeDescriptionSource.length - 1) {
				return `${tr("planner.journey.to", "nach")} <strong>${routeName}</strong>`;
			}

			return `${tr("planner.journey.via", "&uuml;ber")} ${routeName}`;
		})
		.join(" ");
```

- [ ] **Step 4: Wrap the per-leg label suffix** — `js/routing/route-plan.js:354-356`

Find:
```js
		const labelSuffix = entry.type === "Flussweg" && entry.segmentLabel
			? ` über <span class="route-plan-entry__label">${escapeHtml(entry.segmentLabel)}</span>`
			: "";
```
Replace:
```js
		const labelSuffix = entry.type === "Flussweg" && entry.segmentLabel
			? ` ${tr("planner.leg.via", "über")} <span class="route-plan-entry__label">${escapeHtml(entry.segmentLabel)}</span>`
			: "";
```

- [ ] **Step 5: Wrap the per-leg entry markup** — `js/routing/route-plan.js:358-366`

Find:
```js
		$overview.append(`
			<button type="button" class="route-plan-entry" data-route-entry-index="${entryIndex}">
			${assetIconMarkup(ROUTE_ICON_PATHS[entry.type] || ROUTE_ICON_PATHS["Weg"])} ${entry.type === SYNTHETIC_ROUTE_TYPE ? "Unwegsames Gelände" : entry.type}${labelSuffix}
			(${entry.distance.toFixed(2)} Meilen)
			von <strong>${formattedStartName}</strong>
			bis <strong>${formattedEndName}</strong>
			in ${entry.travelTime.toFixed(2)} Stunden
			</button>
		`);
```
Replace:
```js
		$overview.append(`
			<button type="button" class="route-plan-entry" data-route-entry-index="${entryIndex}">
			${assetIconMarkup(ROUTE_ICON_PATHS[entry.type] || ROUTE_ICON_PATHS["Weg"])} ${entry.type === SYNTHETIC_ROUTE_TYPE ? tr("planner.leg.offroad", "Unwegsames Gelände") : entry.type}${labelSuffix}
			(${entry.distance.toFixed(2)} ${tr("planner.unit.miles", "Meilen")})
			${tr("planner.leg.from", "von")} <strong>${formattedStartName}</strong>
			${tr("planner.leg.to", "bis")} <strong>${formattedEndName}</strong>
			${tr("planner.leg.in", "in")} ${entry.travelTime.toFixed(2)} ${tr("planner.unit.hours", "Stunden")}
			</button>
		`);
```

- [ ] **Step 6: Wrap the summary block** — `js/routing/route-plan.js:372-385`

Find:
```js
	$overview.prepend(`
		<button type="button" class="route-plan-entry route-plan-summary">
			Die Reise ${routeDesc}
		</button>
		<div class="route-plan-summary__time">
			Distanz: ${totalDistance.toFixed(1)} Meilen<br>
			Drachenflug: ${airDistance.toFixed(1)} Meilen<br>
			Reisezeit: ${totalTravelTime.toFixed(1)} Stunden (${(totalTravelTime / 24).toFixed(1)} Tage)<br>
			Rastzeit: ${totalRestTime.toFixed(1)} Stunden (${(totalRestTime / 24).toFixed(1)} Tage)
			<div style="margin-top: 0.5em"><strong>Gesamtzeit: ${totalHours.toFixed(1)} Stunden (${(totalHours / 24).toFixed(1)} Tage)</strong></div>
		</div>
		<button type="button" id="share-link-button" class="share-link-button">🔗 Link für diese Route kopieren</button>
		<hr>
	`);
```
Replace:
```js
	$overview.prepend(`
		<button type="button" class="route-plan-entry route-plan-summary">
			${tr("planner.journey.prefix", "Die Reise")} ${routeDesc}
		</button>
		<div class="route-plan-summary__time">
			${tr("planner.summary.distance", "Distanz")}: ${totalDistance.toFixed(1)} ${tr("planner.unit.miles", "Meilen")}<br>
			${tr("planner.summary.airDistance", "Drachenflug")}: ${airDistance.toFixed(1)} ${tr("planner.unit.miles", "Meilen")}<br>
			${tr("planner.summary.travelTime", "Reisezeit")}: ${totalTravelTime.toFixed(1)} ${tr("planner.unit.hours", "Stunden")} (${(totalTravelTime / 24).toFixed(1)} ${tr("planner.unit.days", "Tage")})<br>
			${tr("planner.summary.restTime", "Rastzeit")}: ${totalRestTime.toFixed(1)} ${tr("planner.unit.hours", "Stunden")} (${(totalRestTime / 24).toFixed(1)} ${tr("planner.unit.days", "Tage")})
			<div style="margin-top: 0.5em"><strong>${tr("planner.summary.totalTime", "Gesamtzeit")}: ${totalHours.toFixed(1)} ${tr("planner.unit.hours", "Stunden")} (${(totalHours / 24).toFixed(1)} ${tr("planner.unit.days", "Tage")})</strong></div>
		</div>
		<button type="button" id="share-link-button" class="share-link-button">🔗 ${tr("planner.shareRoute", "Link für diese Route kopieren")}</button>
		<hr>
	`);
```

- [ ] **Step 7: Syntax-check all four modified files**

Run:
```
node --check js/routing/route-engine.js
node --check js/map-features/map-features.js
node --check js/routing/route-view-model.js
node --check js/routing/route-plan.js
```
Expected: no output (exit 0) for each.

- [ ] **Step 8: Commit**

```bash
git add js/routing/route-engine.js js/map-features/map-features.js js/routing/route-view-model.js js/routing/route-plan.js
git commit -m "feat(i18n): translate dynamic route summary via tr() (M8)"
```

- [ ] **Step 9: Deploy + smoke (after push)**

Human (browser): on `https://avesmaps.de/?lang=en`, plan a route (e.g. Gareth → Tuzak) → the summary reads English ("The journey from Gareth to Tuzak", "Distance: … miles", "As the dragon flies: …", "Travel time: … hours (… days)", "Rest time …", "Total time …", per-leg "from … to … in … hours", "Copy link for this route"); place names and the path-type (`entry.type`, e.g. `Strasse`/`Flussweg`) stay German; the route still computes. On `https://avesmaps.de/` the summary is unchanged German. No "missing English key" warnings.

---

## Task 4: Exclude `lang` from generated share links

**Files:**
- Modify: `js/app/share-link.js:49`

- [ ] **Step 1: Add `lang` to the strip list** — `js/app/share-link.js:49`

Find:
```js
	["s", "edit", "debugMap", "serverrouting", "clientrouting"].forEach((key) => params.delete(key));
```
Replace:
```js
	["s", "edit", "debugMap", "serverrouting", "clientrouting", "lang"].forEach((key) => params.delete(key));
```

- [ ] **Step 2: Syntax-check**

Run: `node --check js/app/share-link.js`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add js/app/share-link.js
git commit -m "feat(i18n): drop lang from generated share links (M8)"
```

- [ ] **Step 4: Deploy + smoke (after push)**

Human (browser): on `https://avesmaps.de/?lang=en`, plan a route and create a share link → the resolved share URL does NOT contain `lang=en` (recipient gets their own default). German share flow unchanged.

---

## Task 5: Update the tracker

**Files:**
- Modify: `docs/refactoring-masterplan.md` (M8 row)

- [ ] **Step 1: Mark the v1 overlay done in the M8 row**

In the `| **M8** | Docs & i18n |` row, append after the existing i18n-overlay sentence:

```
✅ `?lang=en` overlay v1 shipped (planner core): engine `js/app/i18n.js` + table `js/app/i18n-en.js`, keyed `data-i18n` + `tr()`, German stays default, `lang` stripped from share links. Deferred to next extension: the transport section (heading/filter labels/selects/custom combobox) and the rest of the app surface.
```

- [ ] **Step 2: Commit**

```bash
git add docs/refactoring-masterplan.md
git commit -m "docs(i18n): mark ?lang=en overlay v1 done in tracker (M8)"
```

(Docs are not deploy-allowlisted; the push self-skips deploy.)

---

## Notes & non-obvious gotchas

- **German default must never break.** `tr()` and `applyI18nOverlay()` are no-ops under German and never throw; a missing key falls back to the German default. The only real risk is `js/app/i18n.js` failing to load (404) — caught by the Task 1 curl smoke. Load it early (after `config.js`) so `window.tr` exists before any consumer runs.
- **`route-planner-toggle.js:40-58`** has a legacy `MutationObserver` that rewrites the text `"Luftlinie"` → `"Drachenflug"`. Under `?lang=en` the summary already emits the English "As the dragon flies", which contains no "Luftlinie", so the observer is inert — leave it unchanged.
- **`NodeList.forEach`** is avoided in the engine in favor of `Array.prototype.forEach.call(...)` for broad compatibility.
- **No `ASSET_VERSION` bump** — these are `index.html`-loaded scripts (auto-`?v=`-stamped), not editor-dynamic assets.
- **EOL:** these files are new (write LF or CRLF consistently); the JS edits are single-line or contiguous-block replacements — match the surrounding file's existing indentation (tabs) exactly.
- **Deferred (next extension), explicitly:** transport heading "Transportmittel", Land/Fluss/Meer filter labels, the transport `<select>` `aria-label`s + `<option>` text + the custom combobox button/label/menu; then the broader app surface and the M8 part-2 server-message question (resolved client-side via `tr()` keyed on `error.code`, per the spec §10).
