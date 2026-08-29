# Kraftlinien-Kurvenform — Bauplan

> **Für agentische Arbeiter:** ERFORDERLICHE UNTER-FÄHIGKEIT: `superpowers:subagent-driven-development`
> (empfohlen) oder `superpowers:executing-plans`, um diesen Plan Aufgabe für Aufgabe umzusetzen.
> Die Schritte tragen Kästchen (`- [ ]`).

**Ziel:** Eine Kraftlinie bekommt die Eigenschaft „Kurvenform" — ein Wert je Linie, der jedes ihrer
Segmente zu einem Bogen krümmt; die wabernden Stränge, die Klick-Linie und die Beschriftung folgen
ihm.

**Architektur:** Die Krümmung ist ein **Summand auf derselben Normalen wie das Wabern**, gerechnet
von **einem** reinen Helfer in `js/map-features/powerline-topology.js`, den vier Erzeuger rufen
(Stränge, Klick-Linie, Label-Linie, Live-Vorschau). Der Wert liegt als `properties.curve` in
`properties_json` — kein DDL. Geschrieben wird er wie `show_label` auf alle Segmente der
Namensgruppe.

**Technik:** Vanilla JS ohne Bauschritt, Leaflet 1.9.4, PHP 8 + PDO. Tests: `node <datei>.test.js`
und `php -d zend.assertions=1 -d assert.exception=1 … <datei>-test.php`.

**Entwurf:** `docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md`
**Mockup:** `docs/kraftlinien-kurvenform-mockup.html`

---

## Globale Rahmenbedingungen

Diese gelten für **jede** Aufgabe und werden nicht in jeder wiederholt.

- **Sprache:** Code-Kommentare, Commit-Betreffe und Doku auf **Deutsch** (AGENTS.md §8). Passe dich
  der Datei an, in der du stehst.
- **Geteilter Arbeitsbaum:** Niemals `git add -A`, `git add .` oder `git commit -a`. Andere
  Sitzungen haben unfertige Arbeit im selben Checkout. Immer erst `git status`, dann **nur die
  selbst berührten Pfade einzeln** stagen. `.claude/launch.json` ist ungetrackt und gehört anderen
  Sitzungen — **nie** committen.
- **Vor jedem Push das GANZE Testfeld**, nicht die eigenen Tests. Muster des Deploy-Tors:
  ```bash
  find js tools \( \( -path '*__tests__*' -name '*.test.js' \) -o \( -name 'test-*.mjs' -not -path '*__tests__*' \) \) -print0 | xargs -0 -P 8 -I{} sh -c 'node "{}" >/dev/null 2>&1 || echo "ROT: {}"' > /tmp/rot-js.txt
  ```
  💣 **Die äußere Klammer um beide Gruppen ist tragend** — ohne sie bindet `-print0` nur an die
  zweite Gruppe, es laufen 21 statt ~312 Dateien, und der Lauf meldet fröhlich „null rot".
  ⭐ **Gegenprobe, die nichts kostet:** `… -print0 | tr -dc '\0' | wc -c` muss die Größenordnung aus
  `.github/workflows/deploy-avesmaps-strato.yml` ergeben (26.08.2026: 312 JS). Eine viel zu kleine
  Zahl ist der einzige Unterschied zwischen diesem Fehler und einem grünen Feld.
  💣 **Kein `2>&1` auf die Ergebnisdatei** — `xargs`-Warnungen landeten sonst darin und lesen sich
  wie rote Tests.
- **PHP-Feld** analog, **mit den Erweiterungen**, sonst melden 45 Tests rot, die nur die Erweiterung
  vermissen:
  ```bash
  find api tools \( -path '*__tests__*' -name '*.php' \) -o \( -name 'test-*.php' -not -path '*__tests__*' \) -print0 | xargs -0 -P 8 -I{} sh -c 'php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll -d extension=php_gd.dll "{}" >/dev/null 2>&1 || echo "ROT: {}"' > /tmp/rot-php.txt
  ```
  ⚠️ Vorbestehend rot bleibt genau einer: `linkcheck/link-url-test.php` (echter DNS-Abruf).
- **Sichtbare Änderungen gehen EINZELN live.** Aufgaben 4 und 5 sind sichtbar: je ein Commit, ein
  Push, dann der Blick des Owners, dann die nächste. **Nicht bündeln.** Aufgaben 1–3 und 6 sind
  unsichtbar (kein Bestandswert ist ≠ 0) und dürfen zusammengehen.
- **Warte den Deploy-Lauf ab, bevor du erneut pushst.** Ein zweiter Push bricht den ersten Lauf ab,
  und ein abgebrochener Lauf lädt **nichts** hoch — die Dateien jenes Commits kommen dann von selbst
  nie mehr live.
- **Wertebereich:** `curve` ist eine Zahl `−45 … +45`, `0` = gerade. Überall geklemmt, nie
  abgelehnt.
- **Keine Farbe, kein Radius, kein Trenner hartkodiert** — Token aus `css/base/tokens.css`
  (AGENTS.md §12). Betrifft Aufgaben 4 und 5.

---

## Dateiübersicht

| Datei | Verantwortung | Aufgabe |
|---|---|---|
| `js/map-features/powerline-topology.js` | **die Rechnung** — reiner Helfer, kein DOM, kein Leaflet | 1 |
| `js/map-features/__tests__/kraftlinie-kurvenform.test.js` | die Rechnung festnageln | 1 |
| `js/map-features/map-features-powerlines.js` | die drei Kartenzeichner rufen den Helfer | 2 |
| `js/map-features/__tests__/kraftlinie-kurve-alle-erzeuger.test.js` | dass **alle drei** ihn rufen | 2 |
| `api/_internal/map/features.php` | Schreibweg + Erb-Liste | 3 |
| `api/edit/map/powerlines.php` | Lesefeed für den Editor | 3 |
| `api/_internal/map/__tests__/kraftlinie-kurve-schreiben-test.php` | Schreibweg festnageln | 3 |
| `api/_internal/map/__tests__/powerline-inherit-test.php` | (bestehend) Erb-Liste um `curve` | 3 |
| `html/wiki-sync-powerline-editor.html` | Schieber im Identität-Block + Speichern | 4 |
| `js/pages/__tests__/kraftlinie-kurve-editor.test.js` | Formular und Schreibrumpf | 4 |
| `js/review/review-powerline-list.js` | Wegblenden + Vorschau-Brücke im Hauptfenster | 5 |
| `js/ui/kraftlinie-kurve-regler.js` | der schwebende Schieber (neu) | 5 |
| `css/components/kraftlinie-kurve-regler.css` | sein Aussehen (neu) | 5 |
| `js/ui/__tests__/kraftlinie-kurve-regler.test.js` | der Regler als Bauteil | 5 |
| `js/pages/svg-export-build.js` | der Abzug zeichnet die Kurve | 6 |
| `js/pages/__tests__/kraftlinie-kurve-abzug.test.js` | der Abzug festgenagelt | 6 |

---

## Aufgabe 1: Die Rechnung (reiner Helfer)

**Dateien:**
- Ändern: `js/map-features/powerline-topology.js` (ans Ende, vor `module.exports`)
- Test: `js/map-features/__tests__/kraftlinie-kurvenform.test.js` (neu)

**Schnittstellen:**
- Verbraucht: nichts.
- Erzeugt — **diese drei Namen benutzen alle folgenden Aufgaben, buchstabengetreu:**
  - `avesmapsPowerlineCurveNormalOffset(curve, t, ax, ay, bx, by) -> number`
    Der vorzeichenrichtige Normalenversatz in Karteneinheiten an der Stelle `t ∈ [0,1]`.
  - `avesmapsPowerlineCurveSteps(curve, basis) -> number` — die Stützpunktzahl.
  - `avesmapsPowerlineCurvedPoints(ax, ay, bx, by, curve, steps) -> Array<{x, y}>`
    Die reine gekrümmte Bahn **ohne** Wabern (für Klick-Linie, Label-Linie, Vorschau, Abzug).

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Neue Datei `js/map-features/__tests__/kraftlinie-kurvenform.test.js`:

```js
// Die Rechnung hinter der Kurvenform einer Kraftlinie -- rein, ohne Leaflet und ohne DOM.
// Lauf (aus dem Repo-Wurzelverzeichnis):
//   node js/map-features/__tests__/kraftlinie-kurvenform.test.js
//
// Entwurf: docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md
const assert = require("assert");
const {
	avesmapsPowerlineCurveNormalOffset,
	avesmapsPowerlineCurveSteps,
	avesmapsPowerlineCurvedPoints,
} = require("../powerline-topology.js");

// ---- 1. Die Nicht-Regression: curve = 0 ist EXAKT null -------------------------------------
// 🔴 Das ist die wichtigste Zusicherung des ganzen Vorhabens. Alle 62 Kraftlinien im Bestand sind
// gerade; wenn hier etwas anderes als eine harte Null herauskommt, wackelt die ganze Karte.
for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
	assert.strictEqual(
		avesmapsPowerlineCurveNormalOffset(0, t, 0, 0, 20, 0), 0,
		`curve = 0 muss bei t = ${t} exakt 0 sein, nicht nur nahe null`
	);
}
assert.strictEqual(avesmapsPowerlineCurveNormalOffset(null, 0.5, 0, 0, 20, 0), 0);
assert.strictEqual(avesmapsPowerlineCurveNormalOffset(undefined, 0.5, 0, 0, 20, 0), 0);
assert.strictEqual(avesmapsPowerlineCurveNormalOffset("quatsch", 0.5, 0, 0, 20, 0), 0);

// ---- 2. Die Scheitelhoehe ist der versprochene Prozentsatz der SEHNE ------------------------
// Sehne 20 Einheiten, 25 % => 5,0 Einheiten im Scheitel. Die Parabel 4h*t(1-t) erreicht bei
// t = 0,5 genau h.
assert.ok(
	Math.abs(avesmapsPowerlineCurveNormalOffset(25, 0.5, 0, 0, 20, 0) - 5) < 1e-9,
	"Scheitel bei t=0,5 muss curve/100 * Sehnenlaenge sein"
);
// Und sie skaliert mit der Sehne, nicht absolut: dieselbe Zahl auf halber Laenge = halbe Hoehe.
assert.ok(
	Math.abs(avesmapsPowerlineCurveNormalOffset(25, 0.5, 0, 0, 10, 0) - 2.5) < 1e-9,
	"der Wert ist relativ zur Sehne -- halbe Sehne, halbe Hoehe"
);

// ---- 3. Die Enden sind null (die Nodices liegen AUF der Linie) ------------------------------
assert.strictEqual(avesmapsPowerlineCurveNormalOffset(45, 0, 0, 0, 20, 0), 0);
assert.strictEqual(avesmapsPowerlineCurveNormalOffset(45, 1, 0, 0, 20, 0), 0);

// ---- 4. Negativ spiegelt positiv EXAKT (der Owner-Satz vom 29.08.2026) ----------------------
for (const t of [0.15, 0.35, 0.5, 0.8]) {
	assert.strictEqual(
		avesmapsPowerlineCurveNormalOffset(-30, t, 0, 0, 20, 0),
		-avesmapsPowerlineCurveNormalOffset(30, t, 0, 0, 20, 0),
		`-30 muss bei t = ${t} die exakte Spiegelung von +30 sein`
	);
}

// ---- 5. Der Bereich wird GEKLEMMT, nicht abgelehnt ------------------------------------------
assert.strictEqual(
	avesmapsPowerlineCurveNormalOffset(999, 0.5, 0, 0, 20, 0),
	avesmapsPowerlineCurveNormalOffset(45, 0.5, 0, 0, 20, 0),
	"ueber 45 wird auf 45 geklemmt"
);
assert.strictEqual(
	avesmapsPowerlineCurveNormalOffset(-999, 0.5, 0, 0, 20, 0),
	avesmapsPowerlineCurveNormalOffset(-45, 0.5, 0, 0, 20, 0),
	"unter -45 wird auf -45 geklemmt"
);

// ---- 6. DIE KANONISCHE RICHTUNG -------------------------------------------------------------
// 💣 Der Kern von Entwurf §7: dasselbe Segment mit vertauschten Endpunkten muss auf DIESELBE
// Seite der Karte ausschlagen. Sonst klappt ein Umsortieren der Nodices (avesmapsReorderPowerlineLine
// kann Segmentrichtungen tauschen) jeden Bogen der Linie still um.
//
// Der Versatz laeuft entlang der Normalen n = (-ty, tx). Bei umgekehrter Speicherrichtung dreht
// sich n; damit der Punkt dennoch am selben Fleck liegt, muss der Versatz das Vorzeichen wechseln.
const hin = avesmapsPowerlineCurveNormalOffset(30, 0.5, 0, 0, 20, 0);    // West -> Ost
const her = avesmapsPowerlineCurveNormalOffset(30, 0.5, 20, 0, 0, 0);    // Ost -> West
assert.strictEqual(her, -hin, "die kanonische Richtung muss das Vorzeichen mitdrehen");

// Bei senkrechten Segmenten entscheidet y (Sued -> Nord ist die kanonische Richtung).
const hoch = avesmapsPowerlineCurveNormalOffset(30, 0.5, 0, 0, 0, 20);
const runter = avesmapsPowerlineCurveNormalOffset(30, 0.5, 0, 20, 0, 0);
assert.strictEqual(runter, -hoch, "bei gleichem x entscheidet y ueber die kanonische Richtung");

// Die Gegenprobe, die den Sinn der Regel misst: die tatsaechlich GEZEICHNETEN Punkte liegen bei
// vertauschten Endpunkten am selben Fleck (nur in umgekehrter Reihenfolge).
const bahnHin = avesmapsPowerlineCurvedPoints(0, 0, 20, 0, 30, 8);
const bahnHer = avesmapsPowerlineCurvedPoints(20, 0, 0, 0, 30, 8);
assert.strictEqual(bahnHin.length, bahnHer.length);
bahnHin.forEach((p, i) => {
	const q = bahnHer[bahnHer.length - 1 - i];
	assert.ok(Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9,
		`Punkt ${i} liegt bei vertauschten Endpunkten nicht am selben Fleck`);
});

// ---- 7. Die Stuetzpunktzahl -----------------------------------------------------------------
// 🔴 Bei curve = 0 EXAKT die heutige Grundzahl -- die 62 geraden Linien zahlen nichts.
assert.strictEqual(avesmapsPowerlineCurveSteps(0, 8), 8);
assert.strictEqual(avesmapsPowerlineCurveSteps(45, 8), 24, "voller Ausschlag => 24");
assert.strictEqual(avesmapsPowerlineCurveSteps(-45, 8), 24, "das Vorzeichen aendert die Zahl nicht");
// Monoton dazwischen.
let vorher = avesmapsPowerlineCurveSteps(0, 8);
for (let c = 1; c <= 45; c++) {
	const jetzt = avesmapsPowerlineCurveSteps(c, 8);
	assert.ok(jetzt >= vorher, `Stuetzpunkte duerfen bei ${c} nicht sinken`);
	vorher = jetzt;
}
// ⚠️ Eine Grundzahl ueber 24 darf nicht nach unten gezogen werden (jemand dreht segmentCount hoch).
assert.strictEqual(avesmapsPowerlineCurveSteps(45, 32), 32, "die Grundzahl ist die Untergrenze");

// ---- 8. Die Bahn: Endpunkte exakt getroffen -------------------------------------------------
const bahn = avesmapsPowerlineCurvedPoints(3, 7, 23, 7, 25, 12);
assert.strictEqual(bahn.length, 13, "steps = 12 ergibt 13 Punkte");
assert.ok(Math.abs(bahn[0].x - 3) < 1e-9 && Math.abs(bahn[0].y - 7) < 1e-9,
	"der erste Punkt IST der Nodix -- er darf nicht danebenliegen");
assert.ok(Math.abs(bahn[12].x - 23) < 1e-9 && Math.abs(bahn[12].y - 7) < 1e-9,
	"der letzte Punkt IST der Nodix");
assert.ok(Math.abs(bahn[6].y - (7 + 5)) < 1e-9, "der Scheitel steht 25 % von 20 = 5 Einheiten ab");

// ---- 9. Entartete Faelle fallen offen aus ---------------------------------------------------
// Ein Segment der Laenge 0 darf nicht durch null teilen und keine NaN erzeugen.
const entartet = avesmapsPowerlineCurvedPoints(5, 5, 5, 5, 40, 8);
entartet.forEach((p, i) => {
	assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `Punkt ${i} eines Nullsegments ist NaN`);
});

console.log("OK: Kraftlinien-Kurvenform -- Rechnung, kanonische Richtung, Stuetzpunkte, Bahn.");
```

