const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Die Bedarfs-Rasterung der Karten-Beschriftungen (`?labelbedarf=1`, Vorgabe AUS).
//
// 🔴 DIESER TEST FAEHRT DEN ECHTEN ABLAUF, keinen nachgebauten. `js/map-features/label-bedarf.js` und
// `js/map-features/map-features-labels.js` werden unveraendert in einen VM-Kontext geladen und
// `prepareLabelData` wirklich ausgefuehrt -- mit einem Leaflet- und einem Karten-Doppel darunter.
// Ein Quelltext-Test haette hier nichts gesehen: die Frage ist nicht, ob eine Zeile dasteht, sondern
// WELCHES Icon ein Marker in dem Augenblick traegt, in dem er auf die Karte geht.
//
// 💣 GESTUBBT SIND NUR ZWEI DINGE, UND BEIDE AUS EINEM GRUND: `renderMapLabelToImage` (braucht eine
// echte Canvas) und `getMapLabelTypeStyle` (haengt eine Messsonde ins DOM). Alles dazwischen --
// createLabelIcon, createLabelMarkerEntry, shouldShowLabelMarker, syncLabelMarkerVisibility,
// prepareLabelData -- laeuft im Original.
//
// Lauf (aus dem Wurzelverzeichnis):  node js/map-features/__tests__/label-bedarf.test.js

const WURZEL = path.resolve(__dirname, "..", "..", "..");

// ---- Der Pruefstand ------------------------------------------------------------------------------

/**
 * Baut eine Karte mit drei Beschriftungen: zwei im Ausschnitt, eine weit ausserhalb.
 *
 * 🪤 Die Geometrie steht als GeoJSON `[x, y]`, Leaflet liest `[lat, lng] = [y, x]` -- deshalb tragen
 * die Beschriftungen ihre Unterscheidung im ZWEITEN Wert. Genau die Drehung, vor der AGENTS.md §5
 * warnt; hier ist sie der Hebel des Testfalls.
 */
function baueKarte(sucheString) {
	const ctx = {};
	ctx.window = { location: { search: sucheString }, addEventListener() {} };
	ctx.location = ctx.window.location;
	ctx.document = {
		getElementById: () => null,
		createElement: () => ({ style: {}, getContext: () => null }),
		fonts: null,
		body: null,
		addEventListener() {},
	};
	ctx.console = console;
	ctx.performance = performance;
	ctx.setTimeout = setTimeout;
	ctx.clearTimeout = clearTimeout;
	ctx.URLSearchParams = URLSearchParams;
	vm.createContext(ctx);

	const lade = (rel) => vm.runInContext(fs.readFileSync(path.join(WURZEL, rel), "utf8"), ctx, { filename: rel });
	lade("js/map-features/label-bedarf.js");
	lade("js/map-features/map-features-labels.js");

	const aufKarte = new Set();
	const mitPlatzhalterAngehaengt = [];
	// Sichtgrenze und Zoomstufe als veraenderlicher Zustand -- damit der Test eine Beschriftung
	// nachtraeglich in den Ausschnitt holen und dazwischen zoomen kann, ohne den Kontext neu zu bauen.
	const sicht = { maxLat: 100 };
	const zoomStand = { wert: 3 };

	const stub = (name, wert) => { ctx[name] = wert; };
	stub("labelMarkers", []);
	stub("labelData", []);
	stub("IS_EDIT_MODE", false);
	stub("IS_INFOPANEL_MODE", false);
	stub("MAP_LABEL_MODES", ["deregraphic"]);
	stub("getSelectedMapLayerMode", () => "deregraphic");
	stub("isLabelsWithRegionFilterActive", () => false);
	stub("ecosystemRegionOfLabel", () => null);
	stub("isLabelOfActiveEcosystemLayer", () => true);
	stub("isMapLabelEditorOverrideActive", () => undefined);
	stub("scheduleLabelCollisionResolution", () => {});
	stub("getMapRenderBounds", () => ({}));
	stub("isLatLngInRenderBounds", (latlng) => latlng.lat < sicht.maxLat);
	stub("readFeatureOtherSource", () => null);
	stub("getVisualZoomLevel", () => zoomStand.wert);
	stub("VISUAL_MAX_ZOOM_LEVEL", 5);
	stub("getMapLabelTypeStyle", () => ({ color: "#000", fontSize: 12 }));
	// Die Bild-Adresse traegt die Zoomstufe: nur so laesst sich unterscheiden, ob eine Beschriftung
	// mit dem Bild der AKTUELLEN oder dem einer alten Stufe dasteht.
	stub("renderMapLabelToImage", () => ({ url: "data:bild-z" + zoomStand.wert, w: 10, h: 5, padX: 1, anchorY: 2 }));
	stub("escapeHtml", (text) => String(text));

	let popupBauten = 0;
	stub("buildRegionLabelViewPopupHtml", () => { popupBauten += 1; return "<div>popup</div>"; });

	stub("L", {
		latLng: (c) => ({ lat: c[0], lng: c[1] }),
		divIcon: (opts) => ({ __icon: opts }),
		marker: (coords, opts) => ({
			_ll: { lat: coords[0], lng: coords[1] },
			_icon: opts.icon,
			setIcon(icon) { this._icon = icon; },
			getLatLng() { return this._ll; },
			setLatLng(ll) { this._ll = ll; },
			on() { return this; },
			bindPopup(inhalt) { this._popupInhalt = inhalt; return this; },
			getElement() { return null; },
			addTo(karte) { karte.addLayer(this); return this; },
		}),
	});
	stub("map", {
		getZoom: () => zoomStand.wert,
		hasLayer: (m) => aufKarte.has(m),
		addLayer(m) {
			// 🔴 DIE SCHAERFSTE ZUSICHERUNG DES TESTS, und sie sitzt bewusst im Doppel statt in einer
			// nachtraeglichen Pruefung: ein Marker, der MIT Platzhalter auf die Karte geht, wird hier
			// aktenkundig. Die Kollisionsaufloesung misst Rechtecke (getCollisionEntries filtert auf
			// `map.hasLayer`); ein leeres Icon hat die Masse 0 und schoebe die Ortsnamen daneben ins Leere.
			if (istPlatzhalter(m)) {
				mitPlatzhalterAngehaengt.push(m);
			}
			aufKarte.add(m);
		},
		removeLayer: (m) => aufKarte.delete(m),
		panTo() {},
	});

	const merkmale = (n) => ({
		properties: { feature_type: "label", public_id: "L" + n, name: "Beschriftung " + n, label_type: "region", min_zoom: 0, max_zoom: 7 },
		// Zweiter Wert = y = lat: die dritte liegt weit ausserhalb des Ausschnitts.
		geometry: { type: "Point", coordinates: [n, n < 3 ? 10 : 500] },
	});
	ctx.__daten = { features: [1, 2, 3].map(merkmale) };

	return {
		ctx,
		aufKarte,
		sicht,
		zoomStand,
		mitPlatzhalterAngehaengt,
		popupBauten: () => popupBauten,
		fahre: (ausdruck) => vm.runInContext(ausdruck, ctx),
		bilanz: () => vm.runInContext("avesmapsLabelBilanz()", ctx),
		eintraege: () => vm.runInContext("labelMarkers", ctx),
	};
}

