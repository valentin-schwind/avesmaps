// PERF: Bounding-Box (latLng) eines Pfads aus der Roh-Geometrie, einmal berechnet + gecacht. Für das
// Viewport-Culling (nur Wege im Sichtfeld auf der Karte halten). Bei Geometrie-Edits invalidieren (= undefined).
function getPathGeomBounds(path) {
	if (!path) {
		return null;
	}
	if (path._geomBounds === undefined) {
		const coords = path.geometry?.coordinates || [];
		let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
		for (let i = 0; i < coords.length; i += 1) {
			const x = +coords[i][0], y = +coords[i][1];
			if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y;
		}
		path._geomBounds = (mnx <= mxx) ? L.latLngBounds([mny, mnx], [mxy, mxx]) : null;
	}
	return path._geomBounds;
}

function currentPathVisibilityContext() {
	return {
		showPaths: $("#togglePaths").is(":checked"),
		showRivers: $("#toggleRivers").is(":checked"),
		showSeaPaths: (typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE) && $("#toggleSeaPaths").is(":checked"),
		zoom: map.getZoom(),
		bounds: map.getBounds().pad(0.25), // 25% Polster -> kein Pop-In am Rand beim Pannen
		// Prüfhaken „Offene Wegenden" (Idee #86). Einmal je Durchlauf gelesen, nicht je Weg -- dasselbe
		// Muster wie die Toggle-Stände darüber.
		openEndCheck: typeof avesmapsIsOpenPathEndCheckActive === "function" && avesmapsIsOpenPathEndCheckActive(),
		powerlineMode: typeof getSelectedMapLayerMode === "function" && getSelectedMapLayerMode() === "powerlines",
	};
}

// Soll dieser Pfad gerade auf der Karte liegen? = Toggle/Modus (shouldShowPathOnMap) UND am aktuellen Zoom
// sichtbare Breite (Skalierung > 0) UND im (gepolsterten) Sichtfeld. So reprojiziert Leaflet bei jedem Zoom nur
// die paar Hundert sichtbaren Wege statt aller ~5500 -> raus-/reinzoomen deutlich schneller.
function pathShouldBeOnMap(path, ctx) {
	// 🔴 EIN PRÜFHAKEN ZEIGT SEINE FUNDE (Owner 14.08.2026). Ein Weg mit offenem Ende erscheint auch
	// dann, wenn seine Wegart gerade abgeschaltet ist ("Wege"/"Flüsse"/"Seewege") oder auf dieser
	// Zoomstufe wegskaliert wird -- sonst wären ausgerechnet die gesuchten Wege unsichtbar, und der
	// Haken markierte nur, was eine ANDERE Einstellung ohnehin zeigt. Genau daran ist „Unverbunden"
	// anderthalb Jahre lang gescheitert (live gemessen: 180 unverbundene Orte, davon sichtbar null).
	// Was BLEIBT: der Bildausschnitt (sonst zeichnet die Karte alles) und der Kraftlinien-Modus -- der
	// ist eine ANSICHT (Magiersicht ohne jeden Weg), kein Filter über Wegarten.
	const istOffenerWegBefund = Boolean(ctx.openEndCheck)
		&& typeof avesmapsPathHasOpenEnd === "function"
		&& avesmapsPathHasOpenEnd(path);

	if (istOffenerWegBefund) {
		if (ctx.powerlineMode) {
			return false;
		}
	} else {
		if (!shouldShowPathOnMap(path, ctx)) {
			return false;
		}
		if (typeof getPathWidthScale === "function") {
			const subtype = normalizePathSubtype(path?.properties?.feature_subtype || path?.properties?.name);
			if (!(getPathWidthScale(subtype, ctx.zoom) > 0)) {
				return false;
			}
		}
	}
	const b = getPathGeomBounds(path);
	if (b && ctx.bounds && !ctx.bounds.intersects(b)) {
		return false;
	}
	return true;
}

// Läuft auf moveend/zoomend (Pan/Zoom): nur die Karten-Zugehörigkeit der Wege nachziehen (add/remove), KEINE
// Label-/Override-Logik (die hängt an Toggles, nicht am View). Billig: bbox-Test pro Pfad + Delta-Add/Remove.
function syncPathViewportCulling() {
	if (typeof pathData === "undefined" || !Array.isArray(pathData) || !pathData.length) {
		return;
	}
	const ctx = currentPathVisibilityContext();
	let added = false;
	$.each(pathLayers, (i, layer) => {
		if (!layer) return;
		const want = pathShouldBeOnMap(pathData[i], ctx);
		const on = map.hasLayer(layer);
		if (want && !on) { map.addLayer(layer); added = true; }
		else if (!want && on) { map.removeLayer(layer); }
	});
	if (added && typeof applyPathDrawOrder === "function") {
		applyPathDrawOrder();
	}
}

