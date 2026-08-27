// Die deutschen Namen der Label-Arten stehen an EINER Stelle (js/ui/label-arten.js) -- und diese
// Stelle ist Zeichen fuer Zeichen das Auswahlfeld, aus dem ein Editor die Art waehlt.
//
// Zwei Zusicherungen, und die zweite ist die teurere:
//   1. Tabelle == #label-edit-type in index.html, in BEIDE Richtungen. Eine neue Art im
//      Auswahlfeld ohne Eintrag hier (oder umgekehrt) faellt hier auf, nicht erst in der Suche.
//   2. getSpotlightLabelTypeLabel benutzt die geteilte Tabelle WIRKLICH -- zur Laufzeit geprueft,
//      indem der Test einen Eintrag austauscht und das Ergebnis mitwandern muss. "Die Datei ist
//      eingebunden" ist erfuellt, auch wenn niemand sie ruft (die Lehre der Quellenkuerzung,
//      AGENTS.md §11).
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.join(__dirname, "..", "..", "..");
const { AVESMAPS_LABEL_ART_NAMEN, avesmapsLabelArtName } = require("../label-arten.js");

// ---- 1. Die Tabelle ist das Auswahlfeld ------------------------------------------------------
// Zeilenendenneutral gelesen: hier CRLF, im Deploy-Tor LF (AGENTS.md §9).
const indexHtml = fs.readFileSync(path.join(REPO, "index.html"), "utf8").replace(/\r\n/g, "\n");
const selectStart = indexHtml.indexOf('<select id="label-edit-type"');
assert.ok(selectStart >= 0, "#label-edit-type muss in index.html stehen");
const selectEnd = indexHtml.indexOf("</select>", selectStart);
const selectHtml = indexHtml.slice(selectStart, selectEnd);

const ausAuswahlfeld = {};
const optionPattern = /<option value="([^"]+)"[^>]*>([^<]+)<\/option>/g;
let treffer;
while ((treffer = optionPattern.exec(selectHtml)) !== null) {
	ausAuswahlfeld[treffer[1]] = treffer[2].trim();
}

assert.ok(Object.keys(ausAuswahlfeld).length >= 30,
	"das Auswahlfeld muss gelesen worden sein, gefunden: " + Object.keys(ausAuswahlfeld).length);

for (const [key, name] of Object.entries(ausAuswahlfeld)) {
	assert.strictEqual(AVESMAPS_LABEL_ART_NAMEN[key], name,
		"Art \"" + key + "\" steht im Auswahlfeld als \"" + name + "\" -- die geteilte Tabelle sagt \""
		+ AVESMAPS_LABEL_ART_NAMEN[key] + "\"");
}
for (const key of Object.keys(AVESMAPS_LABEL_ART_NAMEN)) {
	assert.ok(Object.prototype.hasOwnProperty.call(ausAuswahlfeld, key),
		"Art \"" + key + "\" steht in der geteilten Tabelle, aber in keinem <option> von #label-edit-type");
}

// ---- Der Rueckfall gehoert dem Aufrufer, nicht der Tabelle ------------------------------------
assert.strictEqual(avesmapsLabelArtName("vulkan"), "Vulkan");
assert.strictEqual(avesmapsLabelArtName("gibtsnicht"), "",
	"eine unbekannte Art gibt LEER zurueck -- was daraus wird, entscheidet der Aufrufer");
assert.strictEqual(avesmapsLabelArtName(undefined), "");

// ---- 2. Die Spotlight-Suche liest sie zur Laufzeit --------------------------------------------
function spotlightKontext() {
	const context = {
		console,
		document: { getElementById: () => null, querySelector: () => null },
		window: { matchMedia: () => ({ matches: false }), visualViewport: null },
		tr: (key, deutsch) => deutsch,
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(fs.readFileSync(path.join(REPO, "js", "ui", "label-arten.js"), "utf8"), context);
	vm.runInContext(fs.readFileSync(path.join(REPO, "js", "ui", "spotlight-search.js"), "utf8"), context);
	return context;
}

const echt = spotlightKontext();
assert.strictEqual(echt.getSpotlightLabelTypeLabel("vulkan"), "Vulkan");
assert.strictEqual(echt.getSpotlightLabelTypeLabel("flussland_flusstal"), "Flussland/Flusstal",
	"die Arten, die der Suche bisher fehlten, muessen jetzt ihren Namen tragen statt \"Label\"");
assert.strictEqual(echt.getSpotlightLabelTypeLabel("wueste"), "Wüste",
	"mit Umlaut -- die abgeschriebene Tabelle sagte \"Wueste\"");
assert.strictEqual(echt.getSpotlightLabelTypeLabel("gibtsnicht"), "Label",
	"unbekannt bleibt \"Label\": die Suchzeile MUSS etwas anzeigen");

// Der Spion: die geteilte Tabelle wird ausgetauscht, das Ergebnis muss mitwandern.
// 💣 Ueber vm.runInContext geaendert, nicht ueber das Kontextobjekt: ein `const` auf oberster
// Ebene ist eine lexikalische Bindung und liegt NICHT als Eigenschaft am globalen Objekt --
// von aussen zugegriffen waere es `undefined`, und der Spion pruefte nichts.
const spion = spotlightKontext();
vm.runInContext('AVESMAPS_LABEL_ART_NAMEN.vulkan = "AUSGETAUSCHT";', spion);
assert.strictEqual(spion.getSpotlightLabelTypeLabel("vulkan"), "AUSGETAUSCHT",
	"getSpotlightLabelTypeLabel muss die geteilte Tabelle wirklich lesen, nicht eine eigene Abschrift");

console.log("label-arten.test.js: alle Zusicherungen erfuellt");
