"use strict";
// „Weg als Route" (Entwurf 2026-09-14 §5): welche Orte in welcher Reihenfolge -- AUSGEFUEHRT, rein und gegen eine
// kleine Karte; dazu die Kachel und der Klickzweig.
// Aus der Wurzel: node js/routing/__tests__/weg-als-route.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (rel) => fs.readFileSync(path.join(WURZEL, rel), "utf8").replace(/\r\n/g, "\n");
const schneide = (text, anfang, ende) => {
	const a = text.indexOf(anfang);
	const e = a >= 0 ? text.indexOf(ende, a + anfang.length) : -1;
	assert.ok(a >= 0 && e > a, "Ausschnitt fehlt: " + anfang);
	return text.slice(a, e);
};

const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));
Object.assign(global, {
	wpGroupWays: M.wpGroupWays, wpGroupKeyOf: M.wpGroupKeyOf, wpChainSegments: M.wpChainSegments,
	wpAbschnittLabel: M.wpAbschnittLabel, wpGanzeStrecke: M.wpGanzeStrecke, wpGruppeHauptzuweisungen: M.wpGruppeHauptzuweisungen,
	// Der echte Name (map-features-path-domain.js) -- daran haengt die Strasse; die Fixtures tragen ihn in display_name.
	getPathTitleName: (p) => p.properties.display_name,
	escapeHtml: (w) => String(w),
	getPathPublicId: (p) => p.properties.public_id,
	LOCATION_ENDPOINT_EXACT_HIT: 0.01,
	isCrossingLocation: (ort) => ort.kreuzung === true,
	mapDataSourceStatus: { revision: 1 },
	IS_EDIT_MODE: false,
});
Object.assign(global, require(path.join(WURZEL, "js/map-features/weg-abschnitte.js")));
// Attrappe fuer avesmapsWegTraegerIndex (entsteht in weg-weitere-anzeige.js, Task 11): gleiche Bedeutung --
// wiki_key -> Pfade, die den Artikel als WEITERE Zuweisung tragen.
global.avesmapsWegTraegerIndex = () => {
	const nachKey = new Map();
	(Array.isArray(global.pathData) ? global.pathData : []).forEach((pfad) => {
		(Array.isArray(pfad.properties.wiki_path_weitere) ? pfad.properties.wiki_path_weitere : []).forEach((eintrag) => {
			const key = String((eintrag && eintrag.wiki_key) || "");
			if (!key) { return; }
			if (!nachKey.has(key)) { nachKey.set(key, []); }
			nachKey.get(key).push(pfad);
		});
	});
	return nachKey;
};
const R = require(path.join(WURZEL, "js/routing/weg-als-route.js"));

// 1. Rein
const w = (von, bis, a, b) => ({ ends: { from: von, to: bis }, enden: { von: a, bis: b } });
assert.deepStrictEqual(R.avesmapsWegAlsRouteOrte([
	w([0, 0], [1, 0], "Perz", "Silkwiesen"), w([2, 0], [1, 0], "Wieha", "Silkwiesen"), w([2, 0], [3, 0], "Wieha", "Helmdahl"),
]), ["Perz", "Silkwiesen", "Wieha", "Helmdahl"], "ein gedrehter Abschnitt laeuft rueckwaerts mit");
assert.deepStrictEqual(R.avesmapsWegAlsRouteOrte([
	w([0, 0], [1, 0], "Perz", "Silkwiesen"), w([1, 0], [2, 0], "Silkwiesen", "Wieha"), w([10, 0], [3, 0], "Ferne", "Helmdahl"),
]), ["Perz", "Silkwiesen", "Wieha", "Helmdahl", "Ferne"], "ueber die Luecke zum naechsten Ende, das Stueck dafuer umgedreht");
const auslassen = (name) => name === "Kreuzung" || name === "Wegende" || name === "Versteck";
assert.deepStrictEqual(R.avesmapsWegAlsRouteOrte([
	w([0, 0], [1, 0], "Perz", "Kreuzung"), w([1, 0], [2, 0], "Kreuzung", "Versteck"),
	w([2, 0], [3, 0], "Versteck", "Perz"), w([3, 0], [4, 0], "Perz", "Wegende"),
], auslassen), ["Perz"], "Kreuzung, Wegende, Verborgenes fallen weg, und Dopplungen hintereinander auch");
assert.deepStrictEqual(R.avesmapsWegAlsRouteOrte([]), []);
assert.deepStrictEqual(R.avesmapsWegAlsRouteOrte([{ public_id: "ohne" }]), [], "ohne Enden nichts");

