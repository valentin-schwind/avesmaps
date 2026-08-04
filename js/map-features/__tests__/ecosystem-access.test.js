// Wer darf die Landschaften ANSEHEN, und wer darf sie BEDIENEN? Zwei Fragen, seit dem 2026-08-04.
//
// 🔴 WARUM DAS EIN TEST IST UND KEIN KOMMENTAR. Bis heute war es EINE Frage, und beide Antworten hingen
// an derselben Variablen. Wer sie wieder zusammenzieht, nimmt entweder jedem Besucher die Ansicht --
// oder er gibt jedem Besucher die Werkzeuge. Das erste fällt beim Bauen auf, das zweite nicht: die
// Kacheln erscheinen, der Untergrund blasst aus, und der Editor-Endpunkt antwortet mit 403, während
// alles danach aussieht, als funktioniere es.
//
// js/map-features/ wird als blankes <script> geladen; deshalb dieselbe vm-Bauart wie die Nachbartests.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "map-features-ecosystem-layer-switch.js"), "utf8");

let failures = 0;
function assert(condition, message) {
	if (!condition) {
		console.error("FAIL: " + message);
		failures += 1;
	}
}

// Eine frische Welt je Fall: der gemerkte „Alle"-Wert wird im Modul zwischengespeichert, und zwei Fälle
// im selben Kontext würden sich gegenseitig die Antwort vorgeben.
function welt({ modus = "ecosystem", darfBedienen = false, gemerktAlle = "0" } = {}) {
	const context = {
		console,
		window: { localStorage: { getItem: () => gemerktAlle, setItem: () => {} } },
		document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
		getSelectedMapLayerMode: () => modus,
		IS_ECOSYSTEM_ENABLED: darfBedienen,
		IS_EDIT_MODE: false,
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(source, context);
	return context;
}

// ---- ANSEHEN: jeder, sobald der Modus gewählt ist --------------------------------------------------
const besucher = welt({ darfBedienen: false });
assert(besucher.isEcosystemLayerModeActive(),
	"🔴 der gewöhnliche Besucher SIEHT die Ebene -- das ist die Freischaltung vom 2026-08-04");
assert(!besucher.canOperateEcosystemLayers(), "bedienen darf er sie nicht");

const daneben = welt({ modus: "political", darfBedienen: true });
assert(!daneben.isEcosystemLayerModeActive(), "in einem anderen Kartenmodus ist die Ebene aus");
assert(daneben.canOperateEcosystemLayers(),
	"das Recht haengt an der Sitzung, nicht am Modus -- es gilt auch daneben");

// ---- „Alle" ist für den Besucher die EINZIGE Ansicht -----------------------------------------------
// 💣 Erzwungen, nicht gespeichert: ohne das Bedienfeld gaebe es keinen Weg, eine andere Ebene zu waehlen.
// Ein Besucher, dessen Browser aus einer frueheren Editor-Sitzung „Vegetation" gemerkt hat, saehe sonst
// eine einzelne Ebene und keine Moeglichkeit, da wieder herauszukommen.
const besucherMitAltemWert = welt({ darfBedienen: false, gemerktAlle: "0" });
assert(besucherMitAltemWert.isEcosystemShowAllLayers(),
	"💣 der Besucher bekommt IMMER Alle -- auch wenn im Speicher etwas anderes steht");

const editorAlle = welt({ darfBedienen: true, gemerktAlle: "1" });
assert(editorAlle.isEcosystemShowAllLayers(), "der Editor bekommt, was er zuletzt gewaehlt hat: Alle");
const editorEine = welt({ darfBedienen: true, gemerktAlle: "0" });
assert(!editorEine.isEcosystemShowAllLayers(), "... oder eben seine eine Arbeitsebene");

// Und jede Ebene ist fuer den Besucher sichtbar -- das ist, was „Alle" bedeutet.
const sichtbar = welt({ darfBedienen: false });
["derographisch", "vegetation", "topographie", "klima"].forEach((kind) => {
	assert(sichtbar.isEcosystemKindVisible(kind), `in Alle ist ${kind} sichtbar`);
});

if (failures > 0) {
	console.error(`ecosystem-access.test: ${failures} failure(s)`);
	process.exit(1);
}
console.log("ecosystem-access.test: OK -- ansehen darf jeder, bedienen nur die Sitzung");
