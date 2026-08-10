# Das Frontend am Telefon — Bauplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Avesmaps-Frontend am Telefon bedienbar machen — Fingermaße, Panels in voller Höhe, ein erreichbarer Sucheinstieg, treffbare Orte, Namen und Wege — ohne am Zeiger ein einziges Pixel zu verschieben.

**Architecture:** Eine **Maßschicht aus Token** in `css/base/tokens.css`, die ein einziger `@media (pointer: coarse)`-Block anhebt; die Komponenten lesen die Token, statt Werte zu tragen. Dazu vier punktuelle Eingriffe im JS (schwebende Box, Zoom/Suche, klickbare Ortsnamen, Trefferflächen). Kein Bundler, kein Framework — die Dateien werden direkt ausgeliefert.

**Tech Stack:** Vanilla JS, Leaflet 1.9.4, jQuery 3.6.0, CSS Custom Properties. Tests: `node <pfad>.test.js` (Node-`assert`, **Quelltext lesend** — die Module hängen an Leaflet/`window` und sind nicht ladbar).

**Entwurf:** [`docs/superpowers/specs/2026-08-10-mobile-frontend-design.md`](../specs/2026-08-10-mobile-frontend-design.md) · **Mockup:** [`docs/mobile-frontend-mockup.html`](../../mobile-frontend-mockup.html)

---

## Global Constraints

Diese gelten für **jede** Aufgabe, ohne dass sie dort wiederholt werden:

1. 🔴 **Am Zeiger darf sich nichts ändern.** Jede neue Regel steht in `@media (pointer: coarse)` oder in einer Zoom-Bedingung. Abnahme jeder Aufgabe schließt ein: Desktop 1280 × 800 unverändert. Der Grund ist gemessen — die engen Steuerhöhen sind ein gegen Panel-Überlauf gerechnetes Budget (`css/features/route-planner.css:339`).
2. 🔴 **Kein Wert von Hand.** Farbe, Radius, Abstand, Steuerhöhe, Schriftgröße kommen aus `css/base/tokens.css`. Fehlt ein Token, wird es zuerst angelegt (AGENTS.md §12).
3. 🔴 **Nur eigene Pfade stagen.** Der Checkout ist geteilt, andere Sitzungen haben gleichzeitig unfertige Arbeit darin. Niemals `git add -A`, `git add .` oder `git commit -a`. Immer `git status` zuerst, dann `git commit -m "…" -- <pfad> <pfad>`.
4. **Umfang ist das Frontend.** `css/pages/*`, `edit/`, `html/*-editor.html` bleiben unberührt. Eine `pointer: coarse`-Regel greift auf einem Tablet auch im Editor — hingenommen, nicht Gegenstand der Abnahme.
5. **Fremddateien nie ändern.** `css/third-party/*`, `js/third-party/*` werden überschrieben, nicht bearbeitet.
6. **`ASSET_VERSION` wird nicht angefasst.** Das betrifft nur dynamisch geladene Editor-Dateien (AGENTS.md §7); alles hier stempelt der Deploy.
7. **Tests lesen Quelltext und müssen Kommentare herausschneiden.** In diesem Repo haben schon vier Zusicherungen auf die erklärende Prosa angeschlagen statt auf den Code. Jeder neue Test benutzt `withoutComments()` (Vorlage: `js/app/__tests__/map-corner-actions.test.js:24`).
8. **Commit-Präfixe:** `feat/fix/refactor/docs/perf` plus das hauseigene `ui:`. Editor-sichtbare Änderungen nennen ihre Wirkung im Betreff; das Handbuch wird **nicht** angefasst (nächtliche Routine, AGENTS.md §9).

**Zwei Zahlen, die überall gleich heißen:**

| Token | Wert am Zeiger | Wert am Finger |
|---|---|---|
| `--font-size-control` | `var(--font-size-small)` = 12 px | **16 px** (iOS-Schwelle, kein Richtwert) |
| `--tap-min` | `auto` | **44 px** |

---

## File Structure

| Datei | Verantwortung | Aufgabe |
|---|---|---|
| `css/base/tokens.css` | **die Maßschicht** — alle neuen Token + der eine `pointer: coarse`-Block | 1, 2, 4 |
| `css/features/route-planner.css` | Steuerhöhen/Schriften des Planers lesen Token statt Literale | 1, 4 |
| `css/layout/map-layout.css` | `#search` volle Höhe + Gassenformel; Zoom am Finger aus | 2, 5 |
| `css/features/infopanel.css` | Infopanel volle Höhe + Gassenformel | 2 |
| `css/components/legal-dialog.css` | Eckbund: Knopf-Abschluss, `--tap-min`, Suchknopf | 5, 9 |
| `css/features/map-labels.css` | Ortsnamen klickbar | 6 |
| `js/map-features/map-features-location-marker-entry.js` | schwebende Box nur, wenn Platz ist | 3 |
| `js/map-features/map-features-location-name-labels.js` | Label-Marker interaktiv + Klickpfad | 6 |
| `js/map-features/map-features-location-canvas-layer.js` | **ein** Trefferradius-Ausdruck mit Boden | 7 |
| `js/map-features/map-features-path-rendering.js` | unsichtbare Trefflinie ab Zoom 4 | 8 |
| `js/config.js` | `AVESMAPS_PATH_HIT_*`-Konstanten neben `PATH_WIDTH_SCALE` | 8 |
| `js/app/bootstrap.js` | Suchknopf verdrahten | 5 |
| `css/components/spotlight-search.css` | Suchfenster am Finger unten verankert | 5 |
| `js/ui/spotlight-search.js` | Feld ueber der Bildschirmtastatur halten | 5 |
| `index.html` | Suchknopf im Bund | 5 |
| `js/app/__tests__/touch-scale.test.js` | **neu** — Zusicherungen 1–4, 9 des Entwurfs | 1, 2, 4, 9 |
| `js/map-features/__tests__/hit-targets.test.js` | **neu** — Zusicherungen 5–8 des Entwurfs | 3, 6, 7, 8 |

**Warum zwei Testdateien und nicht neun:** sie schneiden nach Thema, nicht nach Aufgabe — Maße/Abschlüsse gegen Trefferflächen. Jede Aufgabe hängt ihren Block an die passende Datei an. Neun Dateien mit je drei Zeilen wären neun Stellen, an denen man beim nächsten Mal nachsehen muss.

**Reihenfolge ist bindend.** Aufgabe 4 (Höhen) **muss** nach Aufgabe 2 (Panelhöhe) kommen, sonst wächst der Planer von 766 px auf über 1.000 px in einem 640-px-Schirm. Aufgabe 7 **muss** nach Aufgabe 6 kommen, sonst wird der Trefferboden gegen eine Karte gemessen, auf der das Label noch nicht hilft.

---

## Task 1: A1 — Die iOS-Schwelle

Der kleinste Handgriff mit der größten Wirkung, und der einzige, der nicht auf Aufgabe 2 wartet: Schrift wächst nach innen und rührt das Höhenbudget nicht an.

**Files:**
- Modify: `css/base/tokens.css` (Token-Block bei `--font-size-*`, Zeile ~17–23; neuer Medienblock am Dateiende vor dem Dark-Theme-Block)
- Modify: `css/features/route-planner.css:83` (`.waypoint-input`), `:611` (`.route-planner-options-panel input[type="number"], select`), `:658` (`.display-options__row …`)
- Test: `js/app/__tests__/touch-scale.test.js` (**neu**)

**Interfaces:**
- Produces: `--font-size-control` (CSS-Custom-Property auf `:root`), gelesen von Aufgabe 4.
- Consumes: nichts.

- [ ] **Step 1: Den Test schreiben**

`js/app/__tests__/touch-scale.test.js`:

```js
// Die Massschicht: ein Ort fuer Steuermasse, und die iOS-Schwelle.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/touch-scale.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/** 💣 In diesen Dateien erklaert die Prosa genau das, wonach gesucht wird -- ein Treffer im
 *  Kommentar ist kein Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen, der
 *  nichts haelt. Vier Zusicherungen in diesem Repo sind schon darauf hereingefallen. */
function withoutComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const tokens = withoutComments(read("css", "base", "tokens.css"));
const planner = withoutComments(read("css", "features", "route-planner.css"));
const indexHtml = withoutComments(read("index.html"));

// ---- Der EINE Finger-Block --------------------------------------------------------------------
const coarseBlocks = tokens.match(/@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\n\}/g) || [];
assert.strictEqual(coarseBlocks.length, 1,
	"tokens.css traegt GENAU EINEN (pointer: coarse)-Block -- zwei waeren zwei Wahrheiten");
const coarse = coarseBlocks[0];

// ---- Die iOS-Schwelle: der WERT, nicht die blosse Anwesenheit ----------------------------------
const controlFont = coarse.match(/--font-size-control:\s*([0-9.]+)px/);
assert.ok(controlFont, "der Finger-Block setzt --font-size-control");
assert.ok(Number(controlFont[1]) >= 16,
	`--font-size-control ist am Finger ${controlFont[1]}px -- unter 16 zoomt iOS beim Fokus und kehrt nicht zurueck`);

// ---- Kein Feld schreibt daneben seine eigene Schrift --------------------------------------------
// ⚠️ `.waypoint-input` steht NICHT in dieser Liste: seine Klassenregel gewinnt nachweislich
// nicht (gemessen 13,33px statt der 15px, die dort stehen). Es wird stattdessen unten geprueft.
const FELD_REGELN = [".route-planner-options-panel input", ".display-options__row"];
FELD_REGELN.forEach((selector) => {
	const rule = planner.match(new RegExp(escapeRe(selector) + "[^{]*\\{([^}]*)\\}"));
	assert.ok(rule, `Regel fuer ${selector} gefunden`);
	const font = rule[1].match(/font-size:\s*([^;]+);/);
	assert.ok(font, `${selector} setzt eine Schriftgroesse`);
	assert.ok(/var\(--font-size-control\)/.test(font[1]),
		`${selector} liest --font-size-control statt "${font[1].trim()}" -- ein Literal hier schlaegt`
		+ " den Basisselektor (0,1,0 gegen 0,0,1) und die Schwelle bliebe wirkungslos");
});

// ---- Das Wegpunktfeld: die eine Ausnahme, und sie muss am Finger greifen ------------------------
const wegpunktRegel = planner.match(/@media\s*\(pointer:\s*coarse\)\s*\{[^}]*input\.waypoint-input\s*\{([^}]*)\}/);
assert.ok(wegpunktRegel,
	"route-planner.css traegt eine (pointer: coarse)-Regel fuer `input.waypoint-input`"
	+ " -- mit blossem `.waypoint-input` bliebe die Schwelle dort wirkungslos (live gemessen)");
assert.ok(/var\(--font-size-control\)/.test(wegpunktRegel[1]),
	"und sie liest den Token");
assert.ok(/\.waypoint-input\s*\{[^}]*font-size:\s*15px/.test(planner),
	"die alte 15px-Regel bleibt unangetastet -- sie gewinnt heute ohnehin nicht, und sie zu aendern"
	+ " koennte den Zeiger verschieben, falls die Kaskade dort einmal repariert wird");

// ---- Der falsche Fix darf nicht nachwachsen -----------------------------------------------------
const viewport = indexHtml.match(/<meta\s+name="viewport"[^>]*>/);
assert.ok(viewport, "index.html traegt ein Viewport-Meta");
assert.ok(!/maximum-scale|user-scalable/.test(viewport[0]),
	"das Viewport-Meta sperrt das Aufziehen NICHT -- das naehme allen die Zoomgeste, und iOS ignoriert es ohnehin");

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

console.log("touch-scale tests passed");
```

- [ ] **Step 2: Laufen lassen — muss rot sein**

Run: `node js/app/__tests__/touch-scale.test.js`
Expected: `AssertionError: tokens.css traegt GENAU EINEN (pointer: coarse)-Block` (gefunden: 0)

- [ ] **Step 3: Das Token anlegen**

In `css/base/tokens.css`, direkt nach `--font-size-display: 22px;`:

```css
	/* Schriftgroesse der BEDIENELEMENTE (Felder, Selects, Comboboxen) -- getrennt von der
	   Lese-Skala, weil sie am Finger auf die iOS-Schwelle springt (siehe der (pointer: coarse)-
	   Block am Dateiende). Am Zeiger unveraendert das, was die Felder heute tragen. */
	--font-size-control: var(--font-size-small);
```

- [ ] **Step 4: Den Finger-Block anlegen**

In `css/base/tokens.css`, **nach** dem schliessenden `}` des `:root`-Blocks und **vor** `:root[data-theme="dark"]`:

```css
/* ═══════════════════════════════════════════════════════════════════════════════════════════
   DIE MASSSCHICHT AM FINGER — der EINE Ort, an dem Bedienmasse fuer grobe Zeiger stehen.
   💣 Es darf genau einen solchen Block geben (touch-scale.test.js haelt die Zahl fest). Ein
   zweiter waere eine zweite Wahrheit, und die faende man erst, wenn sie auseinanderlaufen.
   ⚠️ `pointer: coarse` meint den PRIMAEREN Zeiger: ein Laptop mit Touchscreen und Maus meldet
   `fine` und bleibt unberuehrt. Genau das ist gewollt -- die engen Steuerhoehen des Planers
   sind gegen Panel-Ueberlauf gerechnet (route-planner.css:339).
   ═══════════════════════════════════════════════════════════════════════════════════════════ */
@media (pointer: coarse) {
	:root {
		/* 🔴 16 ist eine SCHWELLE, kein Richtwert: 15,5px zoomt. Darunter faehrt Safari beim
		   Fokus in jedes Feld hinein und kehrt nicht zurueck -- bei jeder einzelnen Eingabe. */
		--font-size-control: 16px;
	}
}
```

- [ ] **Step 5: Die drei Feldregeln auf das Token stellen**

🔴 **`.waypoint-input` (Zeile ~83) bleibt unangetastet.** Die 15 px dort gewinnen heute nicht —
das Feld rendert 13,33 px —, und die Regel zu ändern könnte den Zeiger verschieben, falls die
Kaskade dort einmal repariert wird. Stattdessen kommt eine eigene Regel dazu.

💣 **Warum eine zweite Regel nötig ist.** Am 10.08. live gemessen: das
Wegpunktfeld rendert **13,33 px**, nicht die 15 px seiner eigenen Regel — an `.waypoint-input`
(0,1,0) gewinnt etwas anderes. Nachgewiesen durch Einspritzen, nicht durch Lesen der Kaskade:

| eingespritzte Regel | Wirkung |
|---|---|
| `.waypoint-input { font-size: 16px }` | **keine** — bleibt 13,33 px |
| `input.waypoint-input { font-size: 16px }` | **16 px** |
| `#search .waypoint-input { font-size: 16px }` | 16 px |

Deshalb am Ende von `css/features/route-planner.css`:

```css
/* 💣 Die EINE Ausnahme von "Masse stehen in tokens.css, Komponenten lesen sie nur".
   Zwei Gruende, beide gemessen am 10.08.2026:
   (1) `input.waypoint-input`, nicht `.waypoint-input` -- die Klassenregel weiter oben verliert.
       Nachgewiesen durch Einspritzen beider Fassungen in die laufende Seite: die Klasse allein
       bewegt nichts (bleibt 13,33px), Element+Klasse setzt sich durch (16px). Ohne die hoehere
       Spezifitaet bliebe die iOS-Schwelle am wichtigsten Feld des Planers wirkungslos, lautlos.
   (2) Deshalb NUR am groben Zeiger. Eine Regel, die auch am Zeiger gewinnt, verschoebe das Feld
       dort von 13,33px auf 12px -- eine sichtbare Desktop-Aenderung, und die ist verboten
       (Randbedingung 1). So bleibt der Zeiger auf den Pixel, wie er war.
   🔧 WARUM die Klassenregel verliert, ist offen: die CSSOM des Pruef-Browsers meldete GAR keine
   passende Regel, obwohl die ausgelieferte Datei sie enthaelt. Fuer diese Aufgabe ist das egal --
   die Wirkung ist gemessen. Wer es aufklaert, darf diese Regel gegen eine saubere tauschen. */
@media (pointer: coarse) {
	input.waypoint-input {
		font-size: var(--font-size-control);
	}
}
```

⚠️ **Abnahme ist die Messung, nicht der Augenschein:** danach zeigt das Feld am Zeiger
**13,33 px** (unverändert) und am groben Zeiger **16 px**.

In `.route-planner-options-panel input[type="number"], .route-planner-options-panel select` (Zeile ~611) **nach** `font: inherit;` ergänzen:

```css
	/* Nach `font: inherit`, nicht davor: die Kurzform setzt font-size mit und wuerde diese Zeile
	   sonst ueberschreiben. Ohne sie erben die Felder die 12px der umgebenden Zeile. */
	font-size: var(--font-size-control);
```

In `.display-options__row, .display-options__select-row, .transport-filter-label` (Zeile ~658) `font-size: 12px;` ersetzen durch:

```css
	font-size: var(--font-size-control);
```

- [ ] **Step 6: Laufen lassen — muss grün sein**

Run: `node js/app/__tests__/touch-scale.test.js`
Expected: `touch-scale tests passed`

- [ ] **Step 7: Gegenprobe am Zeiger**

Browser 1280 × 800 öffnen (`index.html`), Routenplaner ansehen. In der Konsole:

```js
getComputedStyle(document.querySelector('.waypoint-input')).fontSize
```

Expected: `"12px"` — der Zeiger sieht die Schwelle nicht. ⚠️ Ist es `15px`, wurde `--font-size-control` falsch definiert (es soll am Zeiger `--font-size-small` sein, nicht die alte 15).

- [ ] **Step 8: Commit**

```bash
git status
git commit -m "fix(mobil): Eingabefelder springen am Finger auf 16px -- iOS zoomt sonst bei jeder Eingabe" -- css/base/tokens.css css/features/route-planner.css js/app/__tests__/touch-scale.test.js
```

---

## Task 2: Block 0.1 + 0.2 — Panels in voller Höhe, Gasse aus der Lasche

**Files:**
- Modify: `css/base/tokens.css` (neue Token `--avesmaps-tab-w`, `--avesmaps-panel-gutter`)
- Modify: `css/layout/map-layout.css:11-29` (`#search`), `:49-57` (Medienblock)
- Modify: `css/features/infopanel.css:12-14` (`--avesmaps-ip-w`), `:21-36` (`.avesmaps-infopanel`)
- Test: `js/app/__tests__/touch-scale.test.js` (anhängen)

**Interfaces:**
- Consumes: nichts aus Aufgabe 1.
- Produces: `--avesmaps-panel-gutter` (= `calc(var(--avesmaps-tab-w) + var(--space-12))` = 44 px), gelesen von beiden Panelbreiten.