function syncPathVisibility() {
	const ctx = currentPathVisibilityContext();

	// Standardmäßig folgen die Fluss-Labels den Fluss-Pfaden. Sobald im ?pathtune=1-Panel der Label-Schalter
	// benutzt wurde (Override), bleibt die Entkopplung bestehen: Pfade ausblenden lässt die Labels stehen.
	if (typeof pathRiverLabelsOverridden !== "undefined" && !pathRiverLabelsOverridden) {
		pathRiverLabelsVisible = ctx.showRivers;
	}

	$.each(pathLayers, (i, layer) => {
		const path = pathData[i];
		const shouldShow = pathShouldBeOnMap(path, ctx);
		map[shouldShow ? "addLayer" : "removeLayer"](layer);
		// PERF: Sind die Pfad-Namen auf dem Canvas (Default), trägt die unsichtbare SVG-<textPath>-Label-Linie
		// NICHTS mehr bei -- das Canvas-Overlay liest die Geometrie aus path.geometry. ~4900 solcher transparenten
		// Polylinien würde Leaflet aber bei JEDEM Zoom mit-reprojizieren (~halbe SVG-Last). Also nur im SVG-Fallback
		// (?canvaspathlabels=0) auf die Karte legen; sonst entfernen.
		const labelsOnCanvas = typeof PATH_LABELS_ON_CANVAS !== "undefined" && PATH_LABELS_ON_CANVAS;
		if (path?._pathLabelLine) {
			if (labelsOnCanvas) {
				if (map.hasLayer(path._pathLabelLine)) { map.removeLayer(path._pathLabelLine); }
			} else {
				map.addLayer(path._pathLabelLine);
			}
		}
		if (typeof refreshPathLayerText === "function") {
			refreshPathLayerText(path);
		}
	});
	// Subtyp-Zeichenreihenfolge nach jedem (Wieder-)Einblenden neu setzen (neue Layer haengen sonst oben).
	if (typeof applyPathDrawOrder === "function") {
		applyPathDrawOrder();
	}
	// Pfad-Namen-Canvas neu zeichnen (Sichtbarkeit von Wegen/Flüssen kann sich geändert haben).
	if (window.AvesmapsPathLabelCanvasOverlay) {
		window.AvesmapsPathLabelCanvasOverlay.redraw();
	}
}

function shouldShowPathOnMap(path, { showPaths = true, showRivers = false, showSeaPaths = false } = {}) {
	// Kraftlinien-Modus: gar keine Wege/Flüsse (Magiersicht), unabhängig von den Toggle-Ständen.
	if (typeof getSelectedMapLayerMode === "function" && getSelectedMapLayerMode() === "powerlines") {
		return false;
	}
	const subtype = normalizePathSubtype(path?.properties?.feature_subtype || path?.properties?.name);

	if (subtype === "Flussweg") {
		return showRivers;
	}

	if (subtype === "Seeweg") {
		return showSeaPaths;
	}

	return showPaths;
}
 

function getSelectedMapLayerMode() {
	return String($("#mapLayerModeSelect").val() || DEFAULT_PLANNER_STATE.mapLayerMode);
}

// "Magiersicht" im Kraftlinien-Modus: die farbige Grund-Karte (nur die Basis-Kacheln, NICHT Linien/Marker/
// Labels in eigenen Panes) fast entsättigen + abdunkeln, damit die Kraftlinien herausstechen. Live über
// ?leytune=1. Werte: Sättigung 0..1 (0 = grau), Helligkeit 0..1 (<1 = dunkler).
let LEY_MAP_SATURATION = 0.1;
let LEY_MAP_BRIGHTNESS = 0.6;

function getLeyMapFilter() {
	return `saturate(${LEY_MAP_SATURATION}) brightness(${LEY_MAP_BRIGHTNESS})`;
}

function syncPowerlineMapTint() {
	if (typeof baseTileLayer === "undefined" || !baseTileLayer || typeof baseTileLayer.getContainer !== "function") {
		return;
	}
	const container = baseTileLayer.getContainer();
	if (!container) {
		return;
	}
	const active = getSelectedMapLayerMode() === "powerlines";
	container.style.transition = "filter 0.6s ease";
	container.style.filter = active ? getLeyMapFilter() : "";
}

