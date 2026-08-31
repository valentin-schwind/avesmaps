const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// ✅ DER KONKRETE FALL IST ERLEDIGT (gemessen 26.08.2026 an der Live-Nutzlast): das Duplikat
// `aafcf138` steht nicht mehr in `map_features`, uebrig ist genau EIN Label „Drei Schwestern"
// (`cc223529`) mit Band 4..7. Behoben wurden also die DATEN, nicht der Code -- die Mechanik unten
// steht unveraendert und greift wieder, sobald irgendwo ein zweites gleichnamiges Punkt-Label
// entsteht. Genau dafuer bleibt dieser Test stehen: er prueft die MECHANIK, nicht den Einzelfall,
// und er waere auch dann gruen, wenn es das Duplikat noch gaebe.
//
// Fall #83 („Unsichtbare Berg-Labels", Tigersprung, 20.08.2026): der Gipfel „Drei Schwestern" liegt
// doppelt in `map_features` -- zwei Labels vom Typ `berggipfel`, beide mit dem Wiki-Artikel
// `drei-schwestern`. Die Kartensuche findet beide (sie liest labelMarkers, nicht die Karte), gezeichnet
// wird aber nur eines. Dieser Test haelt die MECHANIK fest, mit der das zustande kommt -- damit der
// naechste Leser nicht wieder danach sucht, und damit niemand eine der beiden Haelften
// „wegoptimiert", ohne die andere zu kennen.
//
// 🔴 Es waren ZWEI Haelften, und nur beide zusammen ergaben „auf KEINER Stufe sichtbar":
//   (1) innerhalb seines Zoombands verlor das zweite Label die Kollision (display:none),
//   (2) die Stufen, auf denen Platz waere (6 und 7), liegen ausserhalb seines Bands (max_zoom = 5).
// Faellt eine der beiden weg, ist das Label irgendwo sichtbar. Genau das ist bei seinen Nachbarn der
// Fall: „Finsterkopp" und „Hoher Stumpen" kollidieren bei Zoom 5 ebenfalls, tauchen aber bei Zoom 6/7
// auf, weil ihr Band bis 7 reicht.
//
// ✅ HAELFTE (1) IST AM 31.08.2026 GEFALLEN, und die Abschnitte 1 und 2 unten sind deshalb
// UMGEDREHT. Ein freies Kartenlabel bekam bis dahin neun feste Ausweichstellen mit hoechstens
// ±12 px waagerecht und ±8 px senkrecht -- bei 171 px Namensbreite und 47 px Ankerabstand half das
// nie, und das zweite Label verschwand. Seither weicht es auf einem RING aus (Schrittweite
// „Versatz", gedeckelt durch „Drift", einstellbar im Fenster „Darstellung" des Regioneneditors):
// die gemessene Lage loest sich mit 24 px nach unten, das Label bleibt stehen.
// Entwurf: docs/superpowers/specs/2026-08-31-landschaften-label-kollision-design.md
// ⚠️ Haelfte (2) ist unberuehrt -- Abschnitt 4 prueft sie weiterhin.
//
// 💣 DIE ZAHLEN SIND GEMESSEN, NICHT GESCHAETZT. Live auf https://avesmaps.de am 20.08.2026,
// Zoom 5, devicePixelRatio 1: das Label-Bild eines `berggipfel` mit dem Text „Drei Schwestern" ist
// 171 x 60 px gross, und die beiden Anker liegen 59 px waagerecht und 47 px senkrecht auseinander
// (Kartenkoordinaten 525.914/647.766 gegen 524.063/646.313, also 1.851 x 1.453 Einheiten mal 2^5).
// Wer sie „aufraeumt", nimmt dem Test seinen Beleg.
//
// Lauf (aus dem Wurzelverzeichnis):  node js/map-features/__tests__/label-kollision-zoomband.test.js

const loadBrowserScript = (absolutePath) => {
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};

