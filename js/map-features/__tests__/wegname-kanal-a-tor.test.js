"use strict";
// „Wegname anzeigen" wirkt auch in Kanal A -- der Beschriftung der Wiki-Wege als Ganzes.
// 🔴 Owner 15.09.2026: „mit "Wegname anzeigen" (chechbox) die kontrolle haben, ob der name auf der karte angezeigt werden soll".
// Bis dahin fragte isWayLabelEligible das Haekchen nie; jeder Wiki-Weg stand beschriftet da. Entscheid „Bestand bleibt": vor diesem Tor
// hakte der Bestandslauf `wegname_anzeigen_bestand` einmal alle Wiki-Abschnitte an (15.09.2026, danach zurueckgebaut).
// 🔴 GEMISCHTE HAEKCHEN: JE ABSCHNITT. Beschriftet werden die angehakten; ein abgehakter Abschnitt ist Lueckenfueller, damit die
// Kettenbildung ihn nicht ueberbrueckt und den Namen doch darueber malt. „Beschriftet, wenn irgendeiner angehakt" wurde verworfen: das
// Abhaken im Abschnittsdialog saehe wie ein Klick aus, der nichts tut.
// AUSGEFUEHRT: isWayLabelEligible, buildWayLabelGapFillerIndex, buildWayLabelChains (map-features-way-labels.js) und der echte
// shouldPathNameBeDisplayed (map-features-path-labels.js), aus dem Quelltext geschnitten.
// Aus der Wurzel: node js/map-features/__tests__/wegname-kanal-a-tor.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
function schneide(roh, name) {
	// Mit vorangestelltem Zeilenumbruch: shouldPathNameBeDisplayed steht in der ERSTEN Zeile von map-features-path-labels.js.
	const quelle = "\n" + roh;
	const start = quelle.indexOf("\nfunction " + name + "(");
	assert.ok(start !== -1, "Funktion " + name + " nicht gefunden");
	let tiefe = 0;
	for (let i = quelle.indexOf("{", start); i < quelle.length; i += 1) {
		if (quelle[i] === "{") { tiefe += 1; }
		else if (quelle[i] === "}" && --tiefe === 0) { return quelle.slice(start, i + 1); }
	}
	throw new Error("unausgeglichene Klammern in " + name);
}
function konstante(quelle, name) {
	const start = quelle.indexOf("const " + name + " = ");
	assert.ok(start !== -1, "Konstante " + name + " nicht gefunden");
	return quelle.slice(start, quelle.indexOf(";", start) + 1);
}

const WEG = lies("js/map-features/map-features-way-labels.js");
const LABELS = lies("js/map-features/map-features-path-labels.js");
const S = new Function([
	"const normalizePathSubtype = (wert) => String(wert || 'Weg');",
	"const pathLabelMinZoom = () => 4;",
	konstante(WEG, "WAY_LABEL_CHAIN_GAP_EPS"),
	konstante(WEG, "WAY_LABEL_FILLER_TOUCH_EPS"),
	schneide(WEG, "wayLabelEndpointKey"),
	schneide(WEG, "wayLabelArmDirection"),
	schneide(WEG, "buildWayLabelChains"),
	schneide(WEG, "buildWayLabelGapFillerIndex"),
	schneide(LABELS, "shouldPathNameBeDisplayed"),
	schneide(WEG, "isWayLabelEligible"),
	"return { isWayLabelEligible, buildWayLabelGapFillerIndex, buildWayLabelChains, shouldPathNameBeDisplayed };",
].join("\n"))();

const CTX = { powerlines: false, pathsToggle: true, riverLabels: true, zoom: 5 };
const RS2 = { wiki_key: "reichsstrasse-2", name: "Reichsstraße 2" };
const abschnitt = (id, von, bis, extra) => ({
	id,
	properties: Object.assign({ public_id: id, feature_subtype: "Reichsstrasse", display_name: "Reichsstraße 2" }, extra),
	geometry: { type: "LineString", coordinates: [von, bis] },
});

// ---- 1. Das Tor ------------------------------------------------------------------------------------------------------------
assert.strictEqual(S.isWayLabelEligible(abschnitt("a", [0, 0], [1, 0], { wiki_path: RS2, show_label: true }), CTX), true, "angehakt: beschriftet");
assert.strictEqual(S.isWayLabelEligible(abschnitt("b", [0, 0], [1, 0], { wiki_path: RS2, show_label: false }), CTX), false,
	"abgehakt: Kanal A beschriftet wieder, obwohl der Editor „Wegname anzeigen“ abgehakt hat");
