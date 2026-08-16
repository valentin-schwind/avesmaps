# Zoombänder — Bauplan

> **Für agentische Ausführung:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`. Die Schritte tragen Checkboxen (`- [ ]`).

**Entwurf:** `docs/superpowers/specs/2026-08-16-zoombaender-design.md`

**Ziel:** Wann eine Ortsklasse auf der Karte erscheint, wie groß ihr Punkt ist und wie groß ihr Name
— heute vier feste Stellen im Code — wird eine Tabelle, die ein Admin im Ortseditor einstellt.

**Architektur:** Die Vorgabewerte stehen an genau **einer** Stelle im Browser
(`js/map-features/location-zoom-bands.js`) und reproduzieren das heutige Bild Ziffer für Ziffer.
Eine Übersteuerung liegt als JSON in `app_setting`, wird über einen winzigen öffentlichen Endpunkt
beim Seitenstart geholt und im Browser **zellenweise** über die Vorgabe gelegt. Der Server kennt
die Vorgabewerte nicht; „Zurücksetzen" löscht die Zeile.

**Technik:** Vanilla JS ohne Bauschritt (Ladereihenfolge in `index.html` ist Vertrag), PHP 8 strict
types + PDO, `app_setting` als Speicher. Tests: `node` mit `assert` und `vm.runInThisContext`;
PHP mit `assert()` und `-d zend.assertions=1`.

## Globale Zusicherungen

Gelten für **jede** Aufgabe:

- **Kommentare und Commit-Meldungen auf DEUTSCH** (AGENTS.md §8). Maschinenlesbare `error.code`-Werte
  bleiben englisch.
- **Nur eigene Pfade stagen.** Der Arbeitsbaum ist geteilt; niemals `git add -A`/`git add .`/`git
  commit -a`. Vor jedem Commit `git status`, und nur die in der Aufgabe genannten Dateien stagen.
- **Kein `?v=` von Hand** (AGENTS.md §7). Kein `ASSET_VERSION`-Bump — der gehört dem Territorien-Editor.
- **Nichts hartkodieren, was ein Token hat** (AGENTS.md §12): Farben, Radien, Trennlinien aus
  `css/base/tokens.css`. Schriftgrößen unter 11px sind verboten.
- **Erst nach der letzten Aufgabe pushen.** Aufgabe 9 ist das Tor. Ein Push vor dem vollständigen
  Testfeld kann den Deploy blockieren und vergiftet dann den `?v=`-Stempel.
- **Zahlenwerte:** die zwei Vorgabetafeln aus Aufgabe 1 sind **verbatim** aus dem Entwurf §3.2 zu
  übernehmen. Keine Zahl „glattziehen" — sie sind aus der abgeschafften Kurve gerechnet und der
  Beweis, dass sich am Auslieferungstag nichts ändert.
- **Klassenreihenfolge überall:** `metropole, grossstadt, stadt, kleinstadt, dorf, gebaeude`.

---

## Dateiübersicht

| Datei | Verantwortung | Aufgabe |
|---|---|---|
| `js/map-features/location-zoom-bands.js` | **neu** — Vorgabetafel, Zusammenführung, Zugriff, Boot-Leser | 1, 6 |
| `js/map-features/__tests__/zoombaender-vorgabe.test.js` | **neu** — die Vorgabe reproduziert das heutige Bild (Abnahmefall) | 1 |
| `js/map-features/__tests__/zoombaender-zusammenfuehrung.test.js` | **neu** — `null` ≠ fehlend, Schranken, Löcher, Müll | 1 |
| `js/map-features/map-features-path-labels.js` | ändern — eigene Grundtafel für Wegenamen | 2 |
| `js/map-features/map-features-powerlines.js` | ändern — erbt dieselbe Grundtafel | 2 |
| `js/map-features/__tests__/wegenamen-grundgroesse.test.js` | **neu** — die Entkopplung ist vollzogen und wertgleich | 2 |
| `js/map-features/map-features-location-marker-rendering.js` | ändern — Marker aus dem Band; totes Beiwerk raus | 3 |
| `js/map-features/__tests__/zoombaender-erscheinungsstufe.test.js` | **neu** — erste gefüllte Zelle steuert Marker und Name | 3, 4 |
| `js/map-features/map-features-location-name-labels.js` | ändern — Namen aus dem Band | 4 |
| `js/config.js` | ändern — `LOCATION_NAME_LABEL_CONFIG` weg, tote Felder weg, Boot-Aufruf | 4, 6 |
| `js/map-features/map-features-label-collisions.js` | ändern — Erscheinungsstufe aus dem Band | 4 |
| `js/ui/spotlight-search-focus.js` | ändern — Erscheinungsstufe aus dem Band | 4 |
| `js/map-features/__tests__/pruefhaken-sichtbarkeit.test.js` | ändern — Stub gegen echte Datei tauschen | 4 |
| `js/map-features/__tests__/versteckter-ort-sichtbarkeit.test.js` | ändern — Stub gegen echte Datei tauschen | 4 |
| `api/_internal/app/zoom-bands.php` | **neu** — Prüfung, Lesen, Schreiben, Zurücksetzen | 5 |
| `api/_internal/app/__tests__/zoom-bands-test.php` | **neu** — Prüfung + Rückleseprobe | 5 |
| `api/app/zoom-bands.php` | **neu** — öffentlicher Leser, ETag, kein DDL | 5 |
| `api/edit/map/zoom-bands.php` | **neu** — `get`/`save`/`reset`, Admin-Riegel | 5 |
| `index.html` | ändern — ein `<script>` vor `js/config.js` | 6 |
| `docs/zoombaender-mockup.html` | **neu** — Mockup vor dem Bau | 7 |
| `html/wiki-sync-settlement-editor.html` | ändern — Kachel, Fenster, Bandgrafik, Tabellen, Speichern | 8 |
| `js/pages/__tests__/zoombaender-dialog.test.js` | **neu** — Fenster und Endpunkt sprechen dieselben Namen | 8 |

---

## Aufgabe 1: Die Vorgabetafel und ihre Zusammenführung

Reines JS ohne DOM, ohne Netz. Der Rest des Plans steht darauf.

**Dateien:**
- Neu: `js/map-features/location-zoom-bands.js`
- Neu: `js/map-features/__tests__/zoombaender-vorgabe.test.js`
- Neu: `js/map-features/__tests__/zoombaender-zusammenfuehrung.test.js`

**Schnittstellen:**
- Verbraucht: nichts.
- Liefert (Aufgaben 2–8 verlassen sich darauf):
  - `AVESMAPS_ZOOM_BAND_MAX_ZOOM: number` (= 7)
  - `AVESMAPS_ZOOM_BAND_LIMITS: {marker:{min,max}, label:{min,max}}`
  - `AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS: {marker:Record<string,(number|null)[]>, label:…}`
  - `avesmapsResolveLocationZoomBands(stored: unknown) => {marker, label}` — rein, ohne Zustand
  - `avesmapsLocationZoomBands() => {marker, label}` — die aktuell wirksame Tafel
  - `avesmapsApplyLocationZoomBands(stored: unknown) => boolean` — setzt sie, `true` bei Änderung
  - `avesmapsLocationZoomBandValue(kind: "marker"|"label", locationType: string, zoomLevel: number) => number|null`
  - `avesmapsLocationZoomBandMinZoom(kind, locationType) => number|null`

- [ ] **Schritt 1: Den Abnahmetest schreiben — die Vorgabe IST das heutige Bild**

Neue Datei `js/map-features/__tests__/zoombaender-vorgabe.test.js`:

```js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// 🔴 DER ABNAHMEFALL. Die Vorgabetafel muss das Bild reproduzieren, das die Karte am 16.08.2026
// gezeichnet hat -- sonst ändert eine Auslieferung, die "nichts ändern" soll, die ganze Karte.
//
// Deshalb steht die ABGESCHAFFTE Rechnung hier noch einmal, als Literale: die geometrische
// Markerkurve (LOCATION_MARKER_RADIUS_SPEC) und die alte Schrifttafel
// (LOCATION_NAME_LABEL_SIZE_BY_ZOOM samt LOCATION_NAME_LABEL_CONFIG[*].minZoom). Sie sind der
// Zeuge, nicht die Quelle -- werden sie je "angepasst", damit der Test grün wird, ist der Test wertlos.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/zoombaender-vorgabe.test.js

vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../location-zoom-bands.js"), "utf8"),
	{ filename: "location-zoom-bands.js" }
);

// ---- Die abgeschaffte Markerkurve (Stand 16.08.2026) ------------------------------------------
const ALTE_KURVE = {
	metropole: { from: 0, start: 2.5, end: 20 },
	grossstadt: { from: 0, start: 1.5, end: 15 },
	stadt: { from: 0, start: 0.5, end: 12 },
	kleinstadt: { from: 1, start: 0.5, end: 9.33 },
	dorf: { from: 2, start: 0.5, end: 6.67 },
	gebaeude: { from: 3, start: 0.5, end: 4.67 },
};
const ALTES_MAX_ZOOM = 6;
const ALTE_KONTUR = 0.33;

const alterAussendurchmesser = (typ, z) => {
	const spec = ALTE_KURVE[typ];
	const geklemmt = Math.max(spec.from, Math.min(ALTES_MAX_ZOOM, z));
	const spanne = ALTES_MAX_ZOOM - spec.from;
	const t = spanne > 0 ? (geklemmt - spec.from) / spanne : 0;
	const kern = spec.start * Math.pow(spec.end / spec.start, t);
	return Math.round(kern * (1 + ALTE_KONTUR) * 2 * 100) / 100;
};

// ---- Die abgeschaffte Schrifttafel (Stand 16.08.2026) -----------------------------------------
const ALTE_SCHRIFT = {
	metropole: { 0: 8, 1: 9, 2: 11, 3: 13, 4: 17, 5: 19 },
	grossstadt: { 0: 8, 1: 8.5, 2: 10, 3: 12, 4: 15, 5: 17 },
	stadt: { 0: 8, 1: 8, 2: 9, 3: 11, 4: 13, 5: 15 },
	kleinstadt: { 0: 8, 1: 8, 2: 8.5, 3: 9.5, 4: 11, 5: 13 },
	dorf: { 0: 8, 1: 8, 2: 8, 3: 8.5, 4: 10, 5: 11 },
	gebaeude: { 0: 8, 1: 8, 2: 8, 3: 8, 4: 9, 5: 9 },
};
const ALTE_SCHRIFT_MINZOOM = { metropole: 0, grossstadt: 0, stadt: 2, kleinstadt: 3, dorf: 4, gebaeude: 4 };
const ALTES_LABEL_MAX_ZOOM = 5; // VISUAL_MAX_ZOOM_LEVEL

const KLASSEN = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"];

// ---- A. Der Marker ----------------------------------------------------------------------------
KLASSEN.forEach((typ) => {
	const zeile = AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS.marker[typ];
	assert.ok(Array.isArray(zeile) && zeile.length === 8, `${typ}: acht Markerzellen`);
	for (let z = 0; z <= 7; z += 1) {
		if (z < ALTE_KURVE[typ].from) {
			assert.strictEqual(zeile[z], null,
				`${typ} z${z}: die Klasse erschien früher erst ab z${ALTE_KURVE[typ].from}`);
			continue;
		}
		assert.strictEqual(zeile[z], alterAussendurchmesser(typ, z),
			`${typ} z${z}: Vorgabe ${zeile[z]}, alte Kurve ${alterAussendurchmesser(typ, z)}`);
	}
	// z7 erbt z6 -- die alte Kurve klemmte dort.
	assert.strictEqual(zeile[7], zeile[6], `${typ}: z7 erbt z6`);
});

// ---- B. Der Name ------------------------------------------------------------------------------
KLASSEN.forEach((typ) => {
	const zeile = AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS.label[typ];
	assert.ok(Array.isArray(zeile) && zeile.length === 8, `${typ}: acht Schriftzellen`);
	for (let z = 0; z <= 7; z += 1) {
		if (z < ALTE_SCHRIFT_MINZOOM[typ]) {
			assert.strictEqual(zeile[z], null,
				`${typ} z${z}: der Name erschien früher erst ab z${ALTE_SCHRIFT_MINZOOM[typ]}`);
			continue;
		}
		const alt = ALTE_SCHRIFT[typ][Math.min(ALTES_LABEL_MAX_ZOOM, z)];
		assert.strictEqual(zeile[z], Math.max(8, alt),
			`${typ} z${z}: Vorgabe ${zeile[z]}, alte Tafel ${Math.max(8, alt)}`);
	}
	assert.strictEqual(zeile[6], zeile[5], `${typ}: z6 erbt z5 (alter Deckel)`);
	assert.strictEqual(zeile[7], zeile[5], `${typ}: z7 erbt z5 (alter Deckel)`);
});

// ---- C. Die Erscheinungsstufen stimmen mit den abgeschafften Konstanten überein ---------------
// 💣 Bis heute stand die Marker-Untergrenze ZWEIMAL im Code: als if-Kette `minZoomByType` und als
// LOCATION_MARKER_RADIUS_SPEC[*].from. Beide sagten 0/0/0/1/2/3. Ab jetzt gibt es sie einmal --
// als Form der Tabelle.
assert.deepStrictEqual(
	KLASSEN.map((typ) => avesmapsLocationZoomBandMinZoom("marker", typ)),
	[0, 0, 0, 1, 2, 3],
	"die Erscheinungsstufen der Marker"
);
assert.deepStrictEqual(
	KLASSEN.map((typ) => avesmapsLocationZoomBandMinZoom("label", typ)),
	[0, 0, 2, 3, 4, 4],
	"die Erscheinungsstufen der Namen"
);

console.log("zoombaender-vorgabe: alle Zusicherungen erfüllt");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag prüfen**

```bash
node js/map-features/__tests__/zoombaender-vorgabe.test.js
```

Erwartet: `Error: ENOENT … location-zoom-bands.js`.

- [ ] **Schritt 3: Die Datei anlegen**

Neue Datei `js/map-features/location-zoom-bands.js`:

```js
// Die Zoombänder: wann eine Ortsklasse erscheint, wie groß ihr Punkt ist, wie groß ihr Name.
// Entwurf: docs/superpowers/specs/2026-08-16-zoombaender-design.md
//
// 🔴 DIESE DATEI IST DIE EINZIGE QUELLE DER VORGABEWERTE. Der Server kennt sie nicht -- er
// speichert nur die Übersteuerung und gibt sie zurück. Läge dieselbe Tafel auch dort, gäbe es sie
// zweimal und sie liefen auseinander.
//
// Geladen von index.html (die Karte, VOR js/config.js) UND von
// html/wiki-sync-settlement-editor.html (das Fenster, das sie anzeigt und zurücksetzt).

const AVESMAPS_ZOOM_BAND_MAX_ZOOM = 7;

// Schranken für einen von Hand eingetragenen Wert. Alles außerhalb fällt auf die Vorgabe zurück.
const AVESMAPS_ZOOM_BAND_LIMITS = {
	marker: { min: 0.5, max: 200 }, // Außendurchmesser in px
	label: { min: 4, max: 96 },     // Schriftgröße in pt
};

// 🔴 DAS HEUTIGE BILD, ZIFFER FÜR ZIFFER (Entwurf §3.2). `null` = auf dieser Stufe gibt es diese
// Klasse nicht -- die erste gefüllte Zelle IST die Erscheinungsstufe.
// Die Markerwerte sind aus der abgeschafften geometrischen Kurve gerechnet und wie bisher auf zwei
// Stellen gerundet; z7 erbt z6, weil der Zeichner dort geklemmt hat. Bewacht von
// __tests__/zoombaender-vorgabe.test.js -- wer hier eine Zahl ändert, ändert die Karte.
const AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS = {
	marker: {
		metropole: [6.65, 9.4, 13.3, 18.81, 26.6, 37.62, 53.2, 53.2],
		grossstadt: [3.99, 5.86, 8.6, 12.62, 18.52, 27.18, 39.9, 39.9],
		stadt: [1.33, 2.26, 3.84, 6.52, 11.07, 18.79, 31.92, 31.92],
		kleinstadt: [null, 1.33, 2.39, 4.29, 7.7, 13.82, 24.82, 24.82],
		dorf: [null, null, 1.33, 2.54, 4.86, 9.28, 17.74, 17.74],
		gebaeude: [null, null, null, 1.33, 2.8, 5.9, 12.42, 12.42],
	},
	label: {
		metropole: [8, 9, 11, 13, 17, 19, 19, 19],
		grossstadt: [8, 8.5, 10, 12, 15, 17, 17, 17],
		stadt: [null, null, 9, 11, 13, 15, 15, 15],
		kleinstadt: [null, null, null, 9.5, 11, 13, 13, 13],
		dorf: [null, null, null, null, 10, 11, 11, 11],
		gebaeude: [null, null, null, null, 9, 9, 9, 9],
	},
};

// Eine Zeile gegen ihre Vorgabe normalisieren.
//
// 💣 `null` UND `fehlt` SIND ZWEI VERSCHIEDENE DINGE. `null` ist eine Aussage („hier nicht"),
// alles andere Unbrauchbare ist ein Nichtwissen („nimm die Vorgabe"). Wer beide gleich behandelt,
// macht entweder das Ausblenden unmöglich oder löscht bei jedem Formatwechsel die halbe Karte.
function avesmapsZoomBandNormalizeRow(row, defaultRow, limits) {
	const result = [];
	let erschienen = false;
	for (let z = 0; z <= AVESMAPS_ZOOM_BAND_MAX_ZOOM; z += 1) {
		const raw = Array.isArray(row) ? row[z] : undefined;
		let value;
		if (raw === null) {
			value = null;
		} else if (typeof raw === "number" && Number.isFinite(raw) && raw >= limits.min && raw <= limits.max) {
			value = raw;
		} else {
			value = defaultRow[z] ?? null;
		}
		// 💣 KEIN LOCH. Ab der ersten gefüllten Zelle erbt jede leere den letzten Wert -- ein Ort,
		// der bei z3 sichtbar, bei z4 weg und bei z5 wieder da ist, sieht wie ein Fehler aus, egal
		// wie er entstanden ist. Damit kann auch ein von Hand verbogener Datenbankwert keins bauen.
		if (value === null && erschienen) {
			value = result[z - 1];
		}
		if (value !== null) {
			erschienen = true;
		}
		result.push(value);
	}
	return result;
}

// ⚠️ Läuft über die Schlüssel der VORGABE, nicht über die des Gespeicherten: eine unbekannte
// Klasse in der Datenbank wird damit still ignoriert. Der Browser führt die Liste, nicht der Server.
function avesmapsResolveLocationZoomBands(stored) {
	const source = (stored && typeof stored === "object" && !Array.isArray(stored)) ? stored : {};
	const resolved = {};
	["marker", "label"].forEach((kind) => {
		const storedKind = (source[kind] && typeof source[kind] === "object" && !Array.isArray(source[kind]))
			? source[kind]
			: {};
		resolved[kind] = {};
		Object.keys(AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS[kind]).forEach((locationType) => {
			resolved[kind][locationType] = avesmapsZoomBandNormalizeRow(
				storedKind[locationType],
				AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS[kind][locationType],
				AVESMAPS_ZOOM_BAND_LIMITS[kind]
			);
		});
	});
	return resolved;
}

let _avesmapsLocationZoomBands = avesmapsResolveLocationZoomBands(null);

function avesmapsLocationZoomBands() {
	return _avesmapsLocationZoomBands;
}

function avesmapsApplyLocationZoomBands(stored) {
	const next = avesmapsResolveLocationZoomBands(stored);
	const changed = JSON.stringify(next) !== JSON.stringify(_avesmapsLocationZoomBands);
	_avesmapsLocationZoomBands = next;
	return changed;
}

// Der Wert einer Zelle, oder null („auf dieser Stufe gibt es diese Klasse nicht").
function avesmapsLocationZoomBandValue(kind, locationType, zoomLevel) {
	const row = _avesmapsLocationZoomBands[kind] && _avesmapsLocationZoomBands[kind][locationType];
	if (!row) {
		return null;
	}
	const rounded = Math.round(Number(zoomLevel));
	const z = Number.isFinite(rounded) ? Math.max(0, Math.min(AVESMAPS_ZOOM_BAND_MAX_ZOOM, rounded)) : 0;
	return row[z];
}

// Die Erscheinungsstufe: die erste gefüllte Zelle. null = diese Klasse erscheint nirgends.
function avesmapsLocationZoomBandMinZoom(kind, locationType) {
	const row = _avesmapsLocationZoomBands[kind] && _avesmapsLocationZoomBands[kind][locationType];
	if (!row) {
		return null;
	}
	const index = row.findIndex((value) => value !== null);
	return index < 0 ? null : index;
}

// ⚠️ NUR FÜR DIE NODE-TESTS. Im Browser teilen klassische <script>-Bausteine ihre obersten `const`
// über die globale lexikalische Umgebung; `vm.runInThisContext` tut das NICHT -- ein zweites Skript
// sähe AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS dort nicht. Funktionsdeklarationen wandern von selbst
// ins globale Objekt, die Konstanten nicht.
if (typeof globalThis !== "undefined") {
	globalThis.AVESMAPS_ZOOM_BAND_MAX_ZOOM = AVESMAPS_ZOOM_BAND_MAX_ZOOM;
	globalThis.AVESMAPS_ZOOM_BAND_LIMITS = AVESMAPS_ZOOM_BAND_LIMITS;
	globalThis.AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS = AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS;
}
```

- [ ] **Schritt 4: Test laufen lassen, Erfolg prüfen**

```bash
node js/map-features/__tests__/zoombaender-vorgabe.test.js
```

Erwartet: `zoombaender-vorgabe: alle Zusicherungen erfüllt`.

⚠️ Schlägt eine Markerzelle um ±0,01 fehl, ist die Zahl in der Vorgabetafel falsch abgeschrieben —
**nicht** die Rundung im Test anfassen.

- [ ] **Schritt 5: Den Zusammenführungstest schreiben**

Neue Datei `js/map-features/__tests__/zoombaender-zusammenfuehrung.test.js`:

```js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Was passiert, wenn in der Datenbank etwas anderes steht als erwartet.
// Entwurf: docs/superpowers/specs/2026-08-16-zoombaender-design.md §4.4
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/zoombaender-zusammenfuehrung.test.js

vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../location-zoom-bands.js"), "utf8"),
	{ filename: "location-zoom-bands.js" }
);

const VORGABE = AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS;

// ---- A. Nichts gespeichert = reine Vorgabe ----------------------------------------------------
[null, undefined, "kaputt", 42, [], { marker: "kaputt" }].forEach((muell) => {
	const tafel = avesmapsResolveLocationZoomBands(muell);
	assert.deepStrictEqual(tafel.marker.dorf, VORGABE.marker.dorf,
		`kaputter Speicherwert (${JSON.stringify(muell)}) ergibt die Vorgabe`);
	assert.deepStrictEqual(tafel.label.metropole, VORGABE.label.metropole);
});

// ---- B. `null` ist eine AUSSAGE, `fehlt` ist ein Nichtwissen ----------------------------------
// 💣 Der Kern. Ein `null` blendet aus; eine fehlende Zelle nimmt die Vorgabe.
const ausgeblendet = avesmapsResolveLocationZoomBands({
	marker: { metropole: [null, null, 13.3, 18.81, 26.6, 37.62, 53.2, 53.2] },
});
assert.strictEqual(ausgeblendet.marker.metropole[0], null, "z0 ist ausgeblendet");
assert.strictEqual(ausgeblendet.marker.metropole[1], null, "z1 ist ausgeblendet");
assert.strictEqual(ausgeblendet.marker.metropole[2], 13.3, "ab z2 wieder da");

const luecke = avesmapsResolveLocationZoomBands({ marker: { metropole: [] } });
assert.deepStrictEqual(luecke.marker.metropole, VORGABE.marker.metropole,
	"eine leere Liste ist kein Ausblenden, sondern ein Nichtwissen");

// ---- C. Kein Loch: ab der ersten gefüllten Zelle erbt jede leere den letzten Wert -------------
const mitLoch = avesmapsResolveLocationZoomBands({
	marker: { stadt: [1.33, 2.26, null, null, 11.07, 18.79, 31.92, 31.92] },
});
assert.strictEqual(mitLoch.marker.stadt[2], 2.26, "z2 erbt z1 statt zu verschwinden");
assert.strictEqual(mitLoch.marker.stadt[3], 2.26, "z3 ebenso");
assert.strictEqual(mitLoch.marker.stadt[4], 11.07, "danach gilt wieder der eigene Wert");
assert.ok(mitLoch.marker.stadt.every((wert, index) => index === 0 || wert !== null || mitLoch.marker.stadt[index - 1] === null),
	"nach einer gefüllten Zelle folgt nie eine leere");

// ---- D. Schranken ----------------------------------------------------------------------------
const ausserhalb = avesmapsResolveLocationZoomBands({
	marker: { dorf: [null, null, 0.1, 2.54, 4.86, 9.28, 999, 17.74] },
	label: { dorf: [null, null, null, null, 1, 11, 11, 500] },
});
assert.strictEqual(ausserhalb.marker.dorf[2], VORGABE.marker.dorf[2], "0,1 px ist zu klein -> Vorgabe");
assert.strictEqual(ausserhalb.marker.dorf[6], VORGABE.marker.dorf[6], "999 px ist zu groß -> Vorgabe");
assert.strictEqual(ausserhalb.label.dorf[4], VORGABE.label.dorf[4], "1 pt ist zu klein -> Vorgabe");
assert.strictEqual(ausserhalb.label.dorf[7], VORGABE.label.dorf[7], "500 pt ist zu groß -> Vorgabe");

// Nicht-Zahlen ebenso.
const unfug = avesmapsResolveLocationZoomBands({ label: { metropole: ["12", NaN, Infinity, {}, 17, 19, 19, 19] } });
[0, 1, 2, 3].forEach((z) => {
	assert.strictEqual(unfug.label.metropole[z], VORGABE.label.metropole[z],
		`z${z}: keine endliche Zahl -> Vorgabe`);
});

// ---- E. Unbekannte Klasse wird ignoriert ------------------------------------------------------
const fremd = avesmapsResolveLocationZoomBands({ marker: { hauptstadt: [5, 5, 5, 5, 5, 5, 5, 5] } });
assert.strictEqual(fremd.marker.hauptstadt, undefined, "der Browser führt die Klassenliste");
assert.strictEqual(Object.keys(fremd.marker).length, 6, "es bleiben sechs Klassen");

// ---- F. Zugriff, Rundung und Klemmung ---------------------------------------------------------
avesmapsApplyLocationZoomBands(null);
assert.strictEqual(avesmapsLocationZoomBandValue("marker", "dorf", 4), VORGABE.marker.dorf[4]);
assert.strictEqual(avesmapsLocationZoomBandValue("marker", "dorf", 4.4), VORGABE.marker.dorf[4],
	"4,4 rundet auf 4 -- der Zeichner rundet ebenso");
assert.strictEqual(avesmapsLocationZoomBandValue("marker", "dorf", 4.6), VORGABE.marker.dorf[5],
	"4,6 rundet auf 5");
assert.strictEqual(avesmapsLocationZoomBandValue("marker", "dorf", 99), VORGABE.marker.dorf[7],
	"über z7 wird geklemmt");
assert.strictEqual(avesmapsLocationZoomBandValue("marker", "dorf", -3), VORGABE.marker.dorf[0],
	"unter z0 wird geklemmt -- und dort steht null");
assert.strictEqual(avesmapsLocationZoomBandValue("marker", "unbekannt", 4), null);
assert.strictEqual(avesmapsLocationZoomBandMinZoom("marker", "unbekannt"), null);

// ---- G. Anwenden meldet, OB sich etwas geändert hat -------------------------------------------
// Der Boot-Leser zeichnet nur dann nach -- ein bedingungsloses Neuzeichnen kostet bei jedem
// Seitenstart einen vollen Sichtbarkeits-Durchlauf umsonst.
avesmapsApplyLocationZoomBands(null);
assert.strictEqual(avesmapsApplyLocationZoomBands(null), false, "Vorgabe auf Vorgabe ändert nichts");
assert.strictEqual(avesmapsApplyLocationZoomBands({ label: { dorf: [null, null, null, null, 14, 14, 14, 14] } }), true,
	"eine echte Übersteuerung meldet sich");
assert.strictEqual(avesmapsLocationZoomBandValue("label", "dorf", 4), 14);
avesmapsApplyLocationZoomBands(null); // Zustand für nachfolgende Tests zurücksetzen

console.log("zoombaender-zusammenfuehrung: alle Zusicherungen erfüllt");
```

- [ ] **Schritt 6: Test laufen lassen**

```bash
node js/map-features/__tests__/zoombaender-zusammenfuehrung.test.js
```

Erwartet: `zoombaender-zusammenfuehrung: alle Zusicherungen erfüllt`. Schlägt etwas fehl, ist der
Fehler in `location-zoom-bands.js`, nicht im Test.

- [ ] **Schritt 7: Committen**

```bash
git status
git add js/map-features/location-zoom-bands.js js/map-features/__tests__/zoombaender-vorgabe.test.js js/map-features/__tests__/zoombaender-zusammenfuehrung.test.js
git commit -m "feat(zoombaender): die Vorgabetafel und ihre Zusammenfuehrung"
```

---

## Aufgabe 2: Die Wegenamen von der Dorf-Zeile lösen

🔴 **Steht VOR Aufgabe 4 und darf nicht danach kommen.** Wird die Dorf-Zeile zuerst auf ein Band
umgestellt, ist die Straßenbeschriftung der ganzen Karte zwischenzeitlich falsch (Entwurf §6).

**Dateien:**
- Ändern: `js/map-features/map-features-path-labels.js:38-49` (Nachbarschaft) und `:131`
- Ändern: `js/map-features/map-features-powerlines.js:159`
- Neu: `js/map-features/__tests__/wegenamen-grundgroesse.test.js`

**Schnittstellen:**
- Verbraucht: nichts aus Aufgabe 1.
- Liefert: `getPathLabelBaseSize(zoomLevel?: number) => number` und
  `PATH_LABEL_BASE_SIZE_BY_ZOOM: Record<0|1|2|3|4|5, number>` in `map-features-path-labels.js`.

- [ ] **Schritt 1: Den Test schreiben**

Neue Datei `js/map-features/__tests__/wegenamen-grundgroesse.test.js`:

