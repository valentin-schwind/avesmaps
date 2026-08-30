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

// 🔴 DIE VERKEHRSMITTEL-BESCHRIFTUNGEN KOMMEN AUS index.html, NICHT AUS DIESEM TEST. Der Importer
// liest sie zur Laufzeit aus dem ECHTEN Dialog „Weg bearbeiten" im selben Dokument
// (#path-edit-transport-options) -- es gibt im Haus keine geteilte Tafel fuer die elf Schluessel,
// und eine vierte Kopie waere genau die Doppelung, die dieses Fenster schon zweimal bezahlt hat.
// Damit dieser Test das WIRKLICH prueft, baut er das Element aus den echten Zeilen der Seite:
// wer die Zeilen dort umbenennt oder entfernt, sieht es hier.
const PFAD_TRANSPORT_ZEILEN = [];
for (const treffer of fs.readFileSync(path.join(WURZEL, "index.html"), "utf8")
	.matchAll(/<input type="checkbox" name="allowed_transport" value="([^"]+)"\s*\/>\s*([^<]+)</g)) {
	PFAD_TRANSPORT_ZEILEN.push({
		getAttribute(name) { return name === "value" ? treffer[1] : null; },
		parentNode: { textContent: " " + treffer[2].trim() },
	});
}
assert.ok(PFAD_TRANSPORT_ZEILEN.length === 11,
	`index.html muss die elf Verkehrsmittel-Zeilen des Dialogs "Weg bearbeiten" tragen, gefunden: ${PFAD_TRANSPORT_ZEILEN.length}`);
ELEMENTE["path-edit-transport-options"] = Object.assign(macheElement("path-edit-transport-options"), {
	querySelectorAll(sel) { return sel.includes("allowed_transport") ? PFAD_TRANSPORT_ZEILEN : []; },
});

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
// Fuenf-Punkte-Brief 30.08.2026, Punkt 3: die dritte Beschriftungsquelle (garetienUnserBeschriftung
// liest sie fuer ziel='region'/'label') -- js/ui/label-arten.js unterstuetzt `module.exports` und
// braucht deshalb kein `vm.runInThisContext` wie die beiden Tafeln oben.
global.avesmapsLabelArtName =
	require(path.resolve(WURZEL, "js/ui/label-arten.js")).avesmapsLabelArtName;

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const {
	garetienEingefuegtWirdHatVorschlag,
	garetienEingefuegtWirdMarkup,
	garetienEingefuegtWirdUebernommenHinweis,
	garetienEingefuegtWirdZeileMitHinweis,
	garetienWikiLandschaftZeileText,
	garetienWikiLandschaftPlatzhalterId,
	garetienDetailWaehlen,
	garetienEingabenZustandZu,
	garetienEingabenGrundwerte,
	garetienEingabenAendern,
	garetienEingabenFuerServer,
	garetienEingabeId,
	garetienSliderMarkePosition,
} = mod;

wahr(typeof garetienEingefuegtWirdHatVorschlag === "function", "garetienEingefuegtWirdHatVorschlag fehlt im Export");
wahr(typeof garetienEingefuegtWirdMarkup === "function", "garetienEingefuegtWirdMarkup fehlt im Export");
wahr(typeof garetienEingefuegtWirdUebernommenHinweis === "function",
	"garetienEingefuegtWirdUebernommenHinweis fehlt im Export");
wahr(typeof garetienEingefuegtWirdZeileMitHinweis === "function", "garetienEingefuegtWirdZeileMitHinweis fehlt im Export");
wahr(typeof garetienWikiLandschaftZeileText === "function", "garetienWikiLandschaftZeileText fehlt im Export");
wahr(typeof garetienEingabenZustandZu === "function", "garetienEingabenZustandZu fehlt im Export");
wahr(typeof garetienEingabenGrundwerte === "function", "garetienEingabenGrundwerte fehlt im Export");
wahr(typeof garetienEingabenAendern === "function", "garetienEingabenAendern fehlt im Export");
wahr(typeof garetienEingabenFuerServer === "function", "garetienEingabenFuerServer fehlt im Export");
wahr(typeof garetienEingabeId === "function", "garetienEingabeId fehlt im Export");
wahr(typeof garetienSliderMarkePosition === "function", "garetienSliderMarkePosition fehlt im Export");
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
// 🔴 Fuenf-Punkte-Brief 30.08.2026, Punkt 3: „huegelland" ist seither aufgeloest -- die Kopfzeile
// zeigt „Hügelland" (avesmapsLabelArtName, js/ui/label-arten.js), nicht mehr den rohen Schluessel.
// 🔴 Punkt 4: diese Kopfzeile ist die EINZIGE verbliebene Stelle -- im Kopf der Einzelansicht steht
// sie seither nicht mehr (garetien-einzelansicht.test.js).
wahr(mHuegel.includes("Huegel (garetien.de) → Hügelland (Avesmaps)"),
	"die Kopfzeile nennt ihren Typ und UNSERE aufgeloeste Beschriftung des Zielsubtyps");
wahr(!mHuegel.includes("huegelland (Avesmaps)"),
	"der rohe Schluessel darf nicht mehr in Klammern stehen -- nur noch die aufgeloeste Beschriftung");

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

