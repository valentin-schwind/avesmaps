// Die deutschen Namen der Label-Arten stehen an EINER Stelle (js/ui/label-arten.js) -- und diese
// Stelle ist Zeichen fuer Zeichen das Auswahlfeld, aus dem ein Editor die Art waehlt.
//
// Drei Zusicherungen, und die dritte ist die, die am 30.08.2026 gefehlt hat:
//   1. Tabelle == #label-edit-type in index.html, in BEIDE Richtungen. Eine neue Art im
//      Auswahlfeld ohne Eintrag hier (oder umgekehrt) faellt hier auf, nicht erst in der Suche.
//   2. getSpotlightLabelTypeLabel benutzt die geteilte Tabelle WIRKLICH -- zur Laufzeit geprueft,
//      indem der Test einen Eintrag austauscht und das Ergebnis mitwandern muss. "Die Datei ist
//      eingebunden" ist erfuellt, auch wenn niemand sie ruft (die Lehre der Quellenkuerzung,
//      AGENTS.md §11).
//   3. Jede gesaete Landschaftsart (AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED, ausser den Klimazonen)
//      hat hier einen Namen. 💣 GENAU DAS FEHLTE: `urwald` kam am 29.08.2026 in den Seed und in
//      die Speicher-Erlaubnis (avesmapsReadLabelSubtype), aber nicht ins Auswahlfeld -- und die
//      zwei Zusicherungen oben blieben gruen, weil sie Tabelle und Markup nur GEGENEINANDER halten.
//      Zwei deckungsgleiche Abschriften, denen dieselbe Art fehlt, sind deckungsgleich.
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

// ---- 3. Jede gesaete Landschaftsart hat einen Namen -------------------------------------------
// Der Subtyp eines Labels IST der Art-Schluessel seiner Flaeche (derselbe Satz steht ueber
// avesmapsReadLabelSubtype, api/_internal/map/features.php). ecosystem-geometry-test.php haelt den
// Seed deshalb schon gegen die SPEICHER-Erlaubnis -- diese Zusicherung ist die fehlende zweite
// Haelfte: gegen das VOKABULAR. Eine Art, die sich speichern laesst, aber in keinem Auswahlfeld
// steht und keinen Namen hat, ist an der Oberflaeche nicht vorhanden.
//
// 🔴 OHNE die Klimazonen, aus demselben Grund wie dort: ein Klimaband traegt kein Kartenlabel, sein
// Name wird von der Ebene selbst gezeichnet. Sie hier aufzunehmen hiesse anzubieten, ein Label
// „Tropische Zone" auf die oeffentliche Karte zu setzen.
//
// ⚠️ Verglichen werden SCHLUESSEL, nie Woerter: die Flaeche schreibt „Sümpfe und Moore", das Label
// „Sümpfe & Moore" -- beide Schreibweisen sind gewollt und in kopfbild-eigene-arten.test.js
// festgenagelt.
//
// ⚠️ Und nur DIESE Richtung ist eine Regel. Das Label-Vokabular ist echt groesser als der Seed --
// gemessen 30.08.2026 stehen `berggipfel`, `ebene`, `fluss` und `vulkan` nur hier (Gipfel sind
// Punkte, Fluesse Linien, und die Ebene hat keinen eigenen Reisefaktor). Die Gegenrichtung zu
// erzwingen hiesse, jede dieser vier zu einer Flaechenart zu machen.
const ecosystemPhp = fs.readFileSync(path.join(REPO, "api", "_internal", "app", "ecosystem.php"), "utf8")
	.replace(/\r\n/g, "\n");
const seedVon = ecosystemPhp.indexOf("const AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED = [");
assert.ok(seedVon >= 0, "der Arten-Seed muss in api/_internal/app/ecosystem.php auffindbar sein");
// 🪤 Kommentarzeilen RAUS, bevor gesucht wird -- der Seed ist dicht kommentiert, und ein Beispiel in
// einem Kommentar waere eine Art, die es gar nicht gibt (dieselbe Vorsichtsmassnahme wie in
// kopfbild-eigene-arten.test.js).
const seedRumpf = ecosystemPhp.slice(seedVon).split(/\n\s*\];/)[0]
	.split("\n").filter((zeile) => !zeile.trim().startsWith("//")).join("\n");
const gesaeteArten = [];
for (const seedZeile of seedRumpf.matchAll(/\[\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*'[^']+'\s*,\s*\d+\s*\]/g)) {
	gesaeteArten.push({ kind: seedZeile[1], key: seedZeile[2] });
}
assert.ok(gesaeteArten.length >= 30,
	"der Seed muss wirklich gelesen worden sein, gefunden: " + gesaeteArten.length);
assert.ok(gesaeteArten.some((art) => art.kind === "klima"),
	"die Klimazonen muessen im gelesenen Seed stehen -- sonst prueft der Ausschluss unten nichts");

for (const art of gesaeteArten) {
	if (art.kind === "klima") { continue; }
	assert.ok(Object.prototype.hasOwnProperty.call(AVESMAPS_LABEL_ART_NAMEN, art.key),
		"die gesaete Landschaftsart \"" + art.key + "\" (" + art.kind + ") hat keinen Namen in "
		+ "js/ui/label-arten.js und steht damit in keinem Auswahlfeld -- genau die Luecke, mit der "
		+ "`urwald` am 29.08.2026 halb angekommen ist");
}

assert.strictEqual(avesmapsLabelArtName("urwald"), "Urwald", "der gemeldete Fall");

console.log("label-arten.test.js: alle Zusicherungen erfuellt");
