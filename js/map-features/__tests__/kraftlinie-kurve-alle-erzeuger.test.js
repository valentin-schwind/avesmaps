// Dass ALLE DREI Kartenzeichner der Kraftlinie die Kurve zeichnen -- zur Laufzeit gemessen, nicht
// am Quelltext abgelesen. Lauf:
//   node js/map-features/__tests__/kraftlinie-kurve-alle-erzeuger.test.js
//
// 💣 Warum zur Laufzeit: „die Datei ist eingebunden" ist auch dann erfuellt, wenn niemand sie ruft.
// Und ein Quelltext-Test sieht einen Koordinatenfehler nie.
//
// Entwurf: docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md §5
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = { location: { search: "" }, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
global.document = {
	getElementById: () => null,
	querySelectorAll: () => [],
	addEventListener() {},
	documentElement: { style: { setProperty() {} }, classList: { add() {}, remove() {} } },
	body: null,
};
global.localStorage = { getItem: () => null, setItem() {} };

// ⚠️ DIE KARTE ALS ATTRAPPE, und sie ist NOETIG, nicht Zierde. createPowerlineLayer geht ueber
// getReadablePowerlineLabelLatLngCoordinates (map.latLngToLayerPoint) und ueber
// refreshPowerlineLayerText -> isPowerlineLabelVisibleAtCurrentZoom (map.getZoom).
// PATH_LABELS_ON_CANVAS steht in map-features-path-labels.js, die dieser Test NICHT laedt -- der
// Kurzschluss dort greift also nicht, und ohne `map` stirbt der Test an einem ReferenceError statt
// an der Sache.
global.map = {
	getZoom: () => 3,
	_animatingZoom: false,
	latLngToLayerPoint: (ll) => ({ x: ll.lng, y: ll.lat }),
	addLayer() {}, removeLayer() {},
};
// Die Auskunfts-Helfer der Infobox. Sie werden beim Aufbau des Popup-Markups gerufen und haben mit
// der Kurve nichts zu tun -- sie duerfen nur nicht fehlen.
// ⚠️ Die Liste ist NICHT geraten, sondern aus createPowerlinePopupMarkup abgelesen (die Namen, die
// es ruft und nicht selbst definiert). Kommt spaeter einer dazu, faellt dieser Test mit einem
// ReferenceError um -- das ist laut und richtig, nicht still.
global.escapeHtml = (t) => String(t == null ? "" : t);
global.tr = (schluessel, rueckfall) => rueckfall;
global.renderFeatureSourceLine = () => "";
global.popupActionButtonMarkup = () => "";
global.popupActionGlyphMarkup = () => "";
global.locationPopupMarkup = () => "";
global.locationPopupActionsMarkup = () => "";
global.locationPopupEditorBandMarkup = () => "";
global.infoHeaderImageMarkup = () => "";
global.buildSuggestChangeButtonSpec = () => null;
global.getPathLabelBaseSize = () => 11;
global.IS_INFOPANEL_MODE = false;

// Leaflet-Attrappe: nur, was die drei Zeichner anfassen. Jede Polyline merkt sich ihre Klasse und
// die zuletzt gesetzten Punkte -- daran wird gemessen.
const gebaute = [];
global.L = {
	latLng: (lat, lng) => ({ lat, lng }),
	latLngBounds: () => ({ isValid: () => false }),
	polyline(punkte, optionen) {
		const linie = {
			_punkte: punkte,
			options: optionen || {},
			setLatLngs(neu) { this._punkte = neu; },
			getLatLngs() { return this._punkte; },
			on() {}, setText() {}, removeText() {}, addTo() { return this; },
		};
		gebaute.push(linie);
		return linie;
	},
	layerGroup: (schichten) => ({
		_schichten: schichten,
		eachLayer(fn) { this._schichten.forEach(fn); },
	}),
};

const laden = (p) => {
	const abs = path.join(__dirname, p);
	vm.runInThisContext(fs.readFileSync(abs, "utf8"), { filename: abs });
};
laden("../map-features-line-catmull.js");
laden("../../config.js");
laden("../../app/runtime-state.js");
laden("../map-features-location-lookup.js");
laden("../powerline-topology.js");
laden("../map-features-powerlines.js");

// Eine Linie mit zwei Nodices, 20 Einheiten waagerecht, kraeftig gekruemmt.
const linie = {
	id: "pl-1",
	geometry: { type: "LineString", coordinates: [[0, 0], [20, 0]] },
	properties: { public_id: "pl-1", name: "Torweg", curve: 30 },
};
locationMarkers = [];
powerlineData = [linie];

// ---- 1. getPowerlineCurve liest und klemmt --------------------------------------------------
assert.strictEqual(getPowerlineCurve(linie), 30);
assert.strictEqual(getPowerlineCurve({ properties: {} }), 0, "ohne Wert: gerade");
assert.strictEqual(getPowerlineCurve({ properties: { curve: 999 } }), 45, "wird geklemmt");
assert.strictEqual(getPowerlineCurve({ properties: { curve: "20" } }), 20, "Zeichenkette wird gelesen");
assert.strictEqual(getPowerlineCurve(null), 0, "kein Objekt: gerade");

// ---- 2. Die STRAENGE tragen die Kurve -------------------------------------------------------
const gerade = createPowerlineStrandLatLngs([L.latLng(0, 0), L.latLng(0, 20)], 0, 0);
// Bei einer Kurve muss der mittlere Punkt deutlich weiter abstehen als ohne.
const gebogen = createPowerlineStrandLatLngs([L.latLng(0, 0), L.latLng(0, 20)], 0, 0, 30);
const mitteGerade = gerade[Math.floor(gerade.length / 2)];
const mitteGebogen = gebogen[Math.floor(gebogen.length / 2)];
assert.ok(
	Math.abs(mitteGebogen.lat - mitteGerade.lat) > 4,
	"der Strang folgt der Kurve nicht -- Scheitel muesste rund 6 Einheiten abstehen"
);

// ---- 3. curve = 0 aendert an den Straengen NICHTS (die Nicht-Regression) --------------------
const ohne = createPowerlineStrandLatLngs([L.latLng(0, 0), L.latLng(0, 20)], 1, 2.5);
const mitNull = createPowerlineStrandLatLngs([L.latLng(0, 0), L.latLng(0, 20)], 1, 2.5, 0);
assert.strictEqual(ohne.length, mitNull.length, "curve = 0 darf die Stuetzpunktzahl nicht aendern");
ohne.forEach((p, i) => {
	assert.strictEqual(p.lat, mitNull[i].lat, `Punkt ${i}: lat weicht bei curve = 0 ab`);
	assert.strictEqual(p.lng, mitNull[i].lng, `Punkt ${i}: lng weicht bei curve = 0 ab`);
});

// ---- 4. Die Stuetzpunktzahl waechst mit der Kruemmung ---------------------------------------
assert.ok(gebogen.length > gerade.length, "ein Bogen braucht mehr Stuetzpunkte als eine Gerade");

// Auch die reine Bahn (Klick-/Label-Linie) leitet ihre Stuetzpunkte aus der Kruemmung ab -- eine
// feste 8 machte aus einem starken Bogen ein sichtbares Polygon.
const bahnSchwach = getPowerlineCurvedLatLngs([L.latLng(0, 0), L.latLng(0, 20)], 5);
const bahnStark = getPowerlineCurvedLatLngs([L.latLng(0, 0), L.latLng(0, 20)], 45);
assert.ok(bahnStark.length > bahnSchwach.length,
	"die Bahn leitet ihre Stuetzpunkte nicht aus der Kruemmung ab");

// ---- 5. ALLE DREI Erzeuger, zur Laufzeit gemessen -------------------------------------------
// 💣 Der eigentliche Zweck dieses Tests. Klick-Linie und Label-Linie sind unsichtbar; ihr Fehlen
// faellt beim Hinsehen NICHT auf -- man merkt es erst daran, dass ein Klick ins Leere geht.
gebaute.length = 0;
createPowerlineLayer(linie);

const hit = gebaute.find((l) => String(l.options.className || "").includes("powerline--hit"));
assert.ok(hit, "die Klick-Linie wurde gar nicht gebaut");
assert.ok(hit._punkte.length > 2, "die Klick-Linie ist noch eine gerade Zweipunkt-Strecke");
const hitMitte = hit._punkte[Math.floor(hit._punkte.length / 2)];
assert.ok(Math.abs(hitMitte.lat) > 4,
	"die Klick-Linie folgt der Kurve nicht -- das Klickziel laege im leeren Gelaende");

const label = gebaute.find((l) => l.options.pane === "labelsPane");
assert.ok(label, "die Label-Linie wurde gar nicht gebaut");
assert.ok(label._punkte.length > 2, "die Label-Linie ist noch eine gerade Zweipunkt-Strecke");

// 💣 Und die STRAENGE als GEBAUTE Polylinien, nicht als Funktionsaufruf. Eine Mutationsprobe am
// 29.08.2026 zeigte die Luecke: der Abschnitt 2 oben ruft createPowerlineStrandLatLngs SELBST mit
// einer Kurve und ist deshalb blind dafuer, ob createPowerlineLayer sie ueberhaupt durchreicht.
// Das Weglassen des vierten Arguments blieb gruen -- die Straenge waeren live schnurgerade
// geblieben, waehrend Klick- und Label-Linie sich schon bogen.
const kern = gebaute.filter((l) => String(l.options.className || "").includes("powerline--core"));
assert.ok(kern.length > 0, "es wurde kein Kernstrang gebaut");
kern.forEach((strang, i) => {
	const mitte = strang._punkte[Math.floor(strang._punkte.length / 2)];
	assert.ok(Math.abs(mitte.lat) > 4,
		`Kernstrang ${i} traegt die Kurve nicht -- createPowerlineLayer reicht sie nicht durch`);
});

// ---- 6. Auch der Takt-Pfad zeichnet die Kurve, nicht nur der Aufbau -------------------------
// ⚠️ refreshPowerlineLayers setzt die Geometrie jeden Frame neu. Fehlt die Kurve dort, springt die
// Linie im ersten Frame von gebogen auf gerade -- und der Aufbau-Pfad sah dabei richtig aus.
refreshPowerlineLayers(3.0);
assert.ok(hit._punkte.length > 2, "nach einem Takt ist die Klick-Linie wieder gerade");
const hitMitteNachher = hit._punkte[Math.floor(hit._punkte.length / 2)];
assert.ok(Math.abs(hitMitteNachher.lat) > 4, "nach einem Takt folgt die Klick-Linie der Kurve nicht mehr");
kern.forEach((strang, i) => {
	const mitte = strang._punkte[Math.floor(strang._punkte.length / 2)];
	assert.ok(Math.abs(mitte.lat) > 4,
		`Kernstrang ${i} verliert die Kurve im Takt -- refreshPowerlineLayers reicht sie nicht durch`);
});

// ---- 7. Der fluechtige Vorschauwert schlaegt den gespeicherten ------------------------------
// 🔴 JE SEGMENT, nicht je Linie (29.08.2026): die vier Kanten des „Faechers der Macht" sollen
// verschiedene Kurven tragen koennen, also ist die Vorschau eine Karte public_id -> Zahl.
avesmapsPowerlineCurveVorschau.werte = { "pl-1": -40 };
assert.strictEqual(getPowerlineCurve(linie), -40, "die Vorschau muss den gespeicherten Wert schlagen");
avesmapsPowerlineCurveVorschau.werte = { "ein-anderes-segment": -40 };
assert.strictEqual(getPowerlineCurve(linie), 30, "die Vorschau gilt NUR ihrem eigenen Segment");
// ⚠️ Eine ausdrueckliche 0 in der Vorschau muss geradebiegen -- sie ist eine Aussage, kein Fehlen.
avesmapsPowerlineCurveVorschau.werte = { "pl-1": 0 };
assert.strictEqual(getPowerlineCurve(linie), 0, "eine Vorschau-0 muss geradebiegen");
// Und Unbrauchbares faellt auf den gespeicherten Stand zurueck, statt NaN in die Geometrie zu tragen.
avesmapsPowerlineCurveVorschau.werte = { "pl-1": "quatsch" };
assert.strictEqual(getPowerlineCurve(linie), 30, "ein unlesbarer Vorschauwert darf nicht durchrutschen");
avesmapsPowerlineCurveVorschau.werte = null;
assert.strictEqual(getPowerlineCurve(linie), 30, "ohne Vorschau gilt der gespeicherte Wert");

console.log("OK: Kraftlinien-Kurve -- Straenge, Klick-Linie, Label-Linie, Takt, Vorschau.");
