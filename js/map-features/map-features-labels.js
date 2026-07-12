function normalizeLabelFeature(feature) {
	const properties = feature.properties || {};
	const [lng, lat] = feature.geometry?.coordinates || [feature.lng, feature.lat];
	return {
		publicId: properties.public_id || feature.id || feature.public_id || "",
		text: properties.text || properties.name || feature.name || "",
		labelType: properties.feature_subtype || feature.feature_subtype || "region",
		size: Number(properties.size || feature.size || 18),
		rotation: Number(properties.rotation || feature.rotation || 0),
		minZoom: Number(properties.min_zoom ?? feature.min_zoom ?? 0),
		maxZoom: Number(properties.max_zoom ?? feature.max_zoom ?? 7),
		priority: Number(properties.priority ?? feature.priority ?? 3),
		isNodix: Boolean(properties.is_nodix ?? feature.is_nodix),
		revision: Number(properties.revision ?? feature.revision) || null,
		wikiRegion: properties.wiki_region && typeof properties.wiki_region === "object" ? properties.wiki_region : null,
		otherSource: readFeatureOtherSource(properties),
		coordinates: [Number(lat), Number(lng)],
	};
}

// Karten-Labels werden auf ein per-Label-Canvas gerendert und als <img> eingebettet (statt DOM-Text).
// Grund: das Canvas wird in CSS-Auflösung gerastert und auf HiDPI weich hochskaliert -> die Schrift „sinkt"
// in die gemalte Karte ein (wie die Canvas-Grenz-Namen), statt scharf „aufgeklebt" zu wirken. Position,
// Rotation, Kollision (--label-offset) und Interaktivität bleiben DOM (das <img> ersetzt nur den <span>).
const MAP_LABEL_CANVAS_ALPHA = 1; // volle Deckkraft (die Weichheit kommt von der Canvas-Rasterung, nicht Alpha)
const _mapLabelTypeStyleCache = {};
let _mapLabelMeasureCtx = null;
// Gerenderte Label-Bilder cachen: identischer Text/Stil/Größe -> dasselbe data-URL, kein erneutes
// toDataURL pro Zoom/Pan (Siedlungs-Labels können zahlreich sein). LRU-Verdrängung (Treffer rücken in der
// Map-Insertion-Order nach hinten) statt FIFO: beim Zoom-Pendeln zwischen zwei Stufen flogen sonst genau
// die Bilder raus, die gleich wieder gebraucht werden. Limit deckt mehrere Zoomstufen × Halo-Varianten ab.
const _mapLabelImageCache = new Map();
const _MAP_LABEL_IMAGE_CACHE_MAX = 6000;

// Halo-Stärke S (0..5) -> Glow-Parameter für renderMapLabelToImage. S<=0: kein Halo. Bis S=1 wächst die
// Deckkraft (S=1 ~ bisheriger Siedlungslabel-Default, Alpha 0.85); über S=1 hinaus verbreitert sich die
// Unschärfe und es kommen weitere Schatten-Pässe dazu (verdichten den Schein über Alpha 1 hinaus).
function getLabelHaloParams(strength, sharpness = 0, baseBlurRatio = 0.16) {
	const s = Math.max(0, Number(strength) || 0);
	if (s <= 0) {
		return { glow: null, glowBlurRatio: 0, glowPasses: 0, strokeRatio: 0 };
	}
	const sharp = Math.max(0, Math.min(1, Number(sharpness) || 0));
	return {
		glow: `rgba(0, 0, 0, ${Math.min(1, 0.85 * s)})`,
		// Schärfe blendet den weichen Schein aus (Unschärfe -> 0) ...
		glowBlurRatio: baseBlurRatio * Math.max(1, s) * (1 - sharp),
		// Pässe FRAKTIONAL (nicht gerundet) -> kein „Sprung" der Halo-Dichte bei x.5 (z. B. 1.4 -> 1.5).
		glowPasses: Math.max(1, s),
		// ... und blendet stattdessen eine scharfe Kontur (strokeText) ein -> Google-Maps-Look.
		strokeRatio: baseBlurRatio * Math.max(1, s) * sharp,
	};
}