// Die zwei Haken ("Labels"/"Grenzen") folgen dem Modus: bei jedem Moduswechsel werden sie auf
// das gesetzt, was der neue Modus von sich aus zeigt. Damit aendert ein Moduswechsel das Kartenbild
// GENAU so wie bisher -- die Haken sind eine Abweichung NACH dem Wechsel, kein Dauer-Uebersteuern.
// (Owner 2026-07-26: das bisherige Verhalten bleibt; Politisch behaelt seine Grenzdarstellung.)
//
// 🔴 Der Ausstieg bei !IS_EDIT_MODE ist am 12.08.2026 gefallen, und das ist keine Erweiterung,
// sondern die Bedingung dafuer, dass §9 des Entwurfs ueberhaupt gilt: seit die beiden Haken im
// Anzeige-Menue an der Karte stehen, wuerden sie sonst als EINZIGE ueber den Ansichtswechsel
// stehenbleiben, waehrend Wege und Fluesse daneben zuruecksetzen (applyFrontendLayerModeDefaults).
// Zwei Schalter im selben Menue mit zwei verschiedenen Regeln -- und die eine unsichtbar.
// ⚠️ Die beiden Listen stehen in js/config.js neben MAP_LABEL_MODES / BOUNDARY_OVERLAY_MODES, weil
// die ZEICHNER dieselben lesen. Eine zweite Kopie hier liefe genau dort auseinander, wo es
// niemandem auffiele.
// 💣 13.08.2026 -- dieser Absatz IST die Reparatur, nicht bloss ihre Beschreibung. Die Datei
// stand LIVE noch in der Fassung von vor dem 12.08.: fuenf Deploy-Laeufe hintereinander waren
// rot (08:02-08:27 Uhr), und weil ein Push-Lauf nur gegen seinen unmittelbaren Vorgaenger
// difft, lag ihr Diff danach in keinem einzigen gruenen Lauf mehr. Im Browser lief also der
// alte Ausstieg bei !IS_EDIT_MODE weiter: die beiden Haken blieben auf ihrem HTML-Standard
// (checked), und ein gesetzter Haken ueberstimmt den Modus -- „Nur Karte" zeigte Grenzen und
// Labels. Heilbar ist das nur durch eine INHALTSAENDERUNG (neuer Hash = neue ?v=-Adresse, und
// die Datei liegt wieder in einem Push-Diff); ein Voll-Deploy legte sie unter die alte. §9.
function syncEditorDisplayTogglesToMode(mode) {
	$("#toggleMapLabels").prop("checked", MAP_LABEL_MODES.includes(mode));
	$("#toggleTerritoryBorders").prop("checked", BOUNDARY_OVERLAY_MODES.includes(mode));
}

/**
 * Die Basiskarte, die vor dem Betreten der Ansicht „Original" lag -- `null`, solange die Ansicht
 * gar nichts überschrieben hat.
 *
 * 💣 SIE IST DER RÜCKWEG, den es im Editor bis zum 20.08.2026 nicht gab (Fall #82, gemeldet von
 * „Tigersprung"): `setSelectedMapLayerMode` SCHRIEB die Basis beim Betreten unbedingt auf „old",
 * der Zweig, der sie zurückgibt, hing aber an `!IS_EDIT_MODE`. Ein Hinweg ohne Rückweg -- wer im
 * Editor einmal auf „Original" geschaltet hatte, sass für den Rest der Sitzung auf der alten
 * Karte, während die Überlagerungen daneben brav weiterschalteten. Genau dieser Unterschied stand
 * in der Meldung, und er ist die Fundstelle: Überlagerungen hängen an den sync*-Aufrufen, die
 * Basis an setMapStyle.
 *
 * ⚠️ Gemerkt statt geraten, und das ist der Unterschied zum Frontend-Zweig: der Editor darf „none"
 * (leerer Untergrund, js/ui/route-planner-toggle.js) oder eine von Hand gewählte „old"-Basis
 * stehen haben. Ein Rückweg, der stur „stylized" setzt, macht aus „None" eine gemalte Karte --
 * genau die manuelle Wahl, die der Kommentar unten seit jeher zu schützen versprach.
 * 🔴 Nur die Ansicht schreibt hier hinein. Wer die Basis von Hand wählt, setzt eine neue Wahrheit
 * und löscht die Erinnerung (`vergissBasisVorOriginal`, gerufen vom change-Handler des
 * #mapStyleSelect in js/map-features/map-features.js).
 */
