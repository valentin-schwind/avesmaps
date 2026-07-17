# Kartensammlung-Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Kartensammlung wird ein Nachschlagewerk: einzeilige Katalogeinträge, die auf Klick animiert aufklappen, vier statt dreizehn Filter, und ein Editor, der den Linktext des Karten-Links setzen kann.

**Architecture:** Alles Leserseitige hängt an zwei reinen Markup-Buildern (`buildCityMapRowMarkup`, `citymapFiltersMarkup`) und einem reinen Prädikat (`avesmapsCitymapMatchesFilter`) — die sind unit-testbar und tragen die Änderung. Der Dialog verdrahtet nur. Die Animation ist reines CSS (Grid-Spalten + `grid-template-rows: 0fr→1fr`), kein JS-Timing. Backend: eine neue Spalte `map_url_label` über das vorhandene selbstheilende `$columnExists`-ALTER, und `avesmapsCitymapPublicThumbUrl()` verliert seinen `thumb_url`-Zweig.

**Tech Stack:** Vanilla JS ohne Build (globale Scripts + `module.exports`-Zwilling für Node-Tests), CSS mit Tokens aus `css/base/tokens.css`, PHP 8 strict + PDO, `node`-Assert-Tests ohne Runner.

**Spec:** `docs/superpowers/specs/2026-07-17-kartensammlung-redesign-design.md` — bei jedem Zweifel gilt sie, nicht dieser Plan.

## Global Constraints

- **Token-Zwang (AGENTS.md §12):** nie eine Farbe, Größe, ein Radius oder Trenner hartkodiert. Nur Tokens aus `css/base/tokens.css`. Fehlt einer, erst den Token anlegen.
- **Schriftgrößen** nur aus den sieben Stufen: `--font-size-caption` 11 · `--font-size-small` 12 · `--font-size-body` 13 · `--font-size-reading` 14 · `--font-size-subhead` 16 · `--font-size-title` 20 · `--font-size-display` 22. Zwei Gewichte: 400 / 700. Kein 12,5 px, kein 600.
- **Abstände** nur `--space-2 … --space-24` (2/4/6/8/10/12/16/20/24). Radien nur `--radius-sm` 5 / `--radius-md` 8 / `--radius-lg` 10.
- **Sprache (AGENTS.md §8):** UI-Strings Deutsch und **immer** durch `tr("key", "Deutscher Default")`. Code-Kommentare, Commit-Messages, API-`error.code` auf Englisch. Jeder neue/geänderte `tr`-Key braucht seinen Eintrag in `js/app/i18n-en.js`.
- **Tri-State (Spec §3.1):** `null` = unbekannt ≠ `false`. Unbekanntes wird **weggelassen**, nie als „unbekannt" gedruckt, und matcht keinen Filter. `false` ist **bekannt** und darf gedruckt werden.
- **Geteilter Arbeitsbaum (AGENTS.md §9):** **niemals** `git add -A` / `git add .` / `git commit -a`. Immer `git status` prüfen und nur eigene Dateien per Pfad stagen.
- **Tests laufen nackt:** `node js/map-features/__tests__/<x>.test.js` — kein `package.json`, kein Runner. PHP: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll <test>`. **Ohne `zend.assertions=1` ist `assert()` ein No-Op.**
- **Keine lokale DB.** Alles DB-Gebundene ist erst live prüfbar. Reine Funktionen sind das Einzige, was hier beweisbar ist — deshalb liegt die Logik in ihnen.

---

## File Structure

| Datei | Verantwortung nach dem Umbau |
|---|---|
| `js/map-features/map-features-place-extras.js` | Markup-Builder: `cityMapBandLabel` (neu), `cityMapRowSuffix` (neu), `cityMapRowFacts` (neu), `buildCityMapRowMarkup` (ersetzt), `citymapFiltersMarkup` (ersetzt), `advRowLinkMarkup` (+ Options-Parameter) |
| `js/map-features/map-features-citymaps.js` | Facetten + Prädikat: `avesmapsCitymapActiveFacets` (neu, ersetzt `avesmapsCitymapFacetOptions`), `avesmapsCitymapMatchesFilter` (ausgedünnt) |
| `js/map-features/map-features-citymaps-dialog.js` | Verdrahtung: `filterState`, `TOGGLES`, Sortierung, „Sammlung bearbeiten"-Handler |
| `css/features/place-extras.css` | Zeile als animiertes Grid, Filterleiste, Fußzeile |
| `js/app/i18n-en.js` | EN-Overlay der geänderten/neuen Keys |
| `html/citymap-editor.html` | „Linktext" rein, „Vorschau-Link (extern)" raus |
| `api/_internal/app/citymaps.php` | `map_url_label` (DDL/ALTER/Allowlist/Ausgabe/`avesmapsCitymapLinks`), `avesmapsCitymapPublicThumbUrl` stillgelegt |

**`avesmapsCitymapFacetOptions` wird ersetzt, nicht erweitert:** es liefert heute `types`/`arts`/`sources` — drei Dimensionen, die es nach der Spec nicht mehr gibt. Ein Rest davon wäre toter Code, den die nächste Session für gewollt hält.

---

### Task 1: Band-Ableitung + die neue Zeile

**Files:**
- Modify: `js/map-features/map-features-place-extras.js` (neue Helfer vor `buildCityMapRowMarkup`; `buildCityMapRowMarkup:381-469` ersetzen; `advRowLinkMarkup:559-572` um einen Parameter erweitern; `module.exports` ergänzen)
- Test: `js/map-features/__tests__/citymaps-render.test.js`

**Interfaces:**
- Consumes: `cityMapSafeUrl`, `cityMapBestLink`, `cityMapIsSpoiler`, `cityMapThumbMarkup`, `cityMapDataAttributes`, `cityMapValidityLabel`, `placeExtrasEscape`, `tr`, `avesmapsCitymapTypeLabel`, `avesmapsCitymapArtLabel` — alle vorhanden, unverändert.
- Produces:
  - `cityMapBandLabel(m) -> string` — der Bandname für die Titelzeile.
  - `cityMapRowSuffix(m) -> string` — `"Stadtplan · farbig"`, roh (ungeescaped).
  - `cityMapRowFacts(m) -> string[]` — die Fakten der aufgeklappten Zeile, roh.
  - `buildCityMapRowMarkup(m) -> string` — die Zeile.
  - `advRowLinkMarkup(link, opts)` — `opts.showStatus !== false` behält das heutige Verhalten.

- [ ] **Step 1: Write the failing test**

An `js/map-features/__tests__/citymaps-render.test.js` anhängen (vor dem abschließenden `console.log("citymaps-render ok")`). Den Import in Zeile 25–28 um die drei neuen Namen erweitern:

```js
const {
  cityMapSafeUrl, cityMapBestLink, cityMapIsSpoiler, cityMapValidityLabel,
  cityMapCardMarkup, buildCityMapsSectionMarkup, buildCityMapRowMarkup, citymapFiltersMarkup,
  cityMapBandLabel, cityMapRowSuffix, cityMapRowFacts,
} = require("../map-features-place-extras.js");
```

Testblock:

```js
// ---- Band-Ableitung ---------------------------------------------------------------------------------
// sources[0].label ist ein echtes Datenfeld (87% Abdeckung) und schlaegt die geratene Klammer.
assert.strictEqual(
  cityMapBandLabel({ title: "Stadtplan von Gareth (Herz des Reiches)", sources: [{ label: "Herz des Reiches" }] }),
  "Herz des Reiches");
// Ohne sources traegt die Klammer -- 86% der Titel sind "{Typ} von {Ort} ({Quelle})".
assert.strictEqual(cityMapBandLabel({ title: "Stadtplan von Gareth (Herz des Reiches)" }), "Herz des Reiches");
// VERSCHACHTELTE Klammern: eine naive /\(([^)]*)\)$/ liefert hier "DSA3" statt des Bandes.
assert.strictEqual(
  cityMapBandLabel({ title: "Umgebungskarte von Gareth (Abenteuer Basis-Spiel (DSA3))" }),
  "Abenteuer Basis-Spiel (DSA3)");
// Kein Formel-Titel -> der Titel selbst. Er ist der Name der Karte, nicht ihr Band.
assert.strictEqual(cityMapBandLabel({ title: "Gareth-Karte aus der Gareth-Box" }), "Gareth-Karte aus der Gareth-Box");
assert.strictEqual(cityMapBandLabel({ title: "Leere Klammer ()" }), "Leere Klammer ()", "leere Klammer faellt auf den Titel zurueck");
assert.strictEqual(cityMapBandLabel({}), "");

// ---- Suffix: Typ + Ausfuehrung ----------------------------------------------------------------------
assert.strictEqual(cityMapRowSuffix({ types: ["stadtplan"], is_color: true }), "Stadtplan · farbig");
// DAS ist der Grund fuer die ganze Uebung: 238 von 419 Karten haben is_color === false, und die Zeile
// druckte es nicht -- 21 Titelpaare sahen dadurch aus wie Dubletten.
assert.strictEqual(cityMapRowSuffix({ types: ["stadtplan"], is_color: false }), "Stadtplan · schwarzweiß");
// null bleibt unbekannt und faellt weg (Spec §3.1) -- false tut das NICHT.
assert.strictEqual(cityMapRowSuffix({ types: ["stadtplan"], is_color: null }), "Stadtplan");
assert.strictEqual(cityMapRowSuffix({ types: ["ortsplan", "stadtplan"], is_color: true }), "Ortsplan & Stadtplan · farbig");
assert.strictEqual(cityMapRowSuffix({}), "");

// ---- Fakten der aufgeklappten Zeile -----------------------------------------------------------------
assert.deepStrictEqual(
  cityMapRowFacts({ art: "derographisch", is_official: true, valid_to_bf: 1038, author: "Hannah Möllmann", width_px: 4635, height_px: 3278 }),
  ["Derographisch", "offiziell", "bis 1038 BF", "Hannah Möllmann", "4635 × 3278 px"]);