/** Traegt dieser Marker den leeren Platzhalter (html === "") statt eines gerasterten Bildes? */
function istPlatzhalter(marker) {
	return String(marker?._icon?.__icon?.html ?? "?") === "";
}

// ---- 1. Die VORGABE: ohne Schalter bleibt alles, wie es war --------------------------------------

{
	const k = baueKarte("");
	assert.strictEqual(k.fahre("avesmapsLabelBedarfAktiv()"), false, "Vorgabe muss AUS sein");
	k.fahre("prepareLabelData(__daten)");
	const b = k.bilanz();

	assert.strictEqual(b.labels, 3, "alle drei Beschriftungen stehen in labelMarkers");
	assert.strictEqual(b.beimStart, 3, "ohne Schalter wird jede Beschriftung beim Start gerastert");
	assert.strictEqual(b.popupsBeimStart, 3, "ohne Schalter entsteht jedes Popup-Markup beim Start");
	assert.strictEqual(k.popupBauten(), 3, "und zwar wirklich -- der Bauer lief dreimal");
	// Auch die Beschriftung AUSSERHALB des Ausschnitts traegt ein Bild: genau der Aufwand, um den es geht.
	assert.ok(k.eintraege().every((e) => !istPlatzhalter(e.marker)), "ohne Schalter traegt jeder Marker sein Bild");
	assert.strictEqual(k.aufKarte.size, 2, "auf der Karte stehen nur die zwei im Ausschnitt");
	assert.ok(b.prepareMs >= 0, "die Dauer wird auch ohne Schalter gemessen");
}

// ---- 2. MIT Schalter: gerastert wird nur, was sichtbar ist ----------------------------------------

