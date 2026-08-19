// „Zugehörigkeit rechnen": der gespeicherte Anteil ist GERICHTET (19.08.2026).
//
// 🔴 Warum das eine Zusicherung braucht: seit die Lebensraum-Regel „innerhalb" bedeutet, IST diese
// Zahl die Antwort auf „liegt X in Y" (api/_internal/app/lore-rule.php,
// avesmapsLoreRuleFlaecheLiegtIn). Sie stand bis zum 19.08.2026 in BEIDEN Zeilen eines Paares
// gleich -- als Anteil der kleineren der beiden --, und für die größere von beiden bedeutete sie
// damit das Gegenteil dessen, was ihre Zeile behauptet.
//
// ⚠️ Die SCHWELLE bleibt der Anteil der KLEINEREN (RAYCAST_THRESHOLD, Owner 27.07.2026): ein
// Gebirgszug quer durch mehrere derographische Regionen fiele „als Anteil des Zuges" gemessen
// überall heraus. Schwelle und Wert sind seither zwei verschiedene Zahlen, und dieser Test hält
// beide auseinander.
//
// 💣 computeRaycast wohnt INLINE in html/landschaften-editor.html -- sie hat keine Moduldatei, und
// deshalb hatte sie bis heute auch keinen Test. Hier wird ihr Quelltext aus der Seite geschnitten
// und mit gestellten Geometriehelfern ausgeführt: das prüft die echte Fassung, nicht eine Kopie,
// die beim ersten Umbau still auseinanderläuft.
//
// Lauf: node js/map-features/__tests__/zugehoerigkeit-gerichteter-anteil.test.js

const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");

const seite = fs.readFileSync("html/landschaften-editor.html", "utf8");

// Den Rumpf EINER Funktion samt Kopf aus der Seite schneiden, über Klammerzählung. Ein Regex über
// die ganze Funktion wäre an der ersten verschachtelten Klammer gescheitert.
function funktionsQuelle(name) {
	const start = seite.indexOf("function " + name + "(");
	assert.ok(start > -1, "die Seite enthält " + name + " nicht (mehr?) -- der Schnitt greift ins Leere");
	let tiefe = 0;
	let i = seite.indexOf("{", start);
	const oeffnung = i;
	for (; i < seite.length; i++) {
		if (seite[i] === "{") { tiefe++; }
		if (seite[i] === "}") { tiefe--; if (tiefe === 0) { break; } }
	}
	assert.ok(i > oeffnung, "die Klammern von " + name + " gehen nicht auf");
	return seite.slice(start, i + 1);
}

// Die Schwelle steht als Konstante in derselben Seite -- gelesen statt abgeschrieben, sonst prüft
// dieser Test gegen eine Zahl, die es dort nicht mehr gibt.
const schwelleTreffer = seite.match(/const RAYCAST_THRESHOLD = ([\d.]+);/);
assert.ok(schwelleTreffer, "RAYCAST_THRESHOLD steht nicht mehr in html/landschaften-editor.html");
const RAYCAST_THRESHOLD = Number(schwelleTreffer[1]);
assert.strictEqual(RAYCAST_THRESHOLD, 0.1, "die Owner-Schwelle vom 27.07.2026 ist 10 %");

// Quadrate, damit Fläche und Schnitt von Hand nachrechenbar sind: der Behälter ist 100x100 = 10.000,
// das Mitglied 10x10 = 100 und liegt ganz darin. Anteil des Mitglieds = 1,0; Anteil des Behälters
// = 0,01. Genau diese zwei Zahlen müssen in den zwei Zeilen des Paares stehen.
const quadrat = (x, y, s) => ({ type: "Polygon", coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });
const flaecheVon = (geometry) => {
	const ring = geometry.coordinates[0];
	return Math.abs((ring[1][0] - ring[0][0]) * (ring[2][1] - ring[1][1]));
};

