# Anzeige-Menü (Auge) — Bauplan

> **Für agentische Arbeiter:** Entwurf ist `docs/superpowers/specs/2026-08-12-anzeige-menue-design.md`.
> Schritte tragen Kästchen (`- [ ]`).

**Ziel:** Ein Knopf mit Auge über dem Suchknopf klappt ein Menü auf, in dem Ortsklassen
und Kartenebenen einzeln ein- und ausgeblendet werden — im Frontend zehn Schalter, für
Editoren zusätzlich Seewege, Prüfen und Mapstil.

**Architektur:** Die Schalter **ziehen um**, sie werden nicht nachgebaut. Jede ID bleibt,
damit der gesamte vorhandene Sichtbarkeitspfad (`syncPathVisibility`, URL-Persistenz,
Edit-Modus-Aufdeckung) unberührt weiterläuft. Neu sind nur: ein Knopf, eine Menühülle,
ein Auf-/Zuklapper und ein Riegel, der Schalter ausgraut, die die aktuelle Ansicht
ohnehin sperrt.

**Werkzeug:** Vanilla JS ohne Bau-Schritt, jQuery 3.6 für die Bestandsaufrufe, Tests als
nacktes `node <datei>` mit `assert` (Muster: `js/app/__tests__/map-corner-actions.test.js`).

## Weltweite Regeln

- **Kein hartkodierter Farbwert, Radius, Abstand.** Alles aus `css/base/tokens.css`
  (AGENTS.md §12). Fehlt ein Wert, erst Token anlegen.
- **Sichtbare Änderungen gehen EINZELN live** (AGENTS.md §9). Jede Etappe: ein Commit,
  ein Push, der Blick des Owners — dann die nächste. Kein Bündel.
- **Nur eigene Pfade stagen.** Geteilter Arbeitsbaum; `git status` vor jedem `git add`,
  fremde Änderungen in Ruhe lassen.
- **Deutsch bleibt die Oberfläche.** Neue sichtbare Zeichenketten in die i18n-Tabelle,
  nicht in den Code kleben (AGENTS.md §8).
- 🔴 **`js/ui/map-layer-picker.js` wird nicht angefasst.**

---

## Dateien

| Datei | Art | Verantwortung |
|---|---|---|
| `index.html` | ändern | Umzug der Schalter; Knopf + Menühülle im Eckbund |
| `js/ui/map-display-menu.js` | **neu** | Auf-/Zuklappen, Bundhöhe, Riegel je Ansicht |
| `css/components/map-display-menu.css` | **neu** | nur, was dieses Menü von den Nachbarn unterscheidet |
| `css/styles.css` | ändern | ein `@import` |
| `css/components/legal-dialog.css` | ändern | `#map-display-button` in **beide** Selektorlisten |
| `js/map-features/map-features-labels.js` | ändern | Override auch im Frontend (1 Zeile) |
| `js/map-features/map-features-boundary-canvas-overlay.js` | ändern | dito (1 Zeile) |
| `js/map-features/map-features-display-mode.js` | ändern | `syncEditorDisplayTogglesToMode` gilt auch im Frontend |
| `js/app/visitor-tracking.js` | ändern | 💣 Delegationswurzel (siehe Falle 1) |
| `js/app/i18n-en.js` | ändern | die Zeichenketten |
| `js/app/__tests__/map-display-menu.test.js` | **neu** | Markup, Reihenfolge, Riegel |

## 💣 Zwei Fallen, die der Umzug still bricht

**Falle 1 — das Besucher-Tracking hängt an `.display-options`.**
`js/app/visitor-tracking.js:73` und `:78` delegieren von `.display-options` aus auf
`input[type=checkbox]` und `.location-toggle`. Ziehen die Schalter aus diesem Container
heraus, hört das Tracking lautlos auf — kein Fehler, keine Meldung, nur eine Statistik,
die ab einem Tag nichts mehr zählt.
⚠️ **Nicht** einfach auf `document` umstellen: `input[type=checkbox]` träfe dann auch
`#allowLand`, `#allowRiver` und jede andere Checkbox der Seite. Beide Wurzeln nennen.

**Falle 2 — die Zifferntasten zählen die DOM-Reihenfolge.**
`js/app/keyboard-shortcuts.js:290` nimmt `document.querySelectorAll(".location-toggle")`
und trifft mit `1`–`6` die n-te davon (Kommentar `:37–39`). Die sechs Knöpfe müssen in
**exakt derselben Reihenfolge** umziehen, und es darf **keinen siebten** irgendwo geben.