assert.deepStrictEqual(cityMapRowFacts({ is_official: false }), [], "ein bekanntes Nein ist hier keine Aussage, die der Leser braucht");
assert.deepStrictEqual(cityMapRowFacts({ note: "Format: A4 · Maßstab: 1:12.750.000" }), ["Format: A4 · Maßstab: 1:12.750.000"]);

// ---- die Zeile --------------------------------------------------------------------------------------
const newRow = buildCityMapRowMarkup({
  public_id: "m1", title: "Stadtplan von Gareth (Herz des Reiches)", types: ["stadtplan"], is_color: false,
  sources: [{ label: "Herz des Reiches" }], map_url: "https://example.org/k",
  links: [{ key: "map", label: "Karte", url: "https://example.org/k", state: "online", is_paid: null }],
});
assert.ok(newRow.includes("Herz des Reiches"), "der Band ist die Ueberschrift");
assert.ok(newRow.includes("schwarzweiß"), "die Ausfuehrung steht in der Titelzeile");
assert.ok(!newRow.includes("Stadtplan von Gareth (Herz des Reiches)"), "der Formel-Titel wird nicht mehr gedruckt");
assert.ok(!newRow.includes("citymap-row__linkshead"), "die Zeilen-Ueberschrift 'Zu finden bei' ist weg");
assert.ok(!newRow.includes("avesmaps-link-status"), "(online) ist Linkchecker-Status und gehoert nicht auf die Leserflaeche");
assert.ok(newRow.includes('data-public-id="m1"'), "das data-Attribut-Set bleibt -- der Filter liest es");
assert.ok(newRow.includes("avesmaps-citymaps__card"), "die geteilten Filter-/Spoiler-Handler zielen auf diese Klasse");

// Ohne Fundstelle sagt die Zeile das, statt zu schweigen.
assert.ok(buildCityMapRowMarkup({ public_id: "m2", title: "T" }).includes("keine Fundstelle"));
// Ohne jede Angabe traegt die aufgeklappte Zeile trotzdem eine Aussage.
assert.ok(buildCityMapRowMarkup({ public_id: "m3", title: "T" }).includes("Keine weiteren Angaben erfasst"));

// ---- advRowLinkMarkup: der Abenteuerdialog darf sich NICHT mitaendern -------------------------------
const advLink = { url: "https://example.org/a", label: "F-Shop", state: "online", is_paid: null };
assert.ok(advRowLinkMarkup(advLink).includes("avesmaps-link-status"), "Default unveraendert -- die Abenteuer behalten ihren Status-Marker");
assert.ok(!advRowLinkMarkup(advLink, { showStatus: false }).includes("avesmaps-link-status"));

console.log("citymap row ok");
```

`advRowLinkMarkup` zusätzlich in die `require`-Destrukturierung aufnehmen und `global.avesmapsLinkStatusMarkup` ist bereits oben in der Datei gesetzt — nichts weiter zu tun.

- [ ] **Step 2: Run test to verify it fails**

Run: `node js/map-features/__tests__/citymaps-render.test.js`
Expected: FAIL — `TypeError: cityMapBandLabel is not a function`

- [ ] **Step 3: Write minimal implementation**

In `js/map-features/map-features-place-extras.js` **vor** `buildCityMapRowMarkup` einfügen:

```js
// Der Bandname ist die Identitaet eines Katalogeintrags: 86% der Titel sind die Formel
// "{Typ} von {Ort} ({Quelle})", und in einem Dialog namens "Kartensammlung von Gareth" ist alles daran
// redundant AUSSER der Klammer. sources[0].label kommt zuerst, weil es ein strukturiertes Feld mit 87%
// Abdeckung ist -- die Klammer ist geraten und nur der Rueckfall.
function cityMapBandLabel(m) {
	var sources = (m && m.sources) || [];
	for (var i = 0; i < sources.length; i++) {
		if (sources[i] && sources[i].label) {
			return String(sources[i].label);
		}
	}
	var title = String((m && m.title) || "").trim();
	if (title.charAt(title.length - 1) !== ")") {
		return title;
	}
	// Rueckwaerts bis zur BALANCIERENDEN Klammer, nicht bis zur ersten: "Umgebungskarte von Gareth
	// (Abenteuer Basis-Spiel (DSA3))" ist echt, und /\(([^)]*)\)$/ liefert dort "DSA3".
	var depth = 0;
	for (var j = title.length - 1; j >= 0; j--) {
		var ch = title.charAt(j);
		if (ch === ")") {
			depth++;
		} else if (ch === "(") {
			depth--;
			if (depth === 0) {
				return title.slice(j + 1, title.length - 1).trim() || title;
			}
		}
	}
	return title;
}

// Die muted Fortsetzung der Titelzeile. Typ und Ausfuehrung stehen hier, weil der Owner die Typ-GRUPPEN
// und die Ausfuehrungs-SPALTE gestrichen hat -- ohne beides hiessen vier der neun Gareth-Zeilen wortgleich
// "Herz des Reiches". Als Spalte weg, als Information da.
function cityMapRowSuffix(m) {
	var parts = [];
	if (m && m.types && m.types.length && typeof avesmapsCitymapTypeLabel === "function") {
		parts.push(m.types.map(avesmapsCitymapTypeLabel).join(" & "));
	}
	// is_color === false ist BEKANNT, nicht unbekannt -- es zu drucken ist die Anwendung von §3.1, nicht
	// ihr Bruch (dieselbe Begruendung wie bei "kostenlos"). Nur null faellt weg.
	if (m && m.is_color === true) {
		parts.push(tr("cityMaps.trait.color", "farbig"));
	} else if (m && m.is_color === false) {
		parts.push(tr("cityMaps.trait.greyscale", "schwarzweiß"));
	}
	return parts.join(" · ");
}

// Die Fakten der AUFGEKLAPPTEN Zeile. Kein Feld kommt neu dazu; sie bekommen nur Platz. Nur explizit
// bejahte Merkmale -- ein "nicht offiziell" hat niemand behauptet.
function cityMapRowFacts(m) {
	var parts = [];
	if (!m) {
		return parts;
	}
	if (m.art && typeof avesmapsCitymapArtLabel === "function") { parts.push(avesmapsCitymapArtLabel(m.art)); }
	if (m.is_official === true) { parts.push(tr("cityMaps.trait.official", "offiziell")); }
	if (m.is_labeled === true) { parts.push(tr("cityMaps.trait.labeled", "beschriftet")); }
	if (m.is_multilevel === true) { parts.push(tr("cityMaps.trait.multilevel", "mehrstöckig")); }
	var validity = cityMapValidityLabel(m);
	if (validity) { parts.push(validity); }
	if (m.author) { parts.push(String(m.author)); }
	if (m.width_px && m.height_px) { parts.push(m.width_px + " × " + m.height_px + " px"); }
	// note ist halbstrukturierter Sync-Output ("Format: A4 · Maßstab: 1:12.750.000") und traegt genau die
	// Fragen, die ein Nachschlagewerk beantworten soll. Eigene Spalten waeren richtig -- das ist ein
	// Datenprojekt, kein Design (Spec §6).
	if (m.note) { parts.push(String(m.note)); }
	return parts;
}
```

`buildCityMapRowMarkup` (Zeilen 381–469) **komplett** ersetzen:

```js
// Eine Karten-ZEILE im Dialog: zugeklappt einzeilig, per Klick animiert aufgeklappt (CSS, siehe
// place-extras.css). Grid 56px | minmax(0,1fr) | 148px.
//
// Traegt bewusst AUCH .avesmaps-citymaps__card: Filter und Spoiler-Reveal sind geteilte Handler, die auf
// diese Klasse zielen. Die abweichende Optik haengt an .avesmaps-citymap-row.
function buildCityMapRowMarkup(m) {
	var href = cityMapBestLink(m);
	var spoiler = cityMapIsSpoiler(m);
	var spoilerOverlay = spoiler
		? '<span class="avesmaps-citymaps__spoiler" data-citymap-reveal>' + placeExtrasEscape(tr("cityMaps.spoilerReveal", "Spoiler — aufdecken")) + '</span>'
		: "";
	var openAttrs = href
		? ' href="' + placeExtrasEscape(href) + '" target="_blank" rel="noopener"'
		: ' href="#" onclick="return false" aria-disabled="true"';

	var suffix = cityMapRowSuffix(m);
	var facts = cityMapRowFacts(m);
	var factsMarkup = '<div class="avesmaps-citymap-row__facts">'
		+ (facts.length ? placeExtrasEscape(facts.join(" · ")) : placeExtrasEscape(tr("cityMaps.noFacts", "Keine weiteren Angaben erfasst.")))
		+ '</div>';

	// KEIN Status-Marker: (online) ist Linkchecker-Info, also Redakteurswissen auf einer Leserflaeche.
	// Der Abenteuerdialog teilt sich advRowLinkMarkup und behaelt seinen Marker (Default).
	var linksMarkup = (m.links && m.links.length)
		? '<ul class="avesmaps-adv-row__links">' + m.links.map(function (link) {
			return advRowLinkMarkup(link, { showStatus: false });
		}).join("") + '</ul>'
		: '<span class="avesmaps-citymap-row__nolink">' + placeExtrasEscape(tr("cityMaps.noLink", "keine Fundstelle")) + '</span>';

	// "+ Neuer Fundort" traegt seine Karte selbst: der Melde-Dialog ist EINE wiederverwendete Huelle, eine
	// gemerkte Referenz waere beim zweiten Melden falsch. Sichtbar nur in der offenen Zeile (CSS).
	var addLink = m.public_id
		? '<button type="button" class="avesmaps-citymap-row__addlink"'
			+ ' data-citymap-id="' + placeExtrasEscape(m.public_id) + '"'
			+ ' data-citymap-title="' + placeExtrasEscape(m.title || "") + '">'
			+ placeExtrasEscape(tr("cityMaps.addFundort", "+ Neuer Fundort")) + '</button>'
		: "";

	return '<div class="avesmaps-citymaps__card avesmaps-citymap-row' + (spoiler ? " is-spoiler" : "") + '"' + cityMapDataAttributes(m) + '>'
		+ '<a class="avesmaps-citymap-row__thumb' + (cityMapSafeUrl(m.thumb) ? " has-img" : "") + '"' + openAttrs + ' title="' + placeExtrasEscape(m.title) + '">'
		+ cityMapThumbMarkup(m) + spoilerOverlay + '</a>'
		+ '<div class="avesmaps-citymap-row__main">'
		+ '<div class="avesmaps-citymap-row__band">' + placeExtrasEscape(cityMapBandLabel(m))
		+ (suffix ? ' <span class="avesmaps-citymap-row__suffix">· ' + placeExtrasEscape(suffix) + '</span>' : "")
		+ '</div>'
		+ '<div class="avesmaps-citymap-row__detail"><div class="avesmaps-citymap-row__detail-inner">'
		+ factsMarkup + addLink
		+ '</div></div>'
		+ '</div>'
		+ '<div class="avesmaps-citymap-row__side">' + linksMarkup + '</div>'
		+ '</div>';
}
```

`advRowLinkMarkup` (Zeile 559) um den Parameter erweitern — **Default unverändert**, damit der Abenteuerdialog exakt bleibt:

```js
// opts.showStatus === false laesst den Linkchecker-Marker weg. Die Kartensammlung nutzt das: (online) ist
// Redakteursinfo. Der Default bleibt an -- die beiden Abenteuerdialoge teilen sich diese Funktion, und ein
// stiller Wegfall dort waere eine Aenderung, die niemand bestellt hat.
function advRowLinkMarkup(link, opts) {
	var deadClass = (typeof avesmapsLinkStatusLinkClass === "function") ? avesmapsLinkStatusLinkClass(link.state) : "";
	var showStatus = !opts || opts.showStatus !== false;
	var marker = (showStatus && typeof avesmapsLinkStatusMarkup === "function") ? avesmapsLinkStatusMarkup(link.state) : "";
	var paid = link.is_paid === true
		? '<span class="avesmaps-adv-row__linkpaid">' + placeExtrasEscape(tr("cityMaps.link.paid", "(kostenpflichtig)")) + '</span>'
		: "";
	return '<li class="avesmaps-adv-row__linkitem">'
		+ '<a class="avesmaps-adv-row__link' + deadClass + '" href="' + placeExtrasEscape(link.url) + '"'
		+ ' target="_blank" rel="noopener" title="' + placeExtrasEscape(link.url) + '">'
		+ placeExtrasEscape(link.label) + ' ↗</a>'
		+ paid
		+ marker
		+ '</li>';
}
```

Im `module.exports` am Dateiende ergänzen: `cityMapBandLabel`, `cityMapRowSuffix`, `cityMapRowFacts`, `advRowLinkMarkup`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node js/map-features/__tests__/citymaps-render.test.js`
Expected: PASS — endet mit `citymap row ok` und `citymaps-render ok`