// ---- 🔴 DIE ECHTEN STEUERELEMENTE (Owner-Bestellung 30.08.2026, drei Bildschirmfotos): Zahl UND
// Regler UND Vorgabe-Marke, dieselbe Bauform wie index.html #label-edit-form -- keine Nachbildung
// mit blossen Zahlenfeldern mehr.
wahr(mHuegel.includes("label-edit-sliderrow") && mHuegel.includes("label-edit-markewrap"),
	"die Sliderrow-Bauform des echten Beschriftungsdialogs fehlt");
wahr(mHuegel.includes("location-report-form__field--zeile"),
	"die Zeilenform des echten Dialogs (Beschriftung LINKS) fehlt");
const idAbRegler = idAb + "-range";
const idAbMarke = idAb + "-marke";
wahr(mHuegel.includes('id="' + idAbRegler + '"') && mHuegel.includes('type="range"'),
	'"Sichtbar ab Zoom" muss einen ECHTEN Regler tragen, nicht nur ein Zahlenfeld');
gleich(eingabeWert(mHuegel, idAbRegler), "3", "der Regler startet mit demselben Wert wie die Zahl");
wahr(mHuegel.includes('id="' + idAbMarke + '"'), "die Vorgabe-Marke des Ab-Zoom-Reglers fehlt");
// 🔴 Die Marke zeigt die VORGABE DER ART (3), nicht den aktuellen Wert -- hier zufaellig gleich,
// weil noch niemand am Regler gezogen hat (der HAEUFIGSTE Fall, siehe .label-edit-marke-CSS).
const markeAbSoll = garetienSliderMarkePosition(3, 0, 7);
wahr(mHuegel.includes('style="left: ' + markeAbSoll + ';"'),
	"die Marke steht an der errechneten Position der Vorgabe (3 von 0..7): " + mHuegel);

// ---- 🔴 NODIX (drittes Bildschirmfoto: „Beschriftung bearbeiten" traegt auch dieses Haekchen) --
// gilt fuer JEDE Beschriftung, nicht nur fuer eine Flaeche, und startet immer AUS (keine Vorgabe
// der Art -- garetien.de liefert nie eine Nodix-Aussage).
const idNodixHuegel = garetienEingabeId(huegel, "isNodix");
wahr(mHuegel.includes("Nodix") && mHuegel.includes('id="' + idNodixHuegel + '"') && mHuegel.includes('type="checkbox"'),
	"die Nodix-Zeile fehlt oder ist kein echtes Häkchen");
gleich(istAngehakt(mHuegel, idNodixHuegel), false, "Nodix startet UNGEHAKT (kein Grundwert der Art dafür)");

// ---- 🔴 DER HINWEISKASTEN (erstes Bildschirmfoto): derselbe Text wie im echten Dialog, abhängig
// vom Kurvenbeschreibungs-Haken -- „frei", solange er aus ist (der Startzustand).
wahr(mHuegel.includes("landschaft-dialog__bindung") && mHuegel.includes("liegt frei auf der Karte"),
	"der Hinweiskasten (frei/gebunden) fehlt oder zeigt den falschen Starttext");
wahr(!mHuegel.includes("An die Fläche gebunden"),
	"ohne angehakte Kurvenbeschreibung darf der 'gebunden'-Text nicht stehen");

// ---- DIFFERENZIELL: der Hinweiskasten wechselt mit der Kurvenbeschreibung -- sonst waere er ein
// fester Satz statt wirklich vom Haken abhaengig.
garetienEingabenZustandZu(huegel).curveLabel = true;
const mHuegelGebunden = garetienEingefuegtWirdMarkup(huegel);
wahr(mHuegelGebunden.includes("An die Fläche gebunden") && !mHuegelGebunden.includes("liegt frei auf der Karte"),
	"mit angehakter Kurvenbeschreibung muss der 'gebunden'-Text stehen, der 'frei'-Text nicht mehr: "
	+ mHuegelGebunden);
garetienEingabenZustandZu(huegel).curveLabel = false; // aufräumen -- der Rest der Datei erwartet "aus"

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
// ---- DIFFERENZIELL: die Vorgabe-Marke wandert mit der Art, nicht nur der Feldwert -- sonst waere
// die Marke eine feste Zeichenkette statt wirklich an die Tafel angeschlossen.
const markeSeeAb = garetienSliderMarkePosition(4, 0, 7);
wahr(markeSeeAb !== markeAbSoll,
	"eine ANDERE Vorgabe (4 statt 3) muss eine ANDERE Markenposition ergeben, sonst waere es Vakuum");
wahr(mSee.includes('style="left: ' + markeSeeAb + ';"'),
	"'see' zeigt die Marke an SEINER eigenen Position (4 von 0..7): " + mSee);

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
// ---- Nodix gilt AUCH fuer ein Label ohne Flaeche (drittes Bildschirmfoto zeigt es an DERSELBEN
// Beschriftung wie Groesse/Prioritaet/Zoomband, nicht nur an einer Region).
wahr(mGipfel.includes("Nodix") && mGipfel.includes('id="' + garetienEingabeId(gipfel, "isNodix") + '"'),
	"Nodix gilt auch fuer ein Label ohne Flaeche");
