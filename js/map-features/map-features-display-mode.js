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

function setSelectedMapLayerMode(mode) {
	const normalizedMode = ["none", "political", "deregraphic", "powerlines", "original"].includes(mode) ? mode : DEFAULT_PLANNER_STATE.mapLayerMode;
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
	syncRegionVisibility();
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

// Frontend-Sichtbarkeits-Defaults je Kartenmodus (im Editmode NICHT -- dort steuern die Haken Wege/Flüsse alles):
//  - "Nur Karte" (none): freie Karte -> alle Städte aus, Straßen aus, Flussnamen aus.
//  - "Standard" (deregraphic): alle Städte an, Straßen + Straßennamen an, Flussnamen an (Fluss-PFADE bleiben aus).
//  - political/powerlines: keine Auto-Defaults (Zustand bleibt wie zuvor).
// Die Städte werden nur bei includeCities gesetzt (beim Erst-Laden mit Stadt-Parametern im Deep-Link unterdrückt).
function applyFrontendLayerModeDefaults(mode, { includeCities = true } = {}) {
	if (typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE) {
		return;
	}
	if (mode === "political") {
		// Politische Ansicht: Standard-Siedlungsanzeige = NUR die Hauptstädte der aktuell ANGEZEIGTEN Gebiete
		// (das übernimmt das immer-an-Feature in shouldShowLocationMarker/NameLabel, zoom/flächen-abhängig).
		// Daher die Typ-Toggles auf AUS defaulten: klickt der Nutzer einen Typ an, kommt dieser zusätzlich;
		// ein erneuter Wechsel auf "Politisch" setzt wieder auf nur-Hauptstädte zurück.
		if (includeCities && typeof setAllLocationTypesVisible === "function") {
			setAllLocationTypesVisible(false);
		}
		return;
	}
	if (mode !== "none" && mode !== "original" && mode !== "deregraphic" && mode !== "powerlines") {
		return; // (political wird oben behandelt)
	}
	const isStandard = mode === "deregraphic";
	// Städte nur in none/deregraphic setzen; im Kraftlinien-Modus zeigt shouldShowLocationMarker ohnehin nur Nodices.
	if (includeCities && mode !== "powerlines") {
		setAllLocationTypesVisible(isStandard);
	}
	// Straßen/Flüsse nur im Standard an; in "Nur Karte" UND "Kraftlinien" aus.
	$("#togglePaths").prop("checked", isStandard);
	$("#toggleRivers").prop("checked", false);
	if (typeof pathRiverLabelsOverridden !== "undefined") {
		pathRiverLabelsOverridden = true;
		pathRiverLabelsVisible = isStandard;
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
