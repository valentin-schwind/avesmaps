# Karte als SVG herunterladen — Bauplan

> **Für agentische Arbeiter:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Schritte tragen
> Kästchen (`- [ ]`) zum Abhaken.

**Entwurf:** [`docs/superpowers/specs/2026-08-14-svg-export-design.md`](../specs/2026-08-14-svg-export-design.md)
— dieser Plan setzt ihn um und erfindet nichts dazu.

**Ziel:** Admins laden die ganze Karte als bearbeitbare SVG herunter — Ebenen als
Gruppen, jedes Element benannt, in zwei Dialekten (Illustrator / Inkscape).

**Bauart:** Eine Seite `edit/svg-export.php` mit dem Admin-Riegel von
`edit/backup.php`. Der **Browser** baut die Datei: ein reiner, testbarer Bauer
(`js/pages/svg-export-build.js`) nimmt Payloads, Ebenenauswahl, Farbtafel und
Dialekt und gibt eine Liste von Textstücken zurück; ein dünner Kitt
(`js/pages/svg-export-page.js`) holt, zeigt Fortschritt und reicht einen Blob
zum Download. Kein neuer Server-Endpunkt, kein PHP-Renderer.

**Werkzeug:** Vanilla JS ohne Build (Projektstandard), PHP 8 nur als Seitenhülle,
Node als Testläufer (`node pfad/zur.test.js`, `assert`).

## Globale Zusicherungen

Sie gelten für **jede** Aufgabe, auch wenn sie dort nicht wiederholt werden.

- **Keine Farbe, kein Radius, kein Trenner hartkodiert** — Token aus
  `css/base/tokens.css`. Fehlt ein Wert, erst Token anlegen (AGENTS.md §12).
- **Kein `git add -A`, kein `git add .`, kein `git commit -a`.** Diese Arbeitskopie
  wird von mehreren Sitzungen geteilt und trägt fremde unfertige Dateien. Immer
  erst `git status`, dann **nur die eigenen Pfade** einzeln stagen (AGENTS.md §9).
- **Vor jedem Push das GANZE Testfeld**, nicht nur die eigenen Tests:
  `for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done`
  Ein roter Test lädt **nichts** hoch und vergiftet danach den `?v=`-Stempel.
- **Deutsch** in der Oberfläche, **Englisch oder Deutsch** in Kommentaren nach dem
  Ton der Nachbardatei. Domänenwörter (`Reichsstrasse`, `BF`, `Querfeldein`,
  `PATH_SUBTYPE_KEYS`) bleiben unübersetzt (AGENTS.md §2/§8).
- **Der `?v=` an `edit/svg-export.php` wird von HAND gesetzt und bei jeder Änderung
  an dessen CSS/JS erhöht** — der Deploy-Stempler läuft nur `index.html` und
  `html/*.html` ab und erreicht eine `.php`-Seite nie (AGENTS.md §7 Regel 3).
- **Dateiname der Ausgabe:** `avesmaps-karte-JJJJ-MM-TT-illustrator.svg` bzw.
  `…-inkscape.svg`.
- **Koordinaten:** `svg_x = x`, `svg_y = 1024 − y`, `viewBox="0 0 1024 1024"`.
- **Modulform** wie `js/pages/wege-editor-model.js`: flache Funktionen, am Ende
  `if (typeof module !== "undefined" && module.exports) { module.exports = {…}; }`,
  **Tabs** als Einrückung.

---

## Aufgabe 0: Die Sonde — Adobes Maskierung messen

Ohne diese Messung ist jede Zeile in Aufgabe 4 geraten. Sie liefert **eine
Tabelle**, und die ist danach Gesetz.

**Dateien:**
- Anlegen: `docs/superpowers/plans/2026-08-14-svg-export-sondenmessung.md`
- Anlegen (Wegwerf, **nicht** committen): zwei kleine `.svg` im Scratchpad

**Liefert:** die belegte Maskierungstabelle, die Aufgabe 4 einsetzt.

- [ ] **Schritt 1: Die zwei Sondendateien schreiben**

Beide zeigen dieselben fünf Objekte, in zwei Ebenen, mit genau den Zeichen, die
später auftreten: Leerzeichen, Umlaut, scharfes S, Halbgeviert `–`, Klammer.

```svg
<!-- sonde-inkscape.svg -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 200 100">
  <g inkscape:groupmode="layer" inkscape:label="Wege" id="layer-wege">
    <rect id="weg-reichsstrasse-gareth-wehrheim-p1042" inkscape:label="Reichsstraße Gareth–Wehrheim (p1042)" x="10" y="10" width="30" height="20" fill="#884422"/>
    <rect id="weg-wuestenpfad-khom-p77" inkscape:label="Wüstenpfad Khôm" x="50" y="10" width="30" height="20" fill="#bea470"/>
  </g>
  <g inkscape:groupmode="layer" inkscape:label="Orte" id="layer-orte">
    <circle id="ort-gareth-l1" inkscape:label="Gareth" cx="20" cy="60" r="6" fill="#333"/>
    <circle id="ort-fuerstentum-kosch-l2" inkscape:label="Fürstentum Kosch" cx="50" cy="60" r="6" fill="#333"/>
    <circle id="ort-gareth-l3" inkscape:label="Gareth" cx="80" cy="60" r="6" fill="#333"/>
  </g>
</svg>
```

```svg
<!-- sonde-illustrator.svg -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <g id="Wege">
    <rect id="Reichsstraße_x20_Gareth_x2013_Wehrheim_x20__x28_p1042_x29_" x="10" y="10" width="30" height="20" fill="#884422"/>
    <rect id="Wüstenpfad_x20_Khôm" x="50" y="10" width="30" height="20" fill="#bea470"/>
  </g>
  <g id="Orte">
    <circle id="Gareth" cx="20" cy="60" r="6" fill="#333"/>
    <circle id="Fürstentum_x20_Kosch" cx="50" cy="60" r="6" fill="#333"/>
    <circle id="Gareth_x20__x28_2_x29_" cx="80" cy="60" r="6" fill="#333"/>
  </g>
</svg>
```

- [ ] **Schritt 2: 🔧 DU (Owner) — beide Dateien in beiden Programmen öffnen**

Vier Kombinationen, und für jede diese vier Fragen:

1. Wie viele **Ebenen** stehen im Ebenenfenster? (erwartet: 2)
2. Wie heißen die **Objekte** in der Liste — lesbar, oder Slug/`_x20_`-Wurst?
3. Kommen `ß`, `ü`, `ô` und `–` unversehrt an?
4. Was wird aus den **zwei gleichnamigen** „Gareth"?

- [ ] **Schritt 3: Das Ergebnis als Tabelle festschreiben**

In `2026-08-14-svg-export-sondenmessung.md`, mit Datum und der Programmversion.
Die Antwort auf Frage 2 entscheidet, ob Aufgabe 4 `_xHH_` maskiert oder den Namen
roh in die `id` schreibt. **Ergibt die Messung, dass Illustrator lesbare Namen
auch ohne Maskierung zeigt, entfällt die Maskierung** — das ist dann keine
Planabweichung, sondern das gemessene Ergebnis.

- [ ] **Schritt 4: Committen** (nur die Messung, die Sonden-SVGs bleiben draußen)

```bash
git status
git add docs/superpowers/plans/2026-08-14-svg-export-sondenmessung.md
git commit -m "docs(svg-export): gemessen, was Illustrator und Inkscape aus Objektnamen machen"
```

---

## Aufgabe 1: Den Payload vermessen

Der Bauer braucht Feldnamen und Wertemengen. Sie werden **gelesen**, nicht
geraten — ein falscher Feldname erzeugt lautlos eine leere Ebene.

**Dateien:**
- Ergänzen: `docs/superpowers/plans/2026-08-14-svg-export-sondenmessung.md`

**Liefert:** die Feldnamen, die Aufgaben 5–8 einsetzen.

- [ ] **Schritt 1: Auf der Karte einloggen und im Browser messen**

Karte öffnen (der Payload ist dann schon geladen), Konsole:

```js
const r = await fetch("/api/app/map-features.php");
const p = await r.json();
const feats = p.features || p.data?.features || [];
console.log("Schlüssel oberste Ebene:", Object.keys(p));
console.log("Anzahl Features:", feats.length);
const byType = {};
feats.forEach(f => {
  const t = f.properties?.feature_type ?? "(fehlt)";
  (byType[t] ??= new Set()).add(f.properties?.feature_subtype ?? "(kein subtype)");
});
Object.entries(byType).forEach(([t, s]) => console.log(t, "→", [...s].join(", ")));
console.log("Beispiel Ort:", feats.find(f => f.properties?.feature_type === "location")?.properties);
console.log("Beispiel Weg:", feats.find(f => f.geometry?.type === "LineString")?.properties);
console.log("Beispiel Label:", feats.find(f => f.properties?.feature_type === "label")?.properties);
```

