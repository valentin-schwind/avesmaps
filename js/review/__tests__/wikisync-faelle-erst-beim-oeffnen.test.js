// Die 4.220 WikiSync-Faelle werden erst gebaut, wenn das Konfliktfenster sichtbar ist.
//
// 💣 Gemessen 03.09.2026 im eingeloggten Editor: 62.607 DOM-Knoten in einem `hidden`-Overlay beim
// Start, 82 % des gesamten Editor-DOMs -- und jeder Selektorlauf der Karte ging seither ueber sie.
// Der Test FAEHRT den Renderer mit einer Dokument-Attrappe, statt seinen Quelltext zu lesen.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/wikisync-faelle-erst-beim-oeffnen.test.js
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

const cases = lies("js/review/review-wiki-sync-cases.js");
const sync = lies("js/review/review-wiki-sync.js");

// --- Umgebung -----------------------------------------------------------------------------------
let overlayHidden = true;
const listKinder = [];
const overlay = { get hidden() { return overlayHidden; } };
const listElement = { innerHTML: "", querySelectorAll: () => [], appendChild: (k) => { listKinder.push(k); } };
global.document = {
	getElementById: (id) => (id === "wiki-sync-conflicts-overlay" ? overlay : (id === "wiki-sync-case-list" ? listElement : null)),
	querySelectorAll: () => [],
};
global.window = { requestAnimationFrame: (fn) => fn() };
global.wikiSyncCases = [{ status: "open", name: "A" }];
global.wikiSyncFilterQuery = "";
global.wikiSyncFilterCollapseRequested = false;
global.isWikiSyncAccordionRestoring = false;
let kopfzeilen = 0;
global.syncWikiSyncPanelHeaderState = () => { kopfzeilen += 1; };
global.syncWikiSyncFilterControls = () => {};
global.setWikiSyncStatus = () => {};
global.buildWikiSyncStatusMessage = (m) => m;
global.getWikiSyncFilterQuery = () => "";
global.getWikiSyncFilteredCases = (c) => c;
global.getWikiSyncOpenGroupKeys = () => [];
global.restoreWikiSyncAccordionState = () => {};
let sektionen = 0;
global.renderWikiSyncCaseSection = (list, title, key, faelle) => {
	if (faelle.length < 1) { return null; }
	sektionen += 1;
	const el = { key };
	list.appendChild(el);
	return el;
};

// --- Die ECHTEN Bauteile ------------------------------------------------------------------------
vm.runInThisContext(schnitt(cases, "let wikiSyncLatestRun", ""));
vm.runInThisContext(schnitt(cases, "let wikiSyncCasesRenderAusstehend", ""));
vm.runInThisContext(schnitt(cases, "function wikiSyncCaseListVerborgen", "}"));
vm.runInThisContext(schnitt(cases, "function renderWikiSyncCases(", "}"));
vm.runInThisContext(schnitt(cases, "function renderWikiSyncCasesWennAusstehend", "}"));

// 1) Versteckt: nichts gebaut, aber die Kopfzeile des Panels laeuft, und der Bedarf ist gemerkt.
renderWikiSyncCases({ public_id: "lauf-1" });
assert.strictEqual(sektionen, 0, "verstecktes Overlay -> keine Sektion gebaut");
assert.strictEqual(listKinder.length, 0, "verstecktes Overlay -> kein Kind in der Liste");
assert.strictEqual(kopfzeilen, 1, "die Panel-Kopfzeile wird trotzdem nachgezogen");
assert.strictEqual(wikiSyncCasesRenderAusstehend, true, "der Bedarf ist gemerkt");
assert.deepStrictEqual(wikiSyncLatestRun, { public_id: "lauf-1" }, "der Lauf ist gemerkt");

// 2) Beim Oeffnen wird EINMAL gebaut, mit dem gemerkten Lauf.
overlayHidden = false;
renderWikiSyncCasesWennAusstehend();
assert.strictEqual(sektionen, 1, "nach dem Oeffnen genau eine Sektion");
assert.strictEqual(wikiSyncCasesRenderAusstehend, false, "der Bedarf ist erledigt");

// 3) Ohne Bedarf baut der Nachzug nichts.
renderWikiSyncCasesWennAusstehend();
assert.strictEqual(sektionen, 1, "kein zweiter Bau ohne Bedarf");

// 4) Sichtbar: der normale Aufruf baut sofort.
renderWikiSyncCases();
assert.strictEqual(sektionen, 2, "sichtbares Overlay -> sofort gebaut");

// 5) Der Oeffner ruft den Nachzug NACH dem Einblenden -- vorher waere das Overlay noch hidden.
const reihenfolge = [];
global.$ = () => ({ prop: (name, wert) => { reihenfolge.push(name + "=" + wert); } });
global.syncModalDialogBodyState = () => {};
global.renderWikiSyncCasesWennAusstehend = () => { reihenfolge.push("render"); };
global.document.getElementById = (id) => (id === "wiki-sync-conflicts-dialog" ? { focus() {} } : (id === "wiki-sync-conflicts-overlay" ? overlay : listElement));
vm.runInThisContext(schnitt(sync, "function setWikiSyncConflictsDialogOpen", "}"));
setWikiSyncConflictsDialogOpen(true);
assert.deepStrictEqual(reihenfolge, ["hidden=false", "render"], "erst einblenden, dann bauen");

console.log("OK wikisync-faelle-erst-beim-oeffnen (5 Abschnitte)");
