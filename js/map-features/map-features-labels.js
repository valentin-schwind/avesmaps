/* 🪤 04.09.2026 Stempel-Heilung nach einem abgebrochenen Deploy -- die Begruendung steht in css/components/fenster.css. */
// Mirror of avesmapsReadOptionalPeakHeight (api/_internal/map/features.php): the SERVER owns the
// rule, this only has to agree with it. Returns a finite number >= 0, or null for "not recorded".
// Numeric strings are accepted because a payload that has round-tripped through a form field can
// arrive as one; anything else -- 0-length string, boolean, array, NaN, negative -- is not a height.
// Die Grundlinie eines Kurvenlabels aus dem Payload, gedreht in Leaflet-Ordnung.
// 🔴 Eine einzige unbrauchbare Koordinate nimmt die KURVE, nicht das LABEL -- der Name muss auch
// dann noch erscheinen, notfalls gerade. Dieselbe Regel wie serverseitig in
// avesmapsCurveBaselinesFromCache: pro Objekt aussteigen, nie den ganzen Bestand.
function readLabelCurveLine(properties) {
	const roh = properties && properties.curve_label_line;
	if (!Array.isArray(roh) || roh.length < 2) {
		return null;
	}
	const punkte = [];
	for (const paar of roh) {
		if (!Array.isArray(paar) || paar.length < 2) {
			return null;
		}
		const x = Number(paar[0]);
		const y = Number(paar[1]);
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			return null;
		}
		punkte.push([y, x]);
	}
	return punkte;
}

// 1 … 3. Alles andere faellt auf 1 zurueck. Der Server klemmt schon; hier ein zweites Mal, weil ein
// gecachter alter Payload jede Zahl tragen kann und der Deploy nie loescht (AGENTS.md §10).
function readLabelCurveMax(properties) {
	const roh = Number(properties && properties.curve_label_max);
	if (!Number.isFinite(roh)) {
		return 1;
	}
	return Math.min(3, Math.max(1, Math.round(roh)));
}

