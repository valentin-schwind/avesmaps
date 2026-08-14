# Die Rast in Portionen — Bauplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Ziel:** Die Rastzeit wird nicht mehr anteilig aus der Reisezeit gerechnet, sondern in ganzen
Portionen über die ganze Route abgearbeitet — eine Portion erst dann, wenn die Reisestunden
aufgebraucht sind und noch Weg vor einem liegt.

**Entwurf:** [`docs/superpowers/specs/2026-08-14-rastmodell-portionen-design.md`](../specs/2026-08-14-rastmodell-portionen-design.md).
Jede 💣/⚠️/🔴-Zeile dort ist Teil der Abnahmeliste (AGENTS §9).

**Architektur:** Eine neue, reine Funktion `avesmapsRouteRestPortions` in
`js/routing/route-result.js` läuft mit **einem** Zähler über die fertigen Etappen und liefert je
Etappe die Raststunden. `buildRouteSteps` ruft sie einmal, statt je Etappe zu rechnen. Kalender,
Zusammenfassung und Reisekosten lesen die Zahlen wie bisher und ziehen von selbst nach.

**Tech-Stack:** Vanilla JS ohne Build, Tests sind einzelne `node`-Skripte unter `js/**/__tests__/`
mit `assert`. Kein PHP, keine Vertragsänderung.

## Global Constraints

- **Windows + PowerShell**, CRLF-Falle: in `index.html` nur **einzeilige** Edits (AGENTS §9).
- **Geteilter Arbeitsbaum:** niemals `git add -A`/`git add .`/`git commit -a`. Es liegen fremde
  unversionierte und geänderte Dateien im Baum (u. a. `css/features/location-popups-markers.css`,
  `js/ui/popups.js`, `js/routing/routing.js`, `tiles/stylized_upscale/`). **Nur die in der
  jeweiligen Aufgabe genannten Pfade einzeln stagen.**
- **`js/routing/route-costs.js` wird NICHT angefasst** (Entwurf §5, 🔴). Es liest die Nächte aus
  der Reisezeit und wandert dadurch von selbst mit.
- **Keine PHP-Datei, kein API-Vertrag.** `POST /api/route/` rechnet keine Rast.
- **Kein `?v=` von Hand** (AGENTS §7).
- **Der Deploy ist ein Tor:** vor dem Push läuft das GANZE JS-Testfeld, nicht nur die eigenen
  Tests. Ein roter Test lädt nichts hoch und vergiftet den `?v=`-Stempel (AGENTS §9).
- **Sichtbare Änderung geht EINZELN live:** ein Commit-Bündel, ein Push, dann sieht der Owner
  nach. Nicht mit anderen sichtbaren Änderungen zusammenlegen.
- Kommentare in `route-result.js` auf **Englisch** (die Datei ist englisch kommentiert),
  Kommentare in den Testdateien auf **Deutsch** (die Nachbardateien sind deutsch).

---

## Dateien

| Datei | Rolle |
|---|---|
| `js/routing/route-result.js` | **ändern** — neue Funktion `avesmapsRouteRestPortions`, `buildRouteSteps` ruft sie |
| `js/routing/__tests__/rest-portions.test.js` | **neu** — der Zähler selbst, mit von Hand gerechneten Zahlen |
| `js/routing/__tests__/speed-table-and-rest-rule.test.js` | **ändern** — Rastregel-Teil auf die neue Regel, Zähne behalten |
| `js/routing/__tests__/route-season-ground-apply.test.js` | **ändern** — „mehr Reisezeit heißt mehr Rast" wird zur Treppe |
| `index.html` | **ändern** — ein Halbsatz im `title` des Reisestunden-Feldes |
| `js/app/i18n-en.js` | **ändern** — derselbe Halbsatz auf Englisch |

**Nicht angefasst:** `route-costs.js`, `route-plan.js`, `route-plan-calendar.js`,
`route-view-model.js`, alles unter `api/`.

---

### Task 1: Der Zähler als eigene Funktion

Die Portionsrechnung entsteht zuerst **allein**, ohne Verdrahtung. Danach ist der Baum grün, die
Anzeige unverändert, und die Rechnung hat einen Test, der sie von Hand nachrechnet.

**Files:**
- Modify: `js/routing/route-result.js` (neue Funktion oberhalb von `buildRouteSteps`, ab Zeile 39)
- Test: `js/routing/__tests__/rest-portions.test.js` (neu)

