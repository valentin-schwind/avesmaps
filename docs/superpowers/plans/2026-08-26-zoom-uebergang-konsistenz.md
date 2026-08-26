# Der Zoomschritt aus einem Guss — Bauplan

> **Für agentische Arbeiter:** Verwende `superpowers:subagent-driven-development` oder
> `superpowers:executing-plans`. Schritte tragen `- [ ]` zum Abhaken.

**Ziel:** Beim Zoomen laufen alle Kartenelemente auf EINER Kurve mit EINER Dauer, alles beginnt bei
`zoomanim` t = 0, und die Ortsmarker landen ohne Sprung — ohne dass sich das ruhende Kartenbild an
irgendeiner Zoomstufe ändert.

**Architektur:** Eine neue, reine Datei `js/map-features/zoom-uebergang.js` ist die einzige Quelle
für Kurve, Dauer und die Gegenrechnung. Acht Zeichenflächen lesen sie statt eigener Zeichenketten.
Die Marker bekommen während der Animation eine je Ortsklasse gerechnete Größenkorrektur (das ruhende
Bild bleibt Ziffer für Ziffer); die drei Schrift-Ebenen bekommen ihre Blende in den `zoomanim`
vorgezogen, wodurch deren Amplituden-Sprung gar nicht erst sichtbar wird.

**Tech-Stack:** Vanilla JS ohne Bauschritt, Leaflet 1.9.4, Canvas-2D, CSS-Tokens.

**Entwurf:** `docs/superpowers/specs/2026-08-26-zoom-uebergang-konsistenz-design.md`
(Vorwissen: `docs/kartenflaechen-und-zoomblenden.md`)

## Globale Regeln

- 💣 **Die Dauer ist 250 ms und ist NICHT frei wählbar.** Leaflet zählt sie selbst:
  `setTimeout(a(this._onZoomTransitionEnd,this),250)` in `js/third-party/leaflet.js` (minifiziert).
  Eine andere Zahl im CSS liefe an Leaflets eigenem Ende vorbei. Nur die KURVE wird getauscht.
- 🔴 **Die Kurve ist `cubic-bezier(0.42, 0, 0.58, 1)`** (= CSS `ease-in-out`), Owner-Vorgabe vom
  26.08.2026 — eine bewusste Abkehr von Leaflets `cubic-bezier(0,0,0.25,1)` (reines ease-out),
  **einschließlich der Kacheln**.
- 🔴 **Owner-Entscheid 26.08.2026 zu §3.1:** die Zoombänder werden NICHT angefasst. Der Sprung wird
  während der Animation gegengerechnet. Das ruhende Bild bleibt an jeder Stufe wie heute.
- 🔴 **Owner-Entscheid 26.08.2026 zu z7:** z7 erbt weiter z6. Mit der Gegenrechnung wachsen die
  Marker dort einfach nicht mehr, und der −50-%-Sprung verschwindet von selbst.
- 💣 **`transition` ist EINE Eigenschaft** (AGENTS.md, `kartenflaechen-und-zoomblenden.md` §6). Eine
  inline gesetzte Transform-Transition gehört AUSSCHLIESSLICH in den `zoomanim`-Handler; die
  `moveend`/`_reset`-Handler löschen sie. Zweimal bezahlt (`e85b31d1`, `ed1e2e93`).
- 💣 **Nie ein `?v=` von Hand** (AGENTS.md §7). Neue Dateien kommen ohne Stempel in `index.html` bzw.
  in die `@import`-Kette von `css/styles.css`; der Deploy stempelt.
- 💣 **Vor JEDEM Push das GANZE Testfeld**, beide JS- und beide PHP-Muster des Workflows, parallel,
  Dateizahl gegen `.github/workflows/deploy-avesmaps-strato.yml` gegenprüfen (AGENTS.md §9).
- 💣 **Sichtbare Änderungen gehen EINZELN live** (AGENTS.md §9). Jede Aufgabe = ein Commit = ein Push
  = ein Blick des Owners. Den Lauf abwarten, bevor der nächste Push kommt — ein zweiter Push bricht
  den ersten ab, und dessen Dateien lädt danach nie jemand hoch.
- ⚠️ **Nur eigene Pfade stagen.** Der Arbeitsbaum ist geteilt; `git add -A` ist verboten.
- Kommentare, Commit-Texte und Doku auf **Deutsch** (AGENTS.md §8).

---

### Aufgabe 1: Eine Kurve, eine Zahl — das Fundament

**Sichtbar für den Owner:** Jede Zoombewegung — Kacheln, Grenzen, Wege, Marker, Beschriftungen —
läuft ab jetzt auf `ease-in-out` statt `ease-out`. Sie startet weicher und bremst weicher aus.
Sonst ändert sich nichts.

**Dateien:**
- Anlegen: `js/map-features/zoom-uebergang.js`
- Anlegen: `css/features/zoom-uebergang.css`
- Anlegen: `js/map-features/__tests__/zoom-uebergang.test.js`
- Ändern: `css/styles.css` (`@import` für die neue Datei)
- Ändern: `index.html` (Skript-Tag nach `location-zoom-bands.js`, Zeile 3280)
- Ändern: `css/features/map-labels.css:240`
- Ändern: `js/map-features/map-features-boundary-canvas-overlay.js:452`
- Ändern: `js/map-features/map-features-path-label-canvas-overlay.js:100`
- Ändern: `js/map-features/map-features-location-canvas-layer.js:245`
- Ändern: `js/map-features/map-features-contested-hatch-overlay.js:237`
- Ändern: `js/map-features/map-features-river-flow-arrows.js:170`
- Ändern: `js/routing/route-speed-arrows.js:356`

**Schnittstellen:**
- Liefert: `AVESMAPS_ZOOM_DAUER_MS` (250), `AVESMAPS_ZOOM_KURVE` (String),
  `AVESMAPS_ZOOM_KURVE_PUNKTE` (Array), `avesmapsZoomTransition(eigenschaft)` → String,
  `avesmapsZoomEasing(t)` → 0..1. Aufgabe 2 verbraucht `avesmapsZoomEasing` und
  `AVESMAPS_ZOOM_DAUER_MS`; Aufgaben 3–5 verbrauchen `avesmapsZoomTransition`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`js/map-features/__tests__/zoom-uebergang.test.js`:

```js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Aus der Wurzel des Repos:  node js/map-features/__tests__/zoom-uebergang.test.js
vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "../zoom-uebergang.js"), "utf8"),
	{ filename: "zoom-uebergang.js" }
);

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (p) => fs.readFileSync(path.join(WURZEL, p), "utf8");
// 💣 Kommentare ZUERST strippen: sonst schlaegt der Test an der Warnung an, die vor dem Muster
// warnt -- und der naechste Leser loescht den Kommentar, um den Test gruen zu bekommen.
const ohneKommentare = (text) => text
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// ---- Die Kurve ist EINE Kurve -----------------------------------------------------------------
assert.strictEqual(AVESMAPS_ZOOM_DAUER_MS, 250,
	"💣 250 ist Leaflets eigene Zahl (setTimeout(_onZoomTransitionEnd, 250) in leaflet.js) -- eine "
	+ "andere Dauer laeuft an Leaflets Ende vorbei.");
assert.strictEqual(AVESMAPS_ZOOM_KURVE, "cubic-bezier(0.42, 0, 0.58, 1)");
assert.deepStrictEqual(AVESMAPS_ZOOM_KURVE_PUNKTE, [0.42, 0, 0.58, 1],
	"Die Punkte und der String muessen dieselbe Kurve beschreiben.");
assert.strictEqual(avesmapsZoomTransition("transform"),
	"transform 250ms cubic-bezier(0.42, 0, 0.58, 1)");

// ---- Keine alte Kurve bleibt stehen -----------------------------------------------------------
const WIRTE = [
	"js/map-features/map-features-boundary-canvas-overlay.js",
	"js/map-features/map-features-path-label-canvas-overlay.js",
	"js/map-features/map-features-location-canvas-layer.js",
	"js/map-features/map-features-contested-hatch-overlay.js",
	"js/map-features/map-features-river-flow-arrows.js",
	"js/routing/route-speed-arrows.js",
];
for (const w of WIRTE) {
	const quelle = ohneKommentare(lies(w));
	assert.ok(!/cubic-bezier\(\s*0\s*,\s*0\s*,\s*0\.25\s*,\s*1\s*\)/.test(quelle),
		w + ": traegt noch Leaflets alte Kurve als Zeichenkette.");
	assert.ok(/avesmapsZoomTransition\s*\(/.test(quelle),
		w + ": liest die Kurve nicht aus zoom-uebergang.js.");
}

// ---- Auch das CSS liest sie, und leaflet.css wird ueberschrieben -------------------------------
const token = lies("css/features/zoom-uebergang.css");
assert.ok(/--avesmaps-zoom-dauer:\s*250ms/.test(token));
assert.ok(/--avesmaps-zoom-kurve:\s*cubic-bezier\(0\.42,\s*0,\s*0\.58,\s*1\)/.test(token));
assert.ok(/\.leaflet-zoom-anim\s+\.leaflet-zoom-animated/.test(token),
	"💣 Leaflets eigene Regel muss ueberschrieben werden -- sonst laufen die KACHELN weiter auf der "
	+ "alten Kurve, und der Guss ist an der auffaelligsten Flaeche gebrochen.");
assert.ok(/@import\s+url\("features\/zoom-uebergang\.css"\)/.test(lies("css/styles.css")),
	"Ohne @import erreicht die Datei den Stempler und den Browser nie.");
assert.ok(!/cubic-bezier\(\s*0\s*,\s*0\s*,\s*0\.25\s*,\s*1\s*\)/.test(ohneKommentare(lies("css/features/map-labels.css"))),
	"map-labels.css traegt noch die alte Kurve.");

// ---- Die Easing-Rechnung stimmt mit der Kurve ueberein ----------------------------------------
assert.strictEqual(avesmapsZoomEasing(0), 0);
assert.strictEqual(avesmapsZoomEasing(1), 1);
assert.ok(Math.abs(avesmapsZoomEasing(0.5) - 0.5) < 1e-6,
	"ease-in-out ist punktsymmetrisch: bei der Haelfte der Zeit die Haelfte des Weges.");
// Symmetrie ueber die ganze Kurve -- der Test, der ein vertauschtes Kontrollpunktpaar faengt.
for (const t of [0.1, 0.25, 0.4, 0.75, 0.9]) {
	assert.ok(Math.abs(avesmapsZoomEasing(t) + avesmapsZoomEasing(1 - t) - 1) < 1e-5,
		"Symmetrie verletzt bei t=" + t);
}
// Monoton steigend -- faengt einen Newton-Lauf, der aus [0,1] hinauslaeuft.
let vorher = -1;
for (let i = 0; i <= 100; i++) {
	const y = avesmapsZoomEasing(i / 100);
	assert.ok(y >= vorher - 1e-9, "nicht monoton bei t=" + (i / 100));
	assert.ok(y >= -1e-9 && y <= 1 + 1e-9, "ausserhalb [0,1] bei t=" + (i / 100));
	vorher = y;
}
// Ausserhalb des Fensters wird geklemmt, nicht extrapoliert.
assert.strictEqual(avesmapsZoomEasing(-1), 0);
assert.strictEqual(avesmapsZoomEasing(2), 1);

console.log("zoom-uebergang.test.js: alle Zusicherungen erfuellt");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/map-features/__tests__/zoom-uebergang.test.js
```

