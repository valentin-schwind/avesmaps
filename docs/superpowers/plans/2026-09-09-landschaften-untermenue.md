# Die Landschafts-Ebenen wandern in den Kartenfächer — Bauplan

> **Für agentische Arbeiter:** ERFORDERLICHE SUB-SKILL: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, Aufgabe für Aufgabe. Schritte tragen
> `- [ ]`-Kästchen.

**Ziel:** Die fünf Landschafts-Ebenen werden zum Untermenü von „Landschaften" im Kartenfächer; die
drei Untergründe rücken dort eine Etage tiefer und gehören nur noch dem Editor. Dazu ein Wasserton
für Flusslinie, Bach und Seefläche.

**Bauform:** Die zweite Stufe des Fächers steckt heute als eine fest verdrahtete Instanz in
`start()`. Sie wird zu einem Bauteil, das **zweimal** montiert wird (Stufe 2 und Stufe 3) — der
Rest ist Konfiguration. Der Ebenenzustand bleibt die Reiterleiste; der Fächer klickt sie an,
statt einen zweiten Zustand anzulegen.

**Werkzeug:** Vanilla JS ohne Bauschritt, Leaflet 1.9.4, Node-Tests mit `assert` gegen den
Quelltext und gegen ausgeführte Funktionen. Keine neuen Abhängigkeiten.

**Entwurf:** `docs/superpowers/specs/2026-09-09-landschaften-untermenue-design.md` — der Plan
argumentiert aus ihm, beide werden zusammen gelesen.

## Globale Vorgaben

- **Kommentare, Commit-Nachrichten und Doku auf DEUTSCH** (AGENTS.md §8), passend zur Datei, in der
  du stehst.
- **Nie `git add -A`.** Der Checkout ist geteilt; nur eigene Pfade einzeln stagen. Vor dem Push
  `gh run list --limit 3` lesen (ein `pending` heißt warten).
- **Kein `?v=` von Hand.** Der Deploy stempelt.
- **Farbe/Radius/Trenner nur aus `css/base/tokens.css`** (AGENTS.md §12).
- **Vor jedem Push das GANZE Testfeld**, mit dem Muster des Workflows, parallel:
  `find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"' > roteliste`
  — **kein `2>&1` auf die Ergebnisdatei**, und die Klammer um BEIDE Gruppen ist tragend.
- **Ein neuer Test zählt erst als Beleg, wenn er gegen Mutationen gefahren wurde.** Jede Aufgabe
  nennt ihre Mutationen. Nach jeder Mutation die Byte-Gegenprobe: die Datei muss wirklich wieder im
  Ausgangszustand sein.
- **Sichtbare Änderungen gehen EINZELN live.** Dieser Plan hat vier Push-Punkte: nach Aufgabe 1
  (Wasserton), nach Aufgabe 2 (Anzeigeprofil), nach Aufgabe 3 (nur das Mockup) und nach Aufgabe 8
  (der Fächer als Ganzes). Dazwischen wird committet, **nicht gepusht** — die Aufgaben 4–7 bauen
  EIN Menü, und ein halb gebautes Menü ist kaputt.
- **Der Wasserton ist `#4c89c6`.** Meer `#2d5f8a`, Küste `#3f9e9a`, Seeweg `#2f7dd3` bleiben.

---

## Dateiplan

| Datei | Verantwortung | Aufgabe |
|---|---|---|
| `css/base/tokens.css` | `--color-water`, Seeton liest ihn | 1 |
| `js/map-features/map-features.js` | Flusslinie (`centerColors.Flussweg`) | 1 |
| `js/map-features/map-features-river-flow-arrows.js` | Strömungspfeile | 1 |
| `js/pages/svg-export-build.js` | `SVGX_WAY_COLORS` (Rückfall folgt der Karte) | 1 |
| `js/pages/svg-export-farben.js` | Kommentar richtigstellen | 1 |
| **neu** `js/map-features/__tests__/wasserton.test.js` | vier Schreibstellen gegen den Token | 1 |
| `js/ui/map-layer-picker.js` | `OVERLAYS` um vier Vektoren; `macheStufe`; Stufe 2 pro Ansicht; Stufe 3 | 3–7 |
| `tools/bau-ansicht-untergrund-mockup.js` | Quelle des Mockups | 3, 7, 8 |
| `docs/ansicht-untergrund-mockup.html` | **Build-Produkt**, nur erzeugt | 3, 7, 8 |
| **neu** `tools/__tests__/ansicht-untergrund-mockup.test.js` | Mockup == Generatorausgabe | 3 |
| `css/components/map-layer-picker.css` | Staffelung auf 5 Zellen, Stufe-3-Regeln | 5, 7 |
| **neu** `js/ui/__tests__/landschaften-untermenue.test.js` | Ebenenzustand, drei Stufen | 5–7 |
| `js/ui/__tests__/map-layer-picker.test.js` | erweitert | 4–7 |
| `js/map-features/map-features-ecosystem-layer-switch.js` | ein Profil, Soll, Merker, die drei Appliers; später Leiste verstecken | 2, 8 |
| **neu** `js/map-features/__tests__/anzeigewahl-schlaegt-vorgabe.test.js` | Vorgabe vs. Nutzerwahl, ausgeführt | 2 |
| `js/map-features/__tests__/ecosystem-frontend-profil.test.js` | erweitert | 2, 8 |
| `js/map-features/__tests__/ecosystem-access.test.js` | nachgezogen (stand auf dem alten Profil-Tisch) | 2 |
| `js/review/__tests__/garetien-import-sicht.test.js` | nachgezogen (nagelt das Ausleihen fest) | 2 |
| `AGENTS.md` | §11-Eintrag „Der Kartenfächer" nachziehen | 7 |

---

## Aufgabe 1: Ein Wasserton für Fluss, Bach und See

**Dateien:**
- Ändern: `css/base/tokens.css:449-461`
- Ändern: `js/map-features/map-features.js:402`
- Ändern: `js/map-features/map-features-river-flow-arrows.js:100-102`
- Ändern: `js/pages/svg-export-build.js:95,98`
- Ändern: `js/pages/svg-export-farben.js:24-27` (nur Kommentar)
- Ändern: `js/pages/__tests__/svg-export-build.test.js:175`
- Ändern: `js/pages/__tests__/svg-export-farben.test.js:42` (Kommentar + ggf. Zusicherung)
- Test: **neu** `js/map-features/__tests__/wasserton.test.js`

**Schnittstellen:**
- Liefert: den Token `--color-water` in `css/base/tokens.css`. Jede spätere Aufgabe, die Wasser
  färbt (Aufgabe 3, der Topographie-Vektor), liest **diesen** Wert, nie `#6ec6ff`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`js/map-features/__tests__/wasserton.test.js`:

```js
// Ein Wasserton für Flusslinie, Bach und Seefläche (Owner 09.09.2026).
//
// 🔴 DER TOKEN IST DIE WAHRHEIT. Vier Stellen tragen den Wert hartkodiert -- die Wegfarben der
// Karte lesen kein CSS, und der SVG-Bauer hat gar kein DOM. Dieser Test ist der Ersatz für den
// Kommentar, der die Kopplung bisher beschrieben hat; ein Kommentar hat noch nie einen Wert
// nachgezogen.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/map-features/__tests__/wasserton.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(ROOT, ...teile), "utf8");

// 💣 Die Prosa dieser Dateien nennt genau die Farbwerte, nach denen gesucht wird -- ein Treffer im
// Kommentar ist kein Beleg, sondern die haeufigste Art, einen gruenen Test zu bauen, der nichts
// haelt.
function ohneKommentare(quelle) {
	return quelle.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const tokens = ohneKommentare(lies("css", "base", "tokens.css"));

const treffer = tokens.match(/--color-water:\s*(#[0-9a-fA-F]{6})\s*;/);
assert.ok(treffer, "--color-water steht in css/base/tokens.css");
const WASSER = treffer[1].toLowerCase();
assert.strictEqual(WASSER, "#4c89c6",
	"der Wasserton ist der des SVG-Abzugs (Owner 09.09.2026). Wer ihn aendert, aendert eine"
	+ " Owner-Entscheidung, keine Geschmacksfrage.");

// ---- 1. Die Seeflaeche liest den Token, statt ihn abzuschreiben ---------------------------------
assert.ok(/--color-ecosystem-topographie-see:\s*var\(--color-water\)/.test(tokens),
	"die Seeflaeche liest --color-water per var(), sie schreibt ihn NICHT ab -- sonst gibt es"
	+ " wieder zwei Werte, die auseinanderlaufen koennen.");

// ---- 2. Das Meer bleibt anders -------------------------------------------------------------------
// 🔴 Owner 09.09.2026, ausdruecklich: „achte darauf dass meere noch anders sind".
const meer = tokens.match(/--color-ecosystem-topographie-meer:\s*([^;]+);/);
assert.ok(meer, "das Meer hat weiterhin einen eigenen Token");
assert.strictEqual(meer[1].trim().toLowerCase(), "#2d5f8a",
	"das Meer behaelt sein dunkles Blau und wird NICHT auf den Wasserton gezogen.");
const kueste = tokens.match(/--color-ecosystem-topographie-kueste:\s*([^;]+);/);
assert.strictEqual(kueste[1].trim().toLowerCase(), "#3f9e9a", "die Kueste behaelt ihr Tuerkis.");

// ---- 3. Die vier hartkodierten Schreibstellen ---------------------------------------------------
const stellen = [
	{
		datei: ["js", "map-features", "map-features.js"],
		muster: (w) => new RegExp("Flussweg:\\s*\"" + w + "\""),
		was: "die Flusslinie der Karte (getPathStyleColors, centerColors.Flussweg)",
	},
	{
		datei: ["js", "map-features", "map-features-river-flow-arrows.js"],
		muster: (w) => new RegExp("fillStyle\\s*=\\s*\"" + w + "\""),
		was: "die Stroemungspfeile -- sie sind Teil des Flusses, nicht etwas darauf",
	},
	{
		datei: ["js", "pages", "svg-export-build.js"],
		muster: (w) => new RegExp("Flussweg:\\s*\"" + w + "\""),
		was: "SVGX_WAY_COLORS im SVG-Bauer, der Rueckfall -- er folgt der Karte",
	},
	{
		datei: ["js", "ui", "map-layer-picker.js"],
		muster: (w) => new RegExp("fill=\\\\?\"" + w + "\\\\?\""),
		was: "das Wasser im Landschafts-Vektor des Kartenfaechers",
	},
];

stellen.forEach((stelle) => {
	const quelle = ohneKommentare(lies(...stelle.datei));
	assert.ok(stelle.muster(WASSER).test(quelle),
		stelle.datei.join("/") + " traegt den Wasserton: " + stelle.was);
	assert.ok(!/#6ec6ff/i.test(quelle),
		stelle.datei.join("/") + " traegt den ALTEN Ton #6ec6ff nirgends mehr -- er war die"
		+ " Haelfte eines Paars, dessen andere Haelfte in tokens.css steht.");
});

// ---- 4. Der Bach faehrt mit ----------------------------------------------------------------------
// Ein Bach ist ein Flussweg mit Haekchen: unterschieden wird er ueber die BREITE, nie ueber die
// Farbe. Auf der Karte faellt das von selbst an (derselbe Subtyp); im SVG-Bauer steht er als
// eigene Zeile und muss mitgezogen werden.
const svgBauer = ohneKommentare(lies("js", "pages", "svg-export-build.js"));
assert.ok(new RegExp("Bach:\\s*\"" + WASSER + "\"").test(svgBauer),
	"der Bach traegt denselben Ton -- zwei Blautoene nebeneinander laesen sich als zwei"
	+ " Gewaesserarten.");
assert.ok(/Seeweg:\s*"#2f7dd3"/.test(svgBauer),
	"der Seeweg NICHT -- er ist eine Schiffsroute, kein Fluss.");

console.log("wasserton.test.js: alle Zusicherungen gruen");
```

- [ ] **Schritt 2: Test fahren, Fehlschlag sehen**

Ausführen: `node js/map-features/__tests__/wasserton.test.js`
Erwartet: FAIL — „--color-water steht in css/base/tokens.css".

- [ ] **Schritt 3: Den Token anlegen und die Seefläche darauf ziehen**

In `css/base/tokens.css`, im hellen `:root`-Block **vor** dem Landschafts-Abschnitt:

```css
	/* 🔴 EIN GEWAESSER, EIN TON (Owner 09.09.2026). Ihn tragen genau drei Dinge: die Flusslinie,
	   der Bach und die Seeflaeche -- ein See ist derselbe Wasserkoerper wie der Fluss, der
	   hineinlaeuft. Der Wert ist der des SVG-Abzugs (js/pages/svg-export-farben.js), damit Karte
	   und Abzug endlich dasselbe Blau fuehren.
	   💣 DAS MEER GEHOERT NICHT DAZU und behaelt --color-ecosystem-topographie-meer, die Kueste ihr
	   Tuerkis, der Seeweg sein #2f7dd3 (Owner ausdruecklich: „achte darauf dass meere noch anders
	   sind"). Das einzige ["see","meer","kueste","flussdelta"] im Haus steht in svg-export-build.js
	   und regelt die ZEICHENREIHENFOLGE, nicht die Farbe -- wer die vier je zu einem Ton
	   zusammenzieht, faerbt das Meer mit.
	   💣 DREI STELLEN AUSSERHALB DIESER DATEI TRAGEN DEN WERT HARTKODIERT: die Wegfarben der Karte
	   lesen kein CSS, und der SVG-Bauer hat kein DOM. Gehalten werden sie von
	   js/map-features/__tests__/wasserton.test.js -- nicht von diesem Kommentar. */
	--color-water: #4c89c6;
```

Und die Seezeile (ersetzt `--color-ecosystem-topographie-see: #6ec6ff;`):

```css
	--color-ecosystem-topographie-see: var(--color-water); /* lake -- the river's blue, see above */
```

