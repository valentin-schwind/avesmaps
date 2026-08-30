// „Eingefügt wird" -- die Einzelansicht zeigt, welche Einstellungen die Fläche/der Ort/das
// Label wirklich bekäme (Owner 30.08.2026, nach dem Schadensfall „3000 Labels ab Zoom 0").
//
// 🔴 SEIT 30.08.2026 SIND DIE FELDER DER FLÄCHE/BESCHRIFTUNG ECHTE EINGABEFELDER (Owner, wörtlich:
// "ich hatte plötzlich 3000 labels da stehen ... WARUM DARF ICH DAS NICHT VERÄNDERN?" --
// "einstellbar" heißt: hier, im Kasten, vor dem Einfügen). Ort und Weg bleiben reine Anzeige
// (garetienEingefuegtWirdZeileMitHinweis) -- dort speichert der Import ohnehin nichts von alledem.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/garetien-eingefuegt-wird.test.js
//
// 🔴 Geprueft wird DIFFERENTIELL (die Falle der Vakuum-Zusicherung): zwei verschiedene Arten
// muessen verschiedene Zahlen zeigen, und Flaeche/Ort/Label muessen verschiedene Abschnitte
// zeigen -- eine Zusicherung, die nur prueft, DASS eine Zeile im Markup steht, prueft nichts.
// 🪤 Und ein Test, der nur prueft, dass ein `<input>` im Markup steht, prueft ebenfalls nichts --
// die Abschnitte C/D/I/J/K unten pruefen deshalb den WERT des Feldes, seinen ZUSTAND (aktiviert/
// deaktiviert) und was eine EINGABE am geteilten Zustand bewegt, nie nur seine Anwesenheit.
//
// 💣 `hasDocument` wird beim LADEN von review-garetien-importer.js ausgewertet
// (`typeof document !== "undefined"`) -- `global.document` muss deshalb VOR dem `require` stehen
// (Vorbild: garetien-fussknopf-dom.test.js).

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");

let checks = 0;
function wahr(bedingung, warum) {
	assert.ok(bedingung, warum || "");
	checks++;
}
function gleich(ist, soll, warum) {
	assert.strictEqual(ist, soll, warum || "");
	checks++;
}

// ---- Das gefaelschte `document`/`window` -- VOR jedem vm.runInThisContext-Laden, weil config.js
// beim Laden selbst schon document.documentElement.classList.add(...) ruft (IS_INFOPANEL_MODE).
//
// ⚠️ Absichtlich mager, wie im Vorbild (garetien-fussknopf-dom.test.js): nur die Elemente, die
// dieser Ablauf wirklich anfasst. Ein `<input>` bekommt zusaetzlich `disabled`/`checked`/`value`
// -- die drei Eigenschaften, die garetienEingabenAendern wirklich anfasst.
function macheElement(id) {
	return {
		id: id, hidden: false, innerHTML: "", textContent: "",
		disabled: false, checked: false, value: "",
		addEventListener() {},
		querySelectorAll() { return []; },
		querySelector() { return null; },
		getAttribute() { return null; },
		classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
	};
}

const ELEMENTE = {};
["garetien-detailcol", "garetien-list"].forEach((id) => { ELEMENTE[id] = macheElement(id); });

global.document = {
	documentElement: { classList: { add() {}, remove() {} } },
	readyState: "complete",
	getElementById(id) { return ELEMENTE[id] || null; },
	addEventListener() {},
	querySelectorAll() { return []; },
};
global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };

// ---- Die Vorgabetafeln, ECHT geladen (kein Abschreiben ihrer Zahlen) ---------------------------
//
// 🔴 `vm.runInThisContext` haengt Funktionsdeklarationen an das ECHTE globale Objekt (dieselbe
// Begruendung wie in ecosystem-display-vorgabe.test.js) -- review-garetien-importer.js findet
// `avesmapsEcosystemDisplayVorgabe` & Co. danach als blanke Bezeichner, genau wie im Browser
// (index.html laedt ecosystem-display.js UND location-zoom-bands.js VOR dieser Datei).
vm.runInThisContext(
	fs.readFileSync(path.join(WURZEL, "js/map-features/ecosystem-display.js"), "utf8"),
	{ filename: "ecosystem-display.js" }
);
vm.runInThisContext(
	fs.readFileSync(path.join(WURZEL, "js/map-features/location-zoom-bands.js"), "utf8"),
	{ filename: "location-zoom-bands.js" }
);
// Owner-Nachtrag 30.08.2026 ("vergiss nicht die andern einstellungen aus 'Weg bearbeiten' ..."):
// dieselbe Regel gilt fuer die Verkehrsmittel-Vorauswahl eines Weges. Ladereihenfolge exakt wie in
// js/review/__tests__/path-transport-options.test.js (dem bestehenden Vorbild fuer genau dieses
// Dateipaar) -- config.js braucht map-features-line-catmull.js VOR sich (AVESMAPS_CATMULL_DEFAULTS),
// map-features-path-domain.js braucht config.js VOR sich (TRANSPORT_DOMAIN_OPTIONS).
vm.runInThisContext(
	fs.readFileSync(path.join(WURZEL, "js/map-features/map-features-line-catmull.js"), "utf8"),
	{ filename: "map-features-line-catmull.js" }
);
vm.runInThisContext(
	fs.readFileSync(path.join(WURZEL, "js/config.js"), "utf8"),
	{ filename: "config.js" }
);
vm.runInThisContext(
	fs.readFileSync(path.join(WURZEL, "js/map-features/map-features-path-domain.js"), "utf8"),
	{ filename: "map-features-path-domain.js" }
);

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const {
	garetienEingefuegtWirdHatVorschlag,
	garetienEingefuegtWirdMarkup,
	garetienEingefuegtWirdZeileMitHinweis,
	garetienWikiLandschaftZeileText,
	garetienWikiLandschaftPlatzhalterId,
	garetienDetailWaehlen,
	garetienEingabenZustandZu,
	garetienEingabenGrundwerte,
	garetienEingabenAendern,
	garetienEingabenFuerServer,
	garetienEingabeId,
} = mod;