// ---- KEIN Hinweiskasten (frei/gebunden) ohne Kurvenbeschreibung -- ein Berggipfel-Label kennt
// gar keine Bindung an eine Flaeche.
wahr(!mGipfel.includes("landschaft-dialog__bindung"),
	"ein Berggipfel-Label zeigt keinen Bindungs-Hinweis -- es gibt keine Flaeche, an die es sich binden könnte");
// ---- Auch ein Berggipfel bekommt den echten Regler samt Marke.
wahr(mGipfel.includes("label-edit-sliderrow") && mGipfel.includes('type="range"'),
	"ein Berggipfel-Label bekommt dieselben echten Regler wie eine Flaeche");

// =================================================================================================
// E. Ein ORT (ziel='location') -- Owner 30.08.2026: „ja mach ort bearbeiten, dann weg bearbeiten".
//    VIER echte Bedienelemente, und zwar GENAU die vier Felder, die avesmapsCreatePointFeature
//    (api/_internal/map/features.php) beim Anlegen wirklich in properties_json schreibt:
//    is_nodix / is_ruined / is_hidden als Haken, place_kind als Textfeld.
//
//    🔴 Reine ANZEIGE bleiben die zwei Zeilen, hinter denen KEIN Schreibweg steht: die Zoomstufe
//    (feste Klassentafel, kein properties_json-Feld) und Einwohner/Lage/Herrscher (die entstehen
//    aus der WIKI-Zuweisung, nicht aus dem Anfragerumpf). Ein Regler darauf waere ein
//    Bedienelement, das nichts tut -- und von einem, das wirkt, von aussen nicht zu unterscheiden.
// =================================================================================================

const ort = {
	key: "ggp:Sonstiges:Dorf:Garetien:Testdorf", name: "Testdorf", typ: "Dorf",
	subtyp: "dorf", kind: "", ziel: "location", wiki: "ggp", abschnitte: [],
	items: [{ id: 3, change_type: "new" }],
};
const mOrt = garetienEingefuegtWirdMarkup(ort);
wahr(!mOrt.includes("Fläche") && !mOrt.includes("class=\"gi-insert__sub\">Beschriftung<") && !mOrt.includes("Weg anzeigen"),
	"ein Ort hat weder Flaechen- noch Beschriftungs- noch Weg-Einstellwerte");
wahr(mOrt.includes("Ort"), "die Ort-Unterueberschrift fehlt");

// ---- Die drei Haken sind ECHTE Haken, jeder mit seinem Feldnamen am Knoten.
["isNodix", "isRuined", "isHidden"].forEach(function (feld) {
	wahr(mOrt.includes('type="checkbox"') && mOrt.includes('data-gi-feld="' + feld + '"'),
		"der Ort braucht ein Haekchen fuer " + feld + ": " + mOrt);
});
// ---- Und die Art ist ein Textfeld, kein Haken und keine Zahl.
wahr(/<input type="text"[^>]*data-gi-feld="placeKind"/.test(mOrt),
	"place_kind ist ein Textfeld (der echte Dialog hat dort ein Freitextfeld mit Katalog-Vorschlaegen): " + mOrt);