---

## Etappe 1 — Knopf, Menü, Ortsklassen ziehen um

**Sichtbares Ergebnis:** Über dem Suchknopf sitzt ein Auge. Es klappt ein Menü mit der
Gruppe „Orte" auf; die sechs Symbole wirken wie bisher. Der Routenplaner hat seine
Ortsklassen-Zeile nicht mehr.

**Dateien:** `index.html`, `js/ui/map-display-menu.js` (neu),
`css/components/map-display-menu.css` (neu), `css/styles.css`,
`css/components/legal-dialog.css`, `js/app/visitor-tracking.js`,
`js/app/__tests__/map-display-menu.test.js` (neu)

**Schnittstellen:**
- Nutzt: `syncMapCornerStack()` (`js/ui/ui-controls.js`) — misst den Bund nach.
- Liefert: `#map-display-button`, `#map-display-menu`, die Gruppe
  `#display-group-places`.

- [ ] **Schritt 1: Test schreiben, der beißt**

`js/app/__tests__/map-display-menu.test.js`:

```js
// Das Anzeige-Menue (Auge) in der Kartenecke.
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/map-display-menu.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const indexHtml = read("index.html");
const legalCss = read("css", "components", "legal-dialog.css");

function withoutComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

// ---- Der Knopf steht im Bund, und zwar UEBER dem Suchknopf -------------------------
// 💣 Faengt: jemand haengt ihn unten an. Die Reihenfolge im Bund IST die Anzeige.
const bund = indexHtml.match(/<div id="map-corner-actions">([\s\S]*?)\r?\n\t\t<\/div>/);
assert.ok(bund, "der Bund #map-corner-actions steht in index.html");
const displayAt = bund[1].indexOf('id="map-display-button"');
const searchAt = bund[1].indexOf('id="map-search-button"');
assert.ok(displayAt > -1, "der Anzeige-Knopf steht im Bund");
assert.ok(displayAt < searchAt, "und VOR dem Suchknopf -- oben in der Spalte");

// ---- Er traegt die GEMEINSAME Eckknopf-Regel, in BEIDEN Listen ----------------------
// 💣 Faengt: genau den Fehler, den die Ansichts-Kachel schon hatte -- in der Grundregel
// eingetragen, in der Hover-Regel vergessen, und der Knopf bleibt unter dem Zeiger stumm.
const cssOhneProsa = withoutComments(legalCss);
const grundregel = cssOhneProsa.match(/#map-search-button,[^{]*\{/);
assert.ok(grundregel, "die gemeinsame Eckknopf-Grundregel existiert");
assert.ok(/#map-display-button/.test(grundregel[0]), "der Anzeige-Knopf steht in der Grundregel");
const hoverRegel = cssOhneProsa.match(/#map-search-button:hover,[^{]*\{/);
assert.ok(hoverRegel, "die gemeinsame Hover-Regel existiert");
assert.ok(/#map-display-button:hover/.test(hoverRegel[0]), "der Anzeige-Knopf steht auch in der Hover-Regel");

// ---- Die sechs Ortsklassen sind UMGEZOGEN, nicht kopiert ----------------------------
// 💣 Faengt: jemand baut sie im Menue nach und laesst die alten stehen. Dann gibt es zwoelf,
// die Zifferntasten (keyboard-shortcuts.js zaehlt die DOM-Reihenfolge) treffen die falschen,
// und zwei Bedienelemente streiten sich um einen Zustand.
const alleToggles = indexHtml.match(/class="location-toggle"/g) || [];
assert.strictEqual(alleToggles.length, 6, "es gibt GENAU sechs .location-toggle im Dokument");

const menue = indexHtml.match(/<div id="map-display-menu"[\s\S]*?\r?\n\t\t\t<\/div>/);
assert.ok(menue, "die Menuehuelle #map-display-menu steht in index.html");
assert.strictEqual((menue[0].match(/class="location-toggle"/g) || []).length, 6,
	"und alle sechs stehen DARIN");

// 💣 Faengt: die Reihenfolge wird beim Umzug vertauscht. Die Zifferntasten 1..6 treffen
// die n-te im DOM (js/app/keyboard-shortcuts.js:290) -- eine Vertauschung legt stumm die
// Tastenbelegung um.
const reihenfolge = [...menue[0].matchAll(/data-location-type="([a-z]+)"/g)].map((m) => m[1]);
assert.deepStrictEqual(reihenfolge,
	["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"],
	"in unveraenderter Reihenfolge");

// ---- Das Besucher-Tracking zeigt auf den NEUEN Ort ----------------------------------
// 💣 Faengt: Falle 1. Die Delegation hing an .display-options; ohne diese Zeile hoert die
// Statistik lautlos auf zu zaehlen.
const tracking = withoutComments(read("js", "app", "visitor-tracking.js"));
assert.ok(/#map-display-menu/.test(tracking),
	"visitor-tracking.js delegiert auch vom Anzeige-Menue aus");

console.log("map-display-menu.test.js: alles gruen");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag sehen**

```bash
node js/app/__tests__/map-display-menu.test.js
```

Erwartet: FEHLER bei „der Anzeige-Knopf steht im Bund".

- [ ] **Schritt 3: Knopf und Menühülle in `index.html`**

In `#map-corner-actions`, **vor** `#map-search-button` (Kommentar mit Begründung davor,
wie bei den Nachbarn):