- [ ] **Schritt 2: Test laufen lassen, er MUSS fehlschlagen**

```bash
node js/map-features/__tests__/kraftlinie-kurvenform.test.js
```
Erwartet: `TypeError: avesmapsPowerlineCurveNormalOffset is not a function`.

⚠️ Schlägt er mit einer **anderen** Meldung fehl (z. B. `Cannot find module`), stimmt der Pfad
nicht — repariere das, bevor du weitergehst. Ein Test, der aus dem falschen Grund rot ist, belegt
nichts.

- [ ] **Schritt 3: Die Rechnung schreiben**

In `js/map-features/powerline-topology.js`, **vor** dem `module.exports`-Block ans Ende einfügen:

```js
// ── Die Kurvenform ───────────────────────────────────────────────────────────────────────────
// Entwurf: docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md
//
// Eine Kraftlinie liegt auf der Karte als Strecke: createPowerlineStrandLatLngs nimmt aus der
// Geometrie nur ersten und letzten Punkt. Die „Kurvenform" ist ein Versatz entlang derselben
// Normalen, auf der schon das Wabern sitzt -- nur ohne Zeit.
//
// 💣 VIER ERZEUGER, EINE RECHNUNG. Die Straenge, die unsichtbare Klick-Linie, die Label-Linie und
// die Live-Vorschau des Editors muessen dieselbe Kurve zeichnen. Bliebe die Klick-Linie gerade,
// laege das Klickziel bei starker Kruemmung im leeren Gelaende neben der Linie -- und die
// Kernstraenge sind 1,5 px breit und wabern, sind also ohnehin kaum treffbar (genau dafuer gibt es
// die Hit-Linie). Eine Regel, die einen von vier Erzeugern bindet, ist keine Regel.

// Der Wert ist ein Prozentsatz der Sehne, nie Karteneinheiten.
const AVESMAPS_POWERLINE_CURVE_MAX = 45;
// Stuetzpunkte bei vollem Ausschlag. Ein Bogen ueber die heutigen 8 ist ein sichtbares Polygon.
const AVESMAPS_POWERLINE_CURVE_STEPS_MAX = 24;

function avesmapsPowerlineCurveClamp(curve) {
	const zahl = Number(curve);
	if (!Number.isFinite(zahl)) {
		return 0;
	}
	return Math.max(-AVESMAPS_POWERLINE_CURVE_MAX, Math.min(AVESMAPS_POWERLINE_CURVE_MAX, zahl));
}

// 🔴 DIE KANONISCHE RICHTUNG -- der Kern von Entwurf §7.
// Das Vorzeichen der Kruemmung haengt NICHT an der Speicherrichtung (from_public_id ->
// to_public_id), sondern an der Geometrie: West -> Ost, bei gleichem x Sued -> Nord.
//
// 💣 Grund: die Nodices lassen sich im Editor mit ▲▼ umsortieren, und avesmapsReorderPowerlineLine
// kann dabei Segmentrichtungen tauschen. An from->to gebunden klappte JEDER Bogen dieser Linie auf
// die andere Seite, ohne dass jemand die Kurve angefasst haette -- und bei einer Linie ausserhalb
// des Blickfelds faellt das nie auf.
// ⚠️ Der Preis, benannt statt versteckt: eine Kette, die ihre Ost-West-Richtung wechselt, legt die
// Boegen benachbarter Segmente auf gegenueberliegende Seiten. Trifft lange verzweigte Linien, nicht
// die einsegmentigen, aus denen der Auftrag kommt. Wer das aendern will, aendert es HIER.
function avesmapsPowerlineCurveSign(ax, ay, bx, by) {
	if (bx !== ax) {
		return bx > ax ? 1 : -1;
	}
	return by >= ay ? 1 : -1;
}

/**
 * Der vorzeichenrichtige Normalenversatz an der Stelle t.
 * @param {number} curve  Prozent der Sehne, -45..45. 0 = gerade.
 * @param {number} t      0..1 entlang der Sehne.
 * @return {number} Versatz in Karteneinheiten, entlang n = (-ty, tx).
 */
function avesmapsPowerlineCurveNormalOffset(curve, t, ax, ay, bx, by) {
	const c = avesmapsPowerlineCurveClamp(curve);
	if (c === 0) {
		return 0;
	}
	const dx = bx - ax;
	const dy = by - ay;
	const sehne = Math.sqrt(dx * dx + dy * dy);
	if (!(sehne > 0)) {
		return 0;
	}
	const h = (c / 100) * sehne;
	// Parabel (quadratische Bézier), Owner-Entscheid 29.08.2026. Scheitel bei t = 0,5 ist genau h.
	// ⭐ Bewusst KEIN Kreisbogen: der dividiert durch die Bogenhoehe und subtrahiert zwei grosse
	// Zahlen voneinander (R ≈ 5000 bei schwacher Kruemmung) -- eine Ausloeschungsfalle ohne Gewinn,
	// bis rund 30 % sind beide nicht zu unterscheiden.
	return 4 * h * t * (1 - t) * avesmapsPowerlineCurveSign(ax, ay, bx, by);
}

/**
 * Wieviele Stuetzpunkte dieses Segment braucht.
 * 🔴 curve = 0 ergibt EXAKT die Grundzahl -- die geraden Linien zahlen nichts. Eine pauschale
 * Erhoehung kostete das Dreifache pro Frame bei 30 fps, bezahlt von Linien, die alle gerade sind.
 */
function avesmapsPowerlineCurveSteps(curve, basis) {
	const grund = Math.max(2, Math.round(Number(basis) || 8));
	const staerke = Math.abs(avesmapsPowerlineCurveClamp(curve)) / AVESMAPS_POWERLINE_CURVE_MAX;
	if (staerke === 0) {
		return grund;
	}
	// ⚠️ max(), damit eine hochgedrehte Grundzahl nicht nach UNTEN gezogen wird.
	const ziel = Math.max(grund, AVESMAPS_POWERLINE_CURVE_STEPS_MAX);
	return Math.round(grund + staerke * (ziel - grund));
}

/**
 * Die reine gekruemmte Bahn OHNE Wabern -- fuer Klick-Linie, Label-Linie, Vorschau und SVG-Abzug.
 * @return {Array<{x: number, y: number}>} steps + 1 Punkte; erster und letzter sind exakt die
 *   uebergebenen Endpunkte (ein Nodix ist ein Ort, die Linie muss ihn treffen).
 */
function avesmapsPowerlineCurvedPoints(ax, ay, bx, by, curve, steps) {
	const n = Math.max(1, Math.round(Number(steps) || 1));
	const dx = bx - ax;
	const dy = by - ay;
	const sehne = Math.sqrt(dx * dx + dy * dy);
	const tx = sehne > 0 ? dx / sehne : 0;
	const ty = sehne > 0 ? dy / sehne : 0;
	const nx = -ty;
	const ny = tx;
	const punkte = [];
	for (let i = 0; i <= n; i++) {
		const t = i / n;
		const off = avesmapsPowerlineCurveNormalOffset(curve, t, ax, ay, bx, by);
		punkte.push({ x: ax + dx * t + nx * off, y: ay + dy * t + ny * off });
	}
	return punkte;
}
```

Und im `module.exports`-Block die drei Namen ergänzen:

```js
		avesmapsPowerlineStatusMarker,
		avesmapsPowerlineCurveNormalOffset,
		avesmapsPowerlineCurveSteps,
		avesmapsPowerlineCurvedPoints,
```

- [ ] **Schritt 4: Test laufen lassen, er MUSS jetzt grün sein**

```bash
node js/map-features/__tests__/kraftlinie-kurvenform.test.js
```
Erwartet: `OK: Kraftlinien-Kurvenform -- Rechnung, kanonische Richtung, Stuetzpunkte, Bahn.`

- [ ] **Schritt 5: Die Nachbarn gegenprüfen**

`powerline-topology.js` wird von der Karte **und** vom Editor geladen; neue Top-Level-Namen könnten
kollidieren.

```bash
node js/map-features/__tests__/powerline-span.test.js
node js/map-features/__tests__/powerline-reorder-diff.test.js
node js/map-features/__tests__/powerline-connected-endpoints.test.js
```
Erwartet: alle drei grün.

- [ ] **Schritt 6: Committen**

```bash
git add js/map-features/powerline-topology.js js/map-features/__tests__/kraftlinie-kurvenform.test.js
git commit -m "kraftlinien(kurve): die Rechnung -- Parabel, kanonische Richtung, abgeleitete Stuetzpunkte"
```