- [ ] **Step 1: Den Test anhängen**

An das Ende von `js/app/__tests__/touch-scale.test.js`, **vor** `console.log`:

```js
// ---- Die Gasse: EINE Zahl, und ABGELEITET ------------------------------------------------------
const layout = withoutComments(read("css", "layout", "map-layout.css"));
const infopanel = withoutComments(read("css", "features", "infopanel.css"));

const gutter = tokens.match(/--avesmaps-panel-gutter:\s*([^;]+);/);
assert.ok(gutter, "tokens.css definiert --avesmaps-panel-gutter");
assert.ok(/var\(--avesmaps-tab-w\)/.test(gutter[1]),
	"die Gasse rechnet sich aus der LASCHENBREITE, nicht aus einer freien Zahl -- sonst kann sie"
	+ " jederzeit wieder unter 30px rutschen und die Lasche anschneiden");

[["map-layout.css", layout], ["infopanel.css", infopanel]].forEach(([name, css]) => {
	assert.ok(!/100vw\s*-\s*\d+px/.test(css),
		`${name} rechnet die Gasse NICHT von Hand (100vw - Npx) -- sie liest --avesmaps-panel-gutter`);
});
assert.ok(/var\(--avesmaps-panel-gutter\)/.test(layout), "#search liest die Gasse");
assert.ok(/var\(--avesmaps-panel-gutter\)/.test(infopanel), "das Infopanel liest die Gasse");

// ---- 140dvh kommt nicht zurueck -----------------------------------------------------------------
const schmal = layout.match(/@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\n\}/);
assert.ok(schmal, "map-layout.css hat den Schmal-Block");
const maxH = schmal[0].match(/#search[^{]*\{[^}]*max-height:\s*([^;]+);/);
if (maxH) {
	assert.ok(!/1[0-9]{2}dvh/.test(maxH[1]),
		`#search traegt am Telefon max-height ${maxH[1].trim()} -- ueber 100dvh greift die Grenze nie,`
		+ " das Panel scrollt nicht und stattdessen scrollt die SEITE (die Karte faehrt weg)");
}
assert.ok(/#search\s*\{[^}]*height:\s*100dvh/.test(schmal[0]),
	"#search laeuft am Telefon ueber die volle Hoehe -- daran haengt, dass sein overflow-y greift");
```

- [ ] **Step 2: Laufen lassen — muss rot sein**

Run: `node js/app/__tests__/touch-scale.test.js`
Expected: `AssertionError: tokens.css definiert --avesmaps-panel-gutter`

- [ ] **Step 3: Die Token anlegen**

`css/base/tokens.css`, im `:root`-Block bei den Abständen (nach `--space-24`):

```css
	/* Die Randlasche der beiden Panels (Routenplaner links, Info rechts) und die Gasse, die ein
	   offenes Panel ihr stehen lassen muss.
	   💣 Die Gasse ist ABGELEITET, nicht gewaehlt. Als freie Zahl war sie schon einmal so gross,
	   dass von der 30px-Lasche des Planers auf einem 360er Schirm 10px im Bild standen. Aus der
	   Laschenbreite gerechnet kann sie diesen Fehler nicht mehr annehmen. */
	--avesmaps-tab-w: 30px;
	--avesmaps-panel-gutter: calc(var(--avesmaps-tab-w) + var(--space-12));
```

- [ ] **Step 4: `#search` umstellen**

`css/layout/map-layout.css` — in `#search` (Zeile ~15) `width: 350px;` ersetzen durch:

```css
	width: min(350px, calc(100vw - var(--avesmaps-panel-gutter)));
```

Den Medienblock (Zeile ~49) ersetzen durch:

```css
/* Am Telefon laeuft der Planer von Kante zu Kante und scrollt IN SICH.
   💣 Vorher stand hier `max-height: calc(140dvh - 20px)`. 140dvh ist mehr als der Schirm -- die
   Grenze griff nie, das Panel scrollte nicht, und stattdessen scrollte die SEITE: gemessen auf
   360x640 ragten 136px unter den Rand und die Karte fuhr weg. `#search` traegt bereits
   `overflow-y: auto`; es fehlte nur eine Hoehe, an der das greift. */
@media (max-width: 640px) {
	#search {
		top: 0;
		height: 100dvh;
		max-height: none;
	}

	#overview {
		max-height: calc(100dvh - 320px);
	}
}
```

- [ ] **Step 5: Das Infopanel umstellen**

`css/features/infopanel.css` — in `.avesmaps-infopanel-mode` (Zeile ~13):

```css
	--avesmaps-ip-w: min(400px, calc(100vw - var(--avesmaps-panel-gutter)));
```

Am Ende der Datei anfügen:

```css
/* Am Telefon randlos in der Hoehe -- dieselbe Regel wie beim Planer, aus demselben Grund. */
@media (max-width: 640px) {
	.avesmaps-infopanel {
		top: 0;
		bottom: 0;
	}
}
```

- [ ] **Step 6: Laufen lassen — muss grün sein**

Run: `node js/app/__tests__/touch-scale.test.js`
Expected: `touch-scale tests passed`

- [ ] **Step 7: Am Gerätemaß nachmessen**

Browser auf 360 × 640 stellen, `index.html` laden, Routenplaner über die Lasche öffnen, fünf Wegpunkte eintragen, beide Optionsgruppen aufklappen. In der Konsole:

```js
const s = document.getElementById('search'), t = document.getElementById('toggle-button');
({ panelBreite: Math.round(s.getBoundingClientRect().width),
   panelScrollt: s.scrollHeight > s.clientHeight,
   seiteScrollt: document.documentElement.scrollHeight > innerHeight,
   lascheSichtbar: Math.round(Math.min(t.getBoundingClientRect().right, innerWidth) - t.getBoundingClientRect().left) })
```

Expected: `{ panelBreite: 316, panelScrollt: true, seiteScrollt: false, lascheSichtbar: 30 }`

⚠️ Ist `seiteScrollt: true`, greift die Höhe nicht — dann steht irgendwo noch eine `max-height` mit höherer Spezifität.

- [ ] **Step 8: Commit**

```bash
git status
git commit -m "ui(mobil): Panels laufen am Telefon ueber die volle Hoehe und lassen der Lasche ihre Gasse" -- css/base/tokens.css css/layout/map-layout.css css/features/infopanel.css js/app/__tests__/touch-scale.test.js
```

---

## Task 3: Block 0.3 — Die schwebende Box entfällt am Telefon

**Files:**
- Modify: `js/map-features/map-features-location-marker-entry.js:228` und `:239-240`
- Test: `js/map-features/__tests__/hit-targets.test.js` (**neu**)

**Interfaces:**
- Consumes: `avesmapsIsPhoneViewport()` aus `js/app/runtime-state.js:244` — Signatur `() => boolean`.
- Produces: nichts.

- [ ] **Step 1: Den Test schreiben**

`js/map-features/__tests__/hit-targets.test.js`:

```js
// Trefferflaechen und Antwortflaechen: was ein Finger anfassen kann, und wo genau EINE Flaeche
// antwortet statt zweier.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/map-features/__tests__/hit-targets.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

function withoutComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const markerEntry = withoutComments(read("js", "map-features", "map-features-location-marker-entry.js"));
const lookup = withoutComments(read("js", "map-features", "map-features-location-lookup.js"));

// ---- Die schwebende Box hat ZWEI Aufrufer, und nur einer wird still -----------------------------
//
// 🔴 Der Riegel gehoert AUSSCHLIESSLICH in marker-entry: dort ist die Box ein Doppel zum
// Infopanel. In location-lookup ("naechster Ort") ist dieselbe Box die EINZIGE Antwortflaeche --
// ein Riegel dort naehme dem Werkzeug seine Ausgabe.
assert.ok(/avesmapsIsPhoneViewport\s*\(\s*\)/.test(markerEntry),
	"marker-entry fragt avesmapsIsPhoneViewport, bevor es die schwebende Box oeffnet");
assert.ok(!/avesmapsIsPhoneViewport/.test(lookup),
	"location-lookup fragt NICHT -- dort ist die schwebende Box die einzige Antwortflaeche"
	+ " (\"naechster Ort\"), und ein Riegel naehme dem Werkzeug seine Ausgabe");
assert.ok(/floating:\s*true/.test(lookup),
	"und location-lookup oeffnet sie weiterhin");

console.log("hit-targets tests passed");
```

- [ ] **Step 2: Laufen lassen — muss rot sein**

Run: `node js/map-features/__tests__/hit-targets.test.js`
Expected: `AssertionError: marker-entry fragt avesmapsIsPhoneViewport, bevor es die schwebende Box oeffnet`

- [ ] **Step 3: Den Riegel einbauen**

`js/map-features/map-features-location-marker-entry.js`, Zeile ~228 — nach

```js
	const infopanelMode = typeof IS_INFOPANEL_MODE !== "undefined" && IS_INFOPANEL_MODE;
```

einfügen:

```js
	// Am Telefon deckt das Infopanel die Karte: gemessen auf 360x640 liegen 283 der 334px der
	// schwebenden Box hinter dem Panel, uebrig bleibt ein 51px-Streifen mit dem Anfang des Namens.
	// Der Owner-Grund fuer die Box ("sehen, WO der Ort liegt") laesst sich dort am wenigsten
	// einloesen -- das bisschen Karte liegt links davon. Also: eine Flaeche, das Panel.
	// 🔴 NUR hier. Der zweite Aufrufer von { floating: true } ist "naechster Ort"
	// (map-features-location-lookup.js), und dort ist die Box die EINZIGE Antwortflaeche.
	const floatingBoxFitsBesideInfopanel = !(typeof avesmapsIsPhoneViewport === "function" && avesmapsIsPhoneViewport());
	const useFloatingBox = infopanelMode && floatingBoxFitsBesideInfopanel;