// 1b. avesmapsWegAlsRouteAuslassen: Namensindex je Kartenstand -- der ERSTE Ort mit dem Namen entscheidet, wie
// Array.prototype.find es zuvor tat; Kreuzungen, verborgene Orte und die zwei Enden-Konstanten fallen weg.
global.locationData = [
	{ name: "Zwilling", coordinates: [0, 0], isHidden: true },
	{ name: "Zwilling", coordinates: [9, 9], isHidden: false },
	{ name: "Kreuzling", coordinates: [1, 1], kreuzung: true },
	{ name: "Normalo", coordinates: [2, 2] },
];
assert.strictEqual(R.avesmapsWegAlsRouteAuslassen("Zwilling"), true, "der ERSTE Ort mit dem Namen entscheidet -- der ist verborgen");
assert.strictEqual(R.avesmapsWegAlsRouteAuslassen("Kreuzling"), true, "eine Kreuzung faehrt nicht mit");
assert.strictEqual(R.avesmapsWegAlsRouteAuslassen("Normalo"), false, "ein normaler Ort faehrt mit");
assert.strictEqual(R.avesmapsWegAlsRouteAuslassen("Kreuzung"), true, "AVESMAPS_WEG_ENDE_KREUZUNG faellt immer weg");
assert.strictEqual(R.avesmapsWegAlsRouteAuslassen("Wegende"), true, "AVESMAPS_WEG_ENDE_OFFEN faellt immer weg");
assert.strictEqual(R.avesmapsWegAlsRouteAuslassen("Unbekannt"), false, "ein unbekannter Name faehrt mit");

// 2. Gegen eine kleine Karte: der Baerenpfad laeuft ueber den Reichsstrassen-Abschnitt, der ihn als weitere Zuweisung traegt
global.locationData = [
	{ name: "Perz", coordinates: [0, 0] }, { name: "Silkwiesen", coordinates: [0, 1] }, { name: "Wieha", coordinates: [0, 2] },
	{ name: "Helmdahl", coordinates: [0, 3] }, { name: "Rudein", coordinates: [5, 0] }, { name: "Espen", coordinates: [5, 3] },
];
const url = (seite) => "https://de.wiki-aventurica.de/wiki/" + seite;
const RS = { key: "reichsstrasse-2", name: "Reichsstraße 2", seite: "Reichsstrasse_2" };
const BP = { key: "b-renpfad", name: "Bärenpfad", seite: "Baerenpfad" };
const weg = (id, von, bis, haupt, weitere = []) => ({
	properties: { public_id: id, feature_subtype: "Reichsstrasse", name: "M-" + id, display_name: haupt.name,
		wiki_path: { wiki_key: haupt.key, name: haupt.name, wiki_url: url(haupt.seite) }, wiki_path_weitere: weitere },
	geometry: { coordinates: [von, bis] },
});
global.pathData = [
	weg("rs-6", [0, 0], [1, 0], RS),
	weg("rs-7", [1, 0], [2, 0], RS, [{ wiki_key: BP.key, name: BP.name, wiki_url: url(BP.seite) }]),
	weg("rs-8", [2, 0], [3, 0], RS),
	weg("bp-1", [0, 5], [1, 0], BP),
	weg("bp-2", [2, 0], [3, 5], BP),
	weg("x-1", [8, 8], [9, 9], { key: "x", name: "X", seite: "X" }),
];
const [rs6, rs7, rs8, bp1, , x1] = global.pathData;
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(rs6), ["Perz", "Silkwiesen", "Wieha", "Helmdahl"]);
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(bp1), ["Rudein", "Silkwiesen", "Wieha", "Espen"], "der Baerenpfad-Fall (§6 D)");
// 2b. Owner 15.09.2026: die Strasse ist der NAME. Vom gleichnamigen Abschnitt OHNE Zuweisung dieselbe Route -- die Traeger kommen
// aus allen Artikeln der Strasse, nicht aus dem des angeklickten Abschnitts.
// ⚠️ Eine eigene kleine Strasse: beim Baerenpfad schliesst der Lueckensprung die Traeger-Luecke zufaellig selbst (Silkwiesen und
// Wieha sind auch Enden seiner eigenen Abschnitte) -- dort faellt ein fehlender Traeger nicht auf. Hier liefert NUR der Traeger
// „Suedhain".
const GP = { key: "graupfad", name: "Graupfad", seite: "Graupfad" };
const QW = { key: "querweg", name: "Querweg", seite: "Querweg" };
const gp1 = weg("gp-1", [30, 0], [31, 0], GP);
const querweg = weg("qw-1", [31, 0], [32, 0], QW, [{ wiki_key: GP.key, name: GP.name, wiki_url: url(GP.seite) }]);
const gpOhneWiki = weg("gp-2", [40, 40], [41, 41], GP);
gpOhneWiki.properties.wiki_path = null;
global.pathData.push(gp1, querweg, gpOhneWiki);
global.locationData.push({ name: "Nordhain", coordinates: [0, 30] }, { name: "Suedhain", coordinates: [0, 32] });
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(gp1), ["Nordhain", "Suedhain"], "Voraussetzung: vom zugewiesenen Abschnitt ueber den Traeger");
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(gpOhneWiki), ["Nordhain", "Suedhain"],
	"vom gleichnamigen Abschnitt OHNE Zuweisung dieselbe Route -- der Traeger kommt aus dem Artikel der Strasse");