---

## Aufgabe 2: Die drei Kartenzeichner benutzen sie

**Dateien:**
- Ändern: `js/map-features/map-features-powerlines.js` — `createPowerlineStrandLatLngs` (ab Z. 63),
  `createPowerlineLayer` (ab Z. 426), `refreshPowerlineLayers` (ab Z. 525)
- Test: `js/map-features/__tests__/kraftlinie-kurve-alle-erzeuger.test.js` (neu)

**Schnittstellen:**
- Verbraucht: `avesmapsPowerlineCurveNormalOffset`, `avesmapsPowerlineCurveSteps`,
  `avesmapsPowerlineCurvedPoints` aus Aufgabe 1.
- Erzeugt:
  - `getPowerlineCurve(powerline) -> number` — liest `properties.curve`, geklemmt, 0 als Rückfall.
  - `getPowerlineCurvedLatLngs(latLngs, curve) -> Array<L.LatLng>` — die Bahn für Klick- und
    Label-Linie.
  - `avesmapsPowerlineCurveVorschau` — Objekt `{ name: string|null, curve: number }`, der
    **flüchtige** Vorschauwert für Aufgabe 5. Vorbelegt `{ name: null, curve: 0 }`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Neue Datei `js/map-features/__tests__/kraftlinie-kurve-alle-erzeuger.test.js`:

```js
// Dass ALLE DREI Kartenzeichner der Kraftlinie die Kurve zeichnen -- zur Laufzeit gemessen, nicht
// am Quelltext abgelesen. Lauf:
//   node js/map-features/__tests__/kraftlinie-kurve-alle-erzeuger.test.js
//
// 💣 Warum zur Laufzeit: „die Datei ist eingebunden" ist auch dann erfuellt, wenn niemand sie ruft.
// Und ein Quelltext-Test sieht einen Koordinatenfehler nie.
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

// ⚠️ DIE KARTE ALS ATTRAPPE, und sie ist NOETIG, nicht Zierde. createPowerlineLayer geht ueber
// getReadablePowerlineLabelLatLngCoordinates (map.latLngToLayerPoint) und ueber
// refreshPowerlineLayerText -> isPowerlineLabelVisibleAtCurrentZoom (map.getZoom). PATH_LABELS_ON_CANVAS
// steht in map-features-path-labels.js, die dieser Test NICHT laedt -- der Kurzschluss dort greift
// also nicht, und ohne `map` stirbt der Test an einem ReferenceError statt an der Sache.
global.map = {
	getZoom: () => 3,
	_animatingZoom: false,
	latLngToLayerPoint: (ll) => ({ x: ll.lng, y: ll.lat }),
	addLayer() {}, removeLayer() {},
};
// Die Auskunfts-Helfer der Infobox. Sie werden beim Aufbau des Popup-Markups gerufen und haben mit
// der Kurve nichts zu tun -- sie duerfen nur nicht fehlen.
global.escapeHtml = (t) => String(t == null ? "" : t);
global.tr = (schluessel, rueckfall) => rueckfall;
global.renderFeatureSourceLine = () => "";
global.popupActionButtonMarkup = () => "";
global.getPathLabelBaseSize = () => 11;
global.IS_INFOPANEL_MODE = false;

// Leaflet-Attrappe: nur, was die drei Zeichner anfassen. Jede Polyline merkt sich ihre Klasse und
// die zuletzt gesetzten Punkte -- daran wird gemessen.
const gebaute = [];
global.L = {
	latLng: (lat, lng) => ({ lat, lng }),
	latLngBounds: () => ({ isValid: () => false }),
	polyline(punkte, optionen) {
		const linie = {
			_punkte: punkte,
			options: optionen || {},
			setLatLngs(neu) { this._punkte = neu; },
			getLatLngs() { return this._punkte; },
			on() {}, setText() {}, removeText() {}, addTo() { return this; },
		};
		gebaute.push(linie);
		return linie;
	},
	layerGroup: (schichten) => ({
		_schichten: schichten,
		eachLayer(fn) { this._schichten.forEach(fn); },
	}),
};

const laden = (p) => {
	const abs = path.join(__dirname, p);
	vm.runInThisContext(fs.readFileSync(abs, "utf8"), { filename: abs });
};
laden("../map-features-line-catmull.js");
laden("../../config.js");
laden("../../app/runtime-state.js");
laden("../map-features-location-lookup.js");
laden("../powerline-topology.js");
laden("../map-features-powerlines.js");

// Eine Linie mit zwei Nodices, 20 Einheiten waagerecht, kraeftig gekruemmt.
const linie = {
	id: "pl-1",
	geometry: { type: "LineString", coordinates: [[0, 0], [20, 0]] },
	properties: { public_id: "pl-1", name: "Torweg", curve: 30 },
};
locationMarkers = [];
powerlineData = [linie];

// ---- 1. getPowerlineCurve liest und klemmt --------------------------------------------------
assert.strictEqual(getPowerlineCurve(linie), 30);
assert.strictEqual(getPowerlineCurve({ properties: {} }), 0, "ohne Wert: gerade");
assert.strictEqual(getPowerlineCurve({ properties: { curve: 999 } }), 45, "wird geklemmt");
assert.strictEqual(getPowerlineCurve({ properties: { curve: "20" } }), 20, "Zeichenkette wird gelesen");
assert.strictEqual(getPowerlineCurve(null), 0, "kein Objekt: gerade");

// ---- 2. Die STRAENGE tragen die Kurve -------------------------------------------------------
const gerade = createPowerlineStrandLatLngs([L.latLng(0, 0), L.latLng(0, 20)], 0, 0);
// Bei einer Kurve muss der mittlere Punkt deutlich weiter abstehen als ohne.
const gebogen = createPowerlineStrandLatLngs([L.latLng(0, 0), L.latLng(0, 20)], 0, 0, 30);
const mitteGerade = gerade[Math.floor(gerade.length / 2)];
const mitteGebogen = gebogen[Math.floor(gebogen.length / 2)];
assert.ok(
	Math.abs(mitteGebogen.lat - mitteGerade.lat) > 4,
	"der Strang folgt der Kurve nicht -- Scheitel muesste rund 6 Einheiten abstehen"
);

// ---- 3. curve = 0 aendert an den Straengen NICHTS (die Nicht-Regression) --------------------
const ohne = createPowerlineStrandLatLngs([L.latLng(0, 0), L.latLng(0, 20)], 1, 2.5);
const mitNull = createPowerlineStrandLatLngs([L.latLng(0, 0), L.latLng(0, 20)], 1, 2.5, 0);
assert.strictEqual(ohne.length, mitNull.length, "curve = 0 darf die Stuetzpunktzahl nicht aendern");
ohne.forEach((p, i) => {
	assert.strictEqual(p.lat, mitNull[i].lat, `Punkt ${i}: lat weicht bei curve = 0 ab`);
	assert.strictEqual(p.lng, mitNull[i].lng, `Punkt ${i}: lng weicht bei curve = 0 ab`);
});

// ---- 4. Die Stuetzpunktzahl waechst mit der Kruemmung ---------------------------------------
assert.ok(gebogen.length > gerade.length, "ein Bogen braucht mehr Stuetzpunkte als eine Gerade");

// ---- 5. ALLE DREI Erzeuger, zur Laufzeit gemessen -------------------------------------------
// 💣 Der eigentliche Zweck dieses Tests. Klick-Linie und Label-Linie sind unsichtbar; ihr Fehlen
// faellt beim Hinsehen NICHT auf -- man merkt es erst daran, dass ein Klick ins Leere geht.
gebaute.length = 0;
createPowerlineLayer(linie);

const hit = gebaute.find((l) => String(l.options.className || "").includes("powerline--hit"));
assert.ok(hit, "die Klick-Linie wurde gar nicht gebaut");
assert.ok(hit._punkte.length > 2, "die Klick-Linie ist noch eine gerade Zweipunkt-Strecke");
const hitMitte = hit._punkte[Math.floor(hit._punkte.length / 2)];
assert.ok(Math.abs(hitMitte.lat) > 4,
	"die Klick-Linie folgt der Kurve nicht -- das Klickziel laege im leeren Gelaende");

const label = gebaute.find((l) => l.options.pane === "labelsPane");
assert.ok(label, "die Label-Linie wurde gar nicht gebaut");
assert.ok(label._punkte.length > 2, "die Label-Linie ist noch eine gerade Zweipunkt-Strecke");

// ---- 6. Auch der Takt-Pfad zeichnet die Kurve, nicht nur der Aufbau -------------------------
// ⚠️ refreshPowerlineLayers setzt die Geometrie jeden Frame neu. Fehlt die Kurve dort, springt die
// Linie im ersten Frame von gebogen auf gerade -- und der Aufbau-Pfad sah dabei richtig aus.
refreshPowerlineLayers(3.0);
assert.ok(hit._punkte.length > 2, "nach einem Takt ist die Klick-Linie wieder gerade");
const hitMitteNachher = hit._punkte[Math.floor(hit._punkte.length / 2)];
assert.ok(Math.abs(hitMitteNachher.lat) > 4, "nach einem Takt folgt die Klick-Linie der Kurve nicht mehr");

// ---- 7. Der fluechtige Vorschauwert schlaegt den gespeicherten (fuer Aufgabe 5) -------------
avesmapsPowerlineCurveVorschau.name = "Torweg";
avesmapsPowerlineCurveVorschau.curve = -40;
assert.strictEqual(getPowerlineCurve(linie), -40, "die Vorschau muss den gespeicherten Wert schlagen");
avesmapsPowerlineCurveVorschau.name = "Eine andere Linie";
assert.strictEqual(getPowerlineCurve(linie), 30, "die Vorschau gilt NUR ihrer eigenen Linie");
avesmapsPowerlineCurveVorschau.name = null;
assert.strictEqual(getPowerlineCurve(linie), 30, "ohne Vorschau gilt der gespeicherte Wert");

console.log("OK: Kraftlinien-Kurve -- Straenge, Klick-Linie, Label-Linie, Takt, Vorschau.");
```

- [ ] **Schritt 2: Test laufen lassen, er MUSS fehlschlagen**

```bash
node js/map-features/__tests__/kraftlinie-kurve-alle-erzeuger.test.js
```
Erwartet: `ReferenceError: getPowerlineCurve is not defined`.

⚠️ Meldet er stattdessen einen **anderen** fehlenden globalen Namen, fehlt eine Attrappe: ergänze
sie oben nach demselben Muster (der einfachste Rückgabewert, der die Funktion durchlaufen lässt) und
lauf erneut. Ein Test, der aus dem falschen Grund rot ist, belegt nichts — er muss an
`getPowerlineCurve` scheitern, an nichts anderem.

- [ ] **Schritt 3: Den Leser und die Bahn ergänzen**

In `js/map-features/map-features-powerlines.js` **direkt nach** `getPowerlineLatLngs` (Z. 8)
einfügen:

```js
// Der FLUECHTIGE Vorschauwert des Kurven-Reglers (Aufgabe 5): solange der Owner am Schieber zieht,
// schlaegt er den gespeicherten Wert -- ohne dass irgendetwas geschrieben waere.
// 🔴 Laufzeit und sonst nichts: kein localStorage, kein URL-Parameter, kein Serverzustand. Wer den
// Regler abbricht, hat nichts veraendert.
const avesmapsPowerlineCurveVorschau = { name: null, curve: 0 };

// Die Kurvenform dieser Linie, geklemmt. Entwurf:
// docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md
function getPowerlineCurve(powerline) {
	const name = String(powerline?.properties?.name || "").trim();
	if (avesmapsPowerlineCurveVorschau.name !== null
			&& name !== ""
			&& name === avesmapsPowerlineCurveVorschau.name) {
		return avesmapsPowerlineCurveVorschau.curve;
	}
	const roh = powerline?.properties?.curve;
	const zahl = Number(roh);
	if (!Number.isFinite(zahl)) {
		return 0;
	}
	return Math.max(-45, Math.min(45, zahl));
}

// Die gekruemmte Bahn als LatLng -- fuer die unsichtbare Klick-Linie und die Label-Linie.
// 💣 GeoJSON speichert [x, y], Leaflet will [lat, lng] = [y, x]. Der reine Helfer rechnet in x/y;
// hier wird bewusst EINMAL gedreht.
function getPowerlineCurvedLatLngs(latLngs, curve) {
	if (!Array.isArray(latLngs) || latLngs.length < 2 || !curve) {
		return latLngs;
	}
	const a = latLngs[0];
	const b = latLngs[latLngs.length - 1];
	const schritte = avesmapsPowerlineCurveSteps(curve, POWERLINE_RENDER_CONFIG.segmentCount);
	return avesmapsPowerlineCurvedPoints(a.lng, a.lat, b.lng, b.lat, curve, schritte)
		.map((p) => L.latLng(p.y, p.x));
}
```

