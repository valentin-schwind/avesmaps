// Die Querfeldein-Spanne im Transportmittel-Fenster.
//
// 🔴 DER SATZ WAR ZWEIMAL HINTEREINANDER STILL FALSCH, und beide Male stand die richtige Zahl
// dieselbe Datei weiter oben in der Matrix. „Das ist zäh (1,25–2,5 Meilen/h)" war ein Literal:
// es überlebte die Quellenangleichung (d9d7ab39, danach 0,96–1,6) und stand am 14.08.2026 immer
// noch da, als die Tempowerte-Migration (2ae79c2d) die Spalte `Querfeldein` auf ihren Quellenwert
// 0,75 der Straße zog — echte Spanne seither 2,3–3,84. Kein Test wurde rot, weil kein Test die
// SÄTZE gegen die Tabelle hielt (dieselbe Lücke wie bei terrain-text-claims-test.php, nur für
// eine andere Zeile).
//
// Dieser Test prüft nicht „steht dort 2,3–3,84", sondern „steht dort, was in SPEED_TABLE steht" —
// eine spätere Kalibrierung im Fenster „Tempowerte" darf ihn also nicht rot machen, ein
// zurückgetipptes Literal schon.
//
// Aus der Wurzel des Repos:  node js/routing/__tests__/cross-country-range.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.join(__dirname, "..", "..", "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");
const load = (relative) => {
	const absolute = path.join(repoRoot, relative);
	vm.runInThisContext(fs.readFileSync(absolute, "utf8"), { filename: absolute });
};

// 🪤 KEINE ERFUNDENE TEMPOTABELLE — der Sinn des Tests sind die ECHTEN Zahlen. js/config.js lässt
// sich nicht einzeln laden (es liest AVESMAPS_CATMULL_DEFAULTS aus einer Datei, die index.html
// davor einhängt), also wird das Objektliteral gelesen und als Ausdruck ausgewertet. Gleicher
// Griff wie in speed-table-and-rest-rule.test.js.
const configSource = read("js/config.js");
const speedTableMatch = configSource.match(/const SPEED_TABLE = (\{[\s\S]*?\n\});/);
assert.ok(speedTableMatch, "SPEED_TABLE in js/config.js gefunden");
global.SPEED_TABLE = vm.runInNewContext(`(${speedTableMatch[1]})`);
assert.ok(SPEED_TABLE.groupFoot && SPEED_TABLE.groupFoot.Querfeldein > 0, "die echte Tempotabelle wurde gelesen");

// Die sechs Landmittel — dieselbe Liste, die der Dialog als LAND_MODES führt und in seiner Matrix
// zeigt. ⚠️ Die Kutsche ist dabei: sie fährt nie querfeldein, steht aber mit ihrer Zelle in der
// Matrix, und Spanne und Spalte sollen dasselbe sagen.
const LAND_MODES = ["caravan", "groupFoot", "lightWalker", "horseCarriage", "groupHorse", "lightRider"];
const column = LAND_MODES.map((mode) => SPEED_TABLE[mode].Querfeldein);
column.forEach((v, i) => assert.ok(typeof v === "number" && isFinite(v), `${LAND_MODES[i]} hat eine Querfeldein-Zelle`));
const expectedMin = Math.min.apply(null, column);
const expectedMax = Math.max.apply(null, column);

// ---- die Kulisse ---------------------------------------------------------------------------------
// Der Dialog braucht vom DOM nur so viel, wie `open()` anfasst. Was er in seine Hülle schreibt,
// wird bei `body.appendChild` abgegriffen — mehr Browser braucht ein Satz nicht.
let rendered = "";
const makeElement = () => ({
	className: "",
	innerHTML: "",
	hidden: true,
	addEventListener() {},
	querySelector: () => null,
	appendChild() {},
});
global.document = {
	readyState: "complete",
	activeElement: null,
	createElement: makeElement,
	getElementById: () => null,
	querySelectorAll: () => [],
	addEventListener() {},
	removeEventListener() {},
	documentElement: { classList: { add() {}, remove() {}, contains: () => false }, lang: "de" },
	body: { appendChild: (node) => { rendered = node.innerHTML; } },
};
global.window = {
	location: { search: "" },
	localStorage: { getItem: () => null, setItem() {} },
	addEventListener() {},
};
global.localStorage = global.window.localStorage;
// Die Icons sind Kulisse, nicht Gegenstand der Prüfung.
global.TRANSPORT_ICON_PATHS = {};
global.ROUTE_ICON_PATHS = {};

