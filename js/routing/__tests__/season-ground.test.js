// Der Bodenabzug der Jahreszeit -- Client gegen Server.
//
// 🔴 Hier ist die Paritaet wichtiger als anderswo. Der Abzug ist eine SUBTRAKTION auf einer Skala,
// die Avesmaps selbst gar nicht fuehrt (die Quellenspalte), und daraus wird ein MULTIPLIKATOR auf
// unsere Tempotabelle. Wer eine der beiden Tabellen nur in einer der zwei Dateien anfasst, bekommt
// zwei Engines, die beide plausibel aussehen und verschiedene Reisezeiten liefern.
//
// Lauf: node js/routing/__tests__/season-ground.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = path.join(__dirname, "..", "..", "..");
const sg = require(path.join(repoRoot, "js/routing/season-ground.js"));
const prozent = (factor) => (1 / factor - 1) * 100;

// ============================================================ 1. die Zahlen aus dem Entwurf §1.1
assert.ok(Math.abs(sg.seasonSpeedFactor("Strasse", "boreal", "winter") - 0.8) < 1e-9, "Strasse 1,0 - 0,2 = 0,8");
assert.ok(Math.abs(prozent(sg.seasonSpeedFactor("Strasse", "boreal", "winter")) - 25) < 1e-9,
	"💣 Strasse im Tiefschnee: +25 % Reisezeit");
assert.ok(Math.abs(prozent(sg.seasonSpeedFactor("Reichsstrasse", "boreal", "winter")) - 22.222222) < 1e-4,
	"💣 Reichsstrasse im Tiefschnee: +22 %");
assert.ok(Math.abs(prozent(sg.seasonSpeedFactor("Gebirgspass", "boreal", "winter")) - 100) < 1e-9,
	"💣 Passstrecke im Tiefschnee: +100 %");

// Die Strassenausnahme gilt nur der Naesse.
assert.strictEqual(sg.seasonSpeedFactor("Strasse", "boreal", "fruehling"), 1.0, "die Strasse bleibt bei Naesse verschont");
assert.ok(sg.seasonSpeedFactor("Weg", "boreal", "fruehling") < 1.0, "der Karrenweg weicht auf");
assert.ok(sg.seasonSpeedFactor("Strasse", "boreal", "winter") < 1.0, "Tiefschnee trifft die Strasse sehr wohl");

// Wasser, Unbekanntes und „ohne Reisebeginn" aendern nichts.
["Flussweg", "Seeweg"].forEach((w) => {
	assert.strictEqual(sg.seasonSpeedFactor(w, "polar", "winter"), 1.0, `${w}: kein Bodenabzug`);
});
Object.keys(sg.SEASON_GROUND_PATH_FACTORS).forEach((wegart) => {
	assert.strictEqual(sg.seasonSpeedFactor(wegart, null, null), 1.0, `${wegart}: ohne Reisebeginn unveraendert`);
	assert.strictEqual(sg.seasonSpeedFactor(wegart, "nichtvorhanden", "winter"), 1.0, `${wegart}: unbekannte Zone erfindet keinen Winter`);
});
assert.strictEqual(sg.seasonSpeedFactor("Gibtsnicht", "boreal", "winter"), 1.0, "unbekannte Wegart wird in Ruhe gelassen");
assert.strictEqual(sg.seasonGroundReport("Strasse", "boreal", "sommer"), null, "kein Vermerk, wo nichts geschieht");

// ============================================================ 2. die Tabellen GELESEN, nicht abgetippt
const phpSource = fs.readFileSync(path.join(repoRoot, "api/_internal/routing/season-ground.php"), "utf8");

const phpPathFactors = (() => {
	const match = phpSource.match(/const AVESMAPS_SEASON_GROUND_PATH_FACTORS = \[([\s\S]*?)\];/);
	assert.ok(match, "AVESMAPS_SEASON_GROUND_PATH_FACTORS gefunden");
	const table = {};
	match[1].replace(/'([A-Za-z]+)'\s*=>\s*([0-9.]+)/g, (_, key, value) => {
		table[key] = Number(value);
		return "";
	});
	return table;
})();
assert.deepStrictEqual(phpPathFactors, sg.SEASON_GROUND_PATH_FACTORS,
	"die Wegart-Faktoren sind die Skala, auf der subtrahiert wird -- sie muessen in beiden Engines gleich sein");