// ---- Gemessene Groessen (live, 20.08.2026) -------------------------------------------------------
const GIPFEL_LABEL_BREITE = 171;   // px, Label-Bild „Drei Schwestern" bei Zoom 5
const GIPFEL_LABEL_HOEHE = 60;     // px, dito -- darin 2 x 11 px Polsterung fuer die Gipfel-Spitze
const ABSTAND_X = 59;              // px, Anker A -> Anker B bei Zoom 5
const ABSTAND_Y = 47;              // px, dito

global.window = {};
global.location = { search: "" };
global.document = { getElementById: () => null };

// „Repel" und „Versatz" kommen seit dem 16.08.2026 aus dem Zoombaender-Fenster; hier die Vorgaben.
global.avesmapsLocationLabelSpacing = (name) => (name === "repel" ? 2 : 8);
global.avesmapsLocationZoomBandMinZoom = () => 0;
global.LOCATION_LABEL_GAP = 6;
global.locationNameLabels = [];
global.regionLabels = [];

// Ein Karten-Label so, wie die Kollisionsaufloesung es anfasst: die Klassenliste, das <img> mit
// seiner Box und ein style.setProperty, das den gesetzten Versatz MITSCHREIBT.
// ⚠️ Bis zum 31.08.2026 schrieb es ins Leere („der Versatz ist hier nicht Gegenstand") -- seither
// ist er es sehr wohl: die Frage ist nicht mehr nur „verschwindet das Label", sondern „WOHIN weicht
// es aus". Ein Test, der nur das Verschwinden misst, kann ein Ausweichen an die falsche Stelle
// nicht von einem an die richtige unterscheiden.
function macheLabelElement(box) {
	const klassen = new Set(["leaflet-marker-icon", "map-label"]);
	const bild = { getBoundingClientRect: () => ({ ...box }) };
	const gesetzt = {};
	return {
		classList: {
			contains: (name) => klassen.has(name),
			add: (name) => klassen.add(name),
			remove: (name) => klassen.delete(name),
		},
		querySelector: (auswahl) => (auswahl === "img" ? bild : null),
		style: { setProperty(name, wert) { gesetzt[name] = wert; } },
		istVersteckt: () => klassen.has("is-colliding"),
		versatz: () => [gesetzt["--label-offset-x"], gesetzt["--label-offset-y"]],
	};
}

function macheBox(links, oben, breite, hoehe) {
	return { left: links, top: oben, right: links + breite, bottom: oben + hoehe, width: breite, height: hoehe };
}

// Ein Eintrag aus labelMarkers: das Label selbst plus sein Leaflet-Marker.
function macheLabelEintrag({ publicId, text, minZoom, maxZoom, box, ecosystemRegionPublicId = "" }) {
	const element = macheLabelElement(box);
	return {
		label: {
			publicId, text, labelType: "berggipfel", size: 18, rotation: 0,
			minZoom, maxZoom, priority: 3, showName: true, ecosystemRegionPublicId,
		},
		marker: { getElement: () => element, getLatLng: () => ({ lat: 0, lng: 0 }) },
		element,
	};
}

global.map = { hasLayer: () => true, getZoom: () => 5 };

// 🪤 label-placement.js traegt seit 46dd00b5 (22.08.2026, „das Platzierungsverfahren nur noch
// EINMAL") das expandRect, das measureLabelCollisionRect benutzt. Dieser Test ist zwei Tage
// aelter und lud es nicht -- er brach danach mit ReferenceError, nicht an einer Zusicherung.
loadBrowserScript(path.join(__dirname, "../label-placement.js"));
// 🪤 UND SEIT DEM 31.08.2026 AUCH DIE DARSTELLUNGSTAFEL DER LANDSCHAFTEN: resolveLabelCollisions
// holt Repel, Versatz und Drift der freien Kartenlabels ueber avesmapsEcosystemDisplayAbstand.
// Sie wird ECHT geladen und nicht gestubbt -- ein Stub hier hiesse, den Test gegen erfundene
// Vorgabewerte zu fahren, waehrend die Karte mit anderen laeuft.
loadBrowserScript(path.join(__dirname, "../ecosystem-display.js"));
avesmapsEcosystemDisplayInstall(null);
loadBrowserScript(path.join(__dirname, "../map-features-label-collisions.js"));
loadBrowserScript(path.join(__dirname, "../map-features-labels.js"));