Die **alten** Zeilen-Assertions (Datei-Zeilen ~165–265) prüfen das abgelöste Markup (`citymap-row__linkshead`, `citymap-row__meta`, `citymap-row__traits`, `citymap-row__source`). Sie schlagen jetzt fehl — das ist richtig, sie beschreiben die alte Zeile. Löschen, nicht anpassen: die neuen Assertions oben decken dieselben Fragen ab.

- [ ] **Step 5: Commit**

```bash
git status --short
git add js/map-features/map-features-place-extras.js js/map-features/__tests__/citymaps-render.test.js
git commit --only js/map-features/map-features-place-extras.js js/map-features/__tests__/citymaps-render.test.js -F - <<'EOF'
feat(citymaps): rebuild the dialog row as a single-line catalogue entry

The row was built around a 96x68 preview that 418 of 419 maps do not have, and
it printed the "{Typ} von {Ort} ({Quelle})" title in full while repeating the
type and the source underneath -- inside a dialog already titled "Kartensammlung
von Gareth". It now leads with the band (sources[0].label, falling back to the
title's balancing parenthesis) and carries type plus finish as a muted suffix.

is_color === false now prints as "schwarzweiss". That is what §3.1 asks for --
false is KNOWN, only null is unknown -- and it is why 21 title pairs that differ
in nothing else read as duplicates today.

advRowLinkMarkup gains an opts.showStatus switch instead of losing the marker
outright: the two adventure dialogs share it and did not ask to change.
EOF
```

---

### Task 2: Filterleiste — von dreizehn auf vier

**Files:**
- Modify: `js/map-features/map-features-citymaps.js` (`avesmapsCitymapFacetOptions:205-250` → `avesmapsCitymapActiveFacets`; `avesmapsCitymapMatchesFilter:302-360` ausdünnen; beide Export-Blöcke)
- Modify: `js/map-features/map-features-place-extras.js` (`citymapFiltersMarkup:321-355`)
- Test: `js/map-features/__tests__/citymaps-index.test.js` (Facetten + Prädikat), `js/map-features/__tests__/citymaps-render.test.js` (Leiste)

**Interfaces:**
- Consumes: `avesmapsCitymapHasFreeAccess(shape) -> bool` (vorhanden, unverändert), `avesmapsFilterBarMarkup(groups) -> string`.
- Produces: `avesmapsCitymapActiveFacets(shapes) -> { color: bool, official: bool, free: bool, years: bool, yearRange: {min, max} }` und `citymapFiltersMarkup(facets) -> string` (**`""`**, wenn keine Facette trennt).

- [ ] **Step 1: Write the failing test**

An `js/map-features/__tests__/citymaps-index.test.js` anhängen (Import um `avesmapsCitymapActiveFacets` erweitern):

```js
// ---- adaptive Facetten ------------------------------------------------------------------------------
// Die Regel: ein Filter erscheint nur, wenn er DIESE Liste wirklich teilt -- mindestens eine Karte passt
// UND mindestens eine nicht. So kann es tote Chips wie "mehrstoeckig" (0 von 419 erfasst) nie wieder geben.
const gareth = [
  { is_color: true, is_official: true, valid_to_bf: 1038, links: [{ is_paid: true }, { is_paid: false }] },
  { is_color: true, is_official: null, links: [] },
  { is_color: false, is_official: null, links: [] },
  { is_color: null, is_official: null, links: [{ is_paid: null }] },
];
const f = avesmapsCitymapActiveFacets(gareth);
assert.strictEqual(f.color, true, "2 farbig, 2 nicht -> teilt");
assert.strictEqual(f.official, true, "1 offiziell, 3 nicht -> teilt");
assert.strictEqual(f.free, true, "1 hat einen belegt freien Weg, 3 nicht -> teilt");
assert.strictEqual(f.years, false, "nur EINE Karte traegt ein Jahr -> es gibt nichts zu filtern");

// Alle gleich -> der Filter kann nichts ausrichten und erscheint nicht.
assert.strictEqual(avesmapsCitymapActiveFacets([{ is_color: true }, { is_color: true }]).color, false);
// 168 von 245 Orten haben genau EINE Karte. Dort steht keine Leiste.
const solo = avesmapsCitymapActiveFacets([{ is_color: true, is_official: true, links: [{ is_paid: false }] }]);
assert.strictEqual(solo.color, false);
assert.strictEqual(solo.official, false);
assert.strictEqual(solo.free, false);
assert.strictEqual(solo.years, false);

// Zeitraum: zwei Karten MIT Jahr und die Jahre unterscheiden sich.
assert.strictEqual(avesmapsCitymapActiveFacets([{ valid_to_bf: 1027 }, { valid_to_bf: 1038 }]).years, true);
assert.strictEqual(avesmapsCitymapActiveFacets([{ valid_to_bf: 1038 }, { valid_to_bf: 1038 }]).years, false, "gleiche Jahre trennen nicht");
// EINE Karte mit einer Spanne ergibt zwar zwei Jahreszahlen, aber nichts zu filtern.
assert.strictEqual(avesmapsCitymapActiveFacets([{ valid_from_bf: 1020, valid_to_bf: 1038 }]).years, false);
// 9999 ist das offene Ende (AGENTS.md §5) und keine Jahreszahl.
assert.deepStrictEqual(avesmapsCitymapActiveFacets([{ valid_from_bf: 1027, valid_to_bf: 9999 }, { valid_to_bf: 1038 }]).yearRange, { min: 1027, max: 1038 });

// ---- Praedikat: die gestrichenen Dimensionen sind wirkungslos ---------------------------------------
const shape = { types: ["stadtplan"], art: "politisch", is_color: true, is_multilevel: true, is_spoiler: true, sources: [{ label: "X" }], links: [] };
assert.strictEqual(avesmapsCitymapMatchesFilter(shape, { multilevelOnly: true }), true, "mehrstoeckig ist kein Filter mehr");
assert.strictEqual(avesmapsCitymapMatchesFilter(shape, { labeledOnly: true }), true, "beschriftet ist kein Filter mehr");
assert.strictEqual(avesmapsCitymapMatchesFilter(shape, { paidOnly: true }), true, "nur kostenpflichtige ist gestrichen");
assert.strictEqual(avesmapsCitymapMatchesFilter(shape, { art: "anderes" }), true, "Art ist kein Filter mehr");
assert.strictEqual(avesmapsCitymapMatchesFilter(shape, { source: "anderes" }), true, "Quelle ist kein Filter mehr");
// Der Spoiler-CHIP ist weg, der DECKEL bleibt (er sitzt im Markup). Eine Spoilerkarte wird gelistet.
assert.strictEqual(avesmapsCitymapMatchesFilter(shape, {}), true);
// Die vier, die bleiben, wirken.
assert.strictEqual(avesmapsCitymapMatchesFilter({ is_color: true }, { colorOnly: true }), true);
assert.strictEqual(avesmapsCitymapMatchesFilter({ is_color: false }, { colorOnly: true }), false);
assert.strictEqual(avesmapsCitymapMatchesFilter({ is_color: null }, { colorOnly: true }), false, "unbekannt matcht keinen Filter (§3.7)");
assert.strictEqual(avesmapsCitymapMatchesFilter({ is_official: true }, { officialOnly: true }), true);
assert.strictEqual(avesmapsCitymapMatchesFilter({ links: [{ is_paid: false }] }, { freeOnly: true }), true);

console.log("citymap adaptive facets ok");
```