wahr(typeof garetienEingefuegtWirdHatVorschlag === "function", "garetienEingefuegtWirdHatVorschlag fehlt im Export");
wahr(typeof garetienEingefuegtWirdMarkup === "function", "garetienEingefuegtWirdMarkup fehlt im Export");
wahr(typeof garetienEingefuegtWirdZeileMitHinweis === "function", "garetienEingefuegtWirdZeileMitHinweis fehlt im Export");
wahr(typeof garetienWikiLandschaftZeileText === "function", "garetienWikiLandschaftZeileText fehlt im Export");
wahr(typeof garetienEingabenZustandZu === "function", "garetienEingabenZustandZu fehlt im Export");
wahr(typeof garetienEingabenGrundwerte === "function", "garetienEingabenGrundwerte fehlt im Export");
wahr(typeof garetienEingabenAendern === "function", "garetienEingabenAendern fehlt im Export");
wahr(typeof garetienEingabenFuerServer === "function", "garetienEingabenFuerServer fehlt im Export");
wahr(typeof garetienEingabeId === "function", "garetienEingabeId fehlt im Export");
// Die geteilte Verkehrsmittel-Regel muss als blanker Bezeichner ankommen -- sonst wuerde die
// nachfolgende Rechnung der Erwartungswerte (2 von 2 / 5 von 6 / 6 von 6) selbst zur Vakuum-Probe.
wahr(typeof getDefaultAllowedTransportsForPathSubtype === "function",
	"getDefaultAllowedTransportsForPathSubtype (map-features-path-domain.js) wurde nicht geladen");
wahr(typeof getTransportOptionsForPathSubtype === "function",
	"getTransportOptionsForPathSubtype (map-features-path-domain.js) wurde nicht geladen");

// Ein kleiner Helfer fuer die Eingabefeld-Zusicherungen unten: liest `value="X"` fuer eine
// gegebene Feld-id aus dem Markup -- ROBUSTER als ein reiner `includes()`-Test, weil er die
// Attributgrenze wirklich prueft (ein Treffer mitten in einem ANDEREN Attribut waere ein
// Fehlalarm).
function eingabeWert(markup, id) {
	const treffer = new RegExp('id="' + id + '"[^>]*value="([^"]*)"').exec(markup)
		|| new RegExp('value="([^"]*)"[^>]*id="' + id + '"').exec(markup);
	return treffer ? treffer[1] : null;
}
function istAngehakt(markup, id) {
	const re = new RegExp('id="' + id + '"[^>]*>');
	const treffer = re.exec(markup);
	return treffer ? treffer[0].includes("checked") : null;
}
function istDeaktiviert(markup, id) {
	const re = new RegExp('id="' + id + '"[^>]*>');
	const treffer = re.exec(markup);
	return treffer ? treffer[0].includes("disabled") : null;
}

// =================================================================================================
// A. garetienEingefuegtWirdHatVorschlag -- die Torfrage
// =================================================================================================

gleich(garetienEingefuegtWirdHatVorschlag(null), false, "kein Objekt -> kein Vorschlag");
gleich(garetienEingefuegtWirdHatVorschlag({ items: [] }), false, "keine Items -> kein Vorschlag");
gleich(garetienEingefuegtWirdHatVorschlag({
	items: [{ change_type: "changed" }],
}), false, "nur 'changed'-Items (reine Ergaenzung an einem VORHANDENEN Objekt) -> kein Einfuegen");
gleich(garetienEingefuegtWirdHatVorschlag({
	items: [{ change_type: "changed" }, { change_type: "new", anlass: "zusatz" }],
}), true, "ein Zusatz-Item ('new') macht daraus einen Einfuege-Kandidaten -- egal, was daneben steht");

// =================================================================================================
// B. garetienEingefuegtWirdMarkup(null) / ohne Vorschlag -- KEIN Kasten
// =================================================================================================

gleich(garetienEingefuegtWirdMarkup(null), "", "ohne Objekt gibt es keinen Kasten");
gleich(garetienEingefuegtWirdMarkup({ items: [] }), "", "ohne Vorschlag gibt es keinen Kasten -- eine "
	+ "Ueberschrift ueber nichts ist keine Auskunft (dieselbe Regel wie bei garetienQuellenMarkup)");

// =================================================================================================
// C. Eine FLAECHE (ziel='region') -- Owner-Beispiel Huegel -> huegelland, ALLE SIEBEN Felder als
//    ECHTE Eingabefelder, vorbelegt mit der Vorgabe der Art bzw. dem Grundwert.
// =================================================================================================

const huegel = {
	key: "ggp:Berge:Huegel:Garetien:Testhuegel", name: "Testhuegel", typ: "Huegel",
	subtyp: "huegelland", kind: "topographie", ziel: "region", wiki: "ggp",
	quelle: { label: "Briefspiel (Garetien)", attribution: "VolkoV / garetien.de",
		license: "cc-by-nc-sa-3.0", source_type: "briefspiel" },
	abschnitte: [],
	items: [{ id: 1, change_type: "new", anlass: null }],
};
const mHuegel = garetienEingefuegtWirdMarkup(huegel);

wahr(mHuegel.includes("Eingefügt wird"), "die Ueberschrift fehlt");
wahr(mHuegel.includes("Huegel (garetien.de) → huegelland (Avesmaps)"),
	"die Kopfzeile nennt ihren Typ und unseren Zielsubtyp, wie im Kopf der Einzelansicht");

// ---- Fläche: "für Klicks gesperrt" ist ein ECHTES Häkchen, vorbelegt UNGEHAKT (kein Grundwert
// der Art dafuer -- eine reine Karteneigenschaft, siehe die Begruendung an
// garetienEingefuegtWirdFlaecheMarkup).
wahr(mHuegel.includes("Fläche"), "die Flaechen-Unterueberschrift fehlt");
wahr(mHuegel.includes("für Klicks gesperrt"), '"für Klicks gesperrt" fehlt');
const idGesperrt = garetienEingabeId(huegel, "isLocked");
wahr(mHuegel.includes('id="' + idGesperrt + '"') && mHuegel.includes('type="checkbox"'),
	'"für Klicks gesperrt" muss ein ECHTES Häkchen sein, keine reine Anzeige');
gleich(istAngehakt(mHuegel, idGesperrt), false, "vorbelegt UNGEHAKT (Grundwert 'aus')");