let basisVorOriginal = null;

// Der Editor hat die Basiskarte von Hand gewählt: ab jetzt gilt seine Wahl, nicht mehr das, was die
// Ansicht „Original" einmal überschrieben hat. Ohne diesen Ruf legte das Verlassen der Ansicht die
// gemerkte Vorgängerin über eine frische Handwahl.
function vergissBasisVorOriginal() {
	basisVorOriginal = null;
}

function setSelectedMapLayerMode(mode) {
	// Diese Liste ist die Stelle, an der ein GETEILTER LINK ankommt: ?mapLayerMode=… läuft über
	// map-features-layer-state.js (restorePlannerState) hierher, an der Auswahlbox vorbei. Was hier
	// nicht steht, führt zurück auf die Standardansicht.
	//
	// 🪤 Bis 2026-08-01 hing „ecosystem" an `?edit=1` plus `?landschaften=1`, bis 2026-08-04 an der
	// Admin-Sitzung. Beide Riegel sind Geschichte, aber ihr Grund nicht: ein ungeprüfter URL-Parameter
	// war nie ein Riegel. Heute gibt es hier NICHTS mehr zu verriegeln -- die Ansicht ist öffentlich.
	//
	// 🔴 „ecosystem" steht seit 2026-08-04 fest in der Liste (Owner: die „Alle"-Ansicht gehört jedem
	// Besucher). Der Riegel, den dieser Kommentar oben beschreibt, ist damit gefallen -- und er muss es,
	// sonst führte ein geteilter Link mit ?mapLayerMode=ecosystem den Besucher weiterhin in die
	// Standardansicht zurück, während die Auswahl den Eintrag anbietet. Was an der Sitzung hängt, ist nur
	// noch das BEDIENEN (canOperateEcosystemLayers).
	const allowedModes = ["none", "political", "deregraphic", "powerlines", "original", "ecosystem"];
	const normalizedMode = allowedModes.includes(mode) ? mode : DEFAULT_PLANNER_STATE.mapLayerMode;
	$("#mapLayerModeSelect").val(normalizedMode);
	syncTransportControl("mapLayerModeSelect");
	// "Original" ist die einzige Derographie-Ansicht mit abweichender Basiskarte: sie zeigt die alte
	// Karte (Tile-Style "old"). Beim Verlassen kommt die vorherige Basis zurueck -- im Frontend ist
	// das immer "stylized", im Edit-Modus genau das, was die Ansicht ueberschrieben hat.
	if (typeof setMapStyle === "function") {
		if (normalizedMode === "original") {
			// 💣 Nur merken, was die Ansicht WIRKLICH ueberschreibt. Stand die Basis schon auf "old"
			// (der Editor hat sie im Anzeige-Menue selbst so gestellt), gibt es nichts zurueckzugeben
			// -- und ein zweiter Aufruf mit "original" (restorePlannerState) darf die Erinnerung nicht
			// mit "old" ueberschreiben und sie damit wertlos machen.
			if (typeof activeMapStyle !== "undefined" && activeMapStyle !== "old") {
				basisVorOriginal = activeMapStyle;
			}
			setMapStyle("old");
		} else if (typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) {
			// Alle anderen Derographie-Modi nutzen im Frontend IMMER die stylized-Basis. setMapStyle ist
			// ein No-op, wenn stylized bereits aktiv ist (Guard in bootstrap.js), daher unbedingt sicher.
			basisVorOriginal = null;
			setMapStyle("stylized");
		} else if (basisVorOriginal !== null) {
			// 🔴 Im Editor NUR zurueckgeben, was die Ansicht selbst genommen hat. Ohne Erinnerung wird
			// hier gar nichts angefasst: eine Sitzung, die nie in "Original" war, behaelt ihre Basis.
			const zurueck = basisVorOriginal;
			basisVorOriginal = null;
			setMapStyle(zurueck);
		}
	}
	// Mittelgrauer Karten-Hintergrund hinter/um die Kacheln -- NUR im Edit-Modus, und dort nur in den Modi
	// "Politisch" und "Nur Karte" (none). Frontend bleibt unveraendert. Direkt am Container per inline-Style,
	// da der Editor-iframe map-layout.css nicht laedt; inline gewinnt ueber die Leaflet-Default-Farbe.
	if (typeof map !== "undefined" && map && typeof map.getContainer === "function") {
		const mapContainerEl = map.getContainer();
		if (mapContainerEl) {
			const useGreyMapBg = IS_EDIT_MODE && (normalizedMode === "political" || normalizedMode === "none");
			mapContainerEl.style.background = useGreyMapBg ? "#808080" : "";
		}
	}
	if (IS_EDIT_MODE && normalizedMode === "powerlines") {
		$("#toggleNodix").prop("checked", true);
		syncLocationMarkerVisibility();
	}
	// Landschaften (Erprobung): eine moeglichst leere Zeichenflaeche. Aus sind Ortschaften, Wege,
	// Seewege, Fluesse (hier) und Grenzen (BOUNDARY_OVERLAY_MODES in js/config.js); an bleiben nur die
	// Labels, weil sie die derographischen Flaechen benennen. Stand 2026-07-26 nach dem ersten echten
	// Zeichenlauf -- am Vormittag waren Fluesse und Grenzen noch an. Alles hier ist nur die
	// VOREINSTELLUNG beim Betreten; wer eine Ebene braucht, schaltet ihren Haken von Hand zurueck --
	// dasselbe Muster wie die Nodices-Zeile darueber.
	if (IS_EDIT_MODE && normalizedMode === "ecosystem") {
		// 💣 HIER STAND setAllLocationTypesVisible(false) -- ENTFERNT 2026-08-05. Es sah richtig aus (die
		// Ebene will eine moeglichst leere Flaeche) und war doch der Grund, warum ein Editor nach dem
		// Verlassen der Landschaften in JEDEM Zielmodus ohne Ortsklassen dastand: die Ebene MERKT sich
		// die Schalterlage beim Betreten (syncEcosystemSettlementVisibility) -- und lief ERST DANACH.
		// Sie merkte sich also die bereits geleerte Lage und gab genau die beim Verlassen zurueck.
		// Ausblenden ist Sache der Ebene, die es auch wieder ruecknimmt; der Moduswechsel haelt sich
		// davon fern. Wege/Seewege darunter bleiben hier richtig -- fuer die gibt es keine Erinnerung.
		//
		// 💣 UND SEIT 23.08.2026 GILT GENAU DAS AUCH FUER DIE FLUESSE. Hier stand
		// `$("#toggleRivers").prop("checked", false)` -- die Voreinstellung vom 2026-07-26 (die blauen
		// Linien laufen quer durch jede Flaeche, die man gerade zieht). Seit die Ebene die Fluesse je
		// EBENE setzt und sich dafuer die Lage beim Betreten MERKT (syncEcosystemRiverVisibility), ist
		// diese Zeile derselbe Fehler wie das entfernte setAllLocationTypesVisible(false) darueber, nur
		// ein Schalter weiter: sie lief VOR syncEcosystemVisibility, die Ebene merkte sich also die
		// bereits geleerte Lage und gab beim Verlassen „aus" zurueck -- auch dem, der die Fluesse selbst
		// angehabt hatte. Im Browser gemessen, nicht hergeleitet.
		// ⚠️ Die Absicht von 2026-07-26 ist NICHT gefallen: Vegetation und Derographie schalten die
		// Fluesse weiterhin aus -- nur eben die Ebene, die es auch wieder ruecknimmt.
		$("#togglePaths").prop("checked", false);
		$("#toggleSeaPaths").prop("checked", false);
	}
	// 💣 UND DIE GEGENRICHTUNG: „Standard" BLENDET DIE WEGE IMMER WIEDER EIN -- egal, wer den Modus
	// setzt, und egal, ob sie gerade aus sind (Owner 26.08.2026: „ob unsichtbar oder nicht").
	// Die Vorgabe stand laengst in FRONTEND_LAYER_MODE_DEFAULTS, wirkte aber nur dort, wo
	// applyFrontendLayerModeDefaults ueberhaupt laeuft: im Umschalter (map-features.js) und in
	// restorePlannerState -- und im Editor steigt sie ganz vorn aus, bevor sie einen Weg-Haken
	// anfasst. JEDER ANDERE WEG in die Standardansicht ruft nur setSelectedMapLayerMode: der
	// Spotlight-Sprung (zwei Stellen in js/ui/spotlight-search-focus.js), der Routenplaner
	// (js/routing/routing.js), der Label-Editor (map-features-labels.js) und der Region-Sync
	// (js/review/review-region-sync.js) -- dazu das Konfliktzentrum, das den Modus aus seinem Fall
	// ableitet. Sie alle landeten in „Standard" OHNE Wege, sobald eine Ansicht sie vorher
	// ausgeschaltet hatte -- und genau das tut „Landschaften": im Editor die Zeilen darueber, im
	// Frontend syncEcosystemFrontendFeatures. Dessen Kommentar sagt, die Wege wuerden „bei jedem
	// Kartenmodus-Wechsel ohnehin neu gesetzt"; fuer diese Wege stimmte das nicht.
	// Dieselbe Lehre wie am 14.08.2026 bei der Verkehrsmittel-Sperre: eine Regel, die einen von
	// mehreren Erzeugern bindet, ist keine Regel.
	// ⚠️ Und bewusst OHNE Zahl im Satz -- dort stand erst „zwei von zehn Stellen", und genau eine
	// solche Zahl liest sich wie eine vollstaendige Liste, nach der niemand mehr weitersucht (die
	// Falle vom 14.08.2026, „ERZEUGER 1 VON 2").
	// ⚠️ Gelesen wird die TABELLE, nicht ein zweites hingeschriebenes „deregraphic" -- eine zweite
	// Fassung von „Standard zeigt Wege" liefe genau dort auseinander, wo es niemandem auffiele.
	if (FRONTEND_LAYER_MODE_DEFAULTS[normalizedMode]?.wege === true) {
		$("#togglePaths").prop("checked", true);
	}
	syncEditorDisplayTogglesToMode(normalizedMode);
	syncRegionVisibility();
	// typeof-Guard, anders als bei den Nachbarn darueber/darunter: die Datei ist NEU. Diese Funktion
	// laeuft bei jedem Seitenaufruf (restorePlannerState -> hier). Wuerde die neue Datei einmal nicht
	// ausgeliefert, risse ein blanker Aufruf mit einem ReferenceError den ganzen Zustands-Restore fuer
	// JEDEN Besucher mit. So verkommt derselbe Fall zu "der Erprobungsmodus tut nichts".
	if (typeof syncEcosystemVisibility === "function") {
		syncEcosystemVisibility();
	}
	syncLabelVisibility();
	syncPowerlineVisibility();
	syncPowerlineMapTint();
	syncLocationMarkerVisibility(); // Modus beeinflusst die Marker (Kraftlinien-Modus -> nur Nodices)
	syncPathVisibility();           // Modus beeinflusst die Wege/Flüsse (Kraftlinien-Modus -> aus) + Pfad-Labels
	// Idee #86: die Fundstellen-Ringe und die roten Linien. NACH syncPathVisibility und mit
	// `zieheWegeNach: false`, weil die Wege eine Zeile höher schon durch sind -- typeof-Guard aus
	// demselben Grund wie bei syncEcosystemVisibility oben (neue Datei; bliebe sie einmal aus, dürfte
	// nicht der ganze Zustands-Restore mitfallen).
	if (typeof avesmapsSyncOpenPathEndCheck === "function") {
		avesmapsSyncOpenPathEndCheck({ zieheWegeNach: false });
	}
	syncPlannerStateToUrl();
}