const phpTable = (() => {
	const match = phpSource.match(/const AVESMAPS_SEASON_GROUND_TABLE = \[([\s\S]*?)\n\];/);
	assert.ok(match, "AVESMAPS_SEASON_GROUND_TABLE gefunden");
	const table = {};
	match[1].split("\n").forEach((line) => {
		const zone = line.match(/^\s*'([a-z_]+)'\s*=>\s*\[/);
		if (!zone) {
			return;
		}
		const row = {};
		line.replace(/'(winter|fruehling|sommer|herbst)'\s*=>\s*'([a-z_]*)'/g, (_, season, condition) => {
			row[season] = condition;
			return "";
		});
		table[zone[1]] = row;
	});
	return table;
})();
assert.deepStrictEqual(phpTable, sg.SEASON_GROUND_TABLE,
	"die Zonentabelle muss in beiden Engines dieselbe sein");

const phpConditions = (() => {
	const match = phpSource.match(/const AVESMAPS_SEASON_GROUND_CONDITIONS = \[([\s\S]*?)\n\];/);
	assert.ok(match, "AVESMAPS_SEASON_GROUND_CONDITIONS gefunden");
	const table = {};
	match[1].replace(/'([a-z_]+)'\s*=>\s*\['penalty'\s*=>\s*([0-9.]+),\s*'road_exempt'\s*=>\s*(true|false)\]/g,
		(_, key, penalty, exempt) => {
			table[key] = { penalty: Number(penalty), roadExempt: exempt === "true" };
			return "";
		});
	return table;
})();
assert.deepStrictEqual(phpConditions, sg.SEASON_GROUND_CONDITIONS,
	"Abzuege und Strassenausnahme muessen in beiden Engines gleich sein");

// ============================================================ 3. jede Kombination durch BEIDE Rechner
const WEGARTEN = Object.keys(sg.SEASON_GROUND_PATH_FACTORS).concat(["Flussweg", "Seeweg", "Gibtsnicht"]);
const ZONEN = Object.keys(sg.SEASON_GROUND_TABLE).concat(["nichtvorhanden", ""]);
const JAHRESZEITEN = ["winter", "fruehling", "sommer", "herbst", ""];
const FAELLE = [];
WEGARTEN.forEach((w) => ZONEN.forEach((z) => JAHRESZEITEN.forEach((j) => FAELLE.push([w, z, j]))));

let phpResults = null;
try {
	const libPath = path.join(repoRoot, "api/_internal/routing/season-ground.php").replace(/\\/g, "/");
	const script = `require ${JSON.stringify(libPath)};`
		+ `$out = [];`
		+ `foreach (json_decode(${JSON.stringify(JSON.stringify(FAELLE))}, true) as $c) {`
		+ `  $out[] = round(avesmapsSeasonSpeedFactor($c[0], $c[1], $c[2]), 12);`
		+ `}`
		+ `echo json_encode($out);`;
	phpResults = JSON.parse(execFileSync("php", ["-r", script], { encoding: "utf8" }));
} catch (error) {
	console.log(`  (Paritaetslauf uebersprungen -- php nicht erreichbar: ${String(error.message).split("\n")[0]})`);
}

if (phpResults) {
	assert.strictEqual(phpResults.length, FAELLE.length, "der PHP-Lauf hat jede Kombination gerechnet");
	let abweichungen = 0;
	FAELLE.forEach((fall, index) => {
		// Auf zwoelf Stellen gerundet verglichen, weil PHP und JS ihre Gleitkommareste verschieden
		// abschneiden. Bewusst nicht ueber toFixed: das ist im Haus der Anzeigeweg (formatDecimalNumber).
		const js = Math.round(sg.seasonSpeedFactor(fall[0], fall[1], fall[2]) * 1e12) / 1e12;
		if (Math.abs(js - phpResults[index]) > 1e-12) {
			abweichungen++;
			console.error(`  ABWEICHUNG ${fall.join(" / ")}: js=${js} php=${phpResults[index]}`);
		}
	});
	assert.strictEqual(abweichungen, 0, "Server und Client liefern denselben Faktor");
	console.log(`  (Paritaet gegen PHP geprueft: ${FAELLE.length} Kombinationen, alle gleich)`);
}

console.log("season-ground.test.js: all assertions passed");