assert.strictEqual(S.isWayLabelEligible(abschnitt("c", [0, 0], [1, 0], { wiki_path: RS2 }), CTX), false,
	"ohne Haekchen: unbeschriftet -- deshalb lief der Bestandslauf VOR diesem Tor, und Zuweisen haekt neu zugewiesene Abschnitte an");
assert.strictEqual(S.isWayLabelEligible(abschnitt("d", [0, 0], [1, 0], { wiki_path: RS2, show_label: 1 }), CTX), true, "ein altes 1 gilt als an");
assert.strictEqual(S.isWayLabelEligible(abschnitt("e", [0, 0], [1, 0], { show_label: true }), CTX), false, "ohne Artikel ist es Kanal B");
assert.strictEqual(S.isWayLabelEligible(abschnitt("f", [0, 0], [1, 0], { wiki_path: RS2, show_label: true }), Object.assign({}, CTX, { zoom: 3 })), false,
	"die Zoomschwelle gilt weiter");

// ---- 2. Die gemischte Strasse: A angehakt, B abgehakt, C angehakt -- B liegt kurz genug fuer eine Bruecke -----------------------
const A = abschnitt("A", [0, 0], [10, 0], { wiki_path: RS2, show_label: true });
const B = abschnitt("B", [10, 0], [13, 0], { wiki_path: RS2, show_label: false });
const C = abschnitt("C", [13, 0], [23, 0], { wiki_path: RS2, show_label: true });
const alle = [A, B, C];
const beschriftet = alle.filter((p) => S.isWayLabelEligible(p, CTX)).map((p) => ({ id: p.properties.public_id, coordinates: p.geometry.coordinates }));
assert.deepStrictEqual(beschriftet.map((s) => s.id), ["A", "C"], "genau die angehakten Abschnitte machen mit");
const anzeigename = (p) => String(p.properties.display_name || "");
// Voraussetzung: ohne Fueller ueberbrueckt Phase 2 die 3 Einheiten zwischen A und C -- der Name stuende ueber B.
assert.strictEqual(S.buildWayLabelChains(beschriftet, undefined, []).length, 1, "Voraussetzung: ohne Fueller wird B ueberbrueckt");
// Die Vorgabe des Index (nur Segmente ohne Wiki-Zuweisung) kennt B nicht -- das ist der alte Zustand.
assert.strictEqual((S.buildWayLabelGapFillerIndex(alle, anzeigename).get("Reichsstraße 2") || []).length, 0,
	"die Vorgabe des Index hat sich geaendert -- sie gilt Segmenten OHNE Wiki-Zuweisung");
// Mit dem Praedikat des Zeichners ist B Fueller, A und C nicht.
const istFueller = (p) => !p.properties?.wiki_path?.wiki_key || !S.shouldPathNameBeDisplayed(p);
const fueller = S.buildWayLabelGapFillerIndex(alle, anzeigename, istFueller).get("Reichsstraße 2") || [];
assert.deepStrictEqual(fueller.map((f) => f.id), ["B"], "der abgehakte Wiki-Abschnitt ist kein Fueller -- oder ein angehakter ist einer");
assert.strictEqual(S.buildWayLabelChains(beschriftet, undefined, fueller).length, 2,
	"der Name wird ueber den abgehakten Abschnitt hinweg gemalt -- die Kette ueberbrueckt ihn");

// ---- 3. Die Verdrahtung im Zeichner -------------------------------------------------------------------------------------------
const ohneKommentare = lies("js/map-features/map-features-path-label-canvas-overlay.js")
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.split("\n").map((zeile) => zeile.replace(/(^|\s)\/\/.*$/, "$1")).join("\n");
assert.ok(ohneKommentare.includes("buildWayLabelGapFillerIndex(pathData, getPathDisplayName, (p) => !p.properties?.wiki_path?.wiki_key")
	&& /\|\|\s*\(typeof shouldPathNameBeDisplayed === "function" && !shouldPathNameBeDisplayed\(p\)\)\)/.test(ohneKommentare),
	"der Zeichner reicht die abgehakten Wiki-Abschnitte nicht als Fueller herein");
// Kanal B ueberspringt Wiki-Wege weiter -- sonst stuende ein angehakter Wiki-Weg doppelt da.
assert.ok(/if \(wayLabelsEnabled && path\?\.properties\?\.wiki_path\?\.wiki_key\) \{\s*return;/.test(ohneKommentare),
	"Kanal B beschriftet Wiki-Wege wieder selbst -- Doppel-Label");

console.log("wegname-kanal-a-tor.test.js: ok");
