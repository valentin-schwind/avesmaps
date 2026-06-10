function shouldPathNameBeDisplayed(path) {
	return path?.properties?.show_label === true || path?.properties?.show_label === 1 || path?.properties?.show_label === "1";
}

// Schalter für Fluss-/Seeweg-Labels. Standardmäßig folgen sie den Fluss-Pfaden (syncPathVisibility setzt den
// Wert = #toggleRivers, solange nichts übersteuert ist). Sobald der Label-Schalter im ?pathtune=1-Panel benutzt
// wurde, greift der Override: die Labels sind dann von den Pfaden entkoppelt (Pfade aus -> Labels bleiben).
let pathRiverLabelsVisible = false;
let pathRiverLabelsOverridden = false;

function isPathLabelVisibleAtCurrentZoom(path) {
	const pathSubtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
	const isRiver = pathSubtype === "Flussweg" || pathSubtype === "Seeweg";
	if (isRiver) {
		if (!pathRiverLabelsVisible) {
			return false;
		}
	} else if (typeof $ === "function" && !$("#togglePaths").is(":checked")) {
		// Wege-/Straßen-Labels folgen weiterhin ihrer Pfad-Sichtbarkeit (#togglePaths).
		return false;
	}
	const minZoom = isRiver ? 3 : LOCATION_NAME_LABEL_CONFIG.dorf.minZoom;
	return shouldPathNameBeDisplayed(path) && map.getZoom() >= minZoom;
}

// Live tunbar via ?pathtune=1 (siehe Panel am Dateiende).
let PATH_LABEL_FONT_DELTA = -1;     // px auf die berechnete (zoomabhängige) Größe
let PATH_LABEL_DY = 0;              // px Abstand der Schrift zur Linie (negativ = darüber)
// Halo der Pfad-Namen, getrennt für Flüsse/Seewege und Straßen/Wege -- wie bei den Siedlungs-Labels:
// Stärke (0..5) = Halo-Prominenz, Schärfe (0..1) = weicher Schein (CSS drop-shadow) <-> scharfe Kontur (SVG-Stroke).
let PATH_LABEL_RIVER_HALO_STRENGTH = 1;
let PATH_LABEL_RIVER_HALO_SHARPNESS = 1;
let PATH_LABEL_ROAD_HALO_STRENGTH = 1;
let PATH_LABEL_ROAD_HALO_SHARPNESS = 1;
let PATH_LABEL_LETTER_SPACING = 1;  // px Sperrung
// Leitlinie = sichtbare Linie, nur neu abgetastet: <1 ausdünnen (ruhiger), 1 = exakt die Linie, >1 dichter.
let PATH_LABEL_GUIDE_DENSITY = 1;   // (von map-features-path-rendering.js gelesen)

// SVG-Halo eines Pfad-Labels aus Stärke/Schärfe. Scharfer Anteil = SVG-Stroke (paint-order:stroke), weicher
// Anteil = CSS drop-shadow (mehrere Pässe ~ Stärke für Dichte). Stärke 0 = kein Halo. drop-shadow nur bei
// Schärfe < 1 -> der Default (Schärfe 1) ist filterfrei und damit günstig.
function getPathLabelHaloParams(strength, sharpness, fontSize) {
	const s = Math.max(0, Number(strength) || 0);
	if (s <= 0) {
		return { stroke: "transparent", strokeWidth: "0px", paintOrder: "stroke", filter: "none" };
	}
	const sharp = Math.max(0, Math.min(1, Number(sharpness) || 0));
	const color = `rgba(0, 0, 0, ${Math.min(1, 0.85 * s)})`;
	const reach = fontSize * 0.16 * Math.max(1, s);
	const strokeW = reach * sharp;
	const blur = reach * (1 - sharp);
	let filter = "none";
	if (blur > 0.1) {
		const passes = Math.max(1, Math.round(s));
		filter = Array.from({ length: passes }, () => `drop-shadow(0 0 ${blur.toFixed(2)}px ${color})`).join(" ");
	}
	return {
		stroke: strokeW > 0.05 ? color : "transparent",
		strokeWidth: `${strokeW.toFixed(2)}px`,
		paintOrder: "stroke",
		filter,
	};
}

