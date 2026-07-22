# Kraftlinien-Infobox + Quellen — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Klick auf eine Kraftlinie öffnet ein Infopanel mit Kopfbild, der Spanne der ganzen Linie („von wo bis wo"), einer Beschreibung, einem Wiki-Link und Quellen aus dem geteilten Quellensystem.

**Architecture:** Die Infobox spiegelt die Weg-Infobox (`pathWikiInfoboxMarkup`) in Form und Hülle, füllt sich aber aus anderen Daten: die „Verbindet"-Zeile wird über alle **gleichnamigen** Segmente einer Linie gerechnet (162 Zeilen / ~40 Namen in der Karte), Beschreibung und Wiki-Link kommen aus dem Editor. Quellen kommen über einen weiteren `entity_type` im vorhandenen `feature_sources`-System — keine neue Tabelle.

**Tech Stack:** Vanilla JS ohne Build (Leaflet 1.9.4, jQuery), PHP 8 + PDO, Node für Unit-Tests (`node <datei>`, kein Framework).

## Global Constraints

- **Sprache:** UI-Strings Deutsch. Code-Kommentare, Commit-Messages und `error.code`-Werte Englisch (AGENTS.md §8).
- **Keine hartkodierten Farben/Radien/Trenner** — nur Tokens aus `css/base/tokens.css` (AGENTS.md §12). Dieser Plan braucht keine neuen Tokens: alle Klassen sind vorhanden.
- **Shared Working Tree:** NIE `git add -A` / `git add .` / `git commit -a`. Nur die eigenen Pfade explizit stagen (AGENTS.md §9).
- **Kein `ASSET_VERSION`-Bump** — der gilt nur für die dynamisch geladenen Territorien-Editor-Assets (AGENTS.md §7). Alles hier hängt an `index.html` und wird vom Deploy gestempelt.
- **Nie ein `?v=` von Hand schreiben** (AGENTS.md §7).
- **Quellen leben an EINER Stelle** — kein `CREATE TABLE powerline_source`. Ein neuer Typ ist ein weiterer `entity_type` (AGENTS.md §5).
- **Externe Links** bekommen ein nachgestelltes `↗` (AGENTS.md §12).
- **Spec:** `docs/superpowers/specs/2026-07-22-kraftlinien-infobox-quellen-design.md`.

## File Structure

| Datei | Verantwortung |
|---|---|
| `js/map-features/map-features-powerlines.js` | Spannen-Logik, Infobox-Markup, Popup-Verdrahtung (bestehende Datei, Kraftlinien-Zuständigkeit) |
| `js/map-features/__tests__/powerline-span.test.js` | **neu** — Unit-Test der Spannen-Logik |
| `icons/header/powerline.webp` | **neu** — Kopfbild |
| `index.html` | Dialogfelder Beschreibung / Wiki-Link / Quellen-Container |
| `js/review/review-paths.js` | Dialog befüllen + Payload bauen |
| `api/_internal/map/features.php` | `update_powerline_details` nimmt zwei Felder mehr |
| `api/app/feature-sources.php`, `api/edit/map/feature-sources.php`, `api/_internal/app/feature-sources.php` | `powerline` als `entity_type` |
| `api/app/map-features.php` | Riegel gegen geratene Wiki-Links |
| `html/editor-handbuch.html` | Handbuch-Abschnitt + `Stand:` |

**Reihenfolge-Logik:** Task 1 liefert reine Logik (testbar ohne DOM). Task 2 macht sie sichtbar. Task 3 öffnet das Quellensystem. Task 4 gibt dem Editor die Felder. Task 5 hängt den Quellen-Editor ein. Task 6 zieht das Handbuch nach.

---

### Task 1: Die Spanne der ganzen Linie (reine Logik)

Eine Kraftlinie liegt als **viele** `powerline`-Zeilen in der Karte (Basiliuslinie = 14, Fächer der Macht = 11). Der Name ist das einzige Band zwischen ihnen. Diese Task rechnet aus allen gleichnamigen Segmenten die zwei äußeren, **benannten** Enden — reine Kreuzungen werden übersprungen, sonst stünde in der Infobox „Kreuzung ↔ Kreuzung" (mehrere Segmente heißen heute genau so).