// NACH dem Laden stubben: beide stehen in den geprueften Dateien und wuerden einen Stub von vorher
// ueberschreiben. Der Kartenausschnitt und die Ansichts-Weiche sind nicht Gegenstand dieses Tests.
global.isLatLngInRenderBounds = () => true;
global.getMapRenderBounds = () => ({});
global.getSelectedMapLayerMode = () => "deregraphic";
global.MAP_LABEL_MODES = ["deregraphic", "ecosystem"];

// ---- 1. Zwei gleich grosse Gipfel-Labels 59 x 47 px auseinander: das zweite WEICHT AUS ----------
// Das ist die gemessene Lage bei Zoom 5.
// 🔴 UMGEDREHT AM 31.08.2026. Vorher probierte der Loeser neun Versatzstellen (±8 / ±12 px), von
// denen keine die 171 px Breite bzw. die 60 px Hoehe aus dem Weg schaffte -- das zweite Label
// verschwand. Jetzt waechst ein Ring in Schritten von 8 px bis zum Deckel 56.
//
// 💣 DIE 24 IST NACHGERECHNET, NICHT ABGELESEN: mit Repel 2 sind die Kaesten 175 x 64 gross und
// ueberlappen senkrecht um 17 px (A unten 367, B oben 350). Der Ring geht SENKRECHT ZUERST, also
// werden -8/+8/-16/+16 probiert -- +16 laesst noch 1 px Ueberlappung -- und +24 ist die erste freie
// Stelle. Ihr Drift ist 24 und liegt damit unter dem Deckel 56.
{
	const ersteBox = macheBox(584, 305, GIPFEL_LABEL_BREITE, GIPFEL_LABEL_HOEHE);
	const zweiteBox = macheBox(584 - ABSTAND_X, 305 + ABSTAND_Y, GIPFEL_LABEL_BREITE, GIPFEL_LABEL_HOEHE);
	const erstes = macheLabelEintrag({ publicId: "cc223529", text: "Drei Schwestern", minZoom: 4, maxZoom: 7, box: ersteBox });
	const zweites = macheLabelEintrag({ publicId: "aafcf138", text: "Drei Schwestern", minZoom: 4, maxZoom: 5, box: zweiteBox });
	global.labelMarkers = [erstes, zweites];

	resolveLabelCollisions([]);

	assert.strictEqual(erstes.element.istVersteckt(), false,
		"das zuerst platzierte Label bleibt stehen");
	assert.deepStrictEqual(erstes.element.versatz(), ["0px", "0px"],
		"und zwar auf seinem Punkt -- es musste nirgendwohin");
	assert.strictEqual(zweites.element.istVersteckt(), false,
		"das zweite verschwindet NICHT mehr -- es hat jetzt echten Ausweichraum");
	assert.deepStrictEqual(zweites.element.versatz(), ["0px", "24px"],
		"es rueckt 24 px nach unten: die erste freie Stelle des Rings, senkrecht zuerst");
}