function getPathLabelStyle(path) {
	const pathSubtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
	const fillColors = {
		Reichsstrasse: "#f4f4f4",
		Strasse: "#dddddd",
		Weg: "#f0ddb0",
		Pfad: "#d8b28a",
		Gebirgspass: "#e0a090",
		Wuestenpfad: "#f1c56f",
		Flussweg: "#b9e7ff",
		Seeweg: "#9ed0ff",
	};

	const isRiver = pathSubtype === "Flussweg" || pathSubtype === "Seeweg";
	const fontSize = Math.max(4, getLocationNameLabelSize("dorf") + (pathSubtype === "Flussweg" ? 3 : 1) + PATH_LABEL_FONT_DELTA);
	const halo = getPathLabelHaloParams(
		isRiver ? PATH_LABEL_RIVER_HALO_STRENGTH : PATH_LABEL_ROAD_HALO_STRENGTH,
		isRiver ? PATH_LABEL_RIVER_HALO_SHARPNESS : PATH_LABEL_ROAD_HALO_SHARPNESS,
		fontSize
	);
	return {
		fill: fillColors[pathSubtype] || fillColors.Weg,
		stroke: halo.stroke,
		strokeWidth: halo.strokeWidth,
		paintOrder: halo.paintOrder,
		filter: halo.filter,
		fontFamily: 'Georgia, "Times New Roman", serif',
		fontSize: `${fontSize}px`,
		fontWeight: "400",
		letterSpacing: `${PATH_LABEL_LETTER_SPACING}px`,
	};
}

function refreshPathLayerText(path) {
	const labelLine = path?._pathLabelLine;
	if (!labelLine?.setText) {
		return;
	}

	if (!isPathLabelVisibleAtCurrentZoom(path)) {
		labelLine.removeText?.();
		return;
	}

	labelLine.setText(getPathDisplayName(path), {
		className: `path-name-text path-name-text--${normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name)}`,
		offset: "50%",
		textAnchor: "middle",
		dy: String(PATH_LABEL_DY),
		style: getPathLabelStyle(path),
	});
}

function syncPathLabels() {
	pathData.forEach(refreshPathLayerText);
}