- [ ] **Schritt 2: Die drei offenen Feldnamen notieren**

| gesucht | erwartet | gemessen |
|---|---|---|
| öffentliche Kennung eines Features | `public_id`? | |
| Ortsart eines Ortes | `place_kind`? | |
| Beschriftungstext eines Labels | `name`? `text`? | |

- [ ] **Schritt 3: 💣 Die Nord/Süd-Probe**

Die Probe auf die Spiegelung — **vor** dem ersten Zeichnen, weil man einer
30-MB-Datei nicht ansieht, dass sie kopfsteht:

```js
const orte = feats.filter(f => f.properties?.feature_type === "location" && f.geometry?.type === "Point");
const sortiert = [...orte].sort((a, b) => a.geometry.coordinates[1] - b.geometry.coordinates[1]);
console.log("kleinstes y:", sortiert[0].properties.name, sortiert[0].geometry.coordinates);
console.log("größtes  y:", sortiert.at(-1).properties.name, sortiert.at(-1).geometry.coordinates);
```

**Erwartet:** der Ort mit dem **größten y** liegt im **Norden** Aventuriens, der
mit dem kleinsten im Süden. Trifft das zu, ist `svg_y = 1024 − y` belegt. Trifft
es **nicht** zu, ist die Formel falsch und der Plan hält hier an, statt
weiterzubauen.

- [ ] **Schritt 4: Die beiden anderen Endpunkte einmal messen**

```js
for (const url of ["/api/app/political-territories.php?action=layer",
                   "/api/app/ecosystem-areas.php?kind=derographisch",
                   "/api/app/place-kinds.php"]) {
  const d = await (await fetch(url)).json();
  console.log(url, "→", Object.keys(d), JSON.stringify(d).slice(0, 400));
}
```

⚠️ **Einmal, nicht in einer Schleife über Werte.** `political-territories.php` ist
ein Perf-Brennpunkt und hat schon einmal die PHP-Worker gesättigt (CLAUDE.md).

- [ ] **Schritt 5: Committen**

```bash
git status
git add docs/superpowers/plans/2026-08-14-svg-export-sondenmessung.md
git commit -m "docs(svg-export): Payload vermessen -- Feldnamen, Wertemengen, Nord/Sued-Probe"
```

---

## Aufgabe 2: Die Wegefarben herausheben

Der Bauer braucht die acht Wegefarben, und sie liegen heute **in** einer
zoomabhängigen Funktion. Erst herausheben, dann darauf bauen.

**Dateien:**
- Ändern: `js/config.js` (neue Konstante neben `PATH_CENTER_WEIGHTS`)
- Ändern: `js/map-features/map-features.js:249-258` (`centerColors` → Verweis)
- Anlegen: `js/pages/__tests__/path-center-colors.test.js`

**Schnittstellen:**
- Liefert: `PATH_CENTER_COLORS` — Objekt, Schlüssel = die acht `PATH_SUBTYPE_KEYS`,
  Werte = Hex-Strings. Aufgabe 5 liest es.

- [ ] **Schritt 1: Den scheiternden Test schreiben**

```js
// js/pages/__tests__/path-center-colors.test.js
// Die Wegefarben stehen an EINER Stelle. Vorher lagen sie in getPathStyleColors
// (map-features.js), einer Funktion mit map.getZoom() -- unerreichbar für alles,
// was ohne Karte rechnet. Dieser Test hält sie draußen.
//
// Lauf: node js/pages/__tests__/path-center-colors.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const configSrc = fs.readFileSync(path.join(__dirname, "../../config.js"), "utf8");
const featuresSrc = fs.readFileSync(path.join(__dirname, "../../map-features/map-features.js"), "utf8");

assert.ok(/const PATH_CENTER_COLORS\s*=/.test(configSrc),
	"PATH_CENTER_COLORS muss in js/config.js stehen");

const subtypes = ["Reichsstrasse", "Strasse", "Weg", "Pfad",
	"Gebirgspass", "Wuestenpfad", "Flussweg", "Seeweg"];
const block = configSrc.slice(configSrc.indexOf("const PATH_CENTER_COLORS"));
subtypes.forEach((key) => {
	assert.ok(new RegExp(`\\b${key}\\s*:`).test(block.slice(0, 600)),
		`PATH_CENTER_COLORS muss ${key} führen`);
});

// 💣 Der Kern: die alte Tabelle darf NICHT als zweite Wahrheit stehenbleiben.
assert.ok(!/const centerColors\s*=\s*\{[^}]*Reichsstrasse/.test(featuresSrc),
	"getPathStyleColors darf keine eigene Farbtabelle mehr halten");
assert.ok(/PATH_CENTER_COLORS/.test(featuresSrc),
	"getPathStyleColors muss PATH_CENTER_COLORS lesen");

console.log("path-center-colors: ok");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Lauf: `node js/pages/__tests__/path-center-colors.test.js`
Erwartet: FEHLER, „PATH_CENTER_COLORS muss in js/config.js stehen"

- [ ] **Schritt 3: Die Tabelle verschieben**

In `js/config.js`, direkt neben `PATH_CENTER_WEIGHTS` — **dieselben acht Werte,
keiner geändert** (aus `map-features.js:249-258` übernommen):

```js
// Die Mittellinienfarbe je Wegart. Lag bis 14.08.2026 als `centerColors` INNERHALB von
// getPathStyleColors() -- unerreichbar für alles, was ohne map.getZoom() rechnet (der
// SVG-Export). Hier ist die eine Wahrheit; getPathStyleColors liest sie von hier.
// 🔴 Land-Wege außer Reichsstraßen sind heller + entsättigt, Reichsstraßen weiß,
// Wasserwege (Flussweg/Seeweg) unverändert -- die Begründung stand an der alten Stelle.
const PATH_CENTER_COLORS = {
	Reichsstrasse: "#ffffff",
	Strasse: "#8b8b8b",
	Weg: "#cec4ae",
	Pfad: "#9b755a",
	Gebirgspass: "#a8695c",
	Wuestenpfad: "#bea470",
	Flussweg: "#6ec6ff",
	Seeweg: "#2f7dd3",
};
```

In `js/map-features/map-features.js` die lokale Tabelle löschen und die zwei
Nutzungsstellen umbiegen:

```js
	const centerColors = PATH_CENTER_COLORS;
```

⚠️ `js/config.js` wird in `index.html` **vor** `map-features.js` geladen — die
Ladereihenfolge ist ein Vertrag (AGENTS.md §3). Vor dem Commit einmal prüfen:
`grep -n "config.js\|map-features/map-features.js" index.html`

- [ ] **Schritt 4: Test laufen lassen, bestanden bestätigen**

Lauf: `node js/pages/__tests__/path-center-colors.test.js`
Erwartet: `path-center-colors: ok`

- [ ] **Schritt 5: Auf der Karte hinsehen**

🔧 **DU (Owner):** Das ist eine Änderung an der Kartendarstellung — sie soll per
Konstruktion nichts ändern, aber „soll nichts ändern" ist keine Abnahme
(AGENTS.md §9). Karte öffnen, hart neu laden, auf Wege sehen: Reichsstraßen weiß,
Flüsse blau, nichts grau geworden.

- [ ] **Schritt 6: Committen**

```bash
git status
git add js/config.js js/map-features/map-features.js js/pages/__tests__/path-center-colors.test.js
git commit -m "refactor(wege): die acht Wegefarben stehen in config.js, nicht mehr in getPathStyleColors"
```

---

## Aufgabe 3: Der Bauer — Gerüst, Koordinaten, Lizenz

**Dateien:**
- Anlegen: `js/pages/svg-export-build.js`
- Anlegen: `js/pages/__tests__/svg-export-build.test.js`

**Schnittstellen:**
- Liefert:
  - `svgxPoint(x, y)` → `{x: number, y: number}` mit `y = 1024 - y`, beide auf 2 Nachkommastellen
  - `svgxDocumentOpen(dialect)` → String (öffnendes `<svg>` samt Namensräumen und `<metadata>`)
  - `svgxDocumentClose()` → String (`</svg>`)
  - `SVGX_DIALECTS` = `{ ILLUSTRATOR: "illustrator", INKSCAPE: "inkscape" }`
  - `SVGX_VIEWBOX_SIZE` = `1024`

- [ ] **Schritt 1: Den scheiternden Test schreiben**

```js
// js/pages/__tests__/svg-export-build.test.js
// Der reine Bauer des SVG-Exports. Kein DOM, kein fetch -- genau deshalb ist er testbar.
// Entwurf: docs/superpowers/specs/2026-08-14-svg-export-design.md
//
// Lauf: node js/pages/__tests__/svg-export-build.test.js
"use strict";
const assert = require("assert");
const B = require("../svg-export-build.js");

