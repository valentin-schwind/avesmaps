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

// ---- 9. Eine nicht-endliche Reisezeit haengt die Schleife nicht auf ---------------------------
// 🔴 BEFUND AUS DER PRUEFUNG (Fix-Runde 1, 2026-08-14): `Number(Infinity) || 0` ist `Infinity`
// (wahr), und die Schleife zieht je Durchlauf nur ein ENDLICHES `dayHours` ab -- ohne eigene
// Schranke lief `remaining` nie unter das Epsilon, und der Aufruf kehrte nie zurueck (ein
// eingefrorener Tab, sobald Aufgabe 2 das verdrahtet). Der Beweis ist nicht die Zahl, sondern dass
// der Aufruf ueberhaupt zurueckkehrt: haengt er, wird die Zeitmessung nie erreicht.
const beforeInfiniteCall = Date.now();
const infiniteResult = avesmapsRouteRestPortions([leg(Infinity)], 12, true);
const infiniteCallDurationMs = Date.now() - beforeInfiniteCall;
assert.ok(
	infiniteCallDurationMs < 1000,
	`avesmapsRouteRestPortions muss zurueckkehren statt zu haengen, brauchte ${infiniteCallDurationMs} ms`
);
assert.deepStrictEqual(infiniteResult, [0], "eine nicht-endliche Reisezeit faellt auf 0, nicht auf eine Nacht");

// ---- 10. Der Zaehler selbst, nicht nur der Wrapper darueber ------------------------------------
// 🔴 SEIT DEM 14.08.2026 HAT DIE REGEL ZWEI VERBRAUCHER. `avesmapsRouteRestCounter` liefert einen
// laufenden Zaehler; `buildRouteSteps` erzeugt daraus ZWEI Instanzen -- eine fuer die angezeigte
// Rast, eine fuer die Kalenderuhr, an der `applyRouteSeasonGround` die Jahreszeit jeder Etappe
// ablieset. Die tragende Annahme ist, dass zwei Instanzen derselben Regel ueber dieselben Etappen
// dasselbe liefern. Bis hierher war der Zaehler nur ueber `avesmapsRouteRestPortions` mitgeprueft:
// wer ihn direkt benutzt, haette keinen Test gehabt.
assert.strictEqual(
	typeof avesmapsRouteRestCounter,
	"function",
	"avesmapsRouteRestCounter muss in route-result.js stehen"
);

// Der Zustand wandert von Aufruf zu Aufruf -- das ist der ganze Zweck.
const counter = avesmapsRouteRestCounter(12, true);
assert.strictEqual(counter(8, false), 0, "acht Stunden fuellen den Tag noch nicht");
assert.strictEqual(counter(8, false), 12, "die naechsten acht ueberschreiten ihn -- eine Portion");
assert.strictEqual(counter(2, false), 0, "danach ist wieder Luft im Tag");

// 🔴 Zwei Instanzen, dieselben Etappen, dasselbe Ergebnis. Genau darauf steht die Verdrahtung in
// buildRouteSteps; laufen sie je auseinander, datiert die Uhr Etappen in die falsche Jahreszeit,
// waehrend die angezeigte Rast stimmt -- ein Widerspruch, den niemand im Plan sehen kann.
const sameRoute = [leg(20), leg(6, true), leg(9), leg(30), leg(1)];
const viaWrapper = avesmapsRouteRestPortions(sameRoute, 12, true);
const viaCounter = ((book) => sameRoute.map((entry) => book(entry.travelTime, entry.exempt)))(
	avesmapsRouteRestCounter(12, true)
);
assert.deepStrictEqual(
	viaCounter,
	viaWrapper,
	`zwei Instanzen derselben Regel muessen dasselbe liefern: ${viaCounter} gegen ${viaWrapper}`
);

console.log("rest-portions.test.js: all assertions passed");