// Optionales Live-Tuning-Panel für Pfad-Namen (Wege/Flüsse), nur mit ?pathtune=1. Unten LINKS (das
// Grenz-Label-Panel sitzt unten rechts). Stil-Slider re-rendern den Text (billig); Glättungs-Slider
// berechnen die Label-Leitlinien-Geometrie neu (etwas teurer, einmalig). OK schreibt nach
// window.__avesmapsPathLabelTuning (zum Übernehmen als Default).
(function initPathLabelTuningPanel() {
	let on = false;
	try { on = new URLSearchParams(window.location.search).has("pathtune"); } catch (e) { on = false; }
	if (!on || !document.body) return;
	const restyle = () => { try { if (typeof syncPathLabels === "function") syncPathLabels(); } catch (e) { /* noop */ } };
	// Geometrie-Neuberechnung (~400ms bei vielen Pfaden) entprellt -> Slider bleibt beim Ziehen flüssig.
	let regeomTimer = null;
	const regeom = () => {
		if (regeomTimer) clearTimeout(regeomTimer);
		regeomTimer = setTimeout(() => {
			regeomTimer = null;
			try { if (typeof pathData !== "undefined") pathData.forEach((p) => { try { updatePathLayerGeometry(p); } catch (e) {} }); } catch (e) {}
			restyle();
		}, 140);
	};
	const panel = document.createElement("div");
	panel.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:99999;background:rgba(28,28,28,0.92);color:#fff;font:12px Georgia,serif;padding:10px 12px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.45);width:210px;max-height:88vh;overflow:auto;";
	const title = document.createElement("div");
	title.textContent = "Pfad-Namen-Tuning"; title.style.cssText = "font-weight:bold;margin-bottom:8px;";
	panel.appendChild(title);
	// Checkbox-Helfer (eine Zeile, Label links).
	const checkbox = (text, checked, onChange) => {
		const lbl = document.createElement("label");
		lbl.style.cssText = "display:flex;align-items:center;gap:6px;margin:0 0 8px;cursor:pointer;";
		const inp = document.createElement("input");
		inp.type = "checkbox";
		try { inp.checked = !!checked; } catch (e) {}
		inp.addEventListener("change", () => onChange(inp.checked));
		const span = document.createElement("span"); span.textContent = text;
		lbl.appendChild(inp); lbl.appendChild(span);
		panel.appendChild(lbl);
		return inp;
	};
	// (1) Fluss-PFADE an/aus -- toggelt die bestehende #toggleRivers-Logik.
	let riversPathChecked = false;
	try { riversPathChecked = !!document.querySelector("#toggleRivers")?.checked; } catch (e) {}
	checkbox("Flüsse (Pfade) anzeigen", riversPathChecked, (on) => {
		const el = document.querySelector("#toggleRivers");
		if (el) { el.checked = on; el.dispatchEvent(new Event("change", { bubbles: true })); }
	});
	// (2) Fluss-LABELS an/aus -- unabhängig von den Pfaden (setzt den Override -> Pfade aus lässt Labels stehen).
	checkbox("Fluss-Labels anzeigen", pathRiverLabelsVisible, (on) => {
		pathRiverLabelsOverridden = true;
		pathRiverLabelsVisible = on;
		try { if (typeof syncPathLabels === "function") syncPathLabels(); } catch (e) {}
	});
	const slider = (label, min, max, step, value, apply) => {
		const wrap = document.createElement("div"); wrap.style.marginBottom = "7px";
		const head = document.createElement("div"); head.style.cssText = "display:flex;justify-content:space-between;margin-bottom:2px;";
		const name = document.createElement("span"); name.textContent = label;
		const val = document.createElement("span"); val.textContent = value;
		head.appendChild(name); head.appendChild(val);
		const input = document.createElement("input");
		input.type = "range"; input.min = min; input.max = max; input.step = step; input.value = value; input.style.width = "100%";
		input.addEventListener("input", function () { val.textContent = input.value; apply(parseFloat(input.value)); });
		wrap.appendChild(head); wrap.appendChild(input);
		panel.appendChild(wrap);
	};
	slider("Schriftgröße ±", -6, 12, 1, PATH_LABEL_FONT_DELTA, (v) => { PATH_LABEL_FONT_DELTA = v; restyle(); });
	slider("Abstand zur Linie (dy)", -28, 12, 1, PATH_LABEL_DY, (v) => { PATH_LABEL_DY = v; restyle(); });
	slider("Flüsse Halo-Stärke", 0, 5, 0.1, PATH_LABEL_RIVER_HALO_STRENGTH, (v) => { PATH_LABEL_RIVER_HALO_STRENGTH = v; restyle(); });
	slider("Flüsse Halo-Schärfe", 0, 1, 0.05, PATH_LABEL_RIVER_HALO_SHARPNESS, (v) => { PATH_LABEL_RIVER_HALO_SHARPNESS = v; restyle(); });
	slider("Straßen Halo-Stärke", 0, 5, 0.1, PATH_LABEL_ROAD_HALO_STRENGTH, (v) => { PATH_LABEL_ROAD_HALO_STRENGTH = v; restyle(); });
	slider("Straßen Halo-Schärfe", 0, 1, 0.05, PATH_LABEL_ROAD_HALO_SHARPNESS, (v) => { PATH_LABEL_ROAD_HALO_SHARPNESS = v; restyle(); });
	slider("Sperrung (px)", 0, 8, 0.5, PATH_LABEL_LETTER_SPACING, (v) => { PATH_LABEL_LETTER_SPACING = v; restyle(); });
	// Leitlinie liegt auf der sichtbaren Linie; Dichte <1 = vereinfacht (ausgedünnt), 1 = exakt, >1 = dichter.
	slider("Dichte (vereinfachen↔dichter)", 0.1, 4, 0.1, PATH_LABEL_GUIDE_DENSITY, (v) => { PATH_LABEL_GUIDE_DENSITY = v; regeom(); });
	const okBtn = document.createElement("button");
	okBtn.textContent = "OK / Werte merken";
	okBtn.style.cssText = "width:100%;margin-top:10px;padding:7px;border:1px solid #5e4329;border-radius:6px;background:#7a5a3a;color:#fff;font:inherit;cursor:pointer;";
	okBtn.addEventListener("click", () => {
		const result = { fontDelta: PATH_LABEL_FONT_DELTA, dy: PATH_LABEL_DY, riverHaloStrength: PATH_LABEL_RIVER_HALO_STRENGTH, riverHaloSharpness: PATH_LABEL_RIVER_HALO_SHARPNESS, roadHaloStrength: PATH_LABEL_ROAD_HALO_STRENGTH, roadHaloSharpness: PATH_LABEL_ROAD_HALO_SHARPNESS, letterSpacing: PATH_LABEL_LETTER_SPACING, guideDensity: PATH_LABEL_GUIDE_DENSITY };
		window.__avesmapsPathLabelTuning = result;
		console.log("[Pfad-Namen-Tuning] " + JSON.stringify(result));
		okBtn.textContent = "✓ gemerkt"; setTimeout(() => { okBtn.textContent = "OK / Werte merken"; }, 1500);
	});
	panel.appendChild(okBtn);
	const hint = document.createElement("div");
	hint.textContent = "Wege/Flüsse an + Labels sichtbar (Zoom)"; hint.style.cssText = "opacity:0.6;margin-top:6px;";
	panel.appendChild(hint);
	document.body.appendChild(panel);
})();

