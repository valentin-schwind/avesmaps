// Die Vorpruefung der Refactoring-Routine -- vier historische Fixtures.
//
// 💣 Der Anlass: vier Laeufe der Routine (01.-04.09.2026) haben vier Lehren gelernt, und alle vier
// standen nur als Prosa in liste.md. Jede Fixture hier baut den Fall nach, an dem eine Lehre
// entstanden ist, und jede traegt eine Mutationsprobe: Bindung weg -> Befund weg; Bindung
// woanders -> Befund da. Ein Pruefer, der nur gruen kann, ist keiner.
//
// Entwurf: docs/superpowers/specs/2026-09-05-refactoring-routine-v2-design.md §5
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node tools/refactoring/__tests__/vorpruefung.test.js

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const MODUL = pathToFileURL(path.join(__dirname, "..", "vorpruefung.mjs")).href;

function tempRepo() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vorpruefung-"));
	return {
		dir,
		schreibe(rel, text) {
			const p = path.join(dir, rel);
			fs.mkdirSync(path.dirname(p), { recursive: true });
			fs.writeFileSync(p, text, "utf8");
			return p;
		},
	};
}

// -- A: Dump-Bericht (01.09.2026) -- ein Ladezeit-Export auf einen Blocknamen -------------
const DUMP = [
	"// Kopf",
	"let avesmapsDumpReportStylesInjected = false;",
	"function avesmapsOpenDumpReport(runId) {",
	"\tif (!avesmapsDumpReportStylesInjected) { injectStyles(); }",
	"\treturn renderDumpReport({ runId });",
	"}",
	"function renderDumpReport(opts) {",
	"\tconst re = /\\{[^}]*\\}/g; // Regex mit Klammern -- darf die Klammerzaehlung nicht kippen",
	"\treturn String(opts.runId).replace(re, \"}\");",
	"}",
	"function injectStyles() { avesmapsDumpReportStylesInjected = true; }",
	"window.avesmapsOpenDumpReport = avesmapsOpenDumpReport;",
	"",
].join("\n");

