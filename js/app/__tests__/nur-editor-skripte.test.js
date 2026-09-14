// Editor-Code nur fuer Editoren: der Lader (js/app/nur-editor.js) und seine Verdrahtung in index.html.
//
// Drei Dinge werden festgehalten:
//   A. der Lader setzt die Vorlage NUR im Editor ein -- und faellt offen aus, nie geschlossen;
//   B. jede Vorlage steht so da, dass der Lader sie findet, und keine Datei wird doppelt geladen;
//   C. der Seitenstart eines BESUCHERS nennt keinen Namen aus einer Vorlage. Sonst wirft er beim
//      ersten Aufruf -- das ist die Falle, an der ein Vollausbau scheitert (bootstrap.js bindet
//      Editor-Funktionen unbedingt an Formulare).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8");

// ---------------------------------------------------------------------------------------------
// A. Den Lader wirklich ausfuehren.
// ---------------------------------------------------------------------------------------------
const LADER = lies("js/app/nur-editor.js");

function fahre({ editMode, vorlage, ohneAufruf = false }) {
	const geschrieben = [];
	const fehler = [];
	const kontext = vm.createContext({
		document: {
			currentScript: ohneAufruf ? null : { previousElementSibling: vorlage },
			write(text) { geschrieben.push(text); },
		},
		console: { error(meldung) { fehler.push(String(meldung)); } },
	});
	// Wie im Browser: IS_EDIT_MODE ist ein `const` eines FRUEHEREN Skripts (js/config.js).
	if (editMode !== undefined) {
		vm.runInContext("const IS_EDIT_MODE = " + JSON.stringify(editMode) + ";", kontext);
	}
	vm.runInContext(LADER, kontext);
	vm.runInContext("avesmapsNurEditorSkripte();", kontext);
	return { geschrieben, fehler };
}

const INNEN = '<script src="js/review/a.js?v=abc"></script><script src="js/review/b.js?v=def"></script>';
const vorlage = (attribut = true, tagName = "TEMPLATE") => ({
	tagName,
	innerHTML: INNEN,
	hasAttribute: (name) => attribut && name === "data-nur-editor",
});

{
	const r = fahre({ editMode: true, vorlage: vorlage() });
	assert.deepStrictEqual(r.geschrieben, [INNEN],
		"Im Editor muss der Inhalt der Vorlage unveraendert eingesetzt werden -- samt Stempel und Reihenfolge");
	assert.deepStrictEqual(r.fehler, []);
}
{
	const r = fahre({ editMode: false, vorlage: vorlage() });
	assert.deepStrictEqual(r.geschrieben, [], "Ein Besucher darf die Editor-Skripte nicht laden");
	assert.deepStrictEqual(r.fehler, [], "Beim Besucher ist Schweigen der Normalfall, kein Fehler");
}
{
	const r = fahre({ editMode: undefined, vorlage: vorlage() });
	assert.deepStrictEqual(r.geschrieben, [INNEN],
		"Fehlt IS_EDIT_MODE, wird geladen: ein Besucher mit zu viel Code ist harmlos, ein Editor ohne seinen Code kaputt");
}
for (const [fall, v] of [["ein <div> davor", vorlage(true, "DIV")], ["ein <template> ohne data-nur-editor", vorlage(false)], ["nichts davor", null]]) {
	const r = fahre({ editMode: true, vorlage: v });
	assert.deepStrictEqual(r.geschrieben, [], fall + ": es darf nichts eingesetzt werden");
	assert.strictEqual(r.fehler.length, 1, fall + ": das muss LAUT gemeldet werden, sonst fehlt still eine Editorfunktion");
}
{
	const r = fahre({ editMode: true, vorlage: vorlage(), ohneAufruf: true });
	assert.deepStrictEqual(r.geschrieben, []);
	assert.strictEqual(r.fehler.length, 1, "Ohne document.currentScript (Aufruf nicht aus einem <script>) laut melden, nicht werfen");
}

// ---------------------------------------------------------------------------------------------
// B. Die Verdrahtung in index.html.
// ---------------------------------------------------------------------------------------------
// Kommentare zuerst weg: sie nennen Dateipfade, und ein Pfad im Kommentar ist fuer jede
// indexOf-Messung ein frueheres Tag (AGENTS.md §11, Hintergrundklick).
const seite = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");

const VORLAGE_RE = /<template data-nur-editor>([\s\S]*?)<\/template>(\s*<script>[^<]*<\/script>)?/g;
const vorlagen = [...seite.matchAll(VORLAGE_RE)];
assert.ok(vorlagen.length > 0, "index.html traegt keine einzige Vorlage -- dann prueft dieser Test nichts");

const nurEditor = [];
for (const v of vorlagen) {
	const tags = v[1].match(/<script src="[^"]+"><\/script>/g) || [];
	assert.strictEqual(v[1].replace(/<script src="[^"]+"><\/script>/g, "").trim(), "",
		"In einer Vorlage stehen nur Skript-Tags, sonst nichts: " + v[0].slice(0, 120));
	assert.ok(tags.length > 0, "Leere Vorlage: " + v[0].slice(0, 120));
	assert.ok(v[2] && v[2].trim() === "<script>avesmapsNurEditorSkripte()</script>",
		"Direkt hinter jeder Vorlage muss der Aufruf stehen, sonst laedt der Editor diese Dateien nie: " + v[0].slice(0, 120));
	for (const t of tags) nurEditor.push(t.match(/src="([^"?]+)/)[1]);
}

