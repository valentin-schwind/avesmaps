// Die Rastregel und die drei Tempotabellen.
//
// 🔴 ZWEI LÜCKEN AUF EINMAL, beide am 2026-08-02 aufgefallen.
//
// (1) DIE RASTREGEL HATTE KEINEN VERHALTENSTEST. Flusswege standen zusammen mit Seewegen in der
//     Kein-Rast-Liste und fuhren damit 24 Stunden am Tag — das 2,52-fache der Tagesleistung der
//     Quelle (Geographia Aventurica S. 129: Reisetag 12 Stunden, nachts fahren nur Piraten und
//     Kuriere). Die Grundgeschwindigkeiten waren die ganze Zeit richtig; falsch war der Tag, mit
//     dem sie multipliziert wurden. Rückfällt das je, muss es hier rot werden und nicht im Spiel.
//
// (2) DIE DREI TEMPOTABELLEN WAREN DURCH NICHTS ANEINANDER GEBUNDEN. `SPEED_TABLE` (js/config.js),
//     `AVESMAPS_ROUTE_CLIENT_SPEED_TABLE` (api/_internal/routing/client-graph.php) und `WP_SPEEDS`
//     (js/pages/wege-editor-model.js) sind dieselbe Regel in drei Sprachen. Bis hierher prüfte
//     wege-editor-model.test.js nur, DASS jede Zelle eine positive Zahl ist — nicht, dass es
//     dieselbe Zahl ist. Eine Änderung in zwei von drei Dateien wäre lautlos durchgegangen, und
//     genau das ist der Weg, auf dem Server und Anzeige auseinanderlaufen.
//
// Aus der Wurzel des Repos:  node js/routing/__tests__/speed-table-and-rest-rule.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = { location: { search: "" }, addEventListener() {}, setTimeout: () => 0, clearTimeout() {} };
// config.js stempelt beim Laden Klassen auf <html> (Infopanel-/Edit-Modus) — der Stub muss eine
// classList mitbringen, sonst stirbt der Test an der Kulisse statt an der Regel.
global.document = {
	getElementById: () => null,
	querySelectorAll: () => [],
	addEventListener() {},
	documentElement: { classList: { add() {}, remove() {}, contains: () => false } },
};
global.localStorage = { getItem: () => null, setItem() {} };
global.normalizePathSubtype = (value) => String(value || "Weg");
global.normalizeNodeName = (value) => String(value || "").replace(/-\d+$/, "");
global.selectedLocations = [];
global.normalizeLocationSearchName = (value) => String(value || "");
global.locationData = [];
global.findPathByPublicId = () => null;
// 1 Karteneinheit = 3 Meilen (DISTANCE_SCALING_FACTOR), wie calculateScaledDistance in utils.js.
global.calculateScaledDistance = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) * 3;

const repoRoot = path.join(__dirname, "..", "..", "..");
const load = (relative) => {
	const absolute = path.join(repoRoot, relative);
	vm.runInThisContext(fs.readFileSync(absolute, "utf8"), { filename: absolute });
};
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

// 🪤 KEINE ERFUNDENE TEMPOTABELLE. Der Sinn dieses Tests sind die ECHTEN Zahlen — ein
// `global.SPEED_TABLE = { ... }` würde genau das ersetzen, was geprüft werden soll.
// 💣 `js/config.js` lässt sich aber nicht einzeln laden: es liest `AVESMAPS_CATMULL_DEFAULTS` aus
// map-features-line-catmull.js, das index.html ausdrücklich davor einhängt. Die halbe
// Bootstrap-Kette nachzubauen, um an eine Konstante zu kommen, wäre der teurere Fehler — also wird
// die Tabelle aus der Datei GELESEN. Sie ist ein Objektliteral; es wird als Ausdruck ausgewertet,
// nicht Zelle für Zelle über einen Ausdruck geraten.
const configSource = read("js/config.js");
const literal = (name) => {
	const match = configSource.match(new RegExp(`const ${name} = (\\{[\\s\\S]*?\\n\\}|[0-9.]+);`));
	assert.ok(match, `${name} in js/config.js gefunden`);
	return vm.runInNewContext(`(${match[1]})`);
};
global.SPEED_TABLE = literal("SPEED_TABLE");
global.TIME_SCALE_FACTOR = literal("TIME_SCALE_FACTOR");
global.KM_TO_MILES = literal("KM_TO_MILES");
// Reine Kulisse, nicht Gegenstand der Prüfung: der Name der synthetischen Wegart.
global.SYNTHETIC_ROUTE_TYPE = "Querfeldein";