// ---- Beschriftung: die VIER Zahlenfelder sind ECHTE <input>s, vorbelegt mit dem Grundwert
// (huegelland traegt in dieser Fixture KEINE gespeicherte Admin-Uebersteuerung).
const idGroesse = garetienEingabeId(huegel, "size");
const idPrio = garetienEingabeId(huegel, "priority");
const idAb = garetienEingabeId(huegel, "minZoom");
const idBis = garetienEingabeId(huegel, "maxZoom");
wahr(mHuegel.includes("Größe") && mHuegel.includes('id="' + idGroesse + '"'), "das Größenfeld fehlt");
gleich(eingabeWert(mHuegel, idGroesse), "18", "die echte Groesse (Grundwert) fehlt als Feldwert");
wahr(mHuegel.includes("Priorität") && mHuegel.includes('id="' + idPrio + '"'), "das Prioritätsfeld fehlt");
gleich(eingabeWert(mHuegel, idPrio), "3", "die echte Prioritaet fehlt als Feldwert");
wahr(mHuegel.includes("Sichtbar ab Zoom") && mHuegel.includes('id="' + idAb + '"'), "das Ab-Zoom-Feld fehlt");
// 'huegelland' hat eine GEMESSENE Vorgabe (ab=3, AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE_JE_ART) -- die
// Vorbelegung nutzt die VOLLE Vorgabe der Art, nicht nur den uniformen Grundwert 0.
gleich(eingabeWert(mHuegel, idAb), "3", "die Vorbelegung des Start-Zooms (3, gemessene Vorgabe der Art) fehlt");
wahr(mHuegel.includes("Sichtbar bis Zoom") && mHuegel.includes('id="' + idBis + '"'), "das Bis-Zoom-Feld fehlt");
// 'huegelland' setzt kein eigenes "bis" -- das faellt auf den GRUNDWERT DER TAFEL (7), nicht auf
// den Grundwert der Feature-Anlage (5).
gleich(eingabeWert(mHuegel, idBis), "7", "die Vorbelegung des End-Zooms (7, Grundwert der Tafel) fehlt");

// ---- 🔴 KEIN HINWEIS "Vorgabe der Art wäre ... der Import setzt sie nicht" MEHR -- der ganze
// Sinn dieses Umbaus ist, dass der Import JEDEN im Kasten stehenden Wert setzt. Dieser Satz war
// die Falschaussage, die den Schadensfall ausgelöst hat; er darf nirgendwo mehr vorkommen.
wahr(!mHuegel.includes("der Import setzt sie nicht"),
	'die Falschaussage "der Import setzt sie nicht" darf nirgendwo mehr stehen: ' + mHuegel);

// ---- Kurvenbeschreibung: EIN Häkchen (vorbelegt "aus", kein Grundwert der Art dafuer) + EIN
// Zahlenfeld fuer die Anzahl, das SOLANGE deaktiviert ist, wie das Häkchen aus ist ("mit Anzahl
// wenn an" -- Auftrag).
wahr(mHuegel.includes("Kurvenbeschreibung"), "die Kurvenbeschreibungs-Zeile fehlt");
const idKurve = garetienEingabeId(huegel, "curveLabel");
const idKurveMax = garetienEingabeId(huegel, "curveLabelMax");
wahr(mHuegel.includes('id="' + idKurve + '"') && mHuegel.includes('type="checkbox"'),
	"die Kurvenbeschreibung muss ein ECHTES Häkchen sein");
gleich(istAngehakt(mHuegel, idKurve), false, "vorbelegt UNGEHAKT (kein Grundwert der Art dafür)");
wahr(mHuegel.includes('id="' + idKurveMax + '"'), "das Anzahl-Feld fehlt");
gleich(istDeaktiviert(mHuegel, idKurveMax), true, "die Anzahl ist deaktiviert, solange die Kurve aus ist");

// ---- Auf Karte anzeigen: EIN Häkchen, vorbelegt ANGEHAKT (Grundwert show_name=true).
wahr(mHuegel.includes("Auf Karte anzeigen"), "die Zeile fehlt");
const idAnzeigen = garetienEingabeId(huegel, "showName");
wahr(mHuegel.includes('id="' + idAnzeigen + '"') && mHuegel.includes('type="checkbox"'),
	'"Auf Karte anzeigen" muss ein ECHTES Häkchen sein');
gleich(istAngehakt(mHuegel, idAnzeigen), true, "vorbelegt ANGEHAKT (Grundwert 'an')");

// ---- DIFFERENZIELL: eine ANDERE Art zeigt eine ANDERE Empfehlung (sonst waere die Tafel nicht
// wirklich angeschlossen, sondern eine feste Zeichenkette). 'see' empfiehlt ab=4, nicht 0/3.
const see = Object.assign({}, huegel, { key: "ggp:Gewaesser:See:Garetien:Testsee",
	subtyp: "see", kind: "topographie", typ: "See" });
const mSee = garetienEingefuegtWirdMarkup(see);
gleich(eingabeWert(mSee, garetienEingabeId(see, "minZoom")), "4",
	"'see' hat eine ANDERE Vorbelegung (4) als 'huegelland' (3), sonst waere es Vakuum");

// ---- Wiki und Quellen: die Quelle zieht HIERHER (nicht mehr als eigener Abschnitt danach) ------
wahr(mHuegel.includes("Wiki und Quellen"), "die Unterueberschrift fehlt");
wahr(mHuegel.includes("Die Quelle, die mitreist"), "die Quelle muss weiterhin irgendwo stehen");
wahr(mHuegel.includes("Briefspiel (Garetien)"), "die Quellen-Beschriftung fehlt");

// ---- Wiki-Landschaft: der Platzhalter steht synchron da, mit dem echten Objektschluessel -------
const platzhalterId = garetienWikiLandschaftPlatzhalterId(huegel);
wahr(mHuegel.includes('id="' + platzhalterId + '"'), "der Platzhalter fuer die Wiki-Landschaft fehlt");
wahr(mHuegel.includes("Wiki-Landschaft"), "die Zeilenbeschriftung fehlt");
wahr(mHuegel.includes("wird gesucht"), "der Platzhalter muss synchron einen Wartezustand zeigen "
	+ "(die echte Suche laeuft erst async ueber die Aktion 'wiki_landschaft')");

// =================================================================================================
// D. Ein BERGGIPFEL (ziel='label') -- KEINE Flaeche, KEINE Kurvenbeschreibung, KEIN Wiki-Landschaft,
//    aber die VIER Zahlenfelder + "Auf Karte anzeigen" GENAUSO editierbar wie bei der Fläche.
// =================================================================================================

