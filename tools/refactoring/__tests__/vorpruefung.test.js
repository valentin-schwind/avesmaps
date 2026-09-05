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
		assert.deepStrictEqual(vmt, [{ datei: "js/review/__tests__/ausreisser-loesen.test.js", genannt: ["loadVerlaufCases"], wie: "variable quelle" }]);

		// D2: GANZ gegen AUSGESCHNITTEN -- nur das Ganze bindet (die drei Ladewege des Hauses)
		// (a) direkt im vm-Aufruf
		r.schreibe("js/review/__tests__/direkt.test.js",
			'vm.runInThisContext(fs.readFileSync(path.join(__dirname, "../review-path-sync.js"), "utf8"), { filename: "x" });\nfindVerlaufCase(1);\n');
		// (c) Lade-Hilfsfunktion mit Pfadliste
		r.schreibe("js/review/__tests__/helfer.test.js",
			'function lade(rel) {\n\tconst absolute = path.join(ROOT, rel);\n\tvm.runInThisContext(fs.readFileSync(absolute, "utf8"), { filename: absolute });\n}\n' +
			'["js/app/utils.js", "js/review/review-path-sync.js"].forEach(lade);\nverlaufOpenCleanTotal([]);\n');
		// ausgeschnitten: schneidet per indexOf/slice -> KEIN vm-Test, aber Pruefung 3 kennt den Namen
		r.schreibe("js/review/__tests__/schnipsel.test.js",
			'const seite = fs.readFileSync(path.join(ROOT, "js/review/review-path-sync.js"), "utf8");\n' +
			'const von = seite.indexOf("function findVerlaufCase");\nconst schnipsel = [seite.slice(von, seite.indexOf("\\n}", von) + 2)];\n' +
			"vm.runInContext(schnipsel.join(\"\\n\"), ctx);\n");
		// nur gelesen, in vm laeuft eine ANDERE Datei -> kein vm-Test
		r.schreibe("js/review/__tests__/nurgelesen.test.js",
			'const dialog = fs.readFileSync(path.join(ROOT, "js/review/review-path-sync.js"), "utf8");\nassert.ok(dialog.includes("handlePathWikiAssignmentPick"));\n' +
			'vm.runInContext(fs.readFileSync(path.join(ROOT, "js/app/utils.js"), "utf8"), ctx);\n');
		const vmt2 = v.findeVmTests("js/review/review-path-sync.js", r.dir, namen);
		assert.deepStrictEqual(vmt2.map((t) => [path.posix.basename(t.datei), t.wie]).sort(), [
			["ausreisser-loesen.test.js", "variable quelle"], ["direkt.test.js", "direkt"], ["helfer.test.js", "helfer lade (Liste)"],
		]);
		const qt2 = v.findeQuelltextTests("js/review/review-path-sync.js", r.dir);
		assert.deepStrictEqual(qt2.map((t) => [path.posix.basename(t.datei), t.namen]), [["schnipsel.test.js", ["findVerlaufCase"]]]);
		// (b) Ableitung ohne Ausschnitt: der groesste <script>-Block einer Editorseite ueber eine Funktion
		r.schreibe("html/editor.html", "<script>\nfunction a() { return b(); }\nfunction b() { return 1; }\n</script>\n");
		r.schreibe("js/pages/__tests__/editor-form.test.js",
			'const editorQuelle = fs.readFileSync(path.join(wurzel, "html/editor.html"), "utf8");\n' +
			'function oberflaechenQuelle() {\n\tconst bloecke = editorQuelle.match(/<script>([\\s\\S]*?)<\\/script>/g) || [];\n\treturn bloecke.map((x) => x.replace(/^<script>/, "").replace(/<\\/script>$/, "")).sort((p, q) => q.length - p.length)[0];\n}\n' +
			'vm.runInContext(oberflaechenQuelle(), kasten, { filename: "editor.html" });\nvm.runInContext("a", kasten)();\n');
		const ergHtml = v.vorpruefung({ datei: "html/editor.html", wurzel: r.dir, min: 1 });
		assert.deepStrictEqual(ergHtml.vmTests.map((t) => t.wie), ["variable oberflaechenQuelle"]);
		assert.deepStrictEqual(ergHtml.funktionen.map((f) => [f.name, f.gebunden.length > 0]), [["a", true], ["b", true]], "b haengt transitiv an a");
		const graph = v.aufrufgraph(text, fns);
		assert.deepStrictEqual([...graph.get("loadVerlaufCases")].sort(), ["findVerlaufCase", "renderVerlaufCaseList"]);
		const gebunden = v.fixpunkt(["loadVerlaufCases"], graph);
		assert.deepStrictEqual([...gebunden].sort(),
			["findVerlaufCase", "loadVerlaufCases", "renderVerlaufCaseList", "verlaufOpenCleanTotal"]);
		assert.ok(!gebunden.has("handlePathWikiAssignmentPick"), "frei bleibt genau eine");
		// Mutationsprobe 1: der Test laedt die Datei nicht mehr per vm -> keine Bindung
		r.schreibe("js/review/__tests__/ausreisser-loesen.test.js", 'require("../review-path-sync.js"); loadVerlaufCases();\n');
		assert.ok(!v.findeVmTests("js/review/review-path-sync.js", r.dir, namen).some((t) => t.datei.endsWith("ausreisser-loesen.test.js")),
			"ohne vm-Lauf keine Bindung aus diesem Test");
		// Mutationsprobe 2: eine Kante weniger im Graphen -> der Abschluss schrumpft
		const graph2 = new Map(graph); graph2.set("renderVerlaufCaseList", new Set());
		assert.ok(!v.fixpunkt(["loadVerlaufCases"], graph2).has("verlaufOpenCleanTotal"));
	}
	console.log("vorpruefung D: ok");

	// -- E: PHP -- Konstanten muessen VOR der require_once-Stelle definiert sein (citymaps.php, 04.09.) --
	{
		const php = [
			"<?php",
			"declare(strict_types=1);",
			"const AVESMAPS_CITYMAP_WIKI_API = 'x';",
			"define('AVESMAPS_CITYMAP_LIMIT', 5);",
			"function a(): int { return AVESMAPS_CITYMAP_LIMIT + strlen(AVESMAPS_CITYMAP_WIKI_API) + JSON_THROW_ON_ERROR; }",
			"function b(): string { return AVESMAPS_SPAETER; }",
			"const AVESMAPS_SPAETER = 'zu spaet';",
			"function c(): int { return 1; }",
			"",
		].join("\n");
		const fns = v.findeFunktionen(php, "php");
		assert.deepStrictEqual(fns.map((f) => f.name), ["a", "b", "c"]);
		const k = v.konstantenImBlock(php, fns, 0, 1); // Block a..b
		assert.deepStrictEqual(k.map((x) => [x.name, x.definiertVor]).sort(),
			[["AVESMAPS_CITYMAP_LIMIT", true], ["AVESMAPS_CITYMAP_WIKI_API", true], ["AVESMAPS_SPAETER", false]]);
		// JSON_THROW_ON_ERROR (Kernkonstante, nirgends definiert) darf NICHT auftauchen
		assert.ok(!k.some((x) => x.name === "JSON_THROW_ON_ERROR"));
		// und der Orchestrator macht daraus einen Bindungsgrund fuer den Block a..b, nicht fuer c
		const r = tempRepo();
		r.schreibe("api/_internal/app/x.php", php);
		const erg = v.vorpruefung({ datei: "api/_internal/app/x.php", wurzel: r.dir, von: "a", bis: "b", min: 1 });
		assert.strictEqual(erg.sprache, "php");
		assert.strictEqual(erg.block.frei, false);
		assert.ok(erg.block.gruende.some((g) => /AVESMAPS_SPAETER/.test(g)));
		assert.deepStrictEqual(erg.funktionen.find((f) => f.name === "c").gebunden, []);
	}

	// -- F: HTML-Inline-Script, freie Bloecke, Orchestrator, CLI ---------------------------------
	{
		const r = tempRepo();
		const html = [
			"<!doctype html>",
			"<script src=\"/js/ui/x.js\"></script>",
			"<script>",
			"function eins() { return 1; }",
			"function zwei() { return eins(); }",
			"",
			"let zustandDazwischen = 0;",
			"function drei() { return 3; }",
			"function vier() { return 4; }",
			"window.vier = vier;",
			"</script>",
			"",
		].join("\n");
		r.schreibe("html/seite.html", html);
		const inl = v.inlineScript(html);
		assert.strictEqual(inl.zeilenVersatz, 3);
		const erg = v.vorpruefung({ datei: "html/seite.html", wurzel: r.dir, min: 1 });
		assert.strictEqual(erg.sprache, "js");
		assert.deepStrictEqual(erg.funktionen.map((f) => [f.name, f.von]), [["eins", 4], ["zwei", 5], ["drei", 8], ["vier", 9]]);
		assert.deepStrictEqual(erg.funktionen.find((f) => f.name === "vier").gebunden, ["ladezeit: Z. 10"]);
		assert.deepStrictEqual(erg.zustand.map((z) => z.zeile), [7, 10]);
		// eins+zwei ein Block; drei allein (dazwischen Zustand); vier gebunden
		assert.deepStrictEqual(erg.freieBloecke.map((b) => b.namen), [["eins", "zwei"], ["drei"]]);
		assert.ok(Array.isArray(erg.nichtGesehen) && erg.nichtGesehen.length >= 3);
		// Blockvorschlag: eins..drei ist NICHT frei (Zustand dazwischen), eins..zwei ist frei
		assert.strictEqual(v.vorpruefung({ datei: "html/seite.html", wurzel: r.dir, von: "eins", bis: "drei" }).block.frei, false);
		assert.strictEqual(v.vorpruefung({ datei: "html/seite.html", wurzel: r.dir, von: "eins", bis: "zwei" }).block.frei, true);
		// min greift: mit min 3 ist nur eins..zwei (2 Zeilen) zu klein -> keine Bloecke
		assert.deepStrictEqual(v.vorpruefung({ datei: "html/seite.html", wurzel: r.dir, min: 3 }).freieBloecke, []);
		// CLI
		const { execFileSync } = require("child_process");
		const out = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, "..", "vorpruefung.mjs"),
			"html/seite.html", "--wurzel", r.dir, "--min", "1"], { encoding: "utf8" }));
		assert.strictEqual(out.datei, "html/seite.html");
		assert.strictEqual(typeof out.blob, "string");
		assert.deepStrictEqual(out.freieBloecke.map((b) => b.namen), [["eins", "zwei"], ["drei"]]);
	}
	console.log("vorpruefung E, F: ok");
})().catch((e) => { console.error(e); process.exit(1); });
