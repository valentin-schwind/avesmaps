// Das Kopfbild der Infobox -- und die drei Vokabulare, die es nachschlagen.
//
// 💣 DER BEFUND (Owner 30.08.2026, ueber ein frisch importiertes Moor: "wir haben extra bildchen
// fuer die kategorien"): INFO_HEADER_IMAGE_BY_ART (js/ui/popups.js) ist fuer die WIKI-Art gebaut
// -- Freitext wie "Bucht", "Wasserfall", "Marschland". Nachgeschlagen wird sie aber von DREI
// Vokabularen, und die schreiben dieselbe Sache verschieden:
//
//   Wiki-Art (Freitext) ........ "Moor"              -> sumpfmoor   (stand drin)
//   Label-Art .................. "Suempfe & Moore"   -> region      (stand NICHT drin)
//   Flaechen-Art ............... "Suempfe und Moore" -> region      (stand NICHT drin)
//
// Live gemessen: 90 von 359 Beschriftungen ohne Wiki-Zuweisung trugen deshalb das generische
// region.webp, obwohl icons/header/sumpfmoor.webp danebenlag.
//
// 🔴 DESHALB DIESER TEST, UND DESHALB GEGEN DIE ECHTEN QUELLEN: er liest das Label-Vokabular aus
// js/ui/label-arten.js, die Flaechen-Arten aus AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED
// (api/_internal/app/ecosystem.php -- die Arten leben serverseitig, eine Abschrift hier waere
// genau die zweite Wahrheit) und das Verzeichnis icons/header/. Eine Abschrift irgendeiner der
// drei liesse ihn gruen bleiben, waehrend die Karte etwas anderes zeigt.
//
// ⚠️ Eine Art OHNE passendes Bild ist erlaubt -- aber nur ausdruecklich, in GENERISCH_GEWOLLT und
// mit Grund. Ohne diese Liste faellt eine neue oder umbenannte Art LAUTLOS auf region.webp
// zurueck, und das sieht von "es gibt kein Bild dafuer" nicht zu unterscheiden aus.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REPO = path.join(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral: die Arbeitskopie traegt CRLF, das Deploy-Tor LF (AGENTS.md §9).
const lies = (...teile) => fs.readFileSync(path.join(REPO, ...teile), "utf8").replace(/\r\n/g, "\n");

// ---- Die echten Nachschlager aus popups.js ---------------------------------------------------
// Ausgeschnitten statt geladen, weil die ganze Datei ein DOM braucht -- dasselbe Verfahren wie in
// js/map-features/__tests__/label-infobox-eigene-art.test.js.
const popups = lies("js", "ui", "popups.js");
const von = popups.indexOf("const INFO_HEADER_IMAGE_BY_ART");
const bis = popups.indexOf("function infoHeaderImageMarkup");
assert.ok(von >= 0 && bis > von, "die Kopfbild-Tabellen muessen in popups.js auffindbar sein");
const context = { console, module: undefined };
vm.createContext(context);
vm.runInContext(popups.slice(von, bis), context);
// 🪤 `const` auf oberster Ebene eines vm-Skripts wird KEINE Eigenschaft des Kontextobjekts -- es
// lebt nur im lexikalischen Bereich des Kontexts. `context.INFO_HEADER_IMAGE_BY_ART` waere
// `undefined`, und ein Test, der ueber ein leeres Objekt laeuft, ist gruen und prueft nichts.
// Deshalb wird jeder Wert als AUSDRUCK im Kontext geholt.
const hole = (ausdruck) => vm.runInContext(ausdruck, context);
const INFO_HEADER_IMAGE_BY_ART = hole("INFO_HEADER_IMAGE_BY_ART");
const regionHeaderImageBasename = hole("regionHeaderImageBasename");
const normalizeInfoHeaderKey = hole("normalizeInfoHeaderKey");

// ---- Die vorhandenen Bilder ------------------------------------------------------------------
const BILDER = new Set(
	fs.readdirSync(path.join(REPO, "icons", "header"))
		.filter((name) => name.endsWith(".webp"))
		.map((name) => name.slice(0, -".webp".length))
);
assert.ok(BILDER.has("region"), "das generische Kopfbild region.webp muss es geben");
assert.ok(BILDER.has("sumpfmoor"), "sumpfmoor.webp ist der Anlass dieses Tests und muss dasein");

// ---- Vokabular 1: die Label-Arten ------------------------------------------------------------
vm.runInContext(lies("js", "ui", "label-arten.js"), context);
const labelArten = hole("AVESMAPS_LABEL_ART_NAMEN");
assert.ok(Object.keys(labelArten).length >= 25,
	"das Label-Vokabular muss wirklich gelesen worden sein, nicht leer durchlaufen");

// ---- Vokabular 2: die Arten der Landschaftsflaechen (PHP-Seed) --------------------------------
// 🪤 Kommentarzeilen werden ENTFERNT, bevor gesucht wird: der Seed ist dicht kommentiert, und ein
// Beispiel in einem Kommentar waere sonst eine Art, die es gar nicht gibt (AGENTS.md-Falle
// "Quelltexttest darf Kommentare nicht mitlesen").
const ecosystem = lies("api", "_internal", "app", "ecosystem.php");
const seedVon = ecosystem.indexOf("const AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED = [");
assert.ok(seedVon >= 0, "der Arten-Seed muss in api/_internal/app/ecosystem.php auffindbar sein");
const seedRumpf = ecosystem.slice(seedVon).split(/\n\s*\];/)[0]
	.split("\n").filter((zeile) => !zeile.trim().startsWith("//")).join("\n");