const gipfel = {
	key: "ggp:Berge:Berg:Garetien:Testgipfel", name: "Testgipfel", typ: "Berg",
	subtyp: "berggipfel", kind: "", ziel: "label", wiki: "ggp", abschnitte: [],
	items: [{ id: 2, change_type: "new" }],
};
const mGipfel = garetienEingefuegtWirdMarkup(gipfel);
wahr(!mGipfel.includes("Fläche"), "ein Berggipfel ist keine Region -- kein Klick-Sperr-Abschnitt");
wahr(mGipfel.includes("Beschriftung"), "ein Berggipfel IST ein Label -- die Beschriftungszeilen gelten");
// Owner-Entscheid 27.08.2026 (ecosystem-display.js): Berggipfel empfehlen ab=4.
gleich(eingabeWert(mGipfel, garetienEingabeId(gipfel, "minZoom")), "4",
	"Berggipfel empfehlen Zoom 4 (Owner-Entscheid) -- muss als Feldwert stehen");
wahr(!mGipfel.includes("Kurvenbeschreibung"),
	"ein Berggipfel-Label haengt an KEINER ecosystem_region -- keine Kurvenbeschreibung");
wahr(!mGipfel.includes('id="' + garetienEingabeId(gipfel, "isLocked") + '"'),
	"ein Berggipfel kennt kein 'für Klicks gesperrt' -- das gehört der Region");
wahr(!mGipfel.includes("Wiki-Landschaft"),
	"Wiki-Landschaft ist ein Regions-Konzept -- ein Berggipfel bekommt die Zeile nicht");
wahr(mGipfel.includes("Auf Karte anzeigen") && mGipfel.includes('id="' + garetienEingabeId(gipfel, "showName") + '"'),
	'"Auf Karte anzeigen" gilt auch fuer ein Label ohne Flaeche');

// =================================================================================================
// E. Ein ORT (ziel='location') -- FESTE Klassentafel, kein Einstellwert des Imports, UND (Owner-
//    Nachtrag 30.08.2026) die sechs Karteifelder von "Ort bearbeiten", die der Import nie fuellt.
//    UNVERÄNDERT reine Anzeige -- die Recherche ergab, dass ein Ort keines dieser Felder speichert.
// =================================================================================================

const ort = {
	key: "ggp:Sonstiges:Dorf:Garetien:Testdorf", name: "Testdorf", typ: "Dorf",
	subtyp: "dorf", kind: "", ziel: "location", wiki: "ggp", abschnitte: [],
	items: [{ id: 3, change_type: "new" }],
};
const mOrt = garetienEingefuegtWirdMarkup(ort);
wahr(!mOrt.includes("Fläche") && !mOrt.includes("class=\"gi-insert__sub\">Beschriftung<") && !mOrt.includes("Weg anzeigen"),
	"ein Ort hat weder Flaechen- noch Beschriftungs- noch Weg-Einstellwerte -- die Karte zeichnet ihn "
	+ "aus der Ortsklassen-Tafel, nicht aus properties_json");
wahr(mOrt.includes("Ort"), "die Ort-Unterueberschrift fehlt");
wahr(!mOrt.includes('type="checkbox"') && !mOrt.includes('type="number"'),
	"ein Ort bekommt KEIN einziges Eingabefeld -- die Recherche ergab, dass hier nichts speicherbar ist");
// 'dorf' im Marker-Band: [null, null, 1.33, ...] -- die erste gefuellte Zelle ist Index 2.
wahr(mOrt.includes("erscheint ab Zoom 2"),
	"die feste Klassentafel (location-zoom-bands.js) muss den ECHTEN Bandwert zeigen, nicht geraten");
wahr(mOrt.includes("kein Einstellwert dieses Imports"),
	"die Zeile muss sagen, dass hier gar nichts vom Import kommt");

// ---- DIFFERENZIELL: eine ANDERE Ortsklasse zeigt eine ANDERE Zoomstufe. 'stadt': [1.33, ...] --
// die erste gefuellte Zelle ist Index 0.
const stadt = Object.assign({}, ort, { key: "ggp:Sonstiges:Stadt:Garetien:Teststadt", subtyp: "stadt" });
wahr(garetienEingefuegtWirdMarkup(stadt).includes("erscheint ab Zoom 0"),
	"'stadt' erscheint ab Zoom 0 -- eine andere Zahl als 'dorf' (2), sonst waere es Vakuum");

// ---- Owner-Nachtrag 30.08.2026: die sechs uebrigen Karteifelder von "Ort bearbeiten"
// (avesmapsCreatePointFeature, features.php) -- KEINE Art-Tafel dahinter, deshalb der echte Wert
// ohne "Vorgabe der Art waere ...".
wahr(mOrt.includes("Art") && /Art[\s\S]{0,40}\(keine gesetzt\)/.test(mOrt),
	"place_kind kommt vom Import nie mit -- muss als 'keine gesetzt' stehen");
wahr(/Ort ist ein Nodix[\s\S]{0,40}\(aus\)/.test(mOrt), "is_nodix ist beim Import immer aus");
wahr(/Ruine\/zerstört[\s\S]{0,40}\(aus\)/.test(mOrt), "is_ruined ist beim Import immer aus");
wahr(/Verborgen[\s\S]{0,40}\(aus\)/.test(mOrt), "is_hidden ist beim Import immer aus");
wahr(/Einwohner · Lage · Herrscher[\s\S]{0,40}\(keine Angabe\)/.test(mOrt),
	"einwohner/lage/oberhaupt kommen vom Import nie mit");
// Keine "Vorgabe der Art"-Behauptung -- fuer diese sechs Felder gibt es keine Tafel, eine erfundene
// Empfehlung waere die zweite Wahrheit, vor der AGENTS.md warnt.
wahr(!mOrt.includes("Vorgabe der Art wäre"),
	"der Ort-Abschnitt darf keine Art-Empfehlung behaupten, die es nicht gibt");

// =================================================================================================
// F. Ein WEG (ziel='path') -- Owner-Nachtrag 30.08.2026: "vergiss nicht die andern einstellungen
//    aus 'Weg bearbeiten'". Vier Zeilen: Weg anzeigen, Jahreszeiten, Verkehrsmittel, und (nur bei
//    einem Flussweg) Stroemung. UNVERÄNDERT reine Anzeige.
// =================================================================================================

const weg = {
	key: "ggp:Gewaesser:Fluss:Garetien:Testfluss", name: "Testfluss", typ: "Fluss",
	subtyp: "Flussweg", kind: "", ziel: "path", wiki: "ggp", abschnitte: [],
	quelle: { label: "Briefspiel (Garetien)" },
	items: [{ id: 4, change_type: "new" }],
};
const mWeg = garetienEingefuegtWirdMarkup(weg);
wahr(!mWeg.includes("Fläche") && !mWeg.includes("class=\"gi-insert__sub\">Beschriftung<")
	&& !mWeg.includes('class="gi-insert__sub">Ort<'),
	"ein Weg bekommt keinen der drei ANDEREN Kartenobjekt-Unterabschnitte");