Erwartet: FEHLER — `ENOENT ... zoom-uebergang.js`.

- [ ] **Schritt 3: `js/map-features/zoom-uebergang.js` anlegen**

```js
// Die EINE Kurve und die EINE Dauer des Zoomschritts -- und die Rechnung, die die Ortsmarker
// ohne Sprung landen laesst.
//
// 🔴 DIESE DATEI IST DIE EINZIGE QUELLE. Vorher stand dieselbe Zeichenkette an sechs Stellen im JS
// und zweimal im CSS; der Entwurf zaehlte fuenf und uebersah drei (Schraffur, Fluss- und
// Tempopfeile). Genau so laufen Werte auseinander.
// Entwurf: docs/superpowers/specs/2026-08-26-zoom-uebergang-konsistenz-design.md
//
// 💣 DIE 250 SIND NICHT FREI. Leaflet zaehlt sie selbst
// (`setTimeout(a(this._onZoomTransitionEnd,this),250)` in js/third-party/leaflet.js, minifiziert).
// Eine andere Dauer im CSS liefe an Leaflets eigenem Ende vorbei -- die Flaechen saessen dann
// entweder zu frueh oder zu spaet auf ihrem Platz. Wer sie aendern will, patcht Fremdcode.
//
// 🔴 Die Kurve ist ease-in-out und NICHT Leaflets cubic-bezier(0,0,0.25,1) (reines ease-out).
// Owner 26.08.2026: „alle sollen diesselbe kubische bezier ease-in-ease out animation von 250 ms
// bekommen. eine zahl fuer alle animationen." Das gilt ausdruecklich auch fuer die Kacheln.
//
// Geladen von index.html, VOR allen Zeichenflaechen und vor js/app/bootstrap.js.

const AVESMAPS_ZOOM_DAUER_MS = 250;
const AVESMAPS_ZOOM_KURVE_PUNKTE = [0.42, 0, 0.58, 1];
const AVESMAPS_ZOOM_KURVE = "cubic-bezier(0.42, 0, 0.58, 1)";

// 💣 Der String und die Punkte sind ein GEKOPPELTER Wert: der String faehrt die CSS-Uebergaenge,
// die Punkte fahren die Gegenrechnung der Marker. Laufen sie auseinander, rechnet die Korrektur
// gegen eine Kurve, die gar nicht laeuft -- und der Fehler waere ein leichtes Zittern, das niemand
// einem Zahlenpaar zuordnet. Bewacht von __tests__/zoom-uebergang.test.js.

/**
 * Ein fertiger Transition-String fuer eine Eigenschaft, auf der gemeinsamen Kurve und Dauer.
 * @param {string} eigenschaft z.B. "transform"
 * @returns {string}
 */
function avesmapsZoomTransition(eigenschaft) {
	return eigenschaft + " " + AVESMAPS_ZOOM_DAUER_MS + "ms " + AVESMAPS_ZOOM_KURVE;
}

/**
 * Der Wert der Zoomkurve zum Zeitpunkt t (0..1) -- dieselbe Kurve, die der Compositor faehrt.
 * 💣 Eine cubic-bezier-Kurve ist nach der ZEIT parametrisiert, nicht nach dem Kurvenparameter:
 * erst muss u gesucht werden mit X(u) = t, dann liefert Y(u) den Weg. Wer einfach Y(t) rechnet,
 * bekommt eine aehnlich aussehende, aber falsche Kurve -- und die Marker liefen der Animation um
 * einige Prozent hinterher.
 * @param {number} t Zeitanteil 0..1 (ausserhalb wird geklemmt)
 * @returns {number} Weganteil 0..1
 */
function avesmapsZoomEasing(t) {
	const zeit = Number(t);
	if (!(zeit > 0)) { return 0; }
	if (zeit >= 1) { return 1; }
	const x1 = AVESMAPS_ZOOM_KURVE_PUNKTE[0], y1 = AVESMAPS_ZOOM_KURVE_PUNKTE[1];
	const x2 = AVESMAPS_ZOOM_KURVE_PUNKTE[2], y2 = AVESMAPS_ZOOM_KURVE_PUNKTE[3];
	const bez = (a, b, u) => { const v = 1 - u; return 3 * v * v * u * a + 3 * v * u * u * b + u * u * u; };
	const abl = (a, b, u) => 3 * a * (1 - u) * (1 - 3 * u) + 3 * b * u * (2 - 3 * u) + 3 * u * u;
	let u = zeit;
	for (let i = 0; i < 8; i++) {
		const rest = bez(x1, x2, u) - zeit;
		if (Math.abs(rest) < 1e-7) { break; }
		const steigung = abl(x1, x2, u);
		if (Math.abs(steigung) < 1e-9) { break; }
		u -= rest / steigung;
	}
	// 💣 Newton darf aus [0,1] hinauslaufen -- dann beschreibt u keinen Zeitpunkt der Animation
	// mehr. Bisektion ist langsamer, aber sie kann es nicht.
	if (!(u >= 0 && u <= 1)) {
		let lo = 0, hi = 1;
		for (let i = 0; i < 30; i++) {
			u = (lo + hi) / 2;
			if (bez(x1, x2, u) < zeit) { lo = u; } else { hi = u; }
		}
	}
	return bez(y1, y2, u);
}
```

- [ ] **Schritt 4: `css/features/zoom-uebergang.css` anlegen**

```css
/* Die EINE Kurve und die EINE Dauer des Zoomschritts, als Token -- und die Stelle, an der Leaflets
   eigene Regel ueberschrieben wird.

   🔴 Owner 26.08.2026: eine Kurve und eine Dauer fuer ALLE Zoomanimationen, ease-in-out, 250 ms.
   Das gilt ausdruecklich auch fuer die KACHELN; sonst waere der Guss an der auffaelligsten Flaeche
   gebrochen.
   💣 leaflet.css ist FREMDCODE und wird nicht editiert, sondern ueberschrieben. Das geht, weil
   css/styles.css in index.html NACH css/third-party/leaflet.css steht und der Selektor derselbe
   ist (0,2,0) -- bei gleicher Spezifitaet gewinnt die spaetere Regel.
   💣 Die 250 ms sind Leaflets eigene Zahl (setTimeout(_onZoomTransitionEnd, 250) in leaflet.js).
   Eine andere Dauer liefe an Leaflets Ende vorbei. Nur die Kurve wird getauscht.
   Die Zwillingsdatei ist js/map-features/zoom-uebergang.js -- beide tragen dieselben Werte, und
   js/map-features/__tests__/zoom-uebergang.test.js haelt sie zusammen. */

:root {
	--avesmaps-zoom-dauer: 250ms;
	--avesmaps-zoom-kurve: cubic-bezier(0.42, 0, 0.58, 1);
}

.leaflet-zoom-anim .leaflet-zoom-animated {
	-webkit-transition: -webkit-transform var(--avesmaps-zoom-dauer) var(--avesmaps-zoom-kurve);
	        transition:         transform var(--avesmaps-zoom-dauer) var(--avesmaps-zoom-kurve);
}
```