(async () => {
	const v = await import(MODUL);

	// A1: drei Funktionen, richtige Zeilen -- trotz Regex mit Klammern und String mit "}"
	const fns = v.findeFunktionen(DUMP, "js");
	assert.deepStrictEqual(fns.map((f) => [f.name, f.von, f.bis]),
		[["avesmapsOpenDumpReport", 3, 6], ["renderDumpReport", 7, 10], ["injectStyles", 11, 11]]);

	// A2: oberste Ebene = Kopf + let + window-Export; Ruempfe sind Leerzeichen, Zeilenzahl gleich
	const oben = v.blendeRuempfeAus(DUMP, fns);
	assert.strictEqual(oben.split("\n").length, DUMP.split("\n").length);
	assert.ok(!oben.includes("renderDumpReport({ runId })"), "Rumpf muss ausgeblendet sein");

	// A3: Pruefung 0 -- Zustand und Ladezeit-Code auf oberster Ebene, mit Zeilen
	const zustand = v.pruefeZustand(oben);
	assert.deepStrictEqual(zustand.map((z) => z.zeile), [2, 12]);

	// A4: Pruefung 1 -- avesmapsOpenDumpReport ist per window-Export gebunden, die anderen nicht
	const lade = v.pruefeLadezeit(oben, fns.map((f) => f.name));
	assert.deepStrictEqual([...lade.keys()], ["avesmapsOpenDumpReport"]);
	assert.deepStrictEqual(lade.get("avesmapsOpenDumpReport"), [12]);

	// A5: Mutationsprobe -- Export weg -> kein Ladezeit-Befund; Export auf injectStyles -> dort
	const ohne = DUMP.replace("window.avesmapsOpenDumpReport = avesmapsOpenDumpReport;", "");
	assert.strictEqual(v.pruefeLadezeit(v.blendeRuempfeAus(ohne, v.findeFunktionen(ohne, "js")),
		fns.map((f) => f.name)).size, 0);
	const anders = DUMP.replace("window.avesmapsOpenDumpReport = avesmapsOpenDumpReport;",
		"window.injectStyles = injectStyles;");
	assert.deepStrictEqual([...v.pruefeLadezeit(v.blendeRuempfeAus(anders,
		v.findeFunktionen(anders, "js")), fns.map((f) => f.name)).keys()], ["injectStyles"]);

	// A6: async function wird gefunden (Falle vom 02.09.2026)
	const mitAsync = "async function ladeX() {\n\treturn 1;\n}\nfunction y() {}\n";
	assert.deepStrictEqual(v.findeFunktionen(mitAsync, "js").map((f) => f.name), ["ladeX", "y"]);

	// A7: eine Deklaration in einem Kommentar oder String zaehlt nicht; ein Blockname in einem
	// Top-Level-STRING ist dagegen ein Ladezeit-Bezug (dynamische Namen sind die naechste Stufe)
	const imKommentar = "// function nichtDa() {}\nconst s = \"function auchNicht() {}\";\nfunction echt() {}\nconst TAB = { k: \"echt\" };\n";
	const fk = v.findeFunktionen(imKommentar, "js");
	assert.deepStrictEqual(fk.map((f) => f.name), ["echt"]);
	assert.deepStrictEqual([...v.pruefeLadezeit(v.blendeRuempfeAus(imKommentar, fk), ["echt"]).keys()], ["echt"]);

	console.log("vorpruefung A: ok");

	// -- B: Dateiregister (02.09.2026) -- ein Test fuehrt eine Dateiliste von Hand ----------------
	{
		const r = tempRepo();
		r.schreibe("js/review/review-wiki-sync.js", "function loadLoreList() {}\nfunction b() {}\n");
		r.schreibe("tools/paths/test-wiki-sync-panel-tab.mjs",
			'const searched = ["js/review/review-wiki-sync.js", "js/review/review-wiki-sync-cases.js"]\n' +
			'\t.map((file) => readFileSync(path.join(repoRoot, file), "utf8")).join("\\n");\n');
		r.schreibe("js/ui/egal.js", "// erwaehnt js/review/review-wiki-sync.js nur im Kommentar, ohne Anfuehrungszeichen\n");
		const reg = v.findeRegister("js/review/review-wiki-sync.js", r.dir);
		assert.deepStrictEqual(reg, [{ datei: "tools/paths/test-wiki-sync-panel-tab.mjs", zeile: 1 }]);
		// Mutationsprobe: Register auf eine andere Datei -> kein Treffer
		r.schreibe("tools/paths/test-wiki-sync-panel-tab.mjs", 'const searched = ["js/review/review-settlement-list.js"];\n');
		assert.deepStrictEqual(v.findeRegister("js/review/review-wiki-sync.js", r.dir), []);
	}

	// -- C: Quelltext-lesende Tests (03.09.2026) -- extractFunction(quelle, "name") -------------
	{
		const r = tempRepo();
		r.schreibe("js/routing/route-plan.js", "function isRoutePlanMarkerName() {}\nfunction routeAirLegsNote() {}\nfunction fitRoute() {}\n");
		r.schreibe("js/routing/__tests__/air-distance.test.js",
			'const planSource = fs.readFileSync(path.join(ROOT, "js", "routing", "route-plan.js"), "utf8");\n' +
			'const a = extractFunction(planSource, "routeAirLegsNote", "route-plan.js");\n' +
			'const i = planSource.indexOf("function isRoutePlanMarkerName");\n' +
			'const m = planSource.match(/function\\s+fitRoute\\b/);\n');
		r.schreibe("js/routing/__tests__/anderes.test.js", 'extractFunction(src, "fitRoute"); // liest NICHT route-plan.js\n');
		const qt = v.findeQuelltextTests("js/routing/route-plan.js", r.dir);
		assert.strictEqual(qt.length, 1);
		assert.strictEqual(qt[0].datei, "js/routing/__tests__/air-distance.test.js");
		assert.deepStrictEqual([...qt[0].namen].sort(), ["fitRoute", "isRoutePlanMarkerName", "routeAirLegsNote"]);
		// Mutationsprobe: der Test schneidet nichts mehr heraus -> keine Namen, kein Eintrag
		r.schreibe("js/routing/__tests__/air-distance.test.js",
			'const planSource = fs.readFileSync(path.join(ROOT, "js", "routing", "route-plan.js"), "utf8");\nassert.ok(planSource.length > 0);\n');
		assert.deepStrictEqual(v.findeQuelltextTests("js/routing/route-plan.js", r.dir), []);
	}
	console.log("vorpruefung B, C: ok");

	// -- D: vm-Bindung, transitiv (04.09.2026) -- der Test ruft eine, gebunden sind vier --------
	{
		const r = tempRepo();
		r.schreibe("js/review/review-path-sync.js", [
			"function loadVerlaufCases() { return renderVerlaufCaseList(findVerlaufCase(1)); }",
			"function renderVerlaufCaseList(list) { return verlaufOpenCleanTotal(list); }",
			"function findVerlaufCase(id) { return id; }",
			"function verlaufOpenCleanTotal(l) { return l; }",
			"function handlePathWikiAssignmentPick() { return 21; }",
			"",
		].join("\n"));
		r.schreibe("js/review/__tests__/ausreisser-loesen.test.js",
			'const quelle = fs.readFileSync(path.join(ROOT, "js", "review", "review-path-sync.js"), "utf8");\n' +
			"vm.createContext(sandbox);\n" +
			'vm.runInContext(quelle, sandbox, { filename: "review-path-sync.js" });\n' +
			"sandbox.loadVerlaufCases();\n");
		const text = fs.readFileSync(path.join(r.dir, "js/review/review-path-sync.js"), "utf8");
		const fns = v.findeFunktionen(text, "js");
		const namen = fns.map((f) => f.name);
		const vmt = v.findeVmTests("js/review/review-path-sync.js", r.dir, namen);
		assert.deepStrictEqual(vmt, [{ datei: "js/review/__tests__/ausreisser-loesen.test.js", genannt: ["loadVerlaufCases"] }]);
		const graph = v.aufrufgraph(text, fns);
		assert.deepStrictEqual([...graph.get("loadVerlaufCases")].sort(), ["findVerlaufCase", "renderVerlaufCaseList"]);
		const gebunden = v.fixpunkt(["loadVerlaufCases"], graph);
		assert.deepStrictEqual([...gebunden].sort(),
			["findVerlaufCase", "loadVerlaufCases", "renderVerlaufCaseList", "verlaufOpenCleanTotal"]);
		assert.ok(!gebunden.has("handlePathWikiAssignmentPick"), "frei bleibt genau eine");
		// Mutationsprobe 1: der Test laedt die Datei nicht mehr per vm -> keine Bindung
		r.schreibe("js/review/__tests__/ausreisser-loesen.test.js", 'require("../review-path-sync.js"); loadVerlaufCases();\n');
		assert.deepStrictEqual(v.findeVmTests("js/review/review-path-sync.js", r.dir, namen), []);
		// Mutationsprobe 2: eine Kante weniger im Graphen -> der Abschluss schrumpft
		const graph2 = new Map(graph); graph2.set("renderVerlaufCaseList", new Set());
		assert.ok(!v.fixpunkt(["loadVerlaufCases"], graph2).has("verlaufOpenCleanTotal"));
	}
	console.log("vorpruefung D: ok");
})().catch((e) => { console.error(e); process.exit(1); });