wahr(mWeg.includes('class="gi-insert__sub">Weg<'), "die Weg-Unterueberschrift fehlt");
wahr(!mWeg.includes('type="checkbox"') && !mWeg.includes('type="number"'),
	"ein Weg bekommt KEIN einziges Eingabefeld -- die Recherche ergab, dass hier nichts speicherbar ist");
wahr(mWeg.includes("Wiki und Quellen") && mWeg.includes("Die Quelle, die mitreist"),
	"Quelle bleibt fuer JEDES Ziel gueltig, auch fuer einen Weg");
wahr(!mWeg.includes("Wiki-Landschaft"), "Wiki-Landschaft gilt nur Regionen, nicht Wegen");

// ---- "Weg anzeigen" (show_label) -- der Import setzt es nie, IMMER "aus".
wahr(/Weg anzeigen \(Name auf der Karte\)[\s\S]{0,140}\(aus\)/.test(mWeg),
	"show_label ist beim Import immer aus (avesmapsCreatePathFeature liest show_label ?? false)");
wahr(mWeg.includes("zuletzt im Wege-Editor benutzte Einstellung"),
	"die Zeile muss die Praxis nennen (von Hand gezeichnete Wege erben die letzte Sitzungseinstellung)");

// ---- "Jahreszeiten" (transport_seasons) -- der Import setzt es nie, IMMER "ganzjährig".
wahr(/Jahreszeiten \(Gangbarkeit\)[\s\S]{0,60}\(ganzjährig\)/.test(mWeg),
	"transport_seasons kommt vom Import nie mit -- muss als ganzjaehrig/unbeschraenkt stehen");

// ---- "Verkehrsmittel" -- ECHT aus der geteilten Regel gerechnet (kein Abschreiben ihrer Zahlen),
// DIFFERENTIELL ueber drei Wegarten: Flussweg (2 von 2), Pfad (5 von 6, ohne Kutsche), Strasse
// (6 von 6). Dieselbe Regel, die avesmapsReadAllowedTransports serverseitig anwendet, wenn der
// Import (wie tatsaechlich) kein allowed_transports mitschickt.
function verkehrsmittelZeile(subtyp) {
	const erlaubt = getDefaultAllowedTransportsForPathSubtype(subtyp).length;
	const angeboten = getTransportOptionsForPathSubtype(subtyp).length;
	return { erlaubt: erlaubt, angeboten: angeboten };
}

const vmFlussweg = verkehrsmittelZeile("Flussweg");
gleich(vmFlussweg.erlaubt, 2, "Flussweg erlaubt beide Fluss-Verkehrsmittel");
gleich(vmFlussweg.angeboten, 2, "Flussweg bietet nur die zwei Fluss-Verkehrsmittel an");
wahr(mWeg.includes("Verkehrsmittel") && mWeg.includes("(2 von 2 für diese Wegart möglichen)"),
	"die echte Verkehrsmittel-Zahl fuer Flussweg (2 von 2) fehlt");

const pfad = Object.assign({}, weg, { key: "ggp:Wege:Pfad:Garetien:Testpfad", subtyp: "Pfad", typ: "Pfad" });
const mPfad = garetienEingefuegtWirdMarkup(pfad);
const vmPfad = verkehrsmittelZeile("Pfad");
gleich(vmPfad.erlaubt, 5, "Pfad laesst die Kutsche standardmaessig unangehakt (5 von 6)");
gleich(vmPfad.angeboten, 6, "Pfad BIETET die Kutsche an, waehlt sie nur nicht vor");
wahr(mPfad.includes("(5 von 6 für diese Wegart möglichen)"),
	"'Pfad' zeigt eine ANDERE Verkehrsmittel-Zahl als 'Flussweg' -- sonst waere es Vakuum");

const strasse = Object.assign({}, weg, { key: "ggp:Wege:Strasse:Garetien:Teststrasse", subtyp: "Strasse", typ: "Strasse" });
const mStrasse = garetienEingefuegtWirdMarkup(strasse);
wahr(mStrasse.includes("(6 von 6 für diese Wegart möglichen)"),
	"'Strasse' erlaubt alle sechs Land-Verkehrsmittel -- eine DRITTE Zahl, sonst waere es Vakuum");

// ---- "Strömung" (flow_direction) -- NUR bei einem Flussweg, sonst gar keine Zeile.
wahr(/Strömung \(Flussrichtung\)[\s\S]{0,60}\(unbekannt\)/.test(mWeg),
	"ein Flussweg muss die Stroemungszeile mit 'unbekannt' zeigen (flow kommt vom Import nie mit)");
wahr(mWeg.includes("Flussrichtung unbekannt"),
	"die Zeile muss auf den Wege-Editor-Reiter verweisen, unter dem sich die Richtung setzen laesst");
wahr(!mPfad.includes("Strömung") && !mStrasse.includes("Strömung"),
	"ein Pfad/eine Strasse fuehrt keine Stroemung -- die Zeile darf dort gar nicht erscheinen");

// =================================================================================================
// G. garetienWikiLandschaftZeileText -- die vier Urteile, wortgetreu zur Bestellung
// =================================================================================================

gleich(garetienWikiLandschaftZeileText({ status: "passt", name: "Huegel", art: "Hügelland" }),
	"„Huegel\" (Hügelland) — Name und Art passen");
wahr(garetienWikiLandschaftZeileText({ status: "warnung", name: "Huegel", art: "Küste" }).startsWith("!"),
	'Owner-Wortlaut: "typ nicht gefunden -> ausrufezeichen" -- das "!" muss am Anfang stehen');
gleich(garetienWikiLandschaftZeileText({ status: "kein_treffer", name: "", art: "" }),
	"kein automatischer Treffer nach Namen");
gleich(garetienWikiLandschaftZeileText({ status: "mehrdeutig", name: "", art: "" }),
	"mehrere gleichnamige Wiki-Artikel — keine sichere Zuordnung");

// =================================================================================================
// G2. Eine gespeicherte ADMIN-UEBERSTEUERUNG (Fenster "Landschaften -> Darstellung") schlägt sich
//     im VORBELEGTEN Feldwert nieder -- und eine UNGUELTIGE Uebersteuerung faellt auf den
//     Grundwert zurueck, statt eine kaputte Vorbelegung anzuzeigen.
// =================================================================================================