```html
<div id="map-display-menu" class="map-display-menu" role="group" aria-label="Anzeige" data-i18n-aria-label="display.menu.aria" hidden>
	<div class="map-display-menu__group" id="display-group-places">
		<p class="map-display-menu__title" data-i18n="display.group.places">Orte</p>
		<!-- die sechs .location-toggle-Knoepfe, unveraendert aus .display-options hierher -->
	</div>
</div>
<button type="button" id="map-display-button" class="map-display-menu__button" aria-haspopup="true" aria-expanded="false" title="Anzeige" data-i18n-title="display.menu.title" aria-label="Anzeige einstellen" data-i18n-aria-label="display.menu.aria">
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z"></path><circle cx="12" cy="12" r="2.8"></circle>
	</svg>
</button>
```

Die sechs `.location-toggle`-Knöpfe aus `.display-options` **ausschneiden** und in die
Gruppe einsetzen — Reihenfolge und Attribute unverändert. Die leere
`<div class="display-options__row">` fällt weg; `.display-options` bleibt mit der
versteckten Derographie-Zeile stehen.

- [ ] **Schritt 4: `#map-display-button` in `legal-dialog.css`**

In **beide** Selektorlisten eintragen — Grundregel (`#map-search-button, #map-layer-button,
#legal-button, #news-button`) und `:hover, :focus-visible`. Dazu die Maße wie beim
Suchknopf (48 × 48, zentriert, `svg` auf `--icon-lg`).

- [ ] **Schritt 5: `css/components/map-display-menu.css` anlegen**

Nur das Eigene: Menühülle (`--color-panel`, `--color-border-strong`, `--radius-sm`,
`--shadow-panel`, `padding: var(--space-10)`, Breite 232px), der Deckel
(`max-height: min(50vh, 420px)`, `overflow-y: auto`, `overscroll-behavior: contain`),
Gruppen-Trenner full-bleed, Überschrift in `--color-accent-strong`, die Symbolreihe.
`@import` in `css/styles.css` neben `map-layer-picker.css`.

- [ ] **Schritt 6: `js/ui/map-display-menu.js` anlegen**

Auf-/Zuklappen (`hidden` + `is-open`-Klasse mit Blende wie beim Nachbarn),
`syncMapCornerStack()` von Hand nach jedem Auf- und Zuklappen, Escape schließt mit
Fokus-Rückgabe, Klick aufs Dokument schließt. Einbinden in `index.html` **nach**
`ui-controls.js`.

💣 **Nur ein Menü offen:** vor dem Öffnen einen `document`-Klick auslösen bzw. das
Ansichts-Menü über seinen vorhandenen Dokument-Zuhörer schließen lassen — ohne Eingriff
in `map-layer-picker.js`.

- [ ] **Schritt 7: `visitor-tracking.js` — Falle 1 entschärfen**

Zeile 73 und 78: Wurzel von `.display-options` auf `.display-options, #map-display-menu`
erweitern. Kommentar dazu, warum **nicht** `document`.

- [ ] **Schritt 8: Test grün**

```bash
node js/app/__tests__/map-display-menu.test.js
node js/app/__tests__/map-corner-actions.test.js
node js/app/__tests__/keyboard-shortcuts.test.js
```