// ---- 1. Koordinaten: die Spiegelung, die man einer 30-MB-Datei nicht ansieht ----
assert.deepStrictEqual(B.svgxPoint(0, 0), { x: 0, y: 1024 },
	"y=0 ist der SÜDrand und muss unten landen");
assert.deepStrictEqual(B.svgxPoint(0, 1024), { x: 0, y: 0 },
	"y=1024 ist der NORDrand und muss oben landen");
assert.deepStrictEqual(B.svgxPoint(512, 512), { x: 512, y: 512 });
assert.deepStrictEqual(B.svgxPoint(1.23456, 2.98765), { x: 1.23, y: 1021.01 },
	"zwei Nachkommastellen, sonst wird die Datei doppelt so groß");

// ---- 2. Der Rahmen ----
const kopfI = B.svgxDocumentOpen(B.SVGX_DIALECTS.ILLUSTRATOR);
const kopfN = B.svgxDocumentOpen(B.SVGX_DIALECTS.INKSCAPE);

[kopfI, kopfN].forEach((kopf) => {
	assert.ok(kopf.includes('viewBox="0 0 1024 1024"'), "viewBox fehlt");
	assert.ok(kopf.includes("http://www.w3.org/2000/svg"), "SVG-Namensraum fehlt");
	assert.ok(/<metadata>/.test(kopf), "<metadata> fehlt");
	assert.ok(/avesmaps\.de/.test(kopf), "die Quell-URL gehört in die Datei");
	assert.ok(/NOTICE\.md|Lizenz/i.test(kopf), "die Lizenz muss mitreisen");
});

// 💣 Der Illustrator-Dialekt darf den Inkscape-Namensraum NICHT führen.
assert.ok(!/inkscape|sodipodi/.test(kopfI),
	"die Illustrator-Datei darf keinen inkscape:/sodipodi:-Namensraum tragen");
assert.ok(/xmlns:inkscape/.test(kopfN),
	"die Inkscape-Datei braucht den inkscape-Namensraum");

assert.strictEqual(B.svgxDocumentClose(), "</svg>\n");

console.log("svg-export-build (Gerüst): ok");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Lauf: `node js/pages/__tests__/svg-export-build.test.js`
Erwartet: FEHLER, `Cannot find module '../svg-export-build.js'`

- [ ] **Schritt 3: Das Gerüst schreiben**

```js
// Der reine Bauer des SVG-Exports: Payload rein, Textstücke raus.
//
// 🔴 KEIN DOM, KEIN fetch, KEIN document. Das ist der Vertrag, und er ist der Grund,
// warum diese Datei testbar ist. Farben kommen als Tafel HEREIN (der Kitt liest sie
// per getComputedStyle aus den Token) -- hier wird keine gelesen und keine erfunden.
//
// Entwurf: docs/superpowers/specs/2026-08-14-svg-export-design.md
"use strict";

const SVGX_VIEWBOX_SIZE = 1024;

const SVGX_DIALECTS = {
	ILLUSTRATOR: "illustrator",
	INKSCAPE: "inkscape",
};

// 💣 GeoJSON speichert [x, y]; Leaflets L.CRS.Simple rechnet [lat, lng] = [y, x] und lässt
// lat NACH OBEN wachsen (deshalb tragen die Kacheldateien negative y). SVG lässt y nach
// UNTEN wachsen. Ohne diese Spiegelung steht die ganze Karte auf dem Kopf -- und das sieht
// man einer 30-MB-Datei nicht an, bevor sie in einem Programm offen ist.
// Zwei Nachkommastellen: bei 1024 Einheiten Kantenlänge ein Hundertstel Bildpunkt.
function svgxPoint(x, y) {
	return {
		x: Math.round(Number(x) * 100) / 100,
		y: Math.round((SVGX_VIEWBOX_SIZE - Number(y)) * 100) / 100,
	};
}

function svgxDocumentOpen(dialect) {
	const inkscapeNs = dialect === SVGX_DIALECTS.INKSCAPE
		? ' xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"'
		: "";
	return '<?xml version="1.0" encoding="UTF-8"?>\n'
		+ '<svg xmlns="http://www.w3.org/2000/svg"'
		+ ' xmlns:xlink="http://www.w3.org/1999/xlink"'
		+ inkscapeNs
		+ ` viewBox="0 0 ${SVGX_VIEWBOX_SIZE} ${SVGX_VIEWBOX_SIZE}"`
		+ ` width="${SVGX_VIEWBOX_SIZE}" height="${SVGX_VIEWBOX_SIZE}">\n`
		// Die Lizenz reist mit: eine SVG geht nach draußen und muss ohne die Website
		// erklären können, woher sie kommt und was erlaubt ist (wie fb763021).
		+ "<metadata>\n"
		+ "  Avesmaps — https://avesmaps.de\n"
		+ "  Nicht-kommerzielles Fanprojekt zu Das Schwarze Auge / Aventurien.\n"
		+ "  Lizenz und Hinweise: https://avesmaps.de/NOTICE.md\n"
		+ "</metadata>\n";
}

function svgxDocumentClose() {
	return "</svg>\n";
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		SVGX_VIEWBOX_SIZE: SVGX_VIEWBOX_SIZE,
		SVGX_DIALECTS: SVGX_DIALECTS,
		svgxPoint: svgxPoint,
		svgxDocumentOpen: svgxDocumentOpen,
		svgxDocumentClose: svgxDocumentClose,
	};
}
```

- [ ] **Schritt 4: Test laufen lassen, bestanden bestätigen**

Lauf: `node js/pages/__tests__/svg-export-build.test.js`
Erwartet: `svg-export-build (Gerüst): ok`

- [ ] **Schritt 5: Committen**

```bash
git status
git add js/pages/svg-export-build.js js/pages/__tests__/svg-export-build.test.js
git commit -m "feat(svg-export): Geruest des Bauers -- viewBox, Spiegelung, Lizenz im Kopf"
```

---

## Aufgabe 4: Namen und Dialekt

**Dateien:**
- Ändern: `js/pages/svg-export-build.js`
- Ändern: `js/pages/__tests__/svg-export-build.test.js`

**Schnittstellen:**
- Liefert:
  - `svgxIdFor(name, publicId, dialect, seen)` → String. **Die einzige Stelle, an
    der eine `id` entsteht.** `seen` ist ein `Set`, das Doppelte auffängt.
  - `svgxGroupOpen({name, id, dialect, attrs})` → String
  - `svgxGroupClose()` → String
  - `svgxLayerOpen({name, id, dialect, attrs})` → wie oben, plus
    `inkscape:groupmode="layer"` im Inkscape-Dialekt
  - `svgxEscapeText(s)` → String (`&`, `<`, `>`, `"` maskiert)

> 💣 **`svgxIdFor` ist die einzige Quelle jeder `id`.** Aufgabe 8 ruft dieselbe
> Funktion für den `<textPath href>` — schreibt sie den Namen ein zweites Mal
> zusammen, zeigt jeder Verweis ins Leere und **die komplette Beschriftungsebene
> ist unsichtbar**, in einer Datei, die sonst tadellos aussieht.

> ⚠️ **Die Maskierung im Illustrator-Zweig kommt aus Aufgabe 0.** Ergab die Sonde,
> dass Illustrator Namen auch ohne `_xHH_` lesbar zeigt, wird hier **nicht**
> maskiert. Der Code unten zeigt die maskierende Fassung; sie ist zu streichen,
> wenn die Messung das sagt.

- [ ] **Schritt 1: Die scheiternden Tests anhängen**

