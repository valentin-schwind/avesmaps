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
// Das Transportmittel entscheidet der Planer; der Test stellt es je Fall selbst ein, weil die
// Rastregel seit 2026-08-03 daran hängt und nicht mehr am Wegtyp.
let chosenTransport = { Flussweg: "riverBarge", Seeweg: "cargoShip", Weg: "groupFoot" };
global.getTransportOption = (type) => chosenTransport[type] || "groupFoot";
load("js/routing/route-node.js");
load("js/routing/route-plan.js");
load("js/routing/route-result.js");

assert.strictEqual(TIME_SCALE_FACTOR, 1.19, "ohne den echten Zeitfaktor prüft der Test nichts");
assert.ok(SPEED_TABLE && SPEED_TABLE.riverBarge, "ohne die echte Tempotabelle ebenso");

// ---- 1. die Rastregel -----------------------------------------------------------------------------
// Eine Etappe von 1 Karteneinheit = 3 Meilen der jeweiligen Wegart, mit 12 Reisestunden pro Tag
// (die Voreinstellung des Planers: 12 Reise, 8 Schlaf, 4 Lager).
const stepFor = (type, transport) => {
	if (transport) {
		chosenTransport = Object.assign({}, chosenTransport, { [type]: transport });
	}
	const steps = buildRouteSteps(["A", "B"], [{
		geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
		properties: { feature_subtype: type, public_id: "s1" },
	}], { includeRests: true, restHoursPerDay: 12 });
	assert.strictEqual(steps.length, 1, `eine Etappe erwartet für ${type}`);
	return steps[0];
};
const restsLikeItTravels = (step, what) => {
	assert.ok(step.travel_time > 0, `${what}: die Etappe hat überhaupt eine Reisezeit`);
	assert.ok(
		Math.abs(step.rest_time - step.travel_time) < 1e-12,
		`${what}: bei 12 Reisestunden muss die Rast so lang sein wie die Reise — ist ${step.rest_time}`
	);
};

// 🔴 DAS IST DER TEST. Vor dem 2026-08-02 rastete der Fluss gar nicht.
restsLikeItTravels(stepFor("Flussweg", "riverBarge"), "Flusskahn");
restsLikeItTravels(stepFor("Weg", "groupFoot"), "Gruppe zu Fuß");

// 🔴 UND DAS IST DER ZWEITE. Bis zum 2026-08-03 hing die Ausnahme am WEGTYP, also bekam jedes Schiff
// den 24-Stunden-Tag. S. 131 gibt ihn namentlich nur dem Schnellsegler (250 Meilen) und der
// Kurier-Dromone (200, die wir nicht führen); der Lastensegler steht dort mit 120 bei 12 Stunden,
// die Galeere mit 70 bei 8 — beides Küstenschiffe, die „gewöhnlich nachts vor Anker gehen".
restsLikeItTravels(stepFor("Seeweg", "cargoShip"), "Lastensegler");
restsLikeItTravels(stepFor("Seeweg", "galley"), "Galeere");

const fastSailer = stepFor("Seeweg", "fastShip");
assert.ok(fastSailer.travel_time > 0, "der Schnellsegler hat eine Reisezeit");
assert.strictEqual(fastSailer.rest_time, 0, "nur der Schnellsegler fährt rund um die Uhr");

// Ohne Rast im Planer (24 Reisestunden) rastet auch der Fluss nicht — der Schalter bleibt ein Schalter.
const noRest = buildRouteSteps(["A", "B"], [{
	geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
	properties: { feature_subtype: "Flussweg", public_id: "s1" },
}], { includeRests: false, restHoursPerDay: 0 });
assert.strictEqual(noRest[0].rest_time, 0, "ohne Rastwunsch rastet die Flussetappe nicht");

