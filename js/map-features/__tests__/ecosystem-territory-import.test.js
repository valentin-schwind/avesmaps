// V7 „Grenze aus Territorien …" -- die reine Rechnung, ohne Fenster und ohne Karte.
//
// Was hier bewiesen wird, ist genau das, was im Browser NICHT nachweisbar ist, solange keine lokale
// Datenbank und kein lokaler Politik-Endpunkt existieren: der Baumbau aus `parent_public_id`, die
// Vereinigung, und das Runden vor dem Schreiben. Alles Übrige (Menü, Dialog, Vorschau) wird im Browser
// abgenommen -- „Tests grün" ist dort kein Nachweis.

const assert = require("assert");
const path = require("path");

// Die ECHTE Bibliothek, die die App ausliefert, kein Stub: die Frage, ob eine Vereinigung getrennter
// Gebiete ein Multipolygon überlebt, beantwortet nur die echte Sweep-Line.
global.window = { polygonClipping: require(path.join(__dirname, "../../third-party/polygon-clipping.umd.min.js")) };

// Übergeben wie Browser-Globale übergeben werden (164 <script>-Tags, ein Scope). Die ECHTEN, damit der
// Test nebenbei beweist, dass die Dateien sich über „Teil" und „Fläche" einig sind.
const { ecosystemGeometryParts, ecosystemGeometryArea, ecosystemGeometryBounds } = require("../map-features-ecosystem-geometry.js");
global.ecosystemGeometryParts = ecosystemGeometryParts;
global.ecosystemGeometryArea = ecosystemGeometryArea;
global.ecosystemGeometryBounds = ecosystemGeometryBounds;
global.ecosystemBooleanGeometry = require("../map-features-ecosystem-boolean.js").ecosystemBooleanGeometry;

const {
	territoryImportLabel,
	buildTerritoryImportRows,
	territoryImportDescendants,
	territoryImportVisibleRows,
	isUsableImportGeometry,
	unionTerritoryImportGeometries,
	roundImportGeometry,
	formatImportSummary,
} = require("../map-features-ecosystem-territory-import.js");

