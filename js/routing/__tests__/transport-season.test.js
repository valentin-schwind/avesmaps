// Wann darf welches Reisemittel ueber diesen Weg -- Client gegen Server.
//
// 🔴 Hier zaehlt die Paritaet besonders, weil ein Auseinanderlaufen NICHT auffaellt: der Server
// faende eine Route ueber den gesperrten Pass, der Client eine andere, und beide Reiseplaene saehen
// fuer sich plausibel aus. Der Lauf unten schickt jede Kombination aus Fenster, Reisemittel und
// Jahrestag durch beide Rechner.
//
// Lauf: node js/routing/__tests__/transport-season.test.js

const assert = require("assert");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = path.join(__dirname, "..", "..", "..");
const ts = require(path.join(repoRoot, "js/routing/transport-season.js"));
const cal = require(path.join(repoRoot, "js/routing/travel-calendar.js"));
const tag = (month, day) => cal.travelCalendarDayOfYear(month, day);

const LAND = ["groupFoot", "lightWalker", "groupHorse", "lightRider", "caravan", "horseCarriage"];
const ROTERZ = { groupFoot: { from_month: "peraine", from_day: 1, to_month: "boron", to_day: 30 } };

// ============================================================ 1. die drei Zustaende
const fenster = ts.seasonWindowsFromProperties(ROTERZ);
assert.strictEqual(ts.transportOpenOn(LAND, fenster, "groupFoot", null), true, "ohne Reisebeginn wird nicht gefragt");
assert.strictEqual(ts.transportOpenOn(LAND, {}, "groupFoot", tag("firun", 25)), true, "ohne Fenster ganzjaehrig");
const ohneKutsche = LAND.filter((m) => m !== "horseCarriage");
assert.strictEqual(ts.transportOpenOn(ohneKutsche, {}, "horseCarriage", null), false, "nicht angehakt = nie");

// Fenster ueber den Jahreswechsel (Peraine -> Boron)
assert.ok(ts.transportOpenOn(LAND, fenster, "groupFoot", tag("praios", 1)), "ueber den Jahreswechsel offen");
assert.ok(!ts.transportOpenOn(LAND, fenster, "groupFoot", tag("firun", 25)), "💣 im Firun zu");
assert.ok(ts.transportOpenOn(LAND, fenster, "groupFoot", 363), "die Namenlosen Tage liegen im offenen Fenster");

// Fenster innerhalb des Jahres (Schattenpass)
const sommer = ts.seasonWindowsFromProperties({
	groupFoot: { from_month: "praios", from_day: 1, to_month: "efferd", to_day: 30 },
});
assert.ok(!ts.transportOpenOn(LAND, sommer, "groupFoot", 363), "💣 hier sind die Namenlosen Tage gesperrt");
assert.ok(ts.transportOpenOn(LAND, sommer, "groupFoot", tag("rondra", 15)), "im Rondra offen");

// Kaputtes erfindet keine Sperre -- die gefaehrlichere Richtung.
[{ from_month: "nichtvorhanden" }, { from_month: "peraine" }, "text", null].forEach((kaputt) => {
	const geprueft = ts.seasonWindowsFromProperties({ groupFoot: kaputt });
	assert.deepStrictEqual(geprueft, {}, "unbrauchbares Fenster wird verworfen");
	assert.ok(ts.transportOpenOn(LAND, geprueft, "groupFoot", tag("firun", 25)), "und der Weg bleibt offen");
});

// Der Vermerk fuer den Plan
const sperre = ts.seasonClosureFor(LAND, fenster, "groupFoot", tag("firun", 25));
assert.strictEqual(sperre.open_from.month, "peraine", "der Vermerk weiss, ab wann wieder");
assert.strictEqual(ts.seasonClosureFor(LAND, fenster, "groupFoot", tag("praios", 1)), null, "sonst kein Vermerk");

// ============================================================ 2. beide Rechner, dieselben Faelle
const FENSTER = [
	{ from_month: "peraine", from_day: 1, to_month: "boron", to_day: 30 },
	{ from_month: "praios", from_day: 1, to_month: "efferd", to_day: 30 },
	{ from_month: "ingerimm", from_day: 1, to_month: "rondra", to_day: 30 },
	{ from_month: "peraine", from_day: 15, to_month: "efferd", to_day: 30 },
	{ from_month: "firun", from_day: 10, to_month: "firun", to_day: 10 },
	{ from_month: "hesinde", from_day: 15, to_month: "phex", to_day: 15 },
];
const TAGE = [1, 45, 90, 91, 150, 151, 200, 271, 270, 360, 361, 363, 365];
const FAELLE = [];
FENSTER.forEach((w, wi) => TAGE.forEach((d) => {
	FAELLE.push([wi, "groupFoot", d]);
	FAELLE.push([wi, "horseCarriage", d]);
}));

let phpResults = null;
try {
	const libPath = path.join(repoRoot, "api/_internal/routing/transport-season.php").replace(/\\/g, "/");
	const script = `require ${JSON.stringify(libPath)};`
		+ `$fenster = json_decode(${JSON.stringify(JSON.stringify(FENSTER))}, true);`
		+ `$land = json_decode(${JSON.stringify(JSON.stringify(LAND))}, true);`
		+ `$out = [];`
		+ `foreach (json_decode(${JSON.stringify(JSON.stringify(FAELLE))}, true) as $c) {`
		+ `  $w = avesmapsSeasonWindowsFromProperties([$c[1] => $fenster[$c[0]]]);`
		+ `  $out[] = avesmapsTransportOpenOn($land, $w, $c[1], (int) $c[2]) ? 1 : 0;`
		+ `}`
		+ `echo json_encode($out);`;
	phpResults = JSON.parse(execFileSync("php", ["-r", script], { encoding: "utf8" }));
} catch (error) {
	console.log(`  (Paritaetslauf uebersprungen -- php nicht erreichbar: ${String(error.message).split("\n")[0]})`);
}

if (phpResults) {
	assert.strictEqual(phpResults.length, FAELLE.length, "der PHP-Lauf hat jeden Fall gerechnet");
	let offen = 0;
	FAELLE.forEach((fall, index) => {
		const windows = ts.seasonWindowsFromProperties({ [fall[1]]: FENSTER[fall[0]] });
		const js = ts.transportOpenOn(LAND, windows, fall[1], fall[2]) ? 1 : 0;
		assert.strictEqual(js, phpResults[index],
			`Server und Client weichen ab: Fenster ${fall[0]}, ${fall[1]}, Tag ${fall[2]}`);
		offen += js;
	});
	// 🪤 Ein Test, in dem jeder Fall „offen" ergibt, prueft nichts -- beide Seiten koennten stumpf
	// true liefern. Die Faelle sind so gewaehlt, dass beide Antworten reichlich vorkommen.
	assert.ok(offen > FAELLE.length * 0.2 && offen < FAELLE.length * 0.8,
		`die Faelle decken beide Antworten ab (offen: ${offen} von ${FAELLE.length})`);
	console.log(`  (Paritaet gegen PHP geprueft: ${FAELLE.length} Faelle, davon ${offen} offen)`);
}

console.log("transport-season.test.js: all assertions passed");