const flaechenArten = {};
for (const treffer of seedRumpf.matchAll(/\[\s*'(\w+)'\s*,\s*'(\w+)'\s*,\s*'([^']+)'\s*,\s*\d+\s*\]/g)) {
	flaechenArten[treffer[2]] = treffer[3];
}
assert.ok(Object.keys(flaechenArten).length >= 25,
	"der Flaechen-Seed muss wirklich gelesen worden sein, nicht leer durchlaufen");
assert.strictEqual(flaechenArten.suempfe_moore, "Sümpfe und Moore",
	"und er muss die Schreibweise der FLAECHE liefern (\"und\"), nicht die des Labels (\"&\")");

// ---- Wer darf generisch bleiben, und warum ---------------------------------------------------
// 🔴 Die ersten drei sagen "keine Landschaftsform" -- fuer sie IST region.webp die richtige Antwort.
// 🔧 Die uebrigen warten auf eine Owner-Entscheidung (eigenes Bildchen oder ein vorhandenes
//    mitbenutzen); sie stehen hier, damit die Luecke sichtbar bleibt, statt lautlos zu sein.
const GENERISCH_GEWOLLT = new Set([
	"region", "sonstiges", "kontinent",
	// 🔧 offen: kein passendes Bild in icons/header/
	"dschungel", "wuestenoase", "kulturlandschaft", "wadi",
	// 🔧 offen: ein Klimaband ist keine Landschaft -- es hat kein Aussehen, das sich abbilden liesse.
	"polar", "subpolar", "boreal", "gemaessigt",
	"subtropen_winterfeucht", "trockene_subtropen", "subtropisch", "tropisch",
]);

function pruefeVokabular(name, arten) {
	const generisch = [];
	for (const [schluessel, wort] of Object.entries(arten)) {
		const basename = regionHeaderImageBasename(wort);
		assert.ok(BILDER.has(basename),
			`${name}: "${wort}" zeigt auf icons/header/${basename}.webp -- die Datei gibt es nicht`);
		if (basename === "region") {
			generisch.push(schluessel);
			assert.ok(GENERISCH_GEWOLLT.has(schluessel),
				`${name}: die Art "${schluessel}" ("${wort}") faellt auf das generische region.webp zurueck. `
				+ `Entweder fehlt ihr Schluessel (${normalizeInfoHeaderKey(wort)}) in INFO_HEADER_IMAGE_BY_ART, `
				+ `oder sie gehoert ausdruecklich in GENERISCH_GEWOLLT.`);
		}
	}
	return generisch;
}

pruefeVokabular("Label-Art", labelArten);
pruefeVokabular("Flaechen-Art", flaechenArten);

// ---- Jeder Eintrag der Tabelle zeigt auf ein vorhandenes Bild ---------------------------------
for (const [schluessel, basename] of Object.entries(INFO_HEADER_IMAGE_BY_ART)) {
	assert.ok(BILDER.has(basename),
		`INFO_HEADER_IMAGE_BY_ART["${schluessel}"] = "${basename}" -- icons/header/${basename}.webp fehlt`);
}

// ---- Der gemeldete Fall, beide Schreibweisen -------------------------------------------------
assert.strictEqual(regionHeaderImageBasename("Sümpfe & Moore"), "sumpfmoor",
	"das Label-Wort des Owner-Befunds (Eupelmunder Moor)");
assert.strictEqual(regionHeaderImageBasename("Sümpfe und Moore"), "sumpfmoor",
	"und dasselbe Wort in der Schreibweise der Flaeche -- eine Regel, die einen von zwei Erzeugern "
	+ "bindet, ist keine Regel");

// ---- Die Wiki-Woerter bleiben unberuehrt -----------------------------------------------------
// 🔴 Sie sind der Grund, warum diese Tabelle ueber WOERTER geht und nicht ueber Schluessel: die
// Wiki-Art ist Freitext und hat keinen. Wer sie durch eine Schluesseltabelle ersetzt, verliert 264
// feinere Arten ("Bucht" statt "Meer") -- deshalb hier festgenagelt.
assert.strictEqual(regionHeaderImageBasename("Moor"), "sumpfmoor");
assert.strictEqual(regionHeaderImageBasename("Bucht"), "meer");
assert.strictEqual(regionHeaderImageBasename("Wasserfall"), "fluss");
assert.strictEqual(regionHeaderImageBasename("Halbinsel"), "kueste");

// ---- Und der Schnitt am Trennzeichen, den man beim Ergaenzen von Hand uebersieht --------------
// "Flussland/Flusstal" kommt als `flussland` an, NICHT als `flusslandflusstal`.
assert.strictEqual(normalizeInfoHeaderKey("Flussland/Flusstal"), "flussland");
assert.strictEqual(regionHeaderImageBasename("Flussland/Flusstal"), "fluss");
assert.strictEqual(regionHeaderImageBasename("Tal|Grube"), "ebene",
	"eine mehrwertige Wiki-Art wird am | geschnitten -- der erste Wert entscheidet");

// ---- Ein leerer/unbekannter Wert bleibt generisch --------------------------------------------
assert.strictEqual(regionHeaderImageBasename(""), "region");
assert.strictEqual(regionHeaderImageBasename("Gibtsnicht"), "region");

console.log("kopfbild-eigene-arten.test.js: alle Zusicherungen erfuellt");