An `citymaps-render.test.js` anhängen:

```js
// ---- Filterleiste -----------------------------------------------------------------------------------
const barAll = citymapFiltersMarkup({ color: true, official: true, free: true, years: true, yearRange: { min: 1027, max: 1038 } });
assert.ok(barAll.includes('data-adv-filter="color"') && barAll.includes('data-adv-filter="official"'));
assert.ok(barAll.includes('data-adv-filter="free"') && barAll.includes('data-adv-filter="yearFrom"'));
// Die zehn gestrichenen duerfen nirgends mehr auftauchen.
["type", "art", "source", "multilevel", "labeled", "paid", "spoiler"].forEach((kind) => {
  assert.ok(!barAll.includes('data-adv-filter="' + kind + '"'), kind + " ist gestrichen");
});
// Nur was traegt: eine Facette -> ein Chip.
const barOne = citymapFiltersMarkup({ color: true, official: false, free: false, years: false });
assert.ok(barOne.includes('data-adv-filter="color"') && !barOne.includes('data-adv-filter="official"'));
// Nichts trennt -> GAR KEINE Leiste. Das ist der Normalfall (69% der Orte haben eine Karte).
assert.strictEqual(citymapFiltersMarkup({ color: false, official: false, free: false, years: false }), "");
assert.strictEqual(citymapFiltersMarkup({}), "");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node js/map-features/__tests__/citymaps-index.test.js`
Expected: FAIL — `TypeError: avesmapsCitymapActiveFacets is not a function`

- [ ] **Step 3: Write minimal implementation**

In `js/map-features/map-features-citymaps.js` `avesmapsCitymapFacetOptions` (205–250) **ersetzen**:

```js
// ---- adaptive Facetten (Spec §4.1) ------------------------------------------------------------------
// Vokabular: Zeitraum, farbig, offiziell, kostenlos (Owner 2026-07-17). Typ, Art, Quelle, mehrstoeckig,
// beschriftet, "nur kostenpflichtige" und "Spoiler zeigen" sind ERSATZLOS gestrichen -- siehe die
// Umkehrungs-Warnung in der Spec §4.1, bevor jemand sie zurueckbaut.
//
// Die Regel: ein Filter erscheint nur, wenn er DIESE Liste wirklich teilt. Sonst stehen 13 Steuerelemente
// ueber einer Zeile (168 von 245 Orten haben genau eine Karte) und zwei davon -- mehrstoeckig, Spoiler --
// koennen nie etwas treffen, weil die Daten sie gar nicht kennen.
function avesmapsCitymapActiveFacets(shapes) {
	var list = shapes || [];
	function splits(pred) {
		var hit = 0;
		for (var i = 0; i < list.length; i++) {
			if (pred(list[i])) { hit++; }
		}
		return hit > 0 && hit < list.length;
	}
	var years = {};
	var withYear = 0;
	list.forEach(function (shape) {
		var has = false;
		[shape.valid_from_bf, shape.valid_to_bf].forEach(function (value) {
			var year = Number(value) || 0;
			// 9999 ist das offene Ende (AGENTS.md §5) -- ein echter Wert in den Daten, aber keine
			// Jahreszahl, die man einem Leser als Bereichsgrenze zeigt.
			if (year > 0 && year !== 9999) {
				years[year] = true;
				has = true;
			}
		});
		if (has) { withYear++; }
	});
	var keys = Object.keys(years).map(Number);
	return {
		color: splits(function (s) { return s.is_color === true; }),
		official: splits(function (s) { return s.is_official === true; }),
		free: splits(avesmapsCitymapHasFreeAccess),
		// Zwei Karten MIT Jahr und unterschiedliche Jahre. Eine Karte mit einer Spanne liefert zwar zwei
		// Zahlen, aber nichts zu filtern.
		years: withYear >= 2 && keys.length >= 2,
		yearRange: keys.length ? { min: Math.min.apply(null, keys), max: Math.max.apply(null, keys) } : { min: 0, max: 0 },
	};
}
```

In `avesmapsCitymapMatchesFilter` die Blöcke für `types`, `art`, `source`, `multilevelOnly`, `labeledOnly`, `paidOnly` und `showSpoiler` **löschen**. Es bleiben `colorOnly`, `officialOnly`, `freeOnly` und der Jahresbereich. Die Funktion beginnt danach so:

```js
function avesmapsCitymapMatchesFilter(shape, filter) {
	if (!filter || !shape) {
		return true;
	}
	// §3.7: "Unbekannte Werte matchen keinen Filter ausser 'alle'." Jeder Check verlangt ein explizites
	// true -- null (unbekannt) faellt durch, und genau dafuer sind die Felder dreiwertig.
	if (filter.colorOnly && shape.is_color !== true) {
		return false;
	}
	if (filter.officialOnly && shape.is_official !== true) {
		return false;
	}
	// Fragt die LINKS, nicht die Karte: derselbe Band ist im F-Shop bezahlt und auf seiner Wiki-Seite
	// frei. "Gibt es einen freien Weg zu dieser Karte?"
	if (filter.freeOnly && !avesmapsCitymapHasFreeAccess(shape)) {
		return false;
	}
	// ... der bestehende Jahresbereich-Block bleibt unveraendert
```

`avesmapsCitymapIsPaidOnly` **bleibt** (kein toter Code: es ist exportiert und der Linkchecker/Editor darf es weiter fragen), verliert aber seinen Aufrufer im Prädikat.

In **beiden** Export-Blöcken (`module.exports` ~556 und `window.*` ~568) `avesmapsCitymapFacetOptions` durch `avesmapsCitymapActiveFacets` ersetzen.

In `js/map-features/map-features-place-extras.js` `citymapFiltersMarkup` (321–355) **ersetzen**:

```js
// Dieselbe Grammatik wie die Abenteuerleiste (avesmapsFilterBarMarkup), eigene Gruppenliste. Ein Filter
// steht nur da, wenn avesmapsCitymapActiveFacets ihn fuer trennend haelt -- traegt nichts, kommt "" zurueck
// und der Dialog hat gar keine Leiste.
function citymapFiltersMarkup(facets) {
	facets = facets || {};
	var groups = [];
	if (facets.years) {
		groups.push({
			kind: "years", from: "yearFrom", to: "yearTo",
			label: tr("cityMaps.filter.period", "Zeitraum (BF)"),
			range: facets.yearRange || { min: 0, max: 0 },
			fromPlaceholder: tr("cityMaps.filter.from", "von"),
			toPlaceholder: tr("cityMaps.filter.to", "bis"),
		});
	}
	if (facets.color) { groups.push({ kind: "toggle", filter: "color", label: tr("cityMaps.filter.color", "farbig") }); }
	if (facets.official) { groups.push({ kind: "toggle", filter: "official", label: tr("cityMaps.filter.officialOnly", "offiziell") }); }
	if (facets.free) { groups.push({ kind: "toggle", filter: "free", label: tr("cityMaps.filter.freeOnly", "kostenlos") }); }
	if (!groups.length) {
		return "";
	}
	return avesmapsFilterBarMarkup([{ kind: "label", text: tr("cityMaps.filter.label", "Filter") }].concat(groups));
}
```

Der Test-Header von `citymaps-render.test.js` installiert `avesmapsCitymapTypeLabel`/`ArtLabel` als Globals — der Import aus `map-features-citymaps.js` bleibt, beide Funktionen leben weiter.

- [ ] **Step 4: Run test to verify it passes**

Run: `node js/map-features/__tests__/citymaps-index.test.js && node js/map-features/__tests__/citymaps-render.test.js`
Expected: PASS beide. Alte Assertions zu `types`/`arts`/`sources`-Facetten in `citymaps-index.test.js` löschen — die Dimensionen gibt es nicht mehr.

- [ ] **Step 5: Commit**

```bash
git status --short
git add js/map-features/map-features-citymaps.js js/map-features/map-features-place-extras.js js/map-features/__tests__/citymaps-index.test.js js/map-features/__tests__/citymaps-render.test.js
git commit --only js/map-features/map-features-citymaps.js js/map-features/map-features-place-extras.js js/map-features/__tests__/citymaps-index.test.js js/map-features/__tests__/citymaps-render.test.js -F - <<'EOF'
feat(citymaps): cut the filter bar from thirteen controls to four, adaptively

Measured against the live catalogue: six of the thirteen filters matched two
maps or fewer, and two of them -- "mehrstoeckig" (0 of 419 recorded) and
"Spoiler zeigen" (0 spoiler maps) -- could never match anything at all. Gareth
with nine maps is the second-largest collection in the database; 168 of 245
places have exactly one, so the bar routinely stood over a single row.

The vocabulary is now Zeitraum, farbig, offiziell, kostenlos (owner), and a
facet renders only when it actually splits the current list -- at most one map
matching and one not. A place with one map gets no bar at all, and a dead chip
cannot come back by accident.

Two reversals recorded in the spec so a later session does not undo them: the
"nur kostenpflichtige" filter and the "Spoiler zeigen" chip go. The spoiler LID
stays -- that was always the protection, the chip only governed listing.
EOF
```

---

### Task 3: Dialog-Verdrahtung + Sortierung

**Files:**
- Modify: `js/map-features/map-features-citymaps-dialog.js` (`buildControls:124-211`, `openDialogForSection:215-263`)

**Interfaces:**
- Consumes: `avesmapsCitymapActiveFacets` (Task 2), `citymapFiltersMarkup` (Task 2), `buildCityMapRowMarkup` (Task 1), `avesmapsCitymapTypeLabel`.
- Produces: nichts für spätere Tasks.

**Kein Unit-Test:** die Datei ist eine IIFE ohne Exports und hängt an `document`/`$`. Sie ist bewusst reine Verdrahtung; alles Prüfbare liegt in Task 1 und 2. Abnahme läuft über den Browser (Task 7).

- [ ] **Step 1: `filterState` und `TOGGLES` ausdünnen**

