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
let PATH_LABEL_STROKE_WIDTH = 2;    // px Halo/Kontur
let PATH_LABEL_LETTER_SPACING = 1;  // px Sperrung
// Leitlinie = sichtbare Linie, nur neu abgetastet: <1 ausdünnen (ruhiger), 1 = exakt die Linie, >1 dichter.
let PATH_LABEL_GUIDE_DENSITY = 1;   // (von map-features-path-rendering.js gelesen)

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
	slider("Halo-/Konturbreite (px)", 0, 6, 0.5, PATH_LABEL_STROKE_WIDTH, (v) => { PATH_LABEL_STROKE_WIDTH = v; restyle(); });
	slider("Sperrung (px)", 0, 8, 0.5, PATH_LABEL_LETTER_SPACING, (v) => { PATH_LABEL_LETTER_SPACING = v; restyle(); });
	// Leitlinie liegt auf der sichtbaren Linie; Dichte <1 = vereinfacht (ausgedünnt), 1 = exakt, >1 = dichter.
	slider("Dichte (vereinfachen↔dichter)", 0.1, 4, 0.1, PATH_LABEL_GUIDE_DENSITY, (v) => { PATH_LABEL_GUIDE_DENSITY = v; regeom(); });
	const okBtn = document.createElement("button");
	okBtn.textContent = "OK / Werte merken";
	okBtn.style.cssText = "width:100%;margin-top:10px;padding:7px;border:1px solid #5e4329;border-radius:6px;background:#7a5a3a;color:#fff;font:inherit;cursor:pointer;";
	okBtn.addEventListener("click", () => {
		const result = { fontDelta: PATH_LABEL_FONT_DELTA, dy: PATH_LABEL_DY, strokeWidth: PATH_LABEL_STROKE_WIDTH, letterSpacing: PATH_LABEL_LETTER_SPACING, guideDensity: PATH_LABEL_GUIDE_DENSITY };
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
