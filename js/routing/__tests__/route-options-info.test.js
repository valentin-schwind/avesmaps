// Die Zeilen der Bodentabelle im Infodialog „Reiseoptionen".
//
// 🔴 Geprueft wird die ZUSAMMENFASSUNG, nicht die Optik. Sie darf nur BENACHBARTE Zonen
// zusammenlegen: die Reihenfolge in SEASON_GROUND_TABLE ist die Erdkunde (Nord nach Sued), und
// wer sie umsortiert, um mehr zusammenlegen zu koennen, druckt eine Tabelle, in der „Polar"
// neben „Tropisch" steht, weil beide im Sommer nichts tun.
//
// Lauf: node js/routing/__tests__/route-options-info.test.js

const assert = require("assert");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..", "..");
const info = require(path.join(repoRoot, "js/routing/route-options-info.js"));
const { SEASON_GROUND_TABLE } = require(path.join(repoRoot, "js/routing/season-ground.js"));

// ================================================================ 1. gegen die echte Tabelle
const rows = info.avesmapsRouteOptionsClimateRows(SEASON_GROUND_TABLE);
const zoneCount = Object.keys(SEASON_GROUND_TABLE).length;

assert.ok(rows.length > 0 && rows.length <= zoneCount, "nie mehr Zeilen als Zonen");
assert.deepStrictEqual(
	rows.reduce((all, row) => all.concat(row.zoneKeys), []),
	Object.keys(SEASON_GROUND_TABLE),
	"💣 jede Zone kommt genau einmal vor, in der Reihenfolge der Tabelle"
);

// Subpolar und Boreal haben denselben Jahreslauf und stehen nebeneinander -- die eine Zeile ist
// die Aussage des Dialogs („die beiden verhalten sich gleich").
const merged = rows.find((row) => row.zoneKeys.length > 1 && row.zoneKeys.includes("subpolar"));
assert.ok(merged, "subpolar liegt in einer zusammengefassten Zeile");
assert.ok(merged.zoneKeys.includes("boreal"), "und zwar mit boreal zusammen");

// ============================================================ 2. nur BENACHBARTES wird gefasst
const spaced = info.avesmapsRouteOptionsClimateRows({
	a: { winter: "eis" },
	b: { winter: "" },
	c: { winter: "eis" },
});
assert.strictEqual(spaced.length, 3, "💣 a und c sind gleich, aber nicht benachbart -- drei Zeilen");
assert.deepStrictEqual(spaced.map((row) => row.zoneKeys), [["a"], ["b"], ["c"]]);

const adjacent = info.avesmapsRouteOptionsClimateRows({
	a: { winter: "eis" },
	b: { winter: "eis" },
	c: { winter: "" },
});
assert.deepStrictEqual(adjacent.map((row) => row.zoneKeys), [["a", "b"], ["c"]], "benachbart Gleiches wird eine Zeile");

// Der Vergleich geht ueber ALLE Jahreszeiten, nicht nur die erste.
const partly = info.avesmapsRouteOptionsClimateRows({
	a: { winter: "eis", sommer: "" },
	b: { winter: "eis", sommer: "tauboden" },
});
assert.strictEqual(partly.length, 2, "ein Unterschied im Sommer trennt die Zeilen");

// ================== 3. die Zeilen kommen aus der KARTE, die Werte aus der Bodentabelle
// 💣 Die Landschaften-Ebene fuehrt acht Klimazonen, SEASON_GROUND_TABLE sieben
// (`trockene_subtropen` fehlt dort). Eine Zone der Karte ohne Bodeneintrag MUSS als eigene Zeile
// erscheinen -- als Reihe Bindestriche, denn genau das rechnet der Planer dort: nichts.
const withMapZones = info.avesmapsRouteOptionsClimateRows(SEASON_GROUND_TABLE, [
	"polar", "subpolar", "boreal", "gemaessigt",
	"subtropen_winterfeucht", "trockene_subtropen", "subtropisch", "tropisch",
]);
const flatKeys = withMapZones.reduce((all, row) => all.concat(row.zoneKeys), []);
assert.ok(flatKeys.includes("trockene_subtropen"), "💣 die Zone der Karte fehlt sonst spurlos im Dialog");
const dryRow = withMapZones.find((row) => row.zoneKeys.includes("trockene_subtropen"));
assert.deepStrictEqual(dryRow.seasons, {}, "ohne Bodeneintrag traegt die Zeile keine Zustaende");

// 💣 Und sie faellt mit subtropisch/tropisch ZUSAMMEN. Die drei sind verschieden gebaut -- die
// eine fehlt in der Bodentabelle, die anderen stehen mit vier leeren Jahreszeiten darin -- und
// bedeuten dasselbe: kein Bodenabzug. Getrennt waeren es zwei Zeilen aus lauter Bindestrichen
// untereinander, und der Unterschied waere niemandem erklaerbar.
assert.deepStrictEqual(
	dryRow.zoneKeys, ["trockene_subtropen", "subtropisch", "tropisch"],
	"verglichen wird das Ergebnis der Zeile, nicht die Form des Objekts"
);

// Ohne Zonenliste bleibt es beim alten Verhalten.
assert.deepStrictEqual(
	info.avesmapsRouteOptionsClimateRows(SEASON_GROUND_TABLE, []).map((row) => row.zoneKeys),
	rows.map((row) => row.zoneKeys),
	"leere Zonenliste = keine Zonenliste"
);

// ================================================================ 4. leere Eingabe, Rueckfall
assert.deepStrictEqual(info.avesmapsRouteOptionsClimateRows(null), [], "keine Tabelle -> keine Zeilen");
assert.deepStrictEqual(info.avesmapsRouteOptionsClimateRows({}), [], "leere Tabelle -> keine Zeilen");

// Der Rueckfallname greift, solange das Kartenpayload seine Zonennamen noch nicht geliefert hat.
// Er macht den Schluessel lesbar und erfindet nichts.
assert.strictEqual(info.avesmapsRouteOptionsZoneFallbackLabel("subtropen_winterfeucht"), "Subtropen winterfeucht");
assert.strictEqual(info.avesmapsRouteOptionsZoneFallbackLabel("polar"), "Polar");
assert.strictEqual(info.avesmapsRouteOptionsZoneFallbackLabel(""), "");
assert.strictEqual(info.avesmapsRouteOptionsZoneFallbackLabel(null), "");

console.log("route-options-info.test.js: alle Pruefungen bestanden");