// Stärke des Halos hinter den Regionen-/Landschafts-Titeln (.map-label). Default 0 = kein Halo (bisheriges
// Verhalten). Live über das ?halotune=1-Panel steuerbar (0..5).
let REGION_LABEL_HALO_STRENGTH = 1.5;
// Schärfe des Regionen-Titel-Halos (0 = weicher Schein, 1 = scharfe Kontur/Google-Maps-Look). Live über ?halotune=1.
let REGION_LABEL_HALO_SHARPNESS = 0.25;

// Pro Label-Typ Farbe/Schreibung/Sperrung EINMAL aus dem echten CSS lesen (Probe-Element) -> „Farben lassen".
function getMapLabelTypeStyle(labelType) {
	if (_mapLabelTypeStyleCache[labelType]) {
		return _mapLabelTypeStyleCache[labelType];
	}
	const probe = document.createElement("div");
	probe.className = `map-label map-label--${labelType}`;
	probe.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;";
	const span = document.createElement("span");
	span.textContent = "Mg";
	span.style.fontSize = "100px"; // bekannte Größe -> Sperrung als Verhältnis ableiten
	probe.appendChild(span);
	document.body.appendChild(probe);
	const computed = window.getComputedStyle(span);
	const style = {
		color: computed.color || "#f5f0d6",
		uppercase: computed.textTransform === "uppercase",
		fontFamily: computed.fontFamily || '"Faculty Glyphic", Georgia, serif',
		fontWeight: computed.fontWeight || "400",
		letterSpacingRatio: (parseFloat(computed.letterSpacing) || 0) / 100,
	};
	// „Berggipfel" deklariert per span::after ein kleines Dreieck. Das Canvas kennt keine Pseudo-
	// Elemente -> Vorhandensein + Farbe aus dem CSS lesen und unten ins Label-Bild zeichnen.
	const after = window.getComputedStyle(span, "::after");
	// Generisch aus dem CSS (zukunftssicher) ODER bekannter Typ als Fallback (falls ein Browser das
	// content:""-Pseudo-Element nicht über getComputedStyle herausgibt).
	const hasPeak = (parseFloat(after.borderBottomWidth) > 0 && after.content !== "none") || labelType === "berggipfel";
	style.peakMarker = hasPeak;
	style.peakColor = hasPeak ? after.borderBottomColor || style.color : null;
	document.body.removeChild(probe);
	_mapLabelTypeStyleCache[labelType] = style;
	return style;
}

