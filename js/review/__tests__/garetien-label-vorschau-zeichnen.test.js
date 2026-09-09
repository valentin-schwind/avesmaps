/*
 * Der ZEICHENWEG der Beschriftungs-Vorschau -- und die Zusicherung, dass er die Bauer der ECHTEN
 * Karte ruft statt einer zweiten Rezeptur.
 * =================================================================================================
 *
 * Owner 09.09.2026: „labels von flaechen siedlungen etc … sollen so erscheinen, wie sie im endprodukt
 * (nach Stage importieren) sichtbar sein wird" und „die labels koennen auch den gelben rand der
 * flaeche + weiss wenn aktiv bekommen".
 *
 * 💣 GEFAHREN, NICHT GELESEN. Ein Quelltext-Test kennt keinen Geltungsbereich und keine
 * Aufrufreihenfolge -- am 03.09.2026 hat genau das die Karte zwei Stunden lang ohne Beschriftungen
 * dastehen lassen, bei gruenem Regex-Test und 14 gefangenen Mutationen. Hier wird der Zeichner mit
 * gefaelschtem Leaflet und gefaelschten Bauern AUSGEFUEHRT.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

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

// ---- Der Pruefstand ----------------------------------------------------------------------------
//
// ⚠️ Attrappen OHNE Proxy. Ein Proxy, der jeden Bezeichner beantwortet, verschluckt genau den
// ReferenceError, der am 03.09.2026 die Karte gekostet hat -- die Attrappen hier antworten nur auf
// das, was sie wirklich kennen.
global.window = global;
global.document = {
	documentElement: {},
	readyState: "complete",
	getElementById() { return null; },
	addEventListener() {},
	querySelectorAll() { return []; },
};
global.getComputedStyle = function () {
	return { getPropertyValue() { return "#f0b429"; } };
};

// Die zwei Bauer der ECHTEN Karte, als Spione. Sie liefern ein Icon in derselben FORM, die Leaflet
// liefert (ein Objekt mit `options.className`) -- mehr braucht der Zeichner von ihnen nicht.
const RUFE = { frei: [], ort: [] };
global.createLabelIcon = function (label) {
	RUFE.frei.push(label);
	return { options: { className: "map-label map-label--" + label.labelType } };
};
global.createLocationNameLabelIcon = function (entry, zoom) {
	RUFE.ort.push({ entry: entry, zoom: zoom });
	return { options: { className: "location-name-label location-name-label--" + entry.locationType } };
};

// Das Zoomband der freien Labels -- die ECHTE Regel wird hier durch eine gestellte ersetzt, weil
// diese Datei die VERDRAHTUNG prueft („wird sie gefragt, mit welchen Werten") und nicht ihre Zahlen.
let BAND_RUFE = [];
global.avesmapsLabelImBand = function (label, zoom) {
	BAND_RUFE.push({ minZoom: label.minZoom, maxZoom: label.maxZoom, zoom: zoom });
	const ab = Number(label.minZoom);
	const bis = Number(label.maxZoom);
	if (!isFinite(ab) || !isFinite(bis)) { return true; }
	return zoom >= ab && zoom <= bis;
};
// Und das Zoomband der ORTSNAMEN: `null` heisst „auf dieser Stufe gibt es den Namen nicht".
// ⚠️ Die zwei Reihen unterscheiden sich BEI ZOOM 4 -- genau dort messen die Zeilen unten. Eine
// Tafel, in der beide Klassen bei der Pruefzoomstufe einen Wert tragen, belegte nur, dass
// irgendetwas entsteht.
const ORTSBAND = { stadt: [null, null, 9, 10, 11, 11], dorf: [null, null, null, null, null, 11] };
let ORTSBAND_RUFE = [];
global.avesmapsLocationZoomBandValue = function (art, klasse, zoom) {
	ORTSBAND_RUFE.push({ art: art, klasse: klasse, zoom: zoom });
	const reihe = ORTSBAND[klasse];
	if (!reihe) { return null; }
	const z = Math.max(0, Math.min(reihe.length - 1, Math.round(Number(zoom) || 0)));
	return reihe[z];
};

// Der Ausschnitt der echten Karte -- gestellt, damit der Riegel „nur was sichtbar ist" messbar wird.
let AUSSCHNITT = { nord: 1000, sued: -1000, ost: 1000, west: -1000 };
global.getMapRenderBounds = function () { return AUSSCHNITT; };
global.isLatLngInRenderBounds = function (latlng, b) {
	return latlng[0] <= b.nord && latlng[0] >= b.sued && latlng[1] <= b.ost && latlng[1] >= b.west;
};

const karteMod = require(path.resolve(__dirname, "..", "review-garetien-karte.js"));
const regelMod = require(path.resolve(__dirname, "..", "review-garetien-label-vorschau.js"));

const {
	garetienVorschauBeschriftungen,
	AVESMAPS_GARETIEN_LABEL_PANE,
	AVESMAPS_GARETIEN_KLASSE_LABEL_VORSCHAU,
	AVESMAPS_GARETIEN_KLASSE_LABEL_AKTIV,
	AVESMAPS_GARETIEN_FELD_VORSCHAU_LABEL,
} = karteMod;

// 💣 DER FELDNAME IST EIN GEKOPPELTER WERT IN ZWEI DATEIEN -- gesetzt im Importer
// (garetienVorschauLabelStempeln), gelesen im Zeichner. Liefe er auseinander, zeichnete der Zeichner
// NICHTS, und zwar still. Hier wird er gegen den Quelltext des Importers gehalten.
const importerQuelle = fs.readFileSync(
	path.join(WURZEL, "js", "review", "review-garetien-importer.js"), "utf8"
);
wahr(importerQuelle.indexOf('AVESMAPS_GARETIEN_FELD_VORSCHAU_LABEL = "'
	+ AVESMAPS_GARETIEN_FELD_VORSCHAU_LABEL + '"') !== -1,
	"der Feldname des Zeichners (" + AVESMAPS_GARETIEN_FELD_VORSCHAU_LABEL + ") steht so nicht im "
	+ "Importer -- dann setzt niemand, was hier gelesen wird");

function gefaelschtesLeaflet() {
	const marken = [];
	return {
		marken: marken,
		marker(stelle, optionen) {
			const m = { _stelle: stelle, options: optionen };
			marken.push(m);
			return m;
		},
	};
}
function gefaelschteKarte(zoom) {
	return {
		panes: {},
		zoom: zoom,
		getZoom() { return this.zoom; },
		createPane(name) {
			this.panes[name] = { name: name, style: {}, classList: { add() {} } };
			return this.panes[name];
		},
		getPane(name) { return this.panes[name]; },
	};
}

// Ein Eintrag der gezeichneten Menge, wie ihn der Importer stempelt.
function eintrag(beschreibung) {
	const o = { key: "k" + Math.random() };
	o[AVESMAPS_GARETIEN_FELD_VORSCHAU_LABEL] = beschreibung;
	return o;
}
function beschreibung(zusatz) {
	return Object.assign({
		art: "frei", text: "Ingvalwald", subtyp: "wald", punkt: [20, 30],
		size: 22, priority: 2, minZoom: 0, maxZoom: 7, gewaehlt: false,
	}, zusatz || {});
}

// ---- 1. Eine Beschriftung je berechtigtem Eintrag, in ihrer eigenen Pane ------------------------
let l = gefaelschtesLeaflet();
let k = gefaelschteKarte(4);
let marken = garetienVorschauBeschriftungen(l, k, [eintrag(beschreibung()), eintrag(null)]);
gleich(marken.length, 1, "genau der Eintrag MIT Beschreibung bekommt eine Marke");
gleich(marken[0].options.pane, AVESMAPS_GARETIEN_LABEL_PANE,
	"sie liegt in der eigenen Pane der Vorschau, nicht in der ihrer Geometrie");
wahr(k.panes[AVESMAPS_GARETIEN_LABEL_PANE] !== undefined,
	"und die Pane wird dabei angelegt -- sonst waere die Marke unsichtbar");
gleich(String(k.panes[AVESMAPS_GARETIEN_LABEL_PANE].style.zIndex),
	String(karteMod.AVESMAPS_GARETIEN_LABEL_PANE_Z),
	"mit ihrem z-Wert");
gleich(k.panes[AVESMAPS_GARETIEN_LABEL_PANE].style.pointerEvents, "none",
	"💣 und UNTAETIG: der Klick gehoert der Flaeche darunter, nicht ihrem Namen");
gleich(marken[0].options.interactive, false,
	"⚠️ auch an der Marke selbst -- ein anklickbarer Name fing die Klicks ab, mit denen ein Editor "
	+ "seine Flaeche oeffnet");

// 💣 [x, y] -> [lat, lng] = [y, x]. Die Falle aus AGENTS.md §5, und sie hat in diesem Vorhaben schon
// einmal jeden importierten Weg gespiegelt. Gemessen an einem Punkt WEIT ab der Diagonale -- auf ihr
// sagt dasselbe Ergebnis gar nichts aus.
gleich(marken[0]._stelle[0], 30, "lat ist y");
gleich(marken[0]._stelle[1], 20, "lng ist x");

// ---- 2. Der GETEILTE Bauer wird gerufen, nicht eine zweite Rezeptur ----------------------------
//
// 🔴 Das ist die tragende Zusicherung dieser Datei. „So wie im Endprodukt" ist nur wahr, solange
// dieselbe Funktion zeichnet, die die echte Karte zeichnet -- eine eigene Fassung waere die zweite
// Wahrheit ueber das Aussehen der Karte (AGENTS.md §5) und liefe beim ersten Umton auseinander.
gleich(RUFE.frei.length, 1, "createLabelIcon der echten Karte wurde gerufen");
gleich(RUFE.frei[0].text, "Ingvalwald", "mit dem Text");
gleich(RUFE.frei[0].labelType, "wald", "mit der Art als `labelType`");
gleich(RUFE.frei[0].size, 22, "mit der Groesse aus dem Kasten");
gleich(RUFE.frei[0].priority, 2, "mit der Prioritaet");
gleich(RUFE.frei[0].rotation, 0,
	"🔴 ohne Drehung -- der Import legt keine an, und ein Wert hier waere erfunden");
gleich(RUFE.frei[0].ecosystemRegionPublicId, "",
	"und ohne Regionszeiger: die Region entsteht erst MIT dem Label");

// ---- 3. Gold, und Weiss dazu, wenn die Zeile offen ist -----------------------------------------
const klassen = String(marken[0].options.icon.options.className).split(/\s+/);
wahr(klassen.indexOf(AVESMAPS_GARETIEN_KLASSE_LABEL_VORSCHAU) !== -1,
	"die Vorschau-Klasse haengt am Icon: " + marken[0].options.icon.options.className);
wahr(klassen.indexOf(AVESMAPS_GARETIEN_KLASSE_LABEL_AKTIV) === -1,
	"ohne offene Zeile KEINE aktive Klasse -- sonst leuchtete die ganze Karte weiss");
// 💣 UND DIE KLASSEN DES BAUERS BLEIBEN STEHEN. Sie tragen Farbe und Schrift der Labelart
// (`map-label--wald`); sie zu ERSETZEN statt zu ergaenzen naehme dem Namen sein Aussehen -- und genau
// das saehe wie ein Erfolg aus, weil der Kasten dann golden leuchtet.
wahr(klassen.indexOf("map-label--wald") !== -1,
	"die Klassen des geteilten Bauers duerfen nicht verloren gehen: " + klassen.join(" "));

l = gefaelschtesLeaflet();
k = gefaelschteKarte(4);
marken = garetienVorschauBeschriftungen(l, k, [eintrag(beschreibung({ gewaehlt: true }))]);
const klassenAktiv = String(marken[0].options.icon.options.className).split(/\s+/);
wahr(klassenAktiv.indexOf(AVESMAPS_GARETIEN_KLASSE_LABEL_VORSCHAU) !== -1
	&& klassenAktiv.indexOf(AVESMAPS_GARETIEN_KLASSE_LABEL_AKTIV) !== -1,
	"🔴 die geoeffnete Zeile traegt BEIDE Klassen -- Weiss ERGAENZT Gold, es ersetzt es nicht");

// ---- 4. Das Zoomband: ausserhalb wird nichts gebaut -------------------------------------------
BAND_RUFE = [];
l = gefaelschtesLeaflet();
k = gefaelschteKarte(4);
marken = garetienVorschauBeschriftungen(l, k, [eintrag(beschreibung({ minZoom: 6, maxZoom: 7 }))]);
gleich(marken.length, 0,
	"bei Zoom 4 und Band 6-7 entsteht keine Beschriftung -- nach dem Import genauso");
gleich(BAND_RUFE.length, 1, "und gefragt wurde die Regel der ECHTEN Karte, nicht eine eigene");
gleich(BAND_RUFE[0].zoom, 4, "mit der Zoomstufe der Karte");
gleich(BAND_RUFE[0].minZoom, 6, "und dem Band aus dem Kasten");

// ---- 5. Der ORTSNAME laeuft ueber seinen eigenen Bauer und sein eigenes Band -------------------
ORTSBAND_RUFE = [];
l = gefaelschtesLeaflet();
k = gefaelschteKarte(4);
marken = garetienVorschauBeschriftungen(l, k, [
	eintrag(beschreibung({ art: "ort", subtyp: "stadt", text: "Warunk" })),
	// Ein Dorf hat bei Zoom 4 keinen Namen (`null` in der Tafel) -- die Gegenprobe, ohne die die
	// Zeile darueber nur belegte, dass irgendetwas entsteht.
	eintrag(beschreibung({ art: "ort", subtyp: "dorf", text: "Kleindorf" })),
]);
gleich(marken.length, 1, "die Stadt bekommt bei Zoom 4 ihren Namen, das Dorf nicht");
gleich(RUFE.ort.length, 1, "und zwar ueber createLocationNameLabelIcon der echten Karte");
gleich(RUFE.ort[0].entry.name, "Warunk", "mit dem Namen");
gleich(RUFE.ort[0].entry.locationType, "stadt", "mit der Ortsklasse");
gleich(RUFE.ort[0].zoom, 4, "und der Zoomstufe -- daraus holt der Bauer Groesse UND Versatz");
gleich(RUFE.ort[0].entry.publicId, "",
	"🔴 ohne `publicId`: der Ort hat noch keine, und ein erfundener Wert koennte in einem Pruefhaken "
	+ "landen, der ihn fuer echt haelt");
gleich(ORTSBAND_RUFE[0].art, "label",
	"gefragt wird das LABEL-Band des Ortes, nicht das seines Markers");

// ---- 6. Ausserhalb des Ausschnitts wird NICHT gebaut ------------------------------------------
//
// 💣 Das ist keine Optimierung, sondern die Bedingung, unter der das Fenster benutzbar bleibt: fuer
// die Stage gibt es keinen Deckel, „Alle markieren" fasst bis zu 1000 Zeilen, und jede Beschriftung
// ist ein Canvas plus ein synchrones `toDataURL`. Die echte Ortsnamen-Kette ist genau deswegen lazy
// geworden -- vorher ein einzelner ~5-s-Longtask beim Start.
const rufeVorher = RUFE.frei.length;
AUSSCHNITT = { nord: 10, sued: -10, ost: 10, west: -10 };
l = gefaelschtesLeaflet();
k = gefaelschteKarte(4);
marken = garetienVorschauBeschriftungen(l, k, [eintrag(beschreibung({ punkt: [500, 500] }))]);
gleich(marken.length, 0, "ein Objekt weit ausserhalb bekommt keine Beschriftung");
gleich(RUFE.frei.length, rufeVorher,
	"⚠️ und der Bauer wurde GAR NICHT gerufen -- die Pruefung steht VOR ihm, nicht danach");
AUSSCHNITT = { nord: 1000, sued: -1000, ost: 1000, west: -1000 };

// ---- 7. Nichts landet in den Registries der echten Karte --------------------------------------
//
// 💣 DIE REGRESSION, DIE DEN SPOTLIGHT VERGIFTEN WUERDE. `labelMarkers` liest die Suche
// (spotlight-search.js) -- eine Vorschau waere dort auffindbar, ein Ort, den es nicht gibt.
// `locationNameLabels` liest der Kollisionsloeser, und die Teilnahme daran ist ausdruecklich nicht
// bestellt („Vorschau liegt oben drauf").
global.labelMarkers = [];
global.locationNameLabels = [];
l = gefaelschtesLeaflet();
k = gefaelschteKarte(4);
garetienVorschauBeschriftungen(l, k, [
	eintrag(beschreibung()),
	eintrag(beschreibung({ art: "ort", subtyp: "stadt", text: "Warunk" })),
]);
gleich(global.labelMarkers.length, 0, "keine Vorschau in `labelMarkers` -- sonst wird sie suchbar");
gleich(global.locationNameLabels.length, 0,
	"und keine in `locationNameLabels` -- sonst nimmt sie am Kollisionsloeser teil");
// Die zweite Haelfte: der Zeichner darf sie nicht SCHREIBEN. Der Laufzeit-Test oben deckt nur die
// Wege ab, die er faehrt; diese Zeile deckt jeden.
// 🪤 Und sie fragt nach der gefaehrlichen FORM, nicht nach dem Namen. Der erste Versuch verbot das
// Wort „labelMarkers" im Quelltext ueberhaupt -- und fiel an den KOMMENTAREN des Zeichners um, die
// ausdruecklich erklaeren, warum dort nichts eingetragen wird. Ein Test, der die Begruendung einer
// Regel als Verstoss liest, zwingt dazu, die Begruendung zu loeschen.
const karteQuelle = fs.readFileSync(
	path.join(WURZEL, "js", "review", "review-garetien-karte.js"), "utf8"
);
["labelMarkers", "locationNameLabels"].forEach((registry) => {
	const schreibend = new RegExp(registry + "\\s*(?:=[^=]|\\.push\\(|\\.unshift\\(|\\.splice\\()");
	wahr(!schreibend.test(karteQuelle),
		"der Zeichner darf `" + registry + "` nicht schreiben -- ein Eintrag dort macht die Vorschau "
		+ "suchbar bzw. zum Teilnehmer des Kollisionsloesers");
	// Gegenprobe, dass das Muster ueberhaupt etwas finden KANN -- sonst ist die Zeile darueber Vakuum.
	wahr(schreibend.test(registry + ".push(x)") && schreibend.test(registry + " = []"),
		"das Suchmuster fuer " + registry + " trifft nicht einmal einen echten Schreibvorgang");
});

// ---- 8. Alles faellt OFFEN aus ----------------------------------------------------------------
//
// ⚠️ Der Zeichner wird im Test ALLEIN geladen und im Browser vor den Kartenmodulen -- fehlt ein
// Bauer, entsteht keine Beschriftung, nie ein Wurf. Eine fehlende Vorschau ist der bisherige
// Zustand; ein Wurf hier naehme die ganze Karte mit.
const bauerFrei = global.createLabelIcon;
delete global.createLabelIcon;
l = gefaelschtesLeaflet();
gleich(garetienVorschauBeschriftungen(l, gefaelschteKarte(4), [eintrag(beschreibung())]).length, 0,
	"ohne createLabelIcon entsteht nichts -- und es wirft nicht");
global.createLabelIcon = bauerFrei;

const bandFrei = global.avesmapsLabelImBand;
delete global.avesmapsLabelImBand;
l = gefaelschtesLeaflet();
wahr(garetienVorschauBeschriftungen(l, gefaelschteKarte(4), [eintrag(beschreibung())]).length === 1,
	"⚠️ ohne die Bandregel wird GEZEICHNET, nicht geschwiegen -- die sichere Richtung ist hier „zu "
	+ "viel gezeigt\", nicht „stumm\"");
global.avesmapsLabelImBand = bandFrei;

gleich(garetienVorschauBeschriftungen(null, gefaelschteKarte(4), [eintrag(beschreibung())]).length, 0,
	"ohne Leaflet entsteht nichts");
gleich(garetienVorschauBeschriftungen(gefaelschtesLeaflet(), null, [eintrag(beschreibung())]).length, 0,
	"ohne Karte auch nicht");
gleich(garetienVorschauBeschriftungen(gefaelschtesLeaflet(), gefaelschteKarte(NaN),
	[eintrag(beschreibung())]).length, 0,
	"und ohne brauchbare Zoomstufe ebenso -- jede Bandregel braucht sie");

// ---- 9. Das Blatt: zwei Regeln, nur Tokens, und die aktive traegt BEIDE Schatten ---------------
const kartenCss = fs.readFileSync(
	path.join(WURZEL, "css", "components", "garetien-importer.css"), "utf8"
);
const regelGold = (kartenCss.match(/\.gi-label-vorschau\s*\{[^}]*\}/) || [""])[0];
wahr(regelGold !== "", "die Regel fuer .gi-label-vorschau fehlt -- der Name leuchtet dann nicht");
wahr(/var\(--color-marker-active\)/.test(regelGold),
	"🔴 dasselbe Gold wie der Hof ihrer Geometrie, aus dem Token: " + regelGold);
const regelAktiv = (kartenCss.match(/\.gi-label-vorschau\.gi-label-vorschau--aktiv\s*\{[^}]*\}/) || [""])[0];
wahr(regelAktiv !== "", "die kombinierte Regel fuer die aktive Fassung fehlt");
// 💣 EINE Deklaration mit ZWEI verketteten Schatten. `filter` ist eine einzige Eigenschaft -- eine
// zweite Regel daneben LOESCHTE das Gold statt es zu ergaenzen. Genau diese Falle steht am
// Kollisions-Hof ein paar Zeilen weiter ausgeschrieben.
const schatten = (regelAktiv.match(/drop-shadow\(/g) || []).length;
gleich(schatten, 2,
	"die aktive Regel muss BEIDE Schatten in EINER Deklaration tragen (gefunden: " + schatten
	+ ") -- sonst loescht Weiss das Gold: " + regelAktiv);
wahr(/var\(--color-marker-active\)/.test(regelAktiv)
	&& /var\(--color-garetien-auswahl\)/.test(regelAktiv),
	"und zwar Gold UND das Weiss der Auswahlkontur: " + regelAktiv);
// ⚠️ Der weisse Radius liegt AUSSEN um den goldenen -- sonst verschwindet er darin. Gemessen an den
// zwei Zahlen der Regel selbst, nicht an einer abgeschriebenen Erwartung.
const radien = (regelAktiv.match(/drop-shadow\(\s*0\s+0\s+(\d+)px/g) || [])
	.map((s) => Number((s.match(/(\d+)px/) || [])[1]));
gleich(radien.length, 2, "beide Radien muessen lesbar sein");
wahr(radien[1] > radien[0],
	"der weisse Radius (" + radien[1] + ") muss groesser sein als der goldene (" + radien[0]
	+ ") -- dieselbe Ordnung wie Kontur ueber Hof bei der Geometrie");
wahr(!/#[0-9a-fA-F]{3,8}\b/.test(regelGold + regelAktiv) && !/\brgba?\(/.test(regelGold + regelAktiv),
	"kein hartkodierter Farbwert in den zwei Regeln (AGENTS.md §12)");
wahr(/#[0-9a-fA-F]{3,8}\b/.test(".x { color: #abcdef; }"),
	"das Farbmuster findet nicht einmal eine echte Farbe -- dann ist die Zeile darueber Vakuum");

// ---- 10. Die Verdrahtung im Importer ----------------------------------------------------------
//
// 💣 Der Stempel muss NACH `garetienGewaehltStempeln` laufen: die weisse Fassung haengt an
// `gewaehlt`. Liefe er davor, laese er das Feld, bevor es gesetzt ist -- die geoeffnete Zeile bekaeme
// ihren Namen golden statt weiss, und zwar STILL.
const ausgang = (importerQuelle.match(/return garetienVorschauLabelStempeln\([\s\S]{0,200}?\);/) || [""])[0];
wahr(ausgang !== "", "der Vorschau-Stempel steht nicht am Ausgang von avesmapsGaretienAufDerKarte");
wahr(ausgang.indexOf("garetienGewaehltStempeln") !== -1
	&& ausgang.indexOf("garetienVorschauLabelStempeln(") < ausgang.indexOf("garetienGewaehltStempeln"),
	"💣 der Vorschau-Stempel muss den Gewaehlt-Stempel UMSCHLIESSEN, sonst ist `gewaehlt` noch nicht "
	+ "gesetzt: " + ausgang);
// Und der Kartenruf an den Feldern des Kastens -- ohne ihn tut der Haken gefuehlt nichts.
wahr(/AVESMAPS_GARETIEN_VORSCHAU_FELDER\s*=\s*\[[^\]]*"showName"[^\]]*\]/.test(importerQuelle),
	"„showName\" muss in der Liste der nachziehenden Felder stehen");
["size", "priority", "minZoom", "maxZoom", "zielForm", "zielArt"].forEach((feld) => {
	wahr(new RegExp('AVESMAPS_GARETIEN_VORSCHAU_FELDER\\s*=\\s*\\[[^\\]]*"' + feld + '"')
		.test(importerQuelle), "„" + feld + "\" fehlt in der Liste der nachziehenden Felder");
});
gleich((importerQuelle.match(/garetienVorschauNachziehen\(feld\);/g) || []).length, 3,
	"⚠️ DREI Ausgaenge von garetienEingabenAendern fuehren an beschriftungsrelevanten Feldern vorbei "
	+ "(Formwahl, Haekchen, Zahl) -- fehlt einer, wirkt genau dieses Feld erst spaeter");

// ---- 11. Die Datei ist eingebunden, und zwar VOR dem Importer, der sie ruft --------------------
const indexHtml = fs.readFileSync(path.join(WURZEL, "index.html"), "utf8");
// 🪤 Kommentare weg: ein Dateipfad in einem HTML-Kommentar ist fuer ein `indexOf` ein frueheres
// <script>-Tag -- daran ist `zoomstufe-anzeige.test.js` schon umgefallen.
const ohneKommentare = indexHtml.replace(/<!--[\s\S]*?-->/g, "");
const stelleRegel = ohneKommentare.indexOf("review-garetien-label-vorschau.js");
const stelleImporter = ohneKommentare.indexOf("review-garetien-importer.js");
wahr(stelleRegel !== -1, "die neue Datei ist in index.html nicht eingebunden");
wahr(stelleRegel < stelleImporter,
	"sie muss VOR review-garetien-importer.js stehen -- jener ruft sie beim Stempeln");

console.log(`garetien-label-vorschau-zeichnen: ${checks} Pruefungen bestanden.`);