```

- [ ] **Step 4: Die beiden Verwendungen umstellen**

Zeile ~239–240 — `infopanelMode` durch `useFloatingBox` ersetzen (beide Stellen):

```js
	markerEntry.marker.bindPopup(
		() => buildLocationMarkerPopupHtml(markerEntry, useFloatingBox ? { floating: true } : undefined),
		{ minWidth: 320, maxWidth: 400, maxHeight, className: useFloatingBox ? "settlement-popup floating-location-popup" : "settlement-popup" }
	);
```

⚠️ Die `popupopen`-Verdrahtung darunter bleibt auf `infopanelMode` — sie füllt das **Panel**, und das soll am Telefon gerade weiterhin passieren.

- [ ] **Step 5: Laufen lassen — muss grün sein**

Run: `node js/map-features/__tests__/hit-targets.test.js`
Expected: `hit-targets tests passed`

- [ ] **Step 6: In der laufenden Seite prüfen**

Browser auf 360 × 640, `index.html`, einen Ort über die Suche öffnen. Konsole:

```js
({ panel: !!document.querySelector('.avesmaps-infopanel:not(.is-hidden)'),
   box: !!document.querySelector('.floating-location-popup') })
```

Expected: `{ panel: true, box: false }` — dann 1280 × 800 laden und dasselbe prüfen: `{ panel: true, box: true }`.

- [ ] **Step 7: Commit**

```bash
git status
git commit -m "ui(mobil): am Telefon oeffnet ein Ort EINE Flaeche -- die schwebende Box lag ohnehin hinter dem Infopanel" -- js/map-features/map-features-location-marker-entry.js js/map-features/__tests__/hit-targets.test.js
```

---

## Task 4: Block A — Die Maßschicht

⚠️ **Erst nach Aufgabe 2.** Diese Aufgabe lässt den Planer am Telefon wachsen; ohne die Panelhöhe aus Aufgabe 2 landet das Wachstum unter dem Bildrand.

**Files:**
- Modify: `css/base/tokens.css` (vier Höhen-Token + Ergänzung des `pointer: coarse`-Blocks)
- Modify: `css/features/route-planner.css:24` (`#search`-Zeile), `:45-47` (Griff + ✕), `:108` (`.input-options button`), `:173` (`#inputLocation`), `:357` (`.planner-group__toggle`), `:611` (Zahlen-/Datumsfeld), `:77` (`.waypoint-input`)
- Modify: `css/components/legal-dialog.css:449` (Eckknöpfe)
- Test: `js/app/__tests__/touch-scale.test.js` (anhängen)

**Interfaces:**
- Consumes: den `pointer: coarse`-Block aus Aufgabe 1.
- Produces: `--control-h`, `--control-h-sm`, `--control-h-field`, `--tap-min` — von Aufgabe 5 gelesen.

- [ ] **Step 1: Den Test anhängen**

An `js/app/__tests__/touch-scale.test.js`, vor `console.log`:

```js
// ---- Kein zweiter Ort fuer Steuermasse ----------------------------------------------------------
const HOEHEN = ["--control-h", "--control-h-sm", "--control-h-field", "--tap-min"];
HOEHEN.forEach((name) => {
	assert.ok(new RegExp(escapeRe(name) + ":").test(tokens), `${name} steht in tokens.css`);
	assert.ok(new RegExp(escapeRe(name) + ":").test(coarse), `${name} wird im Finger-Block angehoben`);
});
["css/features/route-planner.css", "css/layout/map-layout.css", "css/components/legal-dialog.css"]
	.forEach((rel) => {
		const css = withoutComments(read(...rel.split("/")));
		assert.ok(!/@media\s*\(pointer:\s*coarse\)[^{]*\{[^}]*--control-h/.test(css),
			`${rel} hebt die Steuerhoehen NICHT selbst an -- das gehoert in tokens.css, sonst gibt es zwei Wahrheiten`);
	});

// ---- Die Fingerwerte sind Fingerwerte -----------------------------------------------------------
const tap = coarse.match(/--tap-min:\s*([0-9.]+)px/);
assert.ok(tap && Number(tap[1]) >= 44,
	`--tap-min ist am Finger ${tap ? tap[1] : "nicht gesetzt"} -- unter 44 ist es kein Fingerziel`);
```

- [ ] **Step 2: Laufen lassen — muss rot sein**

Run: `node js/app/__tests__/touch-scale.test.js`
Expected: `AssertionError: --control-h steht in tokens.css`

- [ ] **Step 3: Die Höhen-Token anlegen**

`css/base/tokens.css`, im `:root`-Block direkt nach den `--icon-*`-Werten:

```css
	/* Steuerhoehen — die Masse der Bedienelemente. Am Zeiger genau das, was die Komponenten
	   heute tragen; der (pointer: coarse)-Block am Dateiende hebt sie auf Fingermass.
	   💣 Diese Werte sind am Zeiger NICHT frei: sie sind gegen Panel-Ueberlauf gerechnet
	   (route-planner.css:339 -- eine Optionszeile kostet 36px, bei vier Wegpunkten faellt der
	   Scrollbalken). Wer sie hier "aufraeumt", bricht das dort dokumentierte Budget. */
	--control-h: 32px;        /* Wegpunktfeld, Combobox, Knopf */
	--control-h-sm: 24px;     /* Klappzeile, ✕ am Wegpunkt, ⓘ */
	--control-h-field: 25px;  /* Zahlen- und Datumsfeld der Optionen */
	--tap-min: auto;          /* Mindesthoehe einer anfassbaren ZEILE */
```

- [ ] **Step 4: Den Finger-Block ergänzen**

Im `@media (pointer: coarse)`-Block aus Aufgabe 1, nach `--font-size-control: 16px;`:

```css
		--control-h: 44px;
		--control-h-sm: 40px;
		--control-h-field: 44px;
		/* 💣 Gilt der ZEILE, nicht dem Kaestchen: ein <input type=checkbox> ist nativ 14x14 und
		   verzieht die Zeile, wenn man es aufblaest. Jedes sitzt in einem <label> -- die Flaeche
		   ist die Zeile, und die ist heute 15px hoch. */
		--tap-min: 44px;
```

- [ ] **Step 5: Die Komponenten umstellen**

`css/features/route-planner.css`:

| Zeile | vorher | nachher |
|---|---|---|
| ~24 | `min-height: 36px;` | `min-height: max(36px, var(--tap-min));` |
| ~46–47 | `width: 24px; height: 24px;` | `width: var(--control-h-sm); height: var(--control-h-sm);` |
| ~77 | `height: 30px;` | `height: var(--control-h);` |
| ~108 | `min-height: 32px;` | `min-height: var(--control-h);` |
| ~173 | `min-height: 32px;` | `min-height: var(--control-h);` |
| ~357 | `min-height: 24px;` | `min-height: var(--control-h-sm);` |
| ~611 | `height: 25px;` | `height: var(--control-h-field);` |

In `.display-options__row, .display-options__select-row, .transport-filter-label` (Zeile ~658) ergänzen:

```css
	/* Die Zeile ist das Klickziel -- das Kaestchen darin bleibt 14px (siehe --tap-min). */
	min-height: var(--tap-min);
```

`css/components/legal-dialog.css`, in `#legal-button, #news-button` (Zeile ~446) ergänzen:

```css
	min-height: var(--tap-min);
```

- [ ] **Step 6: Laufen lassen — muss grün sein**

Run: `node js/app/__tests__/touch-scale.test.js`
Expected: `touch-scale tests passed`

- [ ] **Step 7: Beide Zeiger nachmessen**

Auf 360 × 640, Planer offen, Konsole:

```js
const s = document.getElementById('search');
const n = [...s.querySelectorAll('button, input, select, a, label')].filter(e => e.offsetParent);
({ gesamt: n.length,
   unter44: n.filter(e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.height < 44; })
             .map(e => [e.id || e.className.toString().slice(0,24), Math.round(e.getBoundingClientRect().height)]) })
```

Expected: `unter44` enthält nur noch die nackten `input[type=checkbox]` (14 px) — deren Zeile ist 44.

Dann **1280 × 800** laden und mit `git stash` / ohne die Änderung vergleichen: Panelhöhe bei vier Wegpunkten und beiden Gruppen offen muss auf den Pixel gleich bleiben (~759 px).

- [ ] **Step 8: Commit**

```bash
git status
git commit -m "ui(mobil): Bedienelemente erreichen am Finger 44px -- die Masse stehen jetzt als Token an einer Stelle" -- css/base/tokens.css css/features/route-planner.css css/components/legal-dialog.css js/app/__tests__/touch-scale.test.js
```

---

## Task 5: C2 → C1 — Der Zoom räumt, die Suche zieht ein

⚠️ **In dieser Reihenfolge innerhalb der Aufgabe.** Erst den Zoom ausblenden, dann den Knopf setzen — sonst stehen kurz drei Dinge übereinander.

**Files:**
- Modify: `css/layout/map-layout.css` (Zoom am Finger aus)
- Modify: `index.html:2241` (Suchknopf im Bund)
- Modify: `css/components/legal-dialog.css` (Suchknopf-Optik + aufgezogenes Feld)
- Modify: `js/app/bootstrap.js` (Verdrahtung)
- Test: `js/app/__tests__/touch-scale.test.js` (anhängen)