**Files:**
- Modify: `js/map-features/map-features-powerlines.js` (einfügen direkt nach `getPowerlineDisplayName`, Zeile 16)
- Test: `js/map-features/__tests__/powerline-span.test.js` (neu)

**Interfaces:**
- Consumes: `powerlineData` (`js/app/runtime-state.js`), `findLocationMarkerByPublicId(publicId)` → `{marker, locationType, name, publicId, location}|null` (`js/map-features/map-features-location-lookup.js:42`), `CROSSING_LOCATION_TYPE === "crossing"` (`js/config.js:65`)
- Produces: `getPowerlineSpanEndpointIds(powerline)` → `{fromPublicId: string, toPublicId: string} | null` — von Task 2 benutzt

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

Neue Datei `js/map-features/__tests__/powerline-span.test.js`. Die Kopfzeilen spiegeln
`powerline-connected-endpoints.test.js` — dieselbe vm-Harness, ein Skript mehr (`map-features-location-lookup.js`).

```js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = { location: { search: "" }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
global.document = {
	getElementById: () => null,
	querySelectorAll: () => [],
	addEventListener() {},
	documentElement: { style: { setProperty() {} }, classList: { add() {}, remove() {} } },
	body: null,
};
global.localStorage = { getItem: () => null, setItem() {} };

const loadBrowserScript = (relativePath) => {
	const absolutePath = path.join(__dirname, relativePath);
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};
loadBrowserScript("../../config.js");
loadBrowserScript("../../app/runtime-state.js");
loadBrowserScript("../map-features-location-lookup.js");
loadBrowserScript("../map-features-powerlines.js");

const segment = (name, from, to) => ({ properties: { name, from_public_id: from, to_public_id: to } });
const place = (publicId, name) => ({ publicId, name, locationType: "dorf", marker: null, location: null });
const crossing = (publicId) => ({ publicId, name: "Kreuzung-1", locationType: CROSSING_LOCATION_TYPE, marker: null, location: null });

// Kette: Ewiges Eis -- K1 -- K2 -- Suedmeer, drei gleichnamige Segmente.
locationMarkers = [place("eis", "Ewiges Eis"), crossing("k1"), crossing("k2"), place("meer", "Südmeer")];
powerlineData = [
	segment("Basiliuslinie", "eis", "k1"),
	segment("Basiliuslinie", "k1", "k2"),
	segment("Basiliuslinie", "k2", "meer"),
];
assert.deepStrictEqual(
	getPowerlineSpanEndpointIds(powerlineData[1]),
	{ fromPublicId: "eis", toPublicId: "meer" },
	"middle segment must report the span of the WHOLE line"
);

// Kreuzungen an den Enden werden uebersprungen.
locationMarkers = [crossing("k0"), place("gareth", "Gareth"), place("punin", "Punin"), crossing("k9")];
powerlineData = [
	segment("Konzilslinie", "k0", "gareth"),
	segment("Konzilslinie", "gareth", "punin"),
	segment("Konzilslinie", "punin", "k9"),
];
assert.deepStrictEqual(
	getPowerlineSpanEndpointIds(powerlineData[0]),
	{ fromPublicId: "gareth", toPublicId: "punin" },
	"bare crossings at the chain ends are skipped inward"
);

// Namenlose Linie bildet keine Gruppe.
locationMarkers = [place("a", "A"), place("b", "B")];
powerlineData = [segment("", "a", "b")];
assert.strictEqual(getPowerlineSpanEndpointIds(powerlineData[0]), null, "an unnamed powerline has no span");

// Verzweigung (drei Enden) -> lieber keine Zeile als eine falsche.
locationMarkers = [place("m", "Mitte"), place("x", "X"), place("y", "Y"), place("z", "Z")];
powerlineData = [
	segment("Fächer der Macht", "m", "x"),
	segment("Fächer der Macht", "m", "y"),
	segment("Fächer der Macht", "m", "z"),
];
assert.strictEqual(getPowerlineSpanEndpointIds(powerlineData[0]), null, "a branching line reports no span");

// Nur Kreuzungen -> kein benennbares Ende.
locationMarkers = [crossing("k1"), crossing("k2")];
powerlineData = [segment("Namenlos-Kette", "k1", "k2")];
assert.strictEqual(getPowerlineSpanEndpointIds(powerlineData[0]), null, "a chain of bare crossings reports no span");

console.log("powerline span tests passed");
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag bestätigen**

Run: `node js/map-features/__tests__/powerline-span.test.js`
Expected: FAIL mit `ReferenceError: getPowerlineSpanEndpointIds is not defined`

- [ ] **Step 3: Die Logik implementieren**

In `js/map-features/map-features-powerlines.js` direkt **nach** `getPowerlineDisplayName` (endet Zeile 16) einfügen:

```js
// Eine Kraftlinie liegt als VIELE powerline-Zeilen in der Karte (Basiliuslinie = 14 Segmente,
// Faecher der Macht = 11). Der Name ist das einzige Band zwischen ihnen -- dieselbe
// 1-zu-N-Form wie bei Strassen. Namenlose Segmente bilden bewusst KEINE Gruppe, sonst
// waeren sie alle eine einzige Linie.
function getPowerlineSegmentsSharingName(powerline) {
	const name = String(powerline?.properties?.name || "").trim();
	if (name === "") {
		return [];
	}
	return powerlineData.filter((entry) => String(entry?.properties?.name || "").trim() === name);
}