load("js/app/i18n-en.js");

/** Lädt i18n + Dialog für eine Sprache neu und gibt das gerenderte Fenster zurück. */
function renderIn(lang) {
	global.window.location.search = lang === "en" ? "?lang=en" : "";
	// Beide Dateien sind IIFEs ohne Zustand über den Lauf hinaus, lassen sich also erneut laden.
	// Nötig ist das, weil i18n.js die Sprache EINMAL beim Laden bestimmt und der Dialog seine
	// Hülle nach dem ersten Öffnen behält.
	load("js/app/i18n.js");
	global.tr = global.window.tr;
	assert.strictEqual(global.window.avesmapsActiveLang, lang, `i18n steht auf ${lang}`);
	rendered = "";
	load("js/routing/transport-speed-info.js");
	global.window.avesmapsOpenTransportSpeedInfo();
	assert.ok(rendered.includes("tsi-dialog"), `das Fenster wurde in ${lang} gebaut`);
	return rendered;
}

// ---- 1. Deutsch ------------------------------------------------------------------------------------
const de = renderIn("de");
const deRange = ` (${expectedMin.toLocaleString("de-DE")}–${expectedMax.toLocaleString("de-DE")}&nbsp;Meilen/h)`;
assert.ok(
	de.includes(`Das ist zäh${deRange}, darum`),
	`der Querfeldein-Satz muss die Spanne der Spalte tragen — erwartet „Das ist zäh${deRange}, darum", `
	+ `gerendert wurde: ${(de.match(/Das ist zäh.*?darum/) || ["<der Satz fehlt ganz>"])[0]}`
);

// ---- 2. Englisch ------------------------------------------------------------------------------------
// 💣 Die englische Fassung ist eine ZWEITE QUELLE und trug denselben Fehler mit (so steht es auch in
// docs/steigungsmodell-pruefung-instruction.md). Sie wird darum genauso geprüft — mit englischer
// Zahlschreibweise, denn „2,3 miles/h" ist im englischen Satz falsch gesetzt.
const en = renderIn("en");
const enRange = ` (${expectedMin.toLocaleString("en-US")}–${expectedMax.toLocaleString("en-US")}&nbsp;miles/h)`;
assert.ok(
	en.includes(`This is slow${enRange}, so the calculation`),
	`die englische Fassung muss dieselbe Spanne tragen — erwartet „This is slow${enRange}, so the calculation", `
	+ `gerendert wurde: ${(en.match(/This is slow.*?so the calculation/) || ["<der Satz fehlt ganz>"])[0]}`
);

// ---- 3. der Rückweg zum Literal bleibt zu ------------------------------------------------------------
// 🔴 DAS IST DER EIGENTLICHE ZAHN. Die beiden Prüfungen oben wären auch grün, wenn jemand die
// aktuellen Zahlen von Hand einträgt — bis zur nächsten Kalibrierung. Der Platzhalter ist es, der
// den Satz an die Tabelle bindet; ohne ihn beginnt das Veralten von vorn.
[
	["js/routing/transport-speed-info.js", "Das ist zäh{range}, darum"],
	["js/app/i18n-en.js", "This is slow{range}, so the calculation"],
].forEach(([file, needle]) => {
	assert.ok(
		read(file).includes(needle),
		`${file}: der Querfeldein-Satz muss „{range}" aus crossCountryRangeClause() beziehen statt eine `
		+ `Spanne zu tippen — genau so ist „1,25–2,5 Meilen/h" zweimal veraltet.`
	);
});

// Und die tote Spanne kommt nicht zurück.
[["js/routing/transport-speed-info.js", "1,25–2,5"], ["js/app/i18n-en.js", "1.25–2.5"]].forEach(([file, dead]) => {
	assert.ok(!read(file).includes(dead), `${file}: die veraltete Spanne „${dead}" steht wieder im Text`);
});

console.log("cross-country-range.test.js: all assertions passed");