load("js/app/i18n.js");
global.tr = global.window.tr;
// Das Transportmittel entscheidet der Planer; hier wird je Wegart das passende festgelegt, damit
// `buildRoutePlanEntries` die Zeile trifft, um die es geht.
const TRANSPORT_BY_TYPE = { Flussweg: "riverBarge", Seeweg: "cargoShip", Weg: "groupFoot" };
global.getTransportOption = (type) => TRANSPORT_BY_TYPE[type] || "groupFoot";
load("js/routing/route-node.js");
load("js/routing/route-plan.js");
load("js/routing/route-result.js");

assert.strictEqual(TIME_SCALE_FACTOR, 1.19, "ohne den echten Zeitfaktor prüft der Test nichts");
assert.ok(SPEED_TABLE && SPEED_TABLE.riverBarge, "ohne die echte Tempotabelle ebenso");

// ---- 1. die Rastregel -----------------------------------------------------------------------------
// Eine Etappe von 1 Karteneinheit = 3 Meilen der jeweiligen Wegart, mit 12 Reisestunden pro Tag
// (die Voreinstellung des Planers: 12 Reise, 8 Schlaf, 4 Lager).
const stepFor = (type) => {
	const steps = buildRouteSteps(["A", "B"], [{
		geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
		properties: { feature_subtype: type, public_id: "s1" },
	}], { includeRests: true, restHoursPerDay: 12 });
	assert.strictEqual(steps.length, 1, `eine Etappe erwartet für ${type}`);
	return steps[0];
};

const river = stepFor("Flussweg");
assert.ok(river.travel_time > 0, "die Flussetappe hat überhaupt eine Reisezeit");
// 🔴 DAS IST DER TEST. Vor der Reparatur war rest_time hier 0 und der Fluss fuhr rund um die Uhr.
assert.ok(
	Math.abs(river.rest_time - river.travel_time) < 1e-12,
	"bei 12 Reisestunden rastet die Flussetappe genauso lange, wie sie reist — sie tat es bis 2026-08-02 gar nicht"
);

const sea = stepFor("Seeweg");
assert.ok(sea.travel_time > 0, "die Seeetappe hat eine Reisezeit");
// ⚠️ Und die See bleibt ausgenommen: S. 131 belegt die 24-Stunden-Fahrt (Schnellsegler 250 Meilen,
// Kurier-Dromone 200), pro Stunde sind wir dort ohnehin langsamer als die Quelle.
assert.strictEqual(sea.rest_time, 0, "auf offener See fällt weiterhin keine Rast an");

const land = stepFor("Weg");
assert.ok(
	Math.abs(land.rest_time - land.travel_time) < 1e-12,
	"an Land ist die Rast unverändert"
);

// Ohne Rast im Planer (24 Reisestunden) rastet auch der Fluss nicht — der Schalter bleibt ein Schalter.
const noRest = buildRouteSteps(["A", "B"], [{
	geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
	properties: { feature_subtype: "Flussweg", public_id: "s1" },
}], { includeRests: false, restHoursPerDay: 0 });
assert.strictEqual(noRest[0].rest_time, 0, "ohne Rastwunsch rastet die Flussetappe nicht");