// ---- 1b. Der Deckel entscheidet, ob es ausweichen DARF -------------------------------------------
// 🔴 Die Gegenprobe zu 1: dieselbe Lage, aber ein Deckel unter 24. Dann findet das zweite Label
// keine erlaubte Stelle mehr und verschwindet -- das alte Verhalten, jetzt aber als EINSTELLUNG
// und nicht als eingebaute Grenze. Damit haengt genau eine Zahl zwischen „steht" und „weg".
{
	avesmapsEcosystemDisplayInstall({ abstaende: { drift: 16 } });
	const ersteBox = macheBox(584, 305, GIPFEL_LABEL_BREITE, GIPFEL_LABEL_HOEHE);
	const zweiteBox = macheBox(584 - ABSTAND_X, 305 + ABSTAND_Y, GIPFEL_LABEL_BREITE, GIPFEL_LABEL_HOEHE);
	const erstes = macheLabelEintrag({ publicId: "cc223529", text: "Drei Schwestern", minZoom: 4, maxZoom: 7, box: ersteBox });
	const zweites = macheLabelEintrag({ publicId: "aafcf138", text: "Drei Schwestern", minZoom: 4, maxZoom: 5, box: zweiteBox });
	global.labelMarkers = [erstes, zweites];

	resolveLabelCollisions([]);

	assert.strictEqual(zweites.element.istVersteckt(), true,
		"mit Deckel 16 bleibt keine freie Stelle -> ausgeblendet (.map-label.is-colliding => display:none)");
	avesmapsEcosystemDisplayInstall(null);
}

// ---- 2. Die Reihenfolge entscheidet, und sie ist bei Gleichstand die Nutzlast-Reihenfolge ---------
// Beide haben dieselbe Prioritaet (3) und dieselbe Erscheinungsstufe (4). Die Sortierung in
// resolveLabelCollisions ist stabil, also gewinnt, wer in labelMarkers frueher steht -- und das ist
// die Reihenfolge aus `ORDER BY sort_order ASC, id ASC` der Kartennutzlast. Deshalb sehen ZWEI
// Besucher dasselbe: der Fall ist reproduzierbar, kein Zufall und kein Cache-Effekt.
//
// 🔴 SEIT DEM 31.08.2026 entscheidet sie, WER AUF SEINEM PUNKT STEHENBLEIBT -- nicht mehr, wer
// ueberlebt. Der Verlierer weicht aus, statt zu verschwinden. Die Reihenfolge ist damit weiterhin
// sichtbar, aber sie kostet keinen Namen mehr.
{
	const ersteBox = macheBox(584, 305, GIPFEL_LABEL_BREITE, GIPFEL_LABEL_HOEHE);
	const zweiteBox = macheBox(584 - ABSTAND_X, 305 + ABSTAND_Y, GIPFEL_LABEL_BREITE, GIPFEL_LABEL_HOEHE);
	const erstes = macheLabelEintrag({ publicId: "cc223529", text: "Drei Schwestern", minZoom: 4, maxZoom: 7, box: ersteBox });
	const zweites = macheLabelEintrag({ publicId: "aafcf138", text: "Drei Schwestern", minZoom: 4, maxZoom: 5, box: zweiteBox });
	global.labelMarkers = [zweites, erstes];   // umgedrehte Nutzlast-Reihenfolge

	resolveLabelCollisions([]);

	assert.deepStrictEqual(zweites.element.versatz(), ["0px", "0px"],
		"jetzt behaelt das andere seinen Punkt");
	// ⚠️ NACH OBEN, nicht nach unten: das zuerst platzierte liegt hier TIEFER, die freie Seite ist
	// also die obere. Von Hand zuerst falsch angesetzt -- der Testlauf hat es korrigiert.
	assert.deepStrictEqual(erstes.element.versatz(), ["0px", "-24px"],
		"und das vorher stehende weicht aus, statt zu verschwinden");
	assert.strictEqual(erstes.element.istVersteckt(), false, "beide bleiben sichtbar");
	assert.strictEqual(zweites.element.istVersteckt(), false, "beide bleiben sichtbar");
}