// Text auf ein CSS-aufgelöstes Canvas zeichnen (weiches Upscaling auf HiDPI) -> {url, w, h}.
function renderMapLabelToImage(text, fontSizePx, typeStyle, opts) {
	const displayText = typeStyle.uppercase ? String(text).toUpperCase() : String(text);
	const letterSpacing = fontSizePx * (typeStyle.letterSpacingRatio || 0);
	// Optionaler Kursiv-Stil (z. B. Ruinen) + optionaler Schein (ersetzt den CSS text-shadow, den das
	// Canvas nicht erbt) -> Lesbarkeit bei Siedlungs-/Territoriums-Namen ohne harten "aufgeklebten" Look.
	const fontStylePrefix = typeStyle.fontStyle ? `${typeStyle.fontStyle} ` : "";
	const font = `${fontStylePrefix}${typeStyle.fontWeight} ${fontSizePx}px ${typeStyle.fontFamily}`;
	const glow = typeStyle.glow || null;
	const glowBlurRatio = typeStyle.glowBlurRatio != null ? typeStyle.glowBlurRatio : 0.16;
	const glowBlur = glow ? (typeStyle.glowBlur != null ? typeStyle.glowBlur : Math.max(0, fontSizePx * glowBlurRatio)) : 0;
	const glowPasses = glow ? Math.max(1, typeStyle.glowPasses || 1) : 0;
	// Scharfe Kontur (Stroke) als zweite, „knackige" Halo-Variante (Google-Maps-Look). strokeRatio = Anteil der
	// Schriftgröße -> Konturbreite. haloExtent = größter Radius (Schein ODER Kontur) für die Bild-Polsterung.
	const strokeWidth = glow && typeStyle.strokeRatio ? Math.max(0.5, fontSizePx * typeStyle.strokeRatio) : 0;
	const haloExtent = Math.max(glowBlur, strokeWidth);
	const vAnchor = (opts && opts.vAnchor) || "middle";
	// Gipfel-Dreieck (z. B. Berggipfel): Maße proportional zur Schriftgröße, unten ins Bild gezeichnet.
	const peakMarker = Boolean(typeStyle.peakMarker);
	const peakTriH = peakMarker ? fontSizePx * 0.32 : 0;
	const peakTriHalf = peakMarker ? fontSizePx * 0.22 : 0;
	const peakGap = peakMarker ? fontSizePx * 0.14 : 0;
	const peakPad = peakMarker ? Math.ceil(peakGap + peakTriH + 2) : 0;

	// HiDPI: scharfe Label auf Retina/Mobile (dpr 2–3); Cap 2x begrenzt den Speicher (viele gecachte Label-Bilder).
	const labelHiDpi = Math.min(window.devicePixelRatio || 1, 2);
	const cacheKey = `${displayText}|${font}|${typeStyle.color}|${glow || ""}|${glowBlur}|${glowPasses}|${strokeWidth}|${letterSpacing}|${vAnchor}|${labelHiDpi}|${typeStyle.peakMarker ? "peak" : ""}`;
	const cached = _mapLabelImageCache.get(cacheKey);
	if (cached) {
		// LRU: Treffer ans Ende der Insertion-Order verschieben -> Verdrängung trifft den ältesten UNGENUTZTEN Eintrag.
		_mapLabelImageCache.delete(cacheKey);
		_mapLabelImageCache.set(cacheKey, cached);
		return cached;
	}

	if (!_mapLabelMeasureCtx) {
		_mapLabelMeasureCtx = document.createElement("canvas").getContext("2d");
	}
	_mapLabelMeasureCtx.font = font;
	const chars = [...displayText];
	const widths = chars.map((character) => _mapLabelMeasureCtx.measureText(character).width);
	const textWidth = widths.reduce((sum, width) => sum + width + letterSpacing, 0) - letterSpacing;
	// Polsterung schließt den Schein-Radius ein, damit er nicht abgeschnitten wird.
	const padX = Math.ceil(fontSizePx * 0.5 + haloExtent);
	const w = Math.max(1, Math.ceil(textWidth) + padX * 2);

	// Vertikale Metrik. "middle" (Default, Karten-/Territoriums-Labels): em-Box zentriert (h/2).
	// "xheight": Grundlinie aus den echten Font-Metriken setzen und als Anker die MITTE zwischen
	// Grund- und Mittellinie (x-Höhen-Mitte) zurückgeben -> ruhigere optische Zentrierung neben dem
	// Orts-Marker, weil Versalien/Oberlängen nicht mehr nach oben ziehen.
	let h;
	let drawY;
	let baseline;
	let anchorY;
	if (vAnchor === "xheight") {
		const fullMetrics = _mapLabelMeasureCtx.measureText(displayText);
		const xMetrics = _mapLabelMeasureCtx.measureText("x");
		const ascent = fullMetrics.actualBoundingBoxAscent || fontSizePx * 0.8;
		const descent = fullMetrics.actualBoundingBoxDescent || fontSizePx * 0.2;
		const xHeight = xMetrics.actualBoundingBoxAscent || fontSizePx * 0.52;
		const topPad = Math.ceil(haloExtent) + 1;
		drawY = topPad + ascent;                 // alphabetische Grundlinie
		h = Math.max(1, Math.ceil(drawY + descent + haloExtent + 1));
		baseline = "alphabetic";
		anchorY = drawY - xHeight / 2;           // Mitte zwischen Grund- und Mittellinie
	} else {
		h = Math.max(1, Math.ceil(fontSizePx * 1.7 + haloExtent * 2));
		drawY = h / 2;
		baseline = "middle";
		anchorY = h / 2;
	}
	if (peakMarker) {
		// Symmetrisch oben+unten polstern -> der Text bleibt bildmittig (das <img> wird per -50%
		// positioniert), das Dreieck sitzt im unteren Polster unter dem Text.
		drawY += peakPad;
		anchorY += peakPad;
		h += peakPad * 2;
	}
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(w * labelHiDpi));  // HiDPI-Backing-Store; das <img> zeigt w×h (CSS-px) an
	canvas.height = Math.max(1, Math.round(h * labelHiDpi));
	const ctx = canvas.getContext("2d");
	ctx.scale(labelHiDpi, labelHiDpi); // ab hier in CSS-px zeichnen -> Ausgabe in Geräte-Pixeln (scharf auf HiDPI)
	ctx.font = font;
	ctx.textBaseline = baseline;
	ctx.textAlign = "left";
	ctx.globalAlpha = MAP_LABEL_CANVAS_ALPHA;
	ctx.fillStyle = typeStyle.color;
	const y = drawY;
	const drawGlyphs = (shiftX) => {
		let x = padX + shiftX;
		for (let i = 0; i < chars.length; i += 1) {
			ctx.fillText(chars[i], x, y);
			x += widths[i] + letterSpacing;
		}
	};
	if (glow && glowBlur > 0.01) {
		// Weicher Schatten-Halo: Glyphen um die Canvas-Breite nach links zeichnen (also aus dem Bild heraus) und den
		// Schatten um +w zurück versetzen -> NUR der (für Dichte ggf. mehrfach gezeichnete) Schein landet im Bild.
		// Die scharfe Schrift kommt danach GENAU EINMAL oben drauf -> die Glyph-Kanten stapeln sich nicht mehr
		// (das mehrfache Zeichnen der Füllung ließ die Labels vorher „fetter" wirken).
		ctx.save();
		ctx.shadowColor = glow;
		// shadowBlur/shadowOffset ignorieren die ctx.scale()-Transform (zählen in GERÄTE-Pixeln). Da die Glyphen
		// im skalierten Raum bei -w (= -w·dpr Geräte-Pixel) liegen, muss der Rück-Versatz ebenfalls mit labelHiDpi
		// multipliziert werden -> sonst „verzogene"/verschobene Schatten unter den Labels auf Retina/Mobile.
		ctx.shadowBlur = glowBlur * labelHiDpi;
		ctx.shadowOffsetX = w * labelHiDpi;
		// Ganze Pässe voll, der Rest als Teil-Pass über globalAlpha eingeblendet -> stufenloser Dichte-Verlauf.
		const fullPasses = Math.floor(glowPasses);
		const fractionalPass = glowPasses - fullPasses;
		for (let pass = 0; pass < fullPasses; pass += 1) {
			drawGlyphs(-w);
		}
		if (fractionalPass > 0.001) {
			ctx.globalAlpha = MAP_LABEL_CANVAS_ALPHA * fractionalPass;
			drawGlyphs(-w);
		}
		ctx.restore();
	}
	if (glow && strokeWidth > 0.01) {
		// Scharfer Kontur-Halo (wie Google-Maps-Labels): Glyph-Umriss in der Halo-Farbe unter die Füllung legen.
		ctx.save();
		ctx.lineJoin = "round";
		ctx.lineCap = "round";
		ctx.strokeStyle = glow;
		ctx.lineWidth = strokeWidth;
		let x = padX;
		for (let i = 0; i < chars.length; i += 1) {
			ctx.strokeText(chars[i], x, y);
			x += widths[i] + letterSpacing;
		}
		ctx.restore();
	}
	drawGlyphs(0);
	if (peakMarker) {
		// Kleines Dreieck (nach oben) unter dem Text — Ersatz fürs frühere span::after (DOM-Label).
		const cx = padX + textWidth / 2; // horizontal unter der Textmitte
		const apexY = drawY + fontSizePx * 0.5 + peakGap; // knapp unter der Textunterkante
		ctx.save();
		ctx.fillStyle = typeStyle.peakColor || typeStyle.color;
		ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
		ctx.shadowBlur = 1 * labelHiDpi; // Shadow zählt in Geräte-Pixeln (ignoriert ctx.scale) -> ×dpr
		ctx.shadowOffsetY = 1 * labelHiDpi;
		ctx.beginPath();
		ctx.moveTo(cx, apexY);
		ctx.lineTo(cx - peakTriHalf, apexY + peakTriH);
		ctx.lineTo(cx + peakTriHalf, apexY + peakTriH);
		ctx.closePath();
		ctx.fill();
		ctx.restore();
	}
	const result = { url: canvas.toDataURL(), w, h, padX, anchorY };
	if (_mapLabelImageCache.size >= _MAP_LABEL_IMAGE_CACHE_MAX) {
		_mapLabelImageCache.delete(_mapLabelImageCache.keys().next().value);
	}
	_mapLabelImageCache.set(cacheKey, result);
	return result;
}