const box = (x1, y1, x2, y2) => ({
	type: "Polygon",
	coordinates: [[[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]],
});

// ------------------------------------------------------- DER NAME TRÄGT SEINEN RANG SCHON ---
// 💣 713 von 945 Namen beginnen mit ihrem exakten territory_type. Ein vorangestellter Typ ergab
// „Baronie Baronie Schneehag"; angehängt wird er nur, wo der Name ihn wirklich nicht trägt.
assert.strictEqual(territoryImportLabel({ name: "Baronie Schneehag", type: "Baronie" }), "Baronie Schneehag");
assert.strictEqual(territoryImportLabel({ name: "Thorwal", type: "Reich" }), "Thorwal (Reich)");
assert.strictEqual(
	territoryImportLabel({ name: "Baronie Herzoglich Waldleuen", type: "Herzogliche Baronie" }),
	"Baronie Herzoglich Waldleuen",
	"am Kopfnomen verglichen: „Herzogliche Baronie\" gilt als von „Baronie …\" getragen"
);
assert.strictEqual(territoryImportLabel({ name: "Alanfanisches Imperium", type: "" }), "Alanfanisches Imperium");
assert.strictEqual(territoryImportLabel({ name: "", type: "Baronie" }), "Baronie");

// ------------------------------------------------------------------------ DER BAUM ---
const tree = buildTerritoryImportRows([
	{ publicId: "b", name: "Baronie Schneehag", type: "Baronie", parentId: "f" },
	{ publicId: "r", name: "Mittelreich", type: "Reich", parentId: "" },
	{ publicId: "f", name: "Fürstentum Kosch", type: "Fürstentum", parentId: "r" },
	{ publicId: "a", name: "Baronie Angbar", type: "Baronie", parentId: "f" },
]);
assert.deepStrictEqual(tree.map((row) => row.publicId), ["r", "f", "a", "b"], "Vorfahre vor Kind, Geschwister nach Namen");
assert.deepStrictEqual(tree.map((row) => row.depth), [0, 1, 2, 2]);
assert.strictEqual(tree[1].parentId, "r");
assert.deepStrictEqual(tree[1].childIds, ["a", "b"]);

// Eine WAISE -- Elternteil nicht in der Antwort, weil die Zoom-Bänderung es weggelassen hat -- wird zur
// Wurzel statt zu verschwinden. Ein Gebiet, das man auswählen könnte, darf daran nicht scheitern.
const orphaned = buildTerritoryImportRows([
	{ publicId: "x", name: "Baronie Ohneland", type: "Baronie", parentId: "gibt-es-nicht" },
]);
assert.strictEqual(orphaned.length, 1);
assert.strictEqual(orphaned[0].depth, 0, "Waise wird Wurzel");
assert.strictEqual(orphaned[0].parentId, "");

// 💣 Zyklus: ein auf sich selbst zeigendes Elternteil ist ein Datenfehler, kein Grund zu hängen. Beide
// Zeilen kommen trotzdem heraus.
const cyclic = buildTerritoryImportRows([
	{ publicId: "p", name: "Ping", type: "Reich", parentId: "q" },
	{ publicId: "q", name: "Pong", type: "Reich", parentId: "p" },
]);
assert.strictEqual(cyclic.length, 2, "der Zyklenwächter verliert keine Zeile");

// Ein Gebiet, das sich selbst als Elternteil trägt, ist eine Wurzel und kein unendlicher Abstieg.
const selfParent = buildTerritoryImportRows([{ publicId: "s", name: "Selbst", type: "Reich", parentId: "s" }]);
assert.strictEqual(selfParent.length, 1);
assert.strictEqual(selfParent[0].depth, 0);

// ---------------------------------------------------------------- NACHFAHREN & SUCHE ---
const descendants = territoryImportDescendants(tree);
assert.deepStrictEqual(descendants.get("r").sort(), ["a", "b", "f"], "das Reich zieht Enkel mit");
assert.deepStrictEqual(descendants.get("f").sort(), ["a", "b"]);
assert.deepStrictEqual(descendants.get("a"), []);

// Ein Treffer zieht seine VORFAHREN mit -- eine Baumzeile ohne ihre Eltern stünde in einer Einrückung,
// die nichts mehr bedeutet.
assert.deepStrictEqual(
	territoryImportVisibleRows(tree, "schneehag").map((row) => row.publicId),
	["r", "f", "b"],
	"Treffer plus Vorfahrenkette, in Baumreihenfolge"
);
assert.strictEqual(territoryImportVisibleRows(tree, "").length, tree.length, "leere Suche zeigt alles");
assert.strictEqual(territoryImportVisibleRows(tree, "Nirgendwo").length, 0);

// ------------------------------------------------------------------- VEREINIGEN ---
assert.strictEqual(isUsableImportGeometry(box(0, 0, 1, 1)), true);
assert.strictEqual(isUsableImportGeometry({ type: "LineString", coordinates: [[0, 0]] }), false);
assert.strictEqual(isUsableImportGeometry(null), false);

// Getrennt liegende Gebiete ergeben ein MultiPolygon -- eine Fläche mit Inseln, und `create_area` nimmt
// das an. Wer hier „eine Fläche = ein Ring" annimmt, bricht als Erstes.
const twoRealms = unionTerritoryImportGeometries([
	{ label: "A", geometry: box(0, 0, 10, 10) },
	{ label: "B", geometry: box(50, 50, 60, 60) },
]);
assert.strictEqual(twoRealms.type, "MultiPolygon");
assert.strictEqual(ecosystemGeometryParts(twoRealms).length, 2);

// Aneinandergrenzende Gebiete fallen zu EINEM Polygon zusammen -- der Typ folgt der Form, nicht der
// Eingabe. Genau das ist der Zweck: die innere Grenze verschwindet.
const twoBaronies = unionTerritoryImportGeometries([
	{ label: "A", geometry: box(0, 0, 10, 10) },
	{ label: "B", geometry: box(10, 0, 20, 10) },
]);
assert.strictEqual(twoBaronies.type, "Polygon");
assert.strictEqual(Math.round(ecosystemGeometryArea(twoBaronies)), 200);

// Ein angehaktes Elternteil macht seine angehakten Kinder nicht doppelt: das Kind liegt im Elternteil,
// die Vereinigung bleibt das Elternteil.
const parentAndChild = unionTerritoryImportGeometries([
	{ label: "Reich", geometry: box(0, 0, 100, 100) },
	{ label: "Baronie", geometry: box(10, 10, 20, 20) },
]);
assert.strictEqual(Math.round(ecosystemGeometryArea(parentAndChild)), 10000);

// 🔴 KOPIE, NIE VERKNÜPFUNG -- und das fängt bei der Referenz an. Bei EINER Auswahl darf nicht die
// Geometrie des Politik-Layers selbst durchgereicht werden; sonst schreibt eine spätere Änderung an der
// Kopie in die Quelle.
const source = box(0, 0, 5, 5);
const single = unionTerritoryImportGeometries([{ label: "Nur eines", geometry: source }]);
assert.notStrictEqual(single, source, "keine geteilte Referenz");
assert.notStrictEqual(single.coordinates[0], source.coordinates[0], "auch die Ringe sind kopiert");
single.coordinates[0][0][0] = 999;
assert.strictEqual(source.coordinates[0][0][0], 0, "die Quellgeometrie bleibt unberührt");

assert.throws(() => unionTerritoryImportGeometries([]), /brauchbare Geometrie/);
assert.throws(() => unionTerritoryImportGeometries([{ label: "kaputt", geometry: null }]), /brauchbare Geometrie/);

// ---------------------------------------------------------------------- RUNDEN ---
// 🔴 round(…, 4) beim Schreiben halbiert die Nutzlast (gemessen: 500 Flächen à 800 Ecken = 14,8 MB
// ungerundet).
const rounded = roundImportGeometry({
	type: "Polygon",
	coordinates: [[[0.123456789, 1.987654321], [10.5, 0], [10, 10], [0.123456789, 1.987654321]]],
});
assert.deepStrictEqual(rounded.coordinates[0][0], [0.1235, 1.9877]);
assert.strictEqual(rounded.type, "Polygon");

// 🪤 Runden kann zwei Ecken auf dieselbe Stelle legen. Die Dublette fliegt raus, der Ringschluss wird
// neu gesetzt -- sonst stünde eine Kante der Länge null in jeder Nutzlast.
const deduped = roundImportGeometry({
	type: "Polygon",
	coordinates: [[[0, 0], [0.00001, 0], [10, 0], [10, 10], [0, 0]]],
});
assert.deepStrictEqual(
	deduped.coordinates[0],
	[[0, 0], [10, 0], [10, 10], [0, 0]],
	"die zusammengefallene Ecke ist weg, der Ring bleibt geschlossen"
);

// Der Ringschluss wird auch dann gesetzt, wenn er in der Eingabe fehlte.
const closed = roundImportGeometry({ type: "Polygon", coordinates: [[[0, 0], [4, 0], [4, 4]]] });
assert.deepStrictEqual(closed.coordinates[0][0], closed.coordinates[0][3]);

// 💣 STIRBT DER ÄUSSERE RING, STIRBT DER TEIL. Sonst rückte ein Loch an seine Stelle -- aus einer
// Lichtung würde ein Wald.
const holePromotion = roundImportGeometry({
	type: "MultiPolygon",
	coordinates: [
		[
			[[7, 7], [7.00001, 7], [7, 7.00001], [7, 7]],   // äusserer Ring fällt beim Runden zusammen
			[[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]],       // ein Loch, das ohne die Regel Aussenring würde
		],
		[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
	],
});
assert.strictEqual(holePromotion.type, "Polygon", "nur ein Teil überlebt, also Polygon");
assert.deepStrictEqual(holePromotion.coordinates, [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]);

// Bleibt gar nichts übrig, wird das gesagt statt geschrieben -- `update_area_geometry` nähme eine leere
// Fläche anstandslos an.
assert.throws(
	() => roundImportGeometry({ type: "Polygon", coordinates: [[[5, 5], [5.00001, 5], [5, 5.00001], [5, 5]]] }),
	/keine Fläche/
);

// Ein Multipolygon mit zwei gesunden Teilen bleibt eines.
const multi = roundImportGeometry({
	type: "MultiPolygon",
	coordinates: [box(0, 0, 1, 1).coordinates, box(5, 5, 6, 6).coordinates],
});
assert.strictEqual(multi.type, "MultiPolygon");
assert.strictEqual(ecosystemGeometryParts(multi).length, 2);

// ---------------------------------------------------------------- DIE STATUSZEILE ---
assert.match(formatImportSummary(0, null, 0), /Nichts gewählt/);
const summary = formatImportSummary(2, twoRealms, 4096);
assert.match(summary, /2 Gebiete/);
assert.match(summary, /2 Teile/);
assert.match(summary, /8 Ecken/, "je Kasten vier Ecken, der Schlusspunkt zählt nicht mit");
assert.match(summary, /4\.0 KB/);
assert.match(formatImportSummary(1, box(0, 0, 1, 1), 0), /1 Gebiet · 1 Teil · 4 Ecken$/, "Einzahl, und ohne Nutzlast keine KB-Angabe");

console.log("ecosystem-territory-import: alle Prüfungen bestanden");