In `buildControls` (Zeile ~134) ersetzen:

```js
		var facets = (typeof avesmapsCitymapActiveFacets === "function")
			? avesmapsCitymapActiveFacets(shapes)
			: { color: false, official: false, free: false, years: false, yearRange: { min: 0, max: 0 } };
		existing.innerHTML = (typeof citymapFiltersMarkup === "function") ? citymapFiltersMarkup(facets) : "";

		var filterState = {
			colorOnly: false, officialOnly: false, freeOnly: false,
			yearFrom: 0, yearTo: 0,
		};
```

Den `spoilerChip`-Block (Zeilen ~140–143) **löschen** — der Chip existiert nicht mehr.

`TOGGLES` (Zeile ~169) ersetzen:

```js
		var TOGGLES = { color: "colorOnly", official: "officialOnly", free: "freeOnly" };
```

Im Klick-Handler die `type`- und `spoiler`-Zweige löschen; es bleibt:

```js
		existing.addEventListener("click", function (e) {
			var chip = e.target.closest("[data-adv-filter]");
			// Der Chip-Guard ist noetig, weil [data-adv-filter] AUCH die Jahresfelder traegt.
			if (!chip || !chip.classList.contains("avesmaps-adv-tree__chip")) {
				return;
			}
			var kind = chip.getAttribute("data-adv-filter");
			if (!TOGGLES[kind]) {
				return;
			}
			filterState[TOGGLES[kind]] = !filterState[TOGGLES[kind]];
			chip.classList.toggle("is-active", filterState[TOGGLES[kind]]);
			applyFilters();
		});
```

Den `change`-Listener (`art`/`source`, Zeilen ~196–201) **komplett löschen** — beide Selects gibt es nicht mehr. Der `input`-Listener für die Jahre bleibt.

- [ ] **Step 2: Sortierung in `openDialogForSection`**

Nach `var shapes = shapesFromSection(section);` (Zeile ~228) einfügen:

```js
	// Nach Typ, dann nach Band. Ohne Gruppenueberschriften (Owner), aber die Reihenfolge haelt die
	// Farbe/Schwarzweiss-Paare nebeneinander -- so lesen sie sich als Paar statt als Dublette.
	shapes.sort(function (a, b) {
		var typeA = ((a.types || [])[0] || "");
		var typeB = ((b.types || [])[0] || "");
		if (typeA !== typeB) {
			return typeA.localeCompare(typeB, "de");
		}
		var bandA = (typeof cityMapBandLabel === "function") ? cityMapBandLabel(a) : (a.title || "");
		var bandB = (typeof cityMapBandLabel === "function") ? cityMapBandLabel(b) : (b.title || "");
		return bandA.localeCompare(bandB, "de");
	});
```

- [ ] **Step 3: Aufklapp-Handler an die neue Zeile anpassen**

Der Handler (Zeile ~337) prüft `.avesmaps-citymap-row__thumb` und `.avesmaps-adv-row__links`. Beide Klassen bleiben, der Handler bleibt **unverändert** — inklusive der `document`-Delegation (die Zeilen entstehen bei jedem Dialog-Bau neu, und der Spoiler-Deckel braucht seinen `stopPropagation`-Vorrang).

Prüfen: `.avesmaps-citymap-row__addlink` liegt jetzt im `__detail`-Wrapper. Der bestehende `[data-citymap-id]`-Handler in `map-features-citymaps-suggest.js` delegiert auf `document` und greift unverändert.

- [ ] **Step 4: Im Browser prüfen**

```
http://localhost/?siedlung=Gareth
```
Kartensammlung öffnen. Erwartet: drei Chips (farbig, offiziell, kostenlos), **kein** Zeitraum, neun einzeilige Einträge, Stadtpläne vor Umgebungskarten, die „Herz des Reiches"-Paare nebeneinander. Klick auf eine Zeile klappt sie auf, ein Klick auf die nächste schließt die vorige.

Ist kein lokaler Server verfügbar: nach dem Deploy auf `https://avesmaps.de/?siedlung=Gareth` prüfen (~1–2 min Verzögerung, Remote-SHA vorher verifizieren).

- [ ] **Step 5: Commit**

```bash
git status --short
git add js/map-features/map-features-citymaps-dialog.js
git commit --only js/map-features/map-features-citymaps-dialog.js -F - <<'EOF'
feat(citymaps): wire the dialog to the four-filter bar and sort by type, then band

Drops the type/art/source/spoiler handling that no longer has controls, and
sorts the list so the colour/greyscale pairs land next to each other -- the
owner cut the type headings, and adjacency is what makes the pairs read as a
pair rather than as a duplicate.

The expand handler and its document delegation are untouched: the rows are
rebuilt on every open, and the spoiler lid must keep its stopPropagation
precedence or the same click that expands a row uncovers a spoiler.
EOF
```

---

### Task 4: CSS — die Zeile als animiertes Grid

**Files:**
- Modify: `css/features/place-extras.css` (`.avesmaps-citymap-row`-Block ab Zeile 852 bis `.avesmaps-citymap-row__side` bei ~984)

**Interfaces:**
- Consumes: die Klassen aus Task 1 (`__band`, `__suffix`, `__detail`, `__detail-inner`, `__facts`, `__nolink`, `__thumb`, `__main`, `__side`, `__addlink`).
- Produces: nichts.

- [ ] **Step 1: Den Zeilen-Block ersetzen**

```css
/* ---- eine Karten-Zeile ----
   Zugeklappt einzeilig, per Klick aufgeklappt. Es ist bewusst KEINE <table>: die Spalten sind ein Grid
   mit festen Breiten (gleiche Ausrichtung wie eine Tabelle), aber <tr>-Hoehen lassen sich nicht
   verlaesslich animieren -- grid-template-columns mit Laengenwerten schon. */
.avesmaps-citymap-row {
	display: grid;
	grid-template-columns: 56px minmax(0, 1fr) 148px;
	gap: var(--space-10);
	align-items: start;
	/* Randlos bis an die Dialogkante: der negative Margin entspricht dem Seitenpadding des Grids, das
	   Padding gleicht ihn wieder aus. Das braucht die Hover-Flaeche (ein Hintergrund, der 16px vor dem
	   Rand endet, liest als schwebender Kasten statt als Listenzeile) -- und die Trennlinie laeuft damit
	   Rand zu Rand, so wie Trenner hier laufen sollen (AGENTS.md §12). */
	margin: 0 calc(-1 * var(--space-16));
	padding: var(--space-6) var(--space-16);
	cursor: pointer;
	transition:
		grid-template-columns 0.32s cubic-bezier(0.4, 0, 0.2, 1),
		padding 0.32s cubic-bezier(0.4, 0, 0.2, 1),
		background-color 0.15s ease;
}
.avesmaps-citymap-row:hover {
	background: var(--color-panel-soft);
}
.avesmaps-citymap-row + .avesmaps-citymap-row {
	border-top: 1px solid var(--color-divider);
}
.avesmaps-citymap-row.is-expanded {
	grid-template-columns: 256px minmax(0, 1fr) 148px;
	padding: var(--space-12) var(--space-16);
}
.avesmaps-citymap-row__thumb {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 48px;
	height: 34px;
	border-radius: var(--radius-sm);
	background: var(--color-panel-muted);
	border: 1px solid var(--color-border);
	color: var(--color-text-muted);
	overflow: hidden;
	text-decoration: none;
	transition:
		width 0.32s cubic-bezier(0.4, 0, 0.2, 1),
		height 0.32s cubic-bezier(0.4, 0, 0.2, 1),
		border-color 0.12s ease;
}
.avesmaps-citymap-row__thumb:hover {
	border-color: var(--color-accent);
}
/* DASSELBE <img>, nur anders dimensioniert (der Rahmen misst, das Bild fuellt ihn). Ein zweites,
   verstecktes Bild fuer den grossen Zustand wuerde jede Karte im Dialog doppelt laden. */
.avesmaps-citymap-row.is-expanded .avesmaps-citymap-row__thumb {
	width: 100%;
	max-width: 248px;
	height: 174px;
}
.avesmaps-citymap-row__main {
	min-width: 0;
}
.avesmaps-citymap-row__band {
	font-size: var(--font-size-small);
	line-height: var(--leading-snug);
	color: var(--color-link);
	transition: font-size 0.32s cubic-bezier(0.4, 0, 0.2, 1);
}
.avesmaps-citymap-row.is-expanded .avesmaps-citymap-row__band {
	font-size: var(--font-size-reading);
	font-weight: var(--font-weight-bold);
}
.avesmaps-citymap-row__suffix {
	font-size: var(--font-size-caption);
	color: var(--color-text-muted);
}
/* 0fr -> 1fr statt max-height: die Animation endet exakt an der echten Inhaltshoehe. Ein geratenes
   max-height hoert bei einer Karte mit drei Faktenzeilen zu frueh und bei einer mit sieben zu spaet auf. */
.avesmaps-citymap-row__detail {
	display: grid;
	grid-template-rows: 0fr;
	transition: grid-template-rows 0.32s cubic-bezier(0.4, 0, 0.2, 1);
}
.avesmaps-citymap-row.is-expanded .avesmaps-citymap-row__detail {
	grid-template-rows: 1fr;
}
.avesmaps-citymap-row__detail-inner {
	overflow: hidden;
	opacity: 0;
	transition: opacity 0.15s ease;
}
/* Verzoegert: der Text soll nicht vor seinem Platz da sein. */
.avesmaps-citymap-row.is-expanded .avesmaps-citymap-row__detail-inner {
	opacity: 1;
	transition: opacity 0.25s ease 0.12s;
}
.avesmaps-citymap-row__facts {
	padding-top: var(--space-4);
	font-size: var(--font-size-caption);
	line-height: var(--leading-normal);
	color: var(--color-text-muted);
}
.avesmaps-citymap-row__side {
	min-width: 0;
	text-align: right;
}
.avesmaps-citymap-row__side .avesmaps-adv-row__links {
	margin: 0;
	padding: 0;
	list-style: none;
}
.avesmaps-citymap-row__side .avesmaps-adv-row__linkitem {
	font-size: var(--font-size-small);
	line-height: var(--leading-snug);
	margin-bottom: var(--space-4);
}
.avesmaps-citymap-row__nolink {
	font-size: var(--font-size-caption);
	color: var(--color-text-muted);
}
/* "+ Neuer Fundort" nur in der offenen Zeile: in der kompakten Liste stuende er neben jeder Zeile und
   waere Laerm. Soft/outline -- die Hauptsache dieser Spalte sind die Fundorte, nicht das Melden. */
.avesmaps-citymap-row__addlink {
	display: inline-block;
	margin-top: var(--space-8);
	padding: var(--space-4) var(--space-8);
	border-radius: var(--radius-md);
	background: var(--color-button-soft);
	border: 1px solid var(--color-button-soft-border);
	color: var(--color-button-soft-text);
	font: inherit;
	font-size: var(--font-size-caption);
	cursor: pointer;
}
.avesmaps-citymap-row__addlink:hover {
	background: var(--color-button-soft-hover);
}
/* Wer Bewegung abbestellt hat, bekommt den Endzustand ohne Weg dorthin. */
@media (prefers-reduced-motion: reduce) {
	.avesmaps-citymap-row,
	.avesmaps-citymap-row__thumb,
	.avesmaps-citymap-row__band,
	.avesmaps-citymap-row__detail,
	.avesmaps-citymap-row__detail-inner {
		transition: none;
	}
}
```