function createLabelIcon(label) {
	const safeSize = getScaledLabelSize(label);
	const safeRotation = (((Number(label.rotation) || 0) % 360) + 360) % 360;
	const typeStyle = getMapLabelTypeStyle(label.labelType);
	// Optionaler Halo hinter den Regionen-/Landschafts-Titeln (live über ?halotune=1; Default 0 = aus).
	const halo = getLabelHaloParams(REGION_LABEL_HALO_STRENGTH, REGION_LABEL_HALO_SHARPNESS);
	const labelStyle = halo.glow
		? { ...typeStyle, glow: halo.glow, glowBlurRatio: halo.glowBlurRatio, glowPasses: halo.glowPasses, strokeRatio: halo.strokeRatio }
		: typeStyle;
	const image = renderMapLabelToImage(label.text, safeSize, labelStyle);
	return L.divIcon({
		className: `map-label map-label--${label.labelType}${labelHasWikiRegion(label) ? " map-label--has-wiki" : ""}`,
		html: `<img src="${image.url}" width="${image.w}" height="${image.h}" style="display:block; transform: translate(calc(-50% + var(--label-offset-x, 0px)), calc(-50% + var(--label-offset-y, 0px))) rotate(${safeRotation}deg);" alt="${escapeHtml(label.text)}">`,
		iconSize: [0, 0],
		iconAnchor: [0, 0],
	});
}

