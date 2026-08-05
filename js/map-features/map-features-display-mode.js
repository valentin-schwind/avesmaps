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
	};
}

// Soll dieser Pfad gerade auf der Karte liegen? = Toggle/Modus (shouldShowPathOnMap) UND am aktuellen Zoom
// sichtbare Breite (Skalierung > 0) UND im (gepolsterten) Sichtfeld. So reprojiziert Leaflet bei jedem Zoom nur
// die paar Hundert sichtbaren Wege statt aller ~5500 -> raus-/reinzoomen deutlich schneller.
function pathShouldBeOnMap(path, ctx) {
	if (!shouldShowPathOnMap(path, ctx)) {
		return false;
	}
	if (typeof getPathWidthScale === "function") {
		const subtype = normalizePathSubtype(path?.properties?.feature_subtype || path?.properties?.name);
		if (!(getPathWidthScale(subtype, ctx.zoom) > 0)) {
			return false;
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

// Die zwei Editor-Haken ("Labels"/"Grenzen") folgen dem Modus: bei jedem Moduswechsel werden sie auf
// das gesetzt, was der neue Modus von sich aus zeigt. Damit aendert ein Moduswechsel das Kartenbild
// GENAU so wie bisher -- die Haken sind eine Abweichung NACH dem Wechsel, kein Dauer-Uebersteuern.
// (Owner 2026-07-26: das bisherige Verhalten bleibt; Politisch behaelt seine Grenzdarstellung.)
function syncEditorDisplayTogglesToMode(mode) {
	if (typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) {
		return;
	}

	$("#toggleMapLabels").prop("checked", MAP_LABEL_MODES.includes(mode));
	$("#toggleTerritoryBorders").prop("checked", BOUNDARY_OVERLAY_MODES.includes(mode));
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
	// Karte (Tile-Style "old"). Beim Verlassen zurueck auf "stylized" -- im Frontend automatisch; im
	// Edit-Modus bleibt eine manuell ueber #mapStyleSelect gewaehlte Basis unangetastet.
	if (typeof setMapStyle === "function") {
		if (normalizedMode === "original") {
			setMapStyle("old");
		} else if (typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) {
			// Alle anderen Derographie-Modi nutzen im Frontend IMMER die stylized-Basis. setMapStyle ist
			// ein No-op, wenn stylized bereits aktiv ist (Guard in bootstrap.js), daher unbedingt sicher.
			setMapStyle("stylized");
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
		// davon fern. Wege/Fluesse darunter bleiben hier richtig -- fuer die gibt es keine Erinnerung.
		$("#togglePaths").prop("checked", false);
		// Fluesse gehen jetzt AUS. Das kehrt die Entscheidung vom Vormittag (2026-07-26) um, sie als
		// Zeichenvorlage anzulassen -- nach dem ersten echten Zeichnen entschied der Owner am selben Tag
		// anders: die blauen Linien laufen quer durch jede Flaeche, die man gerade zieht. Wie alle Zeilen
		// hier ist das nur die Voreinstellung beim Betreten; der Haken schaltet sie von Hand zurueck.
		$("#toggleRivers").prop("checked", false);
		$("#toggleSeaPaths").prop("checked", false);
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