- [ ] **Schritt 9: Im Browser durchspielen** (nicht messen — bedienen)

Auge klicken → Menü fährt auf, Zoom rückt mit. Ein Ortssymbol klicken → die Marker
verschwinden auf der Karte. Zifferntaste `3` → Städte kippen. Routenplaner öffnen →
keine Lücke. Hell und dunkel.

- [ ] **Schritt 10: Commit + Push, dann Blick des Owners**

```bash
git add index.html js/ui/map-display-menu.js css/components/map-display-menu.css css/styles.css css/components/legal-dialog.css js/app/visitor-tracking.js js/app/__tests__/map-display-menu.test.js
git commit -m "feat(anzeige): die Ortsklassen ziehen in ein neues Auge-Menue an der Karte"
```

---

## Etappe 2 — Die vier Ebenen mit Auge-Schalter

**Sichtbares Ergebnis:** Unter „Orte" steht die Gruppe „Ebenen" mit Wege, Labels,
Grenzen, Flüsse. Jede Zeile trägt rechts ein Auge, das sich schließt. Alle vier wirken
im Frontend.

**Dateien:** `index.html`, `js/ui/map-display-menu.js`,
`css/components/map-display-menu.css`, `js/map-features/map-features-labels.js`,
`js/map-features/map-features-boundary-canvas-overlay.js`,
`js/map-features/map-features-display-mode.js`, Test

**Schnittstellen:**
- Nutzt: `#togglePaths`, `#toggleMapLabels`, `#toggleTerritoryBorders`, `#toggleRivers`
  (unveränderte IDs), `syncPathVisibility()`, `syncLabelVisibility()`.
- Liefert: `.map-display-menu__row` je Ebene mit `button.map-display-menu__eye`.

- [ ] **Schritt 1: Test erweitern**

Anhängen an `js/app/__tests__/map-display-menu.test.js`:

```js
// ---- Die vier Ebenen sind umgezogen und tragen je ein Auge --------------------------
// 💣 Faengt: eine Zeile wird im Menue nachgebaut statt umgezogen -- dann gibt es die
// Checkbox zweimal, und der Zustand haengt davon ab, welche zuletzt angefasst wurde.
["togglePaths", "toggleMapLabels", "toggleTerritoryBorders", "toggleRivers"].forEach((id) => {
	const alle = indexHtml.match(new RegExp(`id="${id}"`, "g")) || [];
	assert.strictEqual(alle.length, 1, `#${id} steht GENAU einmal im Dokument`);
	assert.ok(menue[0].includes(`id="${id}"`), `#${id} steht im Anzeige-Menue`);
});

// ---- Die zwei Overrides gelten jetzt auch im Frontend -------------------------------
// 💣 Faengt: der Umbau bleibt auf halbem Weg stehen. Die Haken waeren dann sichtbar,
// aendern aber ausserhalb des Editors nichts -- ein Schalter, der luegt.
const labelsJs = withoutComments(read("js", "map-features", "map-features-labels.js"));
const labelOverride = labelsJs.match(/function isMapLabelEditorOverrideActive\(\)[\s\S]*?\n\}/);
assert.ok(labelOverride, "isMapLabelEditorOverrideActive existiert");
assert.ok(!/IS_EDIT_MODE\s*\?/.test(labelOverride[0]),
	"und haengt den Haken NICHT mehr am Edit-Modus auf");

const boundaryJs = withoutComments(read("js", "map-features", "map-features-boundary-canvas-overlay.js"));
assert.ok(/const editorOverride = document\.getElementById\("toggleTerritoryBorders"\)/.test(boundaryJs),
	"der Grenzen-Haken wird ohne IS_EDIT_MODE-Vorbehalt gelesen");

// ---- Der Moduswechsel setzt Labels/Grenzen auch im Frontend ------------------------
// 💣 Faengt: §9 des Entwurfs kippt. Ohne diese Aenderung bliebe ein umgelegter Haken
// ueber den Ansichtswechsel stehen, obwohl "die Ansicht gewinnt" gilt.
const displayModeJs = withoutComments(read("js", "map-features", "map-features-display-mode.js"));
const syncFn = displayModeJs.match(/function syncEditorDisplayTogglesToMode\(mode\)[\s\S]*?\n\}/);
assert.ok(syncFn, "syncEditorDisplayTogglesToMode existiert");
assert.ok(!/IS_EDIT_MODE/.test(syncFn[0]),
	"und steigt im Frontend nicht mehr aus");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag sehen**

