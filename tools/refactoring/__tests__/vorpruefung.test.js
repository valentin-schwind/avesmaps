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
})().catch((e) => { console.error(e); process.exit(1); });