**Interfaces:**
- Produces: `avesmapsRouteRestPortions(entries, travelPerDay, includeRests)` → `number[]`
  - `entries`: `Array<{ travelTime: number, exempt: boolean }>` in Reisereihenfolge
  - `travelPerDay`: Reisestunden am Tag (> 0)
  - `includeRests`: `false` ⇒ überall `0`
  - Rückgabe: Raststunden je Eintrag, gleiche Länge und Reihenfolge
- Consumes: nichts.

- [ ] **Step 1: Den Test schreiben**

Neue Datei `js/routing/__tests__/rest-portions.test.js`:

```js
// Die Rastportionen: EIN Zaehler ueber die GANZE Route.
//
// 🔴 DER FEHLER, GEGEN DEN DIESE DATEI STEHT. Bis zum 14.08.2026 rechnete der Planer die Rast
//    anteilig: `Rast = Reisezeit x (24 - Reisestunden) / Reisestunden`. Bei den voreingestellten
//    12 Reisestunden ist der Faktor genau 1 -- eine Wanderung von 10,6 Stunden wurde als 21,2
//    Stunden Gesamtzeit gemeldet, eine von 2 Stunden als 4. Die Rast gehoert aber der NACHT, nicht
//    der Stunde: sie faellt an, wenn der Reisetag aufgebraucht ist und noch Weg vor einem liegt.
//
// 💣 UND SIE GEHOERT DER ROUTE, NICHT DER ETAPPE. Wer `Naechte = Etappenzeit / Reisestunden` je
//    Zeile rechnet, bekommt bei einer Route aus lauter kurzen Etappen NIE eine Nacht, egal wie lang
//    sie insgesamt ist. Alle Zahlen bleiben plausibel, nur die Summe ist Unsinn -- deshalb prueft
//    Fall 5 ausdruecklich eine Route aus sechs kurzen Etappen.
//
// Entwurf: docs/superpowers/specs/2026-08-14-rastmodell-portionen-design.md
// Aus der Wurzel des Repos:  node js/routing/__tests__/rest-portions.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// route-result.js kennt kein Modulsystem: die Datei besteht aus Funktionsdeklarationen und hat
// keine Nebenwirkung beim Laden. Sie laesst sich deshalb einzeln einhaengen -- dieser Test ruft die
// Portionsrechnung DIREKT, ohne Segmente, Tempotabelle oder Kalender.
const repoRoot = path.join(__dirname, "..", "..", "..");
vm.runInThisContext(
	fs.readFileSync(path.join(repoRoot, "js/routing/route-result.js"), "utf8"),
	{ filename: "route-result.js" }
);
assert.strictEqual(
	typeof avesmapsRouteRestPortions,
	"function",
	"avesmapsRouteRestPortions muss in route-result.js stehen"
);

const leg = (travelTime, exempt = false) => ({ travelTime, exempt });
const rests = (entries, travelPerDay = 12) => avesmapsRouteRestPortions(entries, travelPerDay, true);
const sum = (values) => values.reduce((total, value) => total + value, 0);

// ---- 1. Kurz bleibt kurz ---------------------------------------------------------------------
// 🔴 DER DISCORD-FALL. Zwei Stunden Weg sind zwei Stunden, nicht vier.
assert.deepStrictEqual(rests([leg(2)]), [0], "eine Zweistundenetappe rastet nicht");
assert.deepStrictEqual(rests([leg(10.6)]), [0], "und eine von 10,6 Stunden auch nicht");

// ---- 2. Punktgenaue Ankunft ------------------------------------------------------------------
// 💣 Wer die Portion bucht, SOBALD der Tag voll ist, haengt hier eine Nacht hinter die Ankunft.
// Gebucht wird vor dem naechsten Stueck -- und danach kommt keines mehr.
assert.deepStrictEqual(rests([leg(12)]), [0], "wer genau mit dem Reisetag ankommt, rastet nicht mehr");

// ---- 3. Die Portion kommt --------------------------------------------------------------------
assert.deepStrictEqual(rests([leg(24)]), [12], "24 Reisestunden sind eine Nacht");
assert.deepStrictEqual(rests([leg(36)]), [24], "36 Reisestunden sind zwei");
assert.deepStrictEqual(rests([leg(12.5)]), [12], "und eine halbe Stunde ueber den Tag hinaus ebenfalls eine");

// ---- 4. Ueber Etappen hinweg, und NUR an der Grenze -------------------------------------------
// Sechs Etappen zu 3 Stunden = 18 Reisestunden = genau eine Nachtgrenze. Sie faellt zwischen
// Etappe 4 und 5, also traegt Etappe 5 die Portion -- und keine andere.
const sixShort = rests([leg(3), leg(3), leg(3), leg(3), leg(3), leg(3)]);
assert.deepStrictEqual(sixShort, [0, 0, 0, 0, 12, 0], `sechs kurze Etappen teilen einen Reisetag, war ${sixShort}`);
assert.strictEqual(sum(sixShort), 12, "eine Portion insgesamt, nicht eine je Etappe");

// ---- 5. Der Schnellsegler setzt zurueck -------------------------------------------------------
// Man schlaeft an Bord: die Ueberfahrt kostet keine Rastzeit UND laesst den Reisenden ausgeruht.
assert.deepStrictEqual(
	rests([leg(8), leg(40, true), leg(8)]),
	[0, 0, 0],
	"acht Stunden, eine Ueberfahrt, acht Stunden -- keine Nacht an Land"
);
// 🔴 Die Gegenprobe, ohne die der Fall nichts beweist: dieselben zwei Fussmaersche OHNE Schiff
// dazwischen sind 16 Stunden am Stueck und kosten sehr wohl eine Nacht.
assert.deepStrictEqual(rests([leg(8), leg(8)]), [0, 12], "16 Stunden Marsch am Stueck kosten eine Nacht");

// ---- 6. Der Schalter bleibt ein Schalter ------------------------------------------------------
assert.deepStrictEqual(
	avesmapsRouteRestPortions([leg(30), leg(30)], 24, false),
	[0, 0],
	"ohne Rastwunsch rastet niemand"
);

// ---- 7. Die Einstellung wirkt wirklich --------------------------------------------------------
// 💣 Nicht auf 12 festgenagelt: bei 16 Reisestunden ist die Portion 8 Stunden lang.
assert.deepStrictEqual(rests([leg(20)], 16), [8], "16 Reisestunden -> Portion von 8");
assert.deepStrictEqual(rests([leg(7)], 6), [18], "6 Reisestunden -> Portion von 18");

// ---- 8. Die Invariante, an der die Uebernachtungskosten haengen -------------------------------
// 🔴 `route-costs.js` rechnet die Zahl der Naechte als `floor(Gesamtzeit / 24)` und wird deshalb
// NICHT angefasst (Entwurf §5). Das gilt nur, solange diese Gleichung stimmt. Sie ist der Grund,
// warum die Uebernachtungen von selbst mitwandern -- wer sie bricht, verrechnet Geld, ohne dass
// eine einzige Zeile in der Kostendatei falsch aussieht.
[[2, 12], [12, 12], [24, 12], [36, 12], [122.4, 12], [20, 16], [100, 20], [7, 6]].forEach(
	([travelTime, travelPerDay]) => {
		const portions = rests([leg(travelTime)], travelPerDay);
		const nights = portions[0] / (24 - travelPerDay);
		const totalHours = travelTime + portions[0];
		assert.strictEqual(
			Math.floor(totalHours / 24),
			nights,
			`floor(Gesamtzeit/24) muss die Zahl der Portionen sein: ${travelTime} h bei ${travelPerDay} Reisestunden`
		);
	}
);

console.log("rest-portions.test.js: all assertions passed");
```