// Setzt ALLE Ortsklassen-Sichtbarkeits-Buttons gemeinsam (Kaskade voll bzw. leer).
function setAllLocationTypesVisible(isVisible) {
	if (typeof LOCATION_TYPE_VISIBILITY_ORDER === "undefined") {
		return;
	}
	LOCATION_TYPE_VISIBILITY_ORDER.forEach((locationType) => {
		getLocationToggleButton(locationType).toggleClass("is-active", !!isVisible);
	});
	if (typeof syncLocationToggleButtons === "function") {
		syncLocationToggleButtons();
	}
	syncLocationMarkerVisibility();
}

// Was ein Kartenmodus im Frontend VON SICH AUS zeigt.
//
// 💣 DIESE TABELLE IST DIE VOLLSTÄNDIGE LISTE, und sie muss es bleiben. Bis 2026-08-05 stand hier eine
// Kette von if-Zweigen, die "political" und "ecosystem" nicht kannte: beide stiegen aus, ohne einen
// einzigen Schalter zu setzen, und erbten damit die Lage ihres VORGÄNGERS. Sichtbar wurde das als
// "Standard -> Landschaften zeigt Straßen, Nur Karte -> Landschaften nicht" -- dieselbe Ansicht, zwei
// Bilder, je nachdem woher man kam. Ein Modus, der hier fehlt, fällt sofort in genau diesen Fehler
// zurück; layer-mode-defaults.test.js prüft deshalb jeden Eintrag aus ZWEI verschiedenen Vorlagen.
//
// `orte: null` heißt "dieser Modus fasst die Ortsklassen NICHT an":
//  - powerlines zeigt ohnehin nur Nodices (shouldShowLocationMarker), ein Eingriff wäre folgenlos;
//  - ecosystem blendet sie über seine EIGENE Erinnerung aus (syncEcosystemSettlementVisibility) und
//    gibt sie beim Verlassen zurück -- wer hier eingreift, vergiftet deren Schnappschuss.
const FRONTEND_LAYER_MODE_DEFAULTS = {
	// "Nur Karte": freie Karte -- alles aus.
	none:        { orte: false, wege: false, flussnamen: false },
	original:    { orte: false, wege: false, flussnamen: false },
	// "Standard": die volle Karte -- alle Ortsklassen, Straßen samt Namen, Flussnamen. (Die Fluss-PFADE
	// bleiben auch hier aus; ihr Haken ist im Frontend nicht einmal sichtbar.)
	deregraphic: { orte: true,  wege: true,  flussnamen: true  },
	// "Politisch": die Gebiete stehen im Vordergrund. Ortsklassen aus -- das immer-an-Feature in
	// shouldShowLocationMarker zeigt die Hauptstädte der angezeigten Gebiete von sich aus. Straßen aus
	// (Owner 2026-08-05; vorher geerbt), die Gewässernamen bleiben zur Orientierung stehen.
	political:   { orte: false, wege: false, flussnamen: true  },
	powerlines:  { orte: null,  wege: false, flussnamen: false },
	// "Landschaften": die Flächen sollen lesbar sein, deshalb keine Straßen (Owner 2026-08-05). Damit
	// fallen auch die Straßennamen weg -- die hängen an #togglePaths. Die Flussnamen bleiben auf
	// ausdrückliche Entscheidung stehen, aber fest und nicht mehr geerbt.
	ecosystem:   { orte: null,  wege: false, flussnamen: true  },
};