- [ ] **Schritt 5: Einbinden**

In `css/styles.css` in die `@import`-Kette aufnehmen, bei den `features/`-Zeilen und **vor**
`features/map-labels.css`, damit die Token vor ihren Lesern stehen:

```css
@import url("features/zoom-uebergang.css");
```

In `index.html` direkt nach Zeile 3280 (`location-zoom-bands.js`), **ohne `?v=`**:

```html
		<script src="js/map-features/zoom-uebergang.js"></script>
```

⚠️ Prüfen, dass diese Zeile **vor** `js/app/bootstrap.js` steht — Aufgabe 5 liest die Konstanten
dort, und ein `const` auf Dateiebene wird nicht gehoistet.

- [ ] **Schritt 6: Die sechs JS-Wirte umstellen**

`map-features-boundary-canvas-overlay.js:452`:

```js
	const TERRITORY_ZOOM_TRANSFORM = avesmapsZoomTransition("transform");
```

`map-features-path-label-canvas-overlay.js:100`:

```js
	const PATH_LABEL_ZOOM_TRANSFORM = avesmapsZoomTransition("transform");
```

`map-features-location-canvas-layer.js:245`, `map-features-contested-hatch-overlay.js:237`,
`map-features-river-flow-arrows.js:170`, `route-speed-arrows.js:356` — überall dieselbe Form
(in `location-canvas-layer.js` heißt die Fläche `this._canvas`):

```js
		canvas.style.transition = avesmapsZoomTransition("transform");
```

`css/features/map-labels.css:240` — die Transform-Hälfte auf die Token ziehen, die Deckkraft-Hälfte
unverändert lassen (sie gehört Aufgabe 3):

```css
	transition: transform var(--avesmaps-zoom-dauer) var(--avesmaps-zoom-kurve),
	            opacity var(--border-label-fade-out, 120ms) ease-out;
```

- [ ] **Schritt 7: Test laufen lassen, grün bestätigen**

```bash
node js/map-features/__tests__/zoom-uebergang.test.js
```

Erwartet: `zoom-uebergang.test.js: alle Zusicherungen erfuellt`

- [ ] **Schritt 8: Das GANZE Testfeld, parallel, mit Dateizahl-Gegenprobe**

```bash
find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | tee >(tr -dc '\0' | wc -c >&2) | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"' > roteliste-js.txt; cat roteliste-js.txt
```

Erwartet: leer, und die Dateizahl passt zu `.github/workflows/deploy-avesmaps-strato.yml`
(26.08.2026: 312 JS). Eine viel zu kleine Zahl heißt: die äußere Klammer fehlt.
💣 Kein `2>&1` auf die Ergebnisdatei — `xargs`-Warnungen läsen sich sonst als roter Test.

- [ ] **Schritt 9: Im Browser messen, BEVOR gepusht wird**

⚠️ Sichtbare Browser-Ansicht nötig, sonst laufen die Übergänge gar nicht los (Entwurf §7).

```js
// Waehrend eines Zoomschritts, in der Konsole:
map.once('zoomanim', () => requestAnimationFrame(() => console.log(
  getComputedStyle(document.querySelector('.leaflet-tile-container')).transitionTimingFunction)));
```

Erwartet: `cubic-bezier(0.42, 0, 0.58, 1)`.

- [ ] **Schritt 10: Commit und EINZELN live**

```bash
git add js/map-features/zoom-uebergang.js css/features/zoom-uebergang.css js/map-features/__tests__/zoom-uebergang.test.js css/styles.css index.html css/features/map-labels.css js/map-features/map-features-boundary-canvas-overlay.js js/map-features/map-features-path-label-canvas-overlay.js js/map-features/map-features-location-canvas-layer.js js/map-features/map-features-contested-hatch-overlay.js js/map-features/map-features-river-flow-arrows.js js/routing/route-speed-arrows.js
git commit -m "ui(zoom): eine Kurve und eine Dauer fuer alle Zoomanimationen -- ease-in-out, 250 ms"
```

Danach pushen, den Lauf **abwarten**, den Owner schauen lassen.

---

### Aufgabe 2: Die Marker landen ohne Sprung

**Sichtbar für den Owner:** Ortspunkte werden beim Zoomen nicht mehr zu groß und schnappen am Ende
zurück. Sie wachsen von ihrer alten auf ihre neue Größe und bleiben dort. Am deutlichsten bei
Metropolen und Großstädten (heute −29 % bzw. −27 % Sprung), am wenigsten bei Gebäuden (+5 %).
Das ruhende Bild ist an jeder Zoomstufe unverändert.

**Dateien:**
- Ändern: `js/map-features/zoom-uebergang.js` (Gegenrechnung ergänzen)
- Ändern: `js/map-features/map-features-location-canvas-layer.js`
- Anlegen: `js/map-features/__tests__/marker-zoom-gegenrechnung.test.js`

**Schnittstellen:**
- Verbraucht: `avesmapsZoomEasing`, `AVESMAPS_ZOOM_DAUER_MS`, `avesmapsZoomTransition` (Aufgabe 1),
  `getLocationMarkerSize(typ, zoom)` (`map-features-location-marker-rendering.js`),
  `AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS` (`location-zoom-bands.js`, nur im Test).
- Liefert: `avesmapsMarkerZoomSizeFactor(groesseAlt, groesseNeu, fortschritt, massstab)` → Zahl.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`js/map-features/__tests__/marker-zoom-gegenrechnung.test.js`:

```js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Aus der Wurzel des Repos:  node js/map-features/__tests__/marker-zoom-gegenrechnung.test.js
const laden = (datei) => vm.runInThisContext(
	fs.readFileSync(path.join(__dirname, "..", datei), "utf8"), { filename: datei });
laden("zoom-uebergang.js");
laden("location-zoom-bands.js");

// 🔴 DER ABNAHMEFALL, und er ist EINE Zusicherung: am Ende der Animation ist die SCHEINBARE Groesse
// jeder Ortsklasse exakt ihre Groesse fuer die neue Zoomstufe. Genau das heisst „kein Sprung".
//   scheinbar = gezeichnet x Massstab = alt x faktor x massstab
const KLASSEN = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"];
const groesse = (typ, z) => AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS.marker[typ][z];

for (let z = 0; z < 6; z++) {
	for (const typ of KLASSEN) {
		const alt = groesse(typ, z), neu = groesse(typ, z + 1);
		if (alt === null || neu === null) { continue; }
		const massstab = 2;               // eine Zoomstufe hinein
		const faktor = avesmapsMarkerZoomSizeFactor(alt, neu, 1, massstab);
		assert.ok(Math.abs(alt * faktor * massstab - neu) < 1e-9,
			`${typ} z${z}->z${z + 1}: landet bei ${alt * faktor * massstab} statt ${neu}`);
		// Und am Anfang steht sie unveraendert da -- kein Sprung bei t = 0.
		assert.strictEqual(avesmapsMarkerZoomSizeFactor(alt, neu, 0, massstab), 1,
			`${typ} z${z}: springt schon bei t=0`);
	}
}

// Herauszoomen: derselbe Vertrag, Massstab 0,5.
for (let z = 1; z <= 6; z++) {
	for (const typ of KLASSEN) {
		const alt = groesse(typ, z), neu = groesse(typ, z - 1);
		if (alt === null || neu === null) { continue; }
		const faktor = avesmapsMarkerZoomSizeFactor(alt, neu, 1, 0.5);
		assert.ok(Math.abs(alt * faktor * 0.5 - neu) < 1e-9,
			`${typ} z${z}->z${z - 1} (raus): landet bei ${alt * faktor * 0.5} statt ${neu}`);
	}
}

// 🔴 z6 -> z7 ist der schlimmste Schritt von heute (die Tafel wiederholt z6, echter Faktor 1,0,
// also -50 % Sprung). Owner-Entscheid 26.08.2026: z7 erbt z6, und der Sprung faellt durch die
// Gegenrechnung weg -- die Marker wachsen dort einfach nicht mehr.
for (const typ of KLASSEN) {
	const alt = groesse(typ, 6), neu = groesse(typ, 7);
	assert.strictEqual(alt, neu, typ + ": z7 erbt nicht mehr z6 -- Owner-Entscheid geaendert?");
	const faktor = avesmapsMarkerZoomSizeFactor(alt, neu, 1, 2);
	assert.ok(Math.abs(faktor - 0.5) < 1e-9, typ + ": z6->z7 rechnet nicht auf konstante Groesse");
	assert.ok(Math.abs(alt * faktor * 2 - neu) < 1e-9, typ + ": z6->z7 springt");
}

// 💣 DIE FAKTOREN MUESSEN SICH JE KLASSE UNTERSCHEIDEN. Wer das hier auf EINEN gemeinsamen Faktor
// „vereinfacht", nimmt den Owner-Entscheid von §3.1 zurueck und bringt den Sprung wieder mit.
const faktorenBeiZ4 = KLASSEN
	.filter((t) => groesse(t, 4) !== null && groesse(t, 5) !== null)
	.map((t) => avesmapsMarkerZoomSizeFactor(groesse(t, 4), groesse(t, 5), 1, 2));
assert.strictEqual(new Set(faktorenBeiZ4.map((f) => f.toFixed(6))).size, faktorenBeiZ4.length,
	"Alle Klassen bekommen denselben Faktor -- die Gegenrechnung ist nicht je Klasse.");

// Der Weg dazwischen ist monoton und bleibt zwischen den Endwerten (kein Ueberschwingen).
{
	const alt = groesse("metropole", 4), neu = groesse("metropole", 5);
	let letzter = Infinity;
	for (let i = 0; i <= 50; i++) {
		const e = avesmapsZoomEasing(i / 50);
		const f = avesmapsMarkerZoomSizeFactor(alt, neu, e, 2);
		assert.ok(f <= letzter + 1e-9, "nicht monoton bei i=" + i);
		assert.ok(f <= 1 + 1e-9 && f >= neu / alt / 2 - 1e-9, "ueberschwingt bei i=" + i);
		letzter = f;
	}
}

// Schutzwerte: unbrauchbare Eingaben aendern nichts, statt den Marker verschwinden zu lassen.
assert.strictEqual(avesmapsMarkerZoomSizeFactor(0, 10, 0.5, 2), 1);
assert.strictEqual(avesmapsMarkerZoomSizeFactor(10, 0, 0.5, 2), 1);
assert.strictEqual(avesmapsMarkerZoomSizeFactor(10, 20, 0.5, 0), 1);
assert.strictEqual(avesmapsMarkerZoomSizeFactor(NaN, 20, 0.5, 2), 1);

// ---- Verdrahtung: der Marker-Canvas benutzt die Rechnung wirklich ------------------------------
// 💣 Kommentare ZUERST strippen -- sonst schlaegt der Test an der Warnung an, die vor dem Muster
// warnt, und der naechste Leser loescht den Kommentar, um ihn gruen zu bekommen.
const quelle = fs.readFileSync(path.join(__dirname, "../map-features-location-canvas-layer.js"), "utf8")
	.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
assert.ok(/avesmapsMarkerZoomSizeFactor\s*\(/.test(quelle),
	"💣 Der Marker-Canvas ruft die Gegenrechnung nicht -- die Datei allein tut nichts.");
assert.ok(/_zoomGroessenFaktoren\s*=\s*null/.test(quelle),
	"💣 Die Faktoren muessen am Ende der Animation zurueckgesetzt werden, sonst zeichnet jeder "
	+ "spaetere Pan die Marker in Zwischengroesse.");
assert.ok(/cancelAnimationFrame/.test(quelle),
	"💣 Ohne Abbruch laeuft die Schleife nach einem abgebrochenen Zoom weiter.");

console.log("marker-zoom-gegenrechnung.test.js: alle Zusicherungen erfuellt");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/map-features/__tests__/marker-zoom-gegenrechnung.test.js
```