- [ ] **Step 2: Den Test laufen lassen und scheitern sehen**

```bash
node js/routing/__tests__/rest-portions.test.js
```

Erwartet: FAIL mit „avesmapsRouteRestPortions muss in route-result.js stehen"
(`AssertionError`, weil die Funktion noch nicht existiert).

- [ ] **Step 3: Die Funktion schreiben**

In `js/routing/route-result.js` **oberhalb** von `function buildRouteSteps(` (also vor der
heutigen Zeile 39) einfügen:

```js
/**
 * The rest hours of every leg, in travel order.
 *
 * 💣 ONE COUNTER FOR THE WHOLE ROUTE, never one per leg. A rest portion falls due when the day's
 * travel hours are used up AND there is still road ahead -- so three short legs share one travel
 * day and a night can land in the middle of a leg. Computing it per leg instead gives a route made
 * of short legs no night at all, however long it is: every number stays plausible and only the sum
 * is nonsense. Until 2026-08-14 the rest was a PROPORTION of the travel time, which charged a full
 * night for the part-day you already arrived on -- 10.6 hours of walking were reported as 21.2.
 *
 * 💣 THE PORTION IS BOOKED BEFORE THE NEXT STRETCH, never after the last one. That is the whole
 * trick, and the reason no look-ahead is needed: a portion can only come into being while there is
 * something left to travel. Booking it as soon as the day is full hangs a night behind the arrival
 * of every journey that ends exactly on the day's last hour.
 *
 * @param {Array<{travelTime: number, exempt: boolean}>} entries legs in travel order; `exempt`
 *        marks a leg that is slept through while moving (the fast sailer)
 * @param {number} travelPerDay travel hours per day, > 0
 * @param {boolean} includeRests false = travel round the clock, no rests at all
 * @returns {number[]} rest hours per leg, same length and order
 */
function avesmapsRouteRestPortions(entries, travelPerDay, includeRests) {
	const safeEntries = Array.isArray(entries) ? entries : [];
	const dayHours = Number(travelPerDay) > 0 ? Number(travelPerDay) : 0.5;
	const restPortion = Math.max(24 - dayHours, 0);
	// The counter survives the whole loop -- that is what makes the rest belong to the route.
	let hoursSinceRest = 0;

	return safeEntries.map((entry) => {
		if (entry && entry.exempt) {
			// Slept aboard: the passage costs no rest time and leaves the traveller rested.
			hoursSinceRest = 0;
			return 0;
		}

		if (!includeRests) {
			return 0;
		}

		let restTime = 0;
		let remaining = Number(entry && entry.travelTime) || 0;
		// The epsilon is not cosmetic: a leg boundary lands on the day's last hour through a chain
		// of float subtractions, so `hoursSinceRest` arrives as 11.999999999999998 rather than 12.
		// Without the tolerance that night is skipped, and the next stretch is 2e-15 hours long.
		while (remaining > 1e-9) {
			if (hoursSinceRest >= dayHours - 1e-9) {
				restTime += restPortion;
				hoursSinceRest = 0;
			}

			const stretch = Math.min(remaining, dayHours - hoursSinceRest);
			hoursSinceRest += stretch;
			remaining -= stretch;
		}

		return restTime;
	});
}
```

