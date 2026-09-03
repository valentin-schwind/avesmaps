// Der 45-s-Poll der Meldungsliste schweigt in versteckten Tabs -- derselbe Riegel wie beim
// Live-Abgleich (pollLiveMapUpdates). Gemessen 03.09.2026: 11 Abrufe in 10 min aus einem Tab, den
// niemand ansah, jeder mit CREATE TABLE + 5x SHOW COLUMNS.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/meldungen-poll-versteckt.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ZE = String.fromCharCode(10);
const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").split("\r\n").join(ZE);
const schnitt = (quelle, anfang, schluss) => {
	const start = quelle.indexOf(anfang);
	assert.notStrictEqual(start, -1, anfang + " nicht gefunden");
	const ende = quelle.indexOf(ZE + schluss, start);
	assert.notStrictEqual(ende, -1, "Ende von " + anfang + " nicht gefunden");
	return quelle.slice(start, ende + 1 + schluss.length);
};

const panels = lies("js/review/review-panels.js");

global.IS_EDIT_MODE = true;
global.reviewReportListUrl = () => "api/edit/reports/locations.php?status=neu";
let abrufe = 0;
// Der Abruf wirft nach dem Zaehlen: so bleibt der Rest der Funktion (Rendern) ausser Betracht.
global.fetch = async () => { abrufe += 1; throw new Error("Testabbruch"); };
global.console = { warn: () => {}, log: console.log, error: console.error };
global.document = { hidden: true };

vm.runInThisContext(schnitt(panels, "async function pollReviewReportsForNew", "}"));

(async () => {
	await pollReviewReportsForNew();
	assert.strictEqual(abrufe, 0, "versteckter Tab -> kein Abruf");
	global.document.hidden = false;
	await pollReviewReportsForNew();
	assert.strictEqual(abrufe, 1, "sichtbarer Tab -> Abruf");
	console.log("OK meldungen-poll-versteckt");
})().catch((error) => { console.error(error); process.exit(1); });