Erwartet: FEHLER — `avesmapsMarkerZoomSizeFactor is not defined`.

- [ ] **Schritt 3: Die Gegenrechnung in `js/map-features/zoom-uebergang.js` ergänzen**

```js
/**
 * Wieviel kleiner (oder groesser) ein Ortsmarker WAEHREND der Zoom-Animation gezeichnet werden
 * muss, damit er auf seiner echten Zielgroesse LANDET statt zurueckzuschnappen.
 *
 * 💣 DAS PROBLEM, DAS SIE LOEST (Entwurf §3): der Canvas skaliert 250 ms lang um den vollen
 * Kartenfaktor (2 je Zoomstufe), aber keine Ortsklasse waechst wirklich um 2 -- Metropole 1,414,
 * Gebaeude 2,106. Am zoomend schnappt darum jede Klasse um einen ANDEREN Betrag zurueck
 * (-29 % bis +5 %). Genau das liest sich als „nicht synchron".
 *
 * 🔴 OWNER-ENTSCHEID 26.08.2026 (§3.1): die Zoombaender werden dafuer NICHT angefasst. Ein
 * gemeinsamer Wachstumsfaktor muesste 2,0 sein, und der ist mit dem heutigen Bild unvereinbar --
 * gerechnet: die Metropole stuende bei z0 auf 2,35 px statt 6,65 und bei z6 auf 150 px statt 53,2
 * (groesste Einzelaenderung +183 %, RMS 53 %). Auch das rechnerische Optimum (gemeinsamer Faktor
 * 1,61) kostet 22 % RMS Bildaenderung UND laesst 19 % Sprung stehen. Deshalb bleibt die Tafel, und
 * die Animation rechnet dagegen.
 *
 * Die Rechnung: gewuenschte scheinbare Groesse geteilt durch den Massstab, den der Canvas gerade
 * traegt -- beides relativ zur Ausgangsgroesse, damit der Rueckgabewert ein reiner Multiplikator
 * auf die bereits gezeichneten Werte ist.
 *   gewuenscht = 1 + e * (neu/alt - 1)      (linear entlang derselben Kurve wie die Transform)
 *   gezeichnet = 1 + e * (massstab - 1)     (was der Compositor in diesem Moment skaliert)
 * Bei e = 0 kommt 1 heraus (kein Sprung am Anfang), bei e = 1 genau neu/(alt*massstab) -- also
 * landet alt * faktor * massstab exakt auf neu (kein Sprung am Ende).
 *
 * ⚠️ Die POSITIONEN bleiben unangetastet: sie muessen um den vollen Kartenfaktor skalieren und tun
 * das weiter ueber die Transform. Nur die Groessen werden gegengerechnet -- eine einzelne
 * Canvas-Transform kann Groesse und Lage nicht trennen, ein Zeichenvorgang schon. Das ist der
 * ganze Grund, warum diese Korrektur beim ZEICHNEN sitzt und nicht an der Transform.
 *
 * 🔴 Ein unbrauchbarer Wert gibt 1 zurueck, nicht 0: ein Faktor 0 liesse den Marker verschwinden,
 * und „Ortsmarker blenden nicht" ist ein Owner-Entscheid vom 24.08.2026.
 *
 * @param {number} groesseAlt Markergroesse auf der Stufe, von der aus gezoomt wird
 * @param {number} groesseNeu Markergroesse auf der Zielstufe
 * @param {number} fortschritt Weganteil der Animation, 0..1 (aus avesmapsZoomEasing)
 * @param {number} massstab Kartenfaktor des Schritts (map.getZoomScale(zielZoom)), z.B. 2 oder 0,5
 * @returns {number} Multiplikator auf die gezeichneten Groessen
 */
function avesmapsMarkerZoomSizeFactor(groesseAlt, groesseNeu, fortschritt, massstab) {
	const alt = Number(groesseAlt);
	const neu = Number(groesseNeu);
	const s = Number(massstab);
	if (!(alt > 0) || !(neu > 0) || !(s > 0)) { return 1; }
	const e = Math.min(1, Math.max(0, Number(fortschritt) || 0));
	const gezeichnet = 1 + e * (s - 1);
	if (!(gezeichnet > 0)) { return 1; }
	return (1 + e * (neu / alt - 1)) / gezeichnet;
}
```

- [ ] **Schritt 4: Den Marker-Canvas verdrahten**

In `js/map-features/map-features-location-canvas-layer.js`:

(a) In `setEntries` die Ortsklasse an den Eintrag hängen — `_redraw` weiß sonst nicht, welcher
Faktor gilt:

```js
			return {
				entry,
				typ: locationType,
				latLng: entry.marker.getLatLng(),
```

(b) Zwei Felder in das Layer-Objekt, neben `_cssZoomActive`:

```js
	// Die je Ortsklasse gerechnete Groessenkorrektur waehrend der Zoom-Animation. `null` heisst:
	// keine Animation, zeichne normal. 💣 Muss in _reset zurueckgesetzt werden, sonst zeichnet
	// jeder spaetere Pan die Marker in einer Zwischengroesse.
	_zoomGroessenFaktoren: null,
	_zoomBildAnforderung: 0,
```

(c) `_onZoomAnim` erweitern (die bestehende Transform-Rechnung bleibt unverändert):