Den Absatz darüber (ab „🔴 DER SEE TRAEGT DIE FARBE DES FLUSSES") auf den neuen Stand bringen:
der gemessene Wert `rgb(110,198,255)` stimmt nicht mehr, und die Zusage „die zwei Werte sind ein
Paar, und der andere steht nicht in dieser Datei" ist durch den Token abgelöst. Der ⚠️-Satz zur
Deckkraft bleibt wörtlich — er gilt unverändert.

- [ ] **Schritt 4: Die drei Karten-/Bauer-Stellen nachziehen**

`js/map-features/map-features.js:402` — `Flussweg: "#6ec6ff",` wird:

```js
		// 🔴 Der Wasserton, EINE Farbe fuer Flusslinie, Bach und Seeflaeche (Owner 09.09.2026).
		// Die Wahrheit ist --color-water in css/base/tokens.css; hier steht sie hartkodiert, weil
		// diese Tabelle je Weg und je Neuzeichnen gelesen wird und getComputedStyle dafuer zu
		// teuer ist. Gehalten von js/map-features/__tests__/wasserton.test.js.
		Flussweg: "#4c89c6",
```

`js/map-features/map-features-river-flow-arrows.js:102` — den Kommentar darüber mitziehen:

```js
			// Der Wasserton (--color-water, siehe getPathStyleColors centerColors.Flussweg) mit
			// weisser Kontur, damit die Pfeile als Teil des Flusses lesen statt darauf zu schweben.
			ctx.fillStyle = "#4c89c6";
```

`js/pages/svg-export-build.js:95,98` — beide auf `"#4c89c6"`; der Kommentar über `Bach` bleibt
wörtlich, er stimmt weiterhin.

- [ ] **Schritt 5: Den Landschafts-Vektor des Fächers nachziehen**

`js/ui/map-layer-picker.js`: in `OVERLAYS.ecosystem` `'<g fill="#6ec6ff" fill-opacity=".85">'` →
`'<g fill="#4c89c6" fill-opacity=".85">'`, und in der Farbliste im Kommentar darüber die Zeile
`See … #6ec6ff (= die Flussfarbe, Owner 07.09.2026)` → `See --color-water #4c89c6 (= die
Flussfarbe, Owner 09.09.2026)`. Dasselbe in `tools/bau-ansicht-untergrund-mockup.js` (Zwilling,
Zeile ~181 und ~199).

- [ ] **Schritt 6: Test fahren, grün sehen**

Ausführen: `node js/map-features/__tests__/wasserton.test.js`
Erwartet: PASS.

- [ ] **Schritt 7: Die zwei fremden Tests nachziehen, die auf dem alten Wert stehen**

`js/pages/__tests__/svg-export-build.test.js:175` trägt `Flussweg: "#6ec6ff", Bach: "#6ec6ff"` als
erwartete Kartenfarben — auf `#4c89c6`.

`js/pages/__tests__/svg-export-farben.test.js:42` erklärt, der Rückfall sei „heute zufaellig ein
anderes Blau (#6ec6ff, der Kartenton)". Das stimmt nicht mehr: Karte und Vorgabe führen denselben
Wert. Der Kommentar wird richtiggestellt; **beruht dort eine Zusicherung darauf, dass die beiden
verschieden sind, wird sie umgeschrieben, nicht gelöscht** — sie soll weiter belegen, dass die
Vorgabe den Rückfall SCHLÄGT, unabhängig davon, ob die Werte zufällig gleich sind. Denselben
Kommentar in `js/pages/svg-export-farben.js:24-27` nachziehen (dort steht „nicht das hellere
#6ec6ff der Karte" — die Karte ist nicht mehr heller).

- [ ] **Schritt 8: Gegen Mutationen fahren**

Je Mutation: ändern, `node js/map-features/__tests__/wasserton.test.js`, ROT erwarten,
zurückschreiben, **Byte-Gegenprobe** (`git diff --stat` muss leer sein).

1. `--color-water: #4c89c6` → `#4c89c7` (Schritt „der Ton ist der des SVG-Abzugs" fängt).
2. `--color-ecosystem-topographie-see: var(--color-water)` → `#4c89c6` (Abschrift statt `var()`).
3. `--color-ecosystem-topographie-meer` → `var(--color-water)` (die Owner-Zusage).
4. In `map-features.js` `Flussweg: "#4c89c6"` → `"#6ec6ff"`.
5. In `svg-export-build.js` `Bach:` → `"#6ec6ff"`.
6. In `svg-export-build.js` `Seeweg: "#2f7dd3"` → `"#4c89c6"`.

Fängt eine Mutation nicht, ist die Zusicherung Vakuum und wird geschärft.

- [ ] **Schritt 9: Ganzes Testfeld, dann commit + push**

```bash
node js/map-features/__tests__/wasserton.test.js && node js/pages/__tests__/svg-export-build.test.js && node js/pages/__tests__/svg-export-farben.test.js && node js/ui/__tests__/map-layer-picker.test.js
```

Dann das volle Feld (siehe Globale Vorgaben), dann:

```bash
git add css/base/tokens.css js/map-features/map-features.js js/map-features/map-features-river-flow-arrows.js js/pages/svg-export-build.js js/pages/svg-export-farben.js js/ui/map-layer-picker.js tools/bau-ansicht-untergrund-mockup.js js/map-features/__tests__/wasserton.test.js js/pages/__tests__/svg-export-build.test.js js/pages/__tests__/svg-export-farben.test.js
git commit -F <nachricht.txt>
```

Nachricht (Betreff nennt die sichtbare Wirkung): `ui(karte): Fluss, Bach und See tragen einen
Wasserton -- das Meer bleibt anders`.

Vor dem Push `gh run list --limit 3`. **Danach: Owner-Blick** — das ist eine sichtbare Änderung für
jeden Besucher der Standardansicht. Erst weiter, wenn er sie gesehen hat.

---

## Aufgabe 2: Ein Anzeigeprofil — alles an, und die Wahl des Nutzers schlägt es

**Dateien:**
- Ändern: `js/map-features/map-features-ecosystem-layer-switch.js` (Profil, Soll, Merker,
  die drei Appliers)
- Test: **neu** `js/map-features/__tests__/anzeigewahl-schlaegt-vorgabe.test.js`
- Test: `js/map-features/__tests__/ecosystem-frontend-profil.test.js` (erweitert)

**Schnittstellen:**
- Liefert: `ecosystemAnzeigeSoll()` → `{orte: {…6 Klassen…}, wege, labels, grenzen, fluesse,
  untergrund}` oder `null`. Aufgabe 8 liest daraus nur noch `untergrund`.

🔴 **Diese Aufgabe ist vom Fächer völlig unabhängig** und geht für sich live. Sie ist auch die
sichtbarste des ganzen Umbaus: die vier ruhigen Ebenen bekommen zum ersten Mal Orte, Wege, Labels,
Grenzen und Gewässer.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`js/map-features/__tests__/anzeigewahl-schlaegt-vorgabe.test.js` — das Modul wird **ausgeführt**,
nicht gelesen. 🪤 Attrappen **ohne Proxy**: ein Proxy, der jeden Bezeichner beantwortet, verschluckt
genau den Fehler, den dieser Test finden soll (die Lehre vom 03.09.2026, zwei Stunden ohne
Beschriftungen auf der Live-Karte).

```js
// „Alles an in den Landschaften -- ausser der Nutzer will es anders" (Owner 09.09.2026).
//
//   node js/map-features/__tests__/anzeigewahl-schlaegt-vorgabe.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..", "..");
const quelle = fs.readFileSync(
	path.join(ROOT, "js/map-features/map-features-ecosystem-layer-switch.js"), "utf8");

const ORTSKLASSEN = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"];
const HAKEN_IDS = ["togglePaths", "toggleMapLabels", "toggleTerritoryBorders", "toggleRivers"];

/** Eine Welt, in der das Modul wirklich laeuft -- Attrappen mit genau den Namen, die es ruft. */
function welt({ editor = false, ebene = "vegetation", drin = true } = {}) {
	const haken = {};
	const zuhoerer = {};
	HAKEN_IDS.forEach((id) => {
		haken[id] = {
			id, checked: false, _hoerer: [],
			addEventListener(art, fn) { if (art === "change") { this._hoerer.push(fn); } },
			dispatchEvent(ereignis) { this._hoerer.forEach((fn) => fn(ereignis)); return true; }
		};
	});
	const klassen = {};
	ORTSKLASSEN.forEach((typ) => { klassen[typ] = false; });

	const kontext = {
		console,
		document: {
			getElementById: (id) => haken[id] || null,
			addEventListener: (art, fn) => { (zuhoerer[art] = zuhoerer[art] || []).push(fn); },
			querySelector: () => null,
			documentElement: {}
		},
		window: { localStorage: { getItem: () => null, setItem: () => {} } },
		Event: function (art, o) { this.type = art; this.bubbles = Boolean(o && o.bubbles); this.isTrusted = false; },
		LOCATION_TYPE_VISIBILITY_ORDER: ORTSKLASSEN,
		getLocationToggleButton: (typ) => ({
			hasClass: () => klassen[typ] === true,
			removeClass: () => { klassen[typ] = false; },
			toggleClass: (_k, an) => { klassen[typ] = an === true; }
		}),
		syncLocationMarkerVisibility: () => {},
		syncLocationToggleButtons: () => {},
		syncPathVisibility: () => {},
		isEcosystemLayerModeActive: () => drin,
		canOperateEcosystemLayers: () => editor,
		isEcosystemShowAllLayers: () => ebene === "alle",
		getActiveEcosystemLayerKind: () => ebene,
		map: null, baseTileLayer: null
	};
	kontext.globalThis = kontext;
	vm.createContext(kontext);
	vm.runInContext(quelle, kontext);
	return { kontext, haken, klassen, zuhoerer };
}

// ---- 1. Ein Profil, und es steht auf ALLES AN ----------------------------------------------------
const besucher = welt();
const soll = besucher.kontext.ecosystemAnzeigeSoll();
assert.ok(soll, "der Besucher bekommt ein Soll");
assert.strictEqual(soll.wege, true, "Wege an");
assert.strictEqual(soll.labels, true, "Labels an");
assert.strictEqual(soll.grenzen, true, "Grenzen an");
assert.strictEqual(soll.fluesse, true, "Fluesse und Seen an");
assert.strictEqual(soll.untergrund, 0, "Untergrund aus");
ORTSKLASSEN.forEach((typ) => {
	assert.strictEqual(soll.orte[typ], true, "Ortsklasse " + typ + " an -- bis hinunter zu"
		+ " „Besondere Bauwerke/Staetten" (gebaeude), das ist die letzte der sechs.");
});

// ---- 2. Und zwar in JEDER Ebene -- die „ruhige Zeichenflaeche" ist gefallen -----------------------
["alle", "derographisch", "vegetation", "topographie", "klima"].forEach((ebene) => {
	const s = welt({ ebene }).kontext.ecosystemAnzeigeSoll();
	assert.strictEqual(s.wege, true, "auch in " + ebene + " sind die Wege an");
	assert.strictEqual(s.untergrund, 0, "und der Untergrund aus");
});

// ---- 3. Der Editor bekommt KEIN Profil -----------------------------------------------------------
assert.strictEqual(welt({ editor: true }).kontext.ecosystemAnzeigeSoll(), null,
	"der Editor behaelt seine leere Zeichenflaeche und seine Haken (Owner 09.09.2026)");
assert.strictEqual(welt({ drin: false }).kontext.ecosystemAnzeigeSoll(), null,
	"und ausserhalb der Landschaften wird gar nichts angefasst");

// ---- 4. DIE TRAGENDE ZUSICHERUNG: unser eigenes Setzen ist KEINE Nutzerwahl -----------------------
// 💣 Ohne sie schreibt das Anwenden der Vorgabe die Vorgabe als „Wahl" fest, und das Profil ist fuer
// den Rest des Besuchs wirkungslos -- waehrend die Karte genau das zeigt, was die Vorgabe wollte.
{
	const w = welt();
	w.kontext.syncEcosystemFrontendFeatures();
	assert.strictEqual(w.kontext.ecosystemAnzeigeWahlGesetzt(), false,
		"nach dem Anwenden der Vorgabe gibt es KEINE Nutzerwahl -- unsere eigenen Ereignisse"
		+ " tragen isTrusted === false.");
}

// ---- 5. Eine echte Hand schon -- und sie schlaegt die Vorgabe ------------------------------------
{
	const w = welt();
	w.kontext.syncEcosystemFrontendFeatures();
	assert.strictEqual(w.haken.togglePaths.checked, true, "die Vorgabe hat die Wege angeschaltet");
	w.haken.togglePaths.checked = false;
	w.haken.togglePaths.dispatchEvent({ type: "change", isTrusted: true });
	assert.strictEqual(w.kontext.ecosystemAnzeigeWahlGesetzt(), true, "jetzt gibt es eine Wahl");
	assert.strictEqual(w.kontext.ecosystemAnzeigeSoll().wege, false, "und sie sagt: Wege aus");

	// ...und ein Ebenenwechsel macht sie NICHT platt. Er wendet das Soll erneut an -- das IST
	// seine Wahl, also ein Leerlauf.
	w.kontext.syncEcosystemFrontendFeatures();
	assert.strictEqual(w.haken.togglePaths.checked, false,
		"der Ebenenwechsel laesst die Wege aus -- genau das war der Auftrag");
}

console.log("anzeigewahl-schlaegt-vorgabe.test.js: alle Zusicherungen gruen");
```

⚠️ `ecosystemAnzeigeWahlGesetzt()` ist ein winziger Leser (`() => ecosystemAnzeigeWahl !== null`),
den das Modul nach `globalThis` gibt — **nicht** die Wahl selbst: ein Test, der den Merker direkt
setzen könnte, prüft den Weg nicht mehr, der ihn setzen soll.

- [ ] **Schritt 2: Test fahren, Fehlschlag sehen**

Ausführen: `node js/map-features/__tests__/anzeigewahl-schlaegt-vorgabe.test.js`
Erwartet: FAIL — `ecosystemAnzeigeSoll is not a function`.

⚠️ Läuft das Modul im `vm`-Kontext gar nicht erst durch (fehlender globaler Name), **fehlt eine
Attrappe** — sie wird ergänzt, und zwar mit dem echten Namen. Keine Proxy-Abkürzung.

- [ ] **Schritt 3: Der Tisch fällt, ein Profil bleibt**

Ersetzt `ECOSYSTEM_FRONTEND_PROFILE_RUHIG`, `ECOSYSTEM_FRONTEND_PROFILES` und `ECOSYSTEM_RIVER_KINDS`:

```js
// ---- Das Anzeigeprofil der Landschaften (Owner 09.09.2026) ----------------------------------------
//
// 🔴 EIN PROFIL FUER ALLE FUENF EBENEN. Owner: „auch die sollen in allen landschaftsansichten
// default aktiviert und sichtbar sein". Damit faellt die „ruhige Zeichenflaeche", die vier der fuenf
// Ebenen seit dem 05.08.2026 waren, und mit ihr DREI Tabellen: ECOSYSTEM_FRONTEND_PROFILES,
// ECOSYSTEM_FRONTEND_PROFILE_RUHIG und ECOSYSTEM_RIVER_KINDS. Sie beantworteten alle dieselbe Frage
// („was zeigt DIESE Ebene"), und die gibt es nicht mehr.
// 💣 Eine Tabelle mit fuenf gleichen Zeilen waere schlimmer als keine: sie liest sich wie eine
// getroffene Entscheidung und laedt zum Differenzieren ein, das hier ausdruecklich nicht gewollt ist.
//
// 🔴 NUR DER BESUCHER. Der Editor bekommt weiterhin GAR KEIN Profil -- er hat seine Haken und seinen
// Untergrund-Regler gleich daneben, und ein Profil legte sich ueber seine eigene Wahl.
const ECOSYSTEM_FRONTEND_PROFIL = Object.freeze({
	orte: true, wege: true, labels: true, grenzen: true, fluesse: true, untergrund: 0,
});

function ecosystemFrontendProfile() {
	if (typeof isEcosystemLayerModeActive !== "function" || !isEcosystemLayerModeActive()) {
		return null;
	}
	if (canOperateEcosystemLayers()) {
		return null;
	}
	return ECOSYSTEM_FRONTEND_PROFIL;
}
```

- [ ] **Schritt 4: Soll, Leser und Merker**

```js
// Die zehn Schalter, um die es geht: die vier Zeilen der Gruppe „Ebenen" im Anzeige-Menue und die
// sechs Ortsklassen. 🔴 Die Ortsklassen kommen aus LOCATION_TYPE_VISIBILITY_ORDER, nie abgeschrieben
// -- die letzte heisst `gebaeude` und traegt im Menue die Beschriftung „Besondere Bauwerke/Staetten".
const ECOSYSTEM_ANZEIGE_HAKEN = Object.freeze({
	wege: "togglePaths",
	labels: "toggleMapLabels",
	grenzen: "toggleTerritoryBorders",
	fluesse: "toggleRivers",
});

// Die Lage, die der Besucher INNERHALB der Landschaften selbst hergestellt hat. `null` = er hat noch
// keine getroffen.
// 🔴 SIE GILT FUER DEN GANZEN BESUCH (Owner 09.09.2026) -- ueber Ebenenwechsel UND ueber das
// Verlassen und Wiederbetreten der Landschaften hinweg. Kein localStorage: ein Neuladen faengt
// wieder mit der Vorgabe an, sonst bekaeme jemand, der einmal etwas abschaltet, es nie wieder zu
// sehen, ohne es selbst zu suchen.
// 💣 SIE IST NICHT DAS AUSLEIH-GEDAECHTNIS. ecosystemSettlementMemory und ecosystemRiverMemory
// beantworten „was hatte er VOR den Landschaften" und geben es beim Verlassen zurueck; diese hier
// beantwortet „was will er IN den Landschaften". Zwei Fragen, zwei Merker -- zusammengelegt faellt
// eine von beiden Antworten weg.
let ecosystemAnzeigeWahl = null;

function ecosystemAnzeigeLesen() {
	const stand = { orte: {}, untergrund: 0 };
	Object.keys(ECOSYSTEM_ANZEIGE_HAKEN).forEach((feld) => {
		const haken = document.getElementById(ECOSYSTEM_ANZEIGE_HAKEN[feld]);
		stand[feld] = Boolean(haken && haken.checked);
	});
	LOCATION_TYPE_VISIBILITY_ORDER.forEach((typ) => {
		stand.orte[typ] = getLocationToggleButton(typ).hasClass("is-active") === true;
	});
	return stand;
}

/**
 * Was JETZT gelten soll: die Wahl des Besuchers, sobald er eine getroffen hat -- sonst die Vorgabe.
 *
 * ⭐ Und genau deshalb braucht es kein „nur beim Betreten anwenden". Die Appliers haengen an
 * syncEcosystemPaneStates und laufen bei jedem Ebenenwechsel; frueher haetten sie damit die Wahl
 * des Nutzers plattgemacht. Jetzt schreiben sie SEINE Lage zurueck -- ein Leerlauf, denn jeder
 * Applier steigt bei `checked === soll` aus, ohne ein Ereignis zu feuern.
 */
function ecosystemAnzeigeSoll() {
	const profil = ecosystemFrontendProfile();
	if (!profil) {
		return null;
	}
	if (ecosystemAnzeigeWahl) {
		return ecosystemAnzeigeWahl;
	}
	// Die Vorgabe in DIE Form bringen, in der auch die Nutzerwahl steht -- eine Form, ein Leser.
	const orte = {};
	LOCATION_TYPE_VISIBILITY_ORDER.forEach((typ) => { orte[typ] = profil.orte === true; });
	return {
		orte, wege: profil.wege, labels: profil.labels, grenzen: profil.grenzen,
		fluesse: profil.fluesse, untergrund: profil.untergrund
	};
}

/** Nur fuer den Test: gibt es eine Wahl? (Die Wahl selbst bleibt drinnen -- ein Test, der sie
 *  setzen koennte, prueft den Weg nicht mehr, der sie setzen soll.) */
function ecosystemAnzeigeWahlGesetzt() {
	return ecosystemAnzeigeWahl !== null;
}

/**
 * 💣 NUR EINE ECHTE HAND ZAEHLT. `dispatchEvent` liefert `isTrusted === false` -- und genau so setzt
 * diese Datei ihre Haken selbst (das Ereignis ist Pflicht, die Zeichner haengen daran). Ohne diese
 * Frage schriebe das Anwenden der Vorgabe die Vorgabe als „Nutzerwahl" fest; ab da waere das Profil
 * fuer den Rest des Besuchs wirkungslos, UND ES SAEHE RICHTIG AUS -- die Karte zeigt ja genau, was
 * die Vorgabe wollte. Auffallen wuerde es erst beim zweiten Betreten.
 * ⚠️ Der Zuhoerer haengt per addEventListener dran, NICHT per jQuery: nur so ist `isTrusted` das
 * native Feld und nicht das, was eine Normalisierungsschicht daraus macht.
 * ⚠️ Er haelt auch gegen die anderen programmatischen Schreiber dieser Haken (URL-Persistenz
 * ?togglePaths=0, applyFrontendLayerModeDefaults) -- die sind ebenfalls keine Hand.
 */
function ecosystemAnzeigeWahlMerken(ereignis) {
	if (!ereignis || ereignis.isTrusted !== true) {
		return;
	}
	if (typeof isEcosystemLayerModeActive !== "function" || !isEcosystemLayerModeActive()) {
		return;
	}
	if (canOperateEcosystemLayers()) {
		return;   // die Wahl gehoert dem Besucher; der Editor hat seine eigenen Haken
	}
	ecosystemAnzeigeWahl = ecosystemAnzeigeLesen();
}

function bindEcosystemAnzeigeWahl() {
	Object.keys(ECOSYSTEM_ANZEIGE_HAKEN).forEach((feld) => {
		const haken = document.getElementById(ECOSYSTEM_ANZEIGE_HAKEN[feld]);
		if (haken) {
			haken.addEventListener("change", ecosystemAnzeigeWahlMerken);
		}
	});
	// ⚠️ Die Ortsklassen sind KEINE Checkboxen, sondern jQuery-Knoepfe mit `is-active` -- ein
	// programmatisches toggleClass feuert dort ohnehin nichts. Gehorcht wird deshalb dem Klick.
	// ⚠️ Und im naechsten Takt gelesen: der eigene Handler des Knopfes setzt die Klasse erst.
	document.addEventListener("click", (ereignis) => {
		const knopf = ereignis.target && ereignis.target.closest
			? ereignis.target.closest(".location-toggle") : null;
		if (!knopf) {
			return;
		}
		const vertrauenswuerdig = ereignis.isTrusted === true;
		setTimeout(() => ecosystemAnzeigeWahlMerken({ isTrusted: vertrauenswuerdig }), 0);
	});
}
```

`bindEcosystemAnzeigeWahl()` wird dort gerufen, wo heute `bindEcosystemLayerSwitch()` steht
(`syncEcosystemControlsVisibility`) — beide sind idempotent zu halten.

- [ ] **Schritt 5: Die drei Appliers auf das Soll umstellen**

`syncEcosystemFrontendFeatures()` — liest `ecosystemAnzeigeSoll()` statt `ecosystemFrontendProfile()`
und bekommt `labels` dazu:

```js
	const soll = ecosystemAnzeigeSoll();
	if (!soll) {
		return;
	}
	const wege = ecosystemSetzeAnzeigeHaken("togglePaths", soll.wege);
	ecosystemSetzeAnzeigeHaken("toggleMapLabels", soll.labels);
	ecosystemSetzeAnzeigeHaken("toggleTerritoryBorders", soll.grenzen);
	if (wege && typeof syncPathVisibility === "function") {
		syncPathVisibility();
	}
```

`syncEcosystemSettlementVisibility(inLayer)` — bekommt den dritten Zustand „leihen **und setzen**":

```js
	// 🔴 SEIT 09.09.2026 WERDEN DIE ORTE AKTIV EINGESCHALTET, nicht nur „nicht weggenommen". Bis
	// dahin fragte diese Funktion allein, ob sie ZURUECKTRETEN sollen -- fuer „Alle" tat sie schlicht
	// nichts, und der Besucher sah dort, was er ohnehin eingestellt hatte. Fuer „default aktiviert
	// und sichtbar" (Owner) reicht das nicht.
	const soll = Boolean(inLayer) ? ecosystemAnzeigeSoll() : null;
	if (soll) {
		// Nur beim EINTRETEN merken -- diese Funktion laeuft auch mitten im Modus (etwa wenn die
		// Rechteauskunft eintrifft), und ein zweites Merken schriebe die bereits gesetzte Lage fest.
		if (ecosystemSettlementMemory === null) {
			ecosystemSettlementMemory = LOCATION_TYPE_VISIBILITY_ORDER.map(
				(typ) => getLocationToggleButton(typ).hasClass("is-active")
			);
		}
		LOCATION_TYPE_VISIBILITY_ORDER.forEach((typ) => {
			getLocationToggleButton(typ).toggleClass("is-active", soll.orte[typ] === true);
		});
	} else {
		if (ecosystemSettlementMemory === null) {
			return;   // nichts geliehen -- dann gibt es auch nichts zurueckzugeben
		}
		LOCATION_TYPE_VISIBILITY_ORDER.forEach((typ, index) => {
			getLocationToggleButton(typ).toggleClass("is-active", ecosystemSettlementMemory[index] === true);
		});
		ecosystemSettlementMemory = null;
	}
```

⚠️ Der **Editor** fällt hier jetzt in den `else`-Zweig (`ecosystemAnzeigeSoll()` gibt ihm `null`) und
bekommt damit seine Haken zurück, statt die leere Fläche zu behalten. **Das ist ein Verhaltenswechsel
und nicht bestellt** — der Editor-Zweig muss erhalten bleiben: `soll === null && inLayer && Editor`
heißt weiterhin „zurücktreten". Bau die Bedingung so, dass die drei Fälle getrennt bleiben
(Besucher-drin / Editor-drin / draußen), und belege alle drei im Test.

`syncEcosystemRiverVisibility()` — `soll` kommt aus `ecosystemAnzeigeSoll().fluesse` statt aus
`ECOSYSTEM_RIVER_KINDS`; Ausleihen und Rückgabe bleiben Wort für Wort.

`applyEcosystemUndergroundOpacity(active)` — liest `ecosystemAnzeigeSoll()?.untergrund`.

- [ ] **Schritt 6: Tests fahren**

```bash
node js/map-features/__tests__/anzeigewahl-schlaegt-vorgabe.test.js
node js/map-features/__tests__/ecosystem-frontend-profil.test.js
node js/map-features/__tests__/ecosystem-access.test.js
node js/review/__tests__/garetien-import-sicht.test.js
```

⚠️ Die letzten drei sind **fremde** Tests, die auf dem alten Profil-Tisch stehen
(`ecosystemFrontendProfile()` mit `orte: false`, das Ausleih-Gedächtnis). Sie werden **nachgezogen,
nicht gelöscht** — ihre Begründungen bleiben wörtlich stehen, nur die erwarteten Werte wandern.

- [ ] **Schritt 7: Gegen Mutationen fahren**

1. `ereignis.isTrusted !== true` → `false` (Zusicherung 4 muss fangen).
2. `orte: true` → `false` im Profil.
3. `labels: true` aus dem Profil entfernen.
4. `ecosystemAnzeigeWahl` in `ecosystemAnzeigeSoll()` ignorieren (Zusicherung 5).
5. Im Editor-Zweig `canOperateEcosystemLayers()` streichen (Zusicherung 3).
6. `toggleClass("is-active", soll.orte[typ] === true)` → `removeClass("is-active")` (Zusicherung 1
   über den ausgeführten Applier — fängt sie es nicht, fehlt dem Test ein Fall).

- [ ] **Schritt 8: Im Browser messen, was nicht behauptet werden darf**

🪤 **`isTrusted` bei einem Klick auf die `<label>`-Zeile wird GEMESSEN, nicht angenommen.** Auf der
Live-Seite (oder lokal) in der Konsole:

```js
document.getElementById("togglePaths").addEventListener("change", (e) => console.log("isTrusted", e.isTrusted));
```

Dann (a) die Label-Zeile im Anzeige-Menü anklicken, (b) mit der Tastatur umschalten, (c)
`document.getElementById("togglePaths").dispatchEvent(new Event("change"))`.
Erwartet: `true`, `true`, `false`. **Kommt bei (a) `false`, fällt `isTrusted` als Weiche aus** —
dann ein Riegel um das eigene Schreiben (`ecosystemAnzeigeSchreibtSelbst`), und an ihn gehört der
Kommentar, warum nicht `isTrusted`.

- [ ] **Schritt 9: Ganzes Testfeld, commit + push, Owner-Blick**

Betreff: `ui(landschaften): Orte, Wege, Labels, Grenzen und Gewaesser sind in allen Ebenen an`.

**Owner-Blick.** Die vier ruhigen Ebenen sehen zum ersten Mal völlig anders aus.

---

## Aufgabe 3: Die vier neuen Vektoren, sichtbar im Mockup

**Dateien:**
- Ändern: `js/ui/map-layer-picker.js` (`OVERLAYS` bekommt vier Einträge)
- Ändern: `tools/bau-ansicht-untergrund-mockup.js` (zeigt sie)
- Erzeugen: `docs/ansicht-untergrund-mockup.html`
- Test: **neu** `tools/__tests__/ansicht-untergrund-mockup.test.js`

**Schnittstellen:**
- Liefert: `OVERLAYS.eco_derographisch`, `OVERLAYS.eco_vegetation`, `OVERLAYS.eco_topographie`,
  `OVERLAYS.eco_klima` — Strings mit SVG-Inhalt ohne `<svg>`-Hülle, wie die bestehenden Einträge.
  Aufgabe 5 liest sie über `ebenenVektor(kind)`.
- Verbraucht: `--color-water` aus Aufgabe 1 (der Topographie-Vektor führt `#4c89c6`).

🔴 **„Alle" bekommt KEINEN eigenen Vektor** (Owner 09.09.2026) — es nimmt `OVERLAYS.ecosystem`.
„Alle" *ist* alle Ebenen übereinander; so können die beiden nicht auseinanderlaufen.

- [ ] **Schritt 1: Den Wächter für das Build-Produkt schreiben**

`tools/__tests__/ansicht-untergrund-mockup.test.js`:

```js
// 💣 docs/ansicht-untergrund-mockup.html IST EIN BUILD-PRODUKT. Von Hand hineingeschriebene
// Regeln wirken sofort und sind beim naechsten Generatorlauf weg -- dieselbe Falle wie beim
// gescopten Editor-CSS (AGENTS.md §10), die dort DREIMAL zugeschlagen hat, bevor
// tools/__tests__/scope-editor-css.test.js sie gefangen hat. Fuer dieses Build-Produkt gab es
// bis zum 09.09.2026 keinen Waechter.
//
//   node tools/__tests__/ansicht-untergrund-mockup.test.js

const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.join(__dirname, "..", "..");
const ZIEL = path.join(ROOT, "docs", "ansicht-untergrund-mockup.html");

// In ein Wegwerf-Verzeichnis erzeugen, nie ueber die ausgelieferte Datei -- ein Test, der sein
// Pruefobjekt selbst neu schreibt, ist immer gruen.
//
// 🔴 DAFUER BRAUCHT DER GENERATOR EINE UMLEITUNG (Schritt 2 unten). Sein zweites Argument taugt
// NICHT: es erzeugt die ARTEFAKT-Fassung (ohne <html>/<head>/<body>, Bilder als data:-URI) und
// schreibt docs/ansicht-untergrund-mockup.html trotzdem. Ein Testlauf ueber argv[2] haette also
// sein eigenes Pruefobjekt ueberschrieben und danach zwangslaeufig Gleichheit gemeldet.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "avm-mockup-"));
const probe = path.join(tmp, "probe.html");
execFileSync(process.execPath, [path.join(ROOT, "tools", "bau-ansicht-untergrund-mockup.js")],
	{ cwd: ROOT, env: Object.assign({}, process.env, { AVESMAPS_MOCKUP_ZIEL: probe }) });

const erzeugt = fs.readFileSync(probe, "utf8").replace(/\r\n/g, "\n");
const geliefert = fs.readFileSync(ZIEL, "utf8").replace(/\r\n/g, "\n");
fs.rmSync(tmp, { recursive: true, force: true });

assert.strictEqual(geliefert, erzeugt,
	"docs/ansicht-untergrund-mockup.html ist zeichengleich mit der Ausgabe seines Generators."
	+ " Ist es das nicht, hat jemand von Hand hineingeschrieben -- erzeuge neu:"
	+ " node tools/bau-ansicht-untergrund-mockup.js");

console.log("ansicht-untergrund-mockup.test.js: Build-Produkt ist aktuell");
```

⚠️ **Zeilenendenneutral vergleichen** (`\r\n` → `\n`): die Arbeitskopie trägt CRLF, `actions/checkout`
legt LF hin — sonst ist der Test hier grün und in der CI rot (AGENTS.md §9).

- [ ] **Schritt 2: Die Umleitung in den Generator bauen**

Am Ende von `tools/bau-ansicht-untergrund-mockup.js` steht heute:

```js
const docsFassung = loeseRelativ(html);
fs.writeFileSync(path.join(WURZEL, "docs/ansicht-untergrund-mockup.html"), docsFassung);
```

Daraus wird:

```js
// 🔴 EINE UMLEITUNG FUER DEN WAECHTER, sonst kann er nicht pruefen, was er pruefen soll.
// tools/__tests__/ansicht-untergrund-mockup.test.js laesst hier erzeugen und vergleicht mit der
// ausgelieferten Datei. Ohne die Umleitung schriebe der Lauf sein eigenes Pruefobjekt neu und
// meldete danach zwangslaeufig Gleichheit -- ein gruener Test, der nichts haelt.
// ⚠️ NICHT ueber process.argv[2]: das ist die ARTEFAKT-Fassung (ohne <html>/<head>/<body>, Bilder
// als data:-URI) und ein anderes Erzeugnis, kein Ziel fuer dieselbe.
const docsZiel = process.env.AVESMAPS_MOCKUP_ZIEL || path.join(WURZEL, "docs/ansicht-untergrund-mockup.html");
const docsFassung = loeseRelativ(html);
fs.writeFileSync(docsZiel, docsFassung);
```

Die `console.log`-Zeile darunter nennt `docsZiel` statt des festen Pfades.

- [ ] **Schritt 3: Test fahren — er muss GRÜN sein**

Ausführen: `node tools/__tests__/ansicht-untergrund-mockup.test.js`
Erwartet: PASS (das Mockup ist heute aktuell). ⚠️ Ist es rot, hat schon jemand von Hand
hineingeschrieben — dann **erst** neu erzeugen und den Unterschied ansehen, bevor du weitermachst.

⚠️ **Gegenprobe, dass der Wächter wirklich hält:** ein Zeichen von Hand in
`docs/ansicht-untergrund-mockup.html` ändern, Test fahren (muss ROT sein), Zeichen zurücknehmen.
Ohne diese Probe ist nicht belegt, dass die Umleitung greift — genau der Fall, den sie verhindert.

- [ ] **Schritt 4: Die vier Vektoren in `OVERLAYS` schreiben**

In `js/ui/map-layer-picker.js`, direkt hinter `ecosystem:`. Kopf darüber:

```js
		// ---- Die fuenf Ebenen als zweite Stufe (09.09.2026) ---------------------------------------
		// 🔴 „Alle" hat KEINEN eigenen Vektor -- es nimmt `ecosystem` oben. „Alle" ist alle Ebenen
		// uebereinander; zwei getrennte Zeichnungen liefen beim naechsten Umton auseinander.
		// 💣 Die Farben sind die ECHTEN aus css/base/tokens.css, jede aus der Stelle, die sie auf
		// der Karte zeichnet. Wer sie „aufraeumt", macht die Zelle zu einem Symbol, das etwas
		// anderes ankuendigt als die Karte zeigt.
		// ⚠️ KEIN Kachelbild darunter: der Untergrund steht in den Landschaften auf 0 %, und der
		// Grund ist --color-ecosystem-underground (#d3cec2).
```

**Derographie** — graue Regionsumrisse, **ungefüllt**:

```js
		// 🔴 UNGEFUELLT, und das ist Information: die derographische Ebene zeichnet BEHAELTER
		// (Regionen, Inseln, Kontinente) und ruht ungefuellt auf der Karte
		// (--color-ecosystem-derographisch, „grey, and unfilled while it rests"). Eine gefuellte
		// graue Flaeche waere huebscher und falsch.
		eco_derographisch:
			'<g fill="none" stroke="#2e2e2e" stroke-opacity=".8" stroke-linecap="round" stroke-linejoin="round">' +
			'<path d="M-2 9 C6 6.5 12 10.5 18 9.5 26 8 32 12.5 38 10.5 43 9 46 11.5 50 9.5" stroke-width="1.7"/>' +
			'<path d="M18 9.5 C17.2 17 20.4 22.5 18.6 29.5 16.8 36.5 19.6 42 17.8 50" stroke-width="1.7"/>' +
			'<path d="M18.6 29.5 C25 27.5 31 31.5 38 29.5 43 28 46 30.5 50 28.5" stroke-width="1.5"/>' +
			'<path d="M33 -2 C32 3 35 6 34 10.5" stroke-width="1.2" stroke-opacity=".55"/>' +
			'</g>' +
			'<g fill="#575757" fill-opacity=".2" stroke="#2e2e2e" stroke-opacity=".7" stroke-width="1.2">' +
			'<ellipse cx="9" cy="41" rx="5.2" ry="3.4"/></g>',
```

⚠️ Die kleine gefüllte Ellipse ist eine **Insel** — das eine derographische Objekt, das gefüllt
liegt; ohne sie liest sich die Zelle als leeres Gitter.

**Vegetation** — Grasland, Steppe, Wüstenfleck, Waldflecken:

```js
		eco_vegetation:
			'<path d="M0 24 C7 19 12 25 18 21 26 16 33 22 40 17 44 14 46 18 48 16 V33 C43 36 38 30 31 34 24 38 18 32 11 36 6 39 3 34 0 37 Z" fill="#8fbf6a" fill-opacity=".85"/>' +
			'<path d="M0 37 C3 34 6 39 11 36 18 32 24 38 31 34 38 30 43 36 48 33 V44 C42 47 37 42 30 45 23 48 17 43 10 46 5 48 3 45 0 47 Z" fill="#a8bd8a" fill-opacity=".8"/>' +
			'<path d="M31 -2 C37 1 43 -1 50 1 V13 C43 11 37 14.5 31 12 27 10.5 25.5 6.5 27 3.5 28 1.5 29.5 -0.6 31 -2 Z" fill="#e0c74e" fill-opacity=".78"/>' +
			'<g fill="#3f6b2c" fill-opacity=".88">' +
			'<path d="M2 4 C6 1 11 2 13 5 15 9 11 12 7 11 3 10 0 7 2 4 Z"/>' +
			'<path d="M14 26 C18 24 22 26 22 29 22 32 18 33 16 31 13 29 12 27 14 26 Z"/>' +
			'<path d="M37 22 C42 20 47 23 47 27 47 31 42 32 39 29 36 27 34 24 37 22 Z"/>' +
			'<path d="M23 42 C28 40 33 42 33 46 33 49 28 49 25 48 22 46 21 43 23 42 Z"/></g>',
```

**Topographie** — Gebirge, Hügel, See, Meer:

```js
		// Der See traegt --color-water (#4c89c6), das Meer sein eigenes Dunkelblau -- die beiden
		// sind auf der Karte verschieden und in der Zelle auch (Owner 09.09.2026).
		eco_topographie:
			'<path d="M0 34 C5 30 9 35 14 32 20 28.5 25 34 31 30 36 26.5 42 32 48 28 V40 C42 43 36 38 30 41 23 44.5 17 39 10 42.5 5 45 3 41.5 0 44 Z" fill="#7d8f6e" fill-opacity=".8"/>' +
			'<g fill="#7a6c5e" fill-opacity=".88">' +
			'<path d="M-2 26 L7 10 L13 19 L19 6 L27 22 L33 15 L40 27 L46 19 L50 27 V30 C42 33 36 28 30 31 23 34.5 17 29 10 32.5 5 35 2 31.5 -2 33 Z"/></g>' +
			'<g fill="#efe9dc" fill-opacity=".85">' +
			'<path d="M19 6 L22.6 13 L15.4 13 Z"/><path d="M7 10 L9.8 15 L4.2 15 Z"/></g>' +
			'<ellipse cx="15" cy="38" rx="6.6" ry="3.6" fill="#4c89c6" fill-opacity=".9"/>' +
			'<path d="M0 45 C8 43.5 16 46 24 44.5 32 43 40 45.5 48 44 V50 H0 Z" fill="#2d5f8a" fill-opacity=".88"/>',
```

⚠️ Die zwei hellen Dreiecke sind **Schneekappen** und tragen keinen eigenen Token — sie sind
Zeichnung, kein Kartenwert; deshalb ein neutrales Elfenbein und keine erfundene Farbvariable.

**Klimazonen** — acht Bänder, kalt oben nach warm unten:

```js
		// 🔴 ACHT Baender, die echten Toene der Temperaturskala. Die Ebene wird nicht gezeichnet,
		// sondern aus Trennlinien ABGELEITET -- deshalb sind die Kanten hier leicht bewegt und
		// nicht schnurgerade: so liegen sie auf der Karte.
		eco_klima:
			'<path d="M0 0 H48 V6 C36 7.4 24 4.8 12 6.2 8 6.7 4 6 0 6.6 Z" fill="#cfe0eb" fill-opacity=".9"/>' +
			'<path d="M0 6.6 C4 6 8 6.7 12 6.2 24 4.8 36 7.4 48 6 V12 C36 13.6 24 10.8 12 12.4 8 12.9 4 12.2 0 12.8 Z" fill="#a2c3d1" fill-opacity=".9"/>' +
			'<path d="M0 12.8 C4 12.2 8 12.9 12 12.4 24 10.8 36 13.6 48 12 V18.4 C36 19.6 24 17.2 12 18.6 8 19 4 18.4 0 19 Z" fill="#7aada9" fill-opacity=".9"/>' +
			'<path d="M0 19 C4 18.4 8 19 12 18.6 24 17.2 36 19.6 48 18.4 V24.6 C36 26 24 23.4 12 24.8 8 25.2 4 24.6 0 25.2 Z" fill="#bfc888" fill-opacity=".9"/>' +
			'<path d="M0 25.2 C4 24.6 8 25.2 12 24.8 24 23.4 36 26 48 24.6 V31 C36 32.4 24 29.8 12 31.2 8 31.6 4 31 0 31.6 Z" fill="#dcb857" fill-opacity=".9"/>' +
			'<path d="M0 31.6 C4 31 8 31.6 12 31.2 24 29.8 36 32.4 48 31 V37.2 C36 38.6 24 36 12 37.4 8 37.8 4 37.2 0 37.8 Z" fill="#cdb083" fill-opacity=".9"/>' +
			'<path d="M0 37.8 C4 37.2 8 37.8 12 37.4 24 36 36 38.6 48 37.2 V43.4 C36 44.8 24 42.2 12 43.6 8 44 4 43.4 0 44 Z" fill="#d98f3c" fill-opacity=".9"/>' +
			'<path d="M0 44 C4 43.4 8 44 12 43.6 24 42.2 36 44.8 48 43.4 V48 H0 Z" fill="#c65e2e" fill-opacity=".9"/>',
```

- [ ] **Schritt 5: Die vier Vektoren ins Mockup nehmen**

In `tools/bau-ansicht-untergrund-mockup.js` die neuen Overlays aus `map-layer-picker.js`
mitziehen (der Generator führt seinen eigenen Zwilling der Tabelle) und einen Abschnitt „Die fünf
Ebenen" einbauen, der die fünf Zellen nebeneinander auf dem Pergamentgrund
(`--color-ecosystem-underground`) zeigt.

💣 **Im Template-String des Generators darf KEIN Backtick stehen** — auch nicht im Kommentar. Er
beendet den String, und der Fehler zeigt sich als „SyntaxError: Unexpected identifier" an einer
völlig anderen Zeile (steht so im Kopf der Datei, zweimal passiert). Gegenprobe:
`grep -c '\x60' tools/bau-ansicht-untergrund-mockup.js` muss die im Dateikopf genannte Zahl ergeben.

- [ ] **Schritt 6: Mockup neu erzeugen und beide Tests fahren**

```bash
node tools/bau-ansicht-untergrund-mockup.js
node tools/__tests__/ansicht-untergrund-mockup.test.js
node js/map-features/__tests__/wasserton.test.js
```

- [ ] **Schritt 7: Im Browser ansehen**

`docs/ansicht-untergrund-mockup.html` öffnen, **hell und dunkel**. Geprüft wird mit dem Auge, nicht
mit einer Maßtabelle: sind die fünf Zellen auf 48 px auseinanderzuhalten? Liest sich Derographie
als Umriss und nicht als Fehler? Hebt sich der See vom Meer ab?

- [ ] **Schritt 8: Commit + push, dann Owner-Blick auf die Icons**

```bash
git add js/ui/map-layer-picker.js tools/bau-ansicht-untergrund-mockup.js docs/ansicht-untergrund-mockup.html tools/__tests__/ansicht-untergrund-mockup.test.js
git commit -F <nachricht.txt>
```

Betreff: `ui(kartenfaecher): vier Vektoren fuer die Landschafts-Ebenen -- im Mockup zu sehen`.

**Halt.** Der Owner sieht die Icons im Mockup an, bevor der Fächer sie benutzt.

---

## Aufgabe 4: Die Stufe wird ein Bauteil (reiner Innenumbau)

**Dateien:**
- Ändern: `js/ui/map-layer-picker.js` (`start()`)
- Test: `js/ui/__tests__/map-layer-picker.test.js` (bleibt grün, wird um eine Zusicherung ergänzt)

**Schnittstellen:**
- Liefert: `macheStufe(einstellungen) -> { element, zeigeFuer, schliesse, spaeterSchliessen, istOffen, quelleWert }`
  — Aufgabe 6 montiert damit die dritte Stufe.
  - `einstellungen.klasse` (String) — zusätzliche CSS-Klasse der Reihe
  - `einstellungen.ariaLabel` (String)
  - `einstellungen.quelleContainer` (Element **oder** `() => Element`) — worin die Quellzelle liegt
  - `einstellungen.eintraege` (`() => Array<{wert,name,gesperrt}>`)
  - `einstellungen.baueZelle` (`(eintrag, istAktiv) => HTMLButtonElement`)
  - `einstellungen.istAktiv` (`(eintrag) => boolean`)
  - `einstellungen.beiWahl` (`(wert, quelleWert) => void`)
  - `einstellungen.quelleSelektor` (`(wert) => String`) — wie die Quellzelle gefunden wird
  - `einstellungen.hoeheUeber` (`() => Element|null`) — worüber die Reihe sitzt; `null` = die Hülle

🔴 **Diese Aufgabe ändert KEIN Verhalten.** Sie ist erfolgreich, wenn `map-layer-picker.test.js`
und der Browser sich exakt wie vorher verhalten. Wer hier gleichzeitig etwas verbessert, kann
später nicht mehr sagen, welcher der beiden Umbauten die Regression gebracht hat.

- [ ] **Schritt 1: Den Ausgangszustand festhalten**

```bash
node js/ui/__tests__/map-layer-picker.test.js
```
Erwartet: PASS. Diese Ausgabe ist der Vergleichsmaßstab für Schritt 4.

- [ ] **Schritt 2: `macheStufe` anlegen und die Stufe-2-Instanz darauf ziehen**

Die zwölf heutigen Namen wandern in die Fabrik und verlieren ihren „Grund"-Bezug:

| heute | in der Fabrik |
|---|---|
| `grundReihe` | `element` |
| `stufeZwei` | `quelle` (lokal), gelesen über `quelleWert()` |
| `stufeZweiOffen` | `istOffen` (lokal), gelesen über `istOffen()` |
| `stufeTimer`, `stufeAufTimer` | lokal |
| `zeichneGrundReihe` | `zeichne()` — ruft `einstellungen.eintraege/baueZelle/istAktiv` |
| `positioniereStufeZwei` | `positioniere()` |
| `oeffneStufeZwei` | Teil von `zeigeFuer(wert)` |
| `schliesseStufeZwei` | `schliesse()` |
| `stufeZweiSpaeterSchliessen` | `spaeterSchliessen()` |
| `verdrahteStufeZwei` | `verdrahte()` — hängt `mouseenter`/`mouseleave` an die Quellzellen |
| `markiereQuelle` | intern, aus `zeigeFuer` |

Der Aufruf für Stufe 2 (unverändertes Verhalten):

```js
		var stufeUntergrund = macheStufe({
			klasse: "map-layer-picker__grund",
			ariaLabel: "Untergrund",
			quelleContainer: menue,
			quelleSelektor: function (wert) { return '.map-layer-picker__cell[data-mode="' + wert + '"]'; },
			eintraege: untergruende,
			istAktiv: function (e) { var a = aktiverUntergrund(); return Boolean(a) && e.wert === a.wert; },
			baueZelle: grundZelle,
			beiWahl: waehleGrund,
			hoeheUeber: null
		});
```

💣 **Der Offen-Zustand bleibt eine VARIABLE** — weder `hidden` noch `is-open`. Beide sind aus
entgegengesetzten Gründen untauglich (`hidden` springt erst nach dem Zuklappen um, die Klasse erst
im nächsten Bild); der Fehler ist in diesem Menü schon zweimal bezahlt worden.

💣 **`window.clearTimeout(stufeAufTimer)` in `schliesse()` bleibt** — ein noch WARTENDES Aufklappen
muss mit weg, sonst fährt die Stufe heraus, nachdem das Menü längst zu ist.

💣 Die Zuhörer am Element (`click`, `mouseenter`, `mouseleave`) wandern **in die Fabrik**. Die
`mouseleave`-Prüfung „geht der Zeiger in die andere Reihe?" wird zu einer Frage an die
Nachbarstufe — dafür bekommt die Fabrik nach dem Bau `stufe.nachbarn = [andereStufe, …]` gesetzt,
und `mouseleave` gibt auf, wenn `relatedTarget` in einem Nachbarn oder im `quelleContainer` liegt.

- [ ] **Schritt 3: Die Aufrufstellen umhängen**

`schliesse()` ruft `stufeUntergrund.schliesse()`; `waehle()` fragt `untergruende().length > 1` und
ruft `stufeUntergrund.zeigeFuer(modus)`; `zeichne()` endet auf `stufeUntergrund.verdrahte()`.

- [ ] **Schritt 4: Test fahren — muss unverändert grün sein**

```bash
node js/ui/__tests__/map-layer-picker.test.js
```
Erwartet: PASS, dieselben Zusicherungen wie in Schritt 1.

⚠️ Läuft der Test über Namen, die es jetzt nicht mehr gibt (`grundReihe`, `stufeZweiOffen`), ist
das **kein Grund, den Umbau zurückzunehmen** — die Zusicherung wird auf den neuen Namen gezogen,
und ihre Begründung bleibt wörtlich stehen.

- [ ] **Schritt 5: Eine Zusicherung ergänzen, die den Umbau festhält**

In `js/ui/__tests__/map-layer-picker.test.js`:

```js
// ---- Die Stufe ist ein Bauteil, keine Abschrift (09.09.2026) --------------------------------------
// 💣 Sie wird ZWEIMAL montiert (Untergrund, und ab Aufgabe 6 die Ebenen). Eine zweite, abgeschriebene
// Instanz waere die siebte Listenzeilen-Rezeptur dieses Hauses -- derselbe Fehler, den AGENTS.md §11
// fuer die Listenzeilen und die Wiki-Zuweisung zweimal protokolliert.
assert.ok(/function\s+macheStufe\s*\(/.test(js),
	"es gibt EINE Fabrik fuer eine Untermenue-Stufe");
const stufenAufrufe = (js.match(/macheStufe\s*\(\s*\{/g) || []).length;
assert.ok(stufenAufrufe >= 1, "und sie wird benutzt");
assert.ok(!/function\s+(zeichneGrundReihe|oeffneStufeZwei|schliesseStufeZwei)\s*\(/.test(js),
	"die alten Einzel-Funktionen der zweiten Stufe sind AUFGEGANGEN, nicht danebengestellt --"
	+ " zwei Wege zum selben Menue laufen beim naechsten Nachjustieren auseinander.");
```

- [ ] **Schritt 6: Im Browser gegenprüfen**

Karte laden, Fächer überfahren: Aufklappen, Untermenü nach 140 ms, Wandern zwischen Ansichten ohne
Neu-Auffächern, Klick hält fest, Esc schließt, Klick auf die Karte schließt. **Der Ablauf, nicht
die Maßtabelle.**

- [ ] **Schritt 7: Commit (NICHT pushen)**

```bash
git add js/ui/map-layer-picker.js js/ui/__tests__/map-layer-picker.test.js
git commit -F <nachricht.txt>
```
Betreff: `refactor(kartenfaecher): die Untermenue-Stufe wird ein Bauteil -- Verhalten unveraendert`.

---

## Aufgabe 5: Stufe 2 zeigt bei „Landschaften" die fünf Ebenen

**Dateien:**
- Ändern: `js/ui/map-layer-picker.js`
- Ändern: `css/components/map-layer-picker.css:341-343` (Staffelung)
- Test: **neu** `js/ui/__tests__/landschaften-untermenue.test.js`

**Schnittstellen:**
- Verbraucht: `macheStufe` (Aufgabe 4), `OVERLAYS.eco_*` (Aufgabe 3)
- Liefert: `ebenen()` → `[{wert,name,gesperrt}]` mit `wert` ∈
  `alle|derographisch|vegetation|topographie|klima`; `aktiveEbene()`; `waehleEbene(wert)`.
  Aufgabe 6 hängt die dritte Stufe unter diese Zellen.

🔴 **Der Zustand bleibt die Reiterleiste.** `ebenen()` liest die Reiter
`#ecosystem-layer-switch [data-ecosystem-kind]` und `[data-ecosystem-show-all]` — genau wie
`ansichten()` das `<select>` liest. `waehleEbene()` **klickt den Reiter an**; ein eigenes
`setActiveEcosystemLayerKind` hier umginge das Merken, die aria-Zustände und die Besucherzählung.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

`js/ui/__tests__/landschaften-untermenue.test.js`:

```js
// Die fuenf Landschafts-Ebenen als zweite Stufe des Kartenfaechers (Owner 09.09.2026).
//
//   node js/ui/__tests__/landschaften-untermenue.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const lies = (...t) => fs.readFileSync(path.join(ROOT, ...t), "utf8");
const ohneKommentare = (q) => q.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const js = ohneKommentare(lies("js", "ui", "map-layer-picker.js"));
const css = ohneKommentare(lies("css", "components", "map-layer-picker.css"));
const html = lies("index.html");

// ---- 1. Die Ebenen stehen nur EINMAL im Haus: in der Reiterleiste --------------------------------
// 💣 Dieselbe Regel wie bei den Ansichten (das <select>) und den Untergruenden. Eine zweite Liste
// im Faecher liefe beim naechsten neuen Ebenentyp auseinander -- die Leiste kennte ihn, der
// Faecher nicht.
["derographisch", "vegetation", "topographie", "klima"].forEach((kind) => {
	assert.ok(html.includes('data-ecosystem-kind="' + kind + '"'),
		"die Ebene " + kind + " steht als Reiter in index.html");
	assert.ok(!new RegExp('"' + kind + '"\\s*[,:]').test(js.replace(/data-ecosystem-kind/g, "")),
		"und NICHT ein zweites Mal als Liste im Kartenfaecher");
});

// ---- 2. Der Faecher schreibt den Zustand ueber die REITER ----------------------------------------
// 🔴 Kein zweiter Zustand. Der Reiterklick zieht setActiveEcosystemLayerKind, das Merken im
// localStorage, syncEcosystemPaneStates, die aria-Zustaende und die Besucherzaehlung mit.
assert.ok(/ecosystem-layer-switch/.test(js),
	"der Faecher liest und bedient die Reiterleiste");
assert.ok(!/setActiveEcosystemLayerKind\s*\(/.test(js),
	"...und ruft den Setzer NICHT selbst -- das umginge alles, was am Reiterklick haengt.");
assert.ok(/data-ecosystem-show-all/.test(js),
	"„Alle" geht ueber sein eigenes Attribut, nicht ueber einen kind-Wert -- isKnownEcosystemKind"
	+ " ('alle') ist falsch, der gemerkte Wert fiele still auf die Vorgabe zurueck.");

// ---- 3. Die zweite Stufe ist PRO ANSICHT verschieden ---------------------------------------------
assert.ok(/macheStufe\s*\(\s*\{[\s\S]{0,600}?ariaLabel:\s*"Untergrund"/.test(js),
	"es gibt die Untergrund-Stufe");
assert.ok(/macheStufe\s*\(\s*\{[\s\S]{0,600}?ariaLabel:\s*"Landschafts-Ebene"/.test(js),
	"und die Ebenen-Stufe -- zwei Montagen desselben Bauteils, keine zwei Bauteile");

// ---- 4. Die Staffelung deckt FUENF Zellen --------------------------------------------------------
// 💣 Sie stand als nth-child(2..4) da -- genau drei Untergruende. Mit fuenf Ebenen blendeten die
// letzten beiden ohne Versatz auf, und zwar still: es sieht nur „irgendwie ruckelig" aus.
[2, 3, 4, 5, 6].forEach((n) => {
	assert.ok(new RegExp("nth-child\\(" + n + "\\)").test(css),
		"die Staffelung kennt Zelle " + n);
});

console.log("landschaften-untermenue.test.js: alle Zusicherungen gruen");
```

- [ ] **Schritt 2: Test fahren, Fehlschlag sehen**

Ausführen: `node js/ui/__tests__/landschaften-untermenue.test.js`
Erwartet: FAIL bei „es gibt die Ebenen-Stufe".

- [ ] **Schritt 3: Ebenen lesen, Zelle bauen, Stufe montieren**

In `js/ui/map-layer-picker.js`:

```js
	/**
	 * Die fuenf Landschafts-Ebenen -- die zweite Stufe der Ansicht „Landschaften" (09.09.2026).
	 *
	 * 💣 DIESELBE REGEL WIE BEI ANSICHTEN UND UNTERGRUENDEN: die EINZIGE Quelle ist die
	 * Reiterleiste `#ecosystem-layer-switch`. Sie IST der Zustand -- setActiveEcosystemLayerKind
	 * schreibt ihn, das localStorage merkt ihn, syncEcosystemLayerSwitchControls stempelt die
	 * aria-Zustaende. Eine zweite Liste hier liefe beim naechsten Ebenentyp auseinander.
	 * 🔴 Die Leiste bleibt im DOM, auch wenn der Besucher sie nicht sieht (Aufgabe 8). Wer sie fuer
	 * ihn aus dem Markup naehme, muesste den ganzen Ebenenzustand ein zweites Mal bauen.
	 */
	function ebenenReiter() {
		var leiste = document.getElementById("ecosystem-layer-switch");
		return leiste
			? Array.prototype.slice.call(leiste.querySelectorAll(".ecosystem-layer-switch__tab"))
			: [];
	}

	function ebenenWert(reiter) {
		return reiter.dataset.ecosystemShowAll ? "alle" : String(reiter.dataset.ecosystemKind || "");
	}

	function ebenen() {
		return ebenenReiter().map(function (reiter) {
			return {
				wert: ebenenWert(reiter),
				name: (reiter.textContent || "").trim(),
				gesperrt: reiter.disabled === true || reiter.hidden === true
			};
		}).filter(function (e) { return e.wert !== ""; });
	}

	function aktiveEbene() {
		var treffer = ebenenReiter().filter(function (r) {
			return r.getAttribute("aria-selected") === "true";
		})[0];
		return treffer ? ebenenWert(treffer) : "";
	}

	/**
	 * 💣 GEKLICKT, NICHT GESETZT -- derselbe Weg wie beim <select> des Untergrunds, kein zweiter.
	 * Am Reiterklick haengen setActiveEcosystemLayerKind, das Merken, syncEcosystemPaneStates und
	 * die Besucherzaehlung (js/app/visitor-tracking.js horcht auf diese Leiste). Ein eigener Aufruf
	 * hier umginge alle vier auf einmal.
	 */
	function waehleEbene(wert) {
		var treffer = ebenenReiter().filter(function (r) { return ebenenWert(r) === wert; })[0];
		if (treffer) {
			treffer.click();
		}
	}
```

Die Zelle (Vektor auf Pergamentgrund, kein Kachelbild):

```js
	/** 🔴 „Alle" nimmt den Landschafts-Vektor selbst -- es IST alle Ebenen uebereinander. */
	var EBENEN_VEKTOR = {
		alle: "ecosystem",
		derographisch: "eco_derographisch",
		vegetation: "eco_vegetation",
		topographie: "eco_topographie",
		klima: "eco_klima"
	};
```

`ebenenZelle(eintrag, istAktiv)` wird nach dem Vorbild von `grundZelle` gebaut, aber mit dem
SVG-Vektor statt eines `<img>` und mit `dataset.ebene` statt `dataset.grund`.

Montage:

```js
		var stufeEbenen = macheStufe({
			klasse: "map-layer-picker__ebenen",
			ariaLabel: "Landschafts-Ebene",
			quelleContainer: menue,
			quelleSelektor: function (wert) { return '.map-layer-picker__cell[data-mode="' + wert + '"]'; },
			eintraege: ebenen,
			istAktiv: function (e) { return e.wert === aktiveEbene(); },
			baueZelle: ebenenZelle,
			beiWahl: function (wert, ansicht) {
				waehleEbene(wert);
				if (ansicht && ansicht !== aktiveAnsicht()) {
					select.value = ansicht;
					select.dispatchEvent(new Event("change", { bubbles: true }));
				}
				schliesse();
			},
			hoeheUeber: null
		});
```

Und die Weiche in `waehle()` und `schliesse()`:

```js
		/**
		 * 🔴 STUFE 2 IST PRO ANSICHT VERSCHIEDEN (09.09.2026). Sie zeigt, was DIESE Ansicht zu
		 * waehlen hat: bei „Landschaften" die fuenf Ebenen, sonst die Untergruende.
		 * 💣 Und daraus faellt die eine Regel, die alle drei Stufen traegt: eine Zelle MIT
		 * Untermenue oeffnet es, eine OHNE waehlt. Deshalb wird hier nach der Stufe gefragt und
		 * nicht nach dem Modus.
		 */
		function stufeZuAnsicht(modus) {
			return modus === "ecosystem" ? stufeEbenen : stufeUntergrund;
		}
```

- [ ] **Schritt 4: Die Staffelung im CSS auf fünf Zellen ziehen**

`css/components/map-layer-picker.css:341-343` — der Selektor nennt beide Reihen und geht bis 6:

```css
/* Die Zellen der zweiten Stufe blenden von der Teilungsstelle nach aussen auf. Anders als beim
   Hauptraster wird von VORN gezaehlt: hier gibt es keine aktive Zelle, die auf dem Fleck der
   zugeklappten Kachel liegen muesste.
   💣 BIS ZUR SECHSTEN ZELLE. Die Reihe trug drei Untergruende, seit dem 09.09.2026 auch fuenf
   Ebenen -- ohne die zwei zusaetzlichen Zeilen blenden die letzten beiden ohne Versatz auf, und
   das sieht nicht nach einem fehlenden Wert aus, sondern nach einem ruckelnden Menue. */
.map-layer-picker__grund .map-layer-picker__cell:nth-child(2),
.map-layer-picker__ebenen .map-layer-picker__cell:nth-child(2) { transition-delay: 25ms; }
/* … 3, 4, 5, 6 analog … */
```

Ebenso die drei anderen `__grund`-Regeln (`__thumb img`, `.map-layer-picker__label--grund`, die
Grundregel mit `position`/`clip-path`/`::after`) auf beide Klassen ziehen — ⚠️ **die Brücke
`::after` gehört zwingend dazu**, sonst klappt die Ebenenreihe beim Hochfahren über die 6-px-Lücke
zu.

⭐ Prüfe, ob eine gemeinsame Klasse (`.map-layer-picker__stufe`) an beiden Reihen billiger ist als
fünf doppelte Selektoren — die Fabrik setzt sie ohnehin. Dann tragen die Regeln **eine** Klasse und
die Modifier nur, was wirklich verschieden ist.

- [ ] **Schritt 5: Test fahren, grün sehen**

```bash
node js/ui/__tests__/landschaften-untermenue.test.js && node js/ui/__tests__/map-layer-picker.test.js
```

- [ ] **Schritt 6: Gegen Mutationen fahren**

1. `ariaLabel: "Landschafts-Ebene"` → `"Ebene"` (Zusicherung 3).
2. `treffer.click()` → `setActiveEcosystemLayerKind(wert)` (Zusicherung 2).
3. `nth-child(6)`-Zeile löschen (Zusicherung 4).
4. `data-ecosystem-show-all` im Fächer durch `"alle"` als `kind` ersetzen (Zusicherung 2).

- [ ] **Schritt 7: Commit (NICHT pushen)**

Betreff: `feat(kartenfaecher): die zweite Stufe zeigt bei Landschaften die fuenf Ebenen`.

---

## Aufgabe 6: Die zweite Zeile der Kachel und der Zuhörer dahinter

**Dateien:**
- Ändern: `js/ui/map-layer-picker.js` (`zelle()`, Zuhörer am Ende von `start()`)
- Test: `js/ui/__tests__/landschaften-untermenue.test.js` (erweitert)

**Schnittstellen:**
- Verbraucht: `aktiveEbene()`, `stufeZuAnsicht()` aus Aufgabe 5.

💣 **DIESE AUFGABE IST DIE, DIE MAN VERGISST.** Der Fächer zeichnet sich neu, wenn die Ansicht
wechselt (MutationObserver auf `#mapLayerModeLabel`) **und** wenn der Untergrund wechselt (`change`
am `#mapStyleSelect`). Für die Ebene gibt es beides nicht: Der Editor schaltet sie über seine
Reiterleiste, und die zugeklappte Kachel behielte ihre alte zweite Zeile. Das ist wörtlich der
Fehler vom 26.08.2026 („standard auf original funktioniert nicht -- da kommen kraftlinien"), eine
Ebene weiter.

- [ ] **Schritt 1: Die fehlschlagenden Zusicherungen ergänzen**

In `js/ui/__tests__/landschaften-untermenue.test.js`:

```js
// ---- 5. Die zweite Zeile nennt, was die zweite Stufe DIESER Ansicht waehlt ------------------------
assert.ok(/aktiveEbene\(\)/.test(js.match(/function\s+zelle\s*\(([\s\S]*?)\n\t\}/)[0]),
	"die Kachel liest bei Landschaften die Ebene, nicht den Untergrund -- der sagt dort nichts"
	+ " mehr aus (er steht auf 0 %).");

// ---- 6. Und sie braucht ihren eigenen Zuhoerer ---------------------------------------------------
// 💣 Es gibt KEIN change-Ereignis fuer die Ebene. Der Editor schaltet sie ueber die Reiterleiste;
// ohne einen Beobachter behielte die zugeklappte Kachel ihre alte zweite Zeile. Wortlaut des
// Fehlers vom 26.08.2026, eine Etage tiefer.
assert.ok(/MutationObserver[\s\S]{0,400}ecosystem-layer-switch|ecosystem-layer-switch[\s\S]{0,400}MutationObserver/.test(js),
	"ein Beobachter auf der Reiterleiste zeichnet die Kachel neu -- beobachtet werden die"
	+ " aria-selected-Attribute, die syncEcosystemLayerSwitchControls bei JEDEM Wechsel schreibt.");
```

- [ ] **Schritt 2: Test fahren, Fehlschlag sehen**

Erwartet: FAIL bei Zusicherung 6.

- [ ] **Schritt 3: Zweite Zeile und Zuhörer bauen**

In `zelle()` — statt fest `aktiverUntergrund()`:

```js
			// 🔴 SIE NENNT, WAS DIE ZWEITE STUFE DIESER ANSICHT WAEHLT (09.09.2026). Bei
			// „Landschaften" ist das die EBENE: der Untergrund steht dort auf 0 % und sagt nichts
			// mehr aus. Bei jeder anderen Ansicht bleibt es der Untergrund.
			var zweiteZeile = "";
			if (istAktiv || !imMenue) {
				if (ansicht.wert === "ecosystem") {
					var e = ebenen().filter(function (x) { return x.wert === aktiveEbene(); })[0];
					zweiteZeile = e ? e.name : "";
				} else {
					var grund = aktiverUntergrund();
					zweiteZeile = grund ? grund.name : "";
				}
			}
```

Und am Ende von `start()`, neben den beiden vorhandenen Zuhörern:

```js
		// 💣 UND DIE EBENE BRAUCHT DENSELBEN ZUHOERER (09.09.2026) -- dieselbe Falle wie beim
		// Untergrund am 26.08.2026. Es gibt kein change-Ereignis dafuer: der Editor schaltet die
		// Ebene ueber seine Reiterleiste, und die zugeklappte Kachel behielte ihre alte zweite
		// Zeile. Beobachtet wird `aria-selected` -- syncEcosystemLayerSwitchControls schreibt es
		// bei JEDEM Wechsel, egal von wo (Reiter, Faecher, gemerkter Wert beim Laden).
		var ebenenLeiste = document.getElementById("ecosystem-layer-switch");
		if (ebenenLeiste && typeof MutationObserver === "function") {
			new MutationObserver(function () {
				zeichne();
			}).observe(ebenenLeiste, { attributes: true, attributeFilter: ["aria-selected"], subtree: true });
		}
```

- [ ] **Schritt 4: Test fahren, grün sehen**

- [ ] **Schritt 5: Gegen Mutationen fahren**

1. Den Beobachter-Block löschen (Zusicherung 6).
2. `attributeFilter: ["aria-selected"]` → `["class"]` — ⚠️ fängt der Test das **nicht**, ist die
   Zusicherung zu grob: dann zusätzlich auf `aria-selected` im Filter prüfen.
3. In `zelle()` den `ecosystem`-Zweig entfernen (Zusicherung 5).

- [ ] **Schritt 6: Commit (NICHT pushen)**

Betreff: `feat(kartenfaecher): die Kachel nennt bei Landschaften die Ebene statt des Untergrunds`.

---

## Aufgabe 7: Die dritte Stufe — der Untergrund für Editoren

**Dateien:**
- Ändern: `js/ui/map-layer-picker.js`
- Ändern: `css/components/map-layer-picker.css`
- Ändern: `tools/bau-ansicht-untergrund-mockup.js` + Mockup neu erzeugen
- Test: `js/ui/__tests__/landschaften-untermenue.test.js` (erweitert)

**Schnittstellen:**
- Verbraucht: `macheStufe` (Aufgabe 4), `stufeEbenen` (Aufgabe 5)

🔴 **Nur im Bearbeiten-Modus**, und der Riegel fällt **geschlossen** aus: ohne die Auskunft keine
dritte Stufe. Der Untergrund steht für Besucher auf 0 %; ein Menü, das etwas Unsichtbares wählt,
ist kein Menü.

- [ ] **Schritt 1: Die fehlschlagenden Zusicherungen ergänzen**

```js
// ---- 7. Die dritte Stufe gehoert dem Editor ------------------------------------------------------
// 🔴 Der Riegel faellt GESCHLOSSEN aus: ohne die Auskunft keine dritte Stufe. Ein Besucher hat in
// den Landschaften 0 % Untergrund -- ein Menue dafuer waehlte etwas Unsichtbares.
assert.ok(/IS_EDIT_MODE/.test(js), "die dritte Stufe fragt IS_EDIT_MODE");
assert.ok(/typeof\s+IS_EDIT_MODE\s*!==\s*"undefined"\s*&&\s*IS_EDIT_MODE/.test(js),
	"...und zwar geschlossen -- undefiniert heisst NICHT Editor.");

// ---- 8. Sie sitzt UEBER der zweiten, und die Hoehe wird GEMESSEN ----------------------------------
// 💣 Stufe 2 sitzt auf bottom: calc(100% + 6px) der Huelle. Stufe 3 muesste 100% + 6 + Hoehe(2) + 6
// tragen -- und die Hoehe der zweiten Reihe haengt an ihrer Beschriftung und ist keine Konstante.
// Eine abgeschriebene Zahl waere beim ersten laengeren Ebenennamen falsch, und zwar still.
assert.ok(/getBoundingClientRect\(\)[\s\S]{0,300}hoeheUeber|hoeheUeber[\s\S]{0,300}getBoundingClientRect\(\)/.test(js),
	"die dritte Stufe misst die zweite, statt eine Zahl abzuschreiben");

// ---- 9. Die Luecke braucht in BEIDEN Grenzen eine Bruecke ----------------------------------------
// 💣 Zwischen je zwei Stufen liegen 6px; wer hochfaehrt, ist fuer einen Moment ueber NICHTS. Zwei
// Riegel: die unsichtbare Bruecke im CSS und der Nachlauf im JS. Eine Bruecke ohne die andere ist
// ein Menue, das beim Hochfahren zuklappt.
const brueckenRegeln = (css.match(/\.map-layer-picker__(grund|ebenen|stufe)[^{]*::after\s*\{/g) || []);
assert.ok(brueckenRegeln.length >= 1,
	"jede Stufe traegt ihre Bruecke -- oder eine geteilte Regel deckt beide");
```

- [ ] **Schritt 2: Test fahren, Fehlschlag sehen**

- [ ] **Schritt 3: Die dritte Stufe montieren**

```js
		/**
		 * DIE DRITTE STUFE -- der Untergrund unter einer Landschafts-Ebene (09.09.2026).
		 *
		 * 🔴 NUR IM BEARBEITEN-MODUS. Der Besucher hat in den Landschaften 0 % Untergrund; ein
		 * Menue, das etwas Unsichtbares waehlt, ist kein Menue. Der Riegel faellt GESCHLOSSEN aus:
		 * ohne die Auskunft keine dritte Stufe.
		 * ⭐ Und daraus faellt die Begruendung ab, warum der Editor seine Reiterleiste behaelt: der
		 * Faecher kostet ihn zwei Klicks fuer eine Ebene, die Leiste einen.
		 */
		function imEditor() {
			return typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE;
		}

		var stufeGrundUnterEbene = macheStufe({
			klasse: "map-layer-picker__grund",
			ariaLabel: "Untergrund",
			quelleContainer: function () { return stufeEbenen.element; },
			quelleSelektor: function (wert) { return '.map-layer-picker__cell[data-ebene="' + wert + '"]'; },
			eintraege: untergruende,
			istAktiv: function (e) { var a = aktiverUntergrund(); return Boolean(a) && e.wert === a.wert; },
			baueZelle: grundZelle,
			beiWahl: function (wert, ebene) {
				if (ebene) { waehleEbene(ebene); }
				waehleGrund(wert);   // waehlt zugleich die Ansicht und schliesst
			},
			// 💣 GEMESSEN, nicht gerechnet: die Hoehe der zweiten Reihe haengt an ihrer
			// Beschriftung und ist keine Konstante.
			hoeheUeber: function () { return stufeEbenen.element; }
		});
		stufeEbenen.nachbarn = [stufeGrundUnterEbene];
		stufeGrundUnterEbene.nachbarn = [stufeEbenen];
```

Und in `stufeEbenen`s Zellen-Verdrahtung: eine Ebenenzelle bekommt ihr Untermenü **nur**, wenn
`imEditor() && untergruende().length > 1` — sonst wählt der erste Klick sofort (die eine Regel).

- [ ] **Schritt 4: CSS für die dritte Lage**

Die Reihe wird von `macheStufe` per `style.bottom` gesetzt (gemessen). Im CSS braucht sie nur
`z-index: 2` (über der zweiten Stufe) und dieselbe Brücke.

- [ ] **Schritt 5: Tests fahren**

```bash
node js/ui/__tests__/landschaften-untermenue.test.js && node js/ui/__tests__/map-layer-picker.test.js
```

- [ ] **Schritt 6: Mockup nachziehen und im Browser ansehen**

```bash
node tools/bau-ansicht-untergrund-mockup.js && node tools/__tests__/ansicht-untergrund-mockup.test.js
```

Der **Ablauf** wird ausgeführt, nicht gemessen: Landschaften überfahren → fünf Ebenen; auf einer
Ebene verweilen → drei Untergründe darüber; über die Lücken fahren, ohne dass etwas zuklappt; einen
Untergrund klicken → Ansicht + Ebene + Untergrund sitzen, Menü zu. Dann dasselbe mit `?edit=1`
**und** ohne — ohne darf die dritte Stufe **nicht** kommen.

🪤 `computer{action:left_click_drag}` der Browser-Pane erzeugt kein `mouseup`/`click` — Ziehgesten
sind damit nicht messbar. Ein „geht nicht" aus diesem Werkzeug ist kein Befund.

- [ ] **Schritt 7: Commit (NICHT pushen)**

Betreff: `feat(kartenfaecher): dritte Stufe -- der Untergrund unter einer Landschafts-Ebene, nur im Editor`.

---

## Aufgabe 8: Die Leiste verschwindet für Besucher

**Dateien:**
- Ändern: `js/map-features/map-features-ecosystem-layer-switch.js` (`syncEcosystemControlsVisibility`)
- Ändern: `js/ui/map-layer-picker.js` (`GRUND_DECKKRAFT.ecosystem`)
- Ändern: `tools/bau-ansicht-untergrund-mockup.js` + Mockup neu erzeugen
- Test: `js/map-features/__tests__/ecosystem-frontend-profil.test.js` (erweitert)
- Ändern: `AGENTS.md` (§11-Eintrag „Der Kartenfächer")

⭐ Der Untergrund steht seit **Aufgabe 2** auf 0 % (er ist Teil des einen Profils) — hier fällt nur
noch die Vorschau im Fächer nach und die Leiste geht für Besucher weg.

- [ ] **Schritt 1: Die fehlschlagenden Zusicherungen ergänzen**

In `js/map-features/__tests__/ecosystem-frontend-profil.test.js`:

```js
// ⚠️ Die Kacheln werden bei 0 % ABGEHAENGT, nicht nur ausgeblendet -- Leaflet fordert sonst
// Bilder an, die niemand sieht.
assert.ok(/syncEcosystemBaseTiles\(!\(active && percent <= 0\)\)/.test(quelle),
	"bei 0 % gar nicht erst laden");

// ---- Die Reiterleiste gehoert dem Editor ---------------------------------------------------------
// ⚠️ Versteckt wird die ZEILE, nicht #ecosystem-controls: darin sitzt auch die Meldung „Ebene ist
// abgeschaltet", und die geht den Besucher genauso an.
assert.ok(/\.ecosystem-layer-row[\s\S]{0,200}hidden\s*=\s*!operable/.test(quelle),
	"die Reiterzeile haengt an `operable`, wie der Untergrund-Regler daneben");
assert.ok(/controlsElement\.hidden\s*=\s*!shouldShow/.test(quelle),
	"...und der Behaelter weiterhin an `shouldShow` -- sonst verschwindet die Abschalt-Meldung mit.");
```

- [ ] **Schritt 2: Test fahren, Fehlschlag sehen**

- [ ] **Schritt 3: Die zwei Werte umstellen**

⚠️ `ECOSYSTEM_UNDERGROUND_FRONTEND = 25` **prüfen, nicht blind löschen**: erst alle Leser suchen
(`grep -n ECOSYSTEM_UNDERGROUND_FRONTEND`). Bleibt sie der Rückfall in
`applyEcosystemUndergroundOpacity` für den Fall „kein Soll", bleibt sie stehen — dann aber mit einem
Kommentar, der genau das sagt.

In `syncEcosystemControlsVisibility`, neben dem Untergrund-Regler:

```js
	// 🔴 DIE REITERLEISTE GEHOERT SEIT DEM 09.09.2026 DEM EDITOR (Owner: „Das Toggle-Button-Menue
	// oben soll fuer regulaere Nutzer verschwinden und ins Faechermenue uebergehen"). Sie bleibt im
	// DOM -- sie IST der Ebenenzustand, den der Kartenfaecher bedient (js/ui/map-layer-picker.js).
	// ⚠️ Versteckt wird die ZEILE, nicht der Behaelter: in #ecosystem-controls sitzt auch die
	// Meldung „Ebene ist abgeschaltet", und die geht den Besucher genauso an.
	// ⭐ Und sie bleibt dem Editor, weil der Faecher ihn zwei Klicks je Ebene kostet (eine Zelle mit
	// Untermenue oeffnet es, eine ohne waehlt) -- die Leiste ist sein Ein-Klick-Weg.
	const layerRow = controlsElement.querySelector(".ecosystem-layer-row");
	if (layerRow) {
		layerRow.hidden = !operable;
	}
```

In `js/ui/map-layer-picker.js`:

```js
	// 🔴 Die Landschaften-Ansicht zeigt seit dem 09.09.2026 GAR KEINEN Untergrund (Owner). Die
	// Zelle zeigt deshalb den Pergamentgrund --color-ecosystem-underground (#d3cec2) und kein
	// Kachelbild -- ein Vorschaubild, das etwas anderes ankuendigt als die Karte zeigt, ist genau
	// die Falle, vor der tools/layer-tiles/capture.js warnt.
	// ⚠️ Der Editor mit Regler auf 25 % sieht dadurch eine Vorschau, die von seiner Karte abweicht.
	// Gewollt: die Zelle zeigt die ANSICHT, nicht seine persoenliche Einstellung.
	const GRUND_DECKKRAFT = {
		ecosystem: 0
	};
```

- [ ] **Schritt 4: Tests fahren**

```bash
node js/map-features/__tests__/ecosystem-frontend-profil.test.js && node js/ui/__tests__/landschaften-untermenue.test.js && node js/ui/__tests__/map-layer-picker.test.js
```

- [ ] **Schritt 5: Gegen Mutationen fahren**

1. `layerRow.hidden = !operable` → `= !shouldShow`.
2. `controlsElement.hidden = !shouldShow` → `= !operable` (nimmt die Abschalt-Meldung mit).
3. `GRUND_DECKKRAFT.ecosystem` zurück auf `0.25` (die Vorschau lügt dann über die Karte).

- [ ] **Schritt 6: AGENTS.md nachziehen**

Der §11-Eintrag **„Der Kartenfächer"** bekommt die dritte Stufe, die Regel „eine Zelle mit
Untermenü öffnet es, eine ohne wählt", den Wegfall des Untergrunds unter Landschaften und den
Wasserton. ⚠️ **Keine Zahl schreiben, die wie eine vollständige Liste liest** („zweistufig",
„drei Untergründe") — dieses Dokument protokolliert mehrfach, was das kostet.

- [ ] **Schritt 7: Mockup nachziehen, ganzes Testfeld, Browser-Abnahme**

```bash
node tools/bau-ansicht-untergrund-mockup.js
```

Dann das volle Feld (siehe Globale Vorgaben), **beide Muster**, JS und PHP, mit Dateizählung:
`… -print0 | tr -dc '\0' | wc -c` gegen die Zahl aus `.github/workflows/deploy-avesmaps-strato.yml`.
Eine viel zu kleine Zahl ist der einzige Unterschied zwischen diesem Fehler und einem grünen Feld.

Browser, als **Besucher** (kein `edit=1`): Landschaften wählen → keine Reiterleiste, kein
Kachelbild, fünf Ebenen im Fächer, jede mit einem Klick erreichbar. Konsole lesen — nach jedem
Push, der die Karte berührt, wird die Live-Seite als Besucher geladen und die Konsole gelesen
(die Lehre vom 03.09.2026, zwei Stunden ohne Beschriftungen).

Dann als **Editor**: Leiste da, dritte Stufe da, Untergrund-Regler wirkt.

- [ ] **Schritt 8: Die zwei Prüfagenten**

`usability-konsistenz` (Entwurf gegen Diff: sind alle 💣/⚠️/🔴 des Entwurfs erfüllt oder
ausdrücklich verworfen?) und `usability-design` (Mockup gegen gebauten Zustand, hell UND dunkel).
🪤 Agenten dürfen **kein** `git checkout`/`stash`/`restore` fahren — ein Prüfagent hat damit schon
einmal ein Build-Produkt auf den Commit-Stand zurückgesetzt.

- [ ] **Schritt 9: Commit + push**

```bash
git add js/map-features/map-features-ecosystem-layer-switch.js js/ui/map-layer-picker.js js/map-features/__tests__/ecosystem-frontend-profil.test.js tools/bau-ansicht-untergrund-mockup.js docs/ansicht-untergrund-mockup.html AGENTS.md
git commit -F <nachricht.txt>
```

Betreff nennt die sichtbare Wirkung: `ui(landschaften): die fuenf Ebenen stehen im Kartenfaecher --
die Toggle-Leiste gehoert dem Editor`.

Vor dem Push `gh run list --limit 3`; nach dem Push den Lauf auf **success** prüfen, nicht bloß auf
„gelaufen". Bei rot **nicht** auf den nächsten hoffen — der vergiftet den `?v=`-Stempel und macht
es schlimmer (steht als Warnung in genau dieser Datei, `map-layer-picker.js`, zweimal passiert).

**Owner-Blick.** Danach ist der Umbau fertig.

---

## Selbstprüfung des Plans

**Entwurfsabdeckung:** §1 Stufen → Aufgaben 4–7 · §1 zweite Zeile → Aufgabe 6 · §2 Zustand →
Aufgabe 5 · §3.1 alles an + §3.2 Untergrund 0 % + §3.3 Nutzerwahl → Aufgabe 2 · §3.2 Vorschau im
Fächer + Leiste verstecken → Aufgabe 8 · §4 Vektoren → Aufgabe 3 · §5 Wasserton → Aufgabe 1 ·
§6 „nicht dazu" → nirgends gebaut · §7 Tests → je Aufgabe · §8 offene Punkte → bleiben offen.

**Namensgleichheit:** `macheStufe` (3) wird in 4 und 6 mit derselben Signatur gerufen;
`ebenen()`/`aktiveEbene()`/`waehleEbene()` (4) werden in 5 und 6 unter genau diesen Namen benutzt;
`stufeEbenen`/`stufeUntergrund` heißen durchgehend so; `--color-water` (1) wird in 2 gelesen.

**Offen, bewusst:** ob die fünf Ebenenzellen am Telefon in eine oder zwei Reihen gehören,
entscheidet der Blick am Gerät (Aufgabe 7, Schritt 6) — die Media Query ist vorbereitet, die Wahl
nicht getroffen.
