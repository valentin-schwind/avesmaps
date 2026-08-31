// Die Ortsklasse `stadtviertel` -- und das Merkmal, das `gebaeude` bis zum 31.08.2026 nebenbei
// mitbeantwortet hat.
//
// 💣 DER KERN: `locationType === "gebaeude"` war RICHTIG, solange es genau eine Bauwerksklasse gab.
// Mit `stadtviertel` daneben (Owner 30.08.2026, Garetien-Import: „wie Gebäude, aber innerorts")
// bekäme das Viertel an jeder dieser Stellen still die Siedlungs-Behandlung -- den Kreis statt der
// Raute, den falschen Unterfilter im Editor. Kein Fehler, keine Meldung, nur falsch. Deshalb hat
// das Merkmal jetzt einen Namen (js/ui/ortsklassen.js), und deshalb prüft dieser Test nicht nur den
// Namen, sondern JEDEN Leser.
//
// 🔴 UND JEDE TABELLE, DIE JE ORTSKLASSE EINE ZEILE FÜHRT. Eine vergessene Zeile ist hier nie ein
// Absturz: der Marker bekommt eine Vorgabe, das Label eine andere, und die Klasse sieht aus wie
// eine halb gebaute. Die Liste unten ist deshalb vollständig gemeint -- wer eine Tabelle ergänzt,
// ergänzt sie hier.
//
// Aus der Wurzel: node js/ui/__tests__/ortsklassen.test.js
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.join(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral (AGENTS.md §9: hier CRLF, im Deploy-Tor LF).
const lies = (...t) => fs.readFileSync(path.join(REPO, ...t), "utf8").replace(/\r\n/g, "\n");
// 🪤 Kommentare RAUS, bevor gesucht wird: die Prosa dieser Dateien nennt „gebaeude" und
// „stadtviertel" laufend, und ein Treffer im Kommentar ist kein Beleg (AGENTS.md-Falle).
const ohneKommentare = (q) => q.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

let pruefungen = 0;

// ---- 1. Das Merkmal selbst -------------------------------------------------------------------
const { AVESMAPS_BAUWERKSKLASSEN, avesmapsIstBauwerksklasse } = require("../ortsklassen.js");
assert.deepStrictEqual(AVESMAPS_BAUWERKSKLASSEN, ["gebaeude", "stadtviertel"]);
assert.strictEqual(avesmapsIstBauwerksklasse("gebaeude"), true);
assert.strictEqual(avesmapsIstBauwerksklasse("stadtviertel"), true, "das Viertel IST ein Bauwerk");
assert.strictEqual(avesmapsIstBauwerksklasse("dorf"), false);
assert.strictEqual(avesmapsIstBauwerksklasse(""), false);
assert.strictEqual(avesmapsIstBauwerksklasse(null), false);
assert.strictEqual(avesmapsIstBauwerksklasse(undefined), false);
assert.strictEqual(avesmapsIstBauwerksklasse("Gebaeude"), false, "der Slug ist kleingeschrieben");
pruefungen += 8;

// ---- 2. Die vier Leser fragen das Merkmal, nicht einen Wert -----------------------------------
// 🔴 Der zweite Teil jeder Zusicherung ist der wichtigere: ein zurückgebliebener Vergleich auf den
// EINEN Wert wäre unauffällig -- die Zeile sieht richtig aus und ist es für `gebaeude` auch.
const LESER = [
	["js/map-features/map-features-location-marker-rendering.js", "der Marker im DOM"],
	["js/map-features/map-features-location-canvas-layer.js", "der Marker auf der Canvas"],
	["js/review/review-settlement-list.js", "die Panel-Liste des Ortseditors"],
	["html/wiki-sync-settlement-editor.html", "das Ortseditor-Fenster"],
];
for (const [datei, wozu] of LESER) {
	const q = ohneKommentare(lies(...datei.split("/")));
	assert.ok(q.includes("avesmapsIstBauwerksklasse("),
		`${wozu} (${datei}) muss das geteilte Merkmal fragen`);
	assert.ok(!/=== *"gebaeude"/.test(q),
		`${wozu} (${datei}) vergleicht noch auf den EINEN Wert "gebaeude" -- mit zwei `
		+ `Bauwerksklassen ist das still falsch`);
	pruefungen += 2;
}

// 🔴 Und die zwei Dokumente, die das Bauteil laden, müssen es VOR seinen Lesern laden.
// ⚠️ Kein Ladefehler im Browser: `avesmapsIstBauwerksklasse` wird erst zur Laufzeit gerufen. Aber
// die Reihenfolge ist die Zusage, an der sich das Haus sonst überall hält -- und ein späteres
// `defer`/Umsortieren würde sie ohne diesen Test lautlos brechen.
for (const [dokument, leser] of [
	["index.html", ["js/map-features/map-features-location-marker-rendering.js",
		"js/map-features/map-features-location-canvas-layer.js",
		"js/review/review-settlement-list.js"]],
	["html/wiki-sync-settlement-editor.html", []],
]) {
	const q = lies(...dokument.split("/"));
	const pos = q.indexOf("ui/ortsklassen.js");
	assert.ok(pos > 0, `${dokument} muss js/ui/ortsklassen.js laden`);
	for (const l of leser) {
		assert.ok(pos < q.indexOf(l), `${dokument}: ortsklassen.js muss VOR ${l} stehen`);
	}
	pruefungen++;
}

// ---- 3. Jede Tabelle, die je Ortsklasse eine Zeile führt --------------------------------------
// Die Blöcke aus js/config.js ausgeschnitten: die ganze Datei laufen zu lassen zieht Abhängigkeiten
// nach (AVESMAPS_CATMULL_DEFAULTS, URLSearchParams …), die mit den Ortsklassen nichts zu tun haben.
const config = lies("js", "config.js");
const von = config.indexOf("const LOCATION_TYPE_CONFIG = {");
const bis = config.indexOf("const LOCATION_TYPE_KEYS");
assert.ok(von >= 0 && bis > von, "die Ortsklassen-Tabellen müssen in js/config.js auffindbar sein");
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(config.slice(von, bis), ctx);
// 🪤 `const` auf oberster Ebene eines vm-Skripts wird KEINE Eigenschaft des Kontextobjekts --
// jeder Wert wird als AUSDRUCK geholt, sonst liefe der Test über `undefined` und wäre grün.
const hole = (a) => vm.runInContext(a, ctx);
vm.runInContext(config.slice(bis, config.indexOf("\n", config.indexOf("LOCATION_TYPE_VISIBILITY_ORDER"))), ctx);

const eintrag = hole("LOCATION_TYPE_CONFIG").stadtviertel;
assert.ok(eintrag, "LOCATION_TYPE_CONFIG kennt stadtviertel");
assert.strictEqual(eintrag.label, "Stadtviertel");
assert.strictEqual(eintrag.singularLabel, "Stadtviertel",
	"Plural und Singular sind im Deutschen dasselbe Wort -- kein vergessenes Feld");
assert.strictEqual(eintrag.queryParam, "toggleStadtviertel", "eigener Schalter im Auge-Menü");
assert.ok(hole("LOCATION_TYPE_VISIBILITY_ORDER").includes("stadtviertel"),
	"ohne Eintrag in der Sichtbarkeitsreihenfolge lässt sie sich nicht schalten");
pruefungen += 5;

// 🔧 GELIEHENE BILDER (Owner 31.08.2026: „nimm erstmal die gebäude-bilder"). Der Test nagelt das
// als ABSICHT fest -- und dass die Dateien wirklich existieren. Ein eigenes Bild ändert diese drei
// Zusicherungen; ein FEHLENDES bliebe sonst bis zum ersten Blick auf die Karte unbemerkt.
for (const [tabelle, wozu] of [["LOCATION_ICON_PATHS", "Kartenmarker"],
	["LOCATION_REALISTIC_ICON_PATHS", "Popup-Kopf"]]) {
	const pfad = hole(tabelle).stadtviertel;
	assert.strictEqual(pfad, hole(tabelle).gebaeude,
		`${wozu}: geliehen vom Gebäude, solange es kein eigenes Bild gibt`);
	assert.ok(fs.existsSync(path.join(REPO, pfad)), `${wozu}: ${pfad} muss es geben`);
	pruefungen += 2;
}

// Die Zoombänder -- wortgleich wie gebaeude (Owner).
const bands = { globalThis: {} };
bands.globalThis = bands;
vm.createContext(bands);
vm.runInContext(lies("js", "map-features", "location-zoom-bands.js"), bands);
const vorgabe = bands.AVESMAPS_LOCATION_ZOOM_BAND_DEFAULTS;
assert.ok(vorgabe, "die Vorgabetafel muss geladen sein");
for (const band of ["marker", "label"]) {
	assert.deepStrictEqual(vorgabe[band].stadtviertel, vorgabe[band].gebaeude,
		`Zoomband "${band}": ein Stadtviertel erscheint und wächst wie ein Bauwerk`);
	pruefungen++;
}

// Label-Rangfolge, Kopfbild, Canvas-Typen, SVG-Abzug, englische Fassung.
const platz = { globalThis: {} };
platz.globalThis = platz;
vm.createContext(platz);
vm.runInContext(lies("js", "map-features", "label-placement.js"), platz);
assert.strictEqual(platz.AVESMAPS_LABEL_PRIORITY_BY_TYPE.stadtviertel,
	platz.AVESMAPS_LABEL_PRIORITY_BY_TYPE.gebaeude, "gleicher Rang wie das Bauwerk");

const popups = lies("js", "ui", "popups.js");
const pVon = popups.indexOf("const INFO_HEADER_IMAGE_BY_SETTLEMENT");
const pBis = popups.indexOf("function normalizeInfoHeaderKey");
assert.ok(pVon >= 0 && pBis > pVon, "die Kopfbild-Tabelle muss auffindbar sein");
const pctx = { console };
vm.createContext(pctx);
vm.runInContext(popups.slice(pVon, pBis), pctx);
const basename = vm.runInContext("INFO_HEADER_IMAGE_BY_SETTLEMENT", pctx).stadtviertel;
assert.strictEqual(basename, "gebaeude", "🔧 geliehenes Kopfbild, siehe oben");
assert.ok(fs.existsSync(path.join(REPO, "icons", "header", basename + ".webp")),
	`icons/header/${basename}.webp muss es geben`);

const canvas = ohneKommentare(lies("js", "map-features", "map-features-location-canvas-layer.js"));
assert.ok(/LOCATION_CANVAS_TYPES[^;]*"stadtviertel"/.test(canvas),
	"ohne Eintrag in LOCATION_CANVAS_TYPES wird die Klasse auf der Canvas gar nicht gezeichnet");

const svgx = ohneKommentare(lies("js", "pages", "svg-export-build.js"));
assert.ok(/slug: "stadtviertel"/.test(svgx), "der SVG-Abzug braucht ihre Punktgröße");
assert.ok(/stadtviertel: \{ de:/.test(svgx), "und ihren Begriff im Vokabular des Abzugs");

const en = lies("js", "app", "i18n-en.js");
for (const key of ["report.sizeOption.stadtviertel", "layer.toggle.stadtviertel",
	"type.stadtviertel.singular"]) {
	assert.ok(en.includes(`"${key}"`), `die englische Fassung braucht ${key}`);
}
pruefungen += 7;

// ---- 4. Die Oberflächen: drei Auswahllisten und der Schalter im Auge-Menü ---------------------
const index = lies("index.html");
const auswahl = index.match(/<option value="stadtviertel"/g) || [];
assert.strictEqual(auswahl.length, 3,
	"drei Auswahllisten führen die Ortsgröße (Meldedialog, Kartendialog, WikiSync-Auflösung) -- "
	+ `gefunden: ${auswahl.length}`);
assert.ok(index.includes('data-location-type="stadtviertel"'),
	"und das Auge-Menü braucht ihren eigenen Schalter");
const editor = lies("html", "wiki-sync-settlement-editor.html");
assert.ok(editor.includes('{ value: "stadtviertel", label: "Stadtviertel" }'),
	"das Ortseditor-Fenster bietet dieselbe Wahl wie der Kartendialog");
assert.ok(/ZOOM_BAND_KLASSEN = \[[^\]]*"stadtviertel"/.test(editor),
	"und seine Zoomband-Tafel zeigt die neue Kurve");
pruefungen += 4;

console.log(`ortsklassen.test.js: ${pruefungen} Pruefungen erfuellt`);