function readLabelHeightSchritt(properties) {
	const raw = properties?.height_schritt;
	if (raw === null || raw === undefined || raw === "" || typeof raw === "boolean") {
		return null;
	}
	const height = Number(raw);

	return Number.isFinite(height) && height >= 0 ? height : null;
}

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
		// 🔴 Fehlt der Schlüssel, heisst das SICHTBAR. Die 543 Labels von vor dem 2026-07-27 tragen ihn
		// nicht, und `Boolean(undefined)` hätte sie alle auf einen Schlag von der Karte genommen.
		showName: (properties.show_name ?? feature.show_name) !== false,
		revision: Number(properties.revision ?? feature.revision) || null,
		wikiRegion: properties.wiki_region && typeof properties.wiki_region === "object" ? properties.wiki_region : null,
		// 🔴 Die FELDHERKUNFT (`{text|feature_subtype: "manual"|"wiki"}`). Sie steht seit dem
		// 18.08.2026 in der Ablage und reist im Kartenpayload ohnehin mit (`properties` geht dort
		// unverändert heraus, nur `svg_id` fällt) -- gefehlt hat nur diese Zeile. Ohne sie wüsste
		// weder die braune Beschriftung noch das Vorhäkeln der Sync-Vorschau, wer den Wert gesetzt
		// hat. ⚠️ `null` heisst „nicht bekannt", nie „vom Wiki".
		// 💣 `!Array.isArray` ist noetig, nicht kosmetisch: `typeof [] === "object"`, ein Array reiste
		// also durch. Der Leser dahinter faengt es zwar noch einmal ab -- aber zwei Riegel fuer
		// dieselbe Sache sind einer zu viel, und der zweite hier war beim Bauen tatsaechlich falsch.
		fieldOrigins: properties.field_origins && typeof properties.field_origins === "object"
			&& !Array.isArray(properties.field_origins)
			? properties.field_origins
			: null,
		// 🔴 EINE Fläche, VIELE Labels (Owner 2026-07-28): der Finsterkamm will im Norden und im Süden
		// beschriftet werden, mit eigener Drehung und Lage je Label. Deshalb zeigt das LABEL auf seine
		// Region -- `ecosystem_region.label_public_id` kann nur eines halten und bezeichnet weiterhin
		// das PRIMÄRE, also das, welches der Regionsdialog verwaltet.
		ecosystemRegionPublicId: String(properties.ecosystem_region_public_id || ""),
		// Zu WELCHER Ebene gehört die Fläche an diesem Label? Serverseitig aufgelöst
		// (api/_internal/app/ecosystem-label-link.php). Ohne dieses Feld liesse sich beim Umschalten auf
		// „Vegetation" der Wald nicht vom Gebirge trennen -- die Ebene steht an der REGION, nicht am
		// Label, und die Regionen kennt der Besucher nicht (ihre Liste ist ein Editor-Endpunkt).
		ecosystemRegionKind: String(properties.ecosystem_region_kind || ""),
		// Klimazonen der Region, ANTEILIG: [[schlüssel, anteil], ...], größter Anteil zuerst. Eine
		// Fläche kann über zwei Bänder laufen -- anders als ein Ort, der genau in einem liegt.
		// Serverseitig aus dem gespeicherten Verschnitt („Zugehörigkeit rechnen"), nicht neu gerechnet.
		climateZones: Array.isArray(properties.climate_zones) ? properties.climate_zones : null,
		// 🔴 DIE KURVE, auf der dieser Name steht -- gerechnet vom SERVER (Entwurf §7.1), weil die
		// Flaechengeometrie beim normalen Besucher gar nicht im Browser liegt (1,6 MB Vegetation,
		// 1,4 MB Topographie, nachgeladen erst beim Betreten der Landschaftsebene).
		// 💣 Der Payload fuehrt [x, y], Leaflet will [lat, lng] = [y, x]. Hier wird getauscht, und
		// zwar EINMAL -- alles dahinter rechnet in Leaflet-Ordnung.
		// ⚠️ `null` heisst „diese Flaeche hat die Kurvenbeschriftung aus" und ist der Normalfall;
		// eine leere Liste waere dasselbe in unklar.
		curveLine: readLabelCurveLine(properties),
		// Hoechstens so viele Namen auf dieser Kurve (Entwurf §4.2: ein HOECHSTwert, kein Sollwert).
		curveMax: readLabelCurveMax(properties),
		otherSource: readFeatureOtherSource(properties),
		// A berggipfel carries its own height, in Schritt (V8). 🔴 `null` means NOT RECORDED and is
		// not the same as 0 -- the height field falls back to a placeholder for the former and takes
		// the latter literally. Neither `Number(undefined)` (NaN) nor `Number(null)` (0) may be
		// allowed to stand in for "nobody has measured this peak yet".
		heightSchritt: readLabelHeightSchritt(properties),
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
// Den Typ-Zwischenspeicher leeren.
//
// 💣 OHNE IHN WIRKT EINE GELADENE ODER GEAENDERTE TAFEL ERST NACH EINEM NEULADEN -- und das sieht
// aus wie „Speichern tut nichts". Der Speicher haelt je Labelart Farbe, Schreibung und Sperrung
// fest; die Sonde laeuft nur beim ersten Mal.
// 🪤 Der BILD-Zwischenspeicher (_mapLabelImageCache) braucht KEINEN eigenen Leerer: sein Schluessel
// enthaelt `typeStyle.color`, ein neuer Ton ergibt also von selbst einen neuen Schluessel. Wer hier
// einen zweiten Leerer ergaenzt, raeumt jedes Labelbild der Karte fuer nichts weg.
function avesmapsLeereLabelTypStil() {
	Object.keys(_mapLabelTypeStyleCache).forEach((k) => { delete _mapLabelTypeStyleCache[k]; });
}

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
		// 🔴 Der CSS-Ton ist die VORGABE, die Darstellungstafel entscheidet nur, ob eine
		// Uebersteuerung ihn schlaegt (Entwurf §8). Eine Farbe je ART, nicht je Zoomstufe
		// (Owner 23.08.2026: „die farben bleiben gleich").
		color: typeof avesmapsEcosystemDisplayFarbe === "function"
			? avesmapsEcosystemDisplayFarbe(labelType, computed.color || "#f5f0d6")
			: (computed.color || "#f5f0d6"),
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
	const labelHiDpi = avesmapsCanvasDpr(2);   // eigener 2er-Deckel (Speicher), Telefon-Regel geteilt
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
	// 💣 HIER, NICHT IN renderMapLabelToImage. Gezaehlt wird die RASTERUNG EINER BESCHRIFTUNG, und
	// das ist genau ein Aufruf hier -- eine Canvas plus ein synchrones toDataURL(). Der Bildspeicher
	// darunter faengt Wiederholungen ab; wer dort zaehlte, bekaeme „Treffer im Speicher" und nicht
	// „wie viele Beschriftungen hat der Start angefasst". Siehe js/map-features/label-bedarf.js.
	avesmapsLabelGerastertZaehlen();
	const safeSize = getScaledLabelSize(label);
	// 🔴 OHNE KURVENBESCHRIFTUNG IST DER NAME EINE GANZ NORMALE GERADE -- nicht die alte
	// Handdrehung (Entwurf §4.3). Der gespeicherte Winkel bleibt in der Datenbank stehen (Entwurf
	// §8, er ist der einzige Rueckweg eines Rueckbaus), wird aber nicht mehr gezeichnet.
	//
	// 💣 UND ZWAR NUR FUER LABELS AN EINER LANDSCHAFTSFLAECHE. Die uebrigen -- Meere, Kontinente,
	// Inseln, Seen, Berggipfel -- behalten ihr heutiges Verhalten (Entwurf §0): sie koennen gar
	// keine Kurve bekommen, weil ohne Flaeche keine Mittelachse existiert, und ihnen die Drehung
	// zu nehmen waere eine Aenderung an 265 Namen, die dieses Vorhaben nie versprochen hat.
	// ⚠️ Die Weiche ist der REGIONSZEIGER, nicht der Labeltyp: ein Berggipfel entsteht als Punkt
	// OHNE Flaeche („Hoehenpunkt setzen" legt ihn frei an, siehe review-labels.js), traegt also
	// keinen Zeiger und faellt von selbst heraus.
	// 🔧 Offen: ein Label an einer Region, die (noch) keine Flaeche hat, wird hier ebenfalls
	// geradegerichtet. Bei ihm ist das Bedienelement verriegelt, es kann die Kurve also nicht
	// selbst einschalten -- gemessen ist dieser Fall nicht.
	const safeRotation = label.ecosystemRegionPublicId
		? 0
		: (((Number(label.rotation) || 0) % 360) + 360) % 360;
	const typeStyle = getMapLabelTypeStyle(label.labelType);
	// Optionaler Halo hinter den Regionen-/Landschafts-Titeln (live über ?halotune=1; Default 0 = aus).
	const halo = getLabelHaloParams(REGION_LABEL_HALO_STRENGTH, REGION_LABEL_HALO_SHARPNESS);
	// Prüfhaken „Keine Wiki-Zuweisung" (Owner 01.09.2026). Live sind das 361 der 977 Beschriftungen.
	//
	// 💣 DER HALO, NICHT EINE CSS-KLASSE. Ein Kartenlabel ist ein <img>, das renderMapLabelToImage auf
	// ein Canvas malt -- der Schein ist ins BILD gebrannt und erbt kein `text-shadow` aus dem
	// Stylesheet. Eine Klasse am divIcon (wie `map-label--has-wiki` daneben) könnte hier nur den
	// Mauszeiger ändern, nie die Farbe.
	// 🪤 Und der Schriftton bleibt, wo er ist: rot eingefärbte NAMEN wären auf der Karte nicht mehr als
	// Landschaftsnamen lesbar, und die Labelfarbe ist zugleich die Auskunft über die Labelart. Der
	// Schein dahinter trägt den Befund -- dasselbe Verhältnis wie beim Weg (Saum statt Mitte).
	// 🪤 KEIN Cache-Leeren nötig: der Schlüssel von _mapLabelImageCache enthält `glow` (siehe
	// renderMapLabelToImage), ein anderer Schein ergibt also von selbst einen anderen Schlüssel.
	// ⚠️ DREI WERTE STEIGEN, UND DER DRITTE IST DER TRAGENDE. `glowPasses` verdichtet den Schein
	// (der schwarze Vorgabe-Schein ist auf hellen Kacheln kräftig, ein einzelner roter Durchgang
	// verschwände daneben), `glowBlurRatio` macht ihn breiter -- aber erst die scharfe KONTUR
	// (`strokeRatio`, von 0.06 auf 0.13) trägt ihn auch auf den HELLEN Labelarten.
	// 🔴 Am Bild entschieden, 01.09.2026: fünf Labelarten nebeneinander, je fünf Stärken. Mit dem
	// weichen Schein allein las sich der Befund bei `region` (#ffffff) und `gebirge` (#e2ddd2)
	// deutlich, bei `wald` (#bfeec8) und `see` (#b9e7ff) kaum -- ein Prüfhaken, der bei zwei von
	// fünf Arten nur ahnen lässt, ist keiner. Die Kontur liest sich bei allen fünf.
	// ⚠️ NICHT höher: bei 0.16 und fünf Durchgängen frisst der Rand die Buchstaben, und der Name ist
	// nicht mehr zu lesen -- ein markierter Name, den man nicht mehr entziffert, kostet mehr, als er
	// meldet.
	const wikiMarke = typeof avesmapsWikiZuweisungMarkeLabel === "function"
		? avesmapsWikiZuweisungMarkeLabel(label)
		: "";
	const labelStyle = wikiMarke
		? {
			...typeStyle,
			glow: avesmapsWikiZuweisungFarbe(wikiMarke),
			glowBlurRatio: Math.max(halo.glowBlurRatio, 0.22),
			glowPasses: Math.max(halo.glowPasses, 3),
			strokeRatio: Math.max(halo.strokeRatio, 0.13),
		}
		: (halo.glow
			? { ...typeStyle, glow: halo.glow, glowBlurRatio: halo.glowBlurRatio, glowPasses: halo.glowPasses, strokeRatio: halo.strokeRatio }
			: typeStyle);
	const image = renderMapLabelToImage(label.text, safeSize, labelStyle);
	return L.divIcon({
		// Das Blassmachen fremder Labels in der Landschaftsebene gehört ins Icon, weil dieses Icon bei
		// jedem Zoomwechsel neu gebaut wird und dabei das DOM-Element ersetzt (siehe
		// map-features-ecosystem-layer-switch.js). Ohne die Landschaftsebene ist der Zusatz leer.
		// `map-label--has-eco-region`: dieses Label hängt an einer Landschaftsfläche und hebt sie beim
		// Anklicken hervor. Die Klasse ist nicht Optik, sondern das Erkennungsmerkmal für den Zuhörer,
		// der die Hervorhebung wieder löscht (ECOSYSTEM_HIGHLIGHT_SOURCES in
		// map-features-ecosystem-rendering.js) -- ohne sie müsste er JEDES Label verschonen, und ein Klick
		// auf einen Ortsnamen liesse die alte Fläche stehen.
		// `map-label--markiert` / `map-label--doppelt`: der Kasten um eine Beschriftung. ZWEI Werkzeuge
		// zeichnen ihn -- der Scheinwerfer „Freie Labels markieren" (karminrot) und der Pruefhaken
		// „Doppelte Beschriftungen" (violett) --, und welcher gewinnt, entscheidet NICHT diese Zeile,
		// sondern der Trichter `avesmapsLabelMarkeKlasse` (label-markierungen.js). Zwei Werkzeuge mal
		// drei Leser waeren sonst sechs Stellen mit derselben Frage.
		// 💣 HIER ALS KLASSE, anders als der rote Schein des Pruefhakens „Keine
		// Wiki-Zuweisung" zwei Bloecke weiter oben: jener steckt IM BILD (er faerbt die Schrift und
		// waere aus dem Stylesheet nicht erreichbar), dieser liegt AUSSERHALB des Bildes und ist
		// deshalb genau das, was eine Klasse leisten kann. Sein Vorteil: er geht nicht in den
		// Bildcache ein (_mapLabelImageCache), das Umschalten kostet also kein einziges Neurastern.
		// ⚠️ Und deshalb steht er NICHT in `labelStyle` -- wer ihn dorthin zoege, machte aus einem
		// Klassenwechsel 1017 neue Canvas-Bilder.
		className: `map-label map-label--${label.labelType}${labelHasWikiRegion(label) ? " map-label--has-wiki" : ""}${label.ecosystemRegionPublicId ? " map-label--has-eco-region" : ""}${typeof ecosystemLabelMutedClass === "function" ? ecosystemLabelMutedClass(label) : ""}${typeof avesmapsLabelMarkeKlasse === "function" ? avesmapsLabelMarkeKlasse(label) : ""}`,
		html: `<img src="${image.url}" width="${image.w}" height="${image.h}" style="display:block; transform: translate(calc(-50% + var(--label-offset-x, 0px)), calc(-50% + var(--label-offset-y, 0px))) rotate(${safeRotation}deg);" alt="${escapeHtml(label.text)}">`,
		iconSize: [0, 0],
		iconAnchor: [0, 0],
	});
}