// ---- 2. die Tagesleistung der Quelle ----------------------------------------------------------------
// S. 129: Flusskahn stromab 40 Meilen/Tag, Flusssegler 60 — bei dem 12-Stunden-Reisetag, den
// dieselbe Seite ausdrücklich als Rechengröße nennt.
const milesPerDay = (mode) => (SPEED_TABLE[mode].Flussweg / TIME_SCALE_FACTOR) * 12;
[["riverBarge", 40], ["riverSailer", 60]].forEach(([mode, expected]) => {
	assert.ok(
		Math.abs(milesPerDay(mode) / expected - 1) < 0.01,
		`${mode} stromab muss die ${expected} Meilen/Tag der Quelle treffen — sind ${milesPerDay(mode).toFixed(2)}`
	);
});

// S. 123, Fußnote zur Kutsche: „auf Karrenwegen und Pässen nur halbe Geschwindigkeit". Gemessen
// RELATIV zur Straße, damit die Prüfung eine spätere Umskalierung der ganzen Tabelle überlebt und
// trotzdem anschlägt, wenn jemand die Halbierung zurücknimmt.
const carriage = SPEED_TABLE.horseCarriage;
[["Weg", 0.8 * 0.5], ["Gebirgspass", 0.4 * 0.5]].forEach(([subtype, expected]) => {
	const ratio = carriage[subtype] / carriage.Strasse;
	assert.ok(
		Math.abs(ratio - expected) < 0.03,
		`die Kutsche fährt ${subtype} zur halben Wegtyp-Geschwindigkeit (${expected} der Straße) — ist ${ratio.toFixed(3)}`
	);
});

// ---- 3. die drei Spiegel tragen dieselben Zahlen ------------------------------------------------------
// Der PHP-Spiegel wird als Text gelesen: seine Zeilen sind gleichförmig genug für einen Ausdruck,
// und ein Test, der dafür PHP starten müsste, liefe in dieser Datei nicht.
const parsePhpSpeedTable = (source) => {
	const block = source.match(/const AVESMAPS_ROUTE_CLIENT_SPEED_TABLE = \[([\s\S]*?)\n\];/);
	assert.ok(block, "AVESMAPS_ROUTE_CLIENT_SPEED_TABLE in client-graph.php gefunden");
	const table = {};
	block[1].split("\n").forEach((line) => {
		const row = line.match(/'(\w+)'\s*=>\s*\[(.*)\],/);
		if (!row) {
			return;
		}
		table[row[1]] = {};
		row[2].split(",").forEach((cell) => {
			const pair = cell.match(/'(\w+)'\s*=>\s*([0-9.]+)/);
			if (pair) {
				table[row[1]][pair[1]] = Number(pair[2]);
			}
		});
	});
	return table;
};

const phpTable = parsePhpSpeedTable(read("api/_internal/routing/client-graph.php"));
assert.ok(Object.keys(phpTable).length >= 10, "der PHP-Spiegel wurde wirklich gelesen, nicht leer geparst");
assert.deepStrictEqual(
	phpTable,
	JSON.parse(JSON.stringify(SPEED_TABLE)),
	"js/config.js SPEED_TABLE und AVESMAPS_ROUTE_CLIENT_SPEED_TABLE müssen Zelle für Zelle gleich sein"
);

// Der Wege-Editor spiegelt nur die Landzeilen (kein Wasser) und trägt zusätzlich ein `label`.
const editorModel = require(path.join(repoRoot, "js/pages/wege-editor-model.js"));
const editorSpeeds = editorModel.WP_SPEEDS;
assert.ok(editorSpeeds && Object.keys(editorSpeeds).length >= 6, "WP_SPEEDS wurde geladen");
Object.keys(editorSpeeds).forEach((mode) => {
	Object.keys(editorSpeeds[mode]).forEach((subtype) => {
		if (subtype === "label") {
			return;
		}
		assert.strictEqual(
			editorSpeeds[mode][subtype],
			SPEED_TABLE[mode][subtype],
			`WP_SPEEDS.${mode}.${subtype} weicht von SPEED_TABLE ab — der Wege-Editor zeigte dann eine andere Kurve, als das Routing fährt`
		);
	});
});

console.log("speed-table-and-rest-rule.test.js: all assertions passed");