**Interfaces:**
- Consumes: `--tap-min`, `--control-h` (Aufgabe 4); `openSpotlightSearch(initialValue?: string): void` aus `js/ui/spotlight-search.js:79`.
- Produces: `#map-search-button` (DOM-Id).

- [ ] **Step 1: Den Test anhängen**

```js
// ---- Der Zoom raeumt am Finger, und die Suche zieht ein ------------------------------------------
assert.ok(/@media\s*\(pointer:\s*coarse\)[^{]*\{[^}]*\.leaflet-control-zoom[^}]*display:\s*none/s.test(layout),
	"der Zoom-Control wird am Finger AUSGEBLENDET (nicht bei addTo weggelassen -- sonst stuende"
	+ " die Platzierungsregel in infopanel.css als tote Zusicherung da)");
const bootstrap = withoutComments(read("js", "app", "bootstrap.js"));
assert.ok(/L\.control\.zoom\(/.test(bootstrap),
	"und er wird weiterhin angelegt -- am Zeiger bleibt er");

assert.ok(/id="map-search-button"/.test(indexHtml), "der Suchknopf steht im Markup");
const bundIdx = indexHtml.indexOf('id="map-corner-actions"');
const suchIdx = indexHtml.indexOf('id="map-search-button"');
assert.ok(bundIdx > -1 && suchIdx > -1 && suchIdx < bundIdx,
	"und VOR dem Knopfbund -- er sitzt darueber, nicht darin (eine Handlung, zwei Verweise)");
assert.ok(/openSpotlightSearch\s*\(/.test(bootstrap),
	"der Knopf ruft die vorhandene Suche, statt eine zweite zu bauen");
```

- [ ] **Step 2: Laufen lassen — muss rot sein**

Run: `node js/app/__tests__/touch-scale.test.js`
Expected: `AssertionError: der Zoom-Control wird am Finger AUSGEBLENDET`

- [ ] **Step 3: Den Zoom am Finger ausblenden**

`css/layout/map-layout.css`, am Dateiende:

```css
/* Am Finger ist die Zwei-Finger-Geste die Zoomhilfe; zwei 26px-Kacheln daneben sind ein
   Mausrelikt, das Kartenflaeche kostet (Owner 2026-08-10).
   ⚠️ AUSGEBLENDET, nicht bei `L.control.zoom(...).addTo(map)` weggelassen: die Platzierungsregel
   `.avesmaps-infopanel-mode .leaflet-control-zoom` in infopanel.css stuende sonst als tote
   Zusicherung da, und map-corner-actions.test.js prueft sie. */
@media (pointer: coarse) {
	.leaflet-control-zoom {
		display: none;
	}
}
```

- [ ] **Step 4: Den Knopf ins Markup setzen**

`index.html`, **unmittelbar vor** `<div id="map-corner-actions">` (Zeile ~2241):

```html
		<!-- Der Suchknopf nimmt den Sitz, den der Zoom am Finger raeumt (Owner 2026-08-10): ein
		     Tausch, keine Zugabe. Er sitzt UEBER dem Bund, nicht darin -- die Ecke traegt damit
		     sichtbar eine Rangfolge: eine Handlung (gefuellt), zwei Verweise (weich). -->
		<button type="button" id="map-search-button" aria-label="Suchen" data-i18n-aria-label="spotlight.title" hidden>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
				<circle cx="10.5" cy="10.5" r="6.5"></circle><path d="M15.5 15.5 21 21"></path>
			</svg>
		</button>
```

- [ ] **Step 5: Die Optik geben**

`css/components/legal-dialog.css`, nach dem `#legal-button, #news-button`-Block:

```css
/* Der Suchknopf ueber dem Bund. Nur am Finger sichtbar -- am Zeiger oeffnet die Suche das
   Tastenkuerzel (F / Leertaste), und ein Knopf waere dort ein doppelter Weg. */
#map-search-button {
	position: fixed;
	right: var(--space-10);
	/* Ueber dem Bund -- dieselbe Zahl, aus der auch der Zoom seinen Abstand rechnet. */
	bottom: calc(var(--space-10) + var(--avesmaps-corner-stack, 40px) + var(--space-6));
	z-index: var(--z-map-ui);
	display: none;
	align-items: center;
	justify-content: center;
	width: 48px;
	height: 48px;
	padding: 0;
	border: 1px solid var(--color-button-border);
	border-radius: var(--radius-md);
	background: var(--color-button);
	color: var(--color-button-text);
	box-shadow: var(--shadow-panel);
	cursor: pointer;
}
#map-search-button svg {
	width: 22px;
	height: 22px;
}
@media (pointer: coarse) {
	#map-search-button {
		display: flex;
	}
}
```

- [ ] **Step 6: Verdrahten**

`js/app/bootstrap.js`, nach `L.control.zoom({ position: "topright" }).addTo(map);` (Zeile ~134):

```js
// Der Suchknopf an der Karte (nur am groben Zeiger sichtbar, siehe legal-dialog.css). Er oeffnet
// die VORHANDENE Spotlight-Suche -- das aufgezogene Feld ist dieselbe Flaeche, nicht eine zweite.
(function wireMapSearchButton() {
	const button = document.getElementById("map-search-button");
	if (!button) {
		return;
	}
	button.hidden = false;
	button.addEventListener("click", () => {
		if (typeof openSpotlightSearch === "function") {
			openSpotlightSearch();
		}
	});
})();
```

- [ ] **Step 7: Das Suchfenster am Telefon nach unten verankern**

Damit die Lupe *zum Feld wächst*, muss das Feld dort landen, wo der Knopf war — unten. Heute
hängt das Fenster oben (`#spotlight-search-overlay { align-items: flex-start; padding: min(16vh, 116px) 16px 24px }`,
`css/components/dialog-overlays.css:122`).

`css/components/spotlight-search.css`, am Dateiende:

```css
/* Am Finger sitzt die Suche UNTEN: dort war der Knopf, dort ist der Daumen, und die Treffer
   wachsen nach oben.
   ⚠️ Ueber `order`, nicht ueber `flex-direction: column-reverse` -- die Umkehrung erwischte auch
   die (versteckte) Ueberschrift und die Statuszeile und wuerfe sie an unerwartete Stellen. */
@media (pointer: coarse) {
	#spotlight-search-overlay {
		align-items: flex-end;
		padding: var(--space-16) var(--space-10) var(--space-10);
	}

	.spotlight-search {
		display: flex;
		flex-direction: column;
		width: 100%;
	}
	.spotlight-search__results { order: 1; }
	.spotlight-search__input   { order: 2; border-bottom: 0; }
	.spotlight-search__status  { order: 3; }
}
```

`js/ui/spotlight-search.js`, am Ende der Datei:

```js
// 💣 Die Bildschirmtastatur ist der eine Haken an einem unten verankerten Feld: iOS schrumpft den
// Layout-Viewport NICHT, wenn sie aufgeht -- `100dvh` und `bottom: 0` zeigen weiter auf den
// Bildschirmrand, und das Feld verschwindet dahinter. Die Sichthoehe kennt nur visualViewport.
// ⚠️ Nur am groben Zeiger verdrahtet; am Zeiger gibt es keine Tastatur, die etwas verdeckt.
(function keepSpotlightAboveKeyboard() {
	const overlay = document.getElementById("spotlight-search-overlay");
	const viewport = window.visualViewport;
	if (!overlay || !viewport || !window.matchMedia("(pointer: coarse)").matches) {
		return;
	}
	const sync = () => {
		const hidden = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
		overlay.style.paddingBottom = hidden > 0 ? `calc(var(--space-10) + ${Math.round(hidden)}px)` : "";
	};
	viewport.addEventListener("resize", sync);
	viewport.addEventListener("scroll", sync);
	sync();
})();
```

- [ ] **Step 8: Laufen lassen — beide Tests**

Run: `node js/app/__tests__/touch-scale.test.js && node js/app/__tests__/map-corner-actions.test.js`
Expected: `touch-scale tests passed` und `map-corner-actions tests passed`

⚠️ Der zweite ist die Gegenprobe, dass der Bund unberührt blieb.

- [ ] **Step 9: Am Gerät prüfen**

Auf 360 × 640: der Knopf steht unten rechts über „Neuigkeiten", der Zoom ist weg. Antippen öffnet die Suche. Auf 1280 × 800: Knopf unsichtbar, Zoom da.

🔧 **Am echten Telefon, nicht im Emulator:** Feld aufziehen, tippen — steht das Feld noch über der Bildschirmtastatur? Wenn nicht, muss das Spotlight-Fenster am Telefon an `window.visualViewport` hängen statt an `100dvh` (Entwurf §7 C1). Das ist die einzige Stelle des Vorhabens, die ein Emulator nicht beantwortet; falls sie zuschlägt, ist es eine eigene kleine Aufgabe.

- [ ] **Step 10: Commit**

```bash
git status
git commit -m "ui(mobil): der Zoom raeumt am Finger, die Suche nimmt seinen Sitz in der Kartenecke" -- css/layout/map-layout.css css/components/legal-dialog.css css/components/spotlight-search.css index.html js/app/bootstrap.js js/ui/spotlight-search.js js/app/__tests__/touch-scale.test.js
```

---

## Task 6: C3b — Ortsnamen werden klickbar, auch am Desktop