// 💣 UND SEINE BREITE HAENGT AN EINER EIGENEN REGEL. `.gi-insert__input` steht auf `width: 4.5em`
// -- fuer eine Zahl richtig, fuer ein Freitextfeld mit dem Platzhalter „z. B. Brücke – leer
// lassen, wenn unbekannt" unbrauchbar. Der Modifier im Markup und die Regel im CSS sind ein
// gekoppelter Wert in ZWEI Dateien; faellt eine Haelfte weg, schrumpft das Feld lautlos auf
// Zahlenbreite und niemand merkt es an einem gruenen Test.
wahr(mOrt.includes("gi-insert__input--text"), "das Textfeld traegt seinen Modifier: " + mOrt);
const importerCss = fs.readFileSync(path.join(WURZEL, "css/components/garetien-importer.css"), "utf8");
wahr(/\.gi-insert__input\.gi-insert__input--text\s*\{/.test(importerCss),
	"und die CSS-Regel dazu gibt es wirklich -- mit ZWEI Klassen, damit sie die 4.5em sicher schlaegt");

// ---- Was an den Server reist -- die vier Feldnamen des Anlegers, nicht die des Browsers.
const rausOrt = garetienEingabenFuerServer(ort);
wahr(rausOrt !== null, "ein Ort schickt jetzt eine Handeingabe mit (frueher: null)");
gleich(Object.keys(rausOrt).sort().join(","), "is_hidden,is_nodix,is_ruined,place_kind",
	"GENAU die vier Felder, die avesmapsCreatePointFeature liest -- kein fuenftes: " + JSON.stringify(rausOrt));
gleich(rausOrt.is_nodix, false, "Grundwert aus");
gleich(rausOrt.place_kind, "", "Grundwert: keine Art");

// ---- Eine Handeingabe kommt wirklich an (differenziell, nicht nur die Form).
garetienEingabenZustandZu(ort).isRuined = true;
garetienEingabenZustandZu(ort).placeKind = "Brücke";
gleich(garetienEingabenFuerServer(ort).is_ruined, true, "ein gesetzter Haken reist mit");
gleich(garetienEingabenFuerServer(ort).place_kind, "Brücke", "eine getippte Art reist mit");
wahr(garetienEingefuegtWirdMarkup(ort).includes('value="Brücke"'),
	"und sie steht beim naechsten Rendern wieder im Feld -- der Zustand liegt im Modul, nicht im DOM");
garetienEingabenZustandZu(ort).isRuined = false;
garetienEingabenZustandZu(ort).placeKind = ""; // aufräumen -- der Rest der Datei erwartet die Grundwerte

// ---- Die zwei Zeilen OHNE Schreibweg bleiben Anzeige.
// 'dorf' im Marker-Band: [null, null, 1.33, ...] -- die erste gefuellte Zelle ist Index 2.
wahr(mOrt.includes("erscheint ab Zoom 2"),
	"die feste Klassentafel (location-zoom-bands.js) muss den ECHTEN Bandwert zeigen, nicht geraten");
wahr(mOrt.includes("kein Einstellwert dieses Imports"),
	"die Zoomzeile muss sagen, dass hier gar nichts vom Import kommt");
wahr(/Einwohner · Lage · Herrscher[\s\S]{0,40}\(keine Angabe\)/.test(mOrt),
	"einwohner/lage/oberhaupt kommen vom Import nie mit und bleiben Anzeige");
wahr(!/data-gi-feld="(einwohner|lage|oberhaupt|minZoom)"/.test(mOrt),
	"und sie bekommen KEIN Eingabefeld -- dahinter steht beim Anlegen kein Schreibweg");

// ---- DIFFERENZIELL: eine ANDERE Ortsklasse zeigt eine ANDERE Zoomstufe. 'stadt': [1.33, ...] --
// die erste gefuellte Zelle ist Index 0.
const stadt = Object.assign({}, ort, { key: "ggp:Sonstiges:Stadt:Garetien:Teststadt", subtyp: "stadt" });
wahr(garetienEingefuegtWirdMarkup(stadt).includes("erscheint ab Zoom 0"),
	"'stadt' erscheint ab Zoom 0 -- eine andere Zahl als 'dorf' (2), sonst waere es Vakuum");

// ---- Punkt 6a: ein UEBERNOMMENER Ort ist angelegt -- alle vier Felder gesperrt.
const ortUebernommen = Object.assign({}, ort, {
	key: "ggp:Sonstiges:Dorf:Garetien:Testdorf-uebernommen", stand: "uebernommen",
});
const mOrtUeb = garetienEingefuegtWirdMarkup(ortUebernommen);
gleich((mOrtUeb.match(/disabled/g) || []).length, 4,
	"alle vier Bedienelemente des Ortes sind gesperrt, sobald er auf der Karte liegt: " + mOrtUeb);

// Keine "Vorgabe der Art"-Behauptung -- fuer diese vier Felder gibt es keine Tafel, eine erfundene
// Empfehlung waere die zweite Wahrheit, vor der AGENTS.md warnt.
wahr(!mOrt.includes("Vorgabe der Art wäre"),
	"der Ort-Abschnitt darf keine Art-Empfehlung behaupten, die es nicht gibt");

// =================================================================================================
// F. Ein WEG (ziel='path') -- Owner 30.08.2026: „ja mach ort bearbeiten, dann weg bearbeiten".
//    ZWEI echte Bedienelemente, und zwar GENAU die zwei Felder, die avesmapsCreatePathFeature
//    beim Anlegen wirklich aus dem Anfragerumpf liest: `show_label` und `allowed_transports`.
//
//    🔴 Reine ANZEIGE bleiben Jahreszeiten und Stroemung -- `transport_seasons` steht ueberhaupt
//    nicht im $properties-Rumpf des Anlegers, und die Flussrichtung hat einen eigenen Schreibweg
//    im Wege-Editor. Ein Bedienelement darauf waere eines, das nichts tut.
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

// ---- "Weg anzeigen" (show_label) ist jetzt ein Haken.
wahr(/data-gi-feld="showLabel"/.test(mWeg), "show_label ist ein Haekchen: " + mWeg);
wahr(mWeg.includes("Weg anzeigen (Name auf der Karte)"), "und traegt die Beschriftung des echten Dialogs");

// ---- "Verkehrsmittel": EIN Haken je ANGEBOTENEM Mittel, vorgehakt nach der Vorauswahl der Wegart.
// 🔴 Beides kommt aus der geteilten Regel (map-features-path-domain.js), nicht aus abgeschriebenen
// Zahlen -- dieselbe Regel, die avesmapsReadAllowedTransports serverseitig anwendet.
function vmZaehlen(markup) {
	return {
		haken: (markup.match(/data-gi-transport="/g) || []).length,
		gehakt: (markup.match(/data-gi-transport="[^"]*" checked/g) || []).length,
	};
}
const vmFluss = vmZaehlen(mWeg);
gleich(vmFluss.haken, getTransportOptionsForPathSubtype("Flussweg").length,
	"ein Haken je angebotenem Verkehrsmittel des Flusswegs (2)");
gleich(vmFluss.gehakt, getDefaultAllowedTransportsForPathSubtype("Flussweg").length,
	"vorgehakt ist die Vorauswahl der Wegart (2 von 2)");

const pfad = Object.assign({}, weg, { key: "ggp:Wege:Pfad:Garetien:Testpfad", subtyp: "Pfad", typ: "Pfad" });
const mPfad = garetienEingefuegtWirdMarkup(pfad);
const vmPfad = vmZaehlen(mPfad);
gleich(vmPfad.haken, 6, "der Pfad BIETET sechs Verkehrsmittel an -- eine andere Zahl als der Flussweg");
gleich(vmPfad.gehakt, 5, "und haekelt fuenf davon vor: die Kutsche wird angeboten, aber nicht gewaehlt");
wahr(/data-gi-transport="horseCarriage"(?! checked)/.test(mPfad),
	"und zwar GENAU die Kutsche ist die ungehakte -- sonst waere die Zahl 5 zufaellig richtig: " + mPfad);

const strasse = Object.assign({}, weg, { key: "ggp:Wege:Strasse:Garetien:Teststrasse", subtyp: "Strasse", typ: "Strasse" });
const mStrasse = garetienEingefuegtWirdMarkup(strasse);
gleich(vmZaehlen(mStrasse).gehakt, 6, "die Strasse erlaubt alle sechs Land-Verkehrsmittel -- eine DRITTE Zahl");

// ---- 💣 DIE BESCHRIFTUNGEN WERDEN NICHT ABGESCHRIEBEN, sondern aus dem ECHTEN Dialog „Weg
// bearbeiten" im selben Dokument gelesen (#path-edit-transport-options in index.html). Es gibt
// im Haus KEINE geteilte Tafel fuer die elf Schluessel -- nur literale Texte in index.html und
// woertliche Kopien in wege-editor.js/transport-speed-info.js. Eine VIERTE Kopie hier waere genau
// die Doppelung, vor der der alte Kommentar an dieser Stelle gewarnt hat.
// Das gefaelschte `document` oben liefert dafuer die ECHTEN Zeilen aus index.html.
wahr(mWeg.includes("Flusssegler") && mWeg.includes("Flusskahn"),
	"die zwei Fluss-Verkehrsmittel stehen mit ihrem Namen da, nicht mit ihrem Schluessel: " + mWeg);
wahr(!mWeg.includes(">riverSailer<"), "und der Schluessel steht NICHT als Beschriftung da");

// ---- Was an den Server reist.
const rausWeg = garetienEingabenFuerServer(weg);
wahr(rausWeg !== null, "ein Weg schickt jetzt eine Handeingabe mit (frueher: null)");
gleich(rausWeg.show_label, false, "Grundwert: der Name steht nicht auf der Karte");
wahr(!("allowed_transports" in rausWeg),
	"UNANGETASTET schickt der Weg KEINE Verkehrsmittel mit -- dann waehlt der Server dieselbe "
	+ "Vorauswahl wie bisher, und der Aufruf bleibt zeichengleich zu vorher: " + JSON.stringify(rausWeg));

// Erst eine echte Handeingabe schickt die Liste mit.
garetienEingabenZustandZu(weg).transports = ["riverSailer"];
garetienEingabenZustandZu(weg).showLabel = true;
const rausWeg2 = garetienEingabenFuerServer(weg);
gleich(rausWeg2.show_label, true, "ein gesetzter Haken reist mit");
assert.deepStrictEqual(rausWeg2.allowed_transports, ["riverSailer"],
	"eine geaenderte Auswahl reist als Liste mit");
checks++;

// ---- 🔴 EINE LEERE AUSWAHL IST ERLAUBT, ABER SIE WIRD BENANNT. avesmapsReadAllowedTransports
// nimmt `[]` an und speichert es -- ein Weg, den kein Verkehrsmittel benutzen darf, ist damit eine
// Kante, die im Routing niemand befahren kann. Das ist die Entscheidung des Editors (der echte
// Dialog laesst dasselbe zu), aber sie darf nicht still passieren.
garetienEingabenZustandZu(weg).transports = [];
const mWegLeer = garetienEingefuegtWirdMarkup(weg);
wahr(mWegLeer.includes("kein Verkehrsmittel"),
	"eine leere Auswahl bekommt einen sichtbaren Warnsatz: " + mWegLeer);
assert.deepStrictEqual(garetienEingabenFuerServer(weg).allowed_transports, [],
	"und sie reist trotzdem mit -- verschluckt wuerde sie zur Vorauswahl zurueckfallen, "
	+ "also genau das Gegenteil der Absicht");
checks++;
garetienEingabenZustandZu(weg).transports = null;   // aufräumen
garetienEingabenZustandZu(weg).showLabel = false;

// ---- Die zwei Zeilen OHNE Schreibweg bleiben Anzeige.
wahr(/Jahreszeiten \(Gangbarkeit\)[\s\S]{0,60}\(ganzjährig\)/.test(mWeg),
	"transport_seasons steht gar nicht im Rumpf des Anlegers und bleibt Anzeige");
wahr(/Strömung \(Flussrichtung\)[\s\S]{0,60}\(unbekannt\)/.test(mWeg),
	"ein Flussweg zeigt die Stroemungszeile mit 'unbekannt' -- sie hat ihren eigenen Schreibweg");
wahr(!mWeg.includes('data-gi-feld="seasons"') && !mWeg.includes('data-gi-feld="flow"'),
	"und beide bekommen KEIN Eingabefeld");
wahr(!mPfad.includes("Strömung") && !mStrasse.includes("Strömung"),
	"ein Pfad/eine Strasse fuehrt keine Stroemung -- die Zeile darf dort gar nicht erscheinen");

// ---- Punkt 6a: ein UEBERNOMMENER Weg ist angelegt -- alles gesperrt (1 Haken + 2 Verkehrsmittel).
const wegUebernommen = Object.assign({}, weg, {
	key: "ggp:Gewaesser:Fluss:Garetien:Testfluss-uebernommen", stand: "uebernommen",
});
gleich((garetienEingefuegtWirdMarkup(wegUebernommen).match(/disabled/g) || []).length, 3,
	"beim uebernommenen Flussweg sind der Anzeige-Haken und beide Verkehrsmittel gesperrt");

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
// H. garetienSliderMarkePosition -- dieselbe Rechnung wie im echten Beschriftungsdialog
//    (review-labels.js), hier als eigene, AUSGEFÜHRTE Kopie (siehe Kommentar an der Funktion).
// =================================================================================================

const hLinks = garetienSliderMarkePosition(0, 0, 7);
const hMitte = garetienSliderMarkePosition(3.5, 0, 7);
const hRechts = garetienSliderMarkePosition(7, 0, 7);
wahr(/calc\(/.test(hLinks) && /px/.test(hLinks), "die Position rechnet in calc mit Pixeln: " + hLinks);
wahr(hLinks.includes("0%"), "ganz links sind es 0 % plus der halbe Knopf: " + hLinks);
wahr(hRechts.includes("100%"), "ganz rechts 100 % minus der halbe Knopf: " + hRechts);
const hZahl = (s) => Number((s.match(/([+-]?[0-9.]+)px/) || [])[1]);
wahr(hZahl(hLinks) > 0, "links wird nach INNEN geschoben: " + hLinks);
wahr(hZahl(hRechts) < 0, "rechts nach innen, also andersherum: " + hRechts);
wahr(Math.abs(hZahl(hMitte)) < 1e-9, "in der Mitte ist die Korrektur null: " + hMitte);
wahr(/calc\(/.test(garetienSliderMarkePosition(3, 3, 3)), "min === max liefert eine gueltige Position statt NaN");

// =================================================================================================
// H2. garetienEingabenAendern spiegelt Zahl <-> Regler ECHT im DOM -- unabhängig davon, welches der
//     beiden Felder die Eingabe ausgelöst hat. Eigenständig verdrahtet (siehe Kommentar an der
//     Funktion) -- also hier zu prüfen, nicht bei review-labels.js.
// =================================================================================================

const objektH2 = { key: "gi-spiegel:1", subtyp: "huegelland", ziel: "region" };
garetienDetailWaehlen(objektH2.key, [objektH2]);

const idH2 = garetienEingabeId(objektH2, "size");
const nummerElementH2 = macheElement(idH2);
const reglerElementH2 = macheElement(idH2 + "-range");
ELEMENTE[idH2] = nummerElementH2;
ELEMENTE[idH2 + "-range"] = reglerElementH2;

// Der Regler wird gezogen (das Ziel TRÄGT selbst keinen "id"-Vergleichswert -- wie ein echtes
// DOM-Element, das über getElementById NICHT sich selbst zurückbekommt, weil garetienEingabenAendern
// die Geschwister immer per ID nachschlägt).
// 🪤 NAMENSTREU antworten, nicht auf jede Frage "size": eine Attrappe, die jedes Attribut mit
// demselben Wort beantwortet, laesst einen neuen Leser (hier: `data-gi-transport`) einen Wert
// finden, den ein echtes DOM-Element nie liefert -- und der Test bricht dann an einer Stelle, an
// der nichts kaputt ist.
const nurFeld = (name) => (name === "data-gi-feld" ? "size" : null);
const reglerZiel = { getAttribute: nurFeld, hasAttribute: () => true, type: "range", value: "40", id: idH2 + "-range" };
garetienEingabenAendern({ target: reglerZiel }, [objektH2]);
gleich(garetienEingabenZustandZu(objektH2).size, 40, "eine Reglerbewegung wird uebernommen wie eine Zahleingabe");
gleich(nummerElementH2.value, "40", "…und ins ZAHLENFELD gespiegelt, ohne dass jemand es angefasst hat");

// Und umgekehrt: die Zahl wird getippt, der Regler zieht nach.
const nummerZiel = { getAttribute: nurFeld, hasAttribute: () => true, type: "number", value: "12", id: idH2 };
garetienEingabenAendern({ target: nummerZiel }, [objektH2]);
gleich(garetienEingabenZustandZu(objektH2).size, 12, "eine getippte Zahl wird uebernommen");
gleich(reglerElementH2.value, "12", "…und in den REGLER gespiegelt");

garetienDetailWaehlen(null, []);

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

// Ort: seit dem 30.08.2026 die VIER Felder, die avesmapsCreatePointFeature wirklich schreibt --
// unter den Schlüsseln des ANLEGERS, nicht denen des Fensters (isNodix -> is_nodix).
const kOrt = { key: "k1", ziel: "location", subtyp: "dorf" };
garetienEingabenZustandZu(kOrt).isNodix = true;
garetienEingabenZustandZu(kOrt).isHidden = true;
garetienEingabenZustandZu(kOrt).placeKind = "Turm";
assert.deepStrictEqual(garetienEingabenFuerServer(kOrt), {
	is_nodix: true, is_ruined: false, is_hidden: true, place_kind: "Turm",
}, "ein Ort liefert GENAU die vier Karteifelder, keine Label-/Region-Felder");
checks++;
// Weg: seit dem 30.08.2026 die ZWEI Felder, die avesmapsCreatePathFeature wirklich liest.
// 🔴 UNANGETASTET ohne `allowed_transports` -- dann waehlt der Server dieselbe Vorauswahl der
// Wegart wie bisher, und der Anlegeaufruf bleibt zeichengleich zu dem von vorher.
const kWeg = { key: "k2", ziel: "path", subtyp: "Pfad" };
assert.deepStrictEqual(garetienEingabenFuerServer(kWeg), { show_label: false },
	"ein unangetasteter Weg schickt nur show_label mit, KEINE Verkehrsmittel");
garetienEingabenZustandZu(kWeg).transports = ["groupFoot"];
assert.deepStrictEqual(garetienEingabenFuerServer(kWeg),
	{ show_label: false, allowed_transports: ["groupFoot"] },
	"erst eine angefasste Auswahl reist als Liste mit");
checks += 2;

// Berggipfel (ziel='label'): die SECHS Label-Felder (inkl. Nodix seit dieser Aufgabe), aber KEIN
// is_locked/curve_label.
const kBerg = { key: "k3", ziel: "label", subtyp: "berggipfel" };
garetienEingabenZustandZu(kBerg).size = 22;
garetienEingabenZustandZu(kBerg).priority = 1;
garetienEingabenZustandZu(kBerg).minZoom = 2;
garetienEingabenZustandZu(kBerg).maxZoom = 6;
garetienEingabenZustandZu(kBerg).showName = false;
garetienEingabenZustandZu(kBerg).isNodix = true;
const eBerg = garetienEingabenFuerServer(kBerg);
assert.deepStrictEqual(eBerg, {
	size: 22, priority: 1, min_zoom: 2, max_zoom: 6, show_name: false, is_nodix: true,
}, "ein Berggipfel liefert GENAU die sechs Label-Felder, keine Region-Felder: " + JSON.stringify(eBerg));
checks++;

// Fläche (ziel='region'): alle NEUN Felder.
const kFlaeche = { key: "k4", ziel: "region", subtyp: "huegelland" };
const eF = garetienEingabenZustandZu(kFlaeche);
eF.size = 30; eF.priority = 5; eF.minZoom = 1; eF.maxZoom = 4; eF.showName = false;
eF.isLocked = true; eF.curveLabel = true; eF.curveLabelMax = 2; eF.isNodix = false;
const eFlaeche = garetienEingabenFuerServer(kFlaeche);
assert.deepStrictEqual(eFlaeche, {
	size: 30, priority: 5, min_zoom: 1, max_zoom: 4, show_name: false, is_nodix: false,
	is_locked: true, curve_label: true, curve_label_max: 2,
}, "eine Fläche liefert alle NEUN Felder: " + JSON.stringify(eFlaeche));
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

// =================================================================================================
// M. Ein UEBERNOMMENES Objekt (Fuenf-Punkte-Brief 30.08.2026, Punkt 6) -- ALLE Felder werden reine
//    Anzeige, UND ein Hinweis sagt, ob es sich zuruecknehmen laesst (und wenn nicht, warum).
// =================================================================================================

const huegelUebernommenFaehig = Object.assign({}, huegel, {
	key: "ggp:Berge:Huegel:Garetien:Testhuegel-uebernommen-faehig",
	stand: "uebernommen",
	// Ein einzelnes 'new'-Item, bereits ANGEWENDET -- genau der Fall, den garetienRuecknahmeBauen
	// als bedienbar einstuft (garetien-handlungen.test.js, Abschnitt N.1, wegUebernommen).
	items: [{ id: 901, change_type: "new", anlass: null, apply_state: "done" }],
});
const mHuegelFaehig = garetienEingefuegtWirdMarkup(huegelUebernommenFaehig);

// ---- 6a: der Kasten zeigt weiterhin die ECHTEN Steuerelemente -- nur DEAKTIVIERT, nicht entfernt
// (ein Editor soll sehen, was beim Einfuegen galt, auch wenn er es hier nicht mehr aendern kann).
wahr(mHuegelFaehig.includes('type="checkbox"') && mHuegelFaehig.includes('type="number"')
	&& mHuegelFaehig.includes('type="range"'),
	"der Kasten muss weiterhin die echten Steuerelemente zeigen -- nur deaktiviert, nicht entfernt");
[
	["isLocked", "Fläche/für Klicks gesperrt"], ["isNodix", "Nodix"],
	["curveLabel", "Kurvenbeschreibung"], ["showName", "Auf Karte anzeigen"],
].forEach(function ([feld, name]) {
	gleich(istDeaktiviert(mHuegelFaehig, garetienEingabeId(huegelUebernommenFaehig, feld)), true,
		"das Häkchen „" + name + "\" muss bei einem übernommenen Objekt deaktiviert sein");
});
["size", "priority", "minZoom", "maxZoom"].forEach(function (feld) {
	gleich(istDeaktiviert(mHuegelFaehig, garetienEingabeId(huegelUebernommenFaehig, feld)), true,
		"das Zahlenfeld „" + feld + "\" muss bei einem übernommenen Objekt deaktiviert sein");
});

// ---- DIE DIFFERENZ, ohne die die Zusicherungen oben Vakuum waeren: DASSELBE Objekt, NICHT
// übernommen, hat dieselben Felder BEDIENBAR.
const huegelOffen = Object.assign({}, huegel, { key: "ggp:Berge:Huegel:Garetien:Testhuegel-offen" });
const mHuegelOffen = garetienEingefuegtWirdMarkup(huegelOffen);
gleich(istDeaktiviert(mHuegelOffen, garetienEingabeId(huegelOffen, "isLocked")), false,
	"ohne 'uebernommen' bleibt dasselbe Häkchen bedienbar -- die Zusicherungen oben prüfen wirklich etwas");
gleich(istDeaktiviert(mHuegelOffen, garetienEingabeId(huegelOffen, "size")), false,
	"ohne 'uebernommen' bleibt dasselbe Zahlenfeld bedienbar");

// ---- 6b: der Hinweis, RÜCKNAHMEFÄHIGER Fall -- liest DIESELBE Regel wie der Rücknahme-Knopf am
// Fuß der Ansicht (garetienRuecknahmeBauen), formuliert sie nicht neu.
wahr(mHuegelFaehig.includes("Liegt bereits auf der Karte."),
	"der Hinweis muss sagen, dass es schon auf der Karte liegt");
wahr(mHuegelFaehig.includes("Zurücknehmen"),
	"und dass es sich zurücknehmen lässt -- derselbe Knopfname wie am Fuß der Ansicht");
gleich(garetienEingefuegtWirdUebernommenHinweis(huegelOffen), "",
	"ohne 'uebernommen' gibt es keinen Hinweis -- er wäre eine Behauptung über etwas, das nicht gilt");

// ---- 6b, DIE GEGENPROBE: NICHT rücknahmefähig -- WORTGLEICH zum Rücknahme-Knopf, nicht neu
// formuliert (Owner: „Lies dieselbe Regel"). Derselbe Fall wie changedUebernommen in
// garetien-handlungen.test.js: ein 'changed'-Item hat ein bestehendes Objekt verändert, und das
// mitgelieferte 'new'-Zusatz-Item (Owner-Sprache: „trotzdem neu anlegen") wurde nie angewendet --
// GENAU der Fall, der den Kasten trotzdem zeigt (er braucht nur IRGENDEIN 'new'-Item), aber keine
// Rücknahme erlaubt.
const huegelUebernommenUnfaehig = Object.assign({}, huegel, {
	key: "ggp:Berge:Huegel:Garetien:Testhuegel-uebernommen-unfaehig",
	stand: "uebernommen",
	items: [
		{ id: 902, change_type: "changed", felder: ["name"], apply_state: "done" },
		{ id: 903, change_type: "new", anlass: "zusatz", apply_state: "offen" },
	],
});
const mHuegelUnfaehig = garetienEingefuegtWirdMarkup(huegelUebernommenUnfaehig);
wahr(mHuegelUnfaehig.includes("Liegt bereits auf der Karte."),
	"auch hier steht, dass es schon auf der Karte liegt");
wahr(mHuegelUnfaehig.includes("Verändert ein bestehendes Objekt — nicht rücknehmbar."),
	"und WARUM es sich nicht zurücknehmen lässt -- wortgleich zum Rücknahme-Knopf am Fuß");
gleich(
	garetienEingefuegtWirdUebernommenHinweis(huegelUebernommenUnfaehig).includes(
		mod.garetienRuecknahmeBauen(huegelUebernommenUnfaehig).grund
	),
	true,
	"der Hinweis liest WIRKLICH garetienRuecknahmeBauen -- zwei Fassungen derselben Auskunft liefen "
		+ "an diesem Fenster schon einmal auseinander"
);
// Die Felder bleiben deaktiviert -- die Sperre hängt am STAND ('uebernommen'), nicht daran, ob
// sich das Objekt zurücknehmen lässt.
gleich(istDeaktiviert(mHuegelUnfaehig, garetienEingabeId(huegelUebernommenUnfaehig, "isLocked")), true,
	"die Felder bleiben deaktiviert, auch wenn das Objekt NICHT zurücknehmbar ist");

pruefeWikiLandschaftVerdrahtung().then(function () {
	console.log("garetien-eingefuegt-wird: " + checks + " Pruefungen bestanden.");
}).catch(function (fehler) {
	console.error(fehler);
	process.exitCode = 1;
});