function getScaledLabelSize(label) {
	const baseSize = Math.max(10, Math.min(56, Number(label.size) || 18));
	const visualZoomLevel = getVisualZoomLevel(map.getZoom());
	const zoomRatio = Math.max(0, Math.min(1, visualZoomLevel / VISUAL_MAX_ZOOM_LEVEL));
	return Math.round(baseSize * (0.5 + zoomRatio * 0.5));
}

function labelHasWikiRegion(label) {
	return Boolean(label && label.wikiRegion && label.wikiRegion.wiki_key);
}

// Infobox einer Wiki-Landschaft (Ansichtsmodus, Klick auf das Label). Bild nur bei nachweislich
// freier Lizenz (gemeinfrei); sonst ausgeblendet (konservativ wie bei den Herrschaftsgebieten).
function labelWikiInfoboxMarkup(label, options = {}) {
	// Gleiche Struktur/Klassen wie die Herrschaftsgebiete-Infobox (.region-info-box) -> erbt deren
	// Styles/Abstaende. Bild nur bei nachweislich freier Lizenz (gemeinfrei), sonst ausgeblendet.
	// headless: ohne eigenen Kopf/Titel (im Edit-Popup zeigt der Popup-Kopf Name + Typ schon).
	const headless = Boolean(options.headless);
	const wiki = label.wikiRegion || {};
	const name = wiki.name || label.text || "";
	const licenseStatus = String(wiki.image_license_status || "").toLowerCase();
	const imageIsFree = licenseStatus === "public_domain" || licenseStatus === "public-domain" || licenseStatus === "gemeinfrei";
	const coatMarkup = wiki.image_url && imageIsFree
		? `<img class="region-info-box__coat" src="${escapeHtml(wiki.image_url)}" alt="" loading="lazy" decoding="async">`
		: "";
	const hasCoatClass = coatMarkup ? " has-coat" : "";

	const art = String(wiki.art || "").trim();
	const row = (dtLabel, value) => {
		if (!value || String(value).trim() === "") {
			return "";
		}
		return `<div class="region-info-box__row"><dt>${escapeHtml(dtLabel)}</dt><dd>${escapeHtml(value)}</dd></div>`;
	};

	let rows = "";
	rows += row(tr("infobox.location", "Lage"), wiki.region_parent);
	rows += row(tr("infobox.state", "Staat"), wiki.affiliation_staat);
	rows += row(tr("infobox.inhabitants", "Einwohner"), wiki.einwohner);
	rows += row(tr("infobox.language", "Sprache"), wiki.sprache);
	rows += row(tr("infobox.vegetation", "Vegetation"), wiki.vegetation);
	rows += row(tr("infobox.description", "Beschreibung"), typeof settlementFirstSentence === "function" ? settlementFirstSentence(wiki.description) : String(wiki.description || "").trim());
	// Multi-source system: ONE source line covers the wiki credit line that used to render
	// unconditionally here -- rendered synchronously from the map-features payload
	// (renderFeatureSourceLine in js/ui/popups.js resolves this element's approved sources).
	const sourceMarkup = typeof renderFeatureSourceLine === "function"
		? renderFeatureSourceLine("region", label.publicId, wiki.wiki_url || "", "region-info-box__link")
		: "";

	const header = headless ? "" : (
		`<div class="region-info-box__header${hasCoatClass}">` +
		coatMarkup +
		'<div class="region-info-box__title-group">' +
		`<strong class="region-info-box__title">${escapeHtml(name)}</strong>` +
		(art ? `<span class="region-info-box__subtitle">${escapeHtml(art)}</span>` : "") +
		"</div></div>"
	);
	return (
		`<div class="region-info-box${headless ? " region-info-box--settlement" : ""}">` +
		header +
		`<dl class="region-info-box__data">${rows}</dl>` +
		sourceMarkup +
		"</div>"
	);
}