```js
	_onZoomAnim(event) {
		if (!this._ready || !this._topLeftLatLng) { return; }
		if (typeof this._map._latLngToNewLayerPoint !== "function") { return; }
		this._cssZoomActive = true;
		this._canvas.style.transition = avesmapsZoomTransition("transform");
		const scale = this._map.getZoomScale(event.zoom);
		const offset = this._map._latLngToNewLayerPoint(this._topLeftLatLng, event.zoom, event.center);
		L.DomUtil.setTransform(this._canvas, offset, scale);
		this._starteGroessenGegenrechnung(event.zoom, scale);
	},

	/**
	 * 🔴 DIE GEGENRECHNUNG (Owner-Entscheid 26.08.2026, Entwurf §3.1). Waehrend der Animation wird
	 * der Canvas Bild fuer Bild mit korrigierten Groessen neu gezeichnet, damit jede Ortsklasse auf
	 * ihrer echten Zielgroesse LANDET statt zurueckzuschnappen.
	 * ⭐ Das darf hier stehen, weil der Zoom eine CSS-Transform-Transition ist und auf dem
	 * Compositor laeuft -- Zeichnen auf dem Hauptthread haelt die Bewegung nicht an
	 * (docs/kartenflaechen-und-zoomblenden.md §5, gemessen).
	 * 💣 Ohne cancelAnimationFrame laeuft die Schleife nach einem abgebrochenen Zoom weiter und
	 * zeichnet gegen eine Animation, die es nicht mehr gibt.
	 */
	_starteGroessenGegenrechnung(zielZoom, massstab) {
		if (typeof avesmapsMarkerZoomSizeFactor !== "function") { return; }
		if (this._zoomBildAnforderung) { cancelAnimationFrame(this._zoomBildAnforderung); }
		const vonZoom = this._map.getZoom();
		// Die Faktoren haengen nur an der Ortsklasse, nicht am einzelnen Marker -- einmal je Klasse
		// rechnen, nicht einmal je Eintrag (live sind es rund 5000 Eintraege und sechs Klassen).
		const klassen = Array.from(new Set(this._entries.map((i) => i.typ).filter(Boolean)));
		const groessen = klassen.map((typ) => ({
			typ,
			alt: getLocationMarkerSize(typ, vonZoom),
			neu: getLocationMarkerSize(typ, zielZoom),
		}));
		const start = performance.now();
		const schritt = () => {
			const t = (performance.now() - start) / AVESMAPS_ZOOM_DAUER_MS;
			const e = avesmapsZoomEasing(t);
			const faktoren = {};
			for (const g of groessen) {
				faktoren[g.typ] = avesmapsMarkerZoomSizeFactor(g.alt, g.neu, e, massstab);
			}
			this._zoomGroessenFaktoren = faktoren;
			this._redraw();
			// ⚠️ Der letzte Zustand bleibt STEHEN, bis _reset ihn am zoomend abraeumt. Wer hier auf
			// null zuruecksetzt, macht aus der beseitigten Landung wieder einen Sprung -- nur zwei
			// Bilder frueher.
			this._zoomBildAnforderung = t < 1 ? requestAnimationFrame(schritt) : 0;
		};
		this._zoomBildAnforderung = requestAnimationFrame(schritt);
	},
```

(d) In `_reset`, direkt neben dem bestehenden `this._cssZoomActive = false;`:

```js
		if (this._zoomBildAnforderung) { cancelAnimationFrame(this._zoomBildAnforderung); }
		this._zoomBildAnforderung = 0;
		this._zoomGroessenFaktoren = null;
```

(e) In `_redraw`, unmittelbar vor `for (const item of this._entries)`:

```js
		const zoomFaktoren = this._zoomGroessenFaktoren;
```

und innerhalb der Schleife, an der Stelle von `const core = item.core;` — die vier Größen skalieren,
die Formentscheidungen (`isDiamond`, `isCapital`) NICHT, damit die Form während der Animation nicht
umspringt:

```js
			const k = zoomFaktoren && zoomFaktoren[item.typ] ? zoomFaktoren[item.typ] : 1;
			const core = item.core * k;
			const outer = core + item.contour * k;
```

Ebenso `item.accentRing` → `item.accentRing * k` und `item.leyR` → `item.leyR * k` an ihren
Verwendungsstellen.

- [ ] **Schritt 5: Beide Tests laufen lassen, grün bestätigen**

```bash
node js/map-features/__tests__/marker-zoom-gegenrechnung.test.js && node js/map-features/__tests__/zoom-uebergang.test.js
```

- [ ] **Schritt 6: Im Browser MESSEN — die Kosten**

⚠️ Sichtbare Browser-Ansicht nötig (Entwurf §7).

```js
const t=[]; for(let i=0;i<20;i++){const a=performance.now(); locationCanvasLayer._redraw(); t.push(performance.now()-a);}
t.sort((a,b)=>a-b); console.log('Median', t[10], 'max', t[19], 'Eintraege', locationCanvasLayer._entries.length);
```

🔴 **Entscheidungsregel:** liegt der Median über **8 ms**, wird die Schleife von „je Bild" auf eine
Treppe umgestellt — dieselbe Rechnung, nur an `AVESMAPS_MARKER_ZOOM_SCHRITTE = 5` festen Zeitpunkten
statt an jedem Bild. Der Sprung am Ende bleibt in beiden Fällen null; die Treppe kostet nur
Zwischenstufen. Das Ergebnis der Messung gehört als Zahl in den Kommentar.

- [ ] **Schritt 7: Im Browser SEHEN**

z4 ↔ z5 hin und her. Die Metropolen dürfen am Ende der Bewegung **nicht** kleiner werden. Danach
**pannen** — nichts darf nachziehen.

- [ ] **Schritt 8: Das GANZE Testfeld, parallel** (Befehl wie Aufgabe 1, Schritt 8)

- [ ] **Schritt 9: Commit und EINZELN live**

```bash
git add js/map-features/zoom-uebergang.js js/map-features/map-features-location-canvas-layer.js js/map-features/__tests__/marker-zoom-gegenrechnung.test.js js/map-features/__tests__/zoom-uebergang.test.js
git commit -m "ui(zoom): Ortsmarker landen ohne Sprung -- Groesse je Klasse waehrend der Animation gegengerechnet"
```

---

### Aufgabe 3: Die Grenzbeschriftungen blenden WÄHREND des Zooms

**Sichtbar für den Owner:** In der derographischen Ansicht wechseln die Gebietsnamen ihr Schriftbild
jetzt während der Zoombewegung statt danach. Nach dem Zoom steht sofort alles fertig da — die
kleine Pause, in der die Namen fehlten, entfällt.

**Dateien:**
- Ändern: `js/map-features/map-features-boundary-canvas-overlay.js`
- Anlegen: `js/map-features/__tests__/grenznamen-parallelblende.test.js`

**Schnittstellen:**
- Verbraucht: `avesmapsZoomTransition`, `AVESMAPS_ZOOM_DAUER_MS`, `AVESMAPS_ZOOM_KURVE` (Aufgabe 1).

**Vorlage:** `git show ed1e2e93 -- js/map-features/map-features-boundary-canvas-overlay.js`.
Der Ansatz ist richtig; **drei Dinge daraus sind zu reparieren**:

1. 💣 Die Vorlage setzt `labelVorne.style.transition = TERRITORY_ZOOM_TRANSFORM + ", opacity …"` und
   damit eine **inline Transform-Transition**, die den Zoom überlebt. Danach zieht jeder Pan nach
   (Owner: „wenn ich mit der maus panne, ziehen die 2x nach") — die Regression aus `e85b31d1`.
   Der `moveend`-Handler muss sie auf **beiden** Flächen löschen, auch der gerade unsichtbaren.
2. 💣 Die Gegenrechnung der Vorlage war **nie gesehen** (der damalige Browser lieferte 0 Bilder/s).
   Sie muss im Browser geprüft werden, bevor gepusht wird — sitzt sie falsch, gleiten die Namen aus
   der falschen Richtung oder in falscher Größe herein, und **das sieht nur ein Auge, kein Test**.
3. 🪤 Die hintere der beiden Flächen trägt **gar keine Transform** (Entwurf §4, Nebenbefund). Wer im
   `zoomanim` beide Flächen anfasst, muss die hintere vorher ausrichten.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`js/map-features/__tests__/grenznamen-parallelblende.test.js`:

```js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Aus der Wurzel des Repos:  node js/map-features/__tests__/grenznamen-parallelblende.test.js
const roh = fs.readFileSync(
	path.join(__dirname, "../map-features-boundary-canvas-overlay.js"), "utf8");
// 💣 Kommentare ZUERST strippen -- sonst schlaegt der Test an der Warnung an, die vor dem Muster
// warnt, und der naechste Leser loescht den Kommentar, um ihn gruen zu bekommen.
const quelle = roh.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// Die Beschriftung wird fuer die ZIELSTUFE gezeichnet, nicht fuer die aktuelle.
assert.ok(/function\s+drawTerritoryBorderLabels\s*\(\s*ctx\s*,\s*zielZoom\s*,\s*zielCenter\s*\)/.test(quelle),
	"drawTerritoryBorderLabels nimmt die Zielstufe nicht entgegen -- ohne sie kann im zoomanim "
	+ "kein neues Bild entstehen.");
// Ein vorab gezeichnetes Bild darf der redraw am zoomend nicht loeschen.
assert.ok(/labelsVorabGezeichnet/.test(quelle),
	"💣 Ohne diese Wache loescht der redraw am zoomend das eben eingeblendete Bild -- die Flaeche "
	+ "waere genau dann leer, wenn alles fertig aussieht.");
// Die Gegenrechnung: Start- UND Endversatz muessen gerechnet werden.
assert.ok(/_latLngToNewLayerPoint\s*\(/.test(quelle) && /latLngToLayerPoint\s*\(/.test(quelle),
	"💣 Die Gegenrechnung braucht beide Projektionen: wo die kuenftige Ecke JETZT liegt und wo sie "
	+ "nach dem Zoom liegt.");

// 🔴 DIE REGRESSION, DIE ZWEIMAL BEZAHLT WURDE: eine inline gesetzte Transform-Transition
// ueberlebt den Zoom, und L.DomUtil.setPosition verschiebt per transform -- danach animiert JEDER
// Pan die Position nach. Der moveend-Handler muss sie auf BEIDEN Flaechen loeschen.
const moveendBlock = quelle.slice(quelle.indexOf('map.on("moveend zoomend viewreset resize"'));
assert.ok(/labelFlaechen\.forEach\([\s\S]{0,200}?transition\s*=\s*""/.test(moveendBlock),
	"💣 Der moveend-Handler loescht die Transform-Transition nicht auf BEIDEN Beschriftungsflaechen "
	+ "-- die eine, die gerade unsichtbar ist, wird beim naechsten Rollentausch die sichtbare.");

// Die gemeinsame Kurve, kein zweiter Zahlenwert daneben.
assert.ok(/avesmapsZoomTransition\s*\(/.test(quelle));
assert.ok(/AVESMAPS_ZOOM_DAUER_MS/.test(quelle),
	"Die Restzeit-Rechnung muss aus der gemeinsamen Dauer kommen, nicht aus einer eigenen 250.");
assert.ok(!/\b250\b/.test(quelle.replace(/AVESMAPS_ZOOM_DAUER_MS/g, "")),
	"Eine zweite, abgeschriebene 250 -- das ist der gekoppelte Wert, der auseinanderlaeuft.");

// Der Notausgang bleibt.
assert.ok(/parallelfade/.test(roh),
	"⭐ ?parallelfade=0 muss den Stand von vorher herstellen -- ohne Deploy vergleichbar.");

console.log("grenznamen-parallelblende.test.js: alle Zusicherungen erfuellt");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/map-features/__tests__/grenznamen-parallelblende.test.js
```

Erwartet: FEHLER bei `drawTerritoryBorderLabels nimmt die Zielstufe nicht entgegen`.

- [ ] **Schritt 3: Die Vorlage aus `ed1e2e93` übertragen**

```bash
git show ed1e2e93 -- js/map-features/map-features-boundary-canvas-overlay.js
```

Von Hand übertragen (**nicht** `git apply` — die Datei hat sich seither geändert), dabei:
- `TERRITORY_ZOOM_TRANSFORM` bleibt, kommt aber aus `avesmapsZoomTransition("transform")`.
- `ZOOM_ANIMATION_MS` **entfällt** — stattdessen `AVESMAPS_ZOOM_DAUER_MS` aus Aufgabe 1.
- Die Blende bekommt ebenfalls die gemeinsame Kurve:
  `"opacity " + restMs + "ms " + AVESMAPS_ZOOM_KURVE` statt `"ms ease"`.

- [ ] **Schritt 4: Die Pan-Regression schließen**

Im `moveend zoomend viewreset resize`-Handler (`map-features-boundary-canvas-overlay.js:795`):

```js
		// 💣 AUF BEIDEN FLAECHEN. Die Transform-Transition aus dem zoomanim ueberlebt den Zoom, und
		// L.DomUtil.setPosition verschiebt per transform -- ohne dieses Loeschen animiert jeder Pan
		// die Position nach (Owner: „wenn ich mit der maus panne, ziehen die 2x nach", e85b31d1 und
		// noch einmal im Parallel-Versuch ed1e2e93). Auch die gerade UNSICHTBARE Flaeche: sie wird
		// beim naechsten Rollentausch die sichtbare.
		labelFlaechen.forEach((c) => { c.style.transition = ""; });
```

- [ ] **Schritt 5: Test laufen lassen, grün bestätigen**

```bash
node js/map-features/__tests__/grenznamen-parallelblende.test.js
```

- [ ] **Schritt 6: Im Browser SEHEN — die Gegenrechnung**

🔴 Das ist der Schritt, der in `ed1e2e93` gefehlt hat und der den Rückbau verursacht hat.
Derographische Ansicht, z4 ↔ z5 hin und her, und ausdrücklich prüfen:
- Kommen die neuen Namen aus der **richtigen Richtung** herein, oder gleiten sie quer?
- Stehen sie während der Blende in der **richtigen Größe**, oder wachsen sie sichtbar nach?
- Danach **mit der Maus pannen** — zieht irgendetwas nach?
- Gegenprobe: `?parallelfade=0` muss den alten Ablauf zeigen.

- [ ] **Schritt 7: Das GANZE Testfeld, parallel** (Befehl wie Aufgabe 1, Schritt 8)

- [ ] **Schritt 8: Commit und EINZELN live**

```bash
git add js/map-features/map-features-boundary-canvas-overlay.js js/map-features/__tests__/grenznamen-parallelblende.test.js
git commit -m "ui(grenznamen): Zoom, Ausblenden und Einblenden laufen parallel ab zoomanim t=0"
```

---

### Aufgabe 4: Die Wege- und Flussnamen blenden WÄHREND des Zooms

**Sichtbar für den Owner:** Straßen- und Flussnamen wechseln ihr Schriftbild während der
Zoombewegung statt danach. Sie sind der größte Ausreißer von heute (Schrift 10 → 11 px, das Bild
skaliert aber ×2 — die Namen stehen am Ende 82 % zu groß da und schnappen um 45 % zurück). Nach der
Änderung ist der Sprung nicht mehr sichtbar, weil das übergroße alte Bild wegblendet, während das
maßstabsrichtige neue hereinkommt.

**Dateien:**
- Ändern: `js/map-features/map-features-path-label-canvas-overlay.js`
- Anlegen: `js/map-features/__tests__/wegenamen-parallelblende.test.js`

**Schnittstellen:**
- Verbraucht: `avesmapsZoomTransition`, `AVESMAPS_ZOOM_DAUER_MS`, `AVESMAPS_ZOOM_KURVE` (Aufgabe 1).

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`js/map-features/__tests__/wegenamen-parallelblende.test.js` (der Text wird hier vollständig
wiederholt, weil Aufgaben einzeln gelesen werden):

```js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Aus der Wurzel des Repos:  node js/map-features/__tests__/wegenamen-parallelblende.test.js
const roh = fs.readFileSync(
	path.join(__dirname, "../map-features-path-label-canvas-overlay.js"), "utf8");
// 💣 Kommentare ZUERST strippen -- sonst schlaegt der Test an der Warnung an, die vor dem Muster warnt.
const quelle = roh.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

assert.ok(/avesmapsZoomTransition\s*\(/.test(quelle),
	"Die Kurve kommt nicht aus zoom-uebergang.js.");
assert.ok(/AVESMAPS_ZOOM_DAUER_MS/.test(quelle),
	"Die Restzeit der Blende muss aus der gemeinsamen Dauer kommen.");
assert.ok(/_latLngToNewLayerPoint\s*\(/.test(quelle),
	"💣 Ohne die Gegenrechnung stuenden die neuen Namen 250 ms lang in falscher Groesse am "
	+ "falschen Fleck.");
assert.ok(/labelsVorabGezeichnet|wegeLabelsVorabGezeichnet/.test(quelle),
	"💣 Ohne diese Wache loescht der redraw am zoomend das eben eingeblendete Bild.");

// 🔴 DIE REGRESSION: hier steht die Blende INLINE (der zoomanim-Handler setzt style.transition
// seit jeher selbst, und inline gewinnt gegen CSS) -- das Loeschen im moveend ist deshalb der
// einzige Schutz gegen nachziehende Panbewegungen.
const moveendBlock = quelle.slice(quelle.indexOf('map.on("moveend zoomend viewreset resize"'));
assert.ok(/transition\s*=\s*""/.test(moveendBlock),
	"💣 Der moveend-Handler loescht die Transform-Transition nicht -- danach zieht jeder Pan nach.");

assert.ok(/crossfade/.test(roh), "⭐ ?crossfade=0 muss den Stand von vorher herstellen.");

console.log("wegenamen-parallelblende.test.js: alle Zusicherungen erfuellt");
```

- [ ] **Schritt 2: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/map-features/__tests__/wegenamen-parallelblende.test.js
```

- [ ] **Schritt 3: `redraw()` für eine Zielstufe zeichnen lassen**

💣 **Hier liegt der Unterschied zu Aufgabe 3, und er ist der ganze Aufwand:** die Grenznamen hatten
mit `drawTerritoryBorderLabels` bereits eine abtrennbare Zeichenfunktion mit **einer** Projektion
(`toPoint`). `redraw()` (`map-features-path-label-canvas-overlay.js:566`) projiziert an **fünf**
Stellen direkt über `map.latLngToContainerPoint` (Zeilen 408, 642, 763, 904 und im Kurvenzweig) und
liest `map.getZoom()` separat. Wer nur eine davon umstellt, zeichnet ein Bild, dessen Beschriftungen
teils auf der alten und teils auf der neuen Stufe liegen — und das sieht aus wie ein
Kollisionsfehler, nicht wie ein halber Umbau.

`redraw()` bekommt zwei optionale Parameter und **eine** lokale Projektion, die alle fünf Stellen
benutzen:

```js
	/**
	 * @param {number} [zielZoom] Zoomstufe, FUER DIE gezeichnet werden soll -- nicht die aktuelle.
	 * @param {L.LatLng} [zielCenter] Zugehoeriges Zentrum.
	 * 🔴 Ohne die beiden verhaelt sich alles wie vorher (Pan, moveend, Erst-Zeichnen).
	 * 💣 `latLngToContainerPoint` liest IMMER den aktuellen Stand. Fuer die Zielstufe muss von Hand
	 * projiziert werden: Weltpunkt bei Zielzoom, minus Weltpunkt des Zielzentrums, plus halbe
	 * Fenstergroesse -- genau die Rechnung, die Leaflet selbst fuer den aktuellen Zoom macht.
	 * 💣 ALLE FUENF Projektionsstellen muessen `projiziere` benutzen. Bleibt eine bei
	 * `map.latLngToContainerPoint`, liegen ihre Namen auf der alten Stufe, waehrend die uebrigen
	 * schon auf der neuen sitzen -- die Kollisionsloesung rechnet dann gegen ein Bild, das es nicht
	 * gibt, und das Ergebnis liest sich als Kollisionsfehler.
	 */
	function redraw(zielZoom, zielCenter) {
		const fuerZiel = Number.isFinite(zielZoom) && !!zielCenter;
		const zeichenZoom = fuerZiel ? zielZoom : map.getZoom();
		const halbeGroesse = fuerZiel ? L.point(map.getSize().x / 2, map.getSize().y / 2) : null;
		const zentrumWelt = fuerZiel ? map.project(zielCenter, zielZoom) : null;
		const projiziere = fuerZiel
			? ((latlng) => map.project(latlng, zielZoom).subtract(zentrumWelt).add(halbeGroesse))
			: ((latlng) => map.latLngToContainerPoint(latlng));
		// ... ab hier jedes `map.latLngToContainerPoint(X)` durch `projiziere(X)` ersetzen und
		// jedes `map.getZoom()` durch `zeichenZoom`.
```

Im `zoomanim`-Handler (Zeile 1173) danach denselben Ablauf wie bei den Grenznamen: Rollentausch,
`redraw(event.zoom, event.center)` in die hintere Fläche, Gegenrechnung und beide Übergänge:

```js
		if (!KREUZBLENDE_AN || !PARALLELBLENDE_AN) { /* wie bisher */ return; }
		const begonnen = performance.now();
		const zielEckeLatLng = map.unproject(
			map.project(event.center, event.zoom)
				.subtract(L.point(map.getSize().x / 2, map.getSize().y / 2)),
			event.zoom);
		const tausch = vorne; vorne = hinten; hinten = tausch;
		redraw(event.zoom, event.center);
		wegeLabelsVorabGezeichnet = true;

		// 💣 DIE GEGENRECHNUNG. Das neue Bild liegt in ZIEL-Koordinaten, die Karte steht noch auf
		// der alten Stufe. Die Flaeche startet dort, wo die kuenftige linke obere Ecke JETZT liegt,
		// auf 1/scale geschrumpft, und animiert auf ihren Platz nach dem Zoom.
		const startVersatz = map.latLngToLayerPoint(zielEckeLatLng);
		const endVersatz = map._latLngToNewLayerPoint(zielEckeLatLng, event.zoom, event.center);
		vorne.style.transition = "none";
		L.DomUtil.setTransform(vorne, startVersatz, 1 / scale);
		vorne.style.opacity = "0";
		void vorne.offsetWidth;   // Zwischenstand erzwingen, sonst gibt es keinen Uebergang
		// ⚠️ Die RESTLICHE Animationszeit, nicht die volle -- das Zeichnen oben hat schon etwas
		// davon verbraucht. So ist die Blende fertig, wenn die Zoomstufe sitzt.
		const restMs = Math.max(80, Math.round(AVESMAPS_ZOOM_DAUER_MS - (performance.now() - begonnen)));
		vorne.style.transition = PATH_LABEL_ZOOM_TRANSFORM + ", opacity " + restMs + "ms " + AVESMAPS_ZOOM_KURVE;
		L.DomUtil.setTransform(vorne, endVersatz, 1);
		vorne.style.opacity = "1";
		hinten.style.transition = PATH_LABEL_ZOOM_TRANSFORM + ", opacity " + restMs + "ms " + AVESMAPS_ZOOM_KURVE;
		hinten.style.opacity = "0";
```

💣 Und wie bei den Grenznamen: der `redraw()` am `zoomend` darf das vorab gezeichnete Bild **nicht**
löschen — `wegeLabelsVorabGezeichnet` wird dort gelesen und zurückgesetzt.

- [ ] **Schritt 4: Test laufen lassen, grün bestätigen**

```bash
node js/map-features/__tests__/wegenamen-parallelblende.test.js
```

- [ ] **Schritt 5: Im Browser SEHEN**

Standardansicht, z4 ↔ z5. Prüfen wie in Aufgabe 3, Schritt 6 — plus: **die Namen liegen auf
Leitlinien und dürfen beim Hereinblenden nicht kopfüber stehen**.

- [ ] **Schritt 6: Das GANZE Testfeld, parallel** (Befehl wie Aufgabe 1, Schritt 8)

- [ ] **Schritt 7: Commit und EINZELN live**

```bash
git add js/map-features/map-features-path-label-canvas-overlay.js js/map-features/__tests__/wegenamen-parallelblende.test.js
git commit -m "ui(wegenamen): Zoom, Ausblenden und Einblenden laufen parallel ab zoomanim t=0"
```

---

### Aufgabe 5: Die Orts- und Landschaftsnamen blenden WÄHREND des Zooms

**Sichtbar für den Owner:** Siedlungs- und Landschaftsnamen wechseln ihr Schriftbild während der
Zoombewegung. Das ist die letzte der drei Schrift-Ebenen; danach beginnt beim Zoomen alles
gleichzeitig und endet gleichzeitig.

**Dateien:**
- Ändern: `js/app/bootstrap.js:221-260` (der Pane-Klon)
- Ändern: `css/features/map-labels.css:255-260` (die zwei alten Blenden-Kurven)
- Anlegen: `js/app/__tests__/labelpane-parallelblende.test.js`

**Schnittstellen:**
- Verbraucht: `AVESMAPS_ZOOM_DAUER_MS`, `AVESMAPS_ZOOM_KURVE` (Aufgabe 1).

⚠️ **Der Unterschied zu den Aufgaben 3 und 4:** die Label-Panes tragen weder eine eigene Transform
noch `leaflet-zoom-animated` (Entwurf §6.2, gemessen). Der **Klon** skaliert gratis mit, weil er ein
Kind des `_mapPane` ist. Das echte Pane müsste also im `zoomanim` schon neu bestückt werden, damit
es beim Einblenden das Zielbild zeigt. **Die Kosten dafür sind ungemessen** — `prepareLabelData` war
am 12.08.2026 mit 13,8 s die teuerste Stelle des Startlaufs.

🔴 **Deshalb ist Schritt 1 eine MESSUNG, keine Änderung.** Fällt sie schlecht aus, bleibt es beim
heutigen Verhalten (das Ausblenden bei t = 0 tut das Pane bereits — DOM-Labels können nur
verschwinden, nicht mitgehen, Entwurf §6.2) und nur die Kurven werden vereinheitlicht.

- [ ] **Schritt 1: Messen, ob das Neubestücken im `zoomanim` bezahlbar ist**

Sichtbare Browser-Ansicht, Konsole:

```js
const t=[]; for(let i=0;i<10;i++){const a=performance.now(); prepareLabelData(); t.push(performance.now()-a);}
t.sort((a,b)=>a-b); console.log('Median', t[5], 'max', t[9]);
```

🔴 **Entscheidungsregel:** Median über **60 ms** ⇒ das Neubestücken bleibt am `zoomend`, und die
Aufgabe schrumpft auf Schritt 4 (nur die Kurven). Das Ergebnis gehört als Zahl in den Kommentar und
in `docs/kartenflaechen-und-zoomblenden.md`.

- [ ] **Schritt 2: Den fehlschlagenden Test schreiben**

`js/app/__tests__/labelpane-parallelblende.test.js`:

```js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Aus der Wurzel des Repos:  node js/app/__tests__/labelpane-parallelblende.test.js
const roh = fs.readFileSync(path.join(__dirname, "../bootstrap.js"), "utf8");
// 💣 Kommentare ZUERST strippen -- sonst schlaegt der Test an der Warnung an, die vor dem Muster warnt.
const quelle = roh.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// 🔴 Die Dauer stand hier FEST und hatte als einzige der drei Schrift-Ebenen keinen Parameter
// (docs/kartenflaechen-und-zoomblenden.md §7). Jetzt kommt sie aus der gemeinsamen Quelle.
assert.ok(!/const\s+DAUER_MS\s*=\s*350/.test(quelle),
	"Die eigene 350 steht noch da -- sie ist die vierte Kurve, die es nicht mehr geben soll.");
assert.ok(/AVESMAPS_ZOOM_DAUER_MS/.test(quelle),
	"Der Pane-Klon liest die gemeinsame Dauer nicht.");
assert.ok(/AVESMAPS_ZOOM_KURVE/.test(quelle),
	"Der Pane-Klon liest die gemeinsame Kurve nicht.");

// 💣 Das harte Netz bleibt: feuert requestAnimationFrame nie, stuende der Klon fuer immer -- und
// auf der Karte stuende doppelte Schrift.
assert.ok(/setTimeout\([\s\S]{0,160}?2000\)/.test(quelle),
	"💣 Das 2-Sekunden-Netz gegen den haengenden Klon fehlt.");
assert.ok(quelle.indexOf("klonWeg()") < quelle.indexOf("cloneNode"),
	"💣 Immer nur EIN Klon -- jeder zoomanim raeumt zuerst den vorigen weg.");

// 💣 Die Konstanten stehen in js/map-features/zoom-uebergang.js und werden nicht gehoistet --
// das Skript muss VOR bootstrap.js geladen werden, sonst steht dort undefined.
const html = fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8");
assert.ok(html.indexOf("js/map-features/zoom-uebergang.js") < html.indexOf("js/app/bootstrap.js"),
	"💣 zoom-uebergang.js wird nach bootstrap.js geladen -- der Klon bekaeme 'opacity undefinedms'.");

// Die zwei alten CSS-Kurven sind weg.
const css = fs.readFileSync(path.join(__dirname, "../../../css/features/map-labels.css"), "utf8")
	.replace(/\/\*[\s\S]*?\*\//g, "");
assert.ok(!/opacity\s+200ms\s+ease-in/.test(css), "Die alte Einblend-Kurve steht noch im CSS.");
assert.ok(!/opacity\s+100ms\s+ease-out/.test(css), "Die alte Ausblend-Kurve steht noch im CSS.");

console.log("labelpane-parallelblende.test.js: alle Zusicherungen erfuellt");
```

- [ ] **Schritt 3: Test laufen lassen, Fehlschlag bestätigen**

```bash
node js/app/__tests__/labelpane-parallelblende.test.js
```

- [ ] **Schritt 4: Die Kurven vereinheitlichen**

In `js/app/bootstrap.js:221`:

```js
	// 🔴 EINE Kurve, EINE Dauer -- aus js/map-features/zoom-uebergang.js. Hier stand bis zum
	// 26.08.2026 eine eigene 350, und sie war die einzige der drei Schrift-Ebenen ohne Parameter
	// (docs/kartenflaechen-und-zoomblenden.md §7).
	const DAUER_MS = AVESMAPS_ZOOM_DAUER_MS;
```

und in Zeile 257:

```js
				klon.style.transition = `opacity ${DAUER_MS}ms ${AVESMAPS_ZOOM_KURVE}`;
```

In `css/features/map-labels.css:255` und `:260` beide Blenden auf die Token ziehen:

```css
	transition: opacity var(--avesmaps-zoom-dauer) var(--avesmaps-zoom-kurve);
```

- [ ] **Schritt 5: Nur falls die Messung aus Schritt 1 es zulässt — Bestückung in den `zoomanim`**

Nur bei Median ≤ 60 ms: im `zoomanim`-Handler nach dem Anlegen des Klons das echte Pane für die
Zielstufe bestücken und seine Deckkraft im selben Zug auf 1 setzen, statt auf 0 zu warten; der Klon
bekommt gleichzeitig `opacity: 0`. Beide Übergänge auf der gemeinsamen Kurve.

- [ ] **Schritt 6: Test laufen lassen, grün bestätigen**

```bash
node js/app/__tests__/labelpane-parallelblende.test.js
```

- [ ] **Schritt 7: Im Browser SEHEN**

z4 ↔ z5. Prüfen: keine **doppelte Schrift** (der häufigste Fehler beim Klon), kein Aufblitzen, und
nach dem Zoom ein Pan ohne Nachziehen.

- [ ] **Schritt 8: Das GANZE Testfeld, parallel** (Befehl wie Aufgabe 1, Schritt 8), plus PHP:

```bash
find api tools \( \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "{}" >/dev/null 2>&1 || echo "ROT: {}"' > roteliste-php.txt; cat roteliste-php.txt
```

Erwartet: nur `linkcheck/link-url-test.php` (vorbestehend rot, echter DNS-Abruf).

- [ ] **Schritt 9: Commit und EINZELN live**

```bash
git add js/app/bootstrap.js css/features/map-labels.css js/app/__tests__/labelpane-parallelblende.test.js
git commit -m "ui(ortsnamen): die letzte eigene Blendendauer faellt -- eine Kurve fuer alle drei Schrift-Ebenen"
```

---

### Aufgabe 6: Die Dokumentation nachziehen

**Nicht sichtbar für den Owner.** Kein eigener Blick nötig.

**Dateien:**
- Ändern: `docs/superpowers/specs/2026-08-26-zoom-uebergang-konsistenz-design.md` (§3.1, §6.4)
- Ändern: `docs/kartenflaechen-und-zoomblenden.md` (§7, §7a, §8)
- Ändern: `AGENTS.md` §11 (Zeiger auf die neue einzige Quelle)

- [ ] **Schritt 1: Den Owner-Entscheid im Entwurf festhalten**

In §3.1 den Entscheid vom 26.08.2026 samt der Rechnung eintragen, die ihn trägt: Faktor 2,0 kostet
53 % RMS und +183 % größte Einzeländerung; das Optimum 1,61 kostet 22 % RMS **und** lässt 19 %
Sprung stehen. Ebenso den z7-Entscheid („z7 erbt z6") in §6.4.

- [ ] **Schritt 2: `docs/kartenflaechen-und-zoomblenden.md` nachziehen**

§7 (Stellschrauben) um die gemeinsame Kurve ergänzen; §8 („Die Ortsmarkierungen … springen am
zoomend zurück") als erledigt streichen und durch die Gegenrechnung ersetzen; §7a auf „gebaut"
setzen. Die gemessenen Zahlen aus Aufgabe 2 Schritt 6 und Aufgabe 5 Schritt 1 eintragen.

- [ ] **Schritt 3: Commit**

```bash
git add docs/kartenflaechen-und-zoomblenden.md docs/superpowers/specs/2026-08-26-zoom-uebergang-konsistenz-design.md AGENTS.md
git commit -m "docs(zoom): eine Kurve, eine Dauer, und warum die Zoombaender dafuer nicht angefasst wurden"
```

---

## Was dieser Plan bewusst NICHT tut

- 🔧 **Die Grenzlinien-BREITE bleibt der eine ungelöste Amplituden-Ausreißer** (Entwurf §3: außen
  3 px auf z4, 4 px auf z5 — echter Faktor 1,333, also −33 % Sprung beim Landen). Sie ist
  **Geometrie und darf deshalb nicht blenden** (Owner-Entscheid, `kartenflaechen-und-zoomblenden.md`
  §1: „nur labels sollen ein- und ausblenden"), also greift die Lösung der Aufgaben 3 und 4 hier
  nicht. Und die Gegenrechnung aus Aufgabe 2 greift auch nicht: sie lebt davon, dass ein Neuzeichnen
  billig ist, und der Grenzen-Canvas kostet gemessen **52–99 ms** je `redraw()` — Bild für Bild
  unbezahlbar. Denkbar wäre eine Treppe mit wenigen Stufen; das ist ungemessen und ungebaut.
  **Offene Frage an den Owner**, sichtbar als: die Außengrenzen sind am Ende der Zoombewegung kurz
  ein Drittel zu dick und dünnen dann aus.
- 🔧 **Die Kachel-Einblendung (200 ms linear)** bleibt. Sie läuft als rAF-Schleife in Leaflet
  (`Math.min(1, (now − tile.loaded) / 200)`), nicht als CSS — sie auf die gemeinsame Kurve zu
  bringen hieße, Fremdcode zu patchen. Betrifft nur **neu nachgeladene** Kacheln, nicht den
  Zoomschritt selbst.
- 🔧 **Die 836 ms Blockade in der politischen Ansicht** (Entwurf §8) bleibt unerklärt. Sie wird durch
  diesen Umbau kleiner (die Beschriftung wird vorgezogen), aber nicht beseitigt.
- 🔧 **Vier Canvas-Ebenen ohne Blende** (Schraffur, Höhenmodell, Fluss- und Tempopfeile) bekommen in
  Aufgabe 1 die gemeinsame Kurve, aber keine Blende — sie zeichneten in den geprüften Ansichten
  0 Pixel.
- 🔴 **Die Zoombänder werden nicht angefasst.** Owner-Entscheid; die Rechnung dazu steht in
  Aufgabe 2, Schritt 3.