```js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Die Wegenamen hingen an der Dorf-Zeile der Ortsschrift. Sie haben jetzt ihre eigene Grundtafel --
// buchstäblich dieselben Zahlen, damit sich am Auslieferungstag nichts ändert.
// Entwurf: docs/superpowers/specs/2026-08-16-zoombaender-design.md §6
//
// ⭐ Der Test liest die Dateien als TEXT. Beide sind DOM- und Leaflet-Code und lassen sich nicht
// einzeln laden; die Zahlen und der Aufruf stehen aber wörtlich da, und genau sie sind der Vertrag.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/wegenamen-grundgroesse.test.js

const repoRoot = path.join(__dirname, "..", "..", "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const pathLabels = read("js/map-features/map-features-path-labels.js");
const powerlines = read("js/map-features/map-features-powerlines.js");

// ---- 1. Die Grundtafel IST die alte Dorf-Zeile ------------------------------------------------
// 🔴 Diese sechs Zahlen standen bis zum 16.08.2026 in LOCATION_NAME_LABEL_SIZE_BY_ZOOM.dorf.
// Die 8,5 bei z3 ist der Grund für diesen ganzen Umbau: eine leere Zelle hätte sie auf 8 gedrückt.
const ALTE_DORF_ZEILE = { 0: 8, 1: 8, 2: 8, 3: 8.5, 4: 10, 5: 11 };

const match = pathLabels.match(/PATH_LABEL_BASE_SIZE_BY_ZOOM\s*=\s*\{([^}]*)\}/);
assert.ok(match, "PATH_LABEL_BASE_SIZE_BY_ZOOM wurde gefunden");
const tafel = {};
match[1].split(",").forEach((paar) => {
	const teile = paar.split(":");
	if (teile.length === 2) {
		tafel[teile[0].trim()] = Number(teile[1].trim());
	}
});
assert.deepStrictEqual(tafel, ALTE_DORF_ZEILE,
	"die Grundtafel der Wegenamen muss die alte Dorf-Zeile sein: " + JSON.stringify(tafel));

// ---- 2. Die Kopplung ist weg ------------------------------------------------------------------
assert.ok(!/getLocationNameLabelSize/.test(pathLabels),
	"map-features-path-labels.js ruft die Ortsschrift nicht mehr");
assert.ok(!/getLocationNameLabelSize/.test(powerlines),
	"map-features-powerlines.js ruft die Ortsschrift nicht mehr");
assert.ok(/getPathLabelBaseSize\(\)/.test(pathLabels), "die Wegenamen nutzen die eigene Grundtafel");
assert.ok(/getPathLabelBaseSize\(\)/.test(powerlines), "die Kraftlinien-Namen ebenso");

console.log("wegenamen-grundgroesse: alle Zusicherungen erfüllt");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag prüfen**

```bash
node js/map-features/__tests__/wegenamen-grundgroesse.test.js
```

Erwartet: `AssertionError: PATH_LABEL_BASE_SIZE_BY_ZOOM wurde gefunden`.

- [ ] **Schritt 3: Die Grundtafel anlegen**

In `js/map-features/map-features-path-labels.js`, direkt **vor** `PATH_LABEL_FONT_DELTA_BY_ZOOM`
(heute Zeile 42) einfügen:

```js
// 🔴 EIGENE GRUNDTAFEL DER WEGENAMEN -- buchstäblich die Dorf-Zeile, wie sie bis zum 16.08.2026 in
// LOCATION_NAME_LABEL_SIZE_BY_ZOOM stand. Sie ist hierher gewandert, weil die Ortsschrift ein
// einstellbares Zoomband bekommt und die Dorf-Zeile unter z4 leer wird (dort trägt ein Dorf keinen
// Namen) -- die Wegenamen brauchen dort aber weiter eine Zahl.
// 💣 Die 8,5 bei z3 ist der Grund: sie wird zur Straßenschrift 9,5. Ein Rückfall auf die alte
// Untergrenze 8 hätte sie stumm auf 9 gedrückt, auf der ganzen Karte.
// ⚠️ Damit zieht eine verstellte Dorfschrift die Straßenschrift NICHT mehr mit. Gewollt
// (Entwurf 2026-08-16-zoombaender-design.md §6); soll sie das je wieder, ist das hier die Stelle.
const PATH_LABEL_BASE_SIZE_BY_ZOOM = { 0: 8, 1: 8, 2: 8, 3: 8.5, 4: 10, 5: 11 };
function getPathLabelBaseSize(zoomLevel = (typeof map !== "undefined" ? map.getZoom() : 4)) {
	const z = typeof getVisualZoomLevel === "function"
		? getVisualZoomLevel(zoomLevel)
		: Math.max(0, Math.min(5, Math.round(Number(zoomLevel))));
	const value = PATH_LABEL_BASE_SIZE_BY_ZOOM[z];
	return Math.max(8, Number.isFinite(value) ? value : 8);
}
```

- [ ] **Schritt 4: Die zwei Aufrufer umhängen**

In `js/map-features/map-features-path-labels.js:131` ersetzen:

```js
	const fontSize = Math.max(4, getLocationNameLabelSize("dorf") + (pathSubtype === "Flussweg" ? 3 : 1) + getPathLabelFontDelta());
```

durch:

```js
	const fontSize = Math.max(4, getPathLabelBaseSize() + (pathSubtype === "Flussweg" ? 3 : 1) + getPathLabelFontDelta());
```

In `js/map-features/map-features-powerlines.js:159` ersetzen:

```js
		fontSize: `${Math.max(18, getLocationNameLabelSize("dorf") + 7)}px`,
```

durch:

```js
		// ⭐ Nachgerechnet ist dieser Wert heute IMMER 18: die Grundtafel erreicht höchstens 11,
		// 11 + 7 = 18. Die Kopplung an die Ortsschrift war hier also schon vor dem Umbau
		// wirkungslos -- der Aufruf bleibt trotzdem stehen, damit die Stellschraube nicht
		// verschwindet (Entwurf 2026-08-16-zoombaender-design.md §6).
		fontSize: `${Math.max(18, getPathLabelBaseSize() + 7)}px`,
```

- [ ] **Schritt 5: Test laufen lassen, Erfolg prüfen**

```bash
node js/map-features/__tests__/wegenamen-grundgroesse.test.js
```

Erwartet: `wegenamen-grundgroesse: alle Zusicherungen erfüllt`.

- [ ] **Schritt 6: Committen**

```bash
git status
git add js/map-features/map-features-path-labels.js js/map-features/map-features-powerlines.js js/map-features/__tests__/wegenamen-grundgroesse.test.js
git commit -m "refactor(zoombaender): Wegenamen bekommen ihre eigene Grundtafel"
```

---

## Aufgabe 3: Der Marker liest das Band, das tote Beiwerk fliegt raus

**Dateien:**
- Ändern: `js/map-features/map-features-location-marker-rendering.js:1-102` und `:311-323`
- Neu: `js/map-features/__tests__/zoombaender-erscheinungsstufe.test.js` (Marker-Hälfte; die
  Namens-Hälfte kommt in Aufgabe 4 dazu)

**Schnittstellen:**
- Verbraucht: `avesmapsLocationZoomBandValue`, `avesmapsLocationZoomBandMinZoom` (Aufgabe 1).
- Liefert unverändert: `getLocationMarkerSize(locationType, zoomLevel) => number`,
  `getLocationMarkerCoreRadius(locationType, zoomLevel) => number`,
  `getLocationMarkerBorderWidth(locationType, zoomLevel) => number` — Namen und Signaturen bleiben,
  weil `map-features-location-canvas-layer.js:141-142` sie ruft.
- Entfällt: `LOCATION_MARKER_RADIUS_SPEC`, `LOCATION_MARKER_MAX_ZOOM`, `locationZoomScale`,
  `getVillageMarkerStyle`, `getBuildingMarkerStyle`, `isVillageMarkerStyleLocation`.

- [ ] **Schritt 1: Vor dem Löschen greppen — gegen den GANZEN Baum**

```bash
git grep -n "locationZoomScale\|getVillageMarkerStyle\|getBuildingMarkerStyle\|isVillageMarkerStyleLocation\|LOCATION_MARKER_RADIUS_SPEC\|LOCATION_MARKER_MAX_ZOOM"
```

Erwartet: Treffer **nur** in `js/map-features/map-features-location-marker-rendering.js` (und ab
Aufgabe 1 in `zoombaender-vorgabe.test.js`, wo `ALTE_KURVE` bewusst eine eigene Kopie ist).
⚠️ Gegen den ganzen Baum, nicht nur `js/` — die Editorseiten sind eigenständige HTML-Dateien mit
eigenem `<script>`. Findet sich ein weiterer Aufrufer, **hier anhalten und melden**.

- [ ] **Schritt 2: Den Test schreiben**

Neue Datei `js/map-features/__tests__/zoombaender-erscheinungsstufe.test.js`:

```js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Die erste gefüllte Zelle des Zoombands steuert Marker UND Name -- es gibt keine zweite Zahl mehr.
// Entwurf: docs/superpowers/specs/2026-08-16-zoombaender-design.md §3.1
//
// Harness wie versteckter-ort-sichtbarkeit.test.js: runInThisContext, damit die Globals der Dateien
// gegen die echten Funktionen auflösen statt gegen Stubs.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/zoombaender-erscheinungsstufe.test.js

const loadBrowserScript = (absolutePath) => {
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};

global.window = {};
global.IS_EDIT_MODE = false;
global.CROSSING_LOCATION_TYPE = "crossing";
global.activeMapStyle = "stylized";
global.VISUAL_MAX_ZOOM_LEVEL = 5;

let visibleTypes = new Set(["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"]);
global.$ = () => ({ is: () => false });
global.isLocationTypeVisible = (locationType) => visibleTypes.has(locationType);
global.getUnconnectedLocationPublicIds = () => new Set();
global.getSparseCrossingPublicIds = () => new Set();
global.getSelectedMapLayerMode = () => "deregraphic";
global.isNodixLocation = () => false;
global.isCrossingLocation = () => false;
global.avesmapsRevealedHiddenLocationIds = new Set();

loadBrowserScript(path.join(__dirname, "../location-zoom-bands.js"));
loadBrowserScript(path.join(__dirname, "../map-features-location-marker-rendering.js"));

// NACH dem Laden: isMarkerEntryInRenderBounds steht in der geprüften Datei selbst.
global.isMarkerEntryInRenderBounds = () => true;

const RENDER_BOUNDS = {};
const eintrag = (locationType) => ({ locationType, name: "Probe", publicId: "loc-" + locationType, location: {} });
const zeigtMarker = (locationType, z) =>
	shouldShowLocationMarker(eintrag(locationType), z, RENDER_BOUNDS, createLocationVisibilityContext());

avesmapsApplyLocationZoomBands(null);

// ---- A. Die Vorgabe: 0/0/0/1/2/3 --------------------------------------------------------------
const ERWARTET = { metropole: 0, grossstadt: 0, stadt: 0, kleinstadt: 1, dorf: 2, gebaeude: 3 };
Object.entries(ERWARTET).forEach(([typ, ab]) => {
	for (let z = 0; z <= 7; z += 1) {
		assert.strictEqual(zeigtMarker(typ, z), z >= ab,
			`${typ} bei z${z}: erwartet ${z >= ab ? "sichtbar" : "unsichtbar"}`);
	}
});

// ---- B. Eine Übersteuerung verschiebt die Stufe ------------------------------------------------
avesmapsApplyLocationZoomBands({ marker: { dorf: [null, null, null, null, null, 9.28, 17.74, 17.74] } });
assert.strictEqual(zeigtMarker("dorf", 4), false, "das Dorf erscheint jetzt erst ab z5");
assert.strictEqual(zeigtMarker("dorf", 5), true);
assert.strictEqual(getLocationMarkerSize("dorf", 5), 9.28, "und trägt den eingestellten Durchmesser");

// ---- C. Eine ganz leere Zeile blendet die Klasse überall aus -----------------------------------
avesmapsApplyLocationZoomBands({ marker: { gebaeude: [null, null, null, null, null, null, null, null] } });
for (let z = 0; z <= 7; z += 1) {
	assert.strictEqual(zeigtMarker("gebaeude", z), false, `Bauwerke sind bei z${z} aus`);
}
assert.strictEqual(avesmapsLocationZoomBandMinZoom("marker", "gebaeude"), null);

// ---- D. 💣 UNTERHALB DES BANDES GIBT ES TROTZDEM EINE GRÖSSE ----------------------------------
// Die Prüfhaken zeigen ihre Funde OHNE Rücksicht auf die Zoomstufe (Owner 2026-08-14) -- sie
// steigen in shouldShowLocationMarker VOR der Bandprüfung aus. Gäbe getLocationMarkerSize dort 0
// zurück, bekäme der Fund einen Marker der Größe null: eingeblendet und unsichtbar zugleich.
// Genau das tat die abgeschaffte Kurve mit Math.max(spec.from, z) -- sie klemmte auf die erste Stufe.
avesmapsApplyLocationZoomBands(null);
assert.strictEqual(getLocationMarkerSize("gebaeude", 0), AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS.marker.gebaeude[3],
	"unter dem Band gilt die erste gefüllte Zelle");
assert.strictEqual(getLocationMarkerSize("dorf", 0), AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS.marker.dorf[2]);
assert.ok(getLocationMarkerSize("gebaeude", 0) > 0, "nie 0 -- sonst ist der Fund unsichtbar");

// ---- E. Kern und Kontur folgen dem Außendurchmesser --------------------------------------------
const aussen = getLocationMarkerSize("metropole", 5);
assert.strictEqual(Math.round(getLocationMarkerCoreRadius("metropole", 5) * 100) / 100,
	Math.round((aussen / 2 / 1.33) * 100) / 100, "Kern = Außen ÷ 2 ÷ 1,33");
assert.ok(getLocationMarkerBorderWidth("metropole", 5) >= 0.5, "die Kontur hat eine Untergrenze");

console.log("zoombaender-erscheinungsstufe: alle Zusicherungen erfüllt");
```

- [ ] **Schritt 3: Test laufen lassen, Fehlschlag prüfen**

```bash
node js/map-features/__tests__/zoombaender-erscheinungsstufe.test.js
```

Erwartet: `AssertionError` bei Block B oder D — die Datei liest noch die alte Kurve.

- [ ] **Schritt 4: Das tote Beiwerk löschen**

In `js/map-features/map-features-location-marker-rendering.js` die Zeilen **10 bis 52** ersatzlos
entfernen: `locationZoomScale`, `getVillageMarkerStyle`, `getBuildingMarkerStyle` und
`isVillageMarkerStyleLocation`. `getVisualZoomLevel` (Zeilen 1–8) **bleibt** — es wird von
`createLocationMarkerIcon` und von `map-features-path-labels.js` gebraucht.

- [ ] **Schritt 5: Die Kurve durch das Band ersetzen**

Den Block ab `// Marker-Kernradius (px)` bis einschließlich `getLocationMarkerBorderWidth` (heute
Zeilen 54–102) ersetzen durch:

```js
// Die Markergröße kommt aus dem Zoomband (js/map-features/location-zoom-bands.js), nicht mehr aus
// einer geometrischen Kurve. Der Admin stellt den AUSSENDURCHMESSER ein -- das ist die Zahl, die er
// auf dem Schirm misst; Kern und Kontur werden daraus zurückgerechnet.
const LOCATION_MARKER_CONTOUR_RATIO = 0.33; // weisse Kontur = 33 % des Kernradius ...
const LOCATION_MARKER_CONTOUR_MIN = 0.5;    // ... mindestens aber 0.5 px dick

function getLocationMarkerSize(locationType, zoomLevel = map.getZoom()) {
	if (locationType === CROSSING_LOCATION_TYPE) {
		// Kreuzungen sind kein Ortstyp und tragen kein Band -- sie erscheinen über ihren eigenen
		// Haken, ohne Zoomuntergrenze (Owner 2026-08-14).
		const visualZoomLevel = getVisualZoomLevel(zoomLevel);
		return visualZoomLevel <= 3 ? 5 : Math.max(7, 5 + visualZoomLevel * 1.5);
	}
	const value = avesmapsLocationZoomBandValue("marker", locationType, zoomLevel);
	if (value !== null) {
		return value;
	}
	// 💣 UNTERHALB DES BANDES GILT DIE ERSTE GEFÜLLTE ZELLE, NICHT 0. Diese Funktion wird auch für
	// Marker gerufen, die eine der Weichen WEITER OBEN in shouldShowLocationMarker eingeblendet hat
	// -- Prüfhaken-Funde, der Siedlungsfilter, der angepinnte Suchtreffer. Die zeigen ihre Funde
	// ausdrücklich ohne Rücksicht auf die Zoomstufe (Owner 2026-08-14); mit 0 bekämen sie einen
	// Marker der Größe null und wären eingeblendet und unsichtbar zugleich. Die abgeschaffte Kurve
	// tat dasselbe über Math.max(spec.from, z).
	const minZoom = avesmapsLocationZoomBandMinZoom("marker", locationType);
	return minZoom === null ? 0 : avesmapsLocationZoomBandValue("marker", locationType, minZoom);
}

function getLocationMarkerCoreRadius(locationType, zoomLevel = map.getZoom()) {
	return getLocationMarkerSize(locationType, zoomLevel) / 2 / (1 + LOCATION_MARKER_CONTOUR_RATIO);
}

function getLocationMarkerContourWidth(locationType, zoomLevel = map.getZoom()) {
	const coreRadius = getLocationMarkerCoreRadius(locationType, zoomLevel);
	return Math.max(LOCATION_MARKER_CONTOUR_MIN, coreRadius * LOCATION_MARKER_CONTOUR_RATIO);
}

function getLocationMarkerBorderWidth(locationType, zoomLevel = map.getZoom()) {
	if (locationType === CROSSING_LOCATION_TYPE) {
		return 0;
	}
	return Math.round(getLocationMarkerContourWidth(locationType, zoomLevel) * 100) / 100;
}
```

- [ ] **Schritt 6: Die Erscheinungsstufe in `shouldShowLocationMarker` umhängen**

In `js/map-features/map-features-location-marker-rendering.js` den Schluss der Funktion (heute
Zeilen 311–323) ersetzen durch:

```js
	// 💣 DIE ERSCHEINUNGSSTUFE IST DIE ERSTE GEFÜLLTE ZELLE DES BANDES -- es gibt keine zweite Zahl
	// mehr, die mit ihr auseinanderlaufen könnte. Bis zum 16.08.2026 stand 0/0/0/1/2/3 hier als
	// if-Kette UND in LOCATION_MARKER_RADIUS_SPEC[*].from; ein gekoppelter Wert in zwei Zeilen,
	// den nichts zusammenhielt.
	const typeVisible = visibilityContext
		? visibilityContext.isTypeVisible(entry.locationType)
		: isLocationTypeVisible(entry.locationType);
	return (isVisibleByNodixToggle || typeVisible)
		&& avesmapsLocationZoomBandValue("marker", entry.locationType, zoomLevel) !== null
		&& isMarkerEntryInRenderBounds(entry, renderBounds);
```

⚠️ Die Zeilen darüber (`nodixToggleChecked`, `isVisibleByNodixToggle`) bleiben unverändert. Die
Bandprüfung gilt auch für Nodices — genau wie die alte `zoomLevel >= minZoomByType`.

- [ ] **Schritt 7: Beide Tests laufen lassen**

```bash
node js/map-features/__tests__/zoombaender-erscheinungsstufe.test.js
node js/map-features/__tests__/zoombaender-vorgabe.test.js
```

Erwartet: beide melden „alle Zusicherungen erfüllt".

- [ ] **Schritt 8: Committen**

```bash
git status
git add js/map-features/map-features-location-marker-rendering.js js/map-features/__tests__/zoombaender-erscheinungsstufe.test.js
git commit -m "feat(zoombaender): der Marker liest sein Band; totes Beiwerk entfernt"
```

---

## Aufgabe 4: Der Name liest das Band, `LOCATION_NAME_LABEL_CONFIG` verschwindet

**Dateien:**
- Ändern: `js/map-features/map-features-location-name-labels.js:8-21` und `:91-101`
- Ändern: `js/config.js:640-647` (`LOCATION_NAME_LABEL_CONFIG` ganz weg) und `:612-619`
  (tote Felder aus `LOCATION_TYPE_CONFIG`)
- Ändern: `js/map-features/map-features-label-collisions.js:279`
- Ändern: `js/ui/spotlight-search-focus.js:105-108`
- Ändern: `js/map-features/__tests__/pruefhaken-sichtbarkeit.test.js:26`
- Ändern: `js/map-features/__tests__/versteckter-ort-sichtbarkeit.test.js:23`
- Ändern: `js/map-features/__tests__/zoombaender-erscheinungsstufe.test.js` (Namens-Hälfte anhängen)

**Schnittstellen:**
- Verbraucht: `avesmapsLocationZoomBandValue`, `avesmapsLocationZoomBandMinZoom` (Aufgabe 1);
  `getPathLabelBaseSize` existiert bereits (Aufgabe 2) und wird hier **nicht** mehr gebraucht.
- Liefert unverändert: `getLocationNameLabelSize(locationType, zoomLevel) => number`.
- Entfällt: `LOCATION_NAME_LABEL_CONFIG`, `LOCATION_NAME_LABEL_SIZE_BY_ZOOM`.

- [ ] **Schritt 1: Vor dem Löschen greppen**

```bash
git grep -n "LOCATION_NAME_LABEL_CONFIG\|LOCATION_NAME_LABEL_SIZE_BY_ZOOM"
git grep -n "LOCATION_TYPE_CONFIG\[" 
git grep -n "\.radius\b" -- js/map-features js/ui js/routing
```

Erwartet für die ersten beiden Namen: `js/config.js`, `map-features-location-name-labels.js`,
`map-features-label-collisions.js`, `js/ui/spotlight-search-focus.js` und die zwei genannten
Testdateien — **mehr nicht**. Für `LOCATION_TYPE_CONFIG[` nur Lesezugriffe auf `queryParam` und
`singularLabel`. Weitere Treffer: **anhalten und melden**.

- [ ] **Schritt 2: Die Namens-Hälfte an den Test anhängen**

In `js/map-features/__tests__/zoombaender-erscheinungsstufe.test.js` **vor** der `console.log`-Zeile
einfügen:

```js
// ---- F. Der Name: eigene, spätere Erscheinungsstufe --------------------------------------------
const zeigtName = (locationType, z) =>
	shouldShowLocationNameLabel(eintrag(locationType), z, createLocationVisibilityContext());

avesmapsApplyLocationZoomBands(null);
const ERWARTET_NAME = { metropole: 0, grossstadt: 0, stadt: 2, kleinstadt: 3, dorf: 4, gebaeude: 4 };
Object.entries(ERWARTET_NAME).forEach(([typ, ab]) => {
	for (let z = 0; z <= 7; z += 1) {
		assert.strictEqual(zeigtName(typ, z), z >= ab,
			`Name ${typ} bei z${z}: erwartet ${z >= ab ? "sichtbar" : "unsichtbar"}`);
	}
});

// Der Name erscheint nie vor seinem Marker.
Object.keys(ERWARTET_NAME).forEach((typ) => {
	assert.ok(avesmapsLocationZoomBandMinZoom("label", typ) >= avesmapsLocationZoomBandMinZoom("marker", typ),
		`${typ}: der Name darf nicht vor dem Marker kommen`);
});

// ---- G. Schriftgröße unter dem Band -----------------------------------------------------------
// ⚠️ Unter dem Band gilt 8 pt -- die alte Untergrenze aus Math.max(8, …). Das reproduziert den
// bisherigen Wert für alle Klassen mit EINER benannten Ausnahme: das Dorf lieferte bei z3 8,5.
// Diese Zahl bediente nur die Wegenamen, und die haben seit dem 16.08.2026 ihre eigene Tafel
// (map-features-path-labels.js). Für Ortsnamen selbst ist der Pfad ohnehin nur über den
// Siedlungsfilter und den angepinnten Suchtreffer erreichbar.
assert.strictEqual(getLocationNameLabelSize("dorf", 0), 8, "unter dem Band gilt die alte Untergrenze");
assert.strictEqual(getLocationNameLabelSize("gebaeude", 2), 8);
assert.strictEqual(getLocationNameLabelSize("metropole", 0), 8, "im Band gilt der Bandwert");
assert.strictEqual(getLocationNameLabelSize("dorf", 5), 11);
```

- [ ] **Schritt 3: Test laufen lassen, Fehlschlag prüfen**

```bash
node js/map-features/__tests__/zoombaender-erscheinungsstufe.test.js
```

Erwartet: `AssertionError` in Block F oder G.

- [ ] **Schritt 4: Den Namens-Zeichner umstellen**

In `js/map-features/map-features-location-name-labels.js` die Zeilen **8 bis 21**
(`LOCATION_NAME_LABEL_SIZE_BY_ZOOM` und `getLocationNameLabelSize`) ersetzen durch:

```js
// ⚠️ Unter dem Band gilt diese Zahl -- die alte Untergrenze aus Math.max(8, …). Erreichbar ist der
// Fall nur über die Weichen, die shouldShowLocationNameLabel VOR der Bandprüfung nehmen (der
// Siedlungsfilter des Editors, der angepinnte Suchtreffer).
const LOCATION_NAME_LABEL_BELOW_BAND_SIZE = 8;

// Die Schriftgröße kommt aus dem Zoomband (js/map-features/location-zoom-bands.js).
// 🔴 Nicht mehr über getVisualZoomLevel (das klemmt auf 5): die Ortsschrift reicht bis z7. Die
// WEGENAMEN behalten ihren 0–5-Index und ihre eigene Grundtafel (map-features-path-labels.js) --
// sie hingen bis zum 16.08.2026 an der Dorf-Zeile dieser Datei.
function getLocationNameLabelSize(locationType, zoomLevel = map.getZoom()) {
	const value = avesmapsLocationZoomBandValue("label", locationType, zoomLevel);
	return value === null ? LOCATION_NAME_LABEL_BELOW_BAND_SIZE : value;
}
```

- [ ] **Schritt 5: Die Sichtbarkeitsregel des Namens umhängen**

In derselben Datei die Zeilen **91 bis 101** ersetzen durch:

```js
	const nodixToggleChecked = visibilityContext
		? visibilityContext.nodixToggleChecked
		: IS_EDIT_MODE && $("#toggleNodix").is(":checked");
	const isVisibleByNodixToggle = nodixToggleChecked
		&& isNodixLocation(entry.location)
		&& zoomLevel >= 2;
	const typeVisible = visibilityContext
		? visibilityContext.isTypeVisible(entry.locationType)
		: isLocationTypeVisible(entry.locationType);
	// 💣 Die Erscheinungsstufe des NAMENS ist die erste gefüllte Zelle seines Bandes -- eine andere
	// (spätere) als die des Markers. Beide stehen jetzt in derselben Tafel und können nicht mehr
	// getrennt voneinander verrutschen.
	return isVisibleByNodixToggle
		|| (avesmapsLocationZoomBandValue("label", entry.locationType, zoomLevel) !== null && typeVisible);
```

- [ ] **Schritt 6: `LOCATION_NAME_LABEL_CONFIG` und die toten Felder aus `js/config.js` entfernen**

`js/config.js:640-647` (`const LOCATION_NAME_LABEL_CONFIG = { … };` samt Kommentar) ersatzlos
löschen.

`js/config.js:612-619` — aus jeder der sechs Zeilen von `LOCATION_TYPE_CONFIG` die Felder `radius`,
`shape` und `borderWidth` entfernen; `label`, `singularLabel`, `icon` und `queryParam` bleiben.
Die Zeilen lauten danach:

```js
const LOCATION_TYPE_CONFIG = {
	// ⚠️ radius/shape/borderWidth standen hier bis zum 16.08.2026 und wurden von keiner Zeile
	// gelesen -- die Markergeometrie kommt aus dem Zoomband (js/map-features/location-zoom-bands.js).
	metropole: { label: "Metropolen", singularLabel: "Metropole", icon: "🏛️", queryParam: "toggleMetropolen" },
	grossstadt: { label: "Großstädte", singularLabel: "Großstadt", icon: "🏰", queryParam: "toggleGrossstaedte" },
	stadt: { label: "Städte", singularLabel: "Stadt", icon: "⛪", queryParam: "toggleStaedte" },
	kleinstadt: { label: "Kleinstädte", singularLabel: "Kleinstadt", icon: "🏘️", queryParam: "toggleKleinstaedte" },
	dorf: { label: "Dörfer", singularLabel: "Dorf", icon: "🏡", queryParam: "toggleDoerfer" },
	gebaeude: { label: "Besondere Bauwerke/Stätten", singularLabel: "Besondere Bauwerke/Stätten", icon: "🏛️", queryParam: "toggleGebaeude" },
};
```

- [ ] **Schritt 7: Die zwei Mitleser umhängen**

`js/map-features/map-features-label-collisions.js:279` ersetzen:

```js
			minZoom: LOCATION_NAME_LABEL_CONFIG[entry.markerEntry?.locationType]?.minZoom || 0,
```

durch:

```js
			// Die Erscheinungsstufe des Namens aus dem Zoomband -- bei gleicher Priorität wird
			// zuerst platziert, was schon länger sichtbar ist.
			minZoom: avesmapsLocationZoomBandMinZoom("label", entry.markerEntry?.locationType) ?? 0,
```

`js/ui/spotlight-search-focus.js:105-108` ersetzen:

```js
function getSpotlightLocationZoom(markerEntry) {
	const labelConfig = LOCATION_NAME_LABEL_CONFIG[markerEntry.locationType] || LOCATION_NAME_LABEL_CONFIG.dorf;
	return Math.max(labelConfig.minZoom || 0, Math.min(VISUAL_MAX_ZOOM_LEVEL, map.getMaxZoom()));
}
```

durch:

```js
function getSpotlightLocationZoom(markerEntry) {
	// Weit genug hinein, dass der Treffer seinen Namen trägt -- die Stufe kommt aus dem Zoomband.
	const minZoom = avesmapsLocationZoomBandMinZoom("label", markerEntry.locationType) ?? 0;
	return Math.max(minZoom, Math.min(VISUAL_MAX_ZOOM_LEVEL, map.getMaxZoom()));
}
```

- [ ] **Schritt 8: Die zwei fremden Tests nachziehen**

💣 Beide stubben heute `global.LOCATION_NAME_LABEL_CONFIG` — mit dem Wegfall der Konstante liefe
`shouldShowLocationNameLabel` gegen `undefined`. Sie gehören nicht dieser Aufgabe, aber ein rotes
Testfeld hält den Deploy an (AGENTS.md §9).

In `js/map-features/__tests__/pruefhaken-sichtbarkeit.test.js` die Zeile

```js
global.LOCATION_NAME_LABEL_CONFIG = { dorf: { minZoom: 2 }, gebaeude: { minZoom: 3 } };
```