// Nachbarschaft ueber die Nodix-Endpunkte aller Segmente einer Linie.
function buildPowerlineAdjacency(segments) {
	const adjacency = new Map();
	segments.forEach((segment) => {
		const from = segment?.properties?.from_public_id || "";
		const to = segment?.properties?.to_public_id || "";
		if (!from || !to) {
			return;
		}
		if (!adjacency.has(from)) {
			adjacency.set(from, []);
		}
		if (!adjacency.has(to)) {
			adjacency.set(to, []);
		}
		adjacency.get(from).push(to);
		adjacency.get(to).push(from);
	});
	return adjacency;
}

// Eine reine Kreuzung ist kein Ziel, das man benennen kann: mehrere Segmente heissen heute
// woertlich "Kreuzung - Kreuzung", und "Verbindet: Kreuzung <-> Kreuzung" waere Laerm.
function isNamedPowerlineEndpoint(publicId) {
	const entry = findLocationMarkerByPublicId(publicId);
	if (!entry || entry.locationType === CROSSING_LOCATION_TYPE) {
		return false;
	}
	return String(entry.name || "").trim() !== "";
}

// Vom Kettenende nach innen laufen, bis ein benannter Punkt kommt.
function walkToNamedPowerlineEndpoint(adjacency, startPublicId) {
	const visited = new Set();
	let current = startPublicId;
	while (current && !visited.has(current)) {
		visited.add(current);
		if (isNamedPowerlineEndpoint(current)) {
			return current;
		}
		current = (adjacency.get(current) || []).find((id) => !visited.has(id)) || "";
	}
	return "";
}