Den Spoiler-Selektor bei Zeile 79–80 anpassen: `.avesmaps-citymap-row__main` bleibt gültig, `.avesmaps-citymap-row__thumb` ebenfalls — **keine Änderung nötig**, aber verifizieren, dass der Deckel weiterhin Bild **und** Titel verdeckt (der Titel sitzt jetzt in `__band` **innerhalb** von `__main`, also greift der bestehende Selektor).

- [ ] **Step 2: Im Browser prüfen**

`?siedlung=Gareth` → Kartensammlung. Erwartet: Zeilen einzeilig; Klick klappt weich auf (Bild wächst, Text entfaltet, kein Springen); Trennlinien laufen Rand zu Rand; Hover färbt die ganze Zeile.

Prüfen: `grid-template-rows: 0fr → 1fr` braucht Chrome/Edge ≥ 117, Safari ≥ 17.4, Firefox ≥ 127. In älteren Browsern erscheint der Inhalt **ohne** Animation sofort — akzeptabler Rückfall, kein Bruch.

- [ ] **Step 3: Commit**

```bash
git status --short
git add css/features/place-extras.css
git commit --only css/features/place-extras.css -F - <<'EOF'
style(citymaps): make the dialog row a single line that expands on an animation

Rows are a CSS grid with fixed columns, not a table: the alignment is identical
but <tr> heights cannot be transitioned, whereas grid-template-columns with
length values can. The detail unfolds via grid-template-rows 0fr -> 1fr, so the
animation lands on the real content height instead of a guessed max-height that
is too short for a map with seven facts and too long for one with three.

The preview is the same <img> resized by CSS -- a second hidden image for the
open state would load every map in the dialog twice. prefers-reduced-motion
gets the end state without the journey.
EOF
```

---

### Task 5: Fußzeile — Text, i18n, „Sammlung bearbeiten"

**Files:**
- Modify: `js/map-features/map-features-citymaps-dialog.js` (`openDialogForSection`, Fußzeile ~236-256; neuer Handler)
- Modify: `css/features/place-extras.css` (`.avesmaps-citymaps-dialog__foot`, ~584-614)
- Modify: `js/app/i18n-en.js` (`cityMaps.footHint:483` + neue/geänderte Keys)

**Interfaces:**
- Consumes: `window.openAvesmapsCitymapEditorOverlay(selectPublicId)` (`js/review/review-settlement-list.js:587`), `IS_EDIT_MODE` (`js/config.js:197`).
- Produces: nichts.

- [ ] **Step 1: Fußzeilen-Markup**

In `openDialogForSection` den `foot.innerHTML`-Block ersetzen:

```js
		var foot = overlay.querySelector(".avesmaps-citymaps-dialog__foot");
		if (foot) {
			// "Sammlung bearbeiten" nur bei IS_EDIT_MODE -- das ist ?edit=1 (js/config.js), KEIN
			// Capability-Check. Die Durchsetzung sitzt serverseitig (avesmapsRequireUserWithCapability);
			// der Client zeigt Redakteursflaechen bei ?edit=1, wie jede andere Editor-Flaeche auch.
			var editBtn = (typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE)
				? '<button type="button" class="avesmaps-citymaps__edit">' + esc(tr("cityMaps.editCollection", "Sammlung bearbeiten")) + '</button>'
				: "";
			// Die Ortsreferenz reist als data-Attribute AM BUTTON mit, nicht in einer Modulvariablen: der
			// Dialog ist EINE wiederverwendete Huelle, eine gemerkte Referenz waere genau einmal falsch --
			// naemlich dann, wenn jemand zwei Orte nacheinander ansieht und beim zweiten vorschlaegt.
			foot.innerHTML = '<span class="avesmaps-citymaps-dialog__hint">'
				+ esc(tr("cityMaps.footHint", "Karten sind externe Inhalte. Vorschau nur mit freier Lizenz/Genehmigung."))
				+ '</span>'
				+ '<span class="avesmaps-citymaps-dialog__actions">'
				+ editBtn
				+ '<button type="button" class="avesmaps-citymaps__suggest"'
				+ ' data-citymap-place-kind="' + esc(section.getAttribute("data-citymap-place-kind") || "") + '"'
				// KEIN Rueckfall auf baseTitle: das ist "Kartensammlung von Gareth", nicht "Gareth" -- als
				// raw_name entstuende ein Ort dieses Namens. Leer ist richtig: der Server legt dann gar
				// keinen Ort an, und eine Karte ohne Ort ist ein gueltiger Zustand (§3.1).
				+ ' data-citymap-place-name="' + esc(section.getAttribute("data-citymap-place-name") || "") + '"'
				+ ' data-citymap-place-id="' + esc(section.getAttribute("data-citymap-place-id") || "") + '"'
				+ ' data-citymap-place-key="' + esc(section.getAttribute("data-citymap-place-key") || "") + '"'
				+ '>' + esc(tr("cityMaps.suggest", "Karte vorschlagen")) + '</button>'
				+ '</span>';
		}
```

- [ ] **Step 2: Handler**

Neben die anderen delegierten Handler am Dateiende:

```js
	// "Sammlung bearbeiten" -> Karten-Editor. Der Dialog wird VORHER geschlossen, und das ist nicht die
	// billige Loesung, sondern die richtige: die Dialog-Huelle liegt auf z-index 3000
	// (place-extras.css), das Editor-Overlay oeffnet auf 1500 (review-settlement-list.js) -- der Editor
	// ginge sonst HINTER dem Dialog auf und der Knopf taete sichtbar nichts. Er ist ohnehin 1400x880 und
	// verdeckt den Dialog komplett, und beim Schliessen laedt er den Katalog neu
	// (avesmapsReloadCitymapCatalog) -- der Dialog dahinter waere also sowieso veraltet.
	//
	// Kein Vorauswaehlen der offenen Zeile: der Knopf sitzt in der Fusszeile und meint die SAMMLUNG.
	$(document).on("click", ".avesmaps-citymaps__edit", function () {
		var overlay = document.getElementById("avesmaps-citymaps-dialog");
		if (overlay) {
			overlay.classList.remove("is-open");
		}
		if (typeof window.openAvesmapsCitymapEditorOverlay === "function") {
			window.openAvesmapsCitymapEditorOverlay();
		}
	});
```

- [ ] **Step 3: CSS**

`.avesmaps-citymaps-dialog__foot .avesmaps-citymaps__suggest` bleibt (gefüllt). Ergänzen:

```css
.avesmaps-citymaps-dialog__actions {
	flex: 0 0 auto;
	display: flex;
	gap: var(--space-8);
	white-space: nowrap;
}
/* Soft/outline neben der EINEN gefuellten Hauptaktion (AGENTS.md §12): das Melden ist die Aktion fuer
   alle, das Bearbeiten die fuer Redakteure. */
.avesmaps-citymaps-dialog__foot .avesmaps-citymaps__edit {
	flex: 0 0 auto;
	padding: var(--space-6) var(--space-12);
	border-radius: var(--radius-md);
	background: var(--color-button-soft);
	border: 1px solid var(--color-button-soft-border);
	color: var(--color-button-soft-text);
	font: inherit;
	font-size: var(--font-size-small);
	cursor: pointer;
}
.avesmaps-citymaps-dialog__foot .avesmaps-citymaps__edit:hover {
	background: var(--color-button-soft-hover);
}
```

- [ ] **Step 4: i18n**

In `js/app/i18n-en.js` ändern/ergänzen:

```js
	"cityMaps.footHint": "Maps are external content. Preview only with a free licence or permission.",
	"cityMaps.editCollection": "Edit collection",
	"cityMaps.trait.greyscale": "greyscale",
	"cityMaps.noFacts": "Nothing further recorded.",
	"cityMaps.noLink": "no source known",
	"cityMaps.filter.officialOnly": "official",
	"cityMaps.filter.freeOnly": "free",
```

**Löschen** (die Filter gibt es nicht mehr): `cityMaps.filter.paidOnly`, `cityMaps.filter.art`, `cityMaps.filter.source`, `cityMaps.filter.multilevel`, `cityMaps.filter.labeled`, `cityMaps.filter.spoiler`. Vorher `grep -rn "cityMaps.filter.paidOnly" js/` — nur löschen, was kein Aufrufer mehr hat.

- [ ] **Step 5: Prüfen**

`?siedlung=Gareth` → Fußzeile zeigt den neuen Text, **kein** „Sammlung bearbeiten".
`?siedlung=Gareth&edit=1` → Knopf da; Klick schließt den Dialog und öffnet den Editor **sichtbar davor**.

- [ ] **Step 6: Commit**