- [ ] **Schritt 4: Den Strangzeichner um den Summanden erweitern**

In `createPowerlineStrandLatLngs` (Z. 63):

1. Signatur erweitern:
   ```js
   function createPowerlineStrandLatLngs(latLngs, strandIndex, timeSeconds = 0, curve = 0) {
   ```
2. `segmentCount` ableiten — die Zeile
   ```js
   const segmentCount = Math.max(2, Math.round(POWERLINE_RENDER_CONFIG.segmentCount));
   ```
   ersetzen durch
   ```js
   // 🔴 Bei curve = 0 ist das EXAKT die heutige Zahl -- die geraden Linien zahlen nichts.
   const segmentCount = Math.max(2, avesmapsPowerlineCurveSteps(curve, POWERLINE_RENDER_CONFIG.segmentCount));
   ```
3. Im Schleifenrumpf, **nach** der Zeile mit `const normalOffset = …`, den Summanden anfügen:
   ```js
   		// ⭐ DIE KURVE: derselbe Normalenversatz wie das Wabern, nur ohne Zeit.
   		// 🔴 NICHT mit normalScale multiplizieren -- das ist der Daempfer der Wabern-Amplituden,
   		// die Kurve steht bereits in Karteneinheiten. Wer sie mitdaempft, bekommt ein Achtel Bogen
   		// und sucht den Fehler in der Formel.
   		const curveOffset = avesmapsPowerlineCurveNormalOffset(curve, t, start.lng, start.lat, end.lng, end.lat);
   		const gesamtOffset = normalOffset + curveOffset;
   ```
   und in den beiden `points.push`-Zeilen `normalOffset` durch `gesamtOffset` ersetzen:
   ```js
   		points.push(L.latLng(
   			start.lat + dy * t + ny * gesamtOffset + ty * (tangentWave + tremorTangent),
   			start.lng + dx * t + nx * gesamtOffset + tx * (tangentWave + tremorTangent)
   		));
   ```

- [ ] **Schritt 5: Aufbau- und Takt-Pfad verdrahten**

In `createPowerlineLayer` (Z. 426):

```js
function createPowerlineLayer(powerline) {
	const latLngs = getPowerlineLatLngs(powerline);
	const curve = getPowerlineCurve(powerline);
	const bahn = getPowerlineCurvedLatLngs(latLngs, curve);
	const labelLine = L.polyline(getReadablePowerlineLabelLatLngCoordinates(bahn), {
```

— und die Hit-Linie auf `bahn` statt `latLngs`:

```js
	const hitLine = L.polyline(bahn, {
```

— und im `getPowerlineRenderStyles().forEach(…)` die Kurve durchreichen:

```js
		const layer = L.polyline(createPowerlineStrandLatLngs(latLngs, strandIndex, powerlineAnimationTimeSeconds, curve), {
```

In `refreshPowerlineLayers` (Z. 525) dasselbe:

```js
		const latLngs = getPowerlineLatLngs(powerline);
		const curve = getPowerlineCurve(powerline);
		const bahn = getPowerlineCurvedLatLngs(latLngs, curve);
		powerline._layerGroup.eachLayer((layer) => {
			if (layer === powerline._labelLine) {
				layer.setLatLngs?.(getReadablePowerlineLabelLatLngCoordinates(bahn));
				return;
			}
			if (layer._powerlineHitLine) {
				layer.setLatLngs?.(bahn);
				return;
			}
			const strandIndex = layer._powerlineStrandIndex || 0;
			layer.setLatLngs?.(createPowerlineStrandLatLngs(latLngs, strandIndex, timeSeconds, curve));
		});
```

⚠️ **Die Stränge bekommen `latLngs`, nicht `bahn`** — sie rechnen die Kurve selbst, weil ihr
Versatz mit dem Wabern in **einer** Summe stehen muss. Gäbe man ihnen die fertige Bahn, käme das
Wabern auf eine schon gebogene Achse und die Amplituden verzerrten sich entlang der Kurve.

- [ ] **Schritt 6: Test laufen lassen, er MUSS grün sein**

```bash
node js/map-features/__tests__/kraftlinie-kurve-alle-erzeuger.test.js
node js/map-features/__tests__/kraftlinie-kurvenform.test.js
node js/map-features/__tests__/powerline-span.test.js
```
Erwartet: alle grün.

- [ ] **Schritt 7: Committen**

```bash
git add js/map-features/map-features-powerlines.js js/map-features/__tests__/kraftlinie-kurve-alle-erzeuger.test.js
git commit -m "kraftlinien(kurve): Straenge, Klick-Linie und Beschriftung folgen der Kurve"
```

---

## Aufgabe 3: Der Server — schreiben, lesen, vererben

**Dateien:**
- Ändern: `api/_internal/map/features.php` — `avesmapsPowerlineInheritedLineFields` (Z. 1960),
  `avesmapsUpdatePowerlineLine` (Z. 2046)
- Ändern: `api/edit/map/powerlines.php` — die Segmentprojektion (Z. 56–70)
- Ändern: `api/_internal/map/__tests__/powerline-inherit-test.php` (bestehend)
- Test: `api/_internal/map/__tests__/kraftlinie-kurve-schreiben-test.php` (neu)

**Schnittstellen:**
- Verbraucht: nichts aus früheren Aufgaben.
- Erzeugt:
  - `avesmapsReadPowerlineCurve(mixed $wert): float` — klemmt auf −45…45, alles Unlesbare wird `0.0`.
  - Aktion `update_powerline_line` nimmt zusätzlich `curve` (Zahl) entgegen.
  - `api/edit/map/powerlines.php` liefert je Segment zusätzlich `curve` (float).

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Neue Datei `api/_internal/map/__tests__/kraftlinie-kurve-schreiben-test.php`:

```php
<?php

declare(strict_types=1);

/**
 * Die Kurvenform im Schreibweg der Kraftlinie. Lauf (aus dem Repo-Wurzelverzeichnis):
 *   php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll \
 *       api/_internal/map/__tests__/kraftlinie-kurve-schreiben-test.php
 *
 * Entwurf: docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md
 */
if (ini_get('zend.assertions') !== '1') {
    fwrite(STDERR, "FATAL: zend.assertions ist nicht '1' -- assert() waere wirkungslos.\n");
    exit(2);
}

require __DIR__ . '/../features.php';

// ---- 1. Der Leser klemmt, statt abzulehnen ---------------------------------------------------
assert(avesmapsReadPowerlineCurve(0) === 0.0);
assert(avesmapsReadPowerlineCurve(25) === 25.0);
assert(avesmapsReadPowerlineCurve(-25) === -25.0);
assert(avesmapsReadPowerlineCurve('30') === 30.0, 'eine Zahl als Zeichenkette wird gelesen');
assert(avesmapsReadPowerlineCurve(999) === 45.0, 'ueber 45 wird geklemmt, nicht abgelehnt');
assert(avesmapsReadPowerlineCurve(-999) === -45.0);
// 🔴 Alles Unlesbare ist GERADE, nie eine Ausnahme: eine abgelehnte Speicherung waere fuer den
// Editor von „Server kaputt" nicht zu unterscheiden, und eine gerade Linie ist der Zustand von
// heute -- die sichere Richtung.
assert(avesmapsReadPowerlineCurve(null) === 0.0);
assert(avesmapsReadPowerlineCurve('') === 0.0);
assert(avesmapsReadPowerlineCurve('quatsch') === 0.0);
assert(avesmapsReadPowerlineCurve([]) === 0.0);
assert(avesmapsReadPowerlineCurve(NAN) === 0.0, 'NAN darf nicht durchrutschen');
assert(avesmapsReadPowerlineCurve(INF) === 45.0, 'INF wird geklemmt, nicht durchgereicht');

// ---- 2. Die EINE Erb-Liste traegt curve ------------------------------------------------------
// 💣 Ohne diesen Eintrag laege ein spaeter angehaengtes Segment kerzengerade zwischen zwei
// gebogenen. Die Liste stand einmal zweimal abgeschrieben nebeneinander und in beiden Kopien
// fehlte ein Feld -- siehe powerline-inherit-test.php.
$geerbt = avesmapsPowerlineInheritedLineFields([
    'name' => 'Torweg',
    'show_label' => true,
    'description' => '',
    'wiki_url' => '',
    'curve' => 26.0,
]);
assert(array_key_exists('curve', $geerbt), 'curve fehlt in der Erb-Liste');
assert($geerbt['curve'] === 26.0);

$leer = avesmapsPowerlineInheritedLineFields([]);
assert($leer['curve'] === 0.0, 'ohne Wert erbt ein neues Segment eine GERADE Linie');

// Auch hier geklemmt -- ein von Hand verbogener Datensatz darf nicht durch die Vererbung wandern.
$wild = avesmapsPowerlineInheritedLineFields(['curve' => 500]);
assert($wild['curve'] === 45.0);

// ---- 3. Der Schreibweg liest den Rumpf ueberhaupt --------------------------------------------
// Der Rumpf von avesmapsUpdatePowerlineLine wird als Quelltext geprueft, weil er eine Transaktion
// fuehrt und ohne PDO nicht ausfuehrbar ist. Gesucht wird der AUFRUF, nicht das blosse Wort.
// ⚠️ Kommentare vorher wegschneiden: der Test darf nicht an der Warnung anschlagen, die vor dem
// Muster warnt -- sonst loescht der naechste Leser den Kommentar, um den Test gruen zu bekommen.
$quelle = file_get_contents(__DIR__ . '/../features.php');
assert(is_string($quelle));
$ohneKommentare = preg_replace('~/\*.*?\*/~s', '', $quelle);
$ohneKommentare = preg_replace('~^\s*//.*$~m', '', (string) $ohneKommentare);
assert(preg_match('/function avesmapsUpdatePowerlineLine\(.*?\n\}/s', (string) $ohneKommentare, $treffer) === 1,
    'avesmapsUpdatePowerlineLine laesst sich nicht isolieren');
$rumpf = $treffer[0];
assert(str_contains($rumpf, 'avesmapsReadPowerlineCurve($payload[\'curve\']'),
    'der Linien-Schreibweg liest curve nicht aus dem Rumpf');
assert(str_contains($rumpf, "\$properties['curve'] = "),
    'der Linien-Schreibweg schreibt curve nicht in die Eigenschaften');
assert(str_contains($rumpf, "'curve' => "),
    'curve fehlt im Audit-Eintrag -- eine Aenderung ohne Protokoll ist nicht umkehrbar');

// ---- 4. Der ZWEITE Schreibweg laesst curve UNBERUEHRT ----------------------------------------
// 🔴 avesmapsUpdatePowerlineFeatureDetails (Aktion update_powerline_details) schreibt EIN Segment
// und kennt die Kurve nicht. Er darf sie auch nicht loeschen: er liest die vorhandenen
// Eigenschaften und setzt nur seine eigenen Felder darauf. Diese Zusicherung haelt fest, dass das
// so BLEIBT -- ein spaeteres `$properties = [...]` statt `$properties['x'] = ...` risse die Kurve
// jedes Segments mit, das ueber diesen Weg gespeichert wird.
assert(preg_match('/function avesmapsUpdatePowerlineFeatureDetails\(.*?\n\}/s', (string) $ohneKommentare, $t2) === 1);
assert(str_contains($t2[0], 'avesmapsDecodeJsonColumnForEdit($feature[\'properties_json\']'),
    'der Segment-Schreibweg liest die vorhandenen Eigenschaften nicht mehr -- er wuerde curve loeschen');
assert(!str_contains($t2[0], "unset(\$properties['curve'])"));

// ---- 5. Der Lesefeed projiziert curve --------------------------------------------------------
// ⚠️ Ausdruecklich: fehlt die Projektion, saehe der Editor immer 0, und weil das Speichern den Wert
// IMMER mitschickt, loeschte der naechste Speichervorgang die Kurve -- auch eine reine
// Beschreibungsaenderung. Dieselbe Falle, die wiki_no_article in derselben Datei gekostet hat.
$feed = file_get_contents(__DIR__ . '/../../../edit/map/powerlines.php');
assert(is_string($feed));
assert(str_contains($feed, "'curve' => avesmapsReadPowerlineCurve("),
    'api/edit/map/powerlines.php projiziert curve nicht in die Segmentliste');

echo "OK: Kraftlinien-Kurve -- Leser, Erb-Liste, beide Schreibwege, Lesefeed.\n";
```