ersatzlos löschen und **vor** dem ersten `loadBrowserScript(...marker-rendering.js)` einfügen:

```js
// Die Erscheinungsstufen kommen seit dem 16.08.2026 aus dem Zoomband, nicht mehr aus einer
// Konstante -- also die echte Datei laden statt sie zu stubben.
loadBrowserScript(path.join(__dirname, "../location-zoom-bands.js"));
```

Dieselben zwei Änderungen in `js/map-features/__tests__/versteckter-ort-sichtbarkeit.test.js`
(dort ist es Zeile 23).

⚠️ Beide Tests setzen `visibleTypes` auf `dorf`; das Dorf erscheint im Band ab z2 (Marker) bzw. z4
(Name). Rufen die Tests `showMarker(entry, z)` mit einem kleineren `z`, sind sie danach rot —
in dem Fall den Zoomwert im Test auf 4 heben und im Kommentar begründen, **nicht** das Band ändern.

- [ ] **Schritt 9: Alle betroffenen Tests laufen lassen**

```bash
node js/map-features/__tests__/zoombaender-erscheinungsstufe.test.js
node js/map-features/__tests__/pruefhaken-sichtbarkeit.test.js
node js/map-features/__tests__/versteckter-ort-sichtbarkeit.test.js
node js/map-features/__tests__/wegenamen-grundgroesse.test.js
```

Erwartet: alle vier grün.

- [ ] **Schritt 10: Committen**

```bash
git status
git add js/map-features/map-features-location-name-labels.js js/config.js js/map-features/map-features-label-collisions.js js/ui/spotlight-search-focus.js js/map-features/__tests__/zoombaender-erscheinungsstufe.test.js js/map-features/__tests__/pruefhaken-sichtbarkeit.test.js js/map-features/__tests__/versteckter-ort-sichtbarkeit.test.js
git commit -m "feat(zoombaender): der Ortsname liest sein Band bis z7"
```

---

## Aufgabe 5: Der Server — Bibliothek und zwei Endpunkte

**Dateien:**
- Neu: `api/_internal/app/zoom-bands.php`
- Neu: `api/_internal/app/__tests__/zoom-bands-test.php`
- Neu: `api/app/zoom-bands.php`
- Neu: `api/edit/map/zoom-bands.php`

**Schnittstellen:**
- Verbraucht: `avesmapsAppSettingGetManyWithoutDdl`, `avesmapsAppSettingSet`,
  `avesmapsAppSettingEnsureTable`, `avesmapsAppSettingEnsureWideValue`
  (`api/_internal/app/app-setting.php`).
- Liefert:
  - `AVESMAPS_ZOOM_BANDS_SETTING_KEY = 'location_zoom_bands'`
  - `AVESMAPS_ZOOM_BANDS_STAMP_KEY = 'location_zoom_bands_stamp'`
  - `avesmapsZoomBandsValidate(mixed $incoming): ?array` — `null` = abgelehnt
  - `avesmapsZoomBandsRead(PDO $pdo): array` — `['bands' => ?array, 'stamp' => string]`
  - `avesmapsZoomBandsWrite(PDO $pdo, array $bands): bool` — `true` = geschrieben **und** zurückgelesen
  - `avesmapsZoomBandsReset(PDO $pdo): void`

- [ ] **Schritt 1: Den Test schreiben**

Neue Datei `api/_internal/app/__tests__/zoom-bands-test.php`:

```php
<?php
// api/_internal/app/__tests__/zoom-bands-test.php
declare(strict_types=1);

/**
 * Die Zoombänder als Speicher: Prüfung, Schreiben, Rücklesen, Zurücksetzen.
 * Entwurf: docs/superpowers/specs/2026-08-16-zoombaender-design.md §4, §5.3
 *
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll \
 *       api/_internal/app/__tests__/zoom-bands-test.php
 */

if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist '" . ini_get('zend.assertions') . "', nicht '1'.\n");
    exit(2);
}

require_once __DIR__ . '/../app-setting.php';
require_once __DIR__ . '/../zoom-bands.php';

/**
 * SQLite spricht kein MySQL. Zwei Stellen werden übersetzt, sonst nichts:
 *  - das CREATE TABLE aus avesmapsAppSettingEnsureTable (ENGINE=InnoDB kennt SQLite nicht)
 *  - das ON DUPLICATE KEY UPDATE aus avesmapsAppSettingSet
 * Dieselbe Bauart wie api/_internal/conflicts/__tests__/conflict-keeper-test.php.
 */
final class AvesmapsZoomBandsTestPdo extends PDO
{
    public function exec($statement): int|false
    {
        if (str_contains((string) $statement, 'CREATE TABLE IF NOT EXISTS app_setting')) {
            return parent::exec(
                'CREATE TABLE IF NOT EXISTS app_setting (
                    setting_key TEXT PRIMARY KEY,
                    setting_value TEXT NOT NULL,
                    updated_at TEXT
                )'
            );
        }
        return parent::exec($statement);
    }

    public function prepare($query, $options = []): PDOStatement|false
    {
        $query = str_replace(
            'ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
            'ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value',
            (string) $query
        );
        return parent::prepare($query, $options);
    }
}

$pdo = new AvesmapsZoomBandsTestPdo('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
avesmapsAppSettingEnsureTable($pdo);

$gueltig = [
    'version' => 1,
    'marker' => ['dorf' => [null, null, 1.33, 2.54, 4.86, 9.28, 17.74, 17.74]],
    'label' => ['dorf' => [null, null, null, null, 10, 11, 11, 11]],
];

// ============================================================ A. Die Prüfung

assert(avesmapsZoomBandsValidate($gueltig) !== null, 'eine wohlgeformte Tafel wird angenommen');

// 🔴 Was abgelehnt wird -- und jeder Fall einzeln, weil ein durchgerutschter Wert im Browser
// jedes Besuchers landet.
assert(avesmapsZoomBandsValidate(null) === null, 'null ist keine Tafel');
assert(avesmapsZoomBandsValidate('marker') === null, 'ein String ist keine Tafel');
assert(avesmapsZoomBandsValidate([1, 2, 3]) === null, 'eine Liste ist keine Tafel');
assert(avesmapsZoomBandsValidate(['marker' => 'x', 'label' => []]) === null, 'marker muss ein Objekt sein');
assert(avesmapsZoomBandsValidate(['marker' => ['dorf' => 'x'], 'label' => []]) === null, 'eine Zeile ist eine Liste');
assert(avesmapsZoomBandsValidate(['marker' => ['Dorf!' => [1]], 'label' => []]) === null,
    'ein Klassenschluessel ist [a-z_]{1,32}');
assert(avesmapsZoomBandsValidate(['marker' => ['dorf' => array_fill(0, 9, 5.0)], 'label' => []]) === null,
    'hoechstens acht Zellen');
assert(avesmapsZoomBandsValidate(['marker' => ['dorf' => [0.1]], 'label' => []]) === null,
    'unter der Schranke: 0,1 px');
assert(avesmapsZoomBandsValidate(['marker' => ['dorf' => [999.0]], 'label' => []]) === null,
    'ueber der Schranke: 999 px');
assert(avesmapsZoomBandsValidate(['marker' => [], 'label' => ['dorf' => [1.0]]]) === null,
    'unter der Schranke: 1 pt Schrift');
assert(avesmapsZoomBandsValidate(['marker' => ['dorf' => ['5']], 'label' => []]) === null,
    'ein String ist keine Zahl -- auch wenn er wie eine aussieht');

// ⚠️ null IST erlaubt: es ist die Aussage "hier nicht".
assert(avesmapsZoomBandsValidate(['marker' => ['dorf' => [null, null, 1.33]], 'label' => []]) !== null,
    'null ist ein gueltiger Zellwert');

// 8 kB Deckel.
$rieseTafel = ['marker' => [], 'label' => []];
for ($i = 0; $i < 500; $i++) {
    $rieseTafel['marker']['klasse_' . $i] = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0];
}
assert(avesmapsZoomBandsValidate($rieseTafel) === null, 'ueber 8 kB wird abgelehnt');

// ============================================================ B. Schreiben und Ruecklesen

$geprueft = avesmapsZoomBandsValidate($gueltig);
assert(avesmapsZoomBandsWrite($pdo, $geprueft) === true, 'der Schreibvorgang meldet Erfolg');

$gelesen = avesmapsZoomBandsRead($pdo);
assert($gelesen['bands'] !== null, 'danach steht etwas da');
assert($gelesen['bands']['marker']['dorf'][5] === 9.28, 'und es ist das Geschriebene');
assert($gelesen['stamp'] !== '', 'der Stempel ist gesetzt');

// ============================================================ C. Zuruecksetzen LOESCHT die Zeile

avesmapsZoomBandsReset($pdo);
$nachher = avesmapsZoomBandsRead($pdo);
assert($nachher['bands'] === null, 'nach dem Zuruecksetzen ist NICHTS gespeichert');
// 🔴 Kein Abbild der Vorgabewerte -- der Server kennt sie nicht, und eine Kopie in der Datenbank
// veraltet beim naechsten Mal, wenn jemand die Vorgabe im Browser aendert.
$zeilen = $pdo->query("SELECT COUNT(*) FROM app_setting WHERE setting_key = 'location_zoom_bands'")
    ->fetchColumn();
assert((int) $zeilen === 0, 'die Zeile ist weg, nicht leer');

// ============================================================ D. Die Rueckleseprobe

// 💣 DER GRUND, WARUM ES SIE GIBT. `setting_value` war einmal VARCHAR(255); MySQL schnitt
// ausserhalb des strikten Modus STILL ab, json_decode lieferte danach NULL, der Leser fiel auf
// seine Konstante zurueck -- von "es wurde nie etwas gespeichert" nicht zu unterscheiden. Genau so
// hat der Speichern-Knopf des Tempowerte-Fensters vom 14.08.2026 an nichts getan und nie geklagt.
//
// ⭐ Simuliert mit einem SQLite-TRIGGER, der jeden frisch eingefuegten Wert nach 40 Zeichen
// abschneidet -- ohne Fehler, genau wie MySQL es tat. Er kann AFTER INSERT bleiben, weil Block C
// die Zeile geloescht hat: der naechste Schreibvorgang nimmt den INSERT-Zweig.
$pdo->exec(
    "CREATE TRIGGER app_setting_kappen AFTER INSERT ON app_setting
     BEGIN
        UPDATE app_setting SET setting_value = substr(setting_value, 1, 40)
         WHERE setting_key = new.setting_key;
     END"
);
assert(avesmapsZoomBandsWrite($pdo, $geprueft) === false,
    'ein still abgeschnittener Wert MUSS als Fehlschlag gemeldet werden');
$pdo->exec('DROP TRIGGER app_setting_kappen');

// ============================================================ E. Ein kaputter Speicherwert

$pdo->exec('DELETE FROM app_setting');
$pdo->exec("INSERT INTO app_setting (setting_key, setting_value) VALUES ('location_zoom_bands', 'kein json')");
$kaputt = avesmapsZoomBandsRead($pdo);
// ⚠️ Nicht vorhanden, nicht "Fehler": die Karte darf an einem kaputten Einstellungswert nicht
// haengenbleiben -- sie hat ihre Vorgabewerte.
assert($kaputt['bands'] === null, 'unlesbares JSON gilt als nicht vorhanden');

echo "zoom-bands: alle Zusicherungen erfuellt\n";
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag prüfen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/zoom-bands-test.php
```

Erwartet: `Failed opening required '…/zoom-bands.php'`.

- [ ] **Schritt 3: Die Bibliothek anlegen**

Neue Datei `api/_internal/app/zoom-bands.php`:

```php
<?php

declare(strict_types=1);

// Die Zoombänder: Prüfung, Lesen, Schreiben, Zurücksetzen.
// Entwurf: docs/superpowers/specs/2026-08-16-zoombaender-design.md §4, §5.3
//
// 🔴 DER SERVER KENNT DIE VORGABEWERTE NICHT. Er speichert nur die Übersteuerung und gibt sie
// zurück; die Tafel steht im Browser (js/map-features/location-zoom-bands.js). Läge sie auch hier,
// gäbe es sie zweimal und sie liefen auseinander.
//
// 🔴 UND ER FÜHRT KEINE KLASSENLISTE. Die sechs Ortsklassen stehen im Server heute schon zweimal
// (api/edit/map/features.php, api/app/report-location.php); eine dritte Abschrift wäre genau die
// Divergenz, die dieser Umbau an anderer Stelle abbaut. Geprüft werden Form und Schranken; über
// die Klassennamen entscheidet der Browser, der sie ohnehin gegen seine Vorgabe abgleicht.

require_once __DIR__ . '/app-setting.php';

const AVESMAPS_ZOOM_BANDS_SETTING_KEY = 'location_zoom_bands';
const AVESMAPS_ZOOM_BANDS_STAMP_KEY = 'location_zoom_bands_stamp';
const AVESMAPS_ZOOM_BANDS_MAX_BYTES = 8192;
const AVESMAPS_ZOOM_BANDS_MAX_CELLS = 8;   // z0 bis z7
const AVESMAPS_ZOOM_BANDS_LIMITS = [
    'marker' => [0.5, 200.0],  // Außendurchmesser in px
    'label' => [4.0, 96.0],    // Schriftgröße in pt
];

/**
 * Prüft eine eingehende Tafel. Gibt die bereinigte Tafel zurück oder null, wenn sie abzulehnen ist.
 *
 * ⚠️ Sie normalisiert NICHT (kein Auffüllen, kein Vorwärtsfüllen) -- das tut der Browser gegen
 * seine eigene Vorgabe. Hier geht es nur darum, dass nichts Unsinniges in die Datenbank kommt.
 */
function avesmapsZoomBandsValidate(mixed $incoming): ?array
{
    if (!is_array($incoming)) {
        return null;
    }

    $clean = ['version' => 1];
    foreach (['marker', 'label'] as $kind) {
        $rows = $incoming[$kind] ?? [];
        if (!is_array($rows)) {
            return null;
        }
        [$min, $max] = AVESMAPS_ZOOM_BANDS_LIMITS[$kind];
        $cleanRows = [];
        foreach ($rows as $locationType => $row) {
            // ⚠️ KEIN array_is_list(). Die Funktion gibt es erst ab PHP 8.1, und im ganzen Haus
            // benutzt sie bisher niemand -- diese Datei ist nicht der Ort, das als Erste zu tun,
            // solange die PHP-Fassung auf STRATO nicht nachgemessen ist. Sie wird auch nicht
            // gebraucht: ein JSON-Array käme hier mit GANZZAHLIGEN Schlüsseln an, und die fallen
            // an is_string() heraus.
            if (!is_string($locationType) || preg_match('/^[a-z_]{1,32}$/', $locationType) !== 1) {
                return null;
            }
            if (!is_array($row) || count($row) > AVESMAPS_ZOOM_BANDS_MAX_CELLS) {
                return null;
            }
            $cleanRow = [];
            $expectedIndex = 0;
            foreach ($row as $index => $cell) {
                // 💣 Eine Zeile ist eine LISTE: 0, 1, 2, … ohne Lücke. Ein Objekt `{"2": 5}` käme
                // sonst als Zeile durch, und der Browser läse den Wert an der falschen Zoomstufe.
                if ($index !== $expectedIndex) {
                    return null;
                }
                $expectedIndex += 1;
                if ($cell === null) {
                    $cleanRow[] = null;
                    continue;
                }
                // 💣 KEINE STRINGS. "5" sieht aus wie eine Zahl und ist keine; JSON kennt den
                // Unterschied, und der Browser prüft ihn ebenfalls (typeof raw === "number").
                if (!is_int($cell) && !is_float($cell)) {
                    return null;
                }
                $value = (float) $cell;
                if (!is_finite($value) || $value < $min || $value > $max) {
                    return null;
                }
                $cleanRow[] = $value;
            }
            $cleanRows[$locationType] = $cleanRow;
        }
        // ⚠️ Ist hier nichts drin, wird daraus beim Kodieren `[]` statt `{}`. Das ist unschädlich:
        // der Browser prüft `!Array.isArray(...)` und fällt dann auf die reine Vorgabe zurück --
        // genau die richtige Bedeutung für „nichts übersteuert".
        $clean[$kind] = $cleanRows;
    }

    $encoded = json_encode($clean, JSON_UNESCAPED_UNICODE);
    if ($encoded === false || strlen($encoded) > AVESMAPS_ZOOM_BANDS_MAX_BYTES) {
        return null;
    }

    return json_decode($encoded, true);
}

/**
 * Liest Tafel und Stempel. EINE Abfrage, KEIN DDL -- diese Funktion sitzt auch hinter dem
 * öffentlichen Endpunkt, und avesmapsAppSettingGet legt bei jedem Aufruf die Tabelle an.
 *
 * @return array{bands: ?array, stamp: string}
 */
function avesmapsZoomBandsRead(PDO $pdo): array
{
    $rows = avesmapsAppSettingGetManyWithoutDdl(
        $pdo,
        [AVESMAPS_ZOOM_BANDS_SETTING_KEY, AVESMAPS_ZOOM_BANDS_STAMP_KEY]
    );

    $raw = $rows[AVESMAPS_ZOOM_BANDS_SETTING_KEY] ?? '';
    $bands = null;
    if ($raw !== '') {
        $decoded = json_decode($raw, true);
        // ⚠️ Unlesbares JSON gilt als "nichts gespeichert", nicht als Fehler: die Karte darf an
        // einem kaputten Einstellungswert nicht hängenbleiben.
        $bands = is_array($decoded) ? $decoded : null;
    }

    return ['bands' => $bands, 'stamp' => $rows[AVESMAPS_ZOOM_BANDS_STAMP_KEY] ?? ''];
}

/**
 * Schreibt die Tafel und LIEST SIE ZURÜCK.
 *
 * 💣 Ein Speichern, das nicht ankommt, meldet das. `setting_value` war einmal VARCHAR(255): MySQL
 * schnitt ausserhalb des strikten Modus STILL ab, json_decode lieferte danach NULL, und der Leser
 * fiel auf seine Konstante zurück -- von "es wurde nie etwas gespeichert" nicht zu unterscheiden.
 * ⚠️ EnsureWideValue ist DDL, also vor dem Schreiben und nie in einer Transaktion; und es gehört
 * NUR auf diesen kalten Pfad (seine information_schema-Sonde ist die Last aus AGENTS.md §10).
 */
function avesmapsZoomBandsWrite(PDO $pdo, array $bands): bool
{
    avesmapsAppSettingEnsureWideValue($pdo);
    $encoded = json_encode($bands, JSON_UNESCAPED_UNICODE);
    if ($encoded === false) {
        return false;
    }
    avesmapsAppSettingSet($pdo, AVESMAPS_ZOOM_BANDS_SETTING_KEY, $encoded);
    avesmapsAppSettingSet($pdo, AVESMAPS_ZOOM_BANDS_STAMP_KEY, (string) time());

    return avesmapsAppSettingGetWithoutDdl($pdo, AVESMAPS_ZOOM_BANDS_SETTING_KEY, '') === $encoded;
}

/**
 * 🔴 LÖSCHT die Zeile, statt die Vorgabewerte hineinzuschreiben. Ein Rücksetzer, der eine Kopie
 * hinterlässt, veraltet beim nächsten Mal, wenn jemand die Vorgabe im Browser ändert -- und niemand
 * merkt es, weil in der Datenbank etwas steht.
 */
function avesmapsZoomBandsReset(PDO $pdo): void
{
    $statement = $pdo->prepare('DELETE FROM app_setting WHERE setting_key = :k');
    $statement->execute(['k' => AVESMAPS_ZOOM_BANDS_SETTING_KEY]);
    avesmapsAppSettingSet($pdo, AVESMAPS_ZOOM_BANDS_STAMP_KEY, (string) time());
}
```

- [ ] **Schritt 4: Test laufen lassen, Erfolg prüfen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_pdo_sqlite.dll api/_internal/app/__tests__/zoom-bands-test.php
```

Erwartet: `zoom-bands: alle Zusicherungen erfuellt`.

- [ ] **Schritt 5: Den öffentlichen Leser anlegen**

Neue Datei `api/app/zoom-bands.php`:

```php
<?php

declare(strict_types=1);

// GET /api/app/zoom-bands.php -- die Übersteuerung der Zoombänder für den Browser.
// Entwurf: docs/superpowers/specs/2026-08-16-zoombaender-design.md §5.2
//
// 🔴 FÄLLT OFFEN AUS. Jeder Fehler ergibt `bands: null`, nie ein 500: der Browser hat seine
// Vorgabewerte und zeichnet ohne diesen Endpunkt wie bisher. Ein Ausfall hier darf die Karte
// nicht aufhalten.

require __DIR__ . '/../_internal/bootstrap.php';
require_once __DIR__ . '/../_internal/app/zoom-bands.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());
    avesmapsApplyCorsPolicy($config);

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }

    // 💣 DER TEILBAUM, NICHT DIE GANZE KONFIGURATION. `avesmapsCreatePdo(array $databaseConfig)`
    // nimmt ein Array, und `$config` IST eins -- PHP beschwert sich also nicht, drinnen ist dann
    // alles leer, und der catch macht daraus eine leere Antwort. Genau so hat das Tempowerte-Fenster
    // vom Tag seiner Veröffentlichung an nie geladen. Bewacht von
    // api/_internal/__tests__/create-pdo-argument-test.php.
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    $state = avesmapsZoomBandsRead($pdo);
} catch (Throwable) {
    $state = ['bands' => null, 'stamp' => ''];
}

// Schwacher ETag auf dem Stempel: unverändert -> 304, und der Browser nutzt seine Kopie.
$etag = 'W/"zb-' . ($state['stamp'] !== '' ? $state['stamp'] : '0') . '"';
header('ETag: ' . $etag);
header('Cache-Control: no-cache, must-revalidate');
$ifNoneMatch = (string) ($_SERVER['HTTP_IF_NONE_MATCH'] ?? '');
if ($ifNoneMatch !== '' && avesmapsETagMatches($ifNoneMatch, $etag)) {
    http_response_code(304);
    exit;
}

avesmapsJsonResponse(200, [
    'ok' => true,
    'bands' => $state['bands'],
    'stamp' => $state['stamp'],
]);
```

⚠️ Vor dem Weiterbauen prüfen, dass `avesmapsETagMatches` und `avesmapsApiRoot` aus
`api/_internal/bootstrap.php` tatsächlich so heißen:

```bash
git grep -n "function avesmapsETagMatches\|function avesmapsApiRoot\|function avesmapsJsonResponse" api/_internal/bootstrap.php
```

- [ ] **Schritt 6: Den Editor-Endpunkt anlegen**

Neue Datei `api/edit/map/zoom-bands.php`:

```php
<?php

declare(strict_types=1);

// POST /api/edit/map/zoom-bands.php -- die Zoombänder lesen, speichern, zurücksetzen.
// Entwurf: docs/superpowers/specs/2026-08-16-zoombaender-design.md §5.3
// Vorbild in Form und Reihenfolge: api/edit/map/travel-values.php
//
// 🔴 LESEN darf `edit`, SPEICHERN und ZURÜCKSETZEN nur `admin`. Der Riegel steht hier, nicht nur
// am ausgegrauten Knopf im Fenster.

require __DIR__ . '/../../_internal/auth.php';
require_once __DIR__ . '/../../_internal/app/app-setting.php';
require_once __DIR__ . '/../../_internal/app/zoom-bands.php';
require_once __DIR__ . '/../../_internal/map/features.php';

try {
    $config = avesmapsLoadApiConfig(avesmapsApiRoot());

    if (!avesmapsApplyCorsPolicy($config)) {
        avesmapsErrorResponse(403, 'forbidden_origin', 'Diese Herkunft darf Zoombänder nicht bearbeiten.');
    }

    $requestMethod = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'POST'));
    if ($requestMethod === 'OPTIONS') {
        avesmapsJsonResponse(204);
    }
    if ($requestMethod !== 'POST') {
        avesmapsErrorResponse(405, 'method_not_allowed', 'Nur POST ist fuer diesen Endpoint erlaubt.');
    }

    $user = avesmapsRequireUserWithCapability('edit');
    $maySave = avesmapsUserCan($user, 'admin');
    $payload = avesmapsReadJsonRequest();
    $action = avesmapsNormalizeSingleLine((string) ($payload['action'] ?? 'get'), 40);

    // 💣 DER TEILBAUM, NICHT DIE GANZE KONFIGURATION (siehe api/app/zoom-bands.php).
    $pdo = avesmapsCreatePdo($config['database'] ?? []);
    avesmapsAppSettingEnsureTable($pdo);

    if ($action === 'get') {
        $state = avesmapsZoomBandsRead($pdo);
        avesmapsJsonResponse(200, [
            'ok' => true,
            'bands' => $state['bands'],
            'stamp' => $state['stamp'],
            'can_save' => $maySave,
        ]);
    }

    if ($action !== 'save' && $action !== 'reset') {
        avesmapsErrorResponse(400, 'invalid_action', 'Unbekannte Aktion.');
    }

    if (!$maySave) {
        avesmapsErrorResponse(403, 'forbidden', 'Zoombänder einstellen dürfen nur Administratoren.');
    }

    $before = avesmapsZoomBandsRead($pdo)['bands'];

    if ($action === 'reset') {
        avesmapsZoomBandsReset($pdo);
    } else {
        $bands = avesmapsZoomBandsValidate($payload['bands'] ?? null);
        if ($bands === null) {
            avesmapsErrorResponse(400, 'invalid_bands', 'Die Zoombänder haben nicht die erwartete Form.');
        }
        if (!avesmapsZoomBandsWrite($pdo, $bands)) {
            // 🔴 Ein Speichern, das nicht ankommt, meldet das. Ein stiller Verlust ist genau der
            // Ausfall, wegen dessen die Rückleseprobe existiert.
            avesmapsErrorResponse(500, 'zoom_bands_not_stored',
                'Die Zoombänder konnten nicht vollständig gespeichert werden.');
        }
    }

    // ⚠️ `map_revision` wird NICHT gehoben -- es ändert kein Kartenobjekt, und ein Sprung ließe
    // jeden Client die komplette Feature-Nutzlast (21 MB) neu laden. Der Leser hat seinen eigenen
    // Stempel. Dieselbe Begründung wie bei den Tempowerten.

    // Eine Protokollzeile je Vorgang, nie eine je Wert. `feature_id = NULL` -- es hängt an keinem
    // Kartenobjekt.
    if (function_exists('avesmapsWriteMapAuditLog')) {
        $after = avesmapsZoomBandsRead($pdo)['bands'];
        avesmapsWriteMapAuditLog(
            $pdo,
            null,
            'zoom_bands_' . $action,
            (int) ($user['id'] ?? 0),
            json_encode(['bands' => $before], JSON_UNESCAPED_UNICODE),
            json_encode(['bands' => $after], JSON_UNESCAPED_UNICODE)
        );
    }

    $state = avesmapsZoomBandsRead($pdo);
    avesmapsJsonResponse(200, [
        'ok' => true,
        'bands' => $state['bands'],
        'stamp' => $state['stamp'],
        'can_save' => $maySave,
    ]);
} catch (Throwable $error) {
    avesmapsErrorResponse(500, 'server_error', 'Die Zoombänder konnten nicht verarbeitet werden.');
}
```

⚠️ Vor dem Weiterbauen prüfen, dass `avesmapsNormalizeSingleLine` und `avesmapsWriteMapAuditLog`
aus den eingebundenen Dateien kommen:

```bash
git grep -n "function avesmapsNormalizeSingleLine\|function avesmapsWriteMapAuditLog\|function avesmapsRequireUserWithCapability"
```

- [ ] **Schritt 7: Syntaxprüfung für alle drei PHP-Dateien**

```bash
php -l api/_internal/app/zoom-bands.php
php -l api/app/zoom-bands.php
php -l api/edit/map/zoom-bands.php
```

Erwartet: dreimal `No syntax errors detected`.

- [ ] **Schritt 8: Committen**

```bash
git status
git add api/_internal/app/zoom-bands.php api/_internal/app/__tests__/zoom-bands-test.php api/app/zoom-bands.php api/edit/map/zoom-bands.php
git commit -m "feat(zoombaender): Speicher, oeffentlicher Leser und Editor-Endpunkt"
```

---

## Aufgabe 6: Der Boot-Leser im Frontend

**Dateien:**
- Ändern: `js/map-features/location-zoom-bands.js` (Leser anhängen)
- Ändern: `js/config.js` (Aufruf, bei `AvesmapsSession.load()`)
- Ändern: `index.html` (ein `<script>`)

**Schnittstellen:**
- Verbraucht: `avesmapsApplyLocationZoomBands` (Aufgabe 1), `GET api/app/zoom-bands.php` (Aufgabe 5).
- Liefert: `avesmapsLoadLocationZoomBands() => Promise<boolean>`.

- [ ] **Schritt 1: Den Leser anhängen**

Ans Ende von `js/map-features/location-zoom-bands.js`, **vor** den `globalThis`-Block:

```js
const AVESMAPS_ZOOM_BANDS_ENDPOINT = "api/app/zoom-bands.php";