// View-mode region-label popup HTML: name + type + wiki infobox + "Link teilen" (no edit buttons).
// Shared by the map-click label handler AND the spotlight/deep-link focus (focusSpotlightLabel), so a
// landscape/region label shows identical content whether opened by click or by a ?region= deep-link.
// wikiParam "region" matches the landscape/region deep-link parameter (js/app/wiki-deeplink.js).
function buildRegionLabelViewPopupHtml(label) {
	const art = (label.wikiRegion && label.wikiRegion.art) ? label.wikiRegion.art : "Region";
	return locationPopupMarkup({
		name: label.text || (label.wikiRegion && label.wikiRegion.name) || "Region",
		locationTypeLabel: art,
		showHeaderIcon: false,
		compact: true,
		showType: true,
		showDescription: false,
		showWikiLink: false,
		actionsMarkup: labelWikiInfoboxMarkup(label, { headless: true })
			+ locationPopupActionsMarkup([sharePlaceActionButtonMarkup(label.publicId, { wikiUrl: (label.wikiRegion && label.wikiRegion.wiki_url) || "", wikiParam: "region" })].filter(Boolean)),
	});
}

function createLabelMarkerEntry(label) {
	const marker = L.marker(label.coordinates, {
		icon: createLabelIcon(label),
		draggable: false,
		interactive: IS_EDIT_MODE || labelHasWikiRegion(label),
		keyboard: false,
		pane: "labelsPane",
	});
	const entry = { label, marker };
	if (IS_EDIT_MODE) {
		refreshLabelMarkerPopup(entry);
		marker.on("dragend", () => {
			void saveLabelPosition(entry);
			setLabelMoveActive(entry, false);
		});
	} else if (labelHasWikiRegion(label)) {
		// Ansichtsmodus: dasselbe Popup wie der Edit-Mode, nur OHNE die Bearbeiten-Buttons -- via den
		// gemeinsamen Builder, den auch der Deep-Link/Spotlight-Fokus (focusSpotlightLabel) nutzt.
		const regionLabelPopupHtml = buildRegionLabelViewPopupHtml(label);
		// Infopanel (now the default): route landscape/Wiki-region label info into the right panel
		// instead of a floating popup -- same as the other feature types. This label-click path had no
		// panel guard, so regions kept opening as a floating box. Without panel mode the bound popup stays.
		if (typeof IS_INFOPANEL_MODE !== "undefined" && IS_INFOPANEL_MODE && typeof window.avesmapsShowInfopanel === "function") {
			marker.on("click", () => {
				try { map.panTo(label.coordinates); } catch (error) { /* noop */ }
				window.avesmapsShowInfopanel(regionLabelPopupHtml, label.text || (label.wikiRegion && label.wikiRegion.name) || "");
			});
		} else {
			marker.bindPopup(regionLabelPopupHtml, { className: "settlement-popup", minWidth: 320, maxWidth: 400, autoPan: true });
		}
	}
	syncLabelMarkerVisibility(entry);
	return entry;
}