global.pathData.splice(global.pathData.length - 3, 3);
global.locationData.splice(global.locationData.length - 2, 2);

// 3. Editoren: das Markierte -- am Abschnitt nur er
global.IS_EDIT_MODE = true;
global.avesmapsWegAuswahlFuerPfad = (p) => (p === rs7 ? { gruppe: "wiki:reichsstrasse-2", publicId: "rs-7" } : null);
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(rs7), ["Silkwiesen", "Wieha"]);
global.avesmapsWegAuswahlFuerPfad = () => ({ gruppe: "wiki:reichsstrasse-2", publicId: null });
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(rs8), ["Perz", "Silkwiesen", "Wieha", "Helmdahl"], "ganze Strasse markiert: die ganze Strasse");
global.IS_EDIT_MODE = false;

// 4. Verborgene Orte und Kreuzungen werden uebersprungen
global.locationData.find((o) => o.name === "Wieha").isHidden = true;
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(rs6), ["Perz", "Silkwiesen", "Helmdahl"], "ein verborgener Ort heisst wie der Ort -- und wird uebersprungen");
global.locationData.find((o) => o.name === "Silkwiesen").kreuzung = true;
global.mapDataSourceStatus = { revision: 2 };   // neuer Kartenstand: der Ortsindex rechnet neu
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(rs6), ["Perz", "Helmdahl"], "eine Kreuzung heisst „Kreuzung\" und faellt weg");

// 4b. avesmapsWegAlsRouteHatZweiOrte fragt IMMER die ganze Strasse, nie die Editor-Auswahl -- sonst zeigte
// derselbe Abschnitt Besuchern und Editoren eine unterschiedliche Anzahl Kacheln (Regel 2 des Entwurfs).
global.pathData.push(weg("rs-9", [50, 50], [51, 51], RS));
const rs9 = global.pathData[global.pathData.length - 1];
global.IS_EDIT_MODE = true;
global.avesmapsWegAuswahlFuerPfad = (p) => (p === rs9 ? { gruppe: "wiki:reichsstrasse-2", publicId: "rs-9" } : null);
assert.deepStrictEqual(R.avesmapsWegAlsRouteFuerPfad(rs9), [], "der markierte Abschnitt allein liegt zwischen zwei unbekannten Enden");
assert.strictEqual(R.avesmapsWegAlsRouteHatZweiOrte(rs9), true, "die Kachel bleibt bei der Antwort der GANZEN Strasse, trotz kurzer Auswahl");
global.avesmapsWegAuswahlFuerPfad = () => null;
global.IS_EDIT_MODE = false;