- [ ] **Schritt 3: Die vier Zeilen nach `index.html` umziehen**

Aus `.display-options__row--wrap` ausschneiden, als Gruppe „Ebenen" ins Menü:

```html
<div class="map-display-menu__group" id="display-group-layers">
	<p class="map-display-menu__title" data-i18n="display.group.layers">Ebenen</p>
	<div class="map-display-menu__row" id="togglePathsControl">
		<span class="map-display-menu__glyph" aria-hidden="true"><svg …></svg></span>
		<span class="map-display-menu__name" data-i18n="display.layer.paths">Wege</span>
		<input type="checkbox" id="togglePaths" class="map-display-menu__state" />
		<button type="button" class="map-display-menu__eye" aria-pressed="true"></button>
	</div>
	…
</div>
```

💣 **Die Checkbox bleibt — sie ist der Zustand.** Sie wird visuell verborgen
(`clip-path`/`sr-only`, **nicht** `display:none` — sonst verliert sie die
Formular-Semantik), und das Auge legt sie um. Damit bleiben
`$("#togglePaths").is(":checked")`, die URL-Persistenz und jeder Bestandsaufruf gültig.

⚠️ Die `id="…Control"`-Hüllen behalten ihre IDs: `map-features.js:67–74` deckt sie im
Edit-Modus über genau diese auf. Das `hidden` fällt bei den vier öffentlichen weg.

- [ ] **Schritt 4: Das Auge verdrahten** (in `map-display-menu.js`)

Klick aufs Auge → Checkbox umlegen → `change` auslösen (`bubbles: true`), damit die
Bestandsverdrahtung greift. `aria-pressed` und die `--off`-Klasse folgen dem
Checkbox-Zustand, nicht umgekehrt. Ein `change`-Zuhörer zeichnet die Zeile nach, damit
auch ein Moduswechsel oder ein geteilter Link die Augen richtig stellt.

- [ ] **Schritt 5: Die drei Bestandszeilen öffnen**

```js
// map-features-labels.js — isMapLabelEditorOverrideActive
return document.getElementById("toggleMapLabels")?.checked ?? null;
```
```js
// map-features-boundary-canvas-overlay.js
const editorOverride = document.getElementById("toggleTerritoryBorders")?.checked ?? null;
```
```js
// map-features-display-mode.js — syncEditorDisplayTogglesToMode: der IS_EDIT_MODE-Ausstieg faellt weg
```

⚠️ `?? null` bleibt tragend: fehlt das Element (fremde Seite, Teil-Deploy), ist der
Zustand weiter dreiwertig und die Ansicht entscheidet allein.

- [ ] **Schritt 6: Tests grün**

```bash
node js/app/__tests__/map-display-menu.test.js
node js/map-features/__tests__/layer-mode-defaults.test.js
```

`layer-mode-defaults.test.js` muss **unverändert** grün bleiben — er ist der Beleg für §9.

- [ ] **Schritt 7: Im Browser durchspielen**

Wege-Auge schließen → die Straßen verschwinden. Labels-Auge schließen → die
Beschriftungen gehen. Ansicht wechseln → die Augen springen auf die Vorgaben. Link mit
`?togglePaths=0` öffnen → das Wege-Auge ist zu.

- [ ] **Schritt 8: Commit + Push, Blick des Owners**

```bash
git commit -m "feat(anzeige): Wege, Labels, Grenzen und Fluesse lassen sich jetzt einzeln ausblenden"
```

---

## Etappe 3 — Der Riegel: was die Ansicht ohnehin sperrt, ist ausgegraut

**Sichtbares Ergebnis:** In *Kraftlinien* sind Orte, Wege, Flüsse und Grenzen ausgegraut
und sagen im Titel, warum. In *Nur Karte* und *Original* ist Grenzen ausgegraut.

**Dateien:** `js/ui/map-display-menu.js`, `css/components/map-display-menu.css`, Test

- [ ] **Schritt 1: Test schreiben**