// Test-Matrix für die KONTURBREITEN (outlineWeight) je Wegform × Zoomstufe, nur mit ?pathwidthtune=1.
// Zeilen = Subtypen, Spalten = Zoom 0..6. Jeder Slider setzt PATH_OUTLINE_WIDTH_OVERRIDE[subtyp][zoom] und
// re-styled live (syncPathRendering). Sichtbar wird eine Änderung in der Zoomstufe, in der man gerade steht
// (aktuelle Spalte ist hervorgehoben). OK schreibt die volle Matrix nach window.__avesmapsPathOutlineWidths.
(function initPathOutlineWidthMatrixPanel() {
	let on = false;
	try { on = new URLSearchParams(window.location.search).has("pathwidthtune"); } catch (e) { on = false; }
	if (!on || !document.body) return;
	const ZOOMS = [0, 1, 2, 3, 4, 5, 6];
	const LABELS = { Reichsstrasse: "Reichsstr.", Strasse: "Straße", Weg: "Weg", Pfad: "Pfad", Gebirgspass: "Geb.pass", Wuestenpfad: "Wüstenpf.", Flussweg: "Fluss", Seeweg: "See/Meer" };
	const subtypes = (typeof PATH_SUBTYPE_KEYS !== "undefined") ? PATH_SUBTYPE_KEYS : Object.keys(LABELS);
	const eff = (st, z) => (typeof getEffectivePathOutlineWidth === "function" ? getEffectivePathOutlineWidth(st, z) : 0);
	const restyle = () => { try { if (typeof syncPathRendering === "function") syncPathRendering(); } catch (e) { /* noop */ } };
	const setOverride = (st, z, v) => {
		if (typeof PATH_OUTLINE_WIDTH_OVERRIDE === "undefined") return;
		if (!PATH_OUTLINE_WIDTH_OVERRIDE[st]) PATH_OUTLINE_WIDTH_OVERRIDE[st] = {};
		PATH_OUTLINE_WIDTH_OVERRIDE[st][z] = v;
	};
	const panel = document.createElement("div");
	panel.style.cssText = "position:fixed;right:12px;top:12px;z-index:99999;background:rgba(28,28,28,0.94);color:#fff;font:11px Georgia,serif;padding:10px 12px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.45);max-height:92vh;overflow:auto;";
	const title = document.createElement("div");
	title.textContent = "Konturbreiten-Matrix (Wege)"; title.style.cssText = "font-weight:bold;margin-bottom:8px;";
	panel.appendChild(title);
	const grid = document.createElement("div");
	grid.style.cssText = "display:grid;grid-template-columns:80px repeat(" + ZOOMS.length + ", 60px);gap:4px 6px;align-items:center;";
	grid.appendChild(document.createElement("div")); // Ecke
	const zoomHeaders = {};
	ZOOMS.forEach((z) => {
		const h = document.createElement("div");
		h.textContent = "z" + z; h.style.cssText = "text-align:center;font-weight:bold;opacity:0.85;";
		zoomHeaders[z] = h; grid.appendChild(h);
	});
	subtypes.forEach((st) => {
		const rowLabel = document.createElement("div");
		rowLabel.textContent = LABELS[st] || st; rowLabel.style.cssText = "white-space:nowrap;";
		grid.appendChild(rowLabel);
		ZOOMS.forEach((z) => {
			const cell = document.createElement("div");
			cell.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:1px;";
			const valEl = document.createElement("div");
			const cur = eff(st, z);
			valEl.textContent = String(cur); valEl.style.cssText = "font-size:10px;opacity:0.85;";
			const input = document.createElement("input");
			input.type = "range"; input.min = 0; input.max = 12; input.step = 0.5; input.value = cur; input.style.width = "54px";
			input.addEventListener("input", () => {
				const v = parseFloat(input.value);
				valEl.textContent = String(v);
				setOverride(st, z, v);
				restyle();
			});
			cell.appendChild(valEl); cell.appendChild(input);
			grid.appendChild(cell);
		});
	});
	panel.appendChild(grid);
	const highlight = () => {
		const cz = (typeof map !== "undefined" && map) ? Math.round(Number(map.getZoom())) : null;
		ZOOMS.forEach((z) => { zoomHeaders[z].style.color = (z === cz) ? "#ffd479" : "#fff"; });
	};
	// map wird in bootstrap.js NACH dieser Datei deklariert -> bei Panel-Aufbau noch nicht da. Pollen, bis es steht.
	const wireMap = () => {
		if (typeof map !== "undefined" && map && typeof map.on === "function") {
			highlight();
			map.on("zoomend", highlight);
		} else {
			setTimeout(wireMap, 200);
		}
	};
	wireMap();
	const okBtn = document.createElement("button");
	okBtn.textContent = "OK / Werte merken";
	okBtn.style.cssText = "width:100%;margin-top:10px;padding:7px;border:1px solid #5e4329;border-radius:6px;background:#7a5a3a;color:#fff;font:inherit;cursor:pointer;";
	okBtn.addEventListener("click", () => {
		const matrix = {};
		subtypes.forEach((st) => { matrix[st] = {}; ZOOMS.forEach((z) => { matrix[st][z] = eff(st, z); }); });
		window.__avesmapsPathOutlineWidths = matrix;
		console.log("[Konturbreiten-Matrix] " + JSON.stringify(matrix));
		okBtn.textContent = "✓ gemerkt"; setTimeout(() => { okBtn.textContent = "OK / Werte merken"; }, 1500);
	});
	panel.appendChild(okBtn);
	const hint = document.createElement("div");
	hint.textContent = "Zoome in die Stufe, deren Spalte du testest (z aktuell = gelb). Override macht die Kontur auch bei Zoom ≤2 sichtbar.";
	hint.style.cssText = "opacity:0.6;margin-top:6px;max-width:500px;";
	panel.appendChild(hint);
	document.body.appendChild(panel);
})();