const aufrufe = seite.match(/<script>\s*avesmapsNurEditorSkripte\(\)\s*<\/script>/g) || [];
assert.strictEqual(aufrufe.length, vorlagen.length, "Jeder Aufruf gehoert zu genau einer Vorlage");

const ladeTag = '<script src="js/app/nur-editor.js"></script>';
assert.strictEqual(seite.split(ladeTag).length - 1, 1, "Der Lader wird genau einmal eingebunden");
assert.ok(seite.indexOf('<script src="js/config.js"></script>') < seite.indexOf(ladeTag),
	"Der Lader steht nach js/config.js -- dort entsteht IS_EDIT_MODE");
assert.ok(seite.indexOf(ladeTag) < vorlagen[0].index, "Der Lader steht vor der ersten Vorlage");

const ausserhalb = seite.replace(VORLAGE_RE, "");
for (const datei of nurEditor) {
	assert.ok(!ausserhalb.includes('src="' + datei + '"'),
		datei + " steht in einer Vorlage UND als normales Skript -- der Editor luede es doppelt");
	assert.ok(fs.existsSync(path.join(WURZEL, datei)), datei + " gibt es nicht");
}

// Die review-Dateien des Besucher-Ablaufs „Ort melden". Sie duerfen in keiner Vorlage stehen, und Teil C
// prueft sie zusaetzlich wie Besucher-Code -- alle UEBRIGEN review-Dateien nimmt Teil C bewusst aus: 13 von
// ihnen rufen an rund 90 Stellen ungeschuetzt in die Vorlagen (Gebietsdialog, WikiSync-Listen, Wege-Wiki),
// erreichbar nur ueber den IS_EDIT_MODE-Zweig in bootstrap.js. Das haelt dieser Test NICHT fest.
// review-pending.js: setLocationReportSubmitPending aus review-report-flow.js.
const BESUCHER_REVIEW = ["js/review/review-pending.js", "js/review/review-report-flow.js", "js/review/review-locations.js",
	"js/review/meldung-quellen.js", "js/review/review-core.js", "js/review/review-feature-sources.js"];
for (const besucher of BESUCHER_REVIEW) {
	assert.ok(!nurEditor.includes(besucher), besucher + " braucht der Besucher (Ort melden) -- es darf in keiner Vorlage stehen");
}

// ---------------------------------------------------------------------------------------------
// C. Kein Besucher-Code nennt einen Namen aus einer Vorlage.
// ---------------------------------------------------------------------------------------------
function ohneJsKommentare(text) {
	return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}
function bezeichner(text) {
	return new Set(text.match(/[A-Za-z_$][\w$]*/g) || []);
}

const namen = new Map(); // Name -> Datei
for (const datei of nurEditor) {
	const text = ohneJsKommentare(lies(datei));
	const re = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)|(?:window|globalThis)\.([A-Za-z_$][\w$]*)\s*=(?!=)/gm;
	for (const m of text.matchAll(re)) {
		const name = m[1] || m[2] || m[3];
		if (name.length > 3) namen.set(name, datei);
	}
}
assert.ok(namen.has("startLinkCheck") || !nurEditor.includes("js/review/review-link-check.js"),
	"Die Namenssuche findet die Definitionen nicht mehr -- dann waere Teil C leer");

function jsDateien(verzeichnis, aus = []) {
	for (const e of fs.readdirSync(path.join(WURZEL, verzeichnis), { withFileTypes: true })) {
		const rel = verzeichnis + "/" + e.name;
		if (e.isDirectory()) {
			if (e.name === "__tests__" || e.name === "third-party" || rel === "js/review") continue;
			jsDateien(rel, aus);
		} else if (e.name.endsWith(".js")) {
			aus.push(rel);
		}
	}
	return aus;
}

const funde = [];
const besucherQuellen = jsDateien("js").map((rel) => [rel, ohneJsKommentare(lies(rel))]);
besucherQuellen.push(["index.html (ausserhalb der Vorlagen)", ausserhalb]);
for (const rel of BESUCHER_REVIEW) besucherQuellen.push([rel, ohneJsKommentare(lies(rel))]);
assert.ok(besucherQuellen.some(([rel]) => rel === "js/app/bootstrap.js"), "bootstrap.js muss unter den geprueften Dateien sein");
for (const [rel, text] of besucherQuellen) {
	if (rel === "js/app/nur-editor.js") continue;
	const ids = bezeichner(text);
	for (const [name, datei] of namen) {
		if (ids.has(name)) funde.push(rel + " nennt " + name + " (" + datei + ")");
	}
}
assert.deepStrictEqual(funde, [],
	"Diese Namen stehen nur im Editor zur Verfuegung. Ein Besucher-Skript, das sie nennt, wirft beim Aufruf. "
	+ "Entweder die Datei aus der Vorlage nehmen oder den Aufruf hinter IS_EDIT_MODE legen.");

console.log("nur-editor-skripte: ok (" + vorlagen.length + " Vorlagen, " + nurEditor.length + " Dateien, " + namen.size + " Namen geprueft)");