function refreshLabelMarkerPopup(entry) {
	if (!IS_EDIT_MODE) {
		return;
	}

	const options = labelHasWikiRegion(entry.label) ? { className: "settlement-popup", minWidth: 320, maxWidth: 400 } : undefined;
	entry.marker.bindPopup(labelPopupMarkup(entry), options);
}

function findLabelEntryByPublicId(publicId) {
	return labelMarkers.find((entry) => entry.label.publicId === publicId) || null;
}

function setLabelMoveActive(entry, isActive) {
	if (!entry?.marker?.dragging) {
		return;
	}

	if (isActive) {
		void acquireFeatureSoftLock(entry.label.publicId);
		entry.marker.dragging.enable();
		entry.marker.closePopup();
		showFeedbackToast(`${entry.label.text}: Label verschieben, Loslassen speichert.`, "info");
		return;
	}

	entry.marker.dragging.disable();
	void releaseFeatureSoftLock(entry.label.publicId);
}

function shouldShowLabelMarker(entry, zoomLevel = map.getZoom(), renderBounds = getMapRenderBounds()) {
	const minZoom = Number(entry.label.minZoom) || 0;
	const maxZoom = Number.isFinite(Number(entry.label.maxZoom)) ? Number(entry.label.maxZoom) : 7;
	// Sichtbarkeits-Band gegen die ECHTE Zoomstufe pruefen (Karte geht bis 7), NICHT gegen den auf
	// VISUAL_MAX_ZOOM_LEVEL=5 geklemmten Visual-Zoom -- sonst sind Zoom 5/6/7 fuer Labels ununterscheidbar
	// und "Sichtbar bis Zoom" hat oben keinen Effekt (5 <= maxZoom ist fuer maxZoom>=5 immer wahr). Die
	// Label-GROESSE skaliert weiter ueber den Visual-Zoom (s. getScaledLabelSize).
	const bandZoom = Math.max(0, Math.round(Number(zoomLevel)));
	return getSelectedMapLayerMode() === "deregraphic"
		&& bandZoom >= minZoom
		&& bandZoom <= maxZoom
		&& isLatLngInRenderBounds(entry.marker.getLatLng(), renderBounds);
}

function syncLabelMarkerVisibility(entry, zoomLevel = map.getZoom(), renderBounds = getMapRenderBounds()) {
	const shouldShow = shouldShowLabelMarker(entry, zoomLevel, renderBounds);
	const isVisible = map.hasLayer(entry.marker);
	if (shouldShow && !isVisible) {
		entry.marker.addTo(map);
		return;
	}

	if (!shouldShow && isVisible) {
		map.removeLayer(entry.marker);
	}
}

function syncLabelVisibility() {
	const zoomLevel = map.getZoom();
	const renderBounds = getMapRenderBounds();
	labelMarkers.forEach((entry) => syncLabelMarkerVisibility(entry, zoomLevel, renderBounds));
	scheduleLabelCollisionResolution();
}

function syncLabelIcons() {
	const zoomLevel = map.getZoom();
	const renderBounds = getMapRenderBounds();
	labelMarkers.forEach((entry) => {
		if (shouldShowLabelMarker(entry, zoomLevel, renderBounds) || map.hasLayer(entry.marker)) {
			entry.marker.setIcon(createLabelIcon(entry.label));
		}
		syncLabelMarkerVisibility(entry, zoomLevel, renderBounds);
	});
	scheduleLabelCollisionResolution();
}

function prepareLabelData(data) {
	labelMarkers.forEach((entry) => map.removeLayer(entry.marker));
	labelData = data.features.filter((feature) => feature.properties?.feature_type === "label").map(normalizeLabelFeature);
	labelMarkers = labelData.map(createLabelMarkerEntry);
	syncLabelVisibility();
}

function addCreatedLabelFeature(feature) {
	const label = normalizeLabelFeature(feature);
	const entry = createLabelMarkerEntry(label);
	labelData.push(label);
	labelMarkers.push(entry);
	refreshLabelMarkerPopup(entry);
	return entry;
}

function applyLabelFeatureResponse(entry, feature) {
	const label = normalizeLabelFeature(feature);
	Object.assign(entry.label, label);
	entry.marker.setLatLng(label.coordinates);
	entry.marker.setIcon(createLabelIcon(label));
	refreshLabelMarkerPopup(entry);
	syncLabelMarkerVisibility(entry);
}