// 5. Die Kachel: dieselbe Bedingung wie „Anzeigen", UND ausgeblendet unter zwei Orten (Owner 14.09.2026)
const rendering = lies("js/map-features/map-features-path-rendering.js");
const kachelKontext = vm.createContext({
	popupActionButtonMarkup: (spec) => JSON.stringify(spec),
	pathSupportsItemLinks: (p) => p.properties.feature_subtype !== "Seeweg",
	getPathPublicId: (p) => p.properties.public_id,
	tr: (key, fallback) => fallback,
	avesmapsWegAlsRouteHatZweiOrte: R.avesmapsWegAlsRouteHatZweiOrte,
});
vm.runInContext(schneide(rendering, "function pathWegAktionErlaubt(path) {", "\n// Kopf-Icon fuer den Weg-Kopf"), kachelKontext);
const kachelBauen = vm.runInContext("pathAlsRouteKachelMarkup", kachelKontext);
const kachel = JSON.parse(kachelBauen(rs6));
assert.strictEqual(kachel.label, "Weg als Route");
assert.ok(kachel.iconMarkup.includes('src="img/menu/waypoint-end.webp"'), kachel.iconMarkup);
assert.deepStrictEqual(kachel.attributes, { "data-popup-action": "path-as-route", "data-public-id": "rs-6" });
assert.strictEqual(kachelBauen({ properties: { public_id: "s", feature_subtype: "Seeweg", wiki_path: { wiki_url: url("Meer") } } }), "", "kein Seeweg");
assert.strictEqual(kachelBauen({ properties: { public_id: "o", feature_subtype: "Weg" } }), "", "ohne Wiki-Artikel keine Kachel (§8)");
// Owner 14.09.2026: unter zwei Orten erscheint die Kachel gar nicht -- x-1 liegt allein zwischen zwei
// unbekannten Enden (0 Orte), waehrend rs-6 weiterhin die Kachel traegt (die RS-Strasse hat noch zwei).
assert.strictEqual(R.avesmapsWegAlsRouteHatZweiOrte(x1), false, "die Strasse von x-1 verbindet keine zwei Orte");
assert.strictEqual(kachelBauen(x1), "", "keine Kachel bei einer zu kurzen Strasse (Owner 14.09.2026)");
assert.strictEqual(R.avesmapsWegAlsRouteHatZweiOrte(rs6), true, "die RS-Strasse traegt weiterhin zwei Orte");
assert.notStrictEqual(kachelBauen(rs6), "", "die Kachel bleibt fuer eine ausreichend lange Strasse");
const popup = schneide(rendering, "function createPathPopupMarkup(path) {", "\n// Zeichen-Reihenfolge der Wege");
assert.ok(popup.indexOf("pathAlsRouteKachelMarkup(path)") > popup.indexOf("buildSuggestChangeButtonSpec"), "die Kachel steht nach „Änderungen vorschlagen\" (§5.1)");

