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
// 🔴 Es sind ZWEI Haelften, und nur beide zusammen ergeben „auf KEINER Stufe sichtbar":
//   (1) innerhalb seines Zoombands verliert das zweite Label die Kollision (display:none),
//   (2) die Stufen, auf denen Platz waere (6 und 7), liegen ausserhalb seines Bands (max_zoom = 5).
// Faellt eine der beiden weg, ist das Label irgendwo sichtbar. Genau das ist bei seinen Nachbarn der
// Fall: „Finsterkopp" und „Hoher Stumpen" kollidieren bei Zoom 5 ebenfalls, tauchen aber bei Zoom 6/7
// auf, weil ihr Band bis 7 reicht.
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

// Ein Karten-Label so, wie die Kollisionsaufloesung es anfasst: die Klassenliste, das <img> mit seiner
// Box und ein style.setProperty, das ins Leere schreibt (der Versatz ist hier nicht Gegenstand).
function macheLabelElement(box) {
	const klassen = new Set(["leaflet-marker-icon", "map-label"]);
	const bild = { getBoundingClientRect: () => ({ ...box }) };
	return {
		classList: {
			contains: (name) => klassen.has(name),
			add: (name) => klassen.add(name),
			remove: (name) => klassen.delete(name),
		},
		querySelector: (auswahl) => (auswahl === "img" ? bild : null),
		style: { setProperty() {} },
		istVersteckt: () => klassen.has("is-colliding"),
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
loadBrowserScript(path.join(__dirname, "../map-features-label-collisions.js"));
loadBrowserScript(path.join(__dirname, "../map-features-labels.js"));

// NACH dem Laden stubben: beide stehen in den geprueften Dateien und wuerden einen Stub von vorher
// ueberschreiben. Der Kartenausschnitt und die Ansichts-Weiche sind nicht Gegenstand dieses Tests.
global.isLatLngInRenderBounds = () => true;
global.getMapRenderBounds = () => ({});
global.getSelectedMapLayerMode = () => "deregraphic";
global.MAP_LABEL_MODES = ["deregraphic", "ecosystem"];

// ---- 1. Zwei gleich grosse Gipfel-Labels 59 x 47 px auseinander: das zweite verschwindet ----------
// Das ist die gemessene Lage bei Zoom 5. Der Loeser probiert neun Versatzstellen (+-8 / +-12 px);
// keine schafft die 171 px Breite bzw. die 60 px Hoehe aus dem Weg.
{
	const ersteBox = macheBox(584, 305, GIPFEL_LABEL_BREITE, GIPFEL_LABEL_HOEHE);
	const zweiteBox = macheBox(584 - ABSTAND_X, 305 + ABSTAND_Y, GIPFEL_LABEL_BREITE, GIPFEL_LABEL_HOEHE);
	const erstes = macheLabelEintrag({ publicId: "cc223529", text: "Drei Schwestern", minZoom: 4, maxZoom: 7, box: ersteBox });
	const zweites = macheLabelEintrag({ publicId: "aafcf138", text: "Drei Schwestern", minZoom: 4, maxZoom: 5, box: zweiteBox });
	global.labelMarkers = [erstes, zweites];

	resolveLabelCollisions([]);

	assert.strictEqual(erstes.element.istVersteckt(), false,
		"das zuerst platzierte Label bleibt stehen");
	assert.strictEqual(zweites.element.istVersteckt(), true,
		"das zweite Label derselben Stelle wird ausgeblendet (.map-label.is-colliding => display:none)");
}

// ---- 2. Die Reihenfolge entscheidet, und sie ist bei Gleichstand die Nutzlast-Reihenfolge ---------
// Beide haben dieselbe Prioritaet (3) und dieselbe Erscheinungsstufe (4). Die Sortierung in
// resolveLabelCollisions ist stabil, also gewinnt, wer in labelMarkers frueher steht -- und das ist
// die Reihenfolge aus `ORDER BY sort_order ASC, id ASC` der Kartennutzlast. Deshalb sehen ZWEI
// Besucher dasselbe: der Fall ist reproduzierbar, kein Zufall und kein Cache-Effekt.
{
	const ersteBox = macheBox(584, 305, GIPFEL_LABEL_BREITE, GIPFEL_LABEL_HOEHE);
	const zweiteBox = macheBox(584 - ABSTAND_X, 305 + ABSTAND_Y, GIPFEL_LABEL_BREITE, GIPFEL_LABEL_HOEHE);
	const erstes = macheLabelEintrag({ publicId: "cc223529", text: "Drei Schwestern", minZoom: 4, maxZoom: 7, box: ersteBox });
	const zweites = macheLabelEintrag({ publicId: "aafcf138", text: "Drei Schwestern", minZoom: 4, maxZoom: 5, box: zweiteBox });
	global.labelMarkers = [zweites, erstes];   // umgedrehte Nutzlast-Reihenfolge

	resolveLabelCollisions([]);

	assert.strictEqual(zweites.element.istVersteckt(), false, "jetzt gewinnt das andere");
	assert.strictEqual(erstes.element.istVersteckt(), true, "und das vorher sichtbare verschwindet");
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
	assert.strictEqual(zweites.element.istVersteckt(), false, "auch das zweite -- ein Flaechen-Label wird nie ausgeblendet");
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
