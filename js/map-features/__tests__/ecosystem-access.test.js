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
function welt({ modus = "ecosystem", recht = false, editor = true, gemerktAlle = "0" } = {}) {
	const context = {
		console,
		window: { localStorage: { getItem: () => gemerktAlle, setItem: () => {} } },
		document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
		getSelectedMapLayerMode: () => modus,
		IS_ECOSYSTEM_ENABLED: recht,
		IS_EDIT_MODE: editor,
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(source, context);
	return context;
}

// ---- ANSEHEN: jeder, sobald der Modus gewählt ist --------------------------------------------------
const besucher = welt({ recht: false, editor: false });
assert(besucher.isEcosystemLayerModeActive(),
	"🔴 der gewöhnliche Besucher SIEHT die Ebene -- das ist die Freischaltung vom 2026-08-04");
assert(!besucher.canOperateEcosystemLayers(), "bedienen darf er sie nicht");

const daneben = welt({ modus: "political", recht: true, editor: true });
assert(!daneben.isEcosystemLayerModeActive(), "in einem anderen Kartenmodus ist die Ebene aus");
assert(daneben.canOperateEcosystemLayers(),
	"das Bedienrecht haengt nicht am Kartenmodus -- es gilt auch daneben");

// ---- BEDIENEN braucht ZWEI Dinge: den Editor-Kontext UND das Recht ----------------------------------
// 💣 DER FALL, DER GEMELDET WURDE (Owner 2026-08-04, auf avesmaps.de stehend): angemeldet, alle Rechte,
// aber auf der ÖFFENTLICHEN Karte -- und die Leiste stand trotzdem da. Das Recht allein genügt nicht.
// Die Werkzeuge gehören dem Editor, nicht dem Konto.
const angemeldetImFrontend = welt({ recht: true, editor: false });
assert(angemeldetImFrontend.isEcosystemLayerModeActive(), "er sieht die Ebene wie jeder andere");
assert(!angemeldetImFrontend.canOperateEcosystemLayers(),
	"💣 aber KEIN Bedienfeld auf der oeffentlichen Karte -- egal welches Recht im Hintergrund liegt");
assert(angemeldetImFrontend.isEcosystemShowAllLayers(),
	"und deshalb sieht auch er dort Alle, wie jeder andere");

const imEditorOhneRecht = welt({ recht: false, editor: true });
assert(!imEditorOhneRecht.canOperateEcosystemLayers(),
	"umgekehrt oeffnet `?edit=1` allein gar nichts -- der Parameter ist ungeprueft und war nie der Riegel");

const imEditor = welt({ recht: true, editor: true });
assert(imEditor.canOperateEcosystemLayers(), "erst beides zusammen gibt die Werkzeuge frei");

// ---- „Alle" ist für den Besucher die EINZIGE Ansicht -----------------------------------------------
// 💣 Erzwungen, nicht gespeichert: ohne das Bedienfeld gaebe es keinen Weg, eine andere Ebene zu waehlen.
// Ein Besucher, dessen Browser aus einer frueheren Editor-Sitzung „Vegetation" gemerkt hat, saehe sonst
// eine einzelne Ebene und keine Moeglichkeit, da wieder herauszukommen.
const besucherMitAltemWert = welt({ recht: false, editor: false, gemerktAlle: "0" });
assert(besucherMitAltemWert.isEcosystemShowAllLayers(),
	"💣 der Besucher bekommt IMMER Alle -- auch wenn im Speicher etwas anderes steht");

const editorAlle = welt({ recht: true, editor: true, gemerktAlle: "1" });
assert(editorAlle.isEcosystemShowAllLayers(), "der Editor bekommt, was er zuletzt gewaehlt hat: Alle");
const editorEine = welt({ recht: true, editor: true, gemerktAlle: "0" });
assert(!editorEine.isEcosystemShowAllLayers(), "... oder eben seine eine Arbeitsebene");

// Und jede Ebene ist fuer den Besucher sichtbar -- das ist, was „Alle" bedeutet.
const sichtbar = welt({ recht: false, editor: false });
["derographisch", "vegetation", "topographie", "klima"].forEach((kind) => {
	assert(sichtbar.isEcosystemKindVisible(kind), `in Alle ist ${kind} sichtbar`);
});

// ---- der Untergrund: 25 % fuer den Besucher, sein Regler fuer den Editor ----------------------------
// 💣 Der Besucher bekommt einen FESTEN Wert, nicht den gespeicherten. Der liegt je Browser, und wer
// irgendwann einmal auf 0 gezogen hat, saehe eine leere weisse Karte -- ohne Regler, mit dem er wieder
// herauskaeme. Ein fester Wert ist hier das Gegenteil einer Einschraenkung.
function untergrundWelt({ recht, editor, gespeichert }) {
	const pane = { style: {} };
	const container = { style: {} };
	const context = {
		console,
		window: { localStorage: { getItem: () => gespeichert, setItem: () => {} },
			getComputedStyle: () => ({ getPropertyValue: () => "#ffffff" }) },
		document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {},
			documentElement: {} },
		getComputedStyle: () => ({ getPropertyValue: () => "#ffffff" }),
		getSelectedMapLayerMode: () => "ecosystem",
		IS_ECOSYSTEM_ENABLED: recht,
		IS_EDIT_MODE: editor,
		map: { getPane: (name) => (name === "tilePane" ? pane : null), getContainer: () => container },
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(source, context);
	return { context, pane };
}

const besucherUntergrund = untergrundWelt({ recht: false, editor: false, gespeichert: "0" });
besucherUntergrund.context.applyEcosystemUndergroundOpacity(true);
assert(besucherUntergrund.pane.style.opacity === "0.25",
	"💣 der Besucher bekommt die festen 25 % -- nicht die 0, die in seinem Browser steht: " + besucherUntergrund.pane.style.opacity);

const editorUntergrund = untergrundWelt({ recht: true, editor: true, gespeichert: "40" });
editorUntergrund.context.applyEcosystemUndergroundOpacity(true);
assert(editorUntergrund.pane.style.opacity === "0.4",
	"der Editor bekommt seinen Regler: " + editorUntergrund.pane.style.opacity);

const verlassen = untergrundWelt({ recht: false, editor: false, gespeichert: "0" });
verlassen.context.applyEcosystemUndergroundOpacity(false);
assert(verlassen.pane.style.opacity === "",
	"beim Verlassen ist die Karte wieder ganz da -- sonst bliebe sie in jedem anderen Modus blass");

// ---- Orte treten im Landschaftsmodus zurück -- und kommen zurück ------------------------------------
// 🔴 Der zweite Teil ist der, der weh tut, wenn er fehlt: ohne ihn nähme ein Besuch der Landschaften dem
// Nutzer seine Ortsauswahl DAUERHAFT weg. Er kommt zurück nach „Politisch", seine Metropolen sind fort,
// und nichts sagt ihm, wer sie ausgeschaltet hat.
function schalterWelt() {
	const zustand = { metropole: true, grossstadt: true, stadt: false, kleinstadt: false, dorf: false, gebaeude: false };
	const knopf = (typ) => ({
		hasClass: () => zustand[typ],
		removeClass: () => { zustand[typ] = false; },
		toggleClass: (_klasse, an) => { zustand[typ] = Boolean(an); },
	});
	const context = {
		console,
		window: { localStorage: { getItem: () => "0", setItem: () => {} } },
		document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
		getSelectedMapLayerMode: () => "ecosystem",
		IS_ECOSYSTEM_ENABLED: false,
		IS_EDIT_MODE: false,
		LOCATION_TYPE_VISIBILITY_ORDER: ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"],
		getLocationToggleButton: knopf,
		syncLocationMarkerVisibility: () => {},
		syncLocationToggleButtons: () => {},
	};
	context.globalThis = context;
	vm.createContext(context);
	vm.runInContext(source, context);
	return { context, zustand };
}

const s = schalterWelt();
const sichtbareOrte = () => Object.values(s.zustand).filter(Boolean).length;
assert(sichtbareOrte() === 2, "vorher stehen zwei Ortsstufen auf sichtbar");

s.context.syncEcosystemSettlementVisibility(true);
assert(sichtbareOrte() === 0, "im Landschaftsmodus treten sie zurück");

// 💣 Ein zweiter Durchlauf MITTEN im Modus (die Rechteauskunft trifft ein, der Nutzer wechselt die
// Ebene) darf die inzwischen leere Lage nicht als „das war schon immer so" festschreiben.
s.context.syncEcosystemSettlementVisibility(true);
s.context.syncEcosystemSettlementVisibility(false);
assert(s.zustand.metropole === true && s.zustand.grossstadt === true,
	"💣 beim Verlassen steht die Auswahl von vorher wieder da -- auch nach mehrfachem Eintreten");
assert(s.zustand.stadt === false, "und was aus war, bleibt aus");

// Ausserhalb des Modus zu 'verlassen' ist ein No-op und darf nichts anfassen.
s.zustand.dorf = true;
s.context.syncEcosystemSettlementVisibility(false);
assert(s.zustand.dorf === true, "ohne vorheriges Eintreten wird nichts zurückgesetzt");

if (failures > 0) {
	console.error(`ecosystem-access.test: ${failures} failure(s)`);
	process.exit(1);
}
console.log("ecosystem-access.test: OK -- ansehen darf jeder, bedienen nur der Editor mit Recht");