- [ ] **Step 4: Den Test laufen lassen und grün sehen**

```bash
node js/routing/__tests__/rest-portions.test.js
```

Erwartet: `rest-portions.test.js: all assertions passed`

- [ ] **Step 5: Gegenprobe, dass noch nichts verdrahtet ist**

Die Anzeige darf sich in dieser Aufgabe noch **nicht** ändern — die beiden Tests, die die alte
Regel kodieren, müssen also noch grün sein:

```bash
node js/routing/__tests__/speed-table-and-rest-rule.test.js
```

Erwartet: `speed-table-and-rest-rule.test.js: all assertions passed`. Schlägt er hier schon fehl,
wurde `buildRouteSteps` versehentlich mitgeändert — zurücknehmen, die Verdrahtung ist Aufgabe 2.

- [ ] **Step 6: Committen**

```bash
git add js/routing/route-result.js js/routing/__tests__/rest-portions.test.js && git commit -m "feat(routing): Rastportionen als eigene Rechnung -- ein Zaehler ueber die ganze Route"
```

---

### Task 2: Verdrahten, und die beiden Tests der alten Regel umschreiben

Hier ändert sich das Verhalten. Die zwei bestehenden Tests werden dabei rot — sie bewachen echte,
teure Fehler (Fluss und Küstenschiffe rasteten bis zum 02./03.08.2026 gar nicht) und dürfen ihre
Zähne **nicht** verlieren.

**Files:**
- Modify: `js/routing/route-result.js` (in `buildRouteSteps`, heutige Zeilen 50–95)
- Modify: `js/routing/__tests__/speed-table-and-rest-rule.test.js` (Abschnitt 1, Zeilen 82–124)
- Modify: `js/routing/__tests__/route-season-ground-apply.test.js` (Zeilen 129–134)

**Interfaces:**
- Consumes: `avesmapsRouteRestPortions(entries, travelPerDay, includeRests)` aus Aufgabe 1.
- Produces: `buildRouteSteps(...)[i].rest_time` folgt der Portionsregel. Feldname, Typ und
  Reihenfolge bleiben unverändert — `route-view-model.js`, `route-plan-calendar.js` und
  `buildRouteSummary` lesen weiter dasselbe.

- [ ] **Step 1: Die Rastregel in `speed-table-and-rest-rule.test.js` umschreiben**

In `js/routing/__tests__/speed-table-and-rest-rule.test.js` den Block von Zeile 82
(`// ---- 1. die Rastregel ---`) bis Zeile 124 (die `noRest`-Behauptung) **ersetzen** durch:

```js
// ---- 1. die Rastregel -----------------------------------------------------------------------------
// Eine Etappe von 300 Karteneinheiten = 900 Meilen der jeweiligen Wegart, mit 12 Reisestunden pro
// Tag (die Voreinstellung des Planers: 12 Reise, 8 Schlaf, 4 Lager).
//
// 💣 DIE LAENGE IST TEIL DER PRUEFUNG. Seit dem 14.08.2026 faellt die Rast in ganzen Portionen an,
// also erst jenseits eines Reisetages. Mit den frueheren 3 Meilen rastete NIEMAND mehr -- der Test
// waere gruen gewesen und haette nichts mehr bewacht. 900 Meilen sind fuer jedes Reisemittel dieser
// Tabelle mehr als ein Tagewerk, auch fuer den schnellsten Segler.
const stepFor = (type, transport) => {
	if (transport) {
		chosenTransport = Object.assign({}, chosenTransport, { [type]: transport });
	}
	const steps = buildRouteSteps(["A", "B"], [{
		geometry: { type: "LineString", coordinates: [[0, 0], [300, 0]] },
		properties: { feature_subtype: type, public_id: "s1" },
	}], { includeRests: true, restHoursPerDay: 12 });
	assert.strictEqual(steps.length, 1, `eine Etappe erwartet für ${type}`);
	return steps[0];
};
// Fuer eine EINZELNE Etappe, die ausgeruht beginnt, ist die Zahl der Naechte geschlossen:
// ceil(Reisezeit / Reisestunden) - 1.
const expectedRest = (travelTime, travelPerDay) =>
	Math.max(0, Math.ceil(travelTime / travelPerDay) - 1) * (24 - travelPerDay);
const restsInPortions = (step, what) => {
	assert.ok(step.travel_time > 0, `${what}: die Etappe hat überhaupt eine Reisezeit`);
	// 🔴 DAS IST DER ZAHN. Wer ein Reisemittel wieder von der Rast ausnimmt, faellt hier auf 0.
	assert.ok(step.rest_time > 0, `${what}: über 900 Meilen muss mindestens eine Nacht anfallen — ist ${step.rest_time}`);
	assert.ok(
		Math.abs(step.rest_time - expectedRest(step.travel_time, 12)) < 1e-9,
		`${what}: erwartet ${expectedRest(step.travel_time, 12)} Raststunden zu ${step.travel_time} Reisestunden `
		+ `— sind ${step.rest_time}`
	);
};

// 🔴 DAS IST DER TEST. Vor dem 2026-08-02 rastete der Fluss gar nicht.
restsInPortions(stepFor("Flussweg", "riverBarge"), "Flusskahn");
restsInPortions(stepFor("Weg", "groupFoot"), "Gruppe zu Fuß");

// 🔴 UND DAS IST DER ZWEITE. Bis zum 2026-08-03 hing die Ausnahme am WEGTYP, also bekam jedes Schiff
// den 24-Stunden-Tag. S. 131 gibt ihn namentlich nur dem Schnellsegler (250 Meilen) und der
// Kurier-Dromone (200, die wir nicht führen); der Lastensegler steht dort mit 120 bei 12 Stunden,
// die Galeere mit 70 bei 8 — beides Küstenschiffe, die „gewöhnlich nachts vor Anker gehen".
restsInPortions(stepFor("Seeweg", "cargoShip"), "Lastensegler");
restsInPortions(stepFor("Seeweg", "galley"), "Galeere");

const fastSailer = stepFor("Seeweg", "fastShip");
assert.ok(fastSailer.travel_time > 0, "der Schnellsegler hat eine Reisezeit");
assert.strictEqual(fastSailer.rest_time, 0, "nur der Schnellsegler fährt rund um die Uhr");

// 💣 Und die kurze Etappe rastet NICHT mehr: 3 Meilen sind fuer jedes Reisemittel weit unter einem
// Reisetag. Genau das war bis zum 14.08.2026 anders -- dort stand hier die halbe Reisezeit als Rast.
const shortLeg = buildRouteSteps(["A", "B"], [{
	geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
	properties: { feature_subtype: "Weg", public_id: "s1" },
}], { includeRests: true, restHoursPerDay: 12 })[0];
assert.ok(shortLeg.travel_time > 0 && shortLeg.travel_time < 12, "die kurze Etappe bleibt unter einem Reisetag");
assert.strictEqual(shortLeg.rest_time, 0, "wer vor Ablauf des Reisetages ankommt, rastet nicht");

// Ohne Rast im Planer (24 Reisestunden) rastet auch der Fluss nicht — der Schalter bleibt ein Schalter.
const noRest = buildRouteSteps(["A", "B"], [{
	geometry: { type: "LineString", coordinates: [[0, 0], [300, 0]] },
	properties: { feature_subtype: "Flussweg", public_id: "s1" },
}], { includeRests: false, restHoursPerDay: 0 });
assert.strictEqual(noRest[0].rest_time, 0, "ohne Rastwunsch rastet die Flussetappe nicht");
```

- [ ] **Step 2: Die Rast-Behauptungen in `route-season-ground-apply.test.js` umschreiben**