// Setzt die Sichtbarkeits-Vorgaben des Zielmodus. Die Ortsklassen nur bei includeCities (beim
// Erst-Laden mit Stadt-Parametern im Deep-Link unterdrückt).
function applyFrontendLayerModeDefaults(mode, { includeCities = true } = {}) {
	if (typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE) {
		// Editmode laesst Ortsklassen sonst komplett manuell (Haken steuern alles) -- aber beim Wechsel auf
		// "Standard" sollen sie trotzdem wie im Frontend ALLE angehen (v.a. Gebaeude/Bauwerke), sonst bleibt
		// ein zuvor ausgeblendeter Typ im Editor unsichtbar und wird beim Bearbeiten leicht uebersehen.
		if (mode === "deregraphic" && includeCities && typeof setAllLocationTypesVisible === "function") {
			setAllLocationTypesVisible(true);
		}
		return;
	}
	const defaults = FRONTEND_LAYER_MODE_DEFAULTS[mode];
	if (!defaults) {
		return;
	}

	if (includeCities && defaults.orte !== null && typeof setAllLocationTypesVisible === "function") {
		setAllLocationTypesVisible(defaults.orte);
	}
	$("#togglePaths").prop("checked", defaults.wege);
	$("#toggleRivers").prop("checked", false);
	if (typeof pathRiverLabelsOverridden !== "undefined") {
		pathRiverLabelsOverridden = true;
		pathRiverLabelsVisible = defaults.flussnamen;
	}
	syncPathVisibility();
	if (mode === "powerlines") {
		syncLocationMarkerVisibility(); // restliche Marker ausblenden, Nodices einblenden
	}
	// 💣 UND ZULETZT DIE LANDSCHAFTEN-EBENE, denn sie verfeinert genau diese Vorgaben JE EBENE
	// (23.08.2026). Die Reihenfolge ist der ganze Grund für diese zwei Zeilen: der Umschalter ruft
	// `setSelectedMapLayerMode(...)` und DANACH diese Funktion (js/map-features/map-features.js) --
	// die Ebene hat also längst gesetzt, was sie zeigen will, und die Zeilen darüber machen es wieder
	// platt. Ohne das ist die Regel nur auf dem Weg wirksam, den kein Benutzer geht (direkter Aufruf
	// von setSelectedMapLayerMode), und über den Umschalter gar nicht -- genau die Sorte Lücke, die
	// eine Abnahme am falschen Weg für erledigt hält.
	// ⚠️ Steht hinter dem frühen Ausstieg für IS_EDIT_MODE: der Editor bekommt hier ohnehin nichts.
	if (typeof syncEcosystemRiverVisibility === "function") {
		syncEcosystemRiverVisibility();
	}
	if (typeof syncEcosystemFrontendFeatures === "function") {
		syncEcosystemFrontendFeatures();
	}
}