const sandkasten = {
	console,
	RAYCAST_THRESHOLD,
	raycastNote: "",
	// Die echten Helfer sind Leaflet-frei, aber sie hängen an polygon-clipping über window. Für zwei
	// ineinanderliegende Quadrate genügt die exakte Rechnung von Hand -- geprüft wird hier die
	// FORMEL des Anteils, nicht die Verschneidung (die hat ihre eigenen Tests).
	ecosystemGeometryArea: flaecheVon,
	ecosystemBooleanGeometry: (operation, a, b) => {
		assert.strictEqual(operation, "intersection", "computeRaycast verschneidet, es vereinigt nicht");
		const kleiner = flaecheVon(a) <= flaecheVon(b) ? a : b;
		return kleiner; // vollständig enthalten: die Schnittmenge IST die kleinere Fläche
	},
};
sandkasten.globalThis = sandkasten;
vm.createContext(sandkasten);
vm.runInContext(funktionsQuelle("boundsOverlap"), sandkasten);
vm.runInContext(funktionsQuelle("groupAreasByRegion"), sandkasten);
vm.runInContext(funktionsQuelle("computeRaycast"), sandkasten);

const flaechen = [
	{ region_public_id: "behaelter", region_name: "Mittelaventurien", kind: "derographisch", region_type: "region",
		geometry: quadrat(0, 0, 100), bounds: { min_x: 0, min_y: 0, max_x: 100, max_y: 100 } },
	{ region_public_id: "mitglied", region_name: "Koschberge", kind: "topographie", region_type: "gebirge",
		geometry: quadrat(10, 10, 10), bounds: { min_x: 10, min_y: 10, max_x: 20, max_y: 20 } },
];
const ergebnis = sandkasten.computeRaycast(flaechen);

const vomMitglied = ergebnis.get("mitglied");
const vomBehaelter = ergebnis.get("behaelter");
assert.strictEqual(vomMitglied.length, 1, "das Paar wird gespeichert -- die kleinere liegt zu 100 % darin");
assert.strictEqual(vomBehaelter.length, 1, "und zwar in BEIDEN Richtungen, als zwei Zeilen");

// 🔴 DIE Zusicherung: zwei Zeilen, zwei VERSCHIEDENE Zahlen.
assert.strictEqual(vomMitglied[0].share, 1,
	"in der Zeile des Mitglieds steht sein eigener Anteil: die Koschberge liegen ganz in Mittelaventurien");
assert.ok(Math.abs(vomBehaelter[0].share - 0.01) < 1e-9,
	"in der Zeile des Behälters steht SEIN Anteil (1 %) -- nicht noch einmal die 100 % des Mitglieds");
assert.notStrictEqual(vomMitglied[0].share, vomBehaelter[0].share,
	"symmetrisch gespeichert behauptet die Zeile des Behälters, er läge im Mitglied");

// ⚠️ Die Gegenprobe, die nicht null ist -- und die zeigt, dass die SCHWELLE weiter an der kleineren
// hängt: dasselbe Mitglied überlappt den Behälter nur zu 1 %, und trotzdem bleibt das Paar drin.
// Hinge die Schwelle am eigenen Anteil, verschwände hier die Zeile des Behälters.
assert.ok(vomBehaelter[0].share < RAYCAST_THRESHOLD,
	"der eigene Anteil des Behälters liegt UNTER der Schwelle -- und das Paar existiert trotzdem");

// Und ein Paar, das die Schwelle wirklich verfehlt, fällt ganz heraus: ein Mitglied, das nur zu
// 4 % in seinem eigenen Umriss überlappt wäre hier nicht darstellbar, also ein winziges Quadrat,
// das den Behälter nur streift -- ohne echte Verschneidung gibt es keine Zeile.
const getrennt = sandkasten.computeRaycast([
	flaechen[0],
	{ region_public_id: "fern", region_name: "Khoramgebirge", kind: "topographie", region_type: "gebirge",
		geometry: quadrat(500, 500, 10), bounds: { min_x: 500, min_y: 500, max_x: 510, max_y: 510 } },
]);
assert.strictEqual(getrennt.get("fern").length, 0, "ohne Überschneidung keine Zeile");
assert.strictEqual(getrennt.get("behaelter").length, 0);

console.log("zugehoerigkeit-gerichteter-anteil: OK");