In `js/routing/__tests__/route-season-ground-apply.test.js` die Zeilen 129–134 (Kommentar
„💣 Die Rast waechst mit …" plus die beiden `assert`) **ersetzen** durch:

```js
// 💣 DIE RAST WAECHST MIT -- ABER IN PORTIONEN, NICHT ANTEILIG (seit 14.08.2026). Der Winterabzug
// verlaengert die vier Etappen von zusammen 122,4 auf 139,9 Reisestunden; das ist eine
// Nachtgrenze mehr, also 10 gegen 11 Portionen zu je 12 Stunden.
//
// 🔴 AUF DER EINZELNEN ETAPPE IST DAS NICHT ZU SEHEN: Etappe 1 traegt in beiden Faellen 24
// Stunden. Die alte Fassung dieses Tests verglich genau diese eine Etappe und waere seit dem
// Umbau rot -- die Aussage „mehr Reisezeit heisst mehr Rast" gehoert der SUMME, weil die Rast der
// Route gehoert und nicht der Zeile.
const restOf = (list) => list.reduce((total, step) => total + step.rest_time, 0);
const travelOf = (list) => list.reduce((total, step) => total + step.travel_time, 0);
assert.ok(Math.abs(travelOf(plain) - 122.4) < 1e-9, `Grundlinie 122,4 Reisestunden, war ${travelOf(plain)}`);
assert.strictEqual(restOf(plain), 120, `ohne Winter 10 Portionen zu 12 Stunden, waren ${restOf(plain)}`);
assert.strictEqual(restOf(winter), 132, `mit Winter 11 Portionen, waren ${restOf(winter)}`);
assert.ok(restOf(winter) > restOf(plain), "mehr Reisezeit heisst -- ueber die Grenze -- mehr Rast");
// Die Gegenprobe zur alten Regel: die Rast ist keine Kopie der Reisezeit mehr.
assert.ok(
	Math.abs(restOf(winter) - travelOf(winter)) > 1,
	`die Rast (${restOf(winter)}) darf nicht mehr die Reisezeit (${travelOf(winter)}) sein`
);
```

- [ ] **Step 3: Beide Tests laufen lassen und scheitern sehen**

```bash
node js/routing/__tests__/speed-table-and-rest-rule.test.js; node js/routing/__tests__/route-season-ground-apply.test.js
```

Erwartet: **beide FAIL.** Der erste mit „über 900 Meilen muss mindestens eine Nacht anfallen — ist
…" bzw. einer Abweichung von `expectedRest` (die alte anteilige Rast trifft die Portionszahl
nicht), der zweite mit „ohne Winter 10 Portionen zu 12 Stunden, waren 122.40000000000002".

Sehen sie **nicht** so aus, ist die Erwartung falsch abgeschrieben — nicht die Implementierung
anpassen, bis der Test passt, sondern die Zahl nachrechnen.

- [ ] **Step 4: Die Verdrahtung in `buildRouteSteps` schreiben**

In `js/routing/route-result.js` den Rumpf von `buildRouteSteps` ab der heutigen Zeile 50
(`return planEntries.map((entry) => {`) so ändern, dass die Ausnahme **vor** dem Mappen bestimmt
und die Rast einmal für alle Etappen gerechnet wird:

```js
	// 💣 THE NIGHT PASSAGE BELONGS TO A SHIP, NOT TO THE SEA. S. 131 grants it by name to exactly
	// two vessels -- the Schnellsegler (250 miles) and the Kurier-Dromone (200, which we do not
	// model) -- and calls it a special case with conditions. The Lastensegler's own row is 120
	// miles at 12 hours and the Galeere's is 70 at 8; both are coastal ships, of which the same
	// page says they „ankern gewöhnlich nachts oder laufen einen Hafen an".
	//
	// This condition was keyed on the PATH TYPE until 2026-08-03 and handed the 24-hour day to
	// every ship afloat: the Lastensegler ran 201,7 miles/day against a source row of 120, the
	// Galeere 181,5 against 70. Only the Schnellsegler happened to land right (242 against 250),
	// which is what made the error look like none. Same shape as the river bug it followed --
	// right per hour, wrong per day.
	const exemptFlags = planEntries.map((entry) => entry.type === "Seeweg"
		&& resolveRouteStepTransport(entry, entry.type) === "fastShip");
	// 💣 ONE call for the WHOLE route, outside the map. The rest belongs to the journey, not to the
	// row: three short legs share a travel day, and a night can fall in the middle of a leg.
	const restPortions = avesmapsRouteRestPortions(
		planEntries.map((entry, index) => ({ travelTime: entry.travelTime, exempt: exemptFlags[index] })),
		travelPerDay,
		includeRests
	);

	return planEntries.map((entry, index) => {
		const restTime = restPortions[index];
```