// Wachstum je Zoomstufe OBERHALB des Visual-Zoom-Deckels. Eine Konstante und kein Literal in der
// Formel: sie ist der Wert, an dem der Owner drehen wird, wenn ihm „etwas groesser" zu wenig ist.
const LABEL_SIZE_DEEP_ZOOM_STEP = 0.08;

function getScaledLabelSize(label) {
	// 🔴 DIE TAFEL RAET, SIE GILT NICHT (Owner 24.08.2026, nach einem Tag umgedreht). Kurz stand
	// hier das Gegenteil -- die Tafel setzte die Groesse und `label.size` wurde nicht gelesen.
	// Der Owner wollte den Editoren den Regler NICHT wegnehmen, sondern ihnen den Wert
	// VORSCHLAGEN: „ich wollte den editoren diese nicht von den labels wegnehmen, sondern den
	// slider beibehalten und denen den default wert vorschlagen".
	//
	// ⭐ Damit gilt für die Groesse dieselbe Regel wie fuer das Zoomband -- eine Regel statt
	// zweier, und `avesmapsLabelImBand` nebenan liest sich jetzt wie diese Funktion.
	// ⚠️ Live tragen 938 von 938 Beschriftungen eine eigene Groesse (12-50 pt, gemessen
	// 24.08.2026). Die Tafel wirkt also heute nirgends auf der Karte -- sie ist der Vorschlag
	// fuer neue Beschriftungen und die Marke unter dem Regler. Genau wie beim Zoomband.
	const eigen = Number(label.size);
	const hatEigene = label.size !== null && label.size !== undefined && Number.isFinite(eigen);
	if (!hatEigene && typeof avesmapsEcosystemDisplayGroesse === "function") {
		return avesmapsEcosystemDisplayGroesse(label.labelType, map.getZoom());
	}
	// 💣 `Number(null)` ist 0, nicht NaN -- ohne die ausdrueckliche Pruefung oben fiele ein Label
	// ohne Groesse auf die Untergrenze statt auf die Tafel. Dieselbe Falle wie beim Band.
	const baseSize = Math.max(10, Math.min(56, hatEigene ? eigen : 18));
	const visualZoomLevel = getVisualZoomLevel(map.getZoom());
	const zoomRatio = Math.max(0, Math.min(1, visualZoomLevel / VISUAL_MAX_ZOOM_LEVEL));
	const ueberVisual = Math.max(0, Math.min(2, map.getZoom() - VISUAL_MAX_ZOOM_LEVEL));
	return Math.round(baseSize * (0.5 + zoomRatio * 0.5) * (1 + ueberVisual * LABEL_SIZE_DEEP_ZOOM_STEP));
}