function applyLiveLabelFeature(feature) {
	const label = normalizeLabelFeature(feature);
	const entry = labelMarkers.find((labelEntry) => labelEntry.label.publicId === label.publicId);
	if (entry) {
		applyLabelFeatureResponse(entry, feature);
		return;
	}

	const newEntry = createLabelMarkerEntry(label);
	labelData.push(label);
	labelMarkers.push(newEntry);
	syncLabelMarkerVisibility(newEntry);
}

async function saveLabelPosition(entry) {
	const latlng = entry.marker.getLatLng();
	try {
		const result = await submitMapFeatureEdit({
			action: "move_label",
			public_id: entry.label.publicId,
			lat: latlng.lat,
			lng: latlng.lng,
		});
		applyLabelFeatureResponse(entry, result.feature);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		showFeedbackToast("Labelposition gespeichert.", "success");
	} catch (error) {
		console.error("Label konnte nicht verschoben werden:", error);
		showFeedbackToast(error.message || "Label konnte nicht verschoben werden.", "warning");
	}
}

async function deleteLabelEntry(entry, { closeDialog = false } = {}) {
	if (!entry || !window.confirm(`${entry.label.text} wirklich löschen?`)) {
		return;
	}

	try {
		const result = await submitMapFeatureEdit({
			action: "delete_feature",
			public_id: entry.label.publicId,
		});
		map.removeLayer(entry.marker);
		labelData = labelData.filter((label) => label !== entry.label);
		labelMarkers = labelMarkers.filter((labelEntry) => labelEntry !== entry);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		if (closeDialog) {
			setLabelEditDialogOpen(false, { resetForm: true });
		}
		showFeedbackToast("Label gelöscht.", "success");
	} catch (error) {
		console.error("Label konnte nicht gelöscht werden:", error);
		setLabelEditStatus(error.message || "Label konnte nicht gelöscht werden.", "error");
	}
}

async function deleteActiveLabel() {
	await deleteLabelEntry(labelEditEntry, { closeDialog: true });
}

async function duplicateLabelEntry(entry) {
	if (!entry) {
		showFeedbackToast("Label konnte nicht gefunden werden.", "warning");
		return;
	}

	const sourceLatLng = entry.marker.getLatLng();
	const duplicateLatLng = map.layerPointToLatLng(map.latLngToLayerPoint(sourceLatLng).add([24, 24]));
	try {
		const result = await submitMapFeatureEdit({
			action: "create_label",
			text: entry.label.text,
			feature_subtype: entry.label.labelType || "region",
			size: Number(entry.label.size) || 18,
			rotation: Number(entry.label.rotation) || 0,
			min_zoom: Number(entry.label.minZoom) || 0,
			max_zoom: Number(entry.label.maxZoom) || 5,
			priority: Number(entry.label.priority) || 3,
			lat: duplicateLatLng.lat,
			lng: duplicateLatLng.lng,
		});
		const duplicatedLabelEntry = addCreatedLabelFeature(result.feature);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		entry.marker.closePopup();
		pendingLabelMoveAfterEditEntry = duplicatedLabelEntry;
		openLabelEditDialog({ labelEntry: duplicatedLabelEntry });
		showFeedbackToast("Label dupliziert. Bearbeiten, danach verschieben.", "success");
	} catch (error) {
		console.error("Label konnte nicht dupliziert werden:", error);
		showFeedbackToast(error.message || "Label konnte nicht dupliziert werden.", "warning");
	}
}

function createLabelAt(latlng) {
	setSelectedMapLayerMode("deregraphic");
	openLabelEditDialog({ latlng: L.latLng(latlng) });
}

// Webfont (Faculty Glyphic) kann beim ersten Label-Render noch nicht geladen sein -> nach dem Laden die
// Label-Icons (Canvas-Renderer) neu bauen, sonst zeigt das erste Bild den Fallback-Font.
try {
	if (document.fonts && document.fonts.ready) {
		document.fonts.ready.then(() => {
			try {
				if (typeof syncLabelIcons === "function" && typeof labelMarkers !== "undefined" && Array.isArray(labelMarkers) && labelMarkers.length) {
					syncLabelIcons();
				}
			} catch (error) {
				/* noop */
			}
		});
	}
} catch (error) {
	/* noop */
}