🔴 **Nicht auf `pointer: coarse` beschränken.** Owner-Entscheid 2026-08-10: gilt auch am Zeiger.

**Files:**
- Modify: `js/map-features/map-features-location-name-labels.js:153-158`
- Modify: `css/features/map-labels.css:508-513`
- Test: `js/map-features/__tests__/hit-targets.test.js` (anhängen)

**Interfaces:**
- Consumes: `window.avesmapsShowLocationInInfopanel(markerEntry)` — dieselbe Funktion, die `map-features-location-marker-entry.js:253` beim `popupopen` des Markers ruft.
- Produces: nichts.

- [ ] **Step 1: Den Test anhängen**

```js
// ---- Name und Punkt oeffnen DASSELBE -------------------------------------------------------------
//
// Das ist die Zusicherung, die C3b ueberhaupt vertretbar macht. Zwei Trefferflaechen sind nur
// dann EIN Ziel, wenn sie nachweislich dieselbe Auskunft oeffnen; ein zweiter Popup-Bauer im
// Label-Pfad liesse zwei Auskuenfte ueber denselben Ort auseinanderlaufen.
const nameLabels = withoutComments(read("js", "map-features", "map-features-location-name-labels.js"));
assert.ok(/interactive:\s*true/.test(nameLabels),
	"der Label-Marker ist interaktiv -- vorher stand hier `interactive: false`");
assert.ok(/avesmapsShowLocationInInfopanel\s*\(/.test(nameLabels),
	"und sein Klick ruft DENSELBEN Einspeiser wie der Marker");
assert.ok(!/buildLocationMarkerPopupHtml/.test(nameLabels),
	"der Label-Pfad baut KEIN eigenes Popup -- sonst gaebe es zwei Auskuenfte ueber einen Ort");

const labelCss = withoutComments(read("css", "features", "map-labels.css"));
const inert = labelCss.match(/\.location-name-label[^{]*\{[^}]*pointer-events:\s*none/);
assert.ok(!inert, "das Ortslabel ist nicht mehr per pointer-events inert gestellt");
assert.ok(/\.location-name-label\.is-colliding[\s\S]{0,120}display:\s*none/.test(labelCss)
	|| /is-colliding[^{]*\{\s*display:\s*none/.test(labelCss),
	"ein weggekollidiertes Label ist display:none und faengt deshalb keinen Klick"
	+ " -- mit opacity:0 gaebe es Geisterklicks auf unsichtbaren Namen");
```

- [ ] **Step 2: Laufen lassen — muss rot sein**

Run: `node js/map-features/__tests__/hit-targets.test.js`
Expected: `AssertionError: der Label-Marker ist interaktiv`

- [ ] **Step 3: Den Marker interaktiv machen**

`js/map-features/map-features-location-name-labels.js`, in `createLocationNameLabelEntry` (Zeile ~153):

```js
	const marker = L.marker(markerEntry.location.coordinates, {
		icon: L.divIcon({ className: "location-name-label", html: "", iconSize: [0, 0], iconAnchor: [0, 0] }),
		// 💣 Bis 2026-08-10 stand hier `interactive: false`, mit der Begruendung, Marker und Name
		// waeren "zwei Treffer uebereinander". Das gilt fuer zwei Ziele -- Punkt und Name eines
		// Ortes sind aber EIN Ziel mit zwei Teilen, und der Name ist der breitere. Ein Dorf misst
		// bei Zoom 6 nur 24px Trefferdurchmesser und erreicht auf KEINER Stufe Fingergroesse.
		interactive: true,
		keyboard: false,
		pane: "labelsPane",
	});
	// Derselbe Einspeiser wie beim Marker (marker-entry.js: popupopen -> avesmapsShowLocationInInfopanel).
	// 🔴 Hier wird KEIN Popup gebaut: zwei Bauer waeren zwei Auskuenfte ueber denselben Ort.
	marker.on("click", () => {
		if (typeof window.avesmapsShowLocationInInfopanel === "function") {
			window.avesmapsShowLocationInInfopanel(markerEntry);
		}
	});
	return { markerEntry, marker };
```

- [ ] **Step 4: Das CSS-Schloss öffnen**

`css/features/map-labels.css`, den Kommentar bei Zeile ~508 anpassen und die Regel erweitern:

```css
/* Region-/Landschafts-Labels UND Ortsnamen sind im Ansichtsmodus anklickbar und oeffnen das
   Infopanel.
   💣 Bis 2026-08-10 blieb `.location-name-label` bewusst inert ("der Marker ist das Klickziel").
   Umgedreht auf Owner-Entscheid: Punkt und Name sind EIN Ziel mit zwei Teilen, nicht zwei Ziele
   uebereinander -- beide oeffnen denselben Ort ueber denselben Einspeiser. Der Name ist der
   breitere Teil, und ein Dorf erreicht als Punkt auf keiner Zoomstufe Fingergroesse.
   ⚠️ Gilt an BEIDEN Zeigern (Owner): auch mit der Maus ist ein 5px-Punkt eine Fummelei. */
.map-label,
.map-label span,
.location-name-label,
.location-name-label img {
	pointer-events: auto;
	cursor: pointer;
}
```

- [ ] **Step 5: Laufen lassen — muss grün sein**

Run: `node js/map-features/__tests__/hit-targets.test.js`
Expected: `hit-targets tests passed`

- [ ] **Step 6: In der Seite prüfen — beide Zeiger und der Editmodus**

1. **1280 × 800**, `index.html`: auf den Namen „Gareth" klicken (nicht auf den Punkt). Das Infopanel öffnet Gareth. Auf den Punkt klicken: dasselbe Panel.
2. Hineinzoomen, bis ein Name mit `is-colliding` verschwindet, an seine Stelle klicken: **nichts** passiert (kein Geisterklick).
3. **`index.html?edit=1`**: ein Label muss weiterhin ziehbar sein — der neue Klickpfad darf das Ziehen nicht abfangen. ⚠️ Fängt er es ab, gehört ein `if (map.dragging && marker.dragging?.enabled()) { return; }` an den Anfang des Handlers.

- [ ] **Step 7: Commit**

```bash
git status
git commit -m "feat: der Ortsname ist anklickbar und oeffnet denselben Ort wie sein Punkt" -- js/map-features/map-features-location-name-labels.js css/features/map-labels.css js/map-features/__tests__/hit-targets.test.js
```

---

## Task 7: C3a — Der Trefferboden für Punkte

⚠️ **Erst nach Aufgabe 6.** Sonst wird der Boden gegen eine Karte gemessen, auf der der Name noch nicht hilft — und zu groß gewählt.

**Files:**
- Modify: `js/map-features/map-features-location-canvas-layer.js:297` und `:367`
- Test: `js/map-features/__tests__/hit-targets.test.js` (anhängen)

**Interfaces:**
- Consumes: `LOCATION_MARKER_CONTOUR_RATIO` (`js/map-features/map-features-location-marker-rendering.js`).
- Produces: `locationCanvasHitRadius(core: number): number`.

- [ ] **Step 1: Den Test anhängen**

```js
// ---- Der Trefferboden steht EINMAL --------------------------------------------------------------
const canvasLayer = withoutComments(read("js", "map-features", "map-features-location-canvas-layer.js"));
const ausdruecke = canvasLayer.match(/\(1\s*\+\s*LOCATION_MARKER_CONTOUR_RATIO\)/g) || [];
assert.strictEqual(ausdruecke.length, 1,
	`der Trefferradius wird ${ausdruecke.length}x gerechnet -- er gehoert in EINE Funktion,`
	+ " sonst driften Klick und Mauszeiger auseinander (heute standen zwei Kopien da)");
assert.ok(/function locationCanvasHitRadius\s*\(/.test(canvasLayer),
	"und diese Funktion heisst locationCanvasHitRadius");
const boden = canvasLayer.match(/AVESMAPS_LOCATION_TOUCH_HIT_FLOOR\s*=\s*([0-9.]+)/);
assert.ok(boden, "der Boden steht als benannte Konstante");
assert.ok(Number(boden[1]) <= 18,
	`der Boden ist ${boden[1]}px -- ueber ~18 oeffnet bei 4.653 Orten ein Tipp auf leere Karte`
	+ " einen Ort weit weg");
assert.ok(/pointer:\s*coarse/.test(canvasLayer),
	"und er gilt nur am groben Zeiger");
```

- [ ] **Step 2: Laufen lassen — muss rot sein**

Run: `node js/map-features/__tests__/hit-targets.test.js`
Expected: `AssertionError: der Trefferradius wird 2x gerechnet`

- [ ] **Step 3: Die eine Funktion schreiben**

`js/map-features/map-features-location-canvas-layer.js`, oben bei den Konstanten:

```js
// Wie weit neben einem Punkt ein Klick noch zaehlt.
//
// 💣 Am Finger reicht die Markergroesse NICHT aus, und zwar auf keiner Zoomstufe: ein Dorf misst
// bei Zoom 6 (dort endet das Groessenschema) 24px Trefferdurchmesser, eine Metropole erreicht
// Fingergroesse erst ab Zoom 5. Deshalb ein Boden -- aber ein kleiner.
// ⚠️ 16, nicht 22: bei 4.653 Orten ueberlappen sich die Kreise sonst grossflaechig. Technisch
// harmlos (die Schleifen nehmen den NAECHSTEN Treffer), aber ein zu grosser Boden laesst einen
// Tipp auf leere Karte einen Ort weit weg oeffnen. Zusammen mit dem klickbaren Ortsnamen
// (map-features-location-name-labels.js) reicht das -- der Name ist der breite Teil des Ziels.
const AVESMAPS_LOCATION_TOUCH_HIT_FLOOR = 16;
const AVESMAPS_LOCATION_HIT_SLACK = 3;

function locationCanvasHitRadius(core) {
	const drawn = core * (1 + LOCATION_MARKER_CONTOUR_RATIO) + AVESMAPS_LOCATION_HIT_SLACK;
	let coarsePointer = false;
	try {
		coarsePointer = window.matchMedia("(pointer: coarse)").matches;
	} catch (error) {
		coarsePointer = false;
	}
	return coarsePointer ? Math.max(drawn, AVESMAPS_LOCATION_TOUCH_HIT_FLOOR) : drawn;
}
```

- [ ] **Step 4: Beide Stellen darauf umstellen**

Zeile ~297 (in `_tryOpenAtContainerPoint`):

```js
			const hitRadius = locationCanvasHitRadius(item.core);
```

Zeile ~367 (im Cursor-Handler):

```js
			const hitRadius = locationCanvasHitRadius(item.core);
```

- [ ] **Step 5: Laufen lassen — muss grün sein**

Run: `node js/map-features/__tests__/hit-targets.test.js`
Expected: `hit-targets tests passed`

- [ ] **Step 6: Nachmessen**

Auf 360 × 640, Zoom 4, ein Dorf ansteuern und **neben** den Punkt tippen (~10 px daneben): das Dorf öffnet. Auf 1280 × 800 dieselbe Stelle anklicken: **nichts** — der Boden gilt nur am Finger. Konsole zur Gegenprobe:

```js
window.matchMedia("(pointer: coarse)").matches
```

- [ ] **Step 7: Commit**

```bash
git status
git commit -m "fix(mobil): Orte sind am Finger treffbar -- ein Trefferboden, und der Radius wird nur noch einmal gerechnet" -- js/map-features/map-features-location-canvas-layer.js js/map-features/__tests__/hit-targets.test.js
```

---

## Task 8: C3c — Das Wege-Band ab Zoom 4

**Files:**
- Modify: `js/config.js` (Konstanten neben `PATH_WIDTH_SCALE`, Zeile ~565)
- Modify: `js/map-features/map-features-path-rendering.js:311-345` (dritte Linie in `createPathLayer`)
- Test: `js/map-features/__tests__/hit-targets.test.js` (anhängen)

**Interfaces:**
- Consumes: `getPathWidthScale(subtype, zoom): number` (`js/config.js:566`), `pathHasWiki(path): boolean`, `normalizePathSubtype(name): string` (`map-features-path-rendering.js:67`).
- Produces: `path._pathLines[2]` — die Trefflinie als **drittes** Element des vorhandenen Arrays.

💣 **Die Trefflinie gehört in `_pathLines`, nicht neben es.** Das Array wird an vier Stellen
durchlaufen (`map-features-path-rendering.js:225, 354, 358, 406`): dort bekommt jede Linie den
Klick-Handler, die Geometrie-Aktualisierung und das Ein-/Ausblenden. Als eigenes Feld
(`path._pathHitLine`) müsste all das ein zweites Mal geschrieben werden — und beim nächsten
Umbau würde genau eine der vier Stellen vergessen. `updatePathLayerStyle` greift ohnehin per
Index (`[0]`, `[1]`), ein drittes Element stört dort nichts.

- [ ] **Step 1: Den Test anhängen**

```js
// ---- Das Wege-Band: erst ab der Zoomschwelle, und Flaechen bleiben unberuehrt -------------------
const config = withoutComments(read("js", "config.js"));
const schwelle = config.match(/AVESMAPS_PATH_HIT_MIN_ZOOM\s*=\s*(\d+)/);
assert.ok(schwelle, "die Zoomschwelle steht als benannte Konstante in config.js");
assert.ok(Number(schwelle[1]) >= 4,
	`die Schwelle ist ${schwelle[1]} -- darunter gehoert die Flaeche dem Gebiet, nicht dem Weg`
	+ " (Owner-Bedingung 2026-08-10)");
const band = config.match(/AVESMAPS_PATH_HIT_WEIGHT\s*=\s*(\d+)/);
assert.ok(band && Number(band[1]) <= 24,
	`das Band ist ${band ? band[1] : "nicht gesetzt"}px -- breiter nimmt es dem Gebiet darunter zu viel`);

const pathRendering = withoutComments(read("js", "map-features", "map-features-path-rendering.js"));
assert.ok(/AVESMAPS_PATH_HIT_MIN_ZOOM/.test(pathRendering), "das Rendering liest die Schwelle");
assert.ok(/getPathWidthScale\s*\([^)]*\)\s*>\s*0/.test(pathRendering),
	"und es fragt DIESELBE Sichtbarkeitsbedingung wie die Darstellung -- ein Trefferband an einem"
	+ " Weg, den es auf dieser Stufe gar nicht gibt, waere ein Klick ins Nichts");

// 🔴 Flaechen bekommen NIE eine Zugabe (Owner-Bedingung). Ihre Trefferflaeche IST ihre Flaeche;
// ein Boden hiesse, sie nach aussen zu schieben und den Nachbarn zu bestehlen.
["map-features-ecosystem-rendering.js", "map-features.js"].forEach((file) => {
	const src = withoutComments(read("js", "map-features", file));
	assert.ok(!/HIT_FLOOR|hitRadius|HIT_WEIGHT/.test(src),
		`${file} gibt Polygonen keine Trefferzugabe (Owner-Bedingung 2026-08-10)`);
});
```

- [ ] **Step 2: Laufen lassen — muss rot sein**

Run: `node js/map-features/__tests__/hit-targets.test.js`
Expected: `AssertionError: die Zoomschwelle steht als benannte Konstante in config.js`

- [ ] **Step 3: Die Konstanten anlegen**

`js/config.js`, direkt nach `PATH_WIDTH_SCALE` (Zeile ~565):

```js
// Trefferband der Wege: eine UNSICHTBARE Linie ueber der Kontur, damit ein Weg am Finger
// anfassbar ist, ohne dass sich das Kartenbild aendert.
//
// 💣 "Bei hohem Zoom sind die Wege ohnehin breit genug" stimmt NICHT. Gerechnet aus
// PATH_OUTLINE_WEIGHTS x PATH_WIDTH_SCALE misst bei der hoechsten Stufe ein Pfad 3,6px und eine
// Strasse 4,8px; nur die Reichsstrasse kommt auf 13. Kein Weg erreicht je aus eigener Kraft
// Fingergroesse -- die Zugabe wird auf JEDER sichtbaren Stufe gebraucht.
//
// 🔴 Die Schwelle sagt trotzdem etwas anderes, und deshalb steht sie hier: nicht "hier ist der
// Weg breit", sondern "hier sucht man den Weg". Im Ueberblick sucht man Gebiete und Staedte --
// und dort kostet ein Band am meisten, weil eine Baronie dann ein Fingernagelfeld ist. Unterhalb
// dieser Stufe aendert sich am Trefferverhalten der Karte NICHTS (Owner-Bedingung 2026-08-10).
//
// ⚠️ 24px klingt schmal, ist es fuer eine LINIE aber nicht: Genauigkeit braucht es nur quer dazu,
// laengs ist das Ziel unbegrenzt. Dem Gebiet darunter nimmt es +-12px statt +-19px bei 44.
const AVESMAPS_PATH_HIT_MIN_ZOOM = 4;
const AVESMAPS_PATH_HIT_WEIGHT = 24;
```

- [ ] **Step 4: Die dritte Linie bauen**

`js/map-features/map-features-path-rendering.js`, in `createPathLayer` nach `roadCenter` (Zeile ~334):

```js
	// Unsichtbares Trefferband. Eigene Linie, nicht die Kontur verbreitert -- sonst aendert sich
	// das Kartenbild. Sie liegt in derselben Pane wie die Mitte und damit ueber ihr.
	const roadHit = L.polyline(latLngCoords, {
		pane: "roadsPane",
		renderer: getVectorRenderer("roadsPane"),
		color: "#000000",
		weight: AVESMAPS_PATH_HIT_WEIGHT,
		opacity: 0,
		interactive: IS_EDIT_MODE || pathHasWiki(path),
		bubblingMouseEvents: false,
		lineCap: "round",
		lineJoin: "round",
	});
```

Die Zeilen ~348 und ~351 erweitern:

```js
	const layerGroup = L.layerGroup([roadOutline, roadCenter, roadHit]);
```

```js
	path._pathLines = [roadOutline, roadCenter, roadHit];
```

- [ ] **Step 5: Den Zoom-Riegel setzen**

In `updatePathLayerStyle` (Zeile ~234), nach den beiden vorhandenen `setStyle`-Zeilen:

```js
	// Das Band entsteht erst ab der Schwelle -- und nur, wenn der Weg auf dieser Stufe ueberhaupt
	// gezeichnet wird. Beide Bedingungen aus EINER Quelle: getPathWidthScale entscheidet schon
	// heute ueber die Sichtbarkeit (map-features-display-mode.js:38). Ein Band an einem Weg, den
	// es auf dieser Stufe gar nicht gibt, waere ein Klick ins Nichts.
	// ⚠️ normalizePathSubtype, derselbe Weg zum Subtyp wie in getPathStyleColors -- kein zweiter.
	const hitZoom = map.getZoom();
	const hitSubtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
	const hitVisible = hitZoom >= AVESMAPS_PATH_HIT_MIN_ZOOM
		&& getPathWidthScale(hitSubtype, hitZoom) > 0;
	path._pathLines[2]?.setStyle({ weight: hitVisible ? AVESMAPS_PATH_HIT_WEIGHT : 0 });
```