```js
// ---- Der Riegel steht als TABELLE da, nicht als if-Kette ---------------------------
// 💣 Faengt: ein neuer Modus wird ergaenzt und hier vergessen -- genau der Fehler, der
// FRONTEND_LAYER_MODE_DEFAULTS 2026-08-05 zwei Ansichten erben liess.
const menueJs = withoutComments(read("js", "ui", "map-display-menu.js"));
["none", "original", "deregraphic", "political", "powerlines", "ecosystem"].forEach((modus) => {
	assert.ok(new RegExp(`\\b${modus}\\b`).test(menueJs),
		`der Riegel kennt die Ansicht "${modus}"`);
});

// 💣 Faengt: der Riegel wird einmal beim Bau gesetzt und friert ein. Ab dem naechsten
// Ansichtswechsel waere er gelogen -- derselbe Fehler wie bei der Transport-Combobox.
assert.ok(/mapLayerModeLabel|MutationObserver|syncDisplayMenuGates/.test(menueJs),
	"und wird bei JEDEM Ansichtswechsel neu gesetzt, nicht nur beim Aufbau");
```

- [ ] **Schritt 2: Fehlschlag sehen**

- [ ] **Schritt 3: Die Tabelle bauen** (`map-display-menu.js`)

```js
// 💣 EINE Tabelle, VOLLSTAENDIG. Ein Modus, der hier fehlt, erbt die Lage seines
// Vorgaengers -- genau der Fehler, den FRONTEND_LAYER_MODE_DEFAULTS schon einmal hatte.
// Ein Eintrag heisst: dieser Schalter kann in dieser Ansicht NICHTS bewirken.
var GESPERRT = {
	none:        { grenzen: "borders" },
	original:    { grenzen: "borders" },
	deregraphic: {},
	political:   {},
	// Magiersicht: shouldShowPathOnMap steigt vor jeder Haken-Pruefung aus,
	// shouldShowLocationMarker zeigt nur Nodices.
	powerlines:  { grenzen: "borders", wege: "powerlines", fluesse: "powerlines", orte: "powerlines" },
	ecosystem:   {}
};
```

Der Grund für „Grenzen": `TERRITORY_BOUNDARY_MODES = ["political","deregraphic","ecosystem"]`
in `map-features-political-territory-loader.js:18` — die Territoriumsdaten werden sonst
gar nicht geladen.

- [ ] **Schritt 4: Bei jedem Ansichtswechsel neu setzen**

Denselben Weg wie `map-layer-picker.js`: einen `MutationObserver` auf
`#mapLayerModeLabel` — die Beschriftung, die `syncTransportControl` bei **jedem** Wechsel
neu schreibt. Es gibt kein Ereignis für den Moduswechsel; `setSelectedMapLayerMode`
setzt den Wert per jQuery `.val()`, und das feuert nichts.

- [ ] **Schritt 5: Ausgegraut darstellen**

`--color-disabled-bg` / `-text` / `-border`, `cursor: not-allowed`, `aria-disabled`,
und der Titel nennt den Grund (`display.disabled.*`).

- [ ] **Schritt 6: Tests + im Browser durchspielen**

Auf *Kraftlinien* wechseln → vier Zeilen ausgegraut, Klick tut nichts, Titel erklärt es.
Zurück auf *Standard* → alle wieder bedienbar.

- [ ] **Schritt 7: Commit + Push, Blick des Owners**

```bash
git commit -m "fix(anzeige): Schalter, die eine Ansicht ohnehin sperrt, sind jetzt ausgegraut statt wirkungslos"
```

---

## Etappe 4 — Der Editor-Teil

**Sichtbares Ergebnis:** Editoren finden im selben Menü zusätzlich Seewege, die Gruppe
„Prüfen" und den Mapstil. Besucher sehen davon nichts.

**Dateien:** `index.html`, `css/components/map-display-menu.css`, Test

- [ ] **Schritt 1: Test schreiben**

```js
// ---- Die Editor-Gruppen haben eine eigene HUELLE, die mitversteckt ------------------
// 💣 Faengt: die Haken sind versteckt, die Ueberschrift nicht -- eine goldene Zeile ueber
// einer Trennlinie ueber nichts. Fuer editorChecks ist es geloest, fuer die zwei neuen nicht.
["display-group-seapaths", "display-group-checks", "display-group-mapstyle"].forEach((id) => {
	const huelle = indexHtml.match(new RegExp(`id="${id}"[^>]*>`));
	assert.ok(huelle, `die Gruppe #${id} existiert`);
	assert.ok(/\shidden(\s|>)/.test(huelle[0]), `und startet versteckt`);
});