// Die Spanne der GANZEN Linie, nicht des angeklickten Segments: wer die Basiliuslinie anklickt,
// will ihre beiden Enden wissen, nicht welchen von vierzehn Hops er getroffen hat.
// Verzweigt die Kette oder ist sie ein Ring (!== 2 Enden mit Grad 1), geben wir null zurueck --
// lieber keine Zeile als eine falsche.
function getPowerlineSpanEndpointIds(powerline) {
	const segments = getPowerlineSegmentsSharingName(powerline);
	if (segments.length === 0) {
		return null;
	}
	const adjacency = buildPowerlineAdjacency(segments);
	const chainEnds = [...adjacency.keys()].filter((id) => (adjacency.get(id) || []).length === 1);
	if (chainEnds.length !== 2) {
		return null;
	}
	const fromPublicId = walkToNamedPowerlineEndpoint(adjacency, chainEnds[0]);
	const toPublicId = walkToNamedPowerlineEndpoint(adjacency, chainEnds[1]);
	if (!fromPublicId || !toPublicId || fromPublicId === toPublicId) {
		return null;
	}
	return { fromPublicId, toPublicId };
}
```

- [ ] **Step 4: Test laufen lassen und Erfolg bestätigen**

Run: `node js/map-features/__tests__/powerline-span.test.js`
Expected: `powerline span tests passed`

Zusätzlich der Nachbartest, der dieselbe Datei lädt (Regression):
Run: `node js/map-features/__tests__/powerline-connected-endpoints.test.js`
Expected: `powerline endpoint helper tests passed`

- [ ] **Step 5: Commit**

```bash
git add -- js/map-features/map-features-powerlines.js js/map-features/__tests__/powerline-span.test.js
git commit --only -m "feat(kraftlinien): compute the span of a whole powerline, not the clicked segment" -- js/map-features/map-features-powerlines.js js/map-features/__tests__/powerline-span.test.js
```

---

### Task 2: Infobox mit Kopfbild sichtbar machen

**Files:**
- Create: `icons/header/powerline.webp`
- Modify: `js/map-features/map-features-powerlines.js` (`createPowerlinePopupMarkup`, Zeile 163–190)

**Interfaces:**
- Consumes: `getPowerlineSpanEndpointIds` (Task 1); `infoHeaderImageMarkup(imageBasename, title, subtitle, coatMarkup, ownImages, subtitleSuffixMarkup)` (`js/ui/popups.js:281`); `renderFeatureSourceLine(entityType, entityPublicId, wikiUrl, linkClass, opts)` (`js/ui/popups.js:124`); `escapeHtml`
- Produces: `powerlineInfoboxMarkup(powerline)` → HTML-String

- [ ] **Step 1: Das Kopfbild anlegen**

Die Vorlage liegt in `C:\GIT\avesmaps-map-processing\icons\info_header_graphics\Kraftlinien.png`.
Ziel ist `icons/header/powerline.webp` — **kleingeschrieben und gleich dem Subtyp-Schlüssel**,
so wie die Tabelle es vorschreibt (`js/ui/popups.js:237-248`, Kommentar: „Dateiname = unser
Subtyp-Schlüssel"). Unser Schlüssel ist `powerline`.

Ein Werkzeug wählen, das vorhanden ist (in dieser Reihenfolge probieren):

```bash
# 1. ImageMagick
magick "C:/GIT/avesmaps-map-processing/icons/info_header_graphics/Kraftlinien.png" -quality 82 icons/header/powerline.webp
# 2. cwebp
cwebp -q 82 "C:/GIT/avesmaps-map-processing/icons/info_header_graphics/Kraftlinien.png" -o icons/header/powerline.webp
# 3. Python + Pillow
python -c "from PIL import Image; Image.open(r'C:\GIT\avesmaps-map-processing\icons\info_header_graphics\Kraftlinien.png').save('icons/header/powerline.webp','WEBP',quality=82)"
```

Prüfen, dass die Datei existiert und plausibel groß ist (die vorhandenen Kopfbilder liegen im
zweistelligen KB-Bereich):

Run: `ls -l icons/header/powerline.webp`
Expected: eine Datei > 5 KB

> 🔧 **Owner, falls keines der drei Werkzeuge vorhanden ist:** Alle 31 bestehenden
> `icons/header/*.webp` stammen aus deiner `avesmaps-map-processing`-Pipeline. Dann bitte
> `Kraftlinien.png` dort konvertieren und als `icons/header/powerline.webp` ins Repo legen.
> **Bis die Datei existiert, ist Task 2 nicht fertig** — ohne sie zeigt der Kopf ein totes Bild.

- [ ] **Step 2: Die Infobox bauen**

In `js/map-features/map-features-powerlines.js` **vor** `createPowerlinePopupMarkup` (Zeile 163) einfügen:

```js
// Die beiden Enden als Gold-Links. Markup und Klick-Ziel sind exakt die des Weges
// (pathItemStationLinkMarkup, js/map-features/map-features-path-item-links.js:177) -- der Handler
// haengt global am document (js/routing/routing.js:741), Kraftlinien benutzen ihn einfach mit.
function powerlineSpanMarkup(powerline) {
	const span = getPowerlineSpanEndpointIds(powerline);
	if (!span) {
		return "";
	}
	const linkFor = (publicId) => {
		const entry = findLocationMarkerByPublicId(publicId);
		const name = String(entry?.name || "").trim();
		if (name === "") {
			return "";
		}
		return '<button type="button" class="location-popup__station-link" '
			+ `data-station-kind="location" data-station-ref="${escapeHtml(publicId)}">`
			+ `${escapeHtml(name)}</button>`;
	};
	const from = linkFor(span.fromPublicId);
	const to = linkFor(span.toPublicId);
	if (from === "" || to === "") {
		return "";
	}
	return `${from} ↔ ${to}`;
}

// Infobox der Kraftlinie -- gleiche .region-info-box-Huelle wie Weg/Region/Gebiet, damit sie
// Trenner, Breite und Padding der .settlement-popup-Styles erbt. Leere Zeilen fallen weg.
function powerlineInfoboxMarkup(powerline) {
	const row = (dtLabel, valueHtml) => {
		if (!valueHtml || String(valueHtml).trim() === "") {
			return "";
		}
		return `<div class="region-info-box__row"><dt>${escapeHtml(dtLabel)}</dt><dd>${valueHtml}</dd></div>`;
	};
	let rows = "";
	rows += row("Verbindet", powerlineSpanMarkup(powerline));
	rows += row("Beschreibung", escapeHtml(String(powerline?.properties?.description || "").trim()));
	// Multi-source system: die Zeile traegt den Wiki-Link UND die Katalog-Quellen, offizielle zuerst.
	const sourceMarkup = typeof renderFeatureSourceLine === "function"
		? renderFeatureSourceLine(
			"powerline",
			getPowerlinePublicId(powerline),
			String(powerline?.properties?.wiki_url || "").trim(),
			"location-popup__wiki-link"
		)
		: "";
	if (rows === "" && sourceMarkup === "") {
		return "";
	}
	return '<div class="region-info-box region-info-box--settlement">'
		+ `<dl class="region-info-box__data">${rows}</dl>`
		+ sourceMarkup
		+ "</div>";
}
```

- [ ] **Step 3: Kopfbild und Infobox ins Popup hängen**

In `createPowerlinePopupMarkup` (Zeile 163) den `locationPopupMarkup`-Aufruf ersetzen. Neu sind
`headerImageMarkup`, `showHeaderIcon: true` und das angehängte `+ powerlineInfoboxMarkup(powerline)`
hinter dem Aktionsband — genau die Stelle, an der der Weg seine Infobox anhängt
(`js/map-features/map-features-path-rendering.js:182`).

```js
function createPowerlinePopupMarkup(powerline) {
	const name = getPowerlineDisplayName(powerline);
	const typeLabel = tr("spotlight.type.powerline", "Kraftlinie");
	// 16:9-Kopfbild wie beim Weg. Ein Bild fuer alle Kraftlinien -- es gibt keine Subtypen.
	const headerImg = typeof infoHeaderImageMarkup === "function"
		? infoHeaderImageMarkup("powerline", name, typeLabel)
		: "";
	return locationPopupMarkup({
		name,
		locationType: "dorf",
		locationTypeLabel: typeLabel,
		headerImageMarkup: headerImg,
		showHeaderIcon: true,
		showDescription: false,
		showWikiLink: false,
		showType: true,
		actionsMarkup: (IS_EDIT_MODE ? locationPopupActionsMarkup([
			popupActionButtonMarkup({
				label: "Bearbeiten",
				attributes: {
					"data-popup-action": "edit-powerline-details",
					"data-public-id": getPowerlinePublicId(powerline),
				},
			}),
			popupActionButtonMarkup({
				label: "Kraftlinie löschen",
				className: "location-popup__action-button--danger",
				attributes: {
					"data-popup-action": "delete-powerline",
					"data-public-id": getPowerlinePublicId(powerline),
				},
			}),
		]) : "") + powerlineInfoboxMarkup(powerline),
	});
}
```

- [ ] **Step 4: Syntaxprüfung + Regressionstests**

Run: `node --check js/map-features/map-features-powerlines.js`
Expected: keine Ausgabe (Exit 0)

Run: `node js/map-features/__tests__/powerline-span.test.js && node js/map-features/__tests__/powerline-connected-endpoints.test.js`
Expected: beide „tests passed"

- [ ] **Step 5: Live prüfen**

`?edit=1` an die lokale Seite hängen, in den Modus „Kraftlinien" schalten, eine Linie der
Basiliuslinie anklicken. Erwartet: Kopfbild, Titel „Basiliuslinie", Untertitel „Kraftlinie",
Knöpfe „Bearbeiten"/„Kraftlinie löschen", darunter die Zeile **Verbindet** mit zwei Gold-Links.
Ein Klick auf einen Link fliegt zum Ort. Ein anderes Segment derselben Linie muss **dieselben**
zwei Enden nennen.

- [ ] **Step 6: Commit**

```bash
git add -- icons/header/powerline.webp js/map-features/map-features-powerlines.js
git commit --only -m "feat(kraftlinien): give the powerline popup a header image and an info box" -- icons/header/powerline.webp js/map-features/map-features-powerlines.js
```

---

### Task 3: `powerline` als `entity_type` im Quellensystem

Drei Zeilen. Kein neues Tabellending — die Regel steht in AGENTS.md §5.

**Files:**
- Modify: `api/app/feature-sources.php:33`
- Modify: `api/edit/map/feature-sources.php:49`
- Modify: `api/_internal/app/feature-sources.php:342`

**Interfaces:**
- Produces: `entity_type='powerline'` wird von Lese- und Schreib-Endpunkt akzeptiert; `avesmapsFeatureSourcesReadRevision` liefert für Kraftlinien die echte `map_features.revision`.

- [ ] **Step 1: Lese-Whitelist**

`api/app/feature-sources.php:33` — `'powerline'` ergänzen:

```php
    $allowedTypes = ['settlement', 'territory', 'region', 'path', 'citymap', 'lore', 'powerline'];
```

- [ ] **Step 2: Schreib-Whitelist**

`api/edit/map/feature-sources.php:49` — `'powerline'` ergänzen:

```php
    $allowedTypes = ['settlement', 'region', 'path', 'territory', 'citymap', 'lore', 'powerline'];
```

- [ ] **Step 3: Revision für das optimistische Sperren**

`api/_internal/app/feature-sources.php:342` — Kraftlinien **haben** eine `map_features.revision`;
ohne diesen Zusatz bekäme der Quellen-Editor `null` als Sperr-Token.

```php
    if (!in_array($entityType, ['settlement', 'region', 'path', 'powerline'], true)) {
        return null;
    }
```

> **Bewusst NICHT anfassen:** `api/_internal/app/feature-sources.php:124` und `:265` (Legacy
> `other_source`) sowie die `$entityTypeOf`-Abbildung bei `:819`. `other_source` ist das alte
> Einzelquellen-Feld von settlement/region/path; Kraftlinien haben es nie getragen — genau wie
> `citymap` und `lore` dort außen vor blieben.
>
> Ebenfalls **keine** Zeile nötig in `avesmapsFeatureSourcesReadWikiUrl` (`:352`): die Funktion
> behandelt nur `territory`, `lore` und `citymap` gesondert und liest für alles andere
> `map_features.properties.wiki_url` — für `powerline` also schon richtig.

- [ ] **Step 4: Syntaxprüfung**

Run: `php -l api/app/feature-sources.php && php -l api/edit/map/feature-sources.php && php -l api/_internal/app/feature-sources.php`
Expected: 3× „No syntax errors detected"

- [ ] **Step 5: Commit**

```bash
git add -- api/app/feature-sources.php api/edit/map/feature-sources.php api/_internal/app/feature-sources.php
git commit --only -m "feat(kraftlinien): admit powerline as one more source entity_type" -- api/app/feature-sources.php api/edit/map/feature-sources.php api/_internal/app/feature-sources.php
```

---

### Task 4: Beschreibung + Wiki-Link im Editor (inkl. Rate-Riegel)

**Files:**
- Modify: `index.html:1044-1053` (Formularfelder)
- Modify: `js/review/review-paths.js:96-116` (befüllen + Payload)
- Modify: `api/_internal/map/features.php:1422-1435` (speichern)
- Modify: `api/app/map-features.php:888` (Riegel)

**Interfaces:**
- Consumes: `avesmapsReadOptionalText` bzw. vorhandene Lese-Helfer in `api/_internal/map/features.php`
- Produces: `properties.description` (String), `properties.wiki_url` (String) auf powerline-Zeilen

- [ ] **Step 1: Die Felder ins Formular**

In `index.html` nach dem `show_label`-Feld (Zeile 1051–1052), **vor** `<p id="powerline-edit-status" …>`
einfügen. Sichtbar, nicht versteckt — siehe Spec §3.3: der Siedlungseditor hält genau diese zwei
Felder verborgen (`index.html:736-737`), und `location-edit-wiki-url` ist das Feld aus Discord #38,
das einen geratenen Wert durchs Speichern zu echten Daten machte.

```html
					<div class="location-report-form__field">
						<label for="powerline-edit-description">Beschreibung</label>
						<div class="location-edit-fieldrow"><textarea id="powerline-edit-description" name="description" rows="3" maxlength="2000"></textarea></div>
					</div>
					<div class="location-report-form__field">
						<label for="powerline-edit-wiki-url">Wiki-Link</label>
						<div class="location-edit-fieldrow"><input id="powerline-edit-wiki-url" name="wiki_url" type="url" maxlength="500" placeholder="https://de.wiki-aventurica.de/wiki/Basiliuslinie" /></div>
					</div>
```

- [ ] **Step 2: Dialog befüllen und Payload erweitern**

`js/review/review-paths.js` — in `populatePowerlineEditForm` nach Zeile 100 anhängen:

```js
	document.getElementById("powerline-edit-description").value = String(powerline.properties?.description || "").trim();
	document.getElementById("powerline-edit-wiki-url").value = String(powerline.properties?.wiki_url || "").trim();
```

und in `buildPowerlineEditPayload` (Zeile 109) die zwei Felder ergänzen:

```js
function buildPowerlineEditPayload(formElement) {
	const formData = new FormData(formElement);
	return {
		action: "update_powerline_details",
		public_id: String(formData.get("public_id") || "").trim(),
		name: String(formData.get("name") || "").trim(),
		show_label: formData.get("show_label") === "on",
		description: String(formData.get("description") || "").trim(),
		wiki_url: String(formData.get("wiki_url") || "").trim(),
	};
}
```

- [ ] **Step 3: Backend speichert die zwei Felder**

`api/_internal/map/features.php`, in `avesmapsUpdatePowerlineFeatureDetails`. Nach Zeile 1425
(`$showLabel = …`) lesen:

```php
    $description = trim((string) ($payload['description'] ?? ''));
    $wikiUrl = trim((string) ($payload['wiki_url'] ?? ''));
```

und nach Zeile 1435 (`$properties['show_label'] = $showLabel;`) schreiben:

```php
    $properties['description'] = $description;
    $properties['wiki_url'] = $wikiUrl;
```

Im Audit-Log-Aufruf (Zeile 1459 ff.) die beiden Felder mitführen, damit die Änderung nachvollziehbar
bleibt — direkt nach `'show_label' => $showLabel,`:

```php
            'description' => $description,
            'wiki_url' => $wikiUrl,
```

- [ ] **Step 4: Den Rate-Riegel setzen**

`api/app/map-features.php`, in `avesmapsEnrichMapFeatureWikiUrl` (Zeile 888). Direkt nach dem
frühen Ausstieg bei bereits gesetztem `wiki_url` (Zeile 889–891) einfügen:

```php
    // A powerline's wiki link is explicit or nothing. The name match below is built for places;
    // a powerline named like a settlement would silently inherit that settlement's article --
    // the Discord #38 class of bug, where a guessed link became real data on the next save.
    if ((string) ($row['feature_type'] ?? '') === 'powerline') {
        return $properties;
    }
```

- [ ] **Step 5: Syntaxprüfung**

Run: `php -l api/_internal/map/features.php && php -l api/app/map-features.php`
Expected: 2× „No syntax errors detected"

- [ ] **Step 6: Live prüfen**

Im Editor eine Kraftlinie öffnen, Beschreibung eintragen, speichern, Popup erneut öffnen.
Erwartet: die Zeile **Beschreibung** steht in der Infobox. Wiki-Link eintragen, speichern —
erwartet: die Quellenzeile zeigt „Wiki Aventurica ↗". Danach das Feld wieder leeren und speichern —
erwartet: der Link ist **weg und bleibt weg** (der Riegel setzt ihn nicht zurück).

- [ ] **Step 7: Commit**

```bash
git add -- index.html js/review/review-paths.js api/_internal/map/features.php api/app/map-features.php
git commit --only -m "feat(kraftlinien): editable description and an explicit-only wiki link" -- index.html js/review/review-paths.js api/_internal/map/features.php api/app/map-features.php
```

---

### Task 5: Quellen-Editor in den Dialog

**Files:**
- Modify: `index.html` (Container im Kraftlinien-Dialog)
- Modify: `js/review/review-paths.js` (Mount beim Öffnen)

**Interfaces:**
- Consumes: `mountFeatureSourceEditor(containerEl, entityType, publicIdGetter, opts)` (`js/review/review-feature-sources.js:205`)

- [ ] **Step 1: Container ins Formular**

In `index.html` im Kraftlinien-Dialog nach dem Wiki-Link-Feld aus Task 4, vor
`<p id="powerline-edit-status" …>`:

```html
					<div class="location-report-form__field">
						<label>Quellen</label>
						<div id="powerline-edit-sources"></div>
					</div>
```

- [ ] **Step 2: Beim Öffnen mounten**

`js/review/review-paths.js`, in `openPowerlineEditDialog` (Zeile 103) — nach `populatePowerlineEditForm(powerline);`:

```js
	if (typeof mountFeatureSourceEditor === "function") {
		mountFeatureSourceEditor(
			document.getElementById("powerline-edit-sources"),
			"powerline",
			() => document.getElementById("powerline-edit-public-id").value
		);
	}
```

- [ ] **Step 3: Syntaxprüfung**

Run: `node --check js/review/review-paths.js`
Expected: keine Ausgabe (Exit 0)

- [ ] **Step 4: Live prüfen**

Im Editor eine Kraftlinie öffnen. Erwartet: der Quellen-Block erscheint mit Autocomplete;
eine Quelle hinzufügen, speichern, Popup öffnen — die Quelle steht in der Quellenzeile,
offizielle zuerst. Gegenprobe: eine **Siedlung** und einen **Weg** öffnen und prüfen, dass deren
Quellen unverändert sind (der Whitelist-Zusatz darf nichts verschieben).

- [ ] **Step 5: Commit**

```bash
git add -- index.html js/review/review-paths.js
git commit --only -m "feat(kraftlinien): mount the shared source editor in the powerline dialog" -- index.html js/review/review-paths.js
```

---

### Task 6: Editor-Handbuch nachziehen

Editor-sichtbare Änderung → Handbuch im selben Zug (AGENTS.md §9). Das Handbuch ging schon einmal
in 13 Tagen von „geschrieben" zu „sachlich falsch", weil das niemandes Aufgabe war.

**Files:**
- Modify: `html/editor-handbuch.html`

- [ ] **Step 1: Die Fundstelle suchen**

Run: `grep -n "Kraftlinie" html/editor-handbuch.html`
Erwartet: der bestehende Kraftlinien-Abschnitt (Anlegen über zwei Nodix-Orte). Gibt es keinen,
den Abschnitt bei den übrigen Karten-Features einhängen.

- [ ] **Step 2: Den Abschnitt ergänzen**

Beschreiben, in Nutzersicht und auf Deutsch:
- Der Bearbeiten-Dialog hat jetzt **Beschreibung**, **Wiki-Link** und **Quellen**.
- Der Wiki-Link wird **ausdrücklich** gesetzt; leer heißt leer und wird nicht geraten.
- Die Infobox zeigt unter **Verbindet** die Enden der **ganzen** Linie, nicht des angeklickten
  Segments — deshalb sehen alle Segmente einer Linie dort dasselbe.
- Damit das stimmt, müssen gleichnamige Segmente **exakt gleich** heißen: ein Tippfehler
  („Elementare Hexagramm" statt „Elementares Hexagramm") zerlegt eine Linie in zwei.

- [ ] **Step 3: `Stand:`-Datum in der Kopfleiste auf `2026-07-22` setzen**

- [ ] **Step 4: Commit**

```bash
git add -- html/editor-handbuch.html
git commit --only -m "docs(handbuch): record the powerline description, wiki link and sources" -- html/editor-handbuch.html
```

---

## Abschluss

Nach Task 6 pushen und die Remote-SHA prüfen (CLAUDE.md):

```bash
git push origin master
git rev-parse --short HEAD && git rev-parse --short origin/master
```

Wird der Push abgelehnt: `git fetch origin` + `git rebase --autostash origin/master` + erneut
pushen. **Niemals force-pushen.**

Danach ~1–2 Minuten Deploy abwarten, dann live gegen die Abnahmeliste aus Spec §8 prüfen.
