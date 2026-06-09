function shouldPathNameBeDisplayed(path) {
	return path?.properties?.show_label === true || path?.properties?.show_label === 1 || path?.properties?.show_label === "1";
}

function isPathLabelVisibleAtCurrentZoom(path) {
	const pathSubtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
	const minZoom = pathSubtype === "Flussweg" || pathSubtype === "Seeweg"
		? 3
		: LOCATION_NAME_LABEL_CONFIG.dorf.minZoom;
	return shouldPathNameBeDisplayed(path) && map.getZoom() >= minZoom;
}

// Live tunbar via ?pathtune=1 (siehe Panel am Dateiende).
let PATH_LABEL_FONT_DELTA = 0;      // px auf die berechnete (zoomabhängige) Größe
let PATH_LABEL_DY = -6;             // px Abstand der Schrift zur Linie (negativ = darüber)
let PATH_LABEL_STROKE_WIDTH = 2;    // px Halo/Kontur
let PATH_LABEL_LETTER_SPACING = 0;  // px Sperrung

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

	const fontSize = Math.max(4, getLocationNameLabelSize("dorf") + (pathSubtype === "Flussweg" ? 3 : 1) + PATH_LABEL_FONT_DELTA);
	return {
		fill: fillColors[pathSubtype] || fillColors.Weg,
		stroke: "rgba(0, 0, 0, 0.75)",
		strokeWidth: `${PATH_LABEL_STROKE_WIDTH}px`,
		paintOrder: "stroke",
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
	const regeom = () => { try { if (typeof pathData !== "undefined") pathData.forEach((p) => { try { updatePathLayerGeometry(p); } catch (e) {} }); } catch (e) {} restyle(); };
	const panel = document.createElement("div");
	panel.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:99999;background:rgba(28,28,28,0.92);color:#fff;font:12px Georgia,serif;padding:10px 12px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.45);width:210px;max-height:88vh;overflow:auto;";
	const title = document.createElement("div");
	title.textContent = "Pfad-Namen-Tuning"; title.style.cssText = "font-weight:bold;margin-bottom:8px;";
	panel.appendChild(title);
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
	// path-rendering.js (mit PATH_LABEL_GUIDE_SMOOTHING) lädt NACH dieser Datei -> Config frisch holen.
	const smCfg = () => (typeof PATH_LABEL_GUIDE_SMOOTHING !== "undefined") ? PATH_LABEL_GUIDE_SMOOTHING : null;
	const smInit = smCfg() || { window: 2, passes: 2 };
	slider("Schriftgröße ±", -6, 12, 1, PATH_LABEL_FONT_DELTA, (v) => { PATH_LABEL_FONT_DELTA = v; restyle(); });
	slider("Abstand zur Linie (dy)", -28, 12, 1, PATH_LABEL_DY, (v) => { PATH_LABEL_DY = v; restyle(); });
	slider("Halo-/Konturbreite (px)", 0, 6, 0.5, PATH_LABEL_STROKE_WIDTH, (v) => { PATH_LABEL_STROKE_WIDTH = v; restyle(); });
	slider("Sperrung (px)", 0, 8, 0.5, PATH_LABEL_LETTER_SPACING, (v) => { PATH_LABEL_LETTER_SPACING = v; restyle(); });
	slider("Glättung: Fenster", 1, 6, 1, smInit.window, (v) => { const c = smCfg(); if (c) c.window = v; regeom(); });
	slider("Glättung: Pässe", 1, 4, 1, smInit.passes, (v) => { const c = smCfg(); if (c) c.passes = v; regeom(); });
	const okBtn = document.createElement("button");
	okBtn.textContent = "OK / Werte merken";
	okBtn.style.cssText = "width:100%;margin-top:10px;padding:7px;border:1px solid #5e4329;border-radius:6px;background:#7a5a3a;color:#fff;font:inherit;cursor:pointer;";
	okBtn.addEventListener("click", () => {
		const c = smCfg() || {};
		const result = { fontDelta: PATH_LABEL_FONT_DELTA, dy: PATH_LABEL_DY, strokeWidth: PATH_LABEL_STROKE_WIDTH, letterSpacing: PATH_LABEL_LETTER_SPACING, smoothingWindow: c.window, smoothingPasses: c.passes };
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

function getReadablePathLabelLatLngCoordinates(latLngCoords) {
	if (latLngCoords.length < 2) {
		return latLngCoords;
	}

	const startPoint = map.latLngToLayerPoint(latLngCoords[0]);
	const endPoint = map.latLngToLayerPoint(latLngCoords[latLngCoords.length - 1]);
	return endPoint.x < startPoint.x ? [...latLngCoords].reverse() : latLngCoords;
}