// ---- 2. die Tagesleistung der Quelle, für JEDES Reisemittel ------------------------------------------
//
// 🔴 DER KERN DER GANZEN TABELLE. Die Quelle nennt nirgends eine Geschwindigkeit, immer nur eine
// Tagesleistung. Jeder Eintrag oben ist also eine Tagesleistung, geteilt durch die Reisestunden und
// mal den versteckten Zeitfaktor. Wer einen Wert „glattzieht", bricht genau diese Zuordnung — und
// sie ist der einzige Grund, warum die Zahlen so krumm sind.
//
// mean_G = 1,032 ist der gemessene mittlere Steigungsfaktor unserer Straßen (die Eichung). Er steht
// NUR bei den Landmitteln, weil er allein unsere eigene Steigungsebene ausgleicht: auf einer Straße
// kennt die Quelle keine Steigung, ihr Straßenfaktor ist glatt 1,0. Wasser trägt gar kein Gelände,
// dort steht die Quellenzahl unverändert.
const MEAN_G = 1.032;
const dayPerformance = (mode, subtype, hours) => (SPEED_TABLE[mode][subtype] / TIME_SCALE_FACTOR) * hours;

// Land: Quellenwert x mean_G, gemessen auf der ebenen Straße (S. 123).
[["groupFoot", 30], ["lightWalker", 40], ["groupHorse", 35], ["lightRider", 50],
	["caravan", 30], ["horseCarriage", 50]].forEach(([mode, sourceDay]) => {
	const actual = dayPerformance(mode, "Strasse", 12);
	assert.ok(
		Math.abs(actual / (sourceDay * MEAN_G) - 1) < 0.01,
		`${mode} muss auf ebener Straße ${(sourceDay * MEAN_G).toFixed(1)} Meilen/Tag leisten `
		+ `(Quelle ${sourceDay} x mean_G) — sind ${actual.toFixed(2)}`
	);
});

// ⚠️ „Reisegruppe zu Pferd" steht in der Quelle doppelt: 35 in der Tabelle S. 123, „kaum mehr als
// 40" im Fließtext S. 118. Hier gilt die Tabelle. Wird das je auf 40 geändert, ist das UNSERE
// Entscheidung und gehört kommentiert — nicht stillschweigend in die Zahl.
assert.ok(
	Math.abs(dayPerformance("groupHorse", "Strasse", 12) / (35 * MEAN_G) - 1) < 0.01,
	"die berittene Gruppe folgt dem Tabellenwert 35, nicht dem Fließtext 40"
);

// Wasser: Quellenzahl unverändert, aber mit den Stunden, die IHRE Zeile nennt (S. 129/131).
[["riverBarge", "Flussweg", 12, 40], ["riverSailer", "Flussweg", 12, 60],
	["cargoShip", "Seeweg", 12, 120], ["galley", "Seeweg", 12, 100],
	// Das einzige Schiff mit einer 24-Stunden-Zeile — und deshalb das einzige ohne Rast.
	["fastShip", "Seeweg", 24, 250]].forEach(([mode, subtype, hours, sourceDay]) => {
	const actual = dayPerformance(mode, subtype, hours);
	assert.ok(
		Math.abs(actual / sourceDay - 1) < 0.01,
		`${mode} muss bei ${hours} h die ${sourceDay} Meilen/Tag der Quelle treffen — sind ${actual.toFixed(2)}`
	);
});

// ⭐ DIE GALEERE IST DER PRÜFSTEIN DER GANZEN KONSTRUKTION. Die Quelle gibt ihr als einzigem Mittel
// DREI Zeilen mit verschiedenen Stundenzahlen (S. 131: 70 bei 8 Ruderstunden, 100 bei 12, 200 bei 24
// mit Wechselschichten) — und sie liegen auf einer Geraden. Trägt unser Eintrag wirklich eine
// Geschwindigkeit und keine verkleidete Tagesleistung, dann trifft er alle drei. Mit dem 8-Stunden-
// Wert (70), der am 2026-08-03 kurz drinstand, stimmte nur die mittlere Zeile.
[[8, 70, 0.05], [12, 100, 0.01], [24, 200, 0.01]].forEach(([hours, sourceDay, tolerance]) => {
	const actual = dayPerformance("galley", "Seeweg", hours);
	assert.ok(
		Math.abs(actual / sourceDay - 1) < tolerance,
		`die Galeere muss bei ${hours} Ruderstunden auf ${sourceDay} Meilen kommen — sind ${actual.toFixed(1)}`
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