// ---- G2.1: eine VOLLSTAENDIGE, gueltige Uebersteuerung fuer 'huegelland'.
avesmapsEcosystemDisplayInstall({
	vorgabe: { huegelland: { ab: 2, bis: 6, prio: 4 } },
	groesse: { huegelland: [10, 11, 12, 13, 14, 25, 26, 27, 28] },
});
// 🔴 Ein NEUER Objektschluessel -- derselbe `huegel.key` traegt seit Abschnitt C schon einen
// Eingabezustand (per Vorbelegung angelegt); ein zweiter Zugriff auf DENSELBEN Schluessel wuerde
// diesen bereits BESTEHENDEN Zustand liefern, nicht neu vorbelegen (das ist die Regel, die
// Abschnitt I unten prueft) -- und diese Zeile prüfte dann fälschlich nichts über die Tafel.
const huegelUebersteuert = Object.assign({}, huegel, { key: "ggp:Berge:Huegel:Garetien:Testhuegel-2" });
const mHuegelUebersteuert = garetienEingefuegtWirdMarkup(huegelUebersteuert);
gleich(eingabeWert(mHuegelUebersteuert, garetienEingabeId(huegelUebersteuert, "size")), "25",
	"die Uebersteuerung setzt die Vorbelegung der Groesse auf ihren z5-Wert 25: " + mHuegelUebersteuert);
gleich(eingabeWert(mHuegelUebersteuert, garetienEingabeId(huegelUebersteuert, "priority")), "4",
	"die Uebersteuerung setzt die Vorbelegung der Prioritaet auf 4");
gleich(eingabeWert(mHuegelUebersteuert, garetienEingabeId(huegelUebersteuert, "minZoom")), "2",
	"die Uebersteuerung setzt die Vorbelegung des Start-Zooms auf 2");
gleich(eingabeWert(mHuegelUebersteuert, garetienEingabeId(huegelUebersteuert, "maxZoom")), "6",
	"die Uebersteuerung setzt die Vorbelegung des End-Zooms auf 6");

// ---- G2.2: die GEGENPROBE -- eine ANDERE Art ohne eigene Uebersteuerung bleibt beim Grundwert.
// Ohne diese Zeile prüfte G2.1 nicht, ob die Uebersteuerung wirklich an der ART haengt, statt den
// Grundwert global zu veraendern.
const seeOhneUebersteuerung = Object.assign({}, see, { key: "ggp:Gewaesser:See:Garetien:Testsee-2" });
const mSeeOhneUebersteuerung = garetienEingefuegtWirdMarkup(seeOhneUebersteuerung);
gleich(eingabeWert(mSeeOhneUebersteuerung, garetienEingabeId(seeOhneUebersteuerung, "size")), "18",
	"'see' traegt keine eigene Uebersteuerung -- die Vorbelegung der Groesse bleibt beim Grundwert 18");

// ---- G2.3: eine UNGUELTIGE Uebersteuerung faellt auf den Grundwert zurueck, statt eine kaputte
// Vorbelegung anzuzeigen -- fuer 'berggipfel': ein umgekehrtes Zoomband (bis < ab, in der
// Darstellungstafel gueltig als "aus") und eine Groesse unter dem Label-Minimum 10 pt.
avesmapsEcosystemDisplayInstall({
	vorgabe: { berggipfel: { ab: 5, bis: 1, prio: 2 } },
	groesse: { berggipfel: [4, 4, 4, 4, 4, 4, 4, 4, 4] },
});
const gipfelUngueltig = Object.assign({}, gipfel, { key: "ggp:Berge:Berg:Garetien:Testgipfel-2" });
const mGipfelUngueltig = garetienEingefuegtWirdMarkup(gipfelUngueltig);
gleich(eingabeWert(mGipfelUngueltig, garetienEingabeId(gipfelUngueltig, "minZoom")), "0",
	"ein umgekehrtes Zoomband faellt auf den Grundwert 0 zurueck: " + mGipfelUngueltig);
gleich(eingabeWert(mGipfelUngueltig, garetienEingabeId(gipfelUngueltig, "maxZoom")), "5",
	"und ebenso auf den Grundwert 5 -- BEIDE Enden, nicht nur eines");
gleich(eingabeWert(mGipfelUngueltig, garetienEingabeId(gipfelUngueltig, "size")), "18",
	"eine Groesse unter 10 pt faellt auf den Grundwert 18 pt zurueck");
gleich(eingabeWert(mGipfelUngueltig, garetienEingabeId(gipfelUngueltig, "priority")), "2",
	"die Prioritaet 2 ist fuer sich gueltig und wird trotzdem uebernommen -- nur Zoomband/Groesse "
	+ "sind kaputt");

// ---- Aufraeumen: die globale Uebersteuerung darf die folgenden Abschnitte nicht beeinflussen.
avesmapsEcosystemDisplayInstall(null);

// =================================================================================================
// I. Der Eingabezustand -- garetienEingabenGrundwerte/garetienEingabenZustandZu: Vorbelegung EINMAL,
//    danach ÜBERLEBT eine Handeingabe ein erneutes Rendern desselben Objekts.
// =================================================================================================

// 🔴 'tundra' TRÄGT KEINE ZEILE IN AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE_JE_ART -- anders als
// 'huegelland' (Abschnitt C, ab=3) prüft dieser Abschnitt den GRUNDWERT DER TAFEL (nicht den der
// Feature-Anlage): `avesmapsEcosystemDisplayVorgabe` beantwortet JEDE Art, auch eine unbekannte --
// sie fällt dann auf ihren EIGENEN Grundwert zurück (ab=0/bis=7/prio=3), nicht auf die
// Feature-Anlage-Vorgabe (min_zoom=0/max_zoom=5). Größe bleibt in beiden Grundwerten 18.
const zustandsObjekt = { key: "gi-zustand:1", subtyp: "tundra", ziel: "region" };
const grundwerte = garetienEingabenGrundwerte(zustandsObjekt);
gleich(grundwerte.size, 18, "Grundwert Groesse");
gleich(grundwerte.priority, 3, "Grundwert Prioritaet");
gleich(grundwerte.minZoom, 0, "Grundwert Start-Zoom");
gleich(grundwerte.maxZoom, 7, "Grundwert End-Zoom (Grundwert DER TAFEL, nicht der Feature-Anlage)");
gleich(grundwerte.showName, true, '"Auf Karte anzeigen" startet angehakt');
gleich(grundwerte.curveLabel, false, "Kurvenbeschreibung startet aus");
gleich(grundwerte.curveLabelMax, 1, "Anzahl startet bei 1");
gleich(grundwerte.isLocked, false, '"für Klicks gesperrt" startet aus');