```js
// ---- 3. Namen: zwei Dialekte, eine Quelle ----
const D = B.SVGX_DIALECTS;

// Inkscape: reiner ASCII-Slug, öffentliche Kennung angehängt
{
	const seen = new Set();
	const id = B.svgxIdFor("Reichsstraße Gareth–Wehrheim", "p1042", D.INKSCAPE, seen);
	assert.ok(/^[A-Za-z0-9_-]+$/.test(id), `Inkscape-id muss reines ASCII sein, war: ${id}`);
	assert.ok(id.includes("p1042"), "die öffentliche Kennung gehört in die id");
	assert.ok(/reichsstrasse/i.test(id), "ue/ss-Faltung: 'ß' wird 'ss', nicht weggeworfen");
}

// 💣 Zwei gleichnamige Orte ergeben ZWEI ids -- in beiden Dialekten.
[D.INKSCAPE, D.ILLUSTRATOR].forEach((dialect) => {
	const seen = new Set();
	const a = B.svgxIdFor("Gareth", "l1", dialect, seen);
	const b = B.svgxIdFor("Gareth", "l2", dialect, seen);
	assert.notStrictEqual(a, b, `${dialect}: gleichnamige Objekte brauchen verschiedene ids`);
});

// Eine id enthält nie ein Leerzeichen -- das ist in XML schlicht ungültig.
[D.INKSCAPE, D.ILLUSTRATOR].forEach((dialect) => {
	const id = B.svgxIdFor("Fürstentum Kosch", "t7", dialect, new Set());
	assert.ok(!/\s/.test(id), `${dialect}: eine id darf kein Leerzeichen tragen`);
});

// ---- 4. Gruppen und Ebenen ----
{
	const ebeneN = B.svgxLayerOpen({ name: "Wege", id: "layer-wege", dialect: D.INKSCAPE });
	assert.ok(ebeneN.includes('inkscape:groupmode="layer"'), "Inkscape braucht groupmode");
	assert.ok(ebeneN.includes('inkscape:label="Wege"'), "Inkscape liest den Namen aus dem label");

	const ebeneI = B.svgxLayerOpen({ name: "Wege", id: "Wege", dialect: D.ILLUSTRATOR });
	assert.ok(!/inkscape/.test(ebeneI), "der Illustrator-Zweig führt kein inkscape:");
	assert.ok(ebeneI.includes('id="Wege"'), "Illustrator liest den Namen aus der id");

	assert.strictEqual(B.svgxGroupClose(), "</g>\n");
}

// Stil hängt an der GRUPPE, nicht am Einzelelement -- ein Griff färbt alle Reichsstraßen.
{
	const g = B.svgxGroupOpen({
		name: "Reichsstrasse", id: "wege-reichsstrasse", dialect: D.INKSCAPE,
		attrs: { stroke: "#ffffff", "stroke-width": "1.4", fill: "none" },
	});
	assert.ok(g.includes('stroke="#ffffff"') && g.includes('fill="none"'),
		"die Gruppe trägt den Stil");
}

// ---- 5. Text maskieren: ein & im Ortsnamen darf die Datei nicht zerreißen ----
assert.strictEqual(B.svgxEscapeText('Fels & Fluss <"x">'),
	"Fels &amp; Fluss &lt;&quot;x&quot;&gt;");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Lauf: `node js/pages/__tests__/svg-export-build.test.js`
Erwartet: FEHLER, `B.svgxIdFor is not a function`

- [ ] **Schritt 3: Implementieren**

```js
// 💣 DIESE FALTUNG IST NICHT DIE wiki_key-FALTUNG. avesmapsFoldToAscii()
// (api/_internal/text/ascii-fold.php) bildet den Server nach -- dort verlieren Umlaute
// ihren Grundbuchstaben ('Fürstentum Kosch' -> 'f-rstentum-kosch'), und sie darf laut
// AGENTS.md §5 nie "schöner" gemacht werden, weil jede Änderung eine Datenmigration über
// ~10 Tabellen ist. HIER entsteht ein neuer, eigener Namensraum: er joint nirgends und
// wird nie in eine Zeile geschrieben. Also normal falten. Wer für eine id nach
// avesmapsFoldToAscii greift, greift nach der falschen Funktion.
const SVGX_FOLD = {
	"ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss",
	"á": "a", "à": "a", "â": "a", "é": "e", "è": "e", "ê": "e",
	"í": "i", "ì": "i", "î": "i", "ó": "o", "ò": "o", "ô": "o",
	"ú": "u", "ù": "u", "û": "u", "ç": "c", "ñ": "n",
	"–": "-", "—": "-", "’": "", "'": "",
};

function svgxFoldAscii(text) {
	return String(text == null ? "" : text)
		// Alles AUSSERHALB des druckbaren ASCII durch die Tabelle; was dort fehlt, wird ein
		// Bindestrich. 💣 NICHT als /[^ -]/ schreiben -- das waere die Klasse "weder Leerzeichen
		// noch Bindestrich" und schickte JEDEN Buchstaben durch die Faltung.
		.replace(/[^\x20-\x7E]/g, (ch) => (SVGX_FOLD[ch] !== undefined ? SVGX_FOLD[ch] : "-"))
		.replace(/[^A-Za-z0-9_-]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-|-$/g, "");
}

// Illustrators eigene Maskierung: alles, was in einem XML-Namen nicht erlaubt ist, wird
// _xHH_. ⚠️ Ob Illustrator das beim Import zurückverwandelt, ist GEMESSEN, nicht geraten
// -- siehe Aufgabe 0 des Bauplans. Ergab die Messung, dass es ohne geht: streichen.
function svgxAdobeEscape(text) {
	return String(text == null ? "" : text).replace(/[^A-Za-z0-9À-ɏ_-]/g, (ch) => {
		const hex = ch.codePointAt(0).toString(16).toUpperCase();
		return `_x${hex}_`;
	});
}

// 🔴 DIE EINZIGE STELLE, AN DER EINE id ENTSTEHT. Aufgabe 8 (Beschriftungen) ruft
// dieselbe Funktion für ihren <textPath href> -- ein zweiter Zusammenbau des Namens
// würde jeden Verweis ins Leere zeigen lassen und die ganze Beschriftungsebene
// unsichtbar machen, in einer Datei, die sonst tadellos aussieht.
function svgxIdFor(name, publicId, dialect, seen) {
	const kennung = String(publicId == null ? "" : publicId);
	let id = dialect === SVGX_DIALECTS.ILLUSTRATOR
		? svgxAdobeEscape(name)
		: [svgxFoldAscii(name), svgxFoldAscii(kennung)].filter(Boolean).join("-");

	if (!id) { id = "objekt"; }
	if (/^[^A-Za-z_]/.test(id)) { id = `x${id}`; }  // XML: ein Name beginnt nie mit einer Ziffer

	if (seen && seen.has(id)) {
		// Erst die öffentliche Kennung, dann ein Zähler -- damit zwei "Gareth" nie
		// dieselbe id bekommen und der textPath-Verweis eindeutig bleibt.
		const mitKennung = kennung ? `${id}${svgxAdobeEscapeSafeJoin(dialect)}${svgxFoldAscii(kennung)}` : id;
		id = mitKennung;
		let n = 2;
		while (seen.has(id)) { id = `${mitKennung}-${n}`; n += 1; }
	}
	if (seen) { seen.add(id); }
	return id;
}

function svgxAdobeEscapeSafeJoin(dialect) {
	return dialect === SVGX_DIALECTS.ILLUSTRATOR ? "_x20_" : "-";
}