// 5b. Die Memoisierung: EINMAL je Strasse, neu erst nach einem Kartenstand-Sprung -- mit einem Spion um die
// ganze-Strasse-Rechnung. Der Zwischenspeicher-Block wird dafuer aus der Quelle geschnitten und mit einer
// Attrappe fuer avesmapsWegAlsRouteGanzeStrasse ausgefuehrt: der Aufruf innerhalb der Datei bindet direkt an den
// Funktionsnamen (kein module.exports-Umweg), ein Spion von aussen kann ihn also nicht ueberschreiben --
// dieselbe vm-Technik wie Abschnitt 5 fuer die Kachel.
const quelle = lies("js/routing/weg-als-route.js");
const memoBlock = schneide(quelle, "let avesmapsWegAlsRouteZweiOrteStand = {", "\nif (typeof module !== \"undefined\"");
let ganzeStrasseAufrufe = 0;
const memoKontext = vm.createContext({
	avesmapsWegAbschnittAufKarte: (p) => (p && p.gruppe ? { gruppe: { key: p.gruppe } } : null),
	avesmapsWegKartenStand: (daten) => String(Array.isArray(daten) ? daten.length : 0),
	avesmapsWegAlsRouteGanzeStrasse: () => { ganzeStrasseAufrufe++; return ["A", "B"]; },
	pathData: [1, 2, 3],
	locationData: [1, 2],
});
vm.runInContext(memoBlock, memoKontext);
const hatZweiOrteMitSpion = vm.runInContext("avesmapsWegAlsRouteHatZweiOrte", memoKontext);
const segmentA = { gruppe: "K1" };
const segmentB = { gruppe: "K1" };
hatZweiOrteMitSpion(segmentA);
hatZweiOrteMitSpion(segmentB);
assert.strictEqual(ganzeStrasseAufrufe, 1, "dieselbe Strasse (zwei Abschnitte derselben Gruppe): nur einmal gerechnet");
hatZweiOrteMitSpion(segmentA);
assert.strictEqual(ganzeStrasseAufrufe, 1, "derselbe Abschnitt noch einmal: immer noch nur einmal gerechnet");
const segmentAndereGruppe = { gruppe: "K2" };
hatZweiOrteMitSpion(segmentAndereGruppe);
assert.strictEqual(ganzeStrasseAufrufe, 2, "eine ANDERE Strasse im selben Kartenstand: eigene Rechnung");
memoKontext.pathData = [1, 2, 3, 4];   // neuer Kartenstand (laengere pathData -- wie nach einem Live-Abgleich)
hatZweiOrteMitSpion(segmentA);
assert.strictEqual(ganzeStrasseAufrufe, 3, "neuer Kartenstand: neu gerechnet, auch fuer eine schon bekannte Gruppe");
memoKontext.locationData = [1, 2, 3];   // Kartenstand der ORTE aendert sich ebenso
hatZweiOrteMitSpion(segmentA);
assert.strictEqual(ganzeStrasseAufrufe, 4, "ein neuer Ortsstand loest ebenso neu aus");

// 6. Der Klickzweig: die Orte ERSETZEN die Wegpunkte (§5.2), ausgefuehrt
const routing = lies("js/routing/routing.js");
const zweig = schneide(routing, 'if (action === "path-as-route") {', "\n\t}\n");
const lauf = [];
const zweigKontext = vm.createContext({
	findPathByPublicId: (id) => global.pathData.find((p) => p.properties.public_id === id) || null,
	avesmapsWegAlsRouteFuerPfad: R.avesmapsWegAlsRouteFuerPfad,
	resetWaypointInputs: (namen) => { lauf.push(["ersetzen", [...namen]]); },
	updateMapView: () => { lauf.push(["rechnen"]); },
	showFeedbackToast: (text) => { lauf.push(["meldung", text]); },
	tr: (key, fallback) => fallback,
});
const klicke = vm.runInContext("(function (action) {\n\t" + zweig + "\n\t}\n})", zweigKontext);
klicke.call({ dataset: { publicId: "rs-6" } }, "path-as-route");
assert.deepStrictEqual(lauf, [["ersetzen", ["Perz", "Helmdahl"]], ["rechnen"]]);
lauf.length = 0;
klicke.call({ dataset: { publicId: "x-1" } }, "path-as-route");
assert.deepStrictEqual(lauf, [["meldung", "Dieser Weg verbindet keine zwei Orte."]], "unter zwei Orten wird nichts ersetzt");

// 7. Englisch und Ladereihenfolge
const en = lies("js/app/i18n-en.js");
assert.ok(en.includes('"popup.pathAsRoute": "Way as route",'), "i18n popup.pathAsRoute");
assert.ok(en.includes('"toast.path.asRouteTooShort": "This way does not connect two places.",'), "i18n toast.path.asRouteTooShort");
const seite = lies("index.html").replace(/<!--[\s\S]*?-->/g, "");
const tag = seite.indexOf('<script src="js/routing/weg-als-route.js"></script>');
assert.ok(tag > 0 && tag > seite.indexOf('<script src="js/map-features/weg-abschnitte.js"></script>'), "index.html laedt weg-als-route.js nach dem Weg-Abschnittsnamen-Modul");

console.log("weg-als-route.test.js: ok");