const zustand1 = garetienEingabenZustandZu(zustandsObjekt);
zustand1.size = 42;
const zustand2 = garetienEingabenZustandZu(zustandsObjekt);
gleich(zustand2.size, 42, "ein zweiter Zugriff auf DASSELBE Objekt liefert den bereits GEÄNDERTEN "
	+ "Zustand, keine frische Vorbelegung -- sonst ginge jede Handeingabe beim nächsten Rendern verloren");
gleich(zustand1 === zustand2, true, "es ist wortwörtlich dasselbe Objekt, keine Kopie");

const anderesObjekt = { key: "gi-zustand:2", subtyp: "huegelland", ziel: "region" };
gleich(garetienEingabenZustandZu(anderesObjekt).size, 18,
	"ein ANDERES Objekt (anderer Schlüssel) bekommt seine EIGENE, frische Vorbelegung -- der "
	+ "geänderte Wert von oben darf nicht mitwandern");

// =================================================================================================
// J. garetienEingabenAendern -- eine Eingabe im Kasten bewegt GENAU den Eingabezustand des
//    GERADE GEÖFFNETEN Objekts, nichts sonst.
// =================================================================================================

// 🔴 garetienDetailWaehlen loest NEBENBEI die Wiki-Landschaft-Suche aus
// (garetienWikiLandschaftBeiBedarfLaden) -- ohne diese Wache griffe sie hier auf das ECHTE,
// native `fetch` von Node zu und versuchte einen echten Netzruf gegen eine relative Adresse.
const echtesFetchJ = global.fetch;
global.fetch = function () { return Promise.resolve({ json: () => Promise.resolve({ ok: true }) }); };

// zustand.detailKey wird über garetienDetailWaehlen gesetzt (dieselbe Verdrahtung wie im echten
// Fenster) -- ohne ein geöffnetes Objekt darf eine Eingabe gar nichts bewegen.
garetienDetailWaehlen(null, []);
const objektJ = { key: "gi-aendern:1", subtyp: "huegelland", ziel: "region" };
const feldOhneOffen = { getAttribute: () => "size", hasAttribute: () => true, type: "number", value: "99" };
garetienEingabenAendern({ target: feldOhneOffen }, [objektJ]);
gleich(garetienEingabenZustandZu(objektJ).size, 18,
	"ohne ein geöffnetes Objekt (detailKey === null) bewegt eine Eingabe NICHTS");

garetienDetailWaehlen(objektJ.key, [objektJ]);

// Ein fremdes Ziel (kein data-gi-feld) wird ignoriert.
garetienEingabenAendern({ target: { getAttribute: () => null, hasAttribute: () => false } }, [objektJ]);
gleich(garetienEingabenZustandZu(objektJ).size, 18, "ein Ziel ohne data-gi-feld bewegt nichts");

// Eine Zahl wird übernommen.
const feldGroesse = { getAttribute: () => "size", hasAttribute: () => true, type: "number", value: "27" };
garetienEingabenAendern({ target: feldGroesse }, [objektJ]);
gleich(garetienEingabenZustandZu(objektJ).size, 27, "eine getippte Zahl wird übernommen");

// Ein kaputter/leerer Wert wird VERWORFEN, nicht als NaN gespeichert -- der letzte gültige Stand
// bleibt stehen.
const feldKaputt = { getAttribute: () => "size", hasAttribute: () => true, type: "number", value: "" };
garetienEingabenAendern({ target: feldKaputt }, [objektJ]);
gleich(garetienEingabenZustandZu(objektJ).size, 27,
	"ein leeres Feld überschreibt den letzten gültigen Wert NICHT mit NaN");

// Ein Häkchen wird übernommen.
const feldHaken = { getAttribute: () => "showName", hasAttribute: () => true, type: "checkbox", checked: false };
garetienEingabenAendern({ target: feldHaken }, [objektJ]);
gleich(garetienEingabenZustandZu(objektJ).showName, false, "ein umgelegtes Häkchen wird übernommen");

// Das Umlegen von "curveLabel" schaltet das benachbarte Anzahl-Feld frei/gesperrt -- DIREKT am
// DOM-Knoten (ohne die ganze Spalte neu zu rendern).
const maxFeldElement = macheElement(garetienEingabeId(objektJ, "curveLabelMax"));
maxFeldElement.disabled = true;
ELEMENTE[maxFeldElement.id] = maxFeldElement;
const feldKurveAn = { getAttribute: () => "curveLabel", hasAttribute: () => true, type: "checkbox", checked: true };
garetienEingabenAendern({ target: feldKurveAn }, [objektJ]);
gleich(garetienEingabenZustandZu(objektJ).curveLabel, true, "die Kurvenbeschreibung wird angehakt");
gleich(maxFeldElement.disabled, false, "…und schaltet das Anzahl-Feld sofort FREI");
const feldKurveAus = { getAttribute: () => "curveLabel", hasAttribute: () => true, type: "checkbox", checked: false };
garetienEingabenAendern({ target: feldKurveAus }, [objektJ]);
gleich(maxFeldElement.disabled, true, "…und wieder GESPERRT, sobald sie ausgehakt wird");

// Ein ANDERES, nicht geöffnetes Objekt bleibt von alledem unberührt.
const objektDaneben = { key: "gi-aendern:2", subtyp: "huegelland", ziel: "region" };
gleich(garetienEingabenZustandZu(objektDaneben).size, 18,
	"ein Objekt, das nie geöffnet war, bleibt bei seiner Vorbelegung");

garetienDetailWaehlen(null, []);
global.fetch = echtesFetchJ;

// =================================================================================================
// K. garetienEingabenFuerServer -- was tatsächlich an den Server reist, je Ziel.
// =================================================================================================

// Ort/Weg: KEINE Handeingabe -- es gibt dort nichts, das der Kasten überhaupt anbietet.
gleich(garetienEingabenFuerServer({ key: "k1", ziel: "location", subtyp: "dorf" }), null,
	"ein Ort liefert KEINE Handeingabe -- der Kasten bietet dort keine Felder");
gleich(garetienEingabenFuerServer({ key: "k2", ziel: "path", subtyp: "Pfad" }), null,
	"ein Weg ebenso");