Der Rest des `return`-Objekts (`type`, `transport`, `from`, `to`, `path_name`, `flow_state`,
`offroad`, `distance`, `travel_time`, `rest_time: restTime`, `season_ground`, `segment_ids`) bleibt
**unverändert**. Die heutigen Zeilen 51–69 (`let restTime = 0;`, der `exemptFromRest`-Block und die
`if (includeRests && !exemptFromRest)`-Rechnung) entfallen, weil ihr Inhalt oben aufgeht.

⚠️ `travelPerDay` und `includeRests` sind bereits weiter oben in der Funktion definiert (heutige
Zeilen 40–42) — nicht neu berechnen.

- [ ] **Step 5: Die drei Tests laufen lassen und grün sehen**

```bash
node js/routing/__tests__/rest-portions.test.js; node js/routing/__tests__/speed-table-and-rest-rule.test.js; node js/routing/__tests__/route-season-ground-apply.test.js
```

Erwartet: dreimal `all assertions passed`.

- [ ] **Step 6: Den Test prüfen, der NICHT rot werden darf**

`route-plan-leg-date.test.js` datiert vier Etappen aus `travel_time + rest_time`. Die Kalenderzeit
schrumpft durch den Umbau von 244,8 auf 242,4 Stunden — nachgerechnet überschreitet das keine
Tagesgrenze, alle vier Datumsangaben bleiben stehen. Das ist eine Vorhersage und wird geprüft:

```bash
node js/routing/__tests__/route-plan-leg-date.test.js; node js/routing/__tests__/travel-costs.test.js; node js/routing/__tests__/travel-calendar.test.js
```

Erwartet: dreimal `all assertions passed`.

⚠️ Wird `route-plan-leg-date.test.js` doch rot, ist das **kein** Anlass, seine Datumsangaben
umzuschreiben — dann stimmt die Rechnung nicht. Erst nachrechnen, welche Etappe wie viele
Kalenderstunden trägt, und den Befund melden.

- [ ] **Step 7: Committen**

```bash
git add js/routing/route-result.js js/routing/__tests__/speed-table-and-rest-rule.test.js js/routing/__tests__/route-season-ground-apply.test.js && git commit -m "fix(routing): die Rast faellt in Portionen an, nicht anteilig zur Reisezeit"
```

---

### Task 3: Der Erklärtext, das ganze Testfeld, der Blick im Browser

**Files:**
- Modify: `index.html:2305` (das `title`-Attribut des Reisestunden-Feldes)
- Modify: `js/app/i18n-en.js:27` (`planner.travelHours.title`)

**Interfaces:**
- Consumes: das fertige Verhalten aus Aufgabe 2.
- Produces: nichts, worauf Code zugreift.

- [ ] **Step 1: Den deutschen Erklärtext ergänzen**

⚠️ `index.html` hat CRLF — **einzeiliger** Edit, die Zeile nicht umbrechen. In Zeile 2305 den
`title` ersetzen:

alt:
```
Reisestunden pro Tag; der Rest des Tages ist Rast. Gilt für alle Reisearten außer dem Schnellsegler, der rund um die Uhr fährt. 24 = ohne Rast durchreisen.
```

neu:
```
Reisestunden pro Tag; der Rest des Tages ist Rast. Gerastet wird erst, wenn die Reisestunden aufgebraucht sind und noch Weg vor einem liegt. Gilt für alle Reisearten außer dem Schnellsegler, der rund um die Uhr fährt. 24 = ohne Rast durchreisen.
```

- [ ] **Step 2: Den englischen Erklärtext nachziehen**

💣 Beide Seiten, sonst steht die englische Fassung allein auf der alten Erklärung. In
`js/app/i18n-en.js:27` den Wert von `"planner.travelHours.title"` ersetzen durch:

```js
	"planner.travelHours.title": "Travel hours per day; the rest of the day is spent resting. A rest is only taken once the day's travel hours are used up and there is still road ahead. Applies to every mode except the fast sailer, which runs around the clock. 24 = travel without rest.",
```

- [ ] **Step 3: Das GANZE JS-Testfeld laufen lassen**

🔴 Nicht nur die eigenen Tests (AGENTS §9): am 12.08.2026 brach eine CSS-Änderung einen Test in
einer fremden Datei, und fünf Deploys hintereinander fielen aus.

```bash
for t in $(find js tools -path '*__tests__*' -name '*.test.js'); do node "$t" >/dev/null 2>&1 || echo "ROT: $t"; done; echo "--- Durchlauf beendet"
```