// 💣 Faengt: der Mapstil wandert mit und behaelt seine .display-options__*-Klassen --
// er steht dann nicht mehr in den Anzeigeoptionen, traegt aber deren Regeln.
const mapstyle = indexHtml.match(/id="mapStyleControl"[^>]*>/);
assert.ok(mapstyle, "#mapStyleControl existiert");
assert.ok(!/display-options__/.test(mapstyle[0]),
	"und hat seine display-options-Klassen beim Umzug abgelegt");
```

- [ ] **Schritt 2: Fehlschlag sehen**

- [ ] **Schritt 3: Umziehen**

`#toggleSeaPathsControl` → Gruppe `#display-group-seapaths`.
`#editorChecksTitle` + `#editorChecks` → Gruppe `#display-group-checks`.
`#mapStyleControl` → Gruppe `#display-group-mapstyle`, Klassen ablegen.

⚠️ `bootstrap.js:343–368` und `map-features.js:67–78` bleiben **unverändert** — sie
finden alles per ID. Die drei neuen Hüllen brauchen je ein `removeAttribute("hidden")`
an derselben Stelle.

- [ ] **Schritt 4: Tests + im Editor durchspielen**

`?edit=1` → alle Gruppen da, Menü scrollt in sich, Suchknopf bleibt im Bild.
Ohne `?edit=1` → keine leere Überschrift, kein Trenner ins Nichts.

- [ ] **Schritt 5: Commit + Push, Blick des Owners**

```bash
git commit -m "feat(anzeige): Seewege, Pruefen und Mapstil stehen fuer Editoren im selben Menue"
```

---

## Etappe 5 — Sprache und Feinschliff

**Dateien:** `index.html`, `js/app/i18n-en.js`, `js/ui/map-display-menu.js`

- [ ] **Schritt 1: Test schreiben**

```js
// 💣 Faengt: eine deutsche Zeichenkette wird ins Markup geklebt statt in die Tabelle.
const i18n = read("js", "app", "i18n-en.js");
["display.menu.title", "display.menu.aria", "display.group.places", "display.group.layers",
 "display.group.checks", "display.group.mapstyle", "display.editorOnly",
 "display.layer.paths", "display.layer.labels", "display.layer.borders",
 "display.layer.rivers", "display.layer.seapaths"].forEach((key) => {
	assert.ok(new RegExp(`"${key.replace(/\./g, "\\.")}"\\s*:`).test(i18n),
		`der i18n-Schluessel ${key} ist auf Englisch hinterlegt`);
	assert.ok(indexHtml.includes(key) || read("js", "ui", "map-display-menu.js").includes(key),
		`und wird auch benutzt`);
});
```

- [ ] **Schritt 2–4: Schlüssel eintragen, Tests grün, im Browser mit `?lang=en` prüfen**

- [ ] **Schritt 5: Der ganze Ablauf aus Entwurf §14, alle neun Punkte, hell und dunkel**

- [ ] **Schritt 6: Commit + Push**

```bash
git commit -m "chore(anzeige): die Beschriftungen des Auge-Menues stehen in der Sprachtabelle"
```

---

## Selbstprüfung gegen den Entwurf

| Entwurf | Etappe |
|---|---|
| §4 Schalterliste (öffentlich) | 1 (Orte), 2 (Ebenen) |
| §4 Schalterliste (Editor) | 4 |
| §5 Variante B, Orte unverändert | 1, 2 |
| §6 Umzug statt Nachbau | 1, 2, 4 — je ein Test „GENAU einmal im Dokument" |
| §6 `.display-options` bleibt als Hülle | 1, Schritt 3 |
| §7 Bund, Fluss, Deckel, nur ein Menü | 1 |
| §8 Riegel je Ansicht | 3 |
| §9 Ansicht gewinnt + die Lücke | 2, Schritt 5 |
| §10 Riegel, Gruppen-Hüllen | 4 |
| §11 gemeinsame Eckknopf-Regel, beide Listen | 1, Schritt 4 + Test |
| §12 Sprache | 5 |
| §13 Tastatur (kein neues Kürzel) | — bewusst nichts zu tun |
| §14 Abnahme-Ablauf | 5, Schritt 5 |
| Falle 1 Tracking | 1, Schritt 7 |
| Falle 2 DOM-Reihenfolge | 1, Test |