- [ ] **Schritt 2: Test laufen lassen, er MUSS fehlschlagen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/map/__tests__/kraftlinie-kurve-schreiben-test.php
```
Erwartet: `Error: Call to undefined function avesmapsReadPowerlineCurve()`.

- [ ] **Schritt 3: Den Leser und die Erb-Liste schreiben**

In `api/_internal/map/features.php` **direkt vor** `avesmapsPowerlineInheritedLineFields` (Z. 1960):

```php
/**
 * Die Kurvenform einer Kraftlinie: Prozent der Sehne, -45..45, 0 = gerade.
 *
 * 🔴 GEKLEMMT, NIE ABGELEHNT. Ein unlesbarer Wert wird 0.0 -- also der Zustand von heute. Eine
 * Ausnahme waere fuer den Editor von „Server kaputt" nicht zu unterscheiden, und die sichere
 * Richtung ist hier die gerade Linie.
 * Entwurf: docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md §4.
 */
function avesmapsReadPowerlineCurve($wert): float {
    if (!is_int($wert) && !is_float($wert) && !is_string($wert)) {
        return 0.0;
    }
    if (!is_numeric($wert)) {
        return 0.0;
    }
    $zahl = (float) $wert;
    // ⚠️ is_numeric laesst NAN nicht durch, INF aber schon ("INF" ist nicht numerisch, INF selbst
    // ist ein float) -- is_nan faengt den Rest ab, min/max klemmen INF sauber.
    if (is_nan($zahl)) {
        return 0.0;
    }

    return max(-45.0, min(45.0, $zahl));
}
```

In `avesmapsPowerlineInheritedLineFields` **eine Zeile** ergänzen:

```php
    $inherited = [
        'show_label' => (bool) ($source['show_label'] ?? false),
        'description' => (string) ($source['description'] ?? ''),
        'wiki_url' => (string) ($source['wiki_url'] ?? ''),
        // Ohne diese Zeile laege ein spaeter angehaengtes Segment kerzengerade zwischen zwei
        // gebogenen -- die Kurve ist eine Eigenschaft der LINIE, nicht des einzelnen Stuecks.
        'curve' => avesmapsReadPowerlineCurve($source['curve'] ?? 0),
    ];
```

- [ ] **Schritt 4: Den Linien-Schreibweg erweitern**

In `avesmapsUpdatePowerlineLine` (Z. 2046) nach `$wikiUrl = trim(…);`:

```php
    // Die Kurvenform gilt der GANZEN Linie und wird wie show_label auf alle Segmente geschrieben.
    // ⚠️ `?? 0` ist hier richtig und bei wiki_no_article falsch, und der Unterschied ist der
    // Erzeuger: das Formular schickt curve bei JEDEM Speichern mit (es ist ein Schieber mit
    // Vorgabewert, kein dritter Zustand), waehrend der Merker nur bei einer Zuweisung mitreist.
    $curve = avesmapsReadPowerlineCurve($payload['curve'] ?? 0);
```

In der `foreach ($rows …)`-Schleife nach `$properties['wiki_url'] = $wikiUrl;`:

```php
            $properties['curve'] = $curve;
```

Und im Audit-Rumpf nach `'wiki_url' => $wikiUrl,`:

```php
                    'curve' => $curve,
```

- [ ] **Schritt 5: Den Lesefeed erweitern**

In `api/edit/map/powerlines.php`, in der `$segments[] = [ … ]`-Projektion nach der
`'show_label'`-Zeile:

```php
            // ⚠️ AUSDRUECKLICH, wie show_label und wiki_no_article daneben. Fehlt die Zeile, saehe
            // der Editor immer 0; und weil das Speichern den Wert immer mitschickt, loeschte der
            // NAECHSTE Speichervorgang die Kurve -- auch eine reine Beschreibungsaenderung.
            'curve' => avesmapsReadPowerlineCurve($properties['curve'] ?? 0),
```

- [ ] **Schritt 6: Den bestehenden Vererbungstest erweitern**

In `api/_internal/map/__tests__/powerline-inherit-test.php` beim „voll"-Fall `'curve' => 26.0,`
in die Eingabe aufnehmen und danach zusichern:

```php
assert($voll['curve'] === 26.0, 'die Kurvenform gehoert in die EINE Erb-Liste');
```

- [ ] **Schritt 7: Tests laufen lassen**

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/map/__tests__/kraftlinie-kurve-schreiben-test.php
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/map/__tests__/powerline-inherit-test.php
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/map/__tests__/kraftlinie-wiki-no-article-test.php
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll -d extension=php_pdo_sqlite.dll api/_internal/map/__tests__/powerline-anchor-delete-test.php
```
Erwartet: alle vier grün.

⚠️ **Und `const-vor-benutzung-test.php` mitlaufen lassen** — PHP hebt Funktionen an den Anfang,
`const` auf Dateiebene aber **nicht**; eine Konstante, die nach ihrem Gebrauch steht, ist ein Fatal
Error mit **leerem Antwortrumpf** („Unexpected end of JSON input" im Browser, sieht aus wie ein
Netzfehler):

```bash
php -d zend.assertions=1 -d assert.exception=1 -d extension=php_mbstring.dll api/_internal/map/__tests__/const-vor-benutzung-test.php
```

- [ ] **Schritt 8: Committen**

```bash
git add api/_internal/map/features.php api/edit/map/powerlines.php api/_internal/map/__tests__/kraftlinie-kurve-schreiben-test.php api/_internal/map/__tests__/powerline-inherit-test.php
git commit -m "kraftlinien(kurve): Schreibweg, Lesefeed und Vererbung tragen die Kurvenform"
```

- [ ] **Schritt 9: Das ganze Testfeld, dann pushen**

Beide Läufe aus den globalen Rahmenbedingungen, **mit** der Dateizahl-Gegenprobe. Erst wenn beide
Ergebnisdateien leer sind (bis auf `linkcheck/link-url-test.php`):

```bash
git pull --rebase --autostash && git push
```

Aufgaben 1–3 sind unsichtbar (kein Bestandswert ist ≠ 0), sie dürfen zusammen live gehen.

---

## Aufgabe 4: Der Schieber im Editor  🔴 SICHTBAR — einzeln live

**Dateien:**
- Ändern: `html/wiki-sync-powerline-editor.html` — `renderDetail` (Z. 444), `saveLine` (Z. 638),
  die Attrappe `demoData` (Z. 966)
- Test: `js/pages/__tests__/kraftlinie-kurve-editor.test.js` (neu)

**Schnittstellen:**
- Verbraucht: die Aktion `update_powerline_line` mit `curve` aus Aufgabe 3; das Feld `curve` je
  Segment aus dem Lesefeed.
- Erzeugt: das Eingabeelement `#plCurve` und die Anzeige `#plCurveVal`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Neue Datei `js/pages/__tests__/kraftlinie-kurve-editor.test.js`:

```js
// Der Kurvenform-Schieber im Kraftlinien-Editor. Quelltext-Test, weil die Seite ein
// eigenstaendiges iframe-Dokument ohne Modulgrenzen ist. Lauf:
//   node js/pages/__tests__/kraftlinie-kurve-editor.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const datei = path.join(__dirname, "..", "..", "..", "html", "wiki-sync-powerline-editor.html");
// ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF.
const quelle = fs.readFileSync(datei, "utf8").replace(/\r\n/g, "\n");
// ⚠️ Kommentare wegschneiden, sonst schlaegt der Test an der Warnung an, die vor dem Muster warnt.
const ohneKommentare = quelle
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/^[ \t]*\/\/.*$/gm, "");

// ---- 1. Der Schieber steht IM Identitaet-Block ----------------------------------------------
// 🔴 Ausdruecklich KEIN eigener dt-grp-Abschnitt: editor-abschnittsreihenfolge.test.js fuehrt die
// Abschnittsfolge dieses Fensters als feste Owner-Liste (Identitaet -> Beschreibung ->
// Wiki-Zuweisung -> Quellen -> Speicherleiste). Ein neuer Kopf hiesse eine sechste Zeile darin --
// fuer EIN Feld, das eine Darstellungsentscheidung ist wie das Haekchen darueber.
const posShowLabel = ohneKommentare.indexOf('id="plShowLabel"');
const posCurve = ohneKommentare.indexOf('id="plCurve"');
const posBeschreibung = ohneKommentare.indexOf('"dt-grp">Beschreibung<');
assert.ok(posShowLabel > -1, "das Haekchen plShowLabel steht nicht mehr da -- umbenannt?");
assert.ok(posCurve > -1, "der Kurvenform-Schieber (#plCurve) fehlt");
assert.ok(posBeschreibung > -1, "der Abschnitt Beschreibung steht nicht mehr da");
assert.ok(posCurve > posShowLabel,
	"der Schieber gehoert UNTER das Haekchen 'Name auf der Karte anzeigen' (Owner-Bild 29.08.2026)");
assert.ok(posCurve < posBeschreibung,
	"der Schieber ist aus dem Identitaet-Block herausgerutscht");

// ---- 2. Der Bereich ist der des Entwurfs ----------------------------------------------------
const schieber = ohneKommentare.slice(posCurve - 200, posCurve + 200);
assert.ok(/type="range"/.test(schieber), "#plCurve ist kein Schieber");
assert.ok(/min="-45"/.test(schieber), "der Bereich beginnt nicht bei -45");
assert.ok(/max="45"/.test(schieber), "der Bereich endet nicht bei 45");

// ---- 3. Der Wert reist im Schreibrumpf mit --------------------------------------------------
// 💣 Ohne diese Zeile speichert der Schieber nichts, und weil der Server einen fehlenden Schluessel
// als 0 liest, LOESCHT jedes Speichern die Kurve -- lautlos.
assert.ok(/curve:\s*Number\(\$\("plCurve"\)\.value\)/.test(ohneKommentare),
	"saveLine schickt curve nicht mit");

// ---- 4. Der geladene Wert wird angezeigt ----------------------------------------------------
// 💣 Eine Linie hat viele Segmente. Gelesen wird wie bei description/wiki_url ueber fieldSample --
// NICHT some()/every() (das sind Wahrheitswerte, curve ist eine Zahl, und `some` waere fuer 0 falsch).
assert.ok(/fieldSample\(line,\s*"curve"\)/.test(ohneKommentare),
	"renderDetail liest curve nicht ueber fieldSample");
assert.ok(!/segments\.some\(\(s\)\s*=>\s*s\.curve\)/.test(ohneKommentare),
	"curve ist eine ZAHL -- some() liest 0 und -0 als 'nicht gesetzt'");

// ---- 5. Die Attrappe traegt das Feld --------------------------------------------------------
// ⚠️ Ohne curve in demoData laeuft der Vorschau-Modus der Seite gegen undefined, und ein Entwickler
// ohne Datenbank sieht einen Fehler, den es in der Wirklichkeit nicht gibt.
assert.ok(/curve:\s*0/.test(ohneKommentare), "die Demo-Segmente tragen kein curve");

// ---- 6. Die Anzeige nennt eine Einheit ------------------------------------------------------
// Eine nackte Zahl an einem Schieber sagt nicht, ob sie Prozent, Grad oder Meilen ist.
assert.ok(/id="plCurveVal"/.test(ohneKommentare), "es gibt keine Wertanzeige zum Schieber");

console.log("OK: Kraftlinien-Kurve -- Schieber im Identitaet-Block, Bereich, Lesen und Schreiben.");
```

- [ ] **Schritt 2: Test laufen lassen, er MUSS fehlschlagen**

```bash
node js/pages/__tests__/kraftlinie-kurve-editor.test.js
```
Erwartet: `AssertionError: der Kurvenform-Schieber (#plCurve) fehlt`.

- [ ] **Schritt 3: Den Schieber ins Formular setzen**

In `renderDetail` bei den Werten oben (nach `const showLabel = …`):

```js
	// 💣 fieldSample, nicht some()/every(): curve ist eine ZAHL. `some((s) => s.curve)` laese eine
	// gespeicherte 0 als „nicht gesetzt" und eine -0 gleich mit.
	const curve = Number(fieldSample(line, "curve")) || 0;
```

Und im Markup **direkt nach** der `plShowLabel`-Zeile:

```js
		+ '<div class="dt-check"><input type="checkbox" id="plShowLabel"' + (showLabel ? " checked" : "") + "><span>Name auf der Karte anzeigen</span></div>"
		// Die Kurvenform -- ein Wert je Linie, geschrieben auf alle Segmente wie das Haekchen darueber.
		// 🔴 KEIN eigener dt-grp-Abschnitt: die Abschnittsfolge dieses Fensters ist eine feste
		// Owner-Liste (16.08.2026), gewacht von editor-abschnittsreihenfolge.test.js. Das hier ist
		// eine Darstellungsentscheidung wie „Name auf der Karte anzeigen", kein eigener Bereich.
		+ '<div class="dt-grid"><div class="k">Kurvenform</div><div>'
			+ '<div class="pl-curve">'
				+ '<input type="range" id="plCurve" min="-45" max="45" step="1" value="' + curve + '">'
				+ '<span class="pl-curve__val" id="plCurveVal">' + curveText(curve) + "</span>"
			+ "</div>"
			+ '<div class="pl-hint">Prozent der Sehne. <b>0</b> ist gerade, das Vorzeichen ist die Seite. '
				+ "Schreibt auf <b>alle " + line.segments.length + " Segmente</b>.</div>"
		+ "</div></div>"
```

Dazu oben bei den kleinen Helfern (neben `esc`):

```js
// „+26 %" statt „26" -- eine nackte Zahl an einem Schieber sagt nicht, ob sie Prozent, Grad oder
// Meilen ist.
function curveText(wert) {
	const zahl = Number(wert) || 0;
	return (zahl > 0 ? "+" : "") + zahl + " %";
}
```

Und die Verdrahtung neben `$("plSave").addEventListener("click", saveLine);`:

```js
	$("plCurve").addEventListener("input", () => {
		$("plCurveVal").textContent = curveText($("plCurve").value);
	});
```

🔴 **Der Knopf „Kurve auf der Karte einstellen" kommt hier NOCH NICHT.** Er entsteht erst in
Aufgabe 5, zusammen mit dem, was er auslöst. Ein deaktivierter Knopf mit „kommt später" ginge
sichtbar live und wäre für den Owner von einem kaputten nicht zu unterscheiden — dieses Fenster hat
davon bereits einen (`plMapFilter`).

- [ ] **Schritt 4: Den Wert mitschicken**

In `saveLine`, im `rumpf`-Objekt nach `show_label`:

```js
		show_label: $("plShowLabel").checked,
		// 💣 MUSS bei jedem Speichern mit. Der Server liest einen fehlenden Schluessel als 0 --
		// ein Speichern ohne diese Zeile LOESCHTE die Kurve, lautlos und ununterscheidbar von
		// „nie eingestellt".
		curve: Number($("plCurve").value),
```

- [ ] **Schritt 5: Die Attrappe nachziehen**

In `demoData()` (Z. 966) im `seg`-Erzeuger `curve: 0,` ergänzen:

```js
	const seg = (pid, name, from, to, extra) => Object.assign({ public_id: pid, name, from_public_id: from, to_public_id: to, show_label: false, curve: 0, description: "", wiki_url: "", wiki_powerline: null, revision: 1 }, extra || {});
```

- [ ] **Schritt 6: Das Aussehen**

In `css/components/editor-page.css` — **Token, keine Literale** (AGENTS.md §12):

```css
/* Der Kurvenform-Schieber des Kraftlinien-Editors: Regler und Wert in einer Zeile. */
.pl-curve {
	display: flex;
	align-items: center;
	gap: 10px;
}

.pl-curve input[type="range"] {
	flex: 1 1 auto;
	min-width: 0;
	accent-color: var(--color-accent-brown);
}

.pl-curve__val {
	flex: 0 0 auto;
	min-width: 58px;
	text-align: right;
	font-variant-numeric: tabular-nums;
	color: var(--color-accent-brown);
	/* ⚠️ Nie unter 11px -- die Untergrenze aus AGENTS.md §12. */
	font-size: 12px;
}
```

⚠️ **Prüfe vor dem Schreiben, dass `--color-accent-brown` in `css/base/tokens.css` wirklich
existiert**, mit `grep -n "color-accent-brown" css/base/tokens.css`. Ein erfundener Tokenname macht
die ganze Deklaration ungültig, und das fällt erst im Produktivcode auf. Gibt es ihn nicht, nimm
einen vorhandenen aus derselben Datei — **erfinde keinen**.

- [ ] **Schritt 7: Tests laufen lassen**

```bash
node js/pages/__tests__/kraftlinie-kurve-editor.test.js
node js/pages/__tests__/editor-abschnittsreihenfolge.test.js
node js/pages/__tests__/editor-quellen-eine-quelle.test.js
node js/pages/__tests__/kraftlinien-knoten-name.test.js
node js/pages/__tests__/kraftlinien-statuskreis.test.js
```
Erwartet: alle grün. 🔴 **`editor-abschnittsreihenfolge.test.js` ist der wichtige** — er ist der
Beweis, dass kein neuer Abschnittskopf entstanden ist.

- [ ] **Schritt 8: Im Browser abnehmen — ABLAUF, nicht Maß**

Öffne den Editor und **führe die Handgriffe aus**, statt Rechtecke zu messen:

1. Eine Linie in der Liste wählen → der Schieber steht auf ihrem gespeicherten Wert.
2. Schieber ziehen → die Anzeige rechts wandert mit und zeigt Vorzeichen und `%`.
3. „Speichern" → Meldung „Gespeichert – auf alle Segmente geschrieben."
4. Andere Linie wählen, zurückwechseln → der Wert ist **noch da** (das ist die Probe auf den
   Lesefeed).
5. Nur die Beschreibung ändern und speichern, dann neu laden → die Kurve ist **unverändert** (die
   Probe auf die stille Löschung).

⚠️ Was der Emulator nicht beantwortet, wird als offene Frage gemeldet, nicht als bestanden.

- [ ] **Schritt 9: Committen, ganzes Testfeld, pushen — und dann WARTEN**

```bash
git add html/wiki-sync-powerline-editor.html css/components/editor-page.css js/pages/__tests__/kraftlinie-kurve-editor.test.js
git commit -m "kraftlinien(kurve): der Schieber Kurvenform im Editor"
```

Beide Testfeld-Läufe, dann `git pull --rebase --autostash && git push`.

🔴 **Danach anhalten und den Blick des Owners abwarten.** Dies ist eine sichtbare Änderung; sie geht
einzeln live. Aufgabe 5 beginnt erst, wenn der Deploy-Lauf durch ist und der Owner geschaut hat.

---

## Aufgabe 5: Die Kurve auf der Karte einstellen  🔴 SICHTBAR — einzeln live

**Dateien:**
- Erstellen: `js/ui/kraftlinie-kurve-regler.js`
- Erstellen: `css/components/kraftlinie-kurve-regler.css`
- Ändern: `js/review/review-powerline-list.js` (die Brücke im Hauptfenster)
- Ändern: `html/wiki-sync-powerline-editor.html` (`#plCurveOnMap` verdrahten)
- Ändern: `index.html` (die zwei neuen Dateien einbinden)
- Test: `js/ui/__tests__/kraftlinie-kurve-regler.test.js` (neu)

**Schnittstellen:**
- Verbraucht: `avesmapsPowerlineCurveVorschau` und `refreshPowerlineLayers` aus Aufgabe 2;
  `#plCurve` aus Aufgabe 4.
- Erzeugt:
  - `avesmapsKurveReglerZeigen({ name, curve, aufAenderung, aufFertig }) -> { zerstoeren() }`
    Der schwebende Schieber. `aufAenderung(wert)` feuert bei jedem Zug, `aufFertig(wert)` einmal
    beim Schließen.
  - `window.avesmapsPowerlineCurveEditStart(name, curve)` im Hauptfenster — blendet das
    Editor-Overlay weg, zeigt den Regler, schreibt in `avesmapsPowerlineCurveVorschau`.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Neue Datei `js/ui/__tests__/kraftlinie-kurve-regler.test.js`:

```js
// Der schwebende Kurven-Regler als Bauteil -- mit einem gefaelschten DOM wirklich AUSGEFUEHRT,
// nicht am Quelltext abgelesen. Lauf:
//   node js/ui/__tests__/kraftlinie-kurve-regler.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Ein DOM, das gerade so viel kann, wie das Bauteil anfasst.
function macheElement(tag) {
	const el = {
		tagName: String(tag).toUpperCase(),
		children: [], attributes: {}, style: {}, dataset: {},
		className: "", textContent: "", value: "", type: "", hidden: false,
		_handler: {},
		appendChild(k) { this.children.push(k); k.parentNode = this; return k; },
		removeChild(k) { this.children = this.children.filter((x) => x !== k); return k; },
		remove() { if (this.parentNode) { this.parentNode.removeChild(this); } },
		setAttribute(k, v) { this.attributes[k] = String(v); if (k === "type") { this.type = String(v); } },
		getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
		addEventListener(name, fn) { (this._handler[name] = this._handler[name] || []).push(fn); },
		removeEventListener(name, fn) { this._handler[name] = (this._handler[name] || []).filter((f) => f !== fn); },
		feuere(name, ereignis) { (this._handler[name] || []).forEach((fn) => fn(ereignis || {})); },
		querySelector(sel) { return sucheAlle(this, sel)[0] || null; },
		querySelectorAll(sel) { return sucheAlle(this, sel); },
	};
	return el;
}
function sucheAlle(wurzel, sel) {
	const treffer = [];
	const passt = (el) => (sel.startsWith("#") ? el.attributes.id === sel.slice(1)
		: sel.startsWith(".") ? String(el.className).split(/\s+/).includes(sel.slice(1))
		: el.tagName === sel.toUpperCase());
	(function lauf(el) {
		el.children.forEach((k) => { if (passt(k)) { treffer.push(k); } lauf(k); });
	})(wurzel);
	return treffer;
}
const body = macheElement("body");
global.document = {
	body: body,
	createElement: macheElement,
	getElementById: (id) => sucheAlle(body, "#" + id)[0] || null,
	addEventListener() {}, removeEventListener() {},
};
global.window = { addEventListener() {}, removeEventListener() {} };

const abs = path.join(__dirname, "..", "kraftlinie-kurve-regler.js");
vm.runInThisContext(fs.readFileSync(abs, "utf8"), { filename: abs });

// ---- 1. Er zeigt den uebergebenen Wert ------------------------------------------------------
const gesehen = [];
let fertigWert = null;
const regler = avesmapsKurveReglerZeigen({
	name: "Torweg",
	curve: 26,
	aufAenderung: (w) => gesehen.push(w),
	aufFertig: (w) => { fertigWert = w; },
});
const eingabe = document.getElementById("avm-kurve-regler-eingabe");
assert.ok(eingabe, "der Regler hat kein Eingabeelement gebaut");
assert.strictEqual(eingabe.type, "range");
assert.strictEqual(String(eingabe.value), "26", "der uebergebene Wert steht nicht im Schieber");
assert.strictEqual(eingabe.getAttribute("min"), "-45");
assert.strictEqual(eingabe.getAttribute("max"), "45");

// ---- 2. Der Name der Linie steht dran -------------------------------------------------------
// ⚠️ Ohne ihn weiss der Owner bei 62 Linien nicht, welche er gerade biegt.
assert.ok(JSON.stringify(body).includes("Torweg"), "der Regler nennt die Linie nicht");

// ---- 3. Jeder Zug meldet sich ---------------------------------------------------------------
eingabe.value = "-12";
eingabe.feuere("input", {});
assert.deepStrictEqual(gesehen, [-12], "aufAenderung feuert nicht oder liefert keine ZAHL");
eingabe.value = "40";
eingabe.feuere("input", {});
assert.deepStrictEqual(gesehen, [-12, 40]);

// ---- 4. „Fertig" meldet EINMAL und raeumt auf ------------------------------------------------
const fertig = document.getElementById("avm-kurve-regler-fertig");
assert.ok(fertig, "es gibt keinen Fertig-Knopf");
fertig.feuere("click", {});
assert.strictEqual(fertigWert, 40, "aufFertig bekommt nicht den zuletzt eingestellten Wert");
assert.strictEqual(document.getElementById("avm-kurve-regler-eingabe"), null,
	"der Regler raeumt sich beim Fertig nicht ab");

// ---- 5. zerstoeren() ist mehrfach gefahrlos --------------------------------------------------
// 💣 Sonst wirft ein zweiter Aufruf (Fertig + Escape kurz hintereinander) und laesst den Editor
// weggeblendet zurueck -- der Owner saehe eine leere Karte und haette keinen Weg zurueck.
regler.zerstoeren();
regler.zerstoeren();

// ---- 6. Ein zweiter Aufruf ersetzt den ersten, statt zwei Regler zu stapeln -----------------
// 💣 Die Doppelanmeldung, die das Sammelmenue im Menueband schon einmal gekostet hat: zwei Regler
// uebereinander, der obere sichtbar, der untere schreibt weiter mit.
avesmapsKurveReglerZeigen({ name: "A", curve: 0, aufAenderung() {}, aufFertig() {} });
avesmapsKurveReglerZeigen({ name: "B", curve: 0, aufAenderung() {}, aufFertig() {} });
assert.strictEqual(document.querySelectorAll("#avm-kurve-regler-eingabe").length, 1,
	"ein zweiter Aufruf hat einen ZWEITEN Regler gestapelt");

console.log("OK: Kurven-Regler -- Wert, Meldung je Zug, Fertig, mehrfaches Zerstoeren, kein Stapeln.");
```

