// „Eingefügt wird" -- die Einzelansicht zeigt, welche Einstellungen die Fläche/der Ort/das
// Label wirklich bekäme (Owner 30.08.2026, nach dem Schadensfall „3000 Labels ab Zoom 0").
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/review/__tests__/garetien-eingefuegt-wird.test.js
//
// 🔴 Geprueft wird DIFFERENTIELL (die Falle der Vakuum-Zusicherung): zwei verschiedene Arten
// muessen verschiedene Zahlen zeigen, und Flaeche/Ort/Label muessen verschiedene Abschnitte
// zeigen -- eine Zusicherung, die nur prueft, DASS eine Zeile im Markup steht, prueft nichts.
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
// dieser Ablauf wirklich anfasst.
function macheElement(id) {
	return {
		id: id, hidden: false, innerHTML: "", textContent: "",
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
} = mod;

wahr(typeof garetienEingefuegtWirdHatVorschlag === "function", "garetienEingefuegtWirdHatVorschlag fehlt im Export");
wahr(typeof garetienEingefuegtWirdMarkup === "function", "garetienEingefuegtWirdMarkup fehlt im Export");
wahr(typeof garetienEingefuegtWirdZeileMitHinweis === "function", "garetienEingefuegtWirdZeileMitHinweis fehlt im Export");
wahr(typeof garetienWikiLandschaftZeileText === "function", "garetienWikiLandschaftZeileText fehlt im Export");
// Die geteilte Verkehrsmittel-Regel muss als blanker Bezeichner ankommen -- sonst wuerde die
// nachfolgende Rechnung der Erwartungswerte (2 von 2 / 5 von 6 / 6 von 6) selbst zur Vakuum-Probe.
wahr(typeof getDefaultAllowedTransportsForPathSubtype === "function",
	"getDefaultAllowedTransportsForPathSubtype (map-features-path-domain.js) wurde nicht geladen");
wahr(typeof getTransportOptionsForPathSubtype === "function",
	"getTransportOptionsForPathSubtype (map-features-path-domain.js) wurde nicht geladen");

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
// C. Eine FLAECHE (ziel='region') -- Owner-Beispiel Huegel -> huegelland
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

// ---- Flaeche: fuer Klicks gesperrt ist IMMER "aus" (Spaltendeckel, kein Wert des Imports) ------
wahr(mHuegel.includes("Fläche"), "die Flaechen-Unterueberschrift fehlt");
wahr(mHuegel.includes("für Klicks gesperrt") && mHuegel.includes("(aus)"),
	'„für Klicks gesperrt (aus)" -- exakt das Owner-Beispiel');

// ---- Beschriftung: der ECHTE Wert des Imports steht IMMER da -------------------------------
wahr(mHuegel.includes("Größe") && mHuegel.includes("(18 pt)"), "die echte Groesse (Import-Vorgabe) fehlt");
wahr(mHuegel.includes("Priorität") && mHuegel.includes("(3)"), "die echte Prioritaet fehlt");
wahr(mHuegel.includes("Sichtbar ab Zoom") && mHuegel.includes("(0)"), "der echte Start-Zoom (0) fehlt");
wahr(mHuegel.includes("Sichtbar bis Zoom") && mHuegel.includes("(5)"), "der echte End-Zoom (5) fehlt");

// ---- Und die EHRLICHE Abweichung: huegelland empfiehlt ab=3 (AVESMAPS_ECOSYSTEM_DISPLAY_
// VORGABE_JE_ART.huegelland), der Import setzt aber 0 -- das MUSS als Hinweis dastehen, sonst
// waere die Anzeige die Falschaussage, die die 3000 Labels gekostet hat.
wahr(/Sichtbar ab Zoom[\s\S]{0,120}Vorgabe der Art wäre 3/.test(mHuegel),
	"huegelland empfiehlt ab=3 -- die Abweichung vom echten Wert (0) muss benannt werden");
// bis=7 ist die Grundvorgabe (kein Art-Eintrag setzt "bis" fuer huegelland), der Import setzt 5.
wahr(/Sichtbar bis Zoom[\s\S]{0,120}Vorgabe der Art wäre 7/.test(mHuegel),
	"die Grundvorgabe bis=7 weicht vom echten Wert (5) ab und muss benannt werden");

wahr(mHuegel.includes("Kurvenbeschreibung") && mHuegel.includes("(aus)"),
	"eine Flaeche zeigt die Kurvenbeschreibung, immer 'aus' (der Import setzt curve_label nie)");
wahr(mHuegel.includes("Auf Karte anzeigen") && mHuegel.includes("(an)"),
	"show_name ist immer 'an' (avesmapsCreateLabelFeature-Vorgabe)");

// ---- DIFFERENZIELL: eine ANDERE Art zeigt eine ANDERE Empfehlung (sonst waere die Tafel nicht
// wirklich angeschlossen, sondern eine feste Zeichenkette). 'see' empfiehlt ab=4, nicht 3.
const see = Object.assign({}, huegel, { key: "ggp:Gewaesser:See:Garetien:Testsee",
	subtyp: "see", kind: "topographie", typ: "See" });
const mSee = garetienEingefuegtWirdMarkup(see);
wahr(/Sichtbar ab Zoom[\s\S]{0,120}Vorgabe der Art wäre 4/.test(mSee),
	"'see' empfiehlt ab=4 -- eine andere Zahl als 'huegelland' (3), sonst waere es Vakuum");

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
// D. Ein BERGGIPFEL (ziel='label') -- KEINE Flaeche, KEINE Kurvenbeschreibung, KEIN Wiki-Landschaft
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
wahr(/Sichtbar ab Zoom[\s\S]{0,120}Vorgabe der Art wäre 4/.test(mGipfel),
	"Berggipfel empfehlen Zoom 4 (Owner-Entscheid) -- muss als Abweichung vom echten Wert 0 stehen");
wahr(!mGipfel.includes("Kurvenbeschreibung"),
	"ein Berggipfel-Label haengt an KEINER ecosystem_region -- keine Kurvenbeschreibung");
wahr(!mGipfel.includes("Wiki-Landschaft"),
	"Wiki-Landschaft ist ein Regions-Konzept -- ein Berggipfel bekommt die Zeile nicht");

// =================================================================================================
// E. Ein ORT (ziel='location') -- FESTE Klassentafel, kein Einstellwert des Imports, UND (Owner-
//    Nachtrag 30.08.2026) die sechs Karteifelder von "Ort bearbeiten", die der Import nie fuellt.
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
//    einem Flussweg) Stroemung.
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
// G2. KORREKTUR A (Owner-Nachtrag 30.08.2026, wörtlich: „DOCH DER IMPORT SOLL SIE SETZEN!!!"):
//     eine gespeicherte ADMIN-UEBERSTEUERUNG wird vom Import wirklich gesetzt -- der echte Wert
//     MUSS sie dann tragen, und "der Import setzt sie nicht" darf fuer diese Felder nicht mehr
//     stehen. Eine UNGUELTIGE Uebersteuerung (die avesmapsCreateLabelFeature ablehnen wuerde)
//     faellt dagegen auf den Grundwert zurueck -- genau wie server-seitig
//     (avesmapsGaretienLabelVorgabeFuerArt, api/_internal/import/garetien-uebernahme.php).
// =================================================================================================

// ---- G2.1: eine VOLLSTAENDIGE, gueltige Uebersteuerung fuer 'huegelland'.
avesmapsEcosystemDisplayInstall({
	vorgabe: { huegelland: { ab: 2, bis: 6, prio: 4 } },
	groesse: { huegelland: [10, 11, 12, 13, 14, 25, 26, 27, 28] },
});
const mHuegelUebersteuert = garetienEingefuegtWirdMarkup(huegel);
wahr(mHuegelUebersteuert.includes("Größe") && mHuegelUebersteuert.includes("(25 pt)"),
	"die Uebersteuerung setzt die Groesse auf ihren z5-Wert 25: " + mHuegelUebersteuert);
wahr(mHuegelUebersteuert.includes("Priorität") && mHuegelUebersteuert.includes("(4)"),
	"die Uebersteuerung setzt die Prioritaet auf 4");
wahr(mHuegelUebersteuert.includes("Sichtbar ab Zoom") && mHuegelUebersteuert.includes("(2)"),
	"die Uebersteuerung setzt den Start-Zoom auf 2");
wahr(mHuegelUebersteuert.includes("Sichtbar bis Zoom") && mHuegelUebersteuert.includes("(6)"),
	"die Uebersteuerung setzt den End-Zoom auf 6");
wahr(!mHuegelUebersteuert.includes("Vorgabe der Art wäre"),
	'"der Import setzt sie nicht" darf jetzt nicht mehr stehen -- der Import setzt sie: '
	+ mHuegelUebersteuert);

// ---- G2.2: die GEGENPROBE -- eine ANDERE Art ohne eigene Uebersteuerung bleibt beim Grundwert
// und zeigt weiterhin ihre Empfehlung als Hinweis. Ohne diese Zeile prüfte G2.1 nicht, ob die
// Uebersteuerung wirklich an der ART haengt, statt den Grundwert global zu veraendern.
const mSeeOhneUebersteuerung = garetienEingefuegtWirdMarkup(see);
wahr(mSeeOhneUebersteuerung.includes("Größe") && mSeeOhneUebersteuerung.includes("(18 pt)"),
	"'see' traegt keine eigene Uebersteuerung -- die Groesse bleibt beim Grundwert 18 pt");
wahr(/Sichtbar ab Zoom[\s\S]{0,120}Vorgabe der Art wäre 4/.test(mSeeOhneUebersteuerung),
	"'see' zeigt weiterhin seine Empfehlung als Hinweis -- 'huegelland' und 'see' duerfen sich "
	+ "nicht gegenseitig beeinflussen");

// ---- G2.3: eine UNGUELTIGE Uebersteuerung faellt auf den Grundwert zurueck, statt den Import
// zum Werfen zu bringen -- fuer 'berggipfel': ein umgekehrtes Zoomband (bis < ab, in der
// Darstellungstafel gueltig als "aus") und eine Groesse unter dem Label-Minimum 10 pt.
avesmapsEcosystemDisplayInstall({
	vorgabe: { berggipfel: { ab: 5, bis: 1, prio: 2 } },
	groesse: { berggipfel: [4, 4, 4, 4, 4, 4, 4, 4, 4] },
});
const mGipfelUngueltig = garetienEingefuegtWirdMarkup(gipfel);
wahr(mGipfelUngueltig.includes("Sichtbar ab Zoom") && mGipfelUngueltig.includes("(0)"),
	"ein umgekehrtes Zoomband faellt auf den Grundwert 0 zurueck: " + mGipfelUngueltig);
wahr(mGipfelUngueltig.includes("Sichtbar bis Zoom") && mGipfelUngueltig.includes("(5)"),
	"und ebenso auf den Grundwert 5 -- BEIDE Enden, nicht nur eines");
wahr(mGipfelUngueltig.includes("Größe") && mGipfelUngueltig.includes("(18 pt)"),
	"eine Groesse unter 10 pt faellt auf den Grundwert 18 pt zurueck");
wahr(mGipfelUngueltig.includes("Priorität") && mGipfelUngueltig.includes("(2)"),
	"die Prioritaet 2 ist fuer sich gueltig und wird trotzdem uebernommen -- nur Zoomband/Groesse "
	+ "sind kaputt");
// Die verworfene Uebersteuerung bleibt trotzdem als EHRLICHER Hinweis sichtbar -- sie wurde
// gespeichert, nur eben nicht angewendet.
wahr(/Sichtbar ab Zoom[\s\S]{0,120}Vorgabe der Art wäre 5/.test(mGipfelUngueltig),
	"die verworfene Uebersteuerung (ab=5) bleibt als Hinweis sichtbar -- der Import setzt sie eben nicht");
wahr(mGipfelUngueltig.includes("Größe") && /Größe[\s\S]{0,120}Vorgabe der Art wäre 4 pt/.test(mGipfelUngueltig),
	"und ebenso die verworfene Groesse (4 pt)");

// ---- Aufraeumen: die globale Uebersteuerung darf die Verdrahtungs-Sektion (H) nicht beeinflussen.
avesmapsEcosystemDisplayInstall(null);

// =================================================================================================
// H. Die Verdrahtung: garetienDetailWaehlen -> garetienWikiLandschaftBeiBedarfLaden -> Aktion
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

	// ---- H1: das geoeffnete Objekt loest GENAU EINE Anfrage aus, ueber denselben Sender/dieselbe
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

	// ---- H2: ein erneutes Rendern DESSELBEN Objekts (z. B. nach einem Listen-Refetch) loest
	// KEINE zweite Anfrage aus -- kein Massenlauf, kein Nachfragen bei jedem Klick woanders.
	const f2 = machFetch(function () {
		throw new Error("darf nicht gerufen werden -- dasselbe Objekt bleibt geoeffnet");
	});
	global.fetch = f2.fn;
	garetienDetailWaehlen(huegel.key, [huegel]);
	await tick();
	global.fetch = echtesFetch;
	gleich(f2.angefragt.length, 0, "kein zweiter Aufruf fuer dasselbe, weiterhin geoeffnete Objekt");

	// ---- H3: ein ANDERES Objekt loest wieder EINE eigene Anfrage aus, mit seinen EIGENEN Werten.
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