// Berggipfel (ziel='label'): die fünf Label-Felder, aber KEIN is_locked/curve_label.
const kBerg = { key: "k3", ziel: "label", subtyp: "berggipfel" };
garetienEingabenZustandZu(kBerg).size = 22;
garetienEingabenZustandZu(kBerg).priority = 1;
garetienEingabenZustandZu(kBerg).minZoom = 2;
garetienEingabenZustandZu(kBerg).maxZoom = 6;
garetienEingabenZustandZu(kBerg).showName = false;
const eBerg = garetienEingabenFuerServer(kBerg);
assert.deepStrictEqual(eBerg, {
	size: 22, priority: 1, min_zoom: 2, max_zoom: 6, show_name: false,
}, "ein Berggipfel liefert GENAU die fünf Label-Felder, keine Region-Felder: " + JSON.stringify(eBerg));
checks++;

// Fläche (ziel='region'): alle ACHT Felder.
const kFlaeche = { key: "k4", ziel: "region", subtyp: "huegelland" };
const eF = garetienEingabenZustandZu(kFlaeche);
eF.size = 30; eF.priority = 5; eF.minZoom = 1; eF.maxZoom = 4; eF.showName = false;
eF.isLocked = true; eF.curveLabel = true; eF.curveLabelMax = 2;
const eFlaeche = garetienEingabenFuerServer(kFlaeche);
assert.deepStrictEqual(eFlaeche, {
	size: 30, priority: 5, min_zoom: 1, max_zoom: 4, show_name: false,
	is_locked: true, curve_label: true, curve_label_max: 2,
}, "eine Fläche liefert alle ACHT Felder: " + JSON.stringify(eFlaeche));
checks++;

// =================================================================================================
// L. Die Verdrahtung: garetienDetailWaehlen -> garetienWikiLandschaftBeiBedarfLaden -> Aktion
//    'wiki_landschaft' -> der Platzhalter wird nachgetragen. Vorbild: garetien-fussknopf-dom.test.js.
// =================================================================================================

function tick() {
	return new Promise(function (resolve) { setImmediate(resolve); });
}

/** Ein gefaelschtes `fetch`, das jede Anfrage protokolliert und `antworten(rumpf)` befragt. */
function machFetch(antworten) {
	const angefragt = [];
	return {
		angefragt: angefragt,
		fn: function (pfad, optionen) {
			const rumpf = JSON.parse((optionen && optionen.body) || "{}");
			angefragt.push({ pfad: String(pfad), rumpf: rumpf });
			return Promise.resolve({ json: function () { return Promise.resolve(antworten(rumpf)); } });
		},
	};
}

async function pruefeWikiLandschaftVerdrahtung() {
	const huegelPlatzhalter = macheElement(garetienWikiLandschaftPlatzhalterId(huegel));
	ELEMENTE[huegelPlatzhalter.id] = huegelPlatzhalter;
	const seePlatzhalter = macheElement(garetienWikiLandschaftPlatzhalterId(see));
	ELEMENTE[seePlatzhalter.id] = seePlatzhalter;

	const echtesFetch = global.fetch;

	// ---- L1: das geoeffnete Objekt loest GENAU EINE Anfrage aus, ueber denselben Sender/dieselbe
	// Adresse wie jeder andere Aufruf dieser Datei (avesmapsGaretienRufe, GARETIEN_ENDPUNKT).
	const f1 = machFetch(function () {
		return { ok: true, wiki_landschaft: { status: "passt", name: "Huegel", art: "Hügelland" } };
	});
	global.fetch = f1.fn;
	garetienDetailWaehlen(huegel.key, [huegel]);
	// Synchron steht der Wartezustand schon da -- die Antwort kommt erst async.
	wahr(ELEMENTE["garetien-detailcol"].innerHTML.includes("wird gesucht"),
		"synchron steht der Wartezustand da, bevor die Serverantwort kommt");
	await tick();
	await tick();
	global.fetch = echtesFetch;

	gleich(f1.angefragt.length, 1, "GENAU EIN Aufruf fuer das geoeffnete Objekt");
	gleich(f1.angefragt[0].pfad, "/api/edit/map/garetien-import.php",
		"derselbe Sender, dieselbe Adresse -- kein zweiter fetch(");
	gleich(f1.angefragt[0].rumpf.action, "wiki_landschaft");
	gleich(f1.angefragt[0].rumpf.name, "Testhuegel");
	gleich(f1.angefragt[0].rumpf.subtyp, "huegelland");
	gleich(huegelPlatzhalter.textContent, "„Huegel\" (Hügelland) — Name und Art passen",
		"der Platzhalter traegt jetzt das Urteil des Servers");

	// ---- L2: ein erneutes Rendern DESSELBEN Objekts (z. B. nach einem Listen-Refetch) loest
	// KEINE zweite Anfrage aus -- kein Massenlauf, kein Nachfragen bei jedem Klick woanders.
	const f2 = machFetch(function () {
		throw new Error("darf nicht gerufen werden -- dasselbe Objekt bleibt geoeffnet");
	});
	global.fetch = f2.fn;
	garetienDetailWaehlen(huegel.key, [huegel]);
	await tick();
	global.fetch = echtesFetch;
	gleich(f2.angefragt.length, 0, "kein zweiter Aufruf fuer dasselbe, weiterhin geoeffnete Objekt");

	// ---- L3: ein ANDERES Objekt loest wieder EINE eigene Anfrage aus, mit seinen EIGENEN Werten.
	const f3 = machFetch(function () {
		return { ok: true, wiki_landschaft: { status: "warnung", name: "Seesumpf", art: "Sumpf" } };
	});
	global.fetch = f3.fn;
	garetienDetailWaehlen(see.key, [see]);
	await tick();
	await tick();
	global.fetch = echtesFetch;
	gleich(f3.angefragt.length, 1, "ein anderes Objekt loest wieder EINE eigene Anfrage aus");
	gleich(f3.angefragt[0].rumpf.subtyp, "see", "die eigenen Werte des NEUEN Objekts, nicht die alten");
	wahr(seePlatzhalter.textContent.startsWith("!"),
		'Owner-Wortlaut "typ nicht gefunden -> ausrufezeichen" -- das "!" steht am Anfang');
}

pruefeWikiLandschaftVerdrahtung().then(function () {
	console.log("garetien-eingefuegt-wird: " + checks + " Pruefungen bestanden.");
}).catch(function (fehler) {
	console.error(fehler);
	process.exitCode = 1;
});