function labelHasWikiRegion(label) {
	return Boolean(label && label.wikiRegion && label.wikiRegion.wiki_key);
}

// Erste Komponente einer mehrwertigen Wiki-Art. „Art=Tal|Grube" sind für MediaWiki ZWEI Parameter
// (das benannte Art plus ein ungenutzter Positionsparameter) -- das Wiki zeigt nur „Tal". Der
// Staging-Parser normalisiert das seit 2026-07-27 selbst (avesmapsWikiRegionParsePage), aber die
// wiki_region am Label ist eine KOPIE aus dem Staging: bereits gespeicherte Kopien tragen den
// rohen Wert weiter, bis sie neu synchronisiert werden. Ohne diese Lesehilfe stünde bei 12 Labels
// „Tal|Tal" als Untertitel in der Infobox. Komma bleibt Inhalt („Mischregion, Wald").
function labelWikiArtPrimary(art) {
	return String(art || "").split(/\s*\|\s*/)[0].trim();
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
		? `<img class="region-info-box__coat" src="${escapeHtml(avesmapsCoatSrc(wiki.image_url))}" alt="" loading="lazy" decoding="async">`
		: "";
	const hasCoatClass = coatMarkup ? " has-coat" : "";

	const art = labelWikiArtPrimary(wiki.art);
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
	// Waren / Fauna / Flora als eigene Zeilen -- Landschaftsregionen sind die Ebene, auf
	// der das Wiki diese Angaben tatsächlich pflegt. Der Container kommt leer und füllt
	// sich nach dem Abruf; ohne Treffer bleibt er leer und erzeugt keine Zeile.
	// Der Ortsschlüssel geht als TITEL an den Server, der sluggt (Umlaut-Falle, siehe
	// api/app/lore.php) -- wiki_key wird mitgegeben, falls er im Payload steht.
	if (typeof buildLoreMarkup === "function") {
		// Vorkommen-Regeln haengen an der REGION, nicht an einer einzelnen Flaeche/einem Label --
		// ecosystemRegionOfLabel liest beide Richtungen der 1:N-Beziehung (Label->eigene Region ODER
		// Region->primaeres Label) und liefert deren Objekt. Ohne Fläche bleibt es null: dann bleibt
		// area leer und buildLoreMarkup verhaelt sich exakt wie vor dieser Aenderung.
		const ecosystemRegion = typeof ecosystemRegionOfLabel === "function" ? ecosystemRegionOfLabel(label) : null;
		rows += buildLoreMarkup({
			key: wiki.wiki_key || "",
			titles: typeof avesmapsLoreTitleFromUrl === "function" ? avesmapsLoreTitleFromUrl(wiki.wiki_url || "") : "",
			name: name,
			// 💣 area traegt die public_id der REGION (ecosystem_region.public_id), nicht die einer
			// Flaeche -- ecosystemRegionOfLabel liefert genau die richtige. Nicht "korrigieren".
			area: ecosystemRegion ? String(ecosystemRegion.public_id || "") : "",
		});
	}
	// „Klimazone" DIREKT unter Flora (Owner 2026-08-03) -- dieselbe Zeile, derselbe Bauer wie am Ort
	// und am Weg. Sie steht synchron im Payload; ohne Wiki-Zeilen darüber trägt sie die Box allein.
	if (typeof avesmapsClimateRowForShares === "function") {
		rows += avesmapsClimateRowForShares(label.climateZones);
	}
	// Multi-source system: ONE source line covers the wiki credit line that used to render
	// unconditionally here -- rendered synchronously from the map-features payload
	// (renderFeatureSourceLine in js/ui/popups.js resolves this element's approved sources).
	// 🔴 Schritt 5 des Quellen-Umbaus (03.09.2026): die Flaeche traegt die Quellen, die Beschriftung zeigt sie -- eine
	// gebundene Beschriftung liest `ecosystem:<region>`, eine freie `region:<label>`. EINE Weiche
	// (js/map-features/label-quellen-schluessel.js), dieselbe fuer das Kanon-Etikett darunter.
	const quellenSchluessel = regionLabelQuellenSchluessel(label);
	const sourceMarkup = typeof renderFeatureSourceLine === "function"
		? renderFeatureSourceLine(quellenSchluessel.type, quellenSchluessel.id, wiki.wiki_url || "", "region-info-box__link")
		: "";

	// Ohne einen einzigen Wert entfaellt die Box GANZ (Spec §5.2). Seit alle Labels anklickbar sind, laeuft
	// hier auch eines ohne Wiki-Zuweisung durch, und das ergaebe sonst ein leeres <dl> mit Rahmen und
	// Abstaenden -- das liest sich nicht als "dazu wissen wir nichts", sondern als kaputt. Name und Typ
	// stehen ohnehin im Kopf darueber; was bleibt, sind Kartensammlung und Abenteuer, und die haengen
	// nicht an dieser Box. Ein Panel ohne Wiki-Zeilen ist ein gueltiger Zustand.
	//
	// sourceMarkup zaehlt mit: die Quellen eines Labels haengen an seiner public_id, nicht an der
	// Wiki-Zuweisung -- eine Region ohne Wiki, aber mit erfasster Quelle behaelt ihre Zeile.
	if (!rows && !sourceMarkup) {
		return "";
	}

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
// Unter welchem Schluessel liegen die Quellen dieser Beschriftung -- die EINE Weiche
// (js/map-features/label-quellen-schluessel.js), hier fuer BEIDE Popup-Bauer, Datenbox und Ansicht.
// 💣 Am 03.09.2026 stand die Rechnung nur in der Datenbox, und die Ansicht griff auf den Namen zu:
// ReferenceError beim Vorbauen der Popups, und damit brach das Laden der oeffentlichen Karte ab --
// zwei Stunden lang, waehrend der Bearbeiten-Modus (eigener Popup-Bauer) und alle Quelltext-Tests
// gruen waren. Seither wird die Ansicht im Test AUSGEFUEHRT (label-quellen-schluessel.test.js).
function regionLabelQuellenSchluessel(label) {
	return typeof avesmapsLabelQuellenSchluessel === "function"
		? avesmapsLabelQuellenSchluessel(label)
		: { type: "region", id: label.publicId };
}

function buildRegionLabelViewPopupHtml(label) {
	// Die ART dieser Beschriftung, in DIESER Reihenfolge:
	//
	// 🔴 Die Wiki-Art bleibt VORNE, und das ist kein Zufall: sie ist feiner als unser Vokabular --
	// „Bucht" statt „Meer", „Halbinsel" statt „Region", „Wasserfall" statt „Fluss", „Ozean",
	// „Meerenge", „Mischregion". Live gemessen am 28.08.2026 weicht sie bei 264 der 627
	// zugewiesenen Beschriftungen von unserer eigenen ab; sie zu verdraengen waere dort ein
	// Informationsverlust.
	//
	// 💣 DIE EIGENE ART FUELLT DIE LUECKE -- vorher stand hier die feste Zeichenkette "Region", und
	// der eigene feature_subtype wurde NIE gefragt. 341 der 983 Beschriftungen sagten deshalb
	// „Region", obwohl sie Wald, See, Berggipfel oder Vulkan sind (Owner 28.08.2026: „Ceälan ist
	// ein freies Label (vulkan), wird aber in der infobox als region gezeigt"). Das Wort kommt aus
	// dem geteilten Vokabular (js/ui/label-arten.js), nicht aus einer fuenften Abschrift hier.
	//
	// ⚠️ "Region" bleibt der letzte Rueckfall: eine unbekannte Art ohne Wiki-Zuweisung soll etwas
	// sagen -- ein leerer Untertitel liest sich wie ein Fehler.
	const wikiArt = labelWikiArtPrimary(label.wikiRegion && label.wikiRegion.art);
	const eigeneArt = avesmapsLabelArtName(label.labelType);
	// 🔴 …AUSSER JEMAND HAT DIE EIGENE ART AUSDRUECKLICH GESETZT (Owner 31.08.2026: „der altenforst ist
	// als urwald eingetragen (ueberschreibt Wald), aber es steht immer noch wald dran"). Bis dahin gewann
	// das Wiki BEDINGUNGSLOS, womit der Wiki-Override (AGENTS.md §11) an dieser einen Stelle wirkungslos
	// war: der Editor sah im Bearbeiten-Popup „Urwald" (labelPopupSubtitle liest nur die eigene Art), der
	// Karten-Schwebezettel ebenfalls -- nur der Besucher sah „Wald". Dieselbe Frage, drei Erzeuger, einer
	// scherte aus.
	//
	// 💣 GEFRAGT WIRD DIE HERKUNFT DES SUBTYPS, nicht ob ueberhaupt ein Eintrag da ist. `field_origins`
	// traegt BEIDE Wiki-Felder des Labels (`text` und `feature_subtype`, avesmapsUpdateLabelFeature);
	// wer nur auf das Vorhandensein prueft, laesst ein von Hand UMBENANNTES Label seine Wiki-Art
	// verlieren -- und das traefe ausgerechnet die gepflegtesten Beschriftungen. `manual` genau, denn
	// ein vom Sync gesetztes Feld traegt `wiki` und ist keine eigene Wahl.
	//
	// 💣 UND `region` ZAEHLT NICHT ALS AUSSAGE. Es ist beim Label der NEUTRALE Subtyp („keine Art", so
	// woertlich in map-features-ecosystem-label-writeback.js) und wird auch dann als `manual` gestempelt,
	// wenn niemand eine Art waehlen wollte. Ohne diese Ausnahme verloeren live fuenf Beschriftungen ihre
	// einzige Auskunft: Weiden und Regengebirge das „Gebirge", Galottas Insel die „Insel", Ongalo das
	// „Flusstal", Wilder Sueden die „Mischregion" (gemessen 31.08.2026 am Livebestand).
	//
	// ⚠️ Der Bestand bleibt unberuehrt: 442 der 615 Beschriftungen mit Wiki-Art tragen an ihrem Subtyp
	// gar keine Herkunft, fuer sie gilt die Regel darueber unveraendert weiter. Sichtbar aendern sich 26.
	const eigeneGewaehlt = eigeneArt !== ""
		&& String(label.labelType || "") !== "region"
		&& String((label.fieldOrigins || {}).feature_subtype || "") === "manual";
	const art = eigeneGewaehlt ? eigeneArt : (wikiArt || eigeneArt || "Region");
	// 💣 ZWEI WERTE, und ihre Trennung ist tragend: `art` ist der SCHLUESSEL (deutsch, wird in
	// INFO_HEADER_IMAGE_BY_ART nachgeschlagen), `artText` das ANGEZEIGTE Wort. Unter ?lang=en gaebe
	// tr() „Volcano" zurueck -- als Schluessel benutzt faende das nichts, und jede Beschriftung
	// bekaeme wieder das generische region.webp. Eine Wiki-Art hat keine Uebersetzung und geht roh
	// durch.
	// ⚠️ Und er folgt DERSELBEN Wahl: gewinnt die eigene Art, geht sie durch tr() -- gewinnt das Wiki,
	// geht seine Art roh durch (sie hat keine Uebersetzung). Zwei verschiedene Woerter fuer dieselbe
	// Aussage waeren hier lautlos.
	const artText = eigeneGewaehlt || !wikiArt
		? tr("spotlight.labelType." + label.labelType, art)
		: wikiArt;
	const labelName = label.text || (label.wikiRegion && label.wikiRegion.name) || "Region";
	// Owner: 16:9 header image (by landscape art) + title overlay instead of the headless title.
	// Einmal gebaut, an zwei Stellen gereicht -- siehe map-features-location-marker-entry.js.
	const quellenSchluessel = regionLabelQuellenSchluessel(label);
	const labelKanon = typeof renderFeatureKanonBadge === "function"
		? renderFeatureKanonBadge(quellenSchluessel.type, quellenSchluessel.id) : "";
	const headerImg = typeof infoHeaderImageMarkup === "function"
		? infoHeaderImageMarkup(regionHeaderImageBasename(art), labelName, artText, "", [], "", labelKanon)
		: "";
	return locationPopupMarkup({
		name: labelName,
		// ⚠️ Derselbe Text wie im Bildkopf. Er wird nur gezeichnet, wenn es KEIN Kopfbild gibt
		// (locationPopupMarkup ersetzt den Icon-Kopf durch das Bild) -- also auf einer Seite ohne
		// popups.js. Zwei verschiedene Woerter fuer dieselbe Aussage waeren hier lautlos.
		locationTypeLabel: artText,
		headerImageMarkup: headerImg,
		// Derselbe Schluessel wie die Quellenzeile der Datenbox (avesmapsLabelQuellenSchluessel).
		kanonMarkup: labelKanon,
		showHeaderIcon: false,
		compact: true,
		showType: true,
		showDescription: false,
		showWikiLink: false,
		// "Link teilen" (Owner) direkt unter dem Kopf, die Landschafts-Infobox (Lage/Staat/Beschreibung +
		// Quelle) darunter -- gleiche Anordnung wie Siedlung/Territorium/Weg.
		actionsMarkup: locationPopupActionsMarkup([sharePlaceActionButtonMarkup(label.publicId, { wikiUrl: (label.wikiRegion && label.wikiRegion.wiki_url) || "", wikiParam: "region" }), (function () { var s = typeof buildSuggestChangeButtonSpec === "function" ? buildSuggestChangeButtonSpec({ entityType: "region", entityId: label.publicId, name: labelName, reportType: "region", lat: (label.coordinates && label.coordinates[0]), lng: (label.coordinates && label.coordinates[1]), label: tr("popup.suggestChange", "Änderungen vorschlagen") }) : null; return s ? popupActionButtonMarkup(s) : ""; })()].filter(Boolean))
			// 💣 DER EDITOR-KASTEN STEHT ZWISCHEN KACHELZEILE UND WIKI-INFOBOX, nicht am Ende. Das Blatt
			// traegt dafuer seit jeher eine eigene Regel („.location-popup__actions:has(+ .location-popup__
			// editor-band)", css/features/infopanel.css) -- die Ortschaften nutzen sie im Panel laengst.
			// Unten waere er hinter „Quelle:" gelandet und damit hinter der Owner-Regel „Quellen immer
			// unten" (§11), die dort das letzte Wort haben soll.
			// 🔴 Der typeof-Riegel ist der Hausstil der Nachbarzeile und hier die SICHERE Richtung: faellt
			// js/ui/popups.js einmal aus, fehlt dem Editor sein Kasten -- ein nackter Aufruf risse mit einem
			// ReferenceError den ganzen Bauer mit, und dann sieht JEDER Besucher keine Beschriftungen mehr
			// (die Regression vom 03.09.2026, AGENTS.md §11).
			+ (typeof labelEditorBandMarkup === "function" ? labelEditorBandMarkup(label) : "")
			+ labelWikiInfoboxMarkup(label, { headless: true }),
	}) + (typeof buildRegionCityMapsMarkup === "function" ? buildRegionCityMapsMarkup(label) : "")
		+ (typeof buildRegionGameLiteratureMarkup === "function" ? buildRegionGameLiteratureMarkup(label) : "");
}

// Ein leeres Icon fuer eine Beschriftung, die noch nicht gerastert wurde. Wortgleich zum
// Platzhalter der Siedlungsnamen (createLocationNameLabelEntry) -- nichts zu sehen, keine Ausdehnung.
//
// 💣 ER DARF NIE AUF DIE KARTE. Die Kollisionsaufloesung misst RECHTECKE (getCollisionEntries in
// map-features-label-collisions.js filtert auf `map.hasLayer`), und ein Platzhalter mit den Massen 0
// verschoebe die Ortsnamen um ihn herum ins Leere. Deshalb rastert `syncLabelMarkerVisibility` das
// echte Bild VOR dem `addTo(map)` -- ein Marker auf der Karte traegt ausnahmslos sein echtes Icon.
function avesmapsLabelPlatzhalterIcon() {
	return L.divIcon({ className: "map-label", html: "", iconSize: [0, 0], iconAnchor: [0, 0] });
}

// Rastert die Beschriftung und merkt sich die Zoomstufe, mit der es geschah.
//
// ⭐ Der Merker ist die Antwort auf eine Frage, die es ohne die Bedarfs-Rasterung nicht gab: eine
// Beschriftung, die beim Zoomwechsel ausserhalb des Ausschnitts lag, hat `syncLabelIcons` nie
// angefasst -- kommt sie spaeter durch ein Verschieben herein, traegt sie das Bild der ALTEN Stufe
// und damit die falsche Groesse. Mit der Bedarfs-Rasterung (Vorgabe) wird sie beim Sichtbarwerden neu gerastert.
function avesmapsLabelIconRastern(entry, zoomLevel) {
	entry.marker.setIcon(createLabelIcon(entry.label));
	entry._bedarfIconZoom = zoomLevel;
}

function createLabelMarkerEntry(label) {
	const marker = L.marker(label.coordinates, {
		// 🔴 PLATZHALTER STATT BILD -- Vorgabe seit 14.09.2026; `?labelbedarf=0` rastert wieder sofort.
		// Gerastert wird dann erst, wenn die Beschriftung wirklich sichtbar wird. Begruendung, Messung
		// und die Reihenfolge-Falle stehen in js/map-features/label-bedarf.js.
		icon: avesmapsLabelBedarfAktiv() ? avesmapsLabelPlatzhalterIcon() : createLabelIcon(label),
		draggable: false,
		// JEDES Label ist anklickbar, nicht nur eins mit Wiki-Zuweisung (Spec §5.2): ohne sie war es im
		// Lesemodus vollstaendig inert -- kein Popup, kein Panel, nicht einmal ein Trefferziel; der Klick
		// fiel durch auf das, was darunter lag. Ein Panel ohne Wiki-Zeilen ist ein gueltiger Zustand (Name,
		// Typ, Kartensammlung, Abenteuer), kein Fehler.
		//
		// Perf (der Vorbehalt in §5.2): unkritisch, weil syncLabelMarkerVisibility jedes Label ausserhalb
		// von Zoomband/Viewport aus der KARTE nimmt -- im DOM stehen ohnehin nur die sichtbaren. Es kommen
		// also nur die wiki-losen Labels des aktuellen Ausschnitts als Hit-Ziele dazu, und die Marker gab es
		// schon; interactive schaltet nur pointer-events und die Leaflet-Registrierung.
		interactive: true,
		keyboard: false,
		pane: "labelsPane",
	});
	const entry = { label, marker };
	// 🔴 Ein Klick auf ein Label hebt die verbundene Fläche hervor (Owner 2026-08-04: „ein Klick auf die
	// Labels sollte immer auch die entsprechende Fläche markieren, in allen Landschaftsmodi -- ein Klick
	// auf Aventurien soll auch die aventurische Fläche highlighten").
	//
	// 🪤 NUR DORT, WO NICHT BEARBEITET WIRD. Im Editor beantwortet derselbe Klick schon etwas anderes und
	// Stärkeres: er WÄHLT die Fläche aus (weisse Kontur, Griffe, Ziel der Werkzeuge, siehe unten). Beides
	// übereinanderzulegen hiesse, eine Fläche mit zwei Konturen zu versehen, die Verschiedenes bedeuten.
	//
	// Die Verbindung kommt aus `properties.ecosystem_region_public_id` -- serverseitig aus BEIDEN
	// gespeicherten Richtungen aufgelöst (api/_internal/app/ecosystem-label-link.php). Ein Label ohne
	// Fläche trägt sie nicht und bekommt hier folglich nichts.
	const labelRegionPublicId = String(label.ecosystemRegionPublicId || "");
	//
	// 💣 HIER STAND DIE REGEL EIN ZWEITES MAL AUSGESCHRIEBEN (`!canOperateEcosystemLayers()`), und der
	// Renderer nannte sie daneben ausdrücklich „wortgleich". Am 23.08.2026 wurde sie beim Original
	// erweitert -- „Alle" ist seither ein Lese-Blick --, und die Abschrift hier wäre stumm zurückgeblieben:
	// ein Klick auf die FLÄCHE hätte hervorgehoben, ein Klick auf ihr LABEL nicht. Deshalb wird jetzt die
	// eine Definition gefragt (isEcosystemReaderClick, map-features-ecosystem-rendering.js).
	// ⚠️ Damit auch deren Fehlerrichtung: fehlt die Frage, geschieht nichts. Vorher hob sie in dem Fall
	// hervor -- die Abschrift war schon in ihrer Notbremse nicht wortgleich.
	const hebtFlaecheHervor = labelRegionPublicId
		&& typeof setHighlightedEcosystemRegion === "function"
		&& typeof isEcosystemReaderClick === "function" && isEcosystemReaderClick();
	if (hebtFlaecheHervor) {
		marker.on("click", () => setHighlightedEcosystemRegion(labelRegionPublicId));
	}
	if (IS_EDIT_MODE) {
		refreshLabelMarkerPopup(entry);
		// 🔴 Ein Klick auf das Label einer verbundenen Flaeche waehlt AUCH die Flaeche aus (Owner
		// 2026-07-28). Beschriftung und Flaeche sind fuer den Editor ein Ding; ueber das Label an die
		// Region zu kommen war bisher ein Umweg ueber die Karte, obwohl das Label genau auf ihr sitzt.
		// Nur im Landschaftsmodus -- ausserhalb gibt es keine aktive Flaeche, die etwas werden koennte.
		marker.on("click", () => {
			void selectEcosystemAreaOfLabel(label);
		});
		marker.on("dragend", () => {