Erwartet: keine `ROT:`-Zeile, nur `--- Durchlauf beendet`. Meldet er eine Datei, diese einzeln
ohne `>/dev/null` laufen lassen und den Fehler lesen.

- [ ] **Step 4: Im Browser nachsehen — Ablauf, nicht Maß**

⚠️ AGENTS §9: eine Zahl in einer Prüftabelle ist kein Beleg. Die Karte öffnen
(`preview_start` mit `.claude/launch.json`, sonst die laufende Instanz) und **drei** Routen planen:

1. **Kurz** — zwei benachbarte Orte, unter einem Reisetag. Erwartet: **Rastzeit 0 Stunden**,
   Gesamtzeit = Reisezeit. (Vorher: Gesamtzeit doppelt so hoch.)
2. **Lang** — quer über den Kontinent, mehrere Nächte. Erwartet: die Rastzeit ist ein **ganzes
   Vielfaches von 12** Stunden, und die Etappentabelle zeigt sie **ungleich verteilt** — manche
   Zeilen 0, manche 12 oder 24.
3. **Mit Schnellsegler** — eine Route über See, Transportmittel „Schnellsegler". Erwartet: die
   Seeetappe trägt **0** Rast, und die Landetappen dahinter fangen ausgeruht an.

Bei jeder Route ansehen: Etappentabelle, Zusammenfassung (Reisezeit / Rastzeit / Gesamt), das
**Ankunftsdatum** (mit gesetztem Reisebeginn) und die **Kostenzeile „Übernachtung"**. Die
Nächtezahl der Kosten muss zur Zahl der Rastportionen passen.

Danach den Regler auf **16 Reisestunden** stellen und dieselbe lange Route erneut planen: die
Rastzeit muss in Portionen von **8** Stunden anfallen, nicht von 12.

- [ ] **Step 5: Committen**

```bash
git add index.html js/app/i18n-en.js && git commit -m "ui(routing): der Erklaertext zum Reisestunden-Feld nennt die Portionsregel"
```

- [ ] **Step 6: Pushen — allein, und dann hinsehen**

💣 Sichtbare Änderungen gehen EINZELN live (AGENTS §9). Vorher prüfen, dass nichts Fremdes
mitgeht:

```bash
git status --short && git log --oneline origin/master..master
```

Erwartet: genau die drei Commits dieses Bauplans; die fremden geänderten und unversionierten
Dateien stehen weiterhin **ungestaged** da.

```bash
git push origin master && git log -1 --format='%H %s' origin/master
```

⚠️ Wird der Push abgelehnt: `git fetch` + `git rebase origin/master` + erneut versuchen, **nie**
`--force`. Liegen fremde ungestagte Änderungen im Weg, die den Rebase blockieren, den Befund
melden statt zu stashen — der Baum gehört mehreren Sitzungen.

Nach ~1–2 Minuten Deploy die Live-Seite mit einem Cache-Buster prüfen und dem Owner sagen, dass er
draufschauen kann.

---

## Selbstprüfung des Plans

**Deckung des Entwurfs:**

| Entwurf | Aufgabe |
|---|---|
| §3 Modell (Zähler, Buchung vor dem nächsten Stück) | 1 (Step 3) |
| §3 Schnellsegler setzt zurück | 1 (Step 3), Test Fall 5 |
| §4 Ort der Änderung, `buildRouteSteps` | 2 (Step 4) |
| §5 Kosten unangetastet, Invariante | 1 (Test Fall 8), 3 (Step 4) |
| §6 Erklärtext DE + EN | 3 (Steps 1–2) |
| §7 Falle „ein Zähler" | 1 (Test Fall 4), Kommentar in Step 3 |
| §7 Falle „nach dem Verschmelzen" | 2 (Step 4: die Rechnung sitzt in `buildRouteSteps`, hinter `buildRoutePlanEntries`) |
| §7 Falle „zwei rote Tests" | 2 (Steps 1–3) |
| §7 Deploy-Tor | 3 (Step 3) |
| §8 Prüfliste 1–7 | 1 (Testfälle 1–8) |
| §8 Abnahme im Browser | 3 (Step 4) |
| §9 kein Server, keine Tempotabelle | Global Constraints |

**Keine Platzhalter:** jeder Schritt enthält den Code oder den genauen Befehl.

**Namen konsistent:** `avesmapsRouteRestPortions(entries, travelPerDay, includeRests)` wird in
Aufgabe 1 definiert und in Aufgabe 2 mit genau dieser Signatur gerufen; `exempt` heißt in beiden
Aufgaben `exempt`; `travelPerDay` ist in `buildRouteSteps` bereits vorhanden und wird
durchgereicht.