function svgxEscapeText(text) {
	return String(text == null ? "" : text)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function svgxAttrs(attrs) {
	return Object.entries(attrs || {})
		.filter(([, v]) => v !== undefined && v !== null && v !== "")
		.map(([k, v]) => ` ${k}="${svgxEscapeText(v)}"`)
		.join("");
}

function svgxGroupOpen(options) {
	const o = options || {};
	const label = o.dialect === SVGX_DIALECTS.INKSCAPE
		? ` inkscape:label="${svgxEscapeText(o.name)}"`
		: "";
	return `<g id="${svgxEscapeText(o.id)}"${label}${svgxAttrs(o.attrs)}>\n`;
}

function svgxLayerOpen(options) {
	const o = options || {};
	const modus = o.dialect === SVGX_DIALECTS.INKSCAPE ? ' inkscape:groupmode="layer"' : "";
	const label = o.dialect === SVGX_DIALECTS.INKSCAPE
		? ` inkscape:label="${svgxEscapeText(o.name)}"`
		: "";
	return `<g id="${svgxEscapeText(o.id)}"${modus}${label}${svgxAttrs(o.attrs)}>\n`;
}

function svgxGroupClose() {
	return "</g>\n";
}
```

Und die neuen Namen an `module.exports` anhängen.

- [ ] **Schritt 4: Test laufen lassen, bestanden bestätigen**

Lauf: `node js/pages/__tests__/svg-export-build.test.js`

- [ ] **Schritt 5: Committen**

```bash
git status
git add js/pages/svg-export-build.js js/pages/__tests__/svg-export-build.test.js
git commit -m "feat(svg-export): zwei Dialekte -- Illustrator liest id, Inkscape liest inkscape:label"
```

---

## Aufgabe 5: Die Linien-Ebenen (Wege, Kraftlinien)

**Dateien:**
- Ändern: `js/pages/svg-export-build.js`
- Ändern: `js/pages/__tests__/svg-export-build.test.js`

**Schnittstellen:**
- Verbraucht: `svgxPoint`, `svgxIdFor`, `svgxGroupOpen/Close`, `svgxLayerOpen`
- Liefert:
  - `svgxPathData(coordinates)` → String für das `d`-Attribut
  - `svgxWayLayer({features, subtypes, colors, widths, dialect, seen})` → Array von Textstücken
  - `svgxLastWayIds()` → `Map<public_id, id>` — die im letzten `svgxWayLayer`-Lauf
    vergebenen `id`. **Aufgabe 8 liest sie für ihre `<textPath href>`.**
  - `svgxPowerlineLayer({features, color, width, dialect, seen})` → Array von Textstücken

> 💣 **`subtypes` wird HEREINGEREICHT, nicht abgeschrieben.** Es ist
> `PATH_SUBTYPE_KEYS` aus `js/config.js` mit **acht** Werten. Ein früherer Entwurf
> der Tabelle vergaß „Weg" — die Gruppe hätte einfach gefehlt, und niemand hätte
> es gemerkt. Dasselbe gilt für die Farbtafel (`PATH_CENTER_COLORS`, Aufgabe 2).

> ⚠️ **Flüsse sind keine eigene Ebene.** Sie sind Wege mit
> `feature_subtype === "Flussweg"` und erscheinen als Untergruppe unter den Wegen
> (wie `map-features-river-flow-arrows.js` es auch prüft).

- [ ] **Schritt 1: Die scheiternden Tests anhängen**

```js
// ---- 6. Linien ----
assert.strictEqual(
	B.svgxPathData([[0, 1024], [10, 1014], [20, 1024]]),
	"M0 0L10 10L20 0",
	"Pfaddaten: gespiegelt, gerundet, ohne Schnörkel");

{
	const wege = [
		{ properties: { feature_type: "path", feature_subtype: "Reichsstrasse", name: "Reichsstraße Gareth–Wehrheim", public_id: "p1" },
		  geometry: { type: "LineString", coordinates: [[0, 1024], [10, 1014]] } },
		{ properties: { feature_type: "path", feature_subtype: "Flussweg", name: "Großer Fluss", public_id: "p2" },
		  geometry: { type: "LineString", coordinates: [[5, 1000], [6, 999]] } },
	];
	const stuecke = B.svgxWayLayer({
		features: wege,
		subtypes: ["Reichsstrasse", "Strasse", "Weg", "Pfad", "Gebirgspass", "Wuestenpfad", "Flussweg", "Seeweg"],
		colors: { Reichsstrasse: "#ffffff", Flussweg: "#6ec6ff" },
		widths: { Reichsstrasse: 1.4, Flussweg: 1.0 },
		dialect: B.SVGX_DIALECTS.INKSCAPE,
		seen: new Set(),
	});
	const svg = stuecke.join("");

	assert.ok(svg.includes('inkscape:label="Reichsstrasse"'), "Untergruppe Reichsstrasse fehlt");
	assert.ok(svg.includes('inkscape:label="Flussweg"'), "Flüsse sind die Untergruppe Flussweg");
	assert.ok(svg.includes('stroke="#6ec6ff"'), "die Farbe hängt an der Untergruppe");
	assert.ok(svg.includes("<title>Reichsstraße Gareth–Wehrheim</title>"),
		"<title> trägt den echten Namen, mit Umlaut");

	// 💣 Eine leere Untergruppe wird GAR NICHT geschrieben -- sonst stehen im
	// Ebenenfenster sechs leere Ordner und der Nutzer sucht den Fehler bei sich.
	assert.ok(!svg.includes('inkscape:label="Seeweg"'),
		"eine Wegart ohne Wege erzeugt keine leere Gruppe");
}
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

Lauf: `node js/pages/__tests__/svg-export-build.test.js`
Erwartet: FEHLER, `B.svgxPathData is not a function`

- [ ] **Schritt 3: Implementieren**

```js
function svgxPathData(coordinates) {
	const punkte = (coordinates || []).map(([x, y]) => svgxPoint(x, y));
	if (punkte.length === 0) { return ""; }
	return punkte
		.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`)
		.join("");
}

// Die Wege, gruppiert nach Wegart. `subtypes` ist PATH_SUBTYPE_KEYS -- die Reihenfolge
// dort ist die Reihenfolge hier, damit die Ebenenliste jedes Mal gleich aussieht.
// ⚠️ Flüsse sind KEINE eigene Ebene: sie sind die Untergruppe 'Flussweg'.
function svgxWayLayer(options) {
	const o = options || {};
	const stuecke = [];
	const nachArt = new Map();
	(o.features || []).forEach((f) => {
		if (f?.geometry?.type !== "LineString") { return; }
		const art = f.properties?.feature_subtype || "Weg";
		if (!nachArt.has(art)) { nachArt.set(art, []); }
		nachArt.get(art).push(f);
	});

	stuecke.push(svgxLayerOpen({ name: "Wege", id: "layer-wege", dialect: o.dialect }));
	(o.subtypes || []).forEach((art) => {
		const wege = nachArt.get(art);
		// Eine leere Untergruppe wird gar nicht erst geschrieben: sechs leere Ordner im
		// Ebenenfenster lesen sich wie ein Fehler, obwohl nur nichts da war.
		if (!wege || wege.length === 0) { return; }
		stuecke.push(svgxGroupOpen({
			name: art,
			id: `wege-${svgxFoldAscii(art).toLowerCase()}`,
			dialect: o.dialect,
			attrs: {
				fill: "none",
				stroke: (o.colors || {})[art] || "#888888",
				"stroke-width": String((o.widths || {})[art] || 1),
				"stroke-linejoin": "round",
				"stroke-linecap": "round",
			},
		}));
		wege.forEach((f) => {
			const name = f.properties?.name || art;
			const id = svgxIdFor(name, f.properties?.public_id, o.dialect, o.seen);
			const label = o.dialect === SVGX_DIALECTS.INKSCAPE
				? ` inkscape:label="${svgxEscapeText(name)}"`
				: "";
			stuecke.push(`<path id="${svgxEscapeText(id)}"${label} d="${svgxPathData(f.geometry.coordinates)}">`
				+ `<title>${svgxEscapeText(name)}</title></path>\n`);
		});
		stuecke.push(svgxGroupClose());
	});
	stuecke.push(svgxGroupClose());
	return stuecke;
}
```

Dazu die Merkliste, die Aufgabe 8 braucht — sie wird **in `svgxWayLayer` gefüllt**,
direkt neben dem `svgxIdFor`-Aufruf (`svgxLastWayIdMap.set(f.properties?.public_id, id)`),
und die Karte wird zu Beginn jedes Laufs geleert:

```js
// 🔴 Die id jedes Weges, gemerkt für die Beschriftungsebene. Sie darf den Namen NICHT
// ein zweites Mal zusammensetzen -- ein abweichender href zeigt ins Leere und macht die
// ganze Beschriftungsebene unsichtbar, in einer sonst tadellosen Datei.
let svgxLastWayIdMap = new Map();

