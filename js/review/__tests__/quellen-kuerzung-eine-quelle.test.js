const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Die Kuerzung langer Seitenangaben („S. 16 ff.") gibt es EINMAL, und beide Oberflaechen benutzen
// sie: die Infobox, die jeder Besucher sieht (`js/ui/feature-source-markup.js`), und der Quellen-
// Editor (`js/review/review-feature-sources.js`). Sie zeigen dieselbe Spalte derselben Zeile.
//
// 💣 Anlass ist die Hausregel, an der das Projekt schon zweimal bezahlt hat: eine Regel, die einen
// von zwei Erzeugern bindet, ist keine Regel. Die erste Fassung dieses Umbaus hatte die Funktion
// nur im Editor -- die Infobox haette 31 Einzelseiten weiter in eine schmale feste Spalte gebrochen.
//
// ⚠️ Am Livebestand 24.08.2026 gemessen: 54.571 Seitenangaben, 17,2 % mit mehr als drei Eintraegen,
// die laengste 31 Eintraege / 120 Zeichen.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/quellen-kuerzung-eine-quelle.test.js

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (p) => fs.readFileSync(path.join(wurzel, p), "utf8");
const MARKUP = "js/ui/feature-source-markup.js";
const EDITOR = "js/review/review-feature-sources.js";

// ---- A. Es gibt genau EINE Definition ------------------------------------------------------------
// 🪤 Gesucht wird die DEFINITION, nicht der Name: `git grep featureSourceShortenPages` findet auch
// jeden Aufruf und jeden Kommentar. Und Kommentare zaehlen hier gar nicht mit -- eine
// Quelltextpruefung, die den erklaerenden Text trifft, ist im Haus schon fuenfmal gruen geblieben,
// ohne irgendetwas zu pruefen.
const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const definitionen = [];
const gehe = (verzeichnis) => {
	for (const e of fs.readdirSync(path.join(wurzel, verzeichnis), { withFileTypes: true })) {
		const rel = verzeichnis + "/" + e.name;
		if (e.isDirectory()) { if (e.name !== "third-party" && e.name !== "__tests__") gehe(rel); continue; }
		if (!e.name.endsWith(".js")) { continue; }
		const code = ohneKommentare(lies(rel));
		if (/(function\s+featureSourceShortenPages\s*\(|(?:const|let|var)\s+featureSourceShortenPages\s*=)/.test(code)) {
			definitionen.push(rel);
		}
	}
};
gehe("js");
assert.deepStrictEqual(definitionen, [MARKUP],
	"die Kuerzung ist genau einmal definiert, und zwar im reinen Renderer. Gefunden: " + definitionen.join(", "));

// ---- B. Jede Seite mit dem Editor laedt den Renderer DAVOR ----------------------------------------
// 🪤 Gemessen werden `<script src=…>`-Tags, NICHT das blosse Vorkommen des Dateinamens: zwei der
// Editorseiten nennen `review-feature-sources.js` in einem erklaerenden Kommentar VOR der
// Einbindung, und eine Zeilennummern-Pruefung darauf meldet fuer beide „falsche Reihenfolge".
const tagZeile = (zeilen, datei) =>
	zeilen.findIndex((l) => new RegExp('<script src="[^"]*' + datei.replace(/[.]/g, "[.]") + '"').test(l));
const htmlSeiten = [];
const sucheHtml = (verzeichnis) => {
	for (const e of fs.readdirSync(path.join(wurzel, verzeichnis), { withFileTypes: true })) {
		if (e.name === "node_modules" || e.name.startsWith(".")) { continue; }
		const rel = verzeichnis === "." ? e.name : verzeichnis + "/" + e.name;
		if (e.isDirectory()) { sucheHtml(rel); continue; }
		if (e.name.endsWith(".html")) { htmlSeiten.push(rel); }
	}
};
sucheHtml(".");

const mitEditor = htmlSeiten.filter((p) => tagZeile(lies(p).split(/\r?\n/), "review-feature-sources.js") >= 0);
// ⚠️ Die Zahl steht hier NICHT als Erwartung -- sie liest sich sonst wie eine vollstaendige Liste,
// und die naechste Editorseite waere dann stillschweigend ausgenommen. Geprueft wird die REGEL.
assert.ok(mitEditor.length >= 5, "mindestens die fuenf bekannten Seiten binden den Editor ein, gefunden: " + mitEditor.length);
for (const p of mitEditor) {
	const zeilen = lies(p).split(/\r?\n/);
	const m = tagZeile(zeilen, "feature-source-markup.js");
	const e = tagZeile(zeilen, "review-feature-sources.js");
	assert.ok(m >= 0, p + " laedt feature-source-markup.js -- ohne sie wirft der Zeilenbauer");
	assert.ok(m < e, p + " laedt sie DAVOR (markup@" + (m + 1) + ", editor@" + (e + 1) + ")");
}

// ---- C. Beide Oberflaechen rufen sie WIRKLICH auf -------------------------------------------------
// 🔴 Das ist die eigentliche Zusicherung. „Die Funktion existiert" und „die Datei ist eingebunden"
// sind beide erfuellt, wenn niemand sie aufruft -- die Falle vom gruenen Test ohne Verdrahtung.
const kontext = { fetch: () => Promise.resolve(null) };
vm.createContext(kontext);
vm.runInContext(lies(MARKUP), kontext, { filename: "feature-source-markup.js" });
vm.runInContext(lies(EDITOR), kontext, { filename: "review-feature-sources.js" });

const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, (c) =>
	({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const LANG = "8, 10, 14, 22, 40, 43, 51";

const echt = kontext.featureSourceShortenPages;
let rufe = [];
kontext.featureSourceShortenPages = function (p) { rufe.push(p); return echt(p); };

const flaechen = [
	["Infobox, Zeile ‚Quelle(n)'", () => kontext.buildSourceListMarkup("", [
		{ label: "Eigen", url: "https://x/b", type: "roman", pages: LANG }], { escape: esc })],
	["Infobox, Publikationstabelle", () => kontext.buildSourceListMarkup("", [
		{ label: "Werk", url: "https://x/a", reference_kind: "supplementary", type: "abenteuer", pages: LANG }],
		{ escape: esc })],
	["Quellen-Editor, Zeile", () => kontext.renderFeatureSourceEditorHtml({
		sources: [{ id: 1, url: "https://x/c", label: "Werk", source_type: "regelwerk", origin: "manual", pages: LANG }],
		wiki_url: "" }, { escape: esc })],
];

for (const [name, bau] of flaechen) {
	rufe = [];
	const html = bau();
	assert.ok(rufe.indexOf(LANG) >= 0, name + " ruft die geteilte Kuerzung auf (Rufe: " + rufe.length + ")");
	assert.ok(html.indexOf("8 ff.") >= 0, name + " zeigt die Kurzform");
	assert.ok(html.indexOf(LANG) >= 0, name + " traegt die volle Angabe im Titel -- sonst waere sie weg");
}
kontext.featureSourceShortenPages = echt;

// ---- D. Der ZWEITE Ladeweg: `require` ohne gemeinsamen globalen Raum ----------------------------
// 💣 Im Browser teilen sich die beiden Skripte den globalen Raum, unter Node NICHT. Zwei fremde
// Tests (`feature-sources-render`, `pending-feature-sources`) requiren den Zeilenbauer allein und
// fielen beim Umzug mit `ReferenceError: featureSourceShortenPages is not defined` um. Gefunden hat
// das erst der Lauf ueber das GANZE Feld -- die eigenen Tests waren alle gruen.
// ⚠️ Deshalb wird hier WIRKLICH gerendert, nicht nur requirt: ein Modul laedt auch dann, wenn der
// Fehler erst beim Aufruf kommt.
const alsModul = require(path.join(wurzel, EDITOR));
const perRequire = alsModul.renderFeatureSourceEditorHtml({
	sources: [{ id: 1, url: "https://x/d", label: "Werk", source_type: "regelwerk", origin: "manual", pages: LANG }],
	wiki_url: "" }, { escape: esc });
assert.ok(perRequire.indexOf("8 ff.") >= 0,
	"auch per require gekuerzt -- ohne gemeinsamen globalen Raum");
assert.ok(perRequire.indexOf(LANG) >= 0, "und die volle Angabe reist mit");

console.log("quellen-kuerzung-eine-quelle: alle Zusicherungen gruen (" + mitEditor.length + " Seiten geprueft)");