function applyDisplayOptions() {
	syncLocationToggleButtons();
	syncLocationMarkerVisibility();
	syncPathVisibility();
	syncPowerlineVisibility();
	syncRegionVisibility();
	syncLabelVisibility();
	// PERF: Wege-Viewport-Culling an Pan/Zoom hängen (einmalig). Reduziert die von Leaflet pro Zoom
	// reprojizierten SVG-Pfade von ~5500 auf die paar Hundert sichtbaren -> raus-/reinzoomen ~2x schneller.
	if (!window.__pathViewportCullingHooked && typeof map !== "undefined" && map && typeof map.on === "function") {
		window.__pathViewportCullingHooked = true;
		map.on("moveend zoomend", syncPathViewportCulling);
	}
}

// Live-Tuning der "Magiersicht"-Entsättigung (Grund-Karte im Kraftlinien-Modus), nur mit ?leytune=1 (oben links).
// Sliders wirken sofort, wenn man im Kraftlinien-Modus ist. OK -> window.__avesmapsLeyTint.
(function initLeyMapTintPanel() {
	let on = false;
	try { on = new URLSearchParams(window.location.search).has("leytune"); } catch (e) { on = false; }
	if (!on || !document.body) return;
	const panel = document.createElement("div");
	panel.style.cssText = "position:fixed;left:12px;top:12px;z-index:99999;background:rgba(28,28,28,0.92);color:#fff;font:12px Georgia,serif;padding:10px 12px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.45);width:210px;";
	const title = document.createElement("div");
	title.textContent = "Magiersicht (Kraftlinien)"; title.style.cssText = "font-weight:bold;margin-bottom:8px;";
	panel.appendChild(title);
	const slider = (label, min, max, step, value, apply) => {
		const wrap = document.createElement("div"); wrap.style.marginBottom = "7px";
		const head = document.createElement("div"); head.style.cssText = "display:flex;justify-content:space-between;margin-bottom:2px;";
		const name = document.createElement("span"); name.textContent = label;
		const val = document.createElement("span"); val.textContent = value;
		head.appendChild(name); head.appendChild(val);
		const input = document.createElement("input");
		input.type = "range"; input.min = min; input.max = max; input.step = step; input.value = value; input.style.width = "100%";
		input.addEventListener("input", () => { val.textContent = input.value; apply(parseFloat(input.value)); });
		wrap.appendChild(head); wrap.appendChild(input);
		panel.appendChild(wrap);
	};
	const apply = () => { try { if (typeof syncPowerlineMapTint === "function") syncPowerlineMapTint(); } catch (e) { /* noop */ } };
	slider("Sättigung", 0, 1, 0.05, LEY_MAP_SATURATION, (v) => { LEY_MAP_SATURATION = v; apply(); });
	slider("Helligkeit", 0.2, 1, 0.05, LEY_MAP_BRIGHTNESS, (v) => { LEY_MAP_BRIGHTNESS = v; apply(); });
	const okBtn = document.createElement("button");
	okBtn.textContent = "OK / Werte merken";
	okBtn.style.cssText = "width:100%;margin-top:10px;padding:7px;border:1px solid #5e4329;border-radius:6px;background:#7a5a3a;color:#fff;font:inherit;cursor:pointer;";
	okBtn.addEventListener("click", () => {
		window.__avesmapsLeyTint = { saturation: LEY_MAP_SATURATION, brightness: LEY_MAP_BRIGHTNESS };
		console.log("[Magiersicht] " + JSON.stringify(window.__avesmapsLeyTint));
		okBtn.textContent = "✓ gemerkt"; setTimeout(() => { okBtn.textContent = "OK / Werte merken"; }, 1500);
	});
	panel.appendChild(okBtn);
	const hint = document.createElement("div");
	hint.textContent = "Wirkt im Modus Kraftlinien. Sättigung 0 = grau."; hint.style.cssText = "opacity:0.6;margin-top:6px;";
	panel.appendChild(hint);
	document.body.appendChild(panel);
})();