{
	const k = baueKarte("?labelbedarf=1");
	assert.strictEqual(k.fahre("avesmapsLabelBedarfAktiv()"), true, "?labelbedarf=1 schaltet ein");
	k.fahre("prepareLabelData(__daten)");
	const b = k.bilanz();

	// 🔴 DIE REIHENFOLGE-ZUSICHERUNG: labelMarkers bleibt VOLLZAEHLIG. preparePathData laeuft direkt
	// danach und baut aus genau dieser Liste den Verlinkungs-Index seiner Weg-Popups -- fehlte hier ein
	// Eintrag, bliebe die Landschaft in bereits gebautem Markup fuer immer unverlinkt.
	assert.strictEqual(b.labels, 3, "auch mit Schalter stehen ALLE Beschriftungen in labelMarkers");

	assert.strictEqual(b.beimStart, 2, "gerastert wird nur, was im Ausschnitt liegt");
	assert.strictEqual(b.popupsBeimStart, 0, "kein Popup-Markup im Voraus");
	assert.strictEqual(k.popupBauten(), 0, "der Popup-Bauer lief beim Start gar nicht");
	assert.strictEqual(k.aufKarte.size, 2, "auf der Karte stehen dieselben zwei wie ohne Schalter");

	// Die dritte traegt den Platzhalter -- und nur sie.
	const eintraege = k.eintraege();
	assert.ok(!istPlatzhalter(eintraege[0].marker) && !istPlatzhalter(eintraege[1].marker), "die sichtbaren sind gerastert");
	assert.ok(istPlatzhalter(eintraege[2].marker), "die unsichtbare traegt den Platzhalter");

	// ---- 3. Sie wird sichtbar -- und steht dann wirklich gerastert da ----------------------------
	k.sicht.maxLat = 1000;
	k.fahre("syncLabelVisibility()");
	assert.strictEqual(k.aufKarte.size, 3, "jetzt stehen alle drei auf der Karte");
	assert.ok(!istPlatzhalter(k.eintraege()[2].marker), "die nachgerueckte Beschriftung ist gerastert");
	assert.strictEqual(k.bilanz().gerastert, 3, "und die Bilanz hat den dritten Vorgang gezaehlt");
	assert.strictEqual(k.bilanz().beimStart, 2, "der Startwert bleibt stehen -- er misst den START");

	// ---- 4. Und NIE mit Platzhalter auf die Karte ------------------------------------------------
	assert.deepStrictEqual(k.mitPlatzhalterAngehaengt, [], "kein Marker geht mit leerem Icon auf die Karte");

	// ---- 4b. Und sie traegt das Bild der AKTUELLEN Zoomstufe -------------------------------------
	// ⭐ Das ist die Frage, die es ohne die Bedarfs-Rasterung nicht gab. `syncLabelIcons` fasst beim
	// Zoomwechsel nur an, was im Ausschnitt liegt; eine Beschriftung, die spaeter durch ein
	// Verschieben hereinkommt, traegt sonst das Bild der Stufe, auf der sie zuletzt gerastert wurde --
	// also die falsche Groesse. Der Zoom-Merker (`entry._bedarfIconZoom`) verhindert genau das.
	assert.ok(String(k.eintraege()[2].marker._icon.__icon.html).includes("bild-z3"), "gerastert auf Stufe 3");
	k.sicht.maxLat = 100;                 // wieder hinaus aus dem Ausschnitt
	k.fahre("syncLabelVisibility()");
	assert.strictEqual(k.aufKarte.size, 2, "sie ist wieder von der Karte");
	k.zoomStand.wert = 5;                 // zwischendurch gezoomt, ohne dass sie im Bild war
	k.sicht.maxLat = 1000;                // und wieder herein
	k.fahre("syncLabelVisibility()");
	assert.ok(
		String(k.eintraege()[2].marker._icon.__icon.html).includes("bild-z5"),
		"beim Wiedersichtbarwerden neu gerastert -- nicht das Bild von Stufe 3"
	);

	// ---- 5. Das Popup entsteht erst beim Oeffnen --------------------------------------------------
	const inhalt = k.eintraege()[0].marker._popupInhalt;
	assert.strictEqual(typeof inhalt, "function", "mit Schalter ist das Popup eine Funktion");
	assert.strictEqual(k.popupBauten(), 0, "und sie ist bis hierher nie gelaufen");
	assert.ok(String(inhalt()).includes("popup"), "gerufen liefert sie das Markup");
	assert.strictEqual(k.popupBauten(), 1, "genau ein Bau, und zwar jetzt");
}

// ---- 6. Die Bilanz selbst -------------------------------------------------------------------------

{
	const k = baueKarte("");
	// Ein zweites `?` in der Adresse (zusammengesetzter Link) darf den Schalter nicht verschlucken.
	const kZweifach = baueKarte("?perftrace=1?labelbedarf=1");
	assert.strictEqual(kZweifach.fahre("avesmapsLabelBedarfAktiv()"), true, "auch hinter einem zweiten ? erkannt");

	k.fahre("prepareLabelData(__daten)");
	const kopie = k.bilanz();
	kopie.labels = 999;
	assert.strictEqual(k.bilanz().labels, 3, "avesmapsLabelBilanz() gibt eine KOPIE, keinen Griff in den Stand");

	k.fahre("avesmapsLabelBilanzZuruecksetzen()");
	const leer = k.bilanz();
	assert.strictEqual(leer.gerastert, 0, "Zuruecksetzen leert den Zaehler");
	assert.strictEqual(leer.beimStart, 0, "und den Startwert");
	assert.strictEqual(leer.labels, 0, "und die Label-Zahl");
	assert.strictEqual(leer.bedarf, false, "der Schalter selbst bleibt stehen -- er ist kein Zaehler");
}

console.log("label-bedarf.test.js: OK");