// ⚠️ Wird NICHT beim Laden dieser Datei gerufen. Der Ortseditor lädt sie ebenfalls und holt seine
// Werte über seinen eigenen, angemeldeten Endpunkt -- ein Aufruf hier würde dort eine zweite,
// nutzlose Anfrage auslösen. Der Aufruf steht in js/config.js.
//
// 🔴 Fällt still aus: ohne Antwort bleiben die Vorgabewerte, und die Karte zeichnet wie bisher.
function avesmapsLoadLocationZoomBands() {
	return fetch(AVESMAPS_ZOOM_BANDS_ENDPOINT, { credentials: "same-origin" })
		.then((response) => (response.ok ? response.json() : null))
		.then((payload) => {
			if (!payload || payload.ok !== true) {
				return false;
			}
			return avesmapsApplyLocationZoomBands(payload.bands);
		})
		.catch(() => false);
}
```

- [ ] **Schritt 2: Den Aufruf in `js/config.js` setzen**

Direkt **nach** dem `AvesmapsSession.load()`-Block (heute `js/config.js:377-…`) einfügen:

```js
// Die Zoombänder sofort losschicken, wie die Sitzungsabfrage darüber: wenige hundert Byte,
// ETag-gecacht, und die Antwort ist lange vor der Kartennutzlast da -- Marker werden erst nach
// map-features.php gezeichnet.
// ⚠️ Trifft sie doch später ein UND weicht sie von der Vorgabe ab, wird einmal nachgezogen. Nur
// dann: ein bedingungsloser Durchlauf kostet bei jedem Seitenstart einen vollen Sichtbarkeits-Pass
// umsonst.
if (typeof avesmapsLoadLocationZoomBands === "function") {
	avesmapsLoadLocationZoomBands().then(function (changed) {
		if (!changed) {
			return;
		}
		if (typeof bumpLocationNameLabelStyleRevision === "function") {
			bumpLocationNameLabelStyleRevision();
		}
		if (typeof syncLocationMarkerVisibility === "function") {
			syncLocationMarkerVisibility();
		}
		if (typeof syncLocationNameLabelVisibility === "function") {
			syncLocationNameLabelVisibility();
		}
	});
}
```

💣 `bumpLocationNameLabelStyleRevision()` ist Pflicht: `syncLocationNameLabelVisibility` baut ein
Icon nur neu, wenn sich sein `iconKey` ändert, und der enthält Zoomstufe, Stilrevision und Namen —
**nicht** die Schriftgröße. Ohne den Anstoß blieben die alten Icons stehen und die neue Einstellung
wirkte erst nach dem nächsten Zoomschritt.

- [ ] **Schritt 3: Das `<script>` in `index.html` einhängen**

In `index.html` **zwischen** `js/app/session.js` (Zeile 2990) und `js/config.js` (Zeile 2991)
einfügen:

```html
		<!-- Vor config.js: dort wird avesmapsLoadLocationZoomBands() sofort losgeschickt, wie die
		     Sitzungsabfrage darüber. Und vor map-features-location-marker-rendering.js /
		     -location-name-labels.js, deren Zeichner die Tafel lesen. Keine eigenen
		     Abhängigkeiten, die frühe Position kostet also nichts. -->
		<script src="js/map-features/location-zoom-bands.js"></script>
```

- [ ] **Schritt 4: Die Ladereihenfolge prüfen**

```bash
git grep -n "location-zoom-bands.js\|js/config.js\|map-features-location-marker-rendering.js\|map-features-location-name-labels.js" index.html
```

Erwartet: `location-zoom-bands.js` steht mit der **kleinsten** Zeilennummer der vier.

- [ ] **Schritt 5: Committen**

```bash
git status
git add js/map-features/location-zoom-bands.js js/config.js index.html
git commit -m "feat(zoombaender): die Karte holt die Uebersteuerung beim Start"
```

---

## Aufgabe 7: Das Mockup

⭐ Vor dem Bau, wie bei Tempowerten und WikiSync-Listen — der Owner sieht das Fenster, bevor es
existiert.

**Dateien:**
- Neu: `docs/zoombaender-mockup.html`

- [ ] **Schritt 1: Das Mockup schreiben**

Eine eigenständige HTML-Datei, die `../css/base/tokens.css` einbindet und die Bauteile in ihrem
Ruhezustand zeigt — **kein** JS-Verhalten nötig, nur das Bild:

1. **Die Kachel** im Menüband, zwischen den vorhandenen sieben, weich/outline, zwei Zeilen:
   `Zoombänder` / `Zoomlevelanzeige aller Orte`.
2. **Die Bandgrafik**: acht Spalten mit den Köpfen `z0 … z7`, sechs Zeilen (die Klassen in der
   Reihenfolge Metropole → Bauwerk). Je Zeile ein Balken, der an der Erscheinungsstufe des Markers
   beginnt; ab der Erscheinungsstufe des Namens ein hellerer Abschnitt. In jeder Zelle des Balkens
   ein Kreis im **echten** Durchmesser aus der Vorgabetafel und das Musterwort „Gareth" im
   **echten** Schriftgrad (Angabe in pt, also `font-size: 19pt` usw.).
3. **Die zwei Tabellen** darunter, je Klasse eine Zeile, je Zoomstufe ein Zahlenfeld; leere Zellen
   als graues `—` mit `title="erscheint hier noch nicht"`.
4. **Der Hinweis an der Dorf-Zeile:** ⚠️ *„Dörfer tragen ihren Namen ab z4; die Straßenschrift hängt
   seit dem 16.08.2026 nicht mehr daran."*
5. **Die Speicherleiste:** links die Meldung, rechts ein gefüllter Knopf „Speichern"; daneben ein
   weicher „Alles zurücksetzen". Je Klassenzeile ein weicher Rücksetzer.
6. **Die Nur-Lesen-Fassung** derselben Leiste als zweiter Block: statt des Knopfes der Satz
   *„Zoombänder einstellen dürfen nur Administratoren."*

Zwingend: nur Tokens aus `css/base/tokens.css` (keine Literalfarben), keine Schrift unter 11px,
Zeilenrücksetzer weich/outline (AGENTS.md §12).

- [ ] **Schritt 2: Im Browser ansehen**

```bash
git status
git add docs/zoombaender-mockup.html
git commit -m "docs(zoombaender): Mockup des Fensters"
```

Danach **anhalten** und dem Owner das Mockup zeigen (`docs/zoombaender-mockup.html`). Erst nach
seiner Rückmeldung mit Aufgabe 8 weitermachen.

---

## Aufgabe 8: Das Fenster im Ortseditor

**Dateien:**
- Ändern: `html/wiki-sync-settlement-editor.html` — `<style>`-Block, `.controls` (Zeile 275–287),
  neues Overlay nach `#seAssignDialog` (Zeile 350), Inline-Skript ab Zeile 367
- Neu: `js/pages/__tests__/zoombaender-dialog.test.js`

**Schnittstellen:**
- Verbraucht: `avesmapsResolveLocationZoomBands`, `AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS`,
  `AVESMAPS_ZOOM_BAND_LIMITS` (Aufgabe 1, per `<script src="/js/map-features/location-zoom-bands.js">`);
  `POST /api/edit/map/zoom-bands.php` (Aufgabe 5).
- Liefert: nichts für spätere Aufgaben.

- [ ] **Schritt 1: Den Vertragstest schreiben**

Neue Datei `js/pages/__tests__/zoombaender-dialog.test.js`:

```js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Das Fenster „Zoombänder" und sein Endpunkt sprechen dieselben Namen.
//
// 💣 WARUM DAS EINEN TEST BRAUCHT. Zwischen dem Fenster und api/edit/map/zoom-bands.php liegt eine
// JSON-Nutzlast, und die hat keine Signatur. Schickt das Fenster `zoom_bands` und liest der Server
// `bands`, passiert genau NICHTS Sichtbares: der Server lehnt ab oder speichert Leeres, und der
// Fehler fällt erst im Browser des Owners auf. Derselbe Grund wie bei tempowerte-dialog.test.js.
//
// ⭐ Der Test liest beide Seiten als TEXT. Das Fenster ist DOM-Code in einer HTML-Datei und lässt
// sich nicht einzeln laden; die Namen stehen aber wörtlich da, und genau sie sind der Vertrag.
//
// Aus der Wurzel des Repos:  node js/pages/__tests__/zoombaender-dialog.test.js

const repoRoot = path.join(__dirname, "..", "..", "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const seite = read("html/wiki-sync-settlement-editor.html");
const endpunkt = read("api/edit/map/zoom-bands.php");
const bibliothek = read("api/_internal/app/zoom-bands.php");

// ---- 1. Die Kachel --------------------------------------------------------------------------
assert.ok(/id="seZoomBands"/.test(seite), "die Kachel trägt die Kennung seZoomBands");
assert.ok(/Zoombänder/.test(seite), "die Kachel heißt „Zoombänder\"");
assert.ok(/Zoomlevelanzeige aller Orte/.test(seite), "und trägt ihre zweite Zeile");
// 🔴 Weich/outline: eine Nebenhandlung ist nie die Haupthandlung des Menübands (AGENTS.md §12).
// Die Haupthandlung hier heißt „Syncen".
// ⚠️ Den GANZEN Knopf-Tag greifen, nicht „id=… gefolgt von class=" -- im Markup steht class VOR id,
// und ein Muster in der falschen Reihenfolge findet nie etwas und ist damit immer grün.
const kachelTag = seite.match(/<button[^>]*id="seZoomBands"[^>]*>/);
assert.ok(kachelTag, "der Knopf-Tag der Kachel wurde gefunden");
assert.ok(!/\bprimary\b/.test(kachelTag[0]),
	"die Kachel ist nicht gefüllt -- die Haupthandlung dieses Menübands heißt „Syncen\": " + kachelTag[0]);

// ---- 2. Die Aktionen ------------------------------------------------------------------------
const erlaubteAktionen = [...endpunkt.matchAll(/\$action (?:===|!==) '([a-z_]+)'/g)].map((m) => m[1]);
["get", "save", "reset"].forEach((aktion) => {
	assert.ok(erlaubteAktionen.includes(aktion), `der Endpunkt kennt „${aktion}"`);
});
["get", "save", "reset"].forEach((aktion) => {
	assert.ok(new RegExp(`action:\\s*"${aktion}"`).test(seite), `das Fenster ruft „${aktion}"`);
});

// ---- 3. Die Nutzlast heißt „bands" -----------------------------------------------------------
assert.ok(/\$payload\['bands'\]/.test(endpunkt), "der Endpunkt liest payload['bands']");
assert.ok(/bands:/.test(seite), "das Fenster schickt bands");
assert.ok(/AVESMAPS_ZOOM_BANDS_ENDPOINT|\/api\/edit\/map\/zoom-bands\.php/.test(seite),
	"das Fenster ruft den richtigen Endpunkt");

// ---- 4. Der Admin-Riegel steht auf BEIDEN Seiten ---------------------------------------------
assert.ok(/can_save/.test(endpunkt) && /can_save/.test(seite),
	"beide Seiten kennen can_save");
// 🔴 Der Riegel im Server ist der tragende. Ein ausgegrauter Knopf ist eine Höflichkeit.
assert.ok(/avesmapsUserCan\(\$user, 'admin'\)/.test(endpunkt),
	"der Endpunkt prüft die Admin-Fähigkeit selbst");
assert.ok(/'forbidden'/.test(endpunkt), "und weist ohne sie ab");

// ---- 5. Die Schranken stehen einmal ----------------------------------------------------------
// Server und Browser prüfen dieselben Zahlen; laufen sie auseinander, lehnt der eine ab, was der
// andere anzeigt.
assert.ok(/0\.5.*200/s.test(bibliothek), "der Server kennt die Markerschranken 0,5 bis 200");
assert.ok(/4\.0.*96/s.test(bibliothek), "und die Schriftschranken 4 bis 96");
const browser = read("js/map-features/location-zoom-bands.js");
assert.ok(/marker:\s*\{\s*min:\s*0\.5,\s*max:\s*200\s*\}/.test(browser), "der Browser ebenso");
assert.ok(/label:\s*\{\s*min:\s*4,\s*max:\s*96\s*\}/.test(browser));

// ---- 6. Das Fenster lädt die Vorgabetafel, statt sie abzuschreiben ----------------------------
// 🔴 Die Vorgabewerte stehen an EINER Stelle. Eine zweite Tafel im Fenster wäre genau die
// Divergenz, die dieser Umbau abbaut.
assert.ok(/src="\/js\/map-features\/location-zoom-bands\.js"/.test(seite),
	"die Seite lädt die Vorgabedatei");
assert.ok(!/6\.65,\s*9\.4,\s*13\.3/.test(seite),
	"und schreibt die Zahlen NICHT ab");

console.log("zoombaender-dialog: alle Zusicherungen erfüllt");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag prüfen**

```bash
node js/pages/__tests__/zoombaender-dialog.test.js
```

Erwartet: `AssertionError: die Kachel trägt die Kennung seZoomBands`.

- [ ] **Schritt 3: Die Vorgabedatei in die Seite einhängen**

In `html/wiki-sync-settlement-editor.html` bei den übrigen `<script src="/js/…">`-Zeilen
(nach `dialog-drag.js`, Zeile 366) einfügen:

```html
<!-- Die Vorgabetafel der Zoombänder -- dieselbe Datei lädt auch die Karte. 🔴 Das Fenster schreibt
     die Zahlen NICHT ab: sie stehen an genau einer Stelle. Absoluter Pfad wie die Geschwister
     oben, weil dieses Dokument mit ?v=Date.now() geholt wird und nicht durch den Stempler von
     index.html läuft. -->
<script src="/js/map-features/location-zoom-bands.js"></script>
```

- [ ] **Schritt 4: Die achte Kachel setzen**

In `.controls` (nach `#seLinkCheck`, Zeile 286) einfügen:

```html
    <button class="btn2" id="seZoomBands" title="Stellt ein, ab welcher Zoomstufe eine Ortsklasse auf der Karte erscheint, wie groß ihr Punkt dort ist und ab wann sie ihren Namen trägt. Einstellen dürfen nur Administratoren; ansehen darf es jeder Editor."><span class="t1">Zoombänder</span><span class="t2">Zoomlevelanzeige aller Orte</span></button>
```

⚠️ Danach im Browser prüfen, ob die acht Kacheln noch lesbar sind — `.controls` ist ein Raster mit
`grid-auto-columns:minmax(0,1fr)`, die Beschriftungen kürzen also mit Ellipse. Wird
„Zoomlevelanzeige aller Orte" auf üblicher Breite abgeschnitten, dem Owner melden statt eigenmächtig
zu kürzen.

- [ ] **Schritt 5: Das Fenster bauen**

Nach `#seAssignDialog` (Zeile 350) ein Overlay `#seZoomBandsDialog` mit der Bauform aus dem
Mockup einsetzen: `.modal` > `.modal-box.wide` (breiter, eigene Klasse `.modal-box--zoombands`
mit `width: 980px; max-width: 96vw`), darin `.modal-title` „Zoombänder", `.modal-sub` mit einem
Satz, was hier eingestellt wird, dann Bandgrafik, dann die zwei Tabellen, dann `.modal-error` und
`.modal-actions`.

Das zugehörige Skript im Inline-Block, mit diesen Bausteinen:

```js
const ZOOM_BANDS_API = "/api/edit/map/zoom-bands.php";
const ZOOM_BAND_KLASSEN = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"];
const ZOOM_BAND_KLASSEN_LABEL = {
	metropole: "Metropole", grossstadt: "Großstadt", stadt: "Stadt",
	kleinstadt: "Kleinstadt", dorf: "Dorf", gebaeude: "Bauwerk/Stätte",
};
let zoomBandsEntwurf = null;   // die Tafel, an der gerade gedreht wird
let zoomBandsDarfSpeichern = false;

async function zoomBandsPost(body) {
	const response = await fetch(ZOOM_BANDS_API, {
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

async function openZoomBandsDialog() {
	$("seZoomBandsDialog").hidden = false;
	const payload = await zoomBandsPost({ action: "get" });
	zoomBandsDarfSpeichern = payload.can_save === true;
	// 🔴 Angezeigt wird IMMER die zusammengeführte Tafel -- Vorgabe plus Übersteuerung, genau das,
	// was die Karte zeichnet. Die rohe Übersteuerung zu zeigen hieße, dem Admin leere Felder für
	// Werte vorzulegen, die auf der Karte sichtbar sind.
	zoomBandsEntwurf = avesmapsResolveLocationZoomBands(payload.bands);
	renderZoomBands();
}

// 🔴 Beim Speichern reist die GANZE Tafel, nicht nur das Geänderte: der Server führt keine
// Klassenliste und könnte ein Teilstück gar nicht mit dem Bestand verschmelzen.
async function saveZoomBands() {
	const fehler = $("seZoomBandsError");
	fehler.hidden = true;
	try {
		const payload = await zoomBandsPost({ action: "save", bands: zoomBandsEntwurf });
		zoomBandsEntwurf = avesmapsResolveLocationZoomBands(payload.bands);
		renderZoomBands();
		$("seZoomBandsMsg").textContent = "Gespeichert. Die Karte zeigt es nach dem nächsten Laden.";
	} catch (error) {
		fehler.textContent = error && error.message ? error.message : String(error);
		fehler.hidden = false;
	}
}

async function resetZoomBands() {
	const fehler = $("seZoomBandsError");
	fehler.hidden = true;
	try {
		const payload = await zoomBandsPost({ action: "reset" });
		// Der Server gibt nach dem Zurücksetzen `bands: null` -- daraus wird die reine Vorgabe.
		zoomBandsEntwurf = avesmapsResolveLocationZoomBands(payload.bands);
		renderZoomBands();
		$("seZoomBandsMsg").textContent = "Auf die Vorgabewerte zurückgesetzt.";
	} catch (error) {
		fehler.textContent = error && error.message ? error.message : String(error);
		fehler.hidden = false;
	}
}

// Eine Klassenzeile auf die Vorgabe zurückholen. ⚠️ NUR im Entwurf -- gespeichert wird erst mit
// dem Knopf, wie bei jeder anderen Änderung im Fenster auch.
function resetZoomBandRow(kind, locationType) {
	zoomBandsEntwurf[kind][locationType] = AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS[kind][locationType].slice();
	renderZoomBands();
	$("seZoomBandsMsg").textContent = "Zeile zurückgesetzt — noch nicht gespeichert.";
}

// 💣 EINE ZELLE LEEREN HEISST „AUSBLENDEN", UND DAS GEHT NUR VOR DER ERSTEN GEFÜLLTEN ZELLE.
// Ein Loch mittendrin ließe einen Ort bei z3 sichtbar, bei z4 verschwinden und bei z5 wiederkommen
// (Entwurf §3.1). Der Leser im Browser füllt zwar vorwärts, aber was der Admin eingibt, soll auch
// das sein, was er sieht -- also lehnt das Feld es hier ab, statt es still zu überschreiben.
function setZoomBandCell(kind, locationType, z, rawValue) {
	const zeile = zoomBandsEntwurf[kind][locationType];
	const text = String(rawValue).trim().replace(",", ".");
	if (text === "") {
		const spaeterGefuellt = zeile.slice(z + 1).some((wert) => wert !== null);
		if (spaeterGefuellt) {
			$("seZoomBandsMsg").textContent =
				"Leeren geht nur von links: eine Klasse, die einmal da ist, bleibt bis z7.";
			renderZoomBands();
			return;
		}
		zeile[z] = null;
	} else {
		const wert = Number(text);
		const grenzen = AVESMAPS_ZOOM_BAND_LIMITS[kind];
		if (!Number.isFinite(wert) || wert < grenzen.min || wert > grenzen.max) {
			$("seZoomBandsMsg").textContent =
				`Erlaubt sind ${grenzen.min} bis ${grenzen.max}.`;
			renderZoomBands();
			return;
		}
		// Eine gefüllte Zelle füllt alle leeren rechts von ihr mit -- sonst entsteht genau das Loch.
		zeile[z] = wert;
		for (let i = z + 1; i <= AVESMAPS_ZOOM_BAND_MAX_ZOOM; i += 1) {
			if (zeile[i] === null) {
				zeile[i] = wert;
			}
		}
	}
	renderZoomBands();
	$("seZoomBandsMsg").textContent = "Geändert — noch nicht gespeichert.";
}

// Die Bandgrafik: acht Spalten, je Klasse ein Balken. Er beginnt, wo der Marker erscheint, und
// wechselt in einen helleren Abschnitt, wo der Name dazukommt. Im Balken der ECHTE Punkt und das
// Musterwort im ECHTEN Schriftgrad -- man soll sehen, was man einstellt, nicht Zahlen lesen.
function zoomBandGraphHtml() {
	const kopf = ["<div class=\"zb-graph__row zb-graph__row--head\"><span class=\"zb-graph__name\"></span>"];
	for (let z = 0; z <= AVESMAPS_ZOOM_BAND_MAX_ZOOM; z += 1) {
		kopf.push(`<span class="zb-graph__cell">z${z}</span>`);
	}
	kopf.push("</div>");

	const zeilen = ZOOM_BAND_KLASSEN.map((locationType) => {
		const markerZeile = zoomBandsEntwurf.marker[locationType];
		const labelZeile = zoomBandsEntwurf.label[locationType];
		const zellen = [];
		for (let z = 0; z <= AVESMAPS_ZOOM_BAND_MAX_ZOOM; z += 1) {
			const punkt = markerZeile[z];
			const schrift = labelZeile[z];
			if (punkt === null) {
				zellen.push('<span class="zb-graph__cell zb-graph__cell--leer"></span>');
				continue;
			}
			const klasse = schrift === null ? "zb-graph__cell--marker" : "zb-graph__cell--name";
			// Der Punkt wird gedeckelt gezeichnet: 53 px passen nicht in eine Rasterzelle.
			const gezeichnet = Math.min(punkt, 22);
			const wort = schrift === null
				? ""
				: `<span class="zb-graph__wort" style="font-size:${schrift}pt">Gareth</span>`;
			zellen.push(
				`<span class="zb-graph__cell ${klasse}" title="Punkt ${punkt} px${schrift === null ? "" : `, Name ${schrift} pt`}">` +
				`<span class="zb-graph__punkt" style="width:${gezeichnet}px;height:${gezeichnet}px"></span>${wort}</span>`
			);
		}
		return `<div class="zb-graph__row"><span class="zb-graph__name">${ZOOM_BAND_KLASSEN_LABEL[locationType]}</span>${zellen.join("")}</div>`;
	});

	return `<div class="zb-graph">${kopf.join("")}${zeilen.join("")}</div>`;
}

// Eine der beiden Zahlentabellen.
function zoomBandTableHtml(kind, ueberschrift, einheit) {
	const kopf = ['<tr><th class="zb-tab__name">Ortsklasse</th>'];
	for (let z = 0; z <= AVESMAPS_ZOOM_BAND_MAX_ZOOM; z += 1) {
		kopf.push(`<th>z${z}</th>`);
	}
	kopf.push("<th></th></tr>");

	const grenzen = AVESMAPS_ZOOM_BAND_LIMITS[kind];
	const gesperrt = zoomBandsDarfSpeichern ? "" : " disabled";
	const zeilen = ZOOM_BAND_KLASSEN.map((locationType) => {
		const zeile = zoomBandsEntwurf[kind][locationType];
		const felder = zeile.map((wert, z) =>
			`<td><input type="number" step="0.01" min="${grenzen.min}" max="${grenzen.max}"` +
			` value="${wert === null ? "" : wert}" data-kind="${kind}" data-type="${locationType}"` +
			` data-z="${z}" class="zb-tab__feld"${gesperrt}></td>`
		).join("");
		// ⚠️ Der Hinweis hängt an der Dorf-Zeile der Schrifttabelle, nicht in der Doku: genau hier
		// würde jemand vermuten, dass er die Straßenbeschriftung mitverstellt. Tut er seit dem
		// 16.08.2026 nicht mehr (Entwurf §6).
		const hinweis = (kind === "label" && locationType === "dorf")
			? ' <span class="zb-tab__hinweis" title="Die Straßen- und Flussnamen hatten bis zum 16.08.2026 ihre Grundgröße von dieser Zeile. Sie haben jetzt ihre eigene.">⚠️</span>'
			: "";
		return `<tr><td class="zb-tab__name">${ZOOM_BAND_KLASSEN_LABEL[locationType]}${hinweis}</td>${felder}` +
			`<td><button type="button" class="zb-tab__reset" data-kind="${kind}" data-type="${locationType}"${gesperrt}>Zurücksetzen</button></td></tr>`;
	});

	return `<h3 class="zb-tab__titel">${ueberschrift} <span class="zb-tab__einheit">(${einheit})</span></h3>` +
		`<table class="zb-tab">${kopf.join("")}${zeilen.join("")}</table>`;
}

function renderZoomBands() {
	$("seZoomBandsBody").innerHTML =
		zoomBandGraphHtml() +
		zoomBandTableHtml("marker", "Marker", "Außendurchmesser in px") +
		zoomBandTableHtml("label", "Name", "Schriftgröße in pt");

	// ⚠️ Zuhörer nach JEDEM Zeichnen neu setzen -- innerHTML hat die alten Knoten weggeworfen.
	$("seZoomBandsBody").querySelectorAll(".zb-tab__feld").forEach((feld) => {
		feld.addEventListener("change", () => {
			setZoomBandCell(feld.dataset.kind, feld.dataset.type, Number(feld.dataset.z), feld.value);
		});
	});
	$("seZoomBandsBody").querySelectorAll(".zb-tab__reset").forEach((knopf) => {
		knopf.addEventListener("click", () => resetZoomBandRow(knopf.dataset.kind, knopf.dataset.type));
	});

	// Die Speicherleiste. 🔴 Für Editoren ohne admin steht hier ein Satz, kein grauer Knopf --
	// ein Knopf, den man nie drücken darf, ist ein Versprechen, das die Seite bricht.
	$("seZoomBandsActions").innerHTML = zoomBandsDarfSpeichern
		? '<button type="button" class="primary" id="seZoomBandsSave">Speichern</button>' +
		  '<button type="button" id="seZoomBandsResetAll">Alles zurücksetzen</button>'
		: '<span class="zb-nurlesen">Zoombänder einstellen dürfen nur Administratoren.</span>';
	if (zoomBandsDarfSpeichern) {
		$("seZoomBandsSave").addEventListener("click", saveZoomBands);
		$("seZoomBandsResetAll").addEventListener("click", resetZoomBands);
	}
}
```

Dazu im `<style>`-Block der Seite die Klassen `.zb-graph*`, `.zb-tab*`, `.zb-nurlesen` und
`.modal-box--zoombands` (`width:980px; max-width:96vw`) nach dem Mockup aus Aufgabe 7 — **nur mit
Tokens**, keine Literalfarben, nichts unter 11px.

Und die Kachel verdrahten, bei den übrigen `addEventListener`-Zeilen des Inline-Skripts:

```js
$("seZoomBands").addEventListener("click", () => { openZoomBandsDialog().catch((error) => {
	$("seZoomBandsError").textContent = error && error.message ? error.message : String(error);
	$("seZoomBandsError").hidden = false;
}); });
```

💣 Jede Änderung an einem Feld schreibt in `zoomBandsEntwurf` und ruft `renderZoomBands()` — die
Grafik zieht **sofort** nach. **Gespeichert ist erst, was der Knopf speichert.**

- [ ] **Schritt 6: Test laufen lassen**

```bash
node js/pages/__tests__/zoombaender-dialog.test.js
```

Erwartet: `zoombaender-dialog: alle Zusicherungen erfüllt`.

- [ ] **Schritt 7: Committen**

```bash
git status
git add html/wiki-sync-settlement-editor.html js/pages/__tests__/zoombaender-dialog.test.js
git commit -m "feat(zoombaender): Kachel und Fenster im Ortseditor"
```

---

## Aufgabe 9: Abnahme — das ganze Testfeld und die sechs Handgriffe

🔴 **Das Tor.** Erst danach wird gepusht.

- [ ] **Schritt 1: Das JS-Testfeld — VOLLSTÄNDIG, nicht nur die eigenen**

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t"; done
```

Erwartet: kein Fehlschlag. 💣 Bricht ein Test, der nichts mit dieser Arbeit zu tun hat, ist er
trotzdem ein Halt: der Deploy ist ein Tor, ein einziger roter Test lädt **nichts** hoch (AGENTS.md
§9). Die häufigste Ursache hier sind die zwei Testdateien aus Aufgabe 4, Schritt 8.

- [ ] **Schritt 2: Das PHP-Testfeld — mit den Erweiterungen**

```bash
for t in $(find api tools -path '*__tests__*' -name '*-test.php'); do php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "$t"; done
```

⚠️ Ohne `mbstring`/`pdo_sqlite`/`gd` melden **45 Tests** rot, die alle nur die Erweiterung vermissen
und es in ihrer eigenen Fehlermeldung auch sagen. Vorbestehend rot bleibt genau einer:
`linkcheck/link-url-test.php` (echter DNS-Abruf) — kein Regressionssignal.

- [ ] **Schritt 3: Der Teil des Feldes, den das Muster oben NICHT findet**

```bash
for t in tools/wikidump/test-*.php; do php -d extension=php_mbstring.dll "$t" >/dev/null || echo "ROT: $t"; done
```

💣 Unter `tools/wikidump/` liegen 21 PHP-Tests, die weder in einem `__tests__`-Verzeichnis stehen
noch auf `-test.php` enden. Genau diese Lücke kostete am 15.08.2026 zwei Deploys.

- [ ] **Schritt 4: Die sechs Handgriffe — Ablauf, nicht Maß**

Am laufenden Editor durchführen und **einzeln benennen**, was passiert ist:

1. Im Ortseditor die Kachel „Zoombänder" anklicken — das Fenster öffnet sich und zeigt die Bänder.
2. Eine Zahl ändern (z. B. Dorf-Marker bei z2 leeren) — die Bandgrafik zieht **sofort** nach.
3. „Speichern" — die Meldung bestätigt.
4. Die Karte neu laden — **das Dorf erscheint jetzt erst an der neuen Stufe.**
5. „Alles zurücksetzen" — die Meldung bestätigt.
6. Die Karte neu laden — das alte Bild ist zurück.

💣 Eine Prüfseite, die Rechtecke misst, ist **kein** Beleg. Was ein Emulator nicht beantworten kann,
wird als offene Frage gemeldet, nicht als bestanden (AGENTS.md §9).

- [ ] **Schritt 5: Den eigenen Entwurf abhaken**

Jede Zeile mit 💣 / ⚠️ / 🔴 in `docs/superpowers/specs/2026-08-16-zoombaender-design.md` und in
diesem Bauplan einzeln durchgehen: erfüllt, oder ausdrücklich verworfen mit Begründung. Das ist die
Abnahmeliste, nicht die Testausgabe.

- [ ] **Schritt 6: Push**

```bash
git status
git fetch origin
git log --oneline origin/master..HEAD
git push origin master
git ls-remote origin master
```

⚠️ Vor dem Push prüfen, dass in `git log origin/master..HEAD` **nur** die Commits dieses Bauplans
stehen. Der Arbeitsbaum ist geteilt; ein Push nimmt fremde ungepushte Commits mit.

⚠️ Nach dem Push die Remote-SHA vergleichen und **1–2 Minuten** auf den Auto-Deploy warten. PHP
liegt durch STRATOs OPcache 2–4 Minuten zurück.

- [ ] **Schritt 7: Live prüfen**

Nach dem Deploy einmal — **eine** Anfrage, nicht in der Schleife:

```bash
curl -s "https://avesmaps.de/api/app/zoom-bands.php" | head -c 400
```

Erwartet: `{"ok":true,"bands":null,"stamp":""}` (oder die gespeicherte Tafel). 💣 Kommt hier ein
leeres Ergebnis mit `ok:true`, wo eine Tafel stehen müsste, ist das von „hier ist nichts
eingestellt" **nicht** zu unterscheiden — dann in der Datenbank nachsehen, nicht raten. Dieselbe
Falle wie bei „Was ist hier?" am 15.08.2026.