function svgxLastWayIds() {
	return svgxLastWayIdMap;
}
```

Und die Kraftlinien — dieselbe Form, aber **ohne** Untergruppen, weil es nur eine Art gibt:

```js
function svgxPowerlineLayer(options) {
	const o = options || {};
	const linien = (o.features || []).filter(
		(f) => f?.properties?.feature_type === "powerline" && f?.geometry?.type === "LineString");
	const stuecke = [svgxLayerOpen({
		name: "Kraftlinien", id: "layer-kraftlinien", dialect: o.dialect,
		attrs: {
			fill: "none",
			stroke: o.color || "#7a5ea8",
			"stroke-width": String(o.width || 0.8),
			"stroke-linejoin": "round",
		},
	})];
	linien.forEach((f) => {
		const name = f.properties?.name || "Kraftlinie";
		const id = svgxIdFor(name, f.properties?.public_id, o.dialect, o.seen);
		const label = o.dialect === SVGX_DIALECTS.INKSCAPE
			? ` inkscape:label="${svgxEscapeText(name)}"`
			: "";
		stuecke.push(`<path id="${svgxEscapeText(id)}"${label} d="${svgxPathData(f.geometry.coordinates)}">`
			+ `<title>${svgxEscapeText(name)}</title></path>\n`);
	});
	stuecke.push(svgxGroupClose());
	return stuecke;
}
```

⚠️ **Feldnamen aus Aufgabe 1 einsetzen.** Steht dort ein anderer Name als
`public_id`, wird er hier eingesetzt — der Test oben zieht mit.

- [ ] **Schritt 4: Test laufen lassen, bestanden bestätigen**
- [ ] **Schritt 5: Committen**

```bash
git status
git add js/pages/svg-export-build.js js/pages/__tests__/svg-export-build.test.js
git commit -m "feat(svg-export): Wege nach Wegart gruppiert, Kraftlinien als eigene Ebene"
```

---

## Aufgabe 6: Die Flächen-Ebenen (Landschaften, Regionen, Herrschaftsgebiete)

**Dateien:**
- Ändern: `js/pages/svg-export-build.js`
- Ändern: `js/pages/__tests__/svg-export-build.test.js`

**Schnittstellen:**
- Liefert:
  - `svgxPolygonData(geometry)` → String — nimmt **Polygon UND MultiPolygon**,
    Löcher als weitere Unterpfade mit `fill-rule="evenodd"`
  - `svgxAreaLayer({features, layerName, layerId, groupBy, colors, dialect, seen})`

> 💣 **Ein Loch ist ein zweiter Ring, kein zweites Polygon.** Ein Polygon hat
> `coordinates[0]` als Außenring und **jeden weiteren Eintrag als Loch** — eine
> Binnensee-Fläche in einem Kontinent. Wer nur `coordinates[0]` zeichnet, füllt
> die Löcher zu, und die Karte sieht auf den ersten Blick richtig aus. Deshalb
> gehören beide Formen in den Test.

- [ ] **Schritt 1: Die scheiternden Tests anhängen**

```js
// ---- 7. Flächen: Polygon, MultiPolygon, und das Loch ----
{
	const quadrat = [[0, 1024], [10, 1024], [10, 1014], [0, 1014], [0, 1024]];
	const loch = [[2, 1022], [4, 1022], [4, 1020], [2, 1020], [2, 1022]];

	const einfach = B.svgxPolygonData({ type: "Polygon", coordinates: [quadrat] });
	assert.ok(einfach.startsWith("M0 0") && einfach.endsWith("Z"), `unerwartet: ${einfach}`);

	// 💣 Das Loch muss als ZWEITER Unterpfad auftauchen, sonst wird es zugefüllt.
	const mitLoch = B.svgxPolygonData({ type: "Polygon", coordinates: [quadrat, loch] });
	assert.strictEqual((mitLoch.match(/Z/g) || []).length, 2,
		"ein Polygon mit Loch braucht zwei geschlossene Unterpfade");

	const multi = B.svgxPolygonData({ type: "MultiPolygon", coordinates: [[quadrat], [quadrat]] });
	assert.strictEqual((multi.match(/Z/g) || []).length, 2, "MultiPolygon wird nicht halbiert");
}

{
	const flaechen = [
		{ properties: { name: "Das Ehrenfeld", public_id: "e1", region_type: "kontinent" },
		  geometry: { type: "Polygon", coordinates: [[[0, 1024], [10, 1024], [10, 1014], [0, 1024]]] } },
	];
	const svg = B.svgxAreaLayer({
		features: flaechen, layerName: "Landschaften", layerId: "layer-landschaften",
		groupBy: (f) => f.properties.region_type,
		colors: { kontinent: "#e8dcc0" },
		dialect: B.SVGX_DIALECTS.ILLUSTRATOR, seen: new Set(),
	}).join("");

	assert.ok(!/inkscape/.test(svg), "der Illustrator-Zweig führt kein inkscape:");
	assert.ok(svg.includes('fill="#e8dcc0"'), "die Füllung hängt an der Untergruppe");
	assert.ok(svg.includes("<title>Das Ehrenfeld</title>"));
}
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**
- [ ] **Schritt 3: Implementieren**

```js
function svgxRingData(ring) {
	const d = svgxPathData(ring);
	return d ? `${d}Z` : "";
}

// 💣 coordinates[0] ist der Außenring, JEDER WEITERE Eintrag ist ein LOCH. Wer nur den
// ersten zeichnet, füllt Binnenseen zu -- und die Karte sieht dabei richtig aus.
// fill-rule="evenodd" an der Gruppe macht aus dem zweiten Ring das Loch.
function svgxPolygonData(geometry) {
	const typ = geometry?.type;
	const coords = geometry?.coordinates || [];
	const polygone = typ === "MultiPolygon" ? coords : (typ === "Polygon" ? [coords] : []);
	return polygone
		.map((polygon) => (polygon || []).map(svgxRingData).filter(Boolean).join(""))
		.filter(Boolean)
		.join("");
}

function svgxAreaLayer(options) {
	const o = options || {};
	const stuecke = [svgxLayerOpen({ name: o.layerName, id: o.layerId, dialect: o.dialect })];
	const gruppen = new Map();
	(o.features || []).forEach((f) => {
		const schluessel = (typeof o.groupBy === "function" ? o.groupBy(f) : "") || "";
		if (!gruppen.has(schluessel)) { gruppen.set(schluessel, []); }
		gruppen.get(schluessel).push(f);
	});

	gruppen.forEach((flaechen, schluessel) => {
		const gruppenId = `${o.layerId}-${svgxFoldAscii(schluessel).toLowerCase() || "ohne"}`;
		stuecke.push(svgxGroupOpen({
			name: schluessel || o.layerName, id: gruppenId, dialect: o.dialect,
			attrs: {
				fill: (o.colors || {})[schluessel] || "none",
				"fill-rule": "evenodd",
				stroke: "none",
			},
		}));
		flaechen.forEach((f) => {
			const d = svgxPolygonData(f.geometry);
			if (!d) { return; }
			const name = f.properties?.name || schluessel || o.layerName;
			const id = svgxIdFor(name, f.properties?.public_id, o.dialect, o.seen);
			const label = o.dialect === SVGX_DIALECTS.INKSCAPE
				? ` inkscape:label="${svgxEscapeText(name)}"`
				: "";
			stuecke.push(`<path id="${svgxEscapeText(id)}"${label} d="${d}">`
				+ `<title>${svgxEscapeText(name)}</title></path>\n`);
		});
		stuecke.push(svgxGroupClose());
	});
	stuecke.push(svgxGroupClose());
	return stuecke;
}
```

Dieselbe Funktion bedient alle drei Flächen-Ebenen — Landschaften (`groupBy` =
`region_type`), Regionen (`groupBy` = konstant), Herrschaftsgebiete (`groupBy` =
Rang). **Kein zweiter Flächenzeichner.**

- [ ] **Schritt 4: Test laufen lassen, bestanden bestätigen**
- [ ] **Schritt 5: Committen**

```bash
git status
git add js/pages/svg-export-build.js js/pages/__tests__/svg-export-build.test.js
git commit -m "feat(svg-export): Flaechen-Ebenen -- Landschaften, Regionen, Herrschaftsgebiete, Loecher inklusive"
```

---

## Aufgabe 7: Die Orte

**Dateien:**
- Ändern: `js/pages/svg-export-build.js`
- Ändern: `js/pages/__tests__/svg-export-build.test.js`

**Schnittstellen:**
- Liefert: `svgxPlaceLayer({features, kinds, radii, colors, dialect, seen})`

> 💣 **`kinds` kommt aus `api/app/place-kinds.php`, nicht aus einer Liste im Code.**
> Die Ortsarten sind **ein** Katalog — das hat das Projekt schon einmal teuer
> gelernt. Eine neue Ortsart taucht dann von selbst als Untergruppe auf.

> ⚠️ **Kreuzungen (`feature_type === "junction"`) gehören nicht in die Datei.**
> Sie sind Routing-Knoten mit Namen wie `Kreuzung-1873`; ihre Geometrie steckt
> ohnehin in den Wegen. Der Test hält das fest.

- [ ] **Schritt 1: Die scheiternden Tests anhängen**

