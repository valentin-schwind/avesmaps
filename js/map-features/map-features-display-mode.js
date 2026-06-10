function syncPathVisibility() {
	const showPaths = $("#togglePaths").is(":checked");
	const showRivers = $("#toggleRivers").is(":checked");
	const showSeaPaths = IS_EDIT_MODE && $("#toggleSeaPaths").is(":checked");

	// Standardmäßig folgen die Fluss-Labels den Fluss-Pfaden. Sobald im ?pathtune=1-Panel der Label-Schalter
	// benutzt wurde (Override), bleibt die Entkopplung bestehen: Pfade ausblenden lässt die Labels stehen.
	if (typeof pathRiverLabelsOverridden !== "undefined" && !pathRiverLabelsOverridden) {
		pathRiverLabelsVisible = showRivers;
	}

	$.each(pathLayers, (i, layer) => {
		const path = pathData[i];
		const shouldShow = shouldShowPathOnMap(path, { showPaths, showRivers, showSeaPaths });
		map[shouldShow ? "addLayer" : "removeLayer"](layer);
		// Label-Linie dauerhaft auf der Karte halten (nicht im Group); der Text wird über refreshPathLayerText
		// gesteuert -> Fluss-Labels bleiben sichtbar, auch wenn die Fluss-Pfade ausgeblendet sind.
		if (path?._pathLabelLine) {
			map.addLayer(path._pathLabelLine);
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
	const normalizedMode = ["none", "political", "deregraphic", "powerlines"].includes(mode) ? mode : DEFAULT_PLANNER_STATE.mapLayerMode;
	$("#mapLayerModeSelect").val(normalizedMode);
	syncTransportControl("mapLayerModeSelect");
	if (IS_EDIT_MODE && normalizedMode === "powerlines") {
		$("#toggleNodix").prop("checked", true);
		syncLocationMarkerVisibility();
	}
	syncRegionVisibility();
	syncLabelVisibility();
	syncPowerlineVisibility();
	syncPowerlineMapTint();
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
	if (mode !== "none" && mode !== "deregraphic") {
		return; // political/powerlines: nichts erzwingen
	}
	const isStandard = mode === "deregraphic";
	if (includeCities) {
		setAllLocationTypesVisible(isStandard);
	}
	$("#togglePaths").prop("checked", isStandard);
	$("#toggleRivers").prop("checked", false);
	if (typeof pathRiverLabelsOverridden !== "undefined") {
		pathRiverLabelsOverridden = true;
		pathRiverLabelsVisible = isStandard;
	}
	syncPathVisibility();
}

function applyDisplayOptions() {
	syncLocationToggleButtons();
	syncLocationMarkerVisibility();
	syncPathVisibility();
	syncPowerlineVisibility();
	syncRegionVisibility();
	syncLabelVisibility();
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