```bash
git status --short
git add js/map-features/map-features-citymaps-dialog.js css/features/place-extras.css js/app/i18n-en.js
git commit --only js/map-features/map-features-citymaps-dialog.js css/features/place-extras.css js/app/i18n-en.js -F - <<'EOF'
feat(citymaps): add "Sammlung bearbeiten" to the dialog footer, reword the hint

The footer gains an editor shortcut into the map editor, gated on IS_EDIT_MODE
(?edit=1) like every other editor surface -- the server still enforces the
capability, so this adds no new auth surface.

It closes the dialog first. That is required, not tidy: the dialog shell sits at
z-index 3000 while the editor overlay opens at 1500, so the editor would appear
BEHIND it and the button would visibly do nothing.

Hint text is the owner's wording; the English overlay follows.
EOF
```

---

### Task 6: Editor — „Linktext" für den Karten-Link

**Files:**
- Modify: `api/_internal/app/citymaps.php` (CREATE TABLE ~85; `$columnExists`-ALTER-Block ~196; `avesmapsCitymapLinks:308-339`; Editor-Ausgabe ~902; `$editableFields:964`; die SELECT-Liste in `avesmapsCitymapsReadCatalog`)
- Modify: `html/citymap-editor.html` (`renderDetail`, nach Zeile 849)
- Test: `api/_internal/app/__tests__/citymap-links-test.php`

**Interfaces:**
- Consumes: `avesmapsCitymapTriBoolOut`, `$columnExists` (beide vorhanden).
- Produces: `citymap.map_url_label` — Spalte; `avesmapsCitymapLinks()` liefert sie als `label` des `key: 'map'`-Links.

- [ ] **Step 1: Write the failing test**

An `api/_internal/app/__tests__/citymap-links-test.php` anhängen:

```php
// ---- Linktext (map_url_label) ----
// Der Karten-Link trug sein Label als KONSTANTE; die zusaetzlichen Fundorte haben das Feld laengst
// (citymap_link.label). Er zieht nach.
$labelled = avesmapsCitymapLinks(['map_url' => 'https://example.org/k', 'map_url_label' => 'Plan im Wiki']);
assert($labelled[0]['label'] === 'Plan im Wiki');
assert($labelled[0]['key'] === 'map');

// Leer -> "Karte". Der Fallback bleibt serverseitig: avesmapsCitymapLinks speist AUCH den Linkchecker,
// und ein leeres Label waere dort eine zweite Baustelle.
assert(avesmapsCitymapLinks(['map_url' => 'https://example.org/k', 'map_url_label' => ''])[0]['label'] === 'Karte');
assert(avesmapsCitymapLinks(['map_url' => 'https://example.org/k'])[0]['label'] === 'Karte');
assert(avesmapsCitymapLinks(['map_url' => 'https://example.org/k', 'map_url_label' => '   '])[0]['label'] === 'Karte');

// Der Linktext aendert nichts an den zusaetzlichen Fundorten.
$both = avesmapsCitymapLinks(
    ['map_url' => 'https://example.org/k', 'map_url_label' => 'Plan im Wiki'],
    [['id' => 5, 'url' => 'https://example.org/x', 'label' => 'maps.aventuria.ru', 'is_paid' => 0]]
);
assert(count($both) === 2);
assert($both[1]['label'] === 'maps.aventuria.ru');

echo "citymap linktext ok\n";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/citymap-links-test.php`
Expected: FAIL — `AssertionError` (Label ist noch immer `Karte`)

- [ ] **Step 3: Write minimal implementation**

`avesmapsCitymapLinks` (Zeile ~317) — den `map`-Zweig:

```php
    if ($mapUrl !== '') {
        // Der Linktext ersetzt das Wort "Karte" (Owner 2026-07-17). Fallback bleibt serverseitig: diese
        // Funktion speist AUCH den Linkchecker, und ein leeres Label waere dort eine zweite Baustelle.
        $label = trim((string) ($row['map_url_label'] ?? ''));
        $links[] = [
            'key' => 'map',
            'label' => $label !== '' ? $label : 'Karte',
            'url' => $mapUrl,
            'is_paid' => avesmapsCitymapTriBoolOut($row['is_paid'] ?? null),
            'url_hash' => hash('sha256', $mapUrl),
        ];
    }
```

CREATE TABLE (~85), nach `map_url`:

```php
            map_url_label VARCHAR(120) NULL,
```

Selbstheilendes ALTER — zu den anderen `$columnExists`-Blöcken (~196):

```php
    // map_url_label: der Linktext des Karten-Links (Owner 2026-07-17). Er trug sein Label als Konstante
    // 'Karte'; die zusaetzlichen Fundorte haben das Feld laengst.
    if (!$columnExists($pdo, 'map_url_label')) {
        $pdo->exec('ALTER TABLE citymap ADD COLUMN map_url_label VARCHAR(120) NULL');
    }
```

`$editableFields` (964) — `'map_url_label'` direkt hinter `'map_url'`.

Editor-Ausgabe (~902), hinter `'map_url'`:

```php
            'map_url_label' => (string) ($row['map_url_label'] ?? ''),
```

**Die SELECT-Liste des öffentlichen Katalogs** in `avesmapsCitymapsReadCatalog` um `map_url_label` erweitern — sie ist **explizit** (im Gegensatz zum `SELECT *` des Editor-Reads). Ohne diesen Schritt liefert der Katalog stumm weiter „Karte":

```bash
grep -n "SELECT" api/_internal/app/citymaps.php | sed -n '1,12p'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/citymap-links-test.php`
Expected: PASS — endet mit `citymap linktext ok`

- [ ] **Step 5: Editor-Feld**

In `html/citymap-editor.html`, `renderDetail`, direkt **nach** Zeile 849 (`ceUrlField("Karten-Link (extern) *", "map_url", v.map_url)`):

```js
        ${ceField("Linktext", "map_url_label", v.map_url_label)}
```

**`data-cm-field`, nicht `data-cl-field`:** `gatherStamm()` sweept `[data-cm-field]` aus `#ceStammBody`; `data-cl-field` gehört der Link-Tabelle. `ceField` setzt das korrekte Attribut selbst — nur die Funktion nicht verwechseln.

Im „Neue Karte"-Zweig (Zeile ~833) **kein** Linktext: dort stehen nur Pflichtfelder, und ohne gespeicherte Karte gibt es keinen Link zu benennen.

- [ ] **Step 6: Commit**

```bash
git status --short
git add api/_internal/app/citymaps.php html/citymap-editor.html api/_internal/app/__tests__/citymap-links-test.php
git commit --only api/_internal/app/citymaps.php html/citymap-editor.html api/_internal/app/__tests__/citymap-links-test.php -F - <<'EOF'
feat(citymaps): let an editor name the map link ("Linktext")

The map link carried its label as the constant 'Karte' while every additional
Fundort has had citymap_link.label all along. A new map_url_label column closes
that gap; empty falls back to 'Karte'.

The fallback stays server-side deliberately: avesmapsCitymapLinks also feeds the
linkchecker, so an empty label would be a second problem there. The i18n gap
that leaves ('Karte' cannot be translated by the EN overlay) is older than this
change and stays for now.

Note for the next reader: the editor detail read is SELECT * and gets the column
for free, but the public catalogue read has an explicit column list and does not.
EOF
```

---

### Task 7: „Vorschau-Link (extern)" raus — `thumb_url` stillgelegt

**Files:**
- Modify: `api/_internal/app/citymaps.php` (`avesmapsCitymapPublicThumbUrl:~509-525`)
- Modify: `html/citymap-editor.html` (Zeile 850 löschen)
- Test: `api/_internal/app/__tests__/citymap-gate-test.php`

**Interfaces:**
- Consumes: nichts Neues.
- Produces: `avesmapsCitymapPublicThumbUrl(array $row) -> string` — liefert nur noch `thumb_local_url`.

- [ ] **Step 1: Write the failing test**

`api/_internal/app/__tests__/citymap-gate-test.php`, den Block um Zeile 86 (`'thumb_url' => 'https://example.org/protected-thumb.jpg'`) ersetzen bzw. anhängen:

```php
// ---- thumb_url ist stillgelegt (Owner 2026-07-17) ----
// Es war nicht nur ein Eingabeweg, sondern ein ANZEIGEweg: ohne eigenen Upload wurde der Fremdlink zur
// oeffentlichen Vorschau. Der Community-Vorschlagsdialog darf thumb_url befuellen, das Editor-Feld ist
// weg, und einen "Entfernen"-Knopf gibt es nur fuer Uploads und Autoget -- ein schlechter Fremdlink waere
// ueber die UI nicht mehr loszuwerden. Also: nur noch, was jemand mit Capability `edit` hochgeladen hat.
assert(avesmapsCitymapPublicThumbUrl(['thumb_url' => 'https://example.org/fremd.jpg']) === '');
assert(avesmapsCitymapPublicThumbUrl(['thumb_url' => 'https://example.org/fremd.jpg', 'thumb_local_url' => '/uploads/kartensammlungen/a/t.webp'])
    === '/uploads/kartensammlungen/a/t.webp');
assert(avesmapsCitymapPublicThumbUrl(['thumb_local_url' => '/uploads/kartensammlungen/a/t.webp']) === '/uploads/kartensammlungen/a/t.webp');
assert(avesmapsCitymapPublicThumbUrl([]) === '');
// thumb_auto_url ist davon UNBERUEHRT und war nie oeffentlich (eigene Spalte, per Konstruktion).
assert(avesmapsCitymapPublicThumbUrl(['thumb_auto_url' => 'https://example.org/auto.jpg']) === '');

echo "citymap thumb_url retired ok\n";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/citymap-gate-test.php`
Expected: FAIL — `AssertionError` (liefert noch `https://example.org/fremd.jpg`)

- [ ] **Step 3: Write minimal implementation**

`avesmapsCitymapPublicThumbUrl` (~520) ersetzen:

```php
// Die oeffentliche Vorschau ist NUR noch unser eigener Upload (Owner 2026-07-17). thumb_url -- ein
// Fremdlink, den auch der Community-Vorschlag befuellen darf -- war frueher der Rueckfall und damit ein
// Anzeigeweg ohne Bedienung: das Editor-Feld ist weg, und "Entfernen" gibt es nur fuer Uploads und
// Autoget. Ein schlechter Fremdlink waere nicht mehr loszuwerden gewesen.
//
// Die SPALTE bleibt: der Melder darf weiter einen Link vorschlagen, und der Pruefer sieht ihn in der
// Meldung (avesmapsCitymapEditorThumbUrl ist ungegated) -- er laedt das Bild dann selbst hoch, wenn die
// Lizenz es erlaubt. Kostete beim Umstellen nichts: von 419 Karten zeigte genau EINE eine Vorschau, und
// die war ein Upload.
function avesmapsCitymapPublicThumbUrl(array $row): string
{
    return trim((string) ($row['thumb_local_url'] ?? ''));
}
```

Den Kommentarblock darüber (~509–518), der `thumb_url <- thumb_license` als öffentlichen Weg beschreibt, entsprechend berichtigen — er beschreibt sonst ein Verhalten, das es nicht mehr gibt.

**Prüfen, ob `thumb_license` jetzt tote Logik ist:** `grep -n "thumb_license" api/_internal/app/citymaps.php`. Die Lizenz gilt weiterhin für `thumb_local_url` (der Upload ist erst bei freier Lizenz erlaubt) — sie bleibt. Nur der `thumb_url`-Zweig entfällt.

- [ ] **Step 4: Run test to verify it passes**

Run: `php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll api/_internal/app/__tests__/citymap-gate-test.php`
Expected: PASS — endet mit `citymap thumb_url retired ok`

- [ ] **Step 5: Editor-Feld entfernen**

In `html/citymap-editor.html` Zeile 850 löschen:

```js
        ${ceUrlField("Vorschau-Link (extern)", "thumb_url", v.thumb_url)}
```

`'thumb_url'` **bleibt** in `$editableFields`: der Community-Import-Pfad (`api/app/report-location.php:302`) schreibt die Spalte weiterhin. Wer sie dort entfernt, bricht das Melden.

- [ ] **Step 6: Alle Tests + Commit**

```bash
node js/map-features/__tests__/citymaps-render.test.js
node js/map-features/__tests__/citymaps-index.test.js
for t in api/_internal/app/__tests__/citymap-*.php; do
  php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_curl.dll "$t" || echo "FAIL $t"
done
git status --short
git add api/_internal/app/citymaps.php html/citymap-editor.html api/_internal/app/__tests__/citymap-gate-test.php
git commit --only api/_internal/app/citymaps.php html/citymap-editor.html api/_internal/app/__tests__/citymap-gate-test.php -F - <<'EOF'
feat(citymaps): retire thumb_url as a public preview path, drop its editor field

"Vorschau-Link (extern)" is covered by the Vorschaubild upload (owner). But the
field was not only an input path: without a local upload, thumb_url BECAME the
public preview -- and the community suggest dialog is allowed to fill it. Remove
just the field and a suggested hotlink would show with no way to clear it: the
Entfernen button exists only for uploads and autoget.

So the display path goes too. Only what an editor uploaded is ever public. The
column stays -- a reporter may still suggest a link and the reviewer still sees
it -- and thumb_auto_url is untouched. Costs nothing today: of 419 maps exactly
one shows a preview, and it is an upload.
EOF
```

---

### Task 8: Editor aufräumen — „Identität" nach oben, Erklärsatz raus

**Files:**
- Modify: `html/citymap-editor.html` (`renderDetail`: Blocktausch ~846-847; `ce-hint` Zeile ~873 löschen)

**Interfaces:**
- Consumes: `ceImageGroup(slot, title, v)`, `ceField`, `ceUrlField`, `ceSelect` — alle vorhanden, unverändert.
- Produces: nichts.

**Kein Unit-Test:** reine Reihenfolge im Template-String, keine Logik. Abnahme im Browser.

Läuft **nach** Task 6 und 7 — alle drei fassen denselben `body.innerHTML`-Ausdruck an, und ein Tausch von Blöcken, deren Inhalt sich noch ändert, produziert nur Konflikte.

- [ ] **Step 1: Reihenfolge drehen**

In `renderDetail()` die beiden Blöcke tauschen. Der Autoget-Knopf crawlt `map_url` (Zeile ~789, `disabled` ohne Karten-Link) und stand über dem Feld, das er liest — jetzt steht die Ursache über der Wirkung:

```js
    body.innerHTML =
      `<div class="ce-grp"><p class="ce-grp__title">Identität</p>
        ${ceField("Titel *", "title", v.title)}
        ${ceUrlField("Karten-Link (extern) *", "map_url", v.map_url)}
        ${ceField("Linktext", "map_url_label", v.map_url_label)}
        ${ceField("Urheber", "author", v.author)}
        ${ceField("Notiz", "note", v.note)}
        ${ceSelect("Übergeordnete Karte", "parent_public_id", v.parent_public_id, parentOptions, "— keine —")}
        ${ceSelect("Sichtbarkeit", "status", v.status, [["approved", "sichtbar"], ["suppressed", "verborgen"]], "sichtbar")}
      </div>` +
      // Autoget liest den Karten-Link aus der Gruppe DARUEBER (siehe den Knopf in ceImageGroup): die
      // Reihenfolge ist die Erklaerung. Stand dieser Kasten oben, war die Kausalitaet unsichtbar.
      `<div class="ce-imgcols">` + ceImageGroup("thumb", "Vorschaubild", v) + ceImageGroup("map", "Karte (eigenes Bild)", v) + `</div>` +
```

Der Rest des Ausdrucks (Eigenschaften, Typen, Links) folgt unverändert. **`gatherStamm()` sweept `[data-cm-field]` aus `#ceStammBody`** und ist reihenfolgeunabhängig — der Tausch ändert nichts am Speichern.

- [ ] **Step 2: Erklärsatz löschen**

Zeile ~873 ersatzlos entfernen:

```js
        <p class="ce-hint">„kostenpflichtig“ setzt ein Mensch — bewusst kein Auto-Abgleich mit dem Shop (Owner 2026-07-17). Ein Preis ist eine Momentaufnahme: „zahl was du willst“ ist weder frei noch bezahlt, Aktionen laufen ab. Und die API kennt nur das Produkt, nicht die Karte im Buch.</p>
```

Die **Begründung** ist damit nicht widerrufen — sie steht in der Spec §5.4 und in `citymaps-feature-task-c`. Nur der Editor muss sie nicht bei jedem Öffnen erzählen. Wer später einen Shop-Abgleich bauen will, findet das Nein weiterhin dokumentiert.

- [ ] **Step 3: Im Browser prüfen**

`?edit=1` → WikiSync → Abenteuer → „Kartensammlung editieren" → eine Karte wählen. Erwartet: „Identität" (mit Titel, Karten-Link, Linktext) steht **über** Vorschaubild/Karte; der Erklärsatz ist weg; Speichern schreibt weiterhin alle Felder.

- [ ] **Step 4: Commit**

```bash
git status --short
git add html/citymap-editor.html
git commit --only html/citymap-editor.html -F - <<'EOF'
ui(citymaps): put "Identitaet" above the image boxes, drop the is_paid essay

Autoget crawls map_url and is disabled without it -- but its button sat in a box
ABOVE the field it reads, so the causality was invisible. Identity first makes
the editor read top-down as cause then effect (owner).

The three-line hint explaining why "kostenpflichtig" has no shop auto-sync goes
(owner). The reasoning is not withdrawn -- it lives in the spec and the project
notes -- but the editor need not retell it on every open.
EOF
```

---

## Self-Review

**Spec coverage:**

| Spec | Task |
|---|---|
| §3.1 Zeile zugeklappt, Band-Ableitung, „schwarzweiß" | 1 |
| §3.2 Aufgeklappt (Maße, Fakten, „+ Neuer Fundort") | 1 (Markup) + 4 (Maße/Animation) |
| §3.3 Kein `<table>`, `0fr→1fr`, dasselbe `<img>`, 0,32 s | 4 |
| §3.4 Sortierung Typ → Band | 3 |
| §4.1 Filter auf vier, adaptive Regel, Streichungen | 2 (Logik) + 3 (Verdrahtung) |
| §4.2 Fußzeilentext + EN, Knopf-Hierarchie | 5 |
| §4.3 „Sammlung bearbeiten", `IS_EDIT_MODE`, z-index | 5 |
| §5.1 „Linktext" / `map_url_label` | 6 |
| §5.2 „Vorschau-Link" raus, `thumb_url` stillgelegt | 7 |
| §5.3 „Identität" über die Bildkästen | 8 |
| §5.4 `is_paid`-Erklärsatz raus | 8 |
| §2.4 `(online)` raus | 1 (via `opts.showStatus`) |

Keine Lücke.

**Type consistency:** `cityMapBandLabel` wird in Task 1 definiert und in Task 3 (Sortierung) benutzt — dort mit `typeof`-Guard, weil die Dialog-Datei eine IIFE ohne Import ist und auf den Browser-Global zielt. `avesmapsCitymapActiveFacets` heißt in Task 2 (Definition), Task 2 (Export) und Task 3 (Aufruf) identisch. `opts.showStatus` heißt in Task 1 an Definition und Aufrufstelle gleich. `facets.{color, official, free, years, yearRange}` sind in Task 2 zwischen `avesmapsCitymapActiveFacets` und `citymapFiltersMarkup` deckungsgleich.

**Reihenfolge:** 1 → 2 → 3 → 4 → 5 sind aufeinander aufgebaut (Markup → Facetten → Verdrahtung → CSS → Fußzeile). 6 und 7 sind davon unabhängig und können jederzeit laufen; 6 vor 7, weil beide `html/citymap-editor.html` und `api/_internal/app/citymaps.php` anfassen.

**Offen bis zum Deploy:** alles DB-Gebundene (die beiden ALTER, der Katalog-Read mit `map_url_label`) ist lokal nicht prüfbar — es gibt keine lokale DB. Abnahme nach §8 der Spec auf der Live-Seite.