// ---- 3. Die Ausnahme, die es schon gibt: Labels DERSELBEN Flaeche duerfen einander ueberlappen ----
// 🔴 Owner 2026-07-28, siehe getCollisionEntries: der Finsterkamm traegt seinen Namen im Norden UND im
// Sueden. Die Ausnahme haengt an `ecosystem_region_public_id` -- also an einer FLAECHE. Ein
// `berggipfel` ist ein PUNKT und hat keine; die beiden „Drei Schwestern" tragen den Schluessel live
// nicht (gemessen 20.08.2026), fallen deshalb nicht darunter und kollidieren.
{
	const ersteBox = macheBox(584, 305, GIPFEL_LABEL_BREITE, GIPFEL_LABEL_HOEHE);
	const zweiteBox = macheBox(584 - ABSTAND_X, 305 + ABSTAND_Y, GIPFEL_LABEL_BREITE, GIPFEL_LABEL_HOEHE);
	const erstes = macheLabelEintrag({ publicId: "a", text: "Finsterkamm", minZoom: 4, maxZoom: 7, box: ersteBox, ecosystemRegionPublicId: "region-1" });
	const zweites = macheLabelEintrag({ publicId: "b", text: "Finsterkamm", minZoom: 4, maxZoom: 7, box: zweiteBox, ecosystemRegionPublicId: "region-1" });
	global.labelMarkers = [erstes, zweites];

	resolveLabelCollisions([]);

	assert.strictEqual(erstes.element.istVersteckt(), false, "beide Labels derselben Flaeche bleiben stehen");
	assert.strictEqual(zweites.element.istVersteckt(), false, "auch das zweite");
	// 🔴 UND ZWAR AUF IHREN PUNKTEN, ohne auszuweichen: sie blockieren einander gar nicht erst.
	// 💣 DIESE HAELFTE VON `gruppe` IST GEBLIEBEN. Die andere -- „ein Flaechen-Label wird nie
	// ausgeblendet" -- ist am 31.08.2026 gefallen; beide hingen an derselben Zeile im Loeser.
	// Wer sie wieder zusammenzieht, nimmt dem Finsterkamm seinen zweiten Namen.
	assert.deepStrictEqual(erstes.element.versatz(), ["0px", "0px"], "keines weicht dem anderen aus");
	assert.deepStrictEqual(zweites.element.versatz(), ["0px", "0px"], "sie duerfen einander ueberlappen");
}

// ---- 4. Die zweite Haelfte: das Zoomband schneidet die Stufen weg, auf denen Platz waere ----------
// Bei Zoom 6 und 7 liegen die beiden Anker 118 bzw. 237 px auseinander -- da passen beide Labels
// nebeneinander (live gemessen: „Finsterkopp" und „Hoher Stumpen" tauchen dort auf). Das zweite
// „Drei Schwestern" kommt dort aber gar nicht erst auf die Karte, weil sein Band bei 5 endet.
{
	const eintrag = macheLabelEintrag({
		publicId: "aafcf138", text: "Drei Schwestern", minZoom: 4, maxZoom: 5,
		box: macheBox(0, 0, GIPFEL_LABEL_BREITE, GIPFEL_LABEL_HOEHE),
	});
	const sichtbarBei = (zoom) => shouldShowLabelMarker(eintrag, zoom, {}, null);

	assert.strictEqual(sichtbarBei(3), false, "unter der Erscheinungsstufe: nicht gezeichnet");
	assert.strictEqual(sichtbarBei(4), true, "im Band: gezeichnet -- dort entscheidet dann die Kollision");
	assert.strictEqual(sichtbarBei(5), true, "im Band: gezeichnet -- dort entscheidet dann die Kollision");
	assert.strictEqual(sichtbarBei(6), false, "ueber dem Band: gar nicht erst auf der Karte");
	assert.strictEqual(sichtbarBei(7), false, "ueber dem Band: gar nicht erst auf der Karte");

	const nachbarMitVollemBand = macheLabelEintrag({
		publicId: "7beeb413", text: "Finsterkopp", minZoom: 5, maxZoom: 7,
		box: macheBox(0, 0, GIPFEL_LABEL_BREITE, GIPFEL_LABEL_HOEHE),
	});
	assert.strictEqual(shouldShowLabelMarker(nachbarMitVollemBand, 7, {}, null), true,
		"der Nachbar mit Band bis 7 erreicht die Stufe, auf der Platz ist -- genau darin unterscheiden sich die beiden");
}

console.log("label-kollision-zoomband.test.js: alle Zusicherungen erfuellt");