✅ **Klick und Geometrie kommen von selbst:** die `forEach`-Schleifen über `_pathLines` (Zeilen 354, 358, 406) verdrahten den Klick-Handler und ziehen `setLatLngs` nach — die Trefflinie ist dort ohne eine weitere Zeile dabei.

- [ ] **Step 6: Laufen lassen — muss grün sein**

Run: `node js/map-features/__tests__/hit-targets.test.js`
Expected: `hit-targets tests passed`

- [ ] **Step 7: Die Gegenproben — beide Richtungen**

1. **Zoom 5**, auf 360 × 640: ~10 px **neben** eine Reichsstraße tippen → der Weg öffnet.
2. **Zoom 5**, Politische Ansicht: eine Grafschaft **neben** einem Weg antippen → die **Grafschaft** öffnet, nicht der Weg. ⚠️ Öffnet der Weg, ist das Band zu breit — `AVESMAPS_PATH_HIT_WEIGHT` auf 16 senken und erneut messen.
3. **Zoom 3**: dieselbe Stelle antippen → **exakt wie vorher**. Das ist die Owner-Bedingung; hier darf sich nichts geändert haben.

- [ ] **Step 8: Commit**

```bash
git status
git commit -m "feat: Wege sind ab Zoom 4 am Finger treffbar -- unsichtbares Band, darunter bleibt die Flaeche dem Gebiet" -- js/config.js js/map-features/map-features-path-rendering.js js/map-features/__tests__/hit-targets.test.js
```

---

## Task 9: Block D — Einheitliche Abschlüsse

Reine Zeiger-Sache. Drei Schritte absteigend nach Sicherheit — **in dieser Reihenfolge**, damit der bildverändernde Teil für sich prüfbar bleibt.

**Files:**
- Modify: die Frontend-CSS-Dateien mit `border-radius: 8px` / `5px` als Literal
- Modify: `css/components/legal-dialog.css:449` (Eckknöpfe auf `--radius-md`)
- Modify: `css/layout/map-layout.css` (Zoom-Abschluss überschreiben)
- Test: `js/app/__tests__/touch-scale.test.js` (anhängen)

**Interfaces:** keine neuen.

- [ ] **Step 1: Den Test anhängen**

```js
// ---- Kein Token-Wert steht doppelt --------------------------------------------------------------
//
// 21x `8px` und 5x `5px` schreiben heute den Wert von --radius-md bzw. --radius-sm von Hand ab.
// Die sehen richtig AUS und verstellen sich nie mit -- genau die Divergenz, vor der AGENTS.md §12
// warnt.
// ⚠️ Nur DEKLARATIONEN, und Kommentare sind vorher heraus: editor-page.css BESCHREIBT einen
// 6px-Sonderfall in Prosa und nennt dabei beide Tokenwerte. Meine eigene Zaehlung ist beim Bauen
// zuerst darauf hereingefallen.
const FRONTEND_CSS_DIRS = [["css", "features"], ["css", "components"], ["css", "layout"], ["css", "base"]];
const doppelt = [];
FRONTEND_CSS_DIRS.forEach((dir) => {
	const abs = path.join(ROOT, ...dir);
	fs.readdirSync(abs).filter((f) => f.endsWith(".css")).forEach((file) => {
		const css = withoutComments(fs.readFileSync(path.join(abs, file), "utf8"));
		const treffer = css.match(/border-radius:\s*(?:8px|5px)\s*;/g) || [];
		if (treffer.length) {
			doppelt.push(`${dir.join("/")}/${file}: ${treffer.length}x`);
		}
	});
});
assert.deepStrictEqual(doppelt, [],
	"diese Dateien schreiben einen Tokenwert von Hand ab (8px = --radius-md, 5px = --radius-sm):\n  "
	+ doppelt.join("\n  "));

// ---- Die Knoepfe der Kartenecke tragen EINEN Abschluss -------------------------------------------
const legalCssD = withoutComments(read("css", "components", "legal-dialog.css"));
const eckRegel = legalCssD.match(/#legal-button,\s*\n?#news-button\s*\{([^}]*)\}/);
assert.ok(eckRegel, "die Eckknoepfe teilen sich eine Regel");
assert.ok(/border-radius:\s*var\(--radius-md\)/.test(eckRegel[1]),
	"und tragen --radius-md, wie AGENTS.md §12 es fuer Knoepfe vorschreibt (sie trugen --radius-sm)");
assert.ok(/\.leaflet-control-zoom[^{]*\{[^}]*border-radius/.test(layout),
	"der Zoom-Abschluss wird in map-layout.css ueberschrieben"
	+ " -- css/third-party/leaflet.css wird NICHT angefasst");
```

- [ ] **Step 2: Laufen lassen — muss rot sein**

Run: `node js/app/__tests__/touch-scale.test.js`
Expected: `AssertionError` mit der Liste der Dateien, die `8px`/`5px` schreiben.

- [ ] **Step 3: D1 — die abgeschriebenen Werte werden Token**

Die Liste aus Step 2 abarbeiten. Jedes `border-radius: 8px;` → `border-radius: var(--radius-md);`, jedes `border-radius: 5px;` → `border-radius: var(--radius-sm);`.

🔴 **Null sichtbare Änderung, und das ist beweisbar.** Vor dem Commit im Browser (1280 × 800) stichprobenartig:

```js
getComputedStyle(document.querySelector('.input-options button')).borderRadius
```

Expected: `"8px"` — vorher wie nachher.

- [ ] **Step 4: Zwischencommit**

```bash
git status
git commit -m "refactor: border-radius liest die Token statt ihre Werte abzuschreiben (kein Bildunterschied)" -- <die geaenderten Dateien>
```

- [ ] **Step 5: D2 — die Kartenecke bekommt einen Abschluss**

`css/components/legal-dialog.css`, in `#legal-button, #news-button`:

```css
	/* --radius-md, nicht -sm: AGENTS.md §12 gibt Knoepfen diesen Abschluss. Die Panel-HUELLE
	   bleibt bei -sm -- der Unterschied Panel<->Knopf ist gewollt, Knopf<->Knopf war es nie
	   (Owner-Meldung 2026-08-10 mit Screenshot: drei Abschluesse in einer Bildecke). */
	border-radius: var(--radius-md);
```

`css/layout/map-layout.css`, bei den vorhandenen Zoom-Regeln:

```css
/* Leaflets eigener 4px-Abschluss (css/third-party/leaflet.css) ist der dritte in dieser Ecke.
   ⚠️ Ueberschrieben, nicht dort geaendert: Fremddateien werden im Haus nie bearbeitet -- und die
   Zoom-FARBEN liegen aus demselben Grund schon hier. */
.leaflet-control-zoom {
	border-radius: var(--radius-md);
}
```

- [ ] **Step 6: Laufen lassen — muss grün sein**

Run: `node js/app/__tests__/touch-scale.test.js && node js/app/__tests__/map-corner-actions.test.js`
Expected: beide grün.

- [ ] **Step 7: D3 — die runden Formen einzeln ansehen**

```bash
grep -rn "border-radius:\s*\(999px\|50%\)" css/features css/components css/layout css/base --include=*.css
```

Die ~42 Treffer durchgehen und **je Fall** entscheiden, nicht ersetzen:

- **Darf rund bleiben:** Punkte, Wappenrahmen, Zählerkreise, Statusperlen, Avatare — alles, was eine *Form* ist.
- **Muss auf `--radius-md`:** alles, was ein *Knopf* ist. AGENTS.md §12: „no pill shapes".

Für jeden geänderten Fall den Grund in einer Zeile Kommentar dazuschreiben. Bleibt einer rund, ebenfalls — sonst wird beim nächsten Durchgang wieder derselbe Fall geprüft.

- [ ] **Step 8: Commit**

```bash
git status
git commit -m "ui: die Knoepfe an der Kartenecke tragen denselben Abschluss wie alle anderen" -- css/components/legal-dialog.css css/layout/map-layout.css js/app/__tests__/touch-scale.test.js <weitere aus Step 7>
```

---

## Abschluss

- [ ] **Alle Tests**

```bash
node js/app/__tests__/touch-scale.test.js && node js/app/__tests__/map-corner-actions.test.js && node js/map-features/__tests__/hit-targets.test.js && node js/app/__tests__/keyboard-shortcuts.test.js
```

- [ ] **Die Desktop-Gegenprobe** — 1280 × 800, `index.html`: Planer mit vier Wegpunkten und beiden Gruppen offen. Panelhöhe ~759 px, kein Scrollbalken. **Das ist die wichtigste Abnahme des ganzen Vorhabens** — daran hängt das Höhenbudget aus §4 des Entwurfs.

- [ ] **Push und Remote-SHA prüfen**

```bash
git push origin HEAD:master && git ls-remote origin master
```

- [ ] 🔧 **Owner:** nach dem Deploy (~2 Min) einmal am **echten Telefon** öffnen und die zwei Dinge prüfen, die kein Emulator beantwortet: (1) Feld aufgezogen bei offener Tastatur noch sichtbar? (2) Fühlt sich das Wege-Band bei Zoom 5 gierig an — öffnet eine Grafschaft neben einer Straße noch die Grafschaft?