```js
// ---- 8. Orte ----
{
	const orte = [
		{ properties: { feature_type: "location", place_kind: "metropole", name: "Gareth", public_id: "l1" },
		  geometry: { type: "Point", coordinates: [100, 900] } },
		{ properties: { feature_type: "location", place_kind: "dorf", name: "Angbar", public_id: "l2" },
		  geometry: { type: "Point", coordinates: [200, 800] } },
		// 💣 Muss draußen bleiben.
		{ properties: { feature_type: "junction", name: "Kreuzung-1873", public_id: "j1" },
		  geometry: { type: "Point", coordinates: [300, 700] } },
	];
	const svg = B.svgxPlaceLayer({
		features: orte,
		kinds: [{ slug: "metropole", label: "Metropole" }, { slug: "dorf", label: "Dorf" }],
		radii: { metropole: 3, dorf: 1.2 },
		colors: { metropole: "#3b2a18", dorf: "#3b2a18" },
		dialect: B.SVGX_DIALECTS.INKSCAPE, seen: new Set(),
	}).join("");

	assert.ok(svg.includes('inkscape:label="Metropole"'), "Untergruppe je Ortsart");
	assert.ok(svg.includes('cx="100" cy="124"'), "Ortspunkt gespiegelt (1024-900)");
	assert.ok(!svg.includes("Kreuzung-1873"), "Kreuzungen gehören nicht in die Datei");
}
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**
- [ ] **Schritt 3: Implementieren**

```js
function svgxPlaceLayer(options) {
	const o = options || {};
	// 💣 Der Filter ist zweifach: feature_type UND geometry.type. Eine Kreuzung ist
	// auch ein Point -- genau daran ist im Projekt schon einmal etwas vorbeigerutscht
	// (Discord #48: "Geometrie entscheidet die FORM, feature_type die ART").
	const nachArt = new Map();
	(o.features || []).forEach((f) => {
		if (f?.properties?.feature_type !== "location") { return; }
		if (f?.geometry?.type !== "Point") { return; }
		const art = f.properties?.place_kind || "";
		if (!nachArt.has(art)) { nachArt.set(art, []); }
		nachArt.get(art).push(f);
	});

	const stuecke = [svgxLayerOpen({ name: "Orte", id: "layer-orte", dialect: o.dialect })];
	// In KATALOGreihenfolge, damit das Ebenenfenster jedes Mal gleich aussieht.
	(o.kinds || []).forEach((kind) => {
		const orte = nachArt.get(kind.slug);
		if (!orte || orte.length === 0) { return; }   // keine leeren Ordner
		stuecke.push(svgxGroupOpen({
			name: kind.label || kind.slug,
			id: `orte-${svgxFoldAscii(kind.slug).toLowerCase()}`,
			dialect: o.dialect,
			attrs: { fill: (o.colors || {})[kind.slug] || "#3b2a18", stroke: "none" },
		}));
		orte.forEach((f) => {
			const p = svgxPoint(f.geometry.coordinates[0], f.geometry.coordinates[1]);
			const name = f.properties?.name || (kind.label || kind.slug);
			const id = svgxIdFor(name, f.properties?.public_id, o.dialect, o.seen);
			const label = o.dialect === SVGX_DIALECTS.INKSCAPE
				? ` inkscape:label="${svgxEscapeText(name)}"`
				: "";
			stuecke.push(`<circle id="${svgxEscapeText(id)}"${label}`
				+ ` cx="${p.x}" cy="${p.y}" r="${(o.radii || {})[kind.slug] || 1}">`
				+ `<title>${svgxEscapeText(name)}</title></circle>\n`);
		});
		stuecke.push(svgxGroupClose());
	});
	stuecke.push(svgxGroupClose());
	return stuecke;
}
```
- [ ] **Schritt 4: Test laufen lassen, bestanden bestätigen**
- [ ] **Schritt 5: Committen**

```bash
git status
git add js/pages/svg-export-build.js js/pages/__tests__/svg-export-build.test.js
git commit -m "feat(svg-export): Orte nach Ortsart gruppiert, Kreuzungen bleiben draussen"
```

---

## Aufgabe 8: Die Beschriftungen — und die Kopplung, die alles verschluckt

**Dateien:**
- Ändern: `js/pages/svg-export-build.js`
- Ändern: `js/pages/__tests__/svg-export-build.test.js`

**Schnittstellen:**
- Liefert: `svgxLabelLayer({places, ways, labels, wayIds, dialect, seen, fontFamily})`
  — `wayIds` ist die **Map von Weg-Feature auf die in Aufgabe 5 vergebene `id`**.

> 💣 **`id` und `href` sind EIN Wert an zwei Stellen.** Der Wegname wird hier
> **nicht** neu zusammengesetzt. Aufgabe 5 gibt die vergebenen `id` als Map
> heraus, diese Ebene liest sie. Läuft das auseinander, zeigt jeder `href` ins
> Leere und die **komplette Beschriftungsebene ist unsichtbar** — in einer Datei,
> die sonst tadellos aussieht. Der Test unten ist die einzige Wache davor.

- [ ] **Schritt 1: Die scheiternden Tests anhängen**

```js
// ---- 9. Beschriftungen ----
{
	const seen = new Set();
	const weg = { properties: { feature_type: "path", feature_subtype: "Reichsstrasse", name: "Reichsstraße Gareth–Wehrheim", public_id: "p1" },
	              geometry: { type: "LineString", coordinates: [[0, 1024], [10, 1014]] } };
	const wegStuecke = B.svgxWayLayer({
		features: [weg], subtypes: ["Reichsstrasse"], colors: {}, widths: {},
		dialect: B.SVGX_DIALECTS.INKSCAPE, seen,
	});
	const wegIds = B.svgxLastWayIds();   // die in svgxWayLayer vergebenen ids

	const labelStuecke = B.svgxLabelLayer({
		places: [{ properties: { feature_type: "location", name: "Gareth", public_id: "l1" },
		           geometry: { type: "Point", coordinates: [100, 900] } }],
		ways: [weg], wayIds: wegIds, labels: [],
		dialect: B.SVGX_DIALECTS.INKSCAPE, seen, fontFamily: "serif",
	});

	const ganzeDatei = wegStuecke.join("") + labelStuecke.join("");

	// 💣 DIE PROBE: jeder href muss auf eine id zeigen, die in DERSELBEN Datei vorkommt.
	const hrefs = [...ganzeDatei.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
	assert.ok(hrefs.length > 0, "es muss mindestens einen textPath geben");
	hrefs.forEach((h) => {
		assert.ok(ganzeDatei.includes(`id="${h}"`),
			`href="#${h}" zeigt ins Leere -- die Beschriftungsebene wäre unsichtbar`);
	});

	assert.ok(ganzeDatei.includes("Gareth"), "Ortsnamen fehlen");
}
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**
- [ ] **Schritt 3: Implementieren**

```js
function svgxLabelLayer(options) {
	const o = options || {};
	const schrift = { "font-family": o.fontFamily || "serif", fill: o.color || "#3b2a18" };
	const stuecke = [svgxLayerOpen({
		name: "Beschriftungen", id: "layer-beschriftungen", dialect: o.dialect, attrs: schrift,
	})];

	// --- Ortsnamen: schlichter Text am Ankerpunkt ---
	stuecke.push(svgxGroupOpen({
		name: "Orte", id: "beschriftung-orte", dialect: o.dialect,
		attrs: { "font-size": "3", "text-anchor": "middle" },
	}));
	(o.places || []).forEach((f) => {
		if (f?.geometry?.type !== "Point") { return; }
		const name = f.properties?.name;
		if (!name) { return; }
		const p = svgxPoint(f.geometry.coordinates[0], f.geometry.coordinates[1]);
		const id = svgxIdFor(`${name}-Beschriftung`, f.properties?.public_id, o.dialect, o.seen);
		const label = o.dialect === SVGX_DIALECTS.INKSCAPE
			? ` inkscape:label="${svgxEscapeText(name)}"`
			: "";
		// y um 4 versetzt, damit der Name unter dem Punkt steht und ihn nicht verdeckt.
		stuecke.push(`<text id="${svgxEscapeText(id)}"${label} x="${p.x}" y="${p.y + 4}">`
			+ `${svgxEscapeText(name)}</text>\n`);
	});
	stuecke.push(svgxGroupClose());

	// --- Wegnamen: SVGs eigener Mechanismus, entlang der Linie ---
	stuecke.push(svgxGroupOpen({
		name: "Wege", id: "beschriftung-wege", dialect: o.dialect, attrs: { "font-size": "2.4" },
	}));
	(o.ways || []).forEach((f) => {
		const name = f.properties?.name;
		if (!name) { return; }
		// 🔴 DIE KOPPLUNG. Die id wird NICHT neu gebaut, sondern aus der Merkliste
		// gelesen, die svgxWayLayer gefüllt hat. Ein selbst zusammengesetzter Name
		// wäre ein href ins Leere -- und diese ganze Gruppe bliebe unsichtbar.
		const wegId = (o.wayIds || new Map()).get(f.properties?.public_id);
		if (!wegId) { return; }
		const id = svgxIdFor(`${name}-Wegbeschriftung`, f.properties?.public_id, o.dialect, o.seen);
		const label = o.dialect === SVGX_DIALECTS.INKSCAPE
			? ` inkscape:label="${svgxEscapeText(name)}"`
			: "";
		stuecke.push(`<text id="${svgxEscapeText(id)}"${label}>`
			+ `<textPath href="#${svgxEscapeText(wegId)}" startOffset="50%">`
			+ `${svgxEscapeText(name)}</textPath></text>\n`);
	});
	stuecke.push(svgxGroupClose());

	// --- Gebiets- und Regionsnamen: aus den `label`-Features des Payloads ---
	// Dieselbe Form wie die Ortsnamen; getrennt, weil der Gestalter sie einzeln
	// abschalten können soll. Feldname für den Text aus Aufgabe 1 einsetzen.

	stuecke.push(svgxGroupClose());   // <- schließt die EBENE, nicht eine Untergruppe
	return stuecke;
}
```

⚠️ Die dritte und vierte Untergruppe (Gebiete, Regionen) folgen exakt der Form
der Ortsnamen und lesen die `label`-Features; der Feldname für ihren Text kommt
aus Aufgabe 1.

⚠️ **Alle Namen, auch die kollidierenden.** Welche die Karte versteckt, hängt an
der Zoomstufe — eine Vektordatei hat keine. Wer gestaltet, will alle und löscht
selbst (Entwurf §5).

- [ ] **Schritt 4: Test laufen lassen, bestanden bestätigen**
- [ ] **Schritt 5: Committen**

```bash
git status
git add js/pages/svg-export-build.js js/pages/__tests__/svg-export-build.test.js
git commit -m "feat(svg-export): Beschriftungen als echter Text, Wegnamen ueber textPath"
```

---

## Aufgabe 9: Die Seite und der Kitt

**Dateien:**
- Anlegen: `edit/svg-export.php`
- Anlegen: `css/pages/svg-export.css`
- Anlegen: `js/pages/svg-export-page.js`

**Schnittstellen:**
- Verbraucht: alles aus `svg-export-build.js`

- [ ] **Schritt 1: Die Seite anlegen**

`edit/svg-export.php` — Kopf, Riegel und Login-Weiche **wörtlich nach dem Muster
von `edit/backup.php`** (dort ab Zeile 23: `require __DIR__ . '/../api/auth.php';`,
`avesmapsUserCan($user, 'admin')`, Redirect, `$isAdmin`). Nur der Zielpfad im
Redirect ändert sich zu `./svg-export.php`.

Inhalt der Seite: die Dialektwahl (zwei Radioknöpfe, **Illustrator vorausgewählt**),
die sieben Ebenen als Kästchen (**alle angehakt**), ein Knopf „SVG erzeugen", eine
Statuszeile.

```php
    <!-- Von Hand, mit Absicht: der Asset-Stempler des Deploys folgt nur index.html und
         html/*.html und erreicht diese PHP-Seite nie. Bei jeder Änderung an
         svg-export.css oder den beiden js/pages/svg-export-*.js erhöhen. -->
    <link rel="stylesheet" href="../css/pages/svg-export.css?v=20260814-svgexport" />
```

- [ ] **Schritt 2: Den Kitt schreiben**

`js/pages/svg-export-page.js`:

```js
// Der Kitt zwischen Seite und reinem Bauer. Hier wohnt alles, was der Bauer per
// Vertrag nicht darf: fetch, DOM, getComputedStyle, Blob.
//
// 🔴 DIE FARBTAFEL WIRD HIER GELESEN, NICHT IM BAUER. getComputedStyle braucht ein DOM.
// Der Bauer bekommt die fertige Tafel gereicht -- das ist zugleich, was seinen Test
// einfach macht.
"use strict";

function svgxReadTokens() {
	const s = getComputedStyle(document.documentElement);
	const t = (name, fallback) => (s.getPropertyValue(name) || "").trim() || fallback;
	return {
		land: t("--color-surface", "#e8dcc0"),
		wasser: t("--color-surface-muted", "#bcd4e6"),
		grenze: t("--color-divider", "#8a6a3f"),
		ort: t("--color-text", "#3b2a18"),
		schrift: t("--font-family-base", "serif"),
	};
}
```

Der Ablauf: nur die angekreuzten Endpunkte holen · Ebene für Ebene bauen, dazwischen
`await new Promise((r) => setTimeout(r))`, damit die Statuszeile mitläuft statt
einzufrieren · `new Blob(stuecke, { type: "image/svg+xml" })` — **nie** ein einziger
30-MB-String durch Aneinanderhängen · `URL.createObjectURL`, `<a download>`, danach
`revokeObjectURL`.

⚠️ `political-territories.php?action=layer` **einmal**, nie in einer Schleife.

- [ ] **Schritt 3: Im Browser durchspielen**

Einloggen, Seite öffnen, beide Dialekte erzeugen. Konsole muss leer bleiben.

- [ ] **Schritt 4: Committen**

```bash
git status
git add edit/svg-export.php css/pages/svg-export.css js/pages/svg-export-page.js
git commit -m "feat(svg-export): die Seite -- Ebenen ankreuzen, Dialekt waehlen, Datei herunterladen"
```

---

## Aufgabe 10: Der Knopf, die Abnahme, der Deploy

**Dateien:**
- Ändern: `edit/index.php:116-125` (im vorhandenen `if (avesmapsUserCan(…, 'admin'))`)

- [ ] **Schritt 1: Den Knopf setzen**

```php
                        <a class="edit-shell__toplink" href="/edit/svg-export.php" target="_blank" rel="noopener" title="Die Karte als bearbeitbare Vektorgrafik herunterladen" aria-label="Karte als SVG">↧ Karte als SVG <span class="avesmaps-scope-hint">nur Admins</span></a>
```

⚠️ **Ein monochromes Zeichen, kein drittes Emoji.** Die Hausregel seit 13.08.2026
sind monochrome Zeichen für Editorwerkzeuge; die zwei Emoji dieser Leiste stehen
im Code als offener Punkt, weil es für „Handbuch" und „Backup" keine gibt. Für
„herunterladen" gibt es eines.

- [ ] **Schritt 2: Das GANZE Testfeld laufen lassen**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do echo "== $t"; node "$t" || break; done
```

Erwartet: jede Datei grün. 💣 Ein einziger roter Test lädt **nichts** hoch — und
der Fehlschlag vergiftet danach den `?v=`-Stempel, weil der nächste grüne Lauf die
nie hochgeladenen Dateien für aktuell hält.

- [ ] **Schritt 3: 🔧 DU (Owner) — die echten Handgriffe**

Ein grüner Test belegt nicht, dass die Datei etwas taugt (AGENTS.md §9):

1. Beide Dateien erzeugen und herunterladen.
2. `…-inkscape.svg` in **Inkscape**: sieben Ebenen im Ebenenfenster, Namen lesbar,
   Umlaute unversehrt.
3. `…-illustrator.svg` in **Illustrator**: Ebenen erkannt, Objektnamen lesbar.
4. Karte **richtig herum** — Norden oben.
5. Eine Untergruppe anfassen: eine Farbänderung trifft alle Reichsstraßen auf einmal.
6. **Beschriftungen sichtbar** — die Probe auf die `href`-Kopplung aus Aufgabe 8.
7. Eine Ebene abwählen, neu erzeugen: sie fehlt, die Datei ist kleiner.

- [ ] **Schritt 4: Committen und einzeln live**

```bash
git status
git add edit/index.php
git commit -m "feat(edit): Admins laden die Karte als bearbeitbare SVG herunter -- neuer Eintrag in der Kopfleiste"
git fetch origin && git rebase origin/master && git push origin master
git ls-remote origin master
```

⚠️ **Einzeln, nicht im Bündel** (AGENTS.md §9). Nach ~1–2 Minuten Deploy die
Remote-SHA prüfen und dem Owner den Blick geben.

Die Betreffzeile nennt die sichtbare Wirkung — das ist die einzige Pflicht
gegenüber dem Handbuch. `html/editor-handbuch.html` wird **nicht** angefasst; es
gehört der nächtlichen Routine `avesmaps-handbuch-pflege` (AGENTS.md §9).

- [ ] **Schritt 5: Den Entwurf auf „gebaut" setzen**

In `docs/superpowers/specs/2026-08-14-svg-export-design.md` die Kopfzeile
`**Zustand:**` auf `gebaut und live` mit Datum ändern, und die Antwort der Sonde
aus Aufgabe 0 als §4-Nachtrag festhalten.

---

## Offene Punkte

- 🔧 **Aufgabe 0 und Aufgabe 1 brauchen den Owner** — die Sondenmessung
  (Illustrator kann ich nicht bedienen) und die Nord/Süd-Probe am eingeloggten
  Payload.
- ⚠️ **Aufgabe 4 hängt an Aufgabe 0.** Ergibt die Sonde, dass Illustrator ohne
  `_xHH_` lesbare Namen zeigt, entfällt `svgxAdobeEscape` — das ist dann das
  gemessene Ergebnis, keine Abweichung vom Plan.
- ⚠️ **Aufgabe 5–8 hängen an Aufgabe 1.** Steht dort ein anderer Feldname als
  `public_id` / `place_kind` / `name`, wird er eingesetzt; die Tests ziehen mit.
- 🔧 **Dateigröße erst nach dem ersten echten Lauf bekannt.** Die Schätzung
  20–40 MB stammt aus der Payload-Größe (21 MB JSON), nicht aus einer Messung.
  Liegt sie deutlich darüber, ist die nächste Frage an den Owner, ob eine
  Vereinfachungsstufe doch gewünscht ist — im Entwurf ist sie heute ausgeschlossen.