// Test-Matrix für den Breiten-Faktor je STRASSENTYP × Zoomstufe, nur mit ?roadtune=1 (unten rechts). Zeilen =
// 8 Subtypen, Spalten = visueller Zoom 0..5; jeder Slider 0..5 in 0.1-Schritten (1 = normal, 0 = aus). Mutiert
// PATH_WIDTH_SCALE[subtyp][zoom] live (syncPathRendering). OK -> window.__avesmapsPathWidthScale.
(function initRoadWidthScalePanel() {
	let on = false;
	try { on = new URLSearchParams(window.location.search).has("roadtune"); } catch (e) { on = false; }
	if (!on || !document.body || typeof PATH_WIDTH_SCALE === "undefined") return;
	const ZOOMS = [0, 1, 2, 3, 4, 5, 6];
	const LABELS = { Reichsstrasse: "Reichsstr.", Strasse: "Straße", Weg: "Weg", Pfad: "Pfad", Gebirgspass: "Geb.pass", Wuestenpfad: "Wüstenpf.", Flussweg: "Fluss", Seeweg: "See/Meer" };
	const subtypes = (typeof PATH_SUBTYPE_KEYS !== "undefined") ? PATH_SUBTYPE_KEYS : Object.keys(LABELS);
	const cur = (st, z) => { const b = PATH_WIDTH_SCALE[st]; const v = b ? b[z] : undefined; return (typeof v === "number" && v >= 0) ? v : 1; };
	const setScale = (st, z, v) => { if (!PATH_WIDTH_SCALE[st]) PATH_WIDTH_SCALE[st] = {}; PATH_WIDTH_SCALE[st][z] = v; };
	const restyle = () => { try { if (typeof syncPathRendering === "function") syncPathRendering(); } catch (e) { /* noop */ } };
	const panel = document.createElement("div");
	panel.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:99999;background:rgba(28,28,28,0.94);color:#fff;font:11px Georgia,serif;padding:10px 12px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.45);max-height:92vh;overflow:auto;";
	const title = document.createElement("div");
	title.textContent = "Straßenbreite × (Typ × Zoom)"; title.style.cssText = "font-weight:bold;margin-bottom:8px;";
	panel.appendChild(title);
	const grid = document.createElement("div");
	grid.style.cssText = "display:grid;grid-template-columns:80px repeat(" + ZOOMS.length + ", 60px);gap:4px 6px;align-items:center;";
	grid.appendChild(document.createElement("div"));
	const zoomHeads = {};
	ZOOMS.forEach((z) => { const h = document.createElement("div"); h.textContent = "z" + z; h.style.cssText = "text-align:center;font-weight:bold;opacity:0.85;"; zoomHeads[z] = h; grid.appendChild(h); });
	subtypes.forEach((st) => {
		const rowLabel = document.createElement("div"); rowLabel.textContent = LABELS[st] || st; rowLabel.style.cssText = "white-space:nowrap;";
		grid.appendChild(rowLabel);
		ZOOMS.forEach((z) => {
			const cell = document.createElement("div"); cell.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:1px;";
			const valEl = document.createElement("div"); const c = cur(st, z); valEl.textContent = String(c); valEl.style.cssText = "font-size:10px;opacity:0.85;";
			const input = document.createElement("input"); input.type = "range"; input.min = 0; input.max = 5; input.step = 0.1; input.value = c; input.style.width = "54px";
			input.addEventListener("input", () => { const v = parseFloat(input.value); valEl.textContent = String(v); setScale(st, z, v); restyle(); });
			cell.appendChild(valEl); cell.appendChild(input); grid.appendChild(cell);
		});
	});
	panel.appendChild(grid);
	const highlight = () => {
		const cz = (typeof map !== "undefined" && map) ? Math.max(0, Math.min(6, Math.round(Number(map.getZoom())))) : null;
		ZOOMS.forEach((z) => { zoomHeads[z].style.color = (z === cz) ? "#ffd479" : "#fff"; });
	};
	const wireMap = () => {
		if (typeof map !== "undefined" && map && typeof map.on === "function") { highlight(); map.on("zoomend", highlight); }
		else { setTimeout(wireMap, 200); }
	};
	wireMap();
	const okBtn = document.createElement("button");
	okBtn.textContent = "OK / Werte merken";
	okBtn.style.cssText = "width:100%;margin-top:10px;padding:7px;border:1px solid #5e4329;border-radius:6px;background:#7a5a3a;color:#fff;font:inherit;cursor:pointer;";
	okBtn.addEventListener("click", () => {
		const matrix = {}; subtypes.forEach((st) => { matrix[st] = {}; ZOOMS.forEach((z) => { matrix[st][z] = cur(st, z); }); });
		window.__avesmapsPathWidthScale = matrix;
		console.log("[Straßenbreite x] " + JSON.stringify(matrix));
		okBtn.textContent = "✓ gemerkt"; setTimeout(() => { okBtn.textContent = "OK / Werte merken"; }, 1500);
	});
	panel.appendChild(okBtn);
	const hint = document.createElement("div");
	hint.textContent = "1 = normal, 0 = aus, bis 5. Aktuelle Zoom-Spalte = gelb."; hint.style.cssText = "opacity:0.6;margin-top:6px;max-width:520px;";
	panel.appendChild(hint);
	document.body.appendChild(panel);
})();

function getReadablePathLabelLatLngCoordinates(latLngCoords) {
	if (latLngCoords.length < 2) {
		return latLngCoords;
	}

	const startPoint = map.latLngToLayerPoint(latLngCoords[0]);
	const endPoint = map.latLngToLayerPoint(latLngCoords[latLngCoords.length - 1]);
	return endPoint.x < startPoint.x ? [...latLngCoords].reverse() : latLngCoords;
}