- [ ] **Schritt 2: Test laufen lassen, er MUSS fehlschlagen**

```bash
node js/ui/__tests__/kraftlinie-kurve-regler.test.js
```
Erwartet: `ENOENT: no such file or directory … kraftlinie-kurve-regler.js`.

- [ ] **Schritt 3: Das Bauteil schreiben**

Neue Datei `js/ui/kraftlinie-kurve-regler.js`:

```js
// Der schwebende Schieber, mit dem die Kurvenform einer Kraftlinie auf der KARTE eingestellt wird.
// Abhaengigkeitsfrei wie js/ui/ribbon-menu.js und js/ui/filter-menu.js daneben.
//
// Entwurf: docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md §8.
//
// 🔴 Das Bauteil kennt WEDER Leaflet NOCH die Kraftlinien -- es meldet nur Zahlen. Wer es an
// refreshPowerlineLayers bindet, macht aus einem Regler ein zweites Kartenmodul.

const AVM_KURVE_REGLER_ID = "avm-kurve-regler";

function avesmapsKurveReglerZeigen(erklaerung) {
	const o = erklaerung || {};
	// 💣 Erst den vorhandenen abraeumen. Zwei gestapelte Regler sind die Doppelanmeldung, die das
	// Sammelmenue im Menueband schon gekostet hat: der obere ist sichtbar, der untere schreibt mit.
	const alter = document.getElementById(AVM_KURVE_REGLER_ID);
	if (alter) { alter.remove(); }

	const huelle = document.createElement("div");
	huelle.setAttribute("id", AVM_KURVE_REGLER_ID);
	huelle.className = "avm-kurve-regler";

	const kopf = document.createElement("div");
	kopf.className = "avm-kurve-regler__kopf";
	// ⚠️ Der Name gehoert dran: bei 62 Linien weiss man sonst nicht, welche man gerade biegt.
	kopf.textContent = "Kurvenform · " + String(o.name || "");
	huelle.appendChild(kopf);

	const zeile = document.createElement("div");
	zeile.className = "avm-kurve-regler__zeile";

	const eingabe = document.createElement("input");
	eingabe.setAttribute("id", AVM_KURVE_REGLER_ID + "-eingabe");
	eingabe.setAttribute("type", "range");
	eingabe.setAttribute("min", "-45");
	eingabe.setAttribute("max", "45");
	eingabe.setAttribute("step", "1");
	eingabe.className = "avm-kurve-regler__schieber";
	eingabe.value = String(Number(o.curve) || 0);

	const wert = document.createElement("span");
	wert.className = "avm-kurve-regler__wert";
	const schreibeWert = (zahl) => { wert.textContent = (zahl > 0 ? "+" : "") + zahl + " %"; };
	schreibeWert(Number(o.curve) || 0);

	let zuletzt = Number(o.curve) || 0;
	eingabe.addEventListener("input", () => {
		// ⚠️ ZAHL, nicht Zeichenkette: der Empfaenger rechnet damit, und "40" + 1 waere "401".
		zuletzt = Number(eingabe.value) || 0;
		schreibeWert(zuletzt);
		if (typeof o.aufAenderung === "function") { o.aufAenderung(zuletzt); }
	});

	zeile.appendChild(eingabe);
	zeile.appendChild(wert);
	huelle.appendChild(zeile);

	let abgeraeumt = false;
	const zerstoeren = () => {
		// 💣 Mehrfach gefahrlos: Fertig und Escape koennen kurz hintereinander kommen, und ein Wurf
		// hier liesse den Editor weggeblendet zurueck -- leere Karte, kein Weg zurueck.
		if (abgeraeumt) { return; }
		abgeraeumt = true;
		huelle.remove();
	};

	const fertig = document.createElement("button");
	fertig.setAttribute("id", AVM_KURVE_REGLER_ID + "-fertig");
	fertig.setAttribute("type", "button");
	fertig.className = "avm-kurve-regler__fertig";
	fertig.textContent = "Fertig";
	fertig.addEventListener("click", () => {
		if (abgeraeumt) { return; }
		const wertJetzt = zuletzt;
		zerstoeren();
		if (typeof o.aufFertig === "function") { o.aufFertig(wertJetzt); }
	});
	huelle.appendChild(fertig);

	const hinweis = document.createElement("div");
	hinweis.className = "avm-kurve-regler__hinweis";
	hinweis.textContent = "Prozent der Sehne · das Vorzeichen ist die Seite · gespeichert wird erst mit „Speichern“.";
	huelle.appendChild(hinweis);

	document.body.appendChild(huelle);
	return { zerstoeren: zerstoeren };
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { avesmapsKurveReglerZeigen };
}
```

- [ ] **Schritt 4: Test laufen lassen, er MUSS grün sein**

```bash
node js/ui/__tests__/kraftlinie-kurve-regler.test.js
```

- [ ] **Schritt 5: Das Aussehen**

Neue Datei `css/components/kraftlinie-kurve-regler.css` — **nur Token**:

```css
/* Der schwebende Kurven-Regler ueber der Karte (js/ui/kraftlinie-kurve-regler.js). */
.avm-kurve-regler {
	position: fixed;
	left: 50%;
	bottom: 28px;
	transform: translateX(-50%);
	z-index: 1200;
	display: grid;
	gap: 8px;
	min-width: 320px;
	max-width: min(520px, calc(100vw - 32px));
	padding: 14px 16px;
	background: var(--color-panel-bg);
	border: 1px solid var(--color-divider);
	border-radius: var(--radius-md);
	box-shadow: 0 10px 28px rgba(0, 0, 0, .45);
	color: var(--color-text);
}

.avm-kurve-regler__kopf {
	font-size: 13px;
	color: var(--color-accent-brown);
}

.avm-kurve-regler__zeile {
	display: flex;
	align-items: center;
	gap: 10px;
}

.avm-kurve-regler__schieber {
	flex: 1 1 auto;
	min-width: 0;
	accent-color: var(--color-accent-brown);
}

.avm-kurve-regler__wert {
	flex: 0 0 auto;
	min-width: 62px;
	text-align: right;
	font-variant-numeric: tabular-nums;
	font-size: 13px;
	color: var(--color-accent-brown);
}

/* Die Haupthandlung dieses Reglers -- gefuellt, wie AGENTS.md §12 es fuer sie vorsieht. */
.avm-kurve-regler__fertig {
	justify-self: end;
	padding: 7px 16px;
	background: var(--color-button);
	border: 0;
	border-radius: var(--radius-md);
	color: var(--color-text);
	font: inherit;
	font-size: 13px;
	cursor: pointer;
}

.avm-kurve-regler__hinweis {
	/* ⚠️ 11px ist die Untergrenze aus AGENTS.md §12 -- nicht darunter. */
	font-size: 11px;
	color: var(--color-text-muted);
}
```

⚠️ **Jeden dieser Tokennamen zuerst gegen `css/base/tokens.css` prüfen:**

```bash
for t in color-panel-bg color-divider radius-md color-text color-accent-brown color-button color-text-muted; do
  grep -q -- "--$t" css/base/tokens.css && echo "ok $t" || echo "FEHLT $t"
done
```

Ein erfundener Tokenname macht die **ganze Deklaration** ungültig — und das fällt erst im
Produktivcode auf, nie im Mockup. Fehlt einer: nimm einen vorhandenen aus derselben Datei, **erfinde
keinen und lege keinen neuen an**, ohne dass der Entwurf ihn nennt.

- [ ] **Schritt 6: Beide Dateien in `index.html` einbinden**

Neben den anderen `js/ui/*.js` bzw. neben den anderen `css/components/*.css`. **Ohne `?v=`** — der
Deploy stempelt selbst, und ein handgeschriebener Stempel kann nur veralten.

- [ ] **Schritt 7: Die Brücke im Hauptfenster**

In `js/review/review-powerline-list.js`, **neben** `window.avesmapsFlyToLocationPublicId` (dem
bestehenden Muster für iframe → Hauptfenster):

```js
// Der Editor bittet das Hauptfenster, die Kurve einer Linie auf der KARTE einstellen zu lassen.
// Hier und nicht im iframe, weil nur das Hauptfenster die Karte und die Kraftlinien-Ebenen haelt --
// dasselbe Verhaeltnis wie bei avesmapsFlyToLocationPublicId darueber.
//
// 🔴 Das Overlay wird WEGGEBLENDET, nicht geschlossen. Ein Schliessen setzt Auswahl und
// ungespeicherte Felder zurueck; ein halb geschriebener Stand kaeme als leerer neuer zurueck.
// Dasselbe Hausmuster wie beim Social-Hub, der sich fuers Kartenausschnitt-Ziehen wegblendet.
window.avesmapsPowerlineCurveEditStart = window.avesmapsPowerlineCurveEditStart
	|| function avesmapsPowerlineCurveEditStart(name, curve) {
	const overlay = document.getElementById("avesmaps-powerline-editor-overlay");
	if (!overlay || typeof avesmapsKurveReglerZeigen !== "function") {
		return false;
	}
	const linienName = String(name || "").trim();
	if (linienName === "") {
		return false;
	}

	// ⚠️ Die Ebenen liegen nur im Modus „Kraftlinien" auf der Karte, und nur dort laeuft die
	// Animation (syncPowerlineVisibility). Steht die Karte anders, wird umgeschaltet -- und am
	// Ende zurueck, sonst nimmt der Regler dem Owner nebenbei seine Ansicht weg.
	// ⚠️ Das Element heisst `#mapLayerModeSelect` und wird per jQuery gelesen
	// (getSelectedMapLayerMode, js/map-features/map-features-display-mode.js:148) -- NICHT
	// `#mapStyleSelect`, das ist der UNTERGRUND (Old/Original/Modern). Die zwei zu verwechseln
	// schaltet die Kachelbasis statt der Ansicht.
	// 💣 Und die Aenderung muss ueber jQuery laufen: die Karte haengt an `.trigger("change")`,
	// ein natives dispatchEvent erreicht die jQuery-Handler nicht.
	const vorherigerModus = (typeof getSelectedMapLayerMode === "function") ? getSelectedMapLayerMode() : null;
	const setzeModus = (modus) => {
		if (modus === null || typeof $ !== "function") { return; }
		const feld = $("#mapLayerModeSelect");
		if (!feld.length || String(feld.val()) === modus) { return; }
		feld.val(modus).trigger("change");
	};
	setzeModus("powerlines");

	overlay.hidden = true;
	document.body.style.overflow = "";

	const zeichneNeu = () => {
		if (typeof refreshPowerlineLayers === "function") { refreshPowerlineLayers(); }
	};
	avesmapsPowerlineCurveVorschau.name = linienName;
	avesmapsPowerlineCurveVorschau.curve = Number(curve) || 0;
	zeichneNeu();

	avesmapsKurveReglerZeigen({
		name: linienName,
		curve: Number(curve) || 0,
		aufAenderung: (wert) => {
			avesmapsPowerlineCurveVorschau.curve = wert;
			zeichneNeu();
		},
		aufFertig: (wert) => {
			// 🔴 Die Vorschau wird IMMER zurueckgenommen, auch wenn gleich gespeichert wird: sie ist
			// ein fluechtiger Zustand, und einer, der ueber das Fenster hinaus lebt, ist genau die
			// Stoerung („meine Aenderung kommt nicht an"), die dieses Projekt schon bezahlt hat.
			avesmapsPowerlineCurveVorschau.name = null;
			avesmapsPowerlineCurveVorschau.curve = 0;
			setzeModus(vorherigerModus);
			overlay.hidden = false;
			document.body.style.overflow = "hidden";
			zeichneNeu();
			const frame = overlay.querySelector("iframe");
			if (frame && frame.contentWindow) {
				try {
					frame.contentWindow.postMessage({ avesmapsPowerlineCurveResult: wert }, location.origin);
				} catch (e) { /* noop */ }
			}
		},
	});
	return true;
};
```

- [ ] **Schritt 8: Den Knopf im Editor verdrahten**

In `html/wiki-sync-powerline-editor.html` das `disabled` und den `title` von `#plCurveOnMap` wieder
entfernen und neben den anderen Verdrahtungen ergänzen:

```js
	$("plCurveOnMap").addEventListener("click", () => {
		const line = lineByName(selectedName);
		// 🔴 Kein stiller Leerlauf: ohne das Hauptfenster (Editor direkt aufgerufen, Skript nicht
		// geladen) muss der Knopf SAGEN, dass er nichts tut -- ein toter Knopf sieht aus wie ein
		// kaputter, und davon hat dieses Fenster schon einen (plMapFilter).
		const start = window.parent && window.parent.avesmapsPowerlineCurveEditStart;
		if (!line || typeof start !== "function") {
			setSaveMsg("Auf der Karte einstellen geht nur aus der Karte heraus.", "bad");
			return;
		}
		start(line.name, Number($("plCurve").value) || 0);
	});
```

Und im `message`-Handler in `boot()` das Ergebnis annehmen:

```js
		const kurve = event.data && event.data.avesmapsPowerlineCurveResult;
		if (typeof kurve === "number") {
			// ⚠️ Nur ins Formular, NICHT speichern -- das bleibt beim Knopf „Speichern".
			const feld = $("plCurve");
			if (feld) { feld.value = String(kurve); $("plCurveVal").textContent = curveText(kurve); }
			return;
		}
```

- [ ] **Schritt 9: Tests laufen lassen**

```bash
node js/ui/__tests__/kraftlinie-kurve-regler.test.js
node js/pages/__tests__/kraftlinie-kurve-editor.test.js
node js/map-features/__tests__/kraftlinie-kurve-alle-erzeuger.test.js
```

- [ ] **Schritt 10: Im Browser abnehmen — die Handgriffe, einzeln**

1. Karte → WikiSync → Kraftlinien → eine Linie → „Kurve auf der Karte einstellen".
2. Der Editor **verschwindet**, die Karte steht frei, der Regler schwebt unten.
3. Ziehen → die Linie biegt sich **live mit**, die Stränge wabern um die Kurve.
4. „Fertig" → der Editor ist **zurück**, mit derselben Linie gewählt, der Schieber steht auf dem
   eingestellten Wert, die anderen Felder sind **unverändert**.
5. „Speichern" → gespeichert. Karte neu laden → die Kurve ist da.
6. **Die Gegenprobe auf die Flüchtigkeit:** noch einmal einstellen, „Fertig", dann den Editor
   **schließen ohne zu speichern** und die Karte neu laden → die Linie ist wieder wie vorher.
7. **Die Klick-Probe:** auf die gebogene Linie klicken → die Infobox öffnet sich. (Das ist die
   Probe auf die Klick-Linie aus Aufgabe 2 — sie ist unsichtbar, ihr Fehlen fällt nur so auf.)

- [ ] **Schritt 11: Committen, ganzes Testfeld, pushen — und WARTEN**

```bash
git add js/ui/kraftlinie-kurve-regler.js css/components/kraftlinie-kurve-regler.css js/review/review-powerline-list.js html/wiki-sync-powerline-editor.html index.html js/ui/__tests__/kraftlinie-kurve-regler.test.js
git commit -m "kraftlinien(kurve): die Kurve auf der Karte einstellen -- der Editor blendet sich weg"
```

Beide Testfeld-Läufe, dann pushen. 🔴 **Danach anhalten und den Blick des Owners abwarten.**

---

## Aufgabe 6: Der SVG-Abzug

**Dateien:**
- Ändern: `js/pages/svg-export-build.js` — `svgxPowerlineLayer` (Z. 941)
- Test: `js/pages/__tests__/kraftlinie-kurve-abzug.test.js` (neu)

**Schnittstellen:**
- Verbraucht: `avesmapsPowerlineCurveSteps`, `avesmapsPowerlineCurvedPoints` aus Aufgabe 1.
- Erzeugt: nichts, was spätere Aufgaben brauchen.

- [ ] **Schritt 1: Den fehlschlagenden Test schreiben**

Neue Datei `js/pages/__tests__/kraftlinie-kurve-abzug.test.js`:

```js
// Der SVG-Abzug zeichnet die Kurvenform mit. Lauf:
//   node js/pages/__tests__/kraftlinie-kurve-abzug.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const laden = (...teile) => {
	const abs = path.join(__dirname, "..", "..", "..", ...teile);
	vm.runInThisContext(fs.readFileSync(abs, "utf8"), { filename: abs });
};
laden("js", "map-features", "powerline-topology.js");
laden("js", "pages", "svg-export-build.js");

const linie = (curve) => ({
	properties: { feature_type: "powerline", name: "Torweg", public_id: "pl-1", curve: curve },
	geometry: { type: "LineString", coordinates: [[0, 0], [20, 0]] },
});

// ---- 1. Eine GERADE Linie bleibt Wort fuer Wort, was sie war --------------------------------
// 🔴 Die Nicht-Regression: alle Linien im Bestand sind gerade, der Abzug darf sich nicht aendern.
const gerade = svgxPowerlineLayer({ features: [linie(0)], seen: {}, dialect: null });
assert.strictEqual(gerade.count, 1);
const dGerade = String(gerade.parts.join("")).match(/ d="([^"]+)"/)[1];
assert.strictEqual(dGerade.split(/[ML]/).filter((s) => s.trim() !== "").length, 2,
	"eine gerade Kraftlinie muss im Abzug zwei Punkte haben, nicht mehr");

// ---- 2. Eine gekruemmte Linie bekommt die Bahn ----------------------------------------------
const krumm = svgxPowerlineLayer({ features: [linie(30)], seen: {}, dialect: null });
const dKrumm = String(krumm.parts.join("")).match(/ d="([^"]+)"/)[1];
const punkte = dKrumm.split(/[ML]/).filter((s) => s.trim() !== "");
assert.ok(punkte.length > 2, "die gekruemmte Kraftlinie steht im Abzug immer noch als Strecke");

// Der Scheitel steht rund 30 % von 20 = 6 Einheiten ab.
const mitte = punkte[Math.floor(punkte.length / 2)].trim().split(/[ ,]+/).map(Number);
assert.ok(Math.abs(Math.abs(mitte[1]) - 6) < 0.5,
	`der Scheitel im Abzug steht bei ${mitte[1]}, erwartet rund 6 Einheiten`);

// ---- 3. Die Endpunkte bleiben exakt die Nodices ---------------------------------------------
const erster = punkte[0].trim().split(/[ ,]+/).map(Number);
const letzter = punkte[punkte.length - 1].trim().split(/[ ,]+/).map(Number);
assert.ok(Math.abs(erster[0] - 0) < 1e-6 && Math.abs(erster[1] - 0) < 1e-6);
assert.ok(Math.abs(letzter[0] - 20) < 1e-6 && Math.abs(letzter[1] - 0) < 1e-6);

console.log("OK: SVG-Abzug -- gerade bleibt gerade, gekruemmt bekommt die Bahn.");
```

- [ ] **Schritt 2: Test laufen lassen, er MUSS fehlschlagen**

```bash
node js/pages/__tests__/kraftlinie-kurve-abzug.test.js
```
Erwartet: `AssertionError: die gekruemmte Kraftlinie steht im Abzug immer noch als Strecke`.

- [ ] **Schritt 3: Den Abzug erweitern**

In `svgxPowerlineLayer` (Z. 941) die `d`-Zeile ersetzen:

```js
	linien.forEach((f) => {
		const name = f.properties.name || "Kraftlinie";
		const id = svgxIdFor(name, f.properties.public_id, o.dialect, o.seen);
		// 🔴 Der Abzug bekommt die KURVE, aber nicht das Wabern: er ist ein Standbild fuer
		// Weiterverarbeitung, und eine eingefrorene Zufallsphase des Zitterns waere Rauschen in
		// einer Datei, die jemand als Vorlage benutzt. Die Kurve dagegen IST die Form der Linie.
		// 🪤 `o.smooth` / `o.tension` werden dieser Ebene seit jeher uebergeben und NIE gelesen --
		// wer nur den Aufruf liest, haelt den Abzug faelschlich fuer geglaettet.
		const curve = Number(f.properties.curve) || 0;
		const punkte = svgxPowerlineCurvedCoordinates(f.geometry.coordinates, curve);
		stuecke.push(`<path id="${svgxEscapeText(id)}"${svgxLabelAttr(name, o.dialect)}`
			+ svgxSem2(o.semantics, o.typen, Object.assign({ kind: "kraftlinie", name: name,
			id: (f.properties && f.properties.public_id) || "" },
			svgxContextFor(f.geometry, o.context)))
			+ ` d="${svgxPathData(punkte)}">`
			+ `<title>${svgxEscapeText(name)}</title></path>\n`);
	});
```

Und **direkt davor** den kleinen Umrechner:

```js
// Die gekruemmte Bahn einer Kraftlinie in GeoJSON-Koordinaten ([x, y]) -- fuer den Abzug.
// ⭐ Rechnet NICHT selbst: dieselbe Regel wie auf der Karte (js/map-features/powerline-topology.js),
// sonst waere der Abzug eine zweite Wahrheit ueber die Form der Linie.
function svgxPowerlineCurvedCoordinates(coordinates, curve) {
	const roh = Array.isArray(coordinates) ? coordinates : [];
	if (!curve || roh.length < 2 || typeof avesmapsPowerlineCurvedPoints !== "function") {
		return roh;
	}
	// ⚠️ Wie auf der Karte: erster und letzter Punkt spannen die Sehne, alles dazwischen wird
	// verworfen -- der Kartenzeichner tut genau das, und ein Abzug, der mehr zeigt als die Karte,
	// waere kein Abzug.
	const a = roh[0];
	const b = roh[roh.length - 1];
	const schritte = avesmapsPowerlineCurveSteps(curve, 8);
	return avesmapsPowerlineCurvedPoints(a[0], a[1], b[0], b[1], curve, schritte)
		.map((p) => [p.x, p.y]);
}
```

⚠️ **`svg-export-build.js` läuft auch unter Node** (`tools/svg-export/abzug-bauen.js`). Prüfe, dass
`powerline-topology.js` dort geladen wird — falls nicht, im Läufer daneben einbinden. Der
`typeof …!== "function"`-Riegel oben lässt den Abzug im Zweifel **gerade** herauskommen statt zu
werfen, aber ein stiller Rückfall ist kein Ersatz für die richtige Einbindung.

- [ ] **Schritt 4: Tests laufen lassen**

```bash
node js/pages/__tests__/kraftlinie-kurve-abzug.test.js
node js/pages/__tests__/svg-export-farben.test.js
node tools/svg-export/__tests__/abzug-bauen.test.js
node tools/svg-export/__tests__/tokens-tafel.test.js
```

- [ ] **Schritt 5: Committen, ganzes Testfeld, pushen**

```bash
git add js/pages/svg-export-build.js js/pages/__tests__/kraftlinie-kurve-abzug.test.js
git commit -m "kraftlinien(kurve): der SVG-Abzug zeichnet die Kurve mit"
```

---

## Abschluss

- [ ] **Der eigene Entwurf ist die Abnahmeliste.** Geh
  `docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md` durch und hake **jede** Zeile
  mit 💣 / 🔴 / ⚠️ / 🪤 einzeln ab: erfüllt, oder ausdrücklich verworfen mit Begründung. Zwei der
  vier Regressionen vom 10.08.2026 standen wörtlich als Warnung im eigenen Entwurf und wurden nicht
  gebaut — es fehlte kein Wissen, sondern das Abhaken.
- [ ] **`usability-konsistenz`** laufen lassen (Entwurf gegen Diff, gekoppelte Werte).
- [ ] **`usability-design`** laufen lassen (Mockup gegen gebauten Zustand, hell **und** dunkel).
- [ ] **Die offenen Punkte aus §12 des Entwurfs an den Owner melden**, statt sie als erledigt zu
  buchen: der Bereich ±45 % ist am Bild abgegriffen, nicht gemessen; verzweigte Linien und der Ring
  sind ungeprüft.
- [ ] **`html/editor-handbuch.html` NICHT anfassen.** Die nächtliche Routine
  `avesmaps-handbuch-pflege` liest `git log` und schreibt den Abschnitt selbst. Deine einzige
  Pflicht ist ein Commit-Betreff, der die sichtbare Wirkung benennt — das tun die Betreffe der
  Aufgaben 4 und 5.
