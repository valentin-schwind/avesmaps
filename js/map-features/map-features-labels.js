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
		// 🔴 DER DRITTE ZUSTAND („Kein Wiki-Artikel vorhanden"), seit 16.08.2026 auch am Label. Er ist
		// NICHT aus `wikiRegion` ableitbar: „keine Zuweisung" heisst „noch niemand hat nachgesehen",
		// der Merker heisst „jemand HAT nachgesehen und es gibt keinen". Genau diese negative Aussage
		// nimmt das Label aus der Beobachtungsliste des Konfliktzentrums
		// (api/_internal/conflicts/rules.php liest denselben Schlüssel serverseitig).
		// ⚠️ Nur ein ausdrückliches `true` setzt ihn -- als `false` wird er nirgends abgelegt.
		keinArtikel: properties.wiki_no_article === true,
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
	const labelStyle = halo.glow
		? { ...typeStyle, glow: halo.glow, glowBlurRatio: halo.glowBlurRatio, glowPasses: halo.glowPasses, strokeRatio: halo.strokeRatio }
		: typeStyle;
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
		className: `map-label map-label--${label.labelType}${labelHasWikiRegion(label) ? " map-label--has-wiki" : ""}${label.ecosystemRegionPublicId ? " map-label--has-eco-region" : ""}${typeof ecosystemLabelMutedClass === "function" ? ecosystemLabelMutedClass(label) : ""}`,
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
	const sourceMarkup = typeof renderFeatureSourceLine === "function"
		? renderFeatureSourceLine("region", label.publicId, wiki.wiki_url || "", "region-info-box__link")
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
	const art = wikiArt || avesmapsLabelArtName(label.labelType) || "Region";
	// 💣 ZWEI WERTE, und ihre Trennung ist tragend: `art` ist der SCHLUESSEL (deutsch, wird in
	// INFO_HEADER_IMAGE_BY_ART nachgeschlagen), `artText` das ANGEZEIGTE Wort. Unter ?lang=en gaebe
	// tr() „Volcano" zurueck -- als Schluessel benutzt faende das nichts, und jede Beschriftung
	// bekaeme wieder das generische region.webp. Eine Wiki-Art hat keine Uebersetzung und geht roh
	// durch.
	const artText = wikiArt || tr("spotlight.labelType." + label.labelType, art);
	const labelName = label.text || (label.wikiRegion && label.wikiRegion.name) || "Region";
	// Owner: 16:9 header image (by landscape art) + title overlay instead of the headless title.
	const headerImg = typeof infoHeaderImageMarkup === "function"
		? infoHeaderImageMarkup(regionHeaderImageBasename(art), labelName, artText)
		: "";
	return locationPopupMarkup({
		name: labelName,
		// ⚠️ Derselbe Text wie im Bildkopf. Er wird nur gezeichnet, wenn es KEIN Kopfbild gibt
		// (locationPopupMarkup ersetzt den Icon-Kopf durch das Bild) -- also auf einer Seite ohne
		// popups.js. Zwei verschiedene Woerter fuer dieselbe Aussage waeren hier lautlos.
		locationTypeLabel: artText,
		headerImageMarkup: headerImg,
		showHeaderIcon: false,
		compact: true,
		showType: true,
		showDescription: false,
		showWikiLink: false,
		// "Link teilen" (Owner) direkt unter dem Kopf, die Landschafts-Infobox (Lage/Staat/Beschreibung +
		// Quelle) darunter -- gleiche Anordnung wie Siedlung/Territorium/Weg.
		actionsMarkup: locationPopupActionsMarkup([sharePlaceActionButtonMarkup(label.publicId, { wikiUrl: (label.wikiRegion && label.wikiRegion.wiki_url) || "", wikiParam: "region" }), (function () { var s = typeof buildSuggestChangeButtonSpec === "function" ? buildSuggestChangeButtonSpec({ entityType: "region", entityId: label.publicId, name: labelName, reportType: "region", lat: (label.coordinates && label.coordinates[0]), lng: (label.coordinates && label.coordinates[1]), label: tr("popup.suggestChange", "Änderungen vorschlagen") }) : null; return s ? popupActionButtonMarkup(s) : ""; })()].filter(Boolean))
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
// und damit die falsche Groesse. Mit `?labelbedarf=1` wird sie beim Sichtbarwerden neu gerastert.
function avesmapsLabelIconRastern(entry, zoomLevel) {
	entry.marker.setIcon(createLabelIcon(entry.label));
	entry._bedarfIconZoom = zoomLevel;
}

function createLabelMarkerEntry(label) {
	const marker = L.marker(label.coordinates, {
		// 🔴 PLATZHALTER STATT BILD -- nur mit `?labelbedarf=1`, Vorgabe ist das Rastern wie bisher.
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
			// 🪤 V8: einen Gipfel, der in der Topographie-Ebene DAUERHAFT ziehbar ist, hier nicht
			// stillzulegen. setLabelMoveActive(false) beendet den einmaligen Verschiebemodus -- auf ihn
			// angewandt liesse es sich genau einmal verschieben, danach klebte er fest.
			const isPeak = typeof isEcosystemPeakActive === "function" && isEcosystemPeakActive(label.publicId);
			// 💣 Die Invalidierung gehört ANS ENDE der Speicherkette, nicht daneben. saveLabelPosition ist
			// asynchron und schreibt die neue Lage erst in `label.coordinates`, wenn die Antwort da ist
			// (applyLabelFeatureResponse). Daneben gerufen läse der Neuaufbau des Höhenfelds noch die ALTE
			// Position -- der Gipfel wäre verschoben, sein Berg bliebe stehen.
			const saved = saveLabelPosition(entry);
			if (isPeak) {
				Promise.resolve(saved).then(() => {
					if (typeof invalidateEcosystemHeightForPeak === "function") {
						invalidateEcosystemHeightForPeak(label);
					}
				});
				return;
			}
			setLabelMoveActive(entry, false);
		});
		// Infopanel (default): in edit mode the floating box carries the EDIT actions, but the right Info
		// panel stayed EMPTY for regions -- so the "Info" edge-tab dead-ended (hasContent=false) and could
		// not be reached. Settlements already fill the panel in edit mode (their DOM-marker popupopen routes
		// to avesmapsShowInfopanel, gated only on IS_INFOPANEL_MODE). Mirror that here: when the label's
		// editor popup opens, ALSO fill the panel with the read-only region info. The view-mode branch below
		// is unreachable in edit mode, which is why this wiring was missing.
		// Ohne labelHasWikiRegion-Gate (Spec §5.2), aus demselben Grund wie im Lesemodus darunter: sonst
		// bliebe der Info-Reiter fuer ein Label ohne Wiki-Zuweisung leer und damit unerreichbar -- genau
		// die Sackgasse, gegen die diese Verdrahtung ueberhaupt entstand.
		if (typeof IS_INFOPANEL_MODE !== "undefined" && IS_INFOPANEL_MODE
			&& typeof window.avesmapsShowInfopanel === "function"
			&& typeof buildRegionLabelViewPopupHtml === "function") {
			// 💣 EIN BAUER, kein fertiger Text: nur so bekommt das Panel einen Anker und laesst sich
			// auffrischen (avesmapsRefreshInfopanel). Ohne ihn erschien eine Quelle, die der Editor
			// gerade im Kasten „Quellen" hinzugefuegt hat, erst nach einem erneuten Klick auf das Label.
			marker.on("popupopen", () => {
				window.avesmapsShowInfopanel(
					() => buildRegionLabelViewPopupHtml(label),
					label.text || (label.wikiRegion && label.wikiRegion.name) || ""
				);
			});
		}
	} else {
		// Ansichtsmodus: dasselbe Popup wie der Edit-Mode, nur OHNE die Bearbeiten-Buttons -- via den
		// gemeinsamen Builder, den auch der Deep-Link/Spotlight-Fokus (focusSpotlightLabel) nutzt.
		//
		// Ohne labelHasWikiRegion-Gate (Spec §5.2): ein Label ohne Wiki-Zuweisung bekommt dasselbe Panel,
		// nur ohne die Wiki-Zeilen -- Name, Typ, Kartensammlung und Abenteuer stehen auch ohne Wiki zur
		// Verfuegung, und genau die waren bisher unerreichbar.
		// 🪤 MIT `?labelbedarf=1` ALS FUNKTION, sonst wie bisher als fertiger Text. Dieses Markup ist
		// der zweite Startposten neben dem Bild: es entstand fuer JEDE Beschriftung sofort, obwohl es
		// erst beim Anklicken gebraucht wird -- und der Bearbeiten-Zweig darueber bindet seines
		// laengst als Funktion (refreshLabelMarkerPopup). Leaflet ruft sie bei jedem Oeffnen, es zaehlt
		// also der Stand von JETZT statt der vom Startaugenblick.
		let regionLabelPopupHtml;
		if (avesmapsLabelBedarfAktiv()) {
			regionLabelPopupHtml = () => buildRegionLabelViewPopupHtml(label);
		} else {
			avesmapsLabelPopupZaehlen();
			regionLabelPopupHtml = buildRegionLabelViewPopupHtml(label);
		}
		// Infopanel (now the default): route landscape/Wiki-region label info into the right panel
		// instead of a floating popup -- same as the other feature types. This label-click path had no
		// panel guard, so regions kept opening as a floating box. Without panel mode the bound popup stays.
		//
		// 💣 DAS PANEL BEKOMMT EINEN BAUER, NIE DEN VORGEBAUTEN TEXT. Zwei Gruende, und der zweite ist
		// der Grund dieser Aenderung: (1) ein Bauer IST der Anker, an dem avesmapsRefreshInfopanel
		// haengt -- ohne ihn gibt der Refresh sofort auf, und eine gerade hinzugefuegte Quelle erschien
		// erst nach einem erneuten Klick; (2) `regionLabelPopupHtml` ist ohne `?labelbedarf=1` ein beim
		// SEITENSTART gebauter Text -- als Anker eingesetzt zeichnete jeder Refresh treu den Stand vom
		// Startaugenblick nach und saehe von „nichts hat sich geaendert" nicht zu unterscheiden aus.
		// ⚠️ Damit bedient der vorgebaute Text nur noch den Rueckfall-Zweig unten (Karte ohne Panel).
		// Ihn im Panel-Modus gar nicht erst zu bauen waere der naechste Schritt -- er gehoert aber zum
		// offenen Versuch `?labelbedarf=1` und wird hier bewusst nicht mitentschieden.
		if (typeof IS_INFOPANEL_MODE !== "undefined" && IS_INFOPANEL_MODE && typeof window.avesmapsShowInfopanel === "function") {
			marker.on("click", () => {
				try { map.panTo(label.coordinates); } catch (error) { /* noop */ }
				window.avesmapsShowInfopanel(
					() => buildRegionLabelViewPopupHtml(label),
					label.text || (label.wikiRegion && label.wikiRegion.name) || ""
				);
			});
		} else {
			marker.bindPopup(regionLabelPopupHtml, { className: "settlement-popup", minWidth: 320, maxWidth: 400, autoPan: true });
		}
	}
	syncLabelMarkerVisibility(entry);
	// V8: ein Gipfel, der in die schon aktive Topographie-Ebene hineingeboren wird (frisch angelegt oder
	// beim Nachladen), ist sofort ziehbar. syncEcosystemLabelMuting läuft nur beim EbenenWECHSEL --
	// ohne diese Zeile bliebe genau der neue Punkt der einzige unbewegliche.
	//
	// 💣 NACH syncLabelMarkerVisibility, nicht davor: `marker.dragging` entsteht bei Leaflet erst in
	// `onAdd`. Davor ist es `undefined`, und `marker.dragging?.enable()` wäre eine stille Nulloperation --
	// ohne Fehler, ohne Wirkung, und der Gipfel klebte fest, bis jemand die Ebene wechselt.
	if (IS_EDIT_MODE && typeof isEcosystemPeakActive === "function" && isEcosystemPeakActive(label.publicId)) {
		marker.dragging?.enable();
	}
	return entry;
}

function refreshLabelMarkerPopup(entry) {
	if (!IS_EDIT_MODE) {
		return;
	}

	// TWO classes, and every label needs BOTH. "floating-location-popup" gates the Kachel/tile action-button
	// CSS (location-popups-markers.css); "settlement-popup" is the only rule that releases the 260px base cap
	// (.location-popup max-width) to 400px (region-sync.css). A label WITHOUT a wiki region -- a continent,
	// say -- used to get the tile class alone: the tiles then had ~240px to sit in, could not fit four across,
	// and wrapped into the vertical list. That looked like a layout bug but was a missing width anchor.
	// labelActionsMarkup renders regardless of hasWiki, so the box is the same box either way.
	// 🪤 Als FUNKTION gebunden, nicht als fertiger Text. Der Kopf nennt jetzt die Zahl der verbundenen
	// Flaechen und Labels, und die stehen beim Binden noch gar nicht fest -- die Regionslisten kommen
	// spaeter. Leaflet ruft die Funktion bei jedem Oeffnen, also zaehlt der Stand von JETZT.
	entry.marker.bindPopup(() => labelPopupMarkup(entry), { className: "settlement-popup floating-location-popup", minWidth: 320, maxWidth: 400 });
	// 🔴 UND AUSSERHALB DES LANDSCHAFTSMODUS DIE LISTEN NACHZIEHEN (Owner 24.08.2026). Die Zahl der
	// Flaechen steht in den REGIONSLISTEN, und die werden nur im Landschaftsmodus geholt -- in der
	// Standardansicht kannte der Kopf die Zugehoerigkeit, aber nicht die Zahl. Der Zeile fehlte sie
	// deshalb (labelPopupSubtitle sagt seit heute nichts, statt „0 Flaechen" zu behaupten), und hier
	// wird sie beschafft.
	//
	// ⚠️ NUR FUER EDITOREN, und `canOperateEcosystemLayers` fragt genau das -- IS_EDIT_MODE UND das
	// Recht. Es fragt NICHT nach der Ansicht, und das ist hier der Punkt: geladen werden darf immer,
	// geholt wurde bisher nur im Landschaftsmodus.
	//
	// 💣 KEINE Schleife: `loadEcosystemRegions` kehrt sofort um, sobald die Ebene im Zwischenspeicher
	// liegt, und neu gezeichnet wird nur, wenn die Zahl VORHER fehlte und JETZT da ist. Ohne diese
	// zweite Bedingung setzte jedes Oeffnen den Inhalt neu -- und der Klick auf eine Kachel ginge
	// zwischen Neubau und Zeigerdruck verloren.
	entry.marker.on("popupopen", () => {
		avesmapsLabelMenueFlaechenzahlNachziehen(entry, () => {
			if (entry.marker.isPopupOpen()) {
				entry.marker.setPopupContent(labelPopupMarkup(entry));
			}
		});
	});
}

// Die Flaechenzahl nachziehen und den Inhalt neu setzen lassen.
//
// 🔴 EIGENE FUNKTION, weil es ZWEI Wege ins Kachelmenue gibt: den Marker (gerade Labels) und das
// freistehende Popup am gemalten Namen (Kurvenlabels, deren Marker der Kurvenriegel abmeldet). Beide
// brauchen dasselbe Nachladen -- zweimal geschrieben waere es die Stelle, an der einer der beiden es
// irgendwann nicht mehr tut.
//
// @param entry      der Labeleintrag
// @param neuSetzen  wie der Aufrufer seinen Inhalt ersetzt (Marker-Popup oder freistehendes)
function avesmapsLabelMenueFlaechenzahlNachziehen(entry, neuSetzen) {
	if (typeof canOperateEcosystemLayers !== "function" || !canOperateEcosystemLayers()) {
		return;
	}
	if (typeof ensureEcosystemRegionsLoadedForLabelFilter !== "function" || typeof neuSetzen !== "function") {
		return;
	}
	const vorher = typeof ecosystemRegionOfLabel === "function" ? ecosystemRegionOfLabel(entry?.label) : null;
	if (!vorher || vorher.area_count !== undefined) {
		return;                                      // nichts zu holen -- die Zahl steht schon
	}
	ensureEcosystemRegionsLoadedForLabelFilter().then(() => {
		const nachher = typeof ecosystemRegionOfLabel === "function" ? ecosystemRegionOfLabel(entry?.label) : null;
		if (!nachher || nachher.area_count === undefined) {
			return;
		}
		neuSetzen();
	}).catch(() => {
		// 🪤 Still: der Kopf steht bereits da, nur ohne die Flaechenzahl. Eine Fehlermeldung fuer
		// eine Nebenauskunft waere lauter als ihr Wert -- und das Popup selbst ist nicht kaputt.
	});
}

// Das Kachelmenue eines Labels OHNE seinen Marker oeffnen (Owner 24.08.2026).
//
// 💣 WARUM ES DAS BRAUCHT. Sobald eine Flaeche ihre Kurve traegt, meldet der Kurvenriegel den Marker ab
// (shouldShowLabelMarker) -- und mit ihm sein Popup, denn das haengt am Marker. Der gemalte Name ist
// anklickbar (Klick-Register der Canvas), aber er oeffnete nur Hervorhebung und Infopanel: das
// Kachelmenue, das der Marker getragen haette, gab es fuer Kurvenlabels nirgends. Owner, woertlich:
// „im standardmodus [kann man] nicht auf kurvenlabels klicken (infopanel geht, aber das floating menue
// fuer editoren kommt nicht)". Damit war ein Kurvenlabel im Standardmodus ueber KEINEN Weg zu
// bearbeiten -- dieselbe Klasse Fehler wie bei den verwaisten Aussenhuellen.
//
// 🔴 DASSELBE MARKUP und dieselben Optionen wie am Marker (labelPopupMarkup, beide Klassen). Die
// Kachel-Handler haengen an `data-popup-action` und werden ohnehin delegiert -- ein eigenes, magereres
// Menue waere ein zweites Vokabular fuer dieselben Gesten.
//
// @param entry  der Labeleintrag (aus labelMarkers -- er existiert, nur sein Marker ist abgemeldet)
// @param latlng wo das Menue stehen soll (die Klickstelle am gemalten Namen)
// @return true, wenn es geoeffnet wurde
function avesmapsOeffneLabelKachelmenue(entry, latlng) {
	if (typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE || !entry?.label) {
		return false;
	}
	if (typeof labelPopupMarkup !== "function" || typeof L === "undefined" || typeof map === "undefined") {
		return false;
	}
	const punkt = latlng || (typeof entry.marker?.getLatLng === "function" ? entry.marker.getLatLng() : null);
	if (!punkt) {
		return false;
	}
	// Dieselben zwei Klassen wie am Marker: „floating-location-popup" schaltet die Kachel-Optik frei,
	// „settlement-popup" hebt den 260px-Deckel auf 400 -- ohne die zweite brechen vier Kacheln um.
	const popup = L.popup({ className: "settlement-popup floating-location-popup", minWidth: 320, maxWidth: 400 })
		.setLatLng(punkt)
		.setContent(labelPopupMarkup(entry));
	popup.openOn(map);
	avesmapsLabelMenueFlaechenzahlNachziehen(entry, () => {
		// 🪤 Nur nachtragen, solange DIESES Popup noch offen ist -- sonst reisst ein spaeter
		// eingetroffenes Nachladen ein inzwischen geschlossenes Menue wieder auf.
		if (typeof map.hasLayer === "function" && map.hasLayer(popup)) {
			popup.setContent(labelPopupMarkup(entry));
		}
	});

	return true;
}

// Wie viele Beschriftungen haengen an dieser Flaeche? Ueber ALLE Labels gezaehlt, nicht ueber die
// sichtbaren: labelData traegt den ganzen Bestand aus der map-features-Nutzlast, waehrend die Marker
// nach Zoom und Ausschnitt kommen und gehen. Eine Zahl, die beim Zoomen springt, waere keine Auskunft.
function countEcosystemRegionLabels(regionPublicId) {
	const gesucht = String(regionPublicId || "");
	if (gesucht === "" || typeof ecosystemRegionOfLabel !== "function") {
		return 0;
	}

	return labelData.filter((label) => String(ecosystemRegionOfLabel(label)?.public_id || "") === gesucht).length;
}

// 🔴 Ein gespeichertes Label SOFORT auf der Karte nachziehen (Owner 2026-07-28). Vorher wurde die
// Änderung erst sichtbar, wenn der Live-Sync-Poll die nächste Karten-Nutzlast holte -- also nach bis zu
// 15 Sekunden. Die Fläche stand längst neu da und ihr Name noch auf dem alten: es sah aus, als hätte
// das Speichern die Beschriftung vergessen.
//
// 🪤 Über normalizeLabelFeature, nicht per Handanlegen an einzelnen Feldern: die Antwort des Servers ist
// dieselbe Form wie die der Karten-Nutzlast, und nur so bleibt „sofort" und „nach dem nächsten Laden"
// dasselbe Ergebnis. Wer hier drei Felder einzeln setzt, baut die zweite Wahrheit.
function applyLabelFeatureLocally(feature) {
	const publicId = String(feature?.properties?.public_id || feature?.public_id || "");
	const entry = publicId ? findLabelEntryByPublicId(publicId) : null;
	if (!entry) {
		return false;
	}

	const frisch = normalizeLabelFeature(feature);
	const index = labelData.indexOf(entry.label);
	if (index >= 0) {
		labelData[index] = frisch;
	}
	entry.label = frisch;
	entry.marker.setLatLng(frisch.coordinates);
	entry.marker.setIcon(createLabelIcon(frisch));
	refreshLabelMarkerPopup(entry);
	// Sichtbarkeit UND Kollision neu: ein anderer Name ist ein anderer Kasten, und ein anderer Subtyp
	// bringt ein anderes Zoom-Band mit.
	syncLabelVisibility();

	return true;
}

function findLabelEntryByPublicId(publicId) {
	return labelMarkers.find((entry) => entry.label.publicId === publicId) || null;
}

// Die Beschriftung einer LANDSCHAFTSFLÄCHE, gesucht über den Regionsschlüssel statt über die eigene
// Kennung. Das ist der Weg, den ein Landschaftsname im Routenplaner braucht: er kennt die Region
// (`ecosystem_region.public_id` aus path-landscapes.php), und was auf der Karte steht und anklickbar
// ist, ist das Label.
//
// 💣 Fläche↔Label ist 1:N -- der Zeiger sitzt am LABEL (`properties.ecosystem_region_public_id`, vom
// Server auch im Lesemodus aufgelöst). Der erste Treffer genügt hier: die Beschriftungen einer Region
// liegen auf derselben Fläche, und wir fliegen nur hin. Ohne Zeiger kein Treffer -- 412 der 589
// Regionen tragen gar kein Label, und für die gibt es nichts anzufliegen.
// ALLE Beschriftungen einer Flaeche, in stabiler Reihenfolge.
//
// 🔴 Fuer das vereinigte Fenster (25.08.2026): 13 der 1026 Flaechen tragen zwei oder drei
// Beschriftungen -- das Ingvaltal und das Yaquirtal je drei. Genau dafuer wurde die Beziehung am
// 28.07.2026 auf 1:N gestellt („der Finsterkamm will im Norden UND im Sueden beschriftet
// werden, jedes mit eigener Drehung/Position/Groesse").
//
// 💣 Sortiert wird nach der `publicId`, nicht nach der Reihenfolge im Bestand: die haengt an der
// Ladereihenfolge der Nutzlast und rutscht, sobald jemand eine Beschriftung anlegt -- dann
// zeigte die Auswahl „2 von 3" beim naechsten Oeffnen auf eine andere. Dieselbe Falle wie bei
// `Kreuzung-N` (AGENTS.md §11).
function findLabelEntriesByEcosystemRegion(regionPublicId) {
	const gesucht = String(regionPublicId || "");
	if (gesucht === "") {
		return [];
	}
	return labelMarkers
		.filter((entry) => String(entry.label.ecosystemRegionPublicId || "") === gesucht)
		.sort((a, b) => String(a.label.publicId).localeCompare(String(b.label.publicId)));
}

function findLabelEntryByEcosystemRegion(regionPublicId) {
	const gesucht = String(regionPublicId || "");
	if (gesucht === "") {
		return null;
	}
	return labelMarkers.find((entry) => String(entry.label.ecosystemRegionPublicId || "") === gesucht) || null;
}

// Ein Label von der Karte UND aus beiden Beständen nehmen. Ausgelagert, weil es seit der Landschafts-
// Kaskade zwei Anlässe gibt: das ausdrücklich gelöschte Label -- und die Geschwister, die der Server
// mitgelöscht hat, weil mit ihnen die ganze Region ging.
function removeLabelEntryLocally(entry) {
	if (!entry) {
		return;
	}
	map.removeLayer(entry.marker);
	labelData = labelData.filter((label) => label !== entry.label);
	labelMarkers = labelMarkers.filter((labelEntry) => labelEntry !== entry);
}

// 🔴 Die Labels, die eine Landschafts-Kaskade mitgenommen hat, sofort von der Karte nehmen. Der Server
// nennt sie beim Namen (`deleted_label_public_ids`), damit genau diese Marker verschwinden -- statt die
// 21 MB grosse Kartennutzlast neu zu laden, nur um herauszufinden, welche es waren.
//
// 🪤 Ohne das bliebe ein Name ohne Fläche bis zum nächsten Seitenaufbau stehen: Labels kommen aus der
// Kartennutzlast, und die lädt weder das Kontextmenü noch eine boolesche Operation neu.
function removeEcosystemCascadedLabels(result) {
	const publicIds = result?.deleted_label_public_ids;
	if (!Array.isArray(publicIds) || publicIds.length === 0) {
		return 0;
	}
	let entfernt = 0;
	publicIds.forEach((publicId) => {
		const entry = findLabelEntryByPublicId(String(publicId));
		if (entry) {
			removeLabelEntryLocally(entry);
			entfernt += 1;
		}
	});
	if (entfernt > 0) {
		syncLabelVisibility();
	}

	return entfernt;
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

// MAP_LABEL_MODES steht in js/config.js -- der Editor-Haken muss dieselbe Liste lesen.
// Der "Labels"-Haken (nur Edit-Modus) uebersteuert AUSSCHLIESSLICH die Modus-Bedingung unten --
// nicht das Zoomband und nicht das Viewport-Culling. Ein vorgezogenes `return box.checked` haette
// alle vier Bedingungen ausgehebelt: alle Label-Marker auf jeder Zoomstufe auf der Karte, und
// scheduleLabelCollisionResolution() ueber den ganzen Satz -- kein Haken mehr, ein Perf-Unfall.
// Der WERT wird einmal je Sync-Lauf gelesen und durchgereicht; shouldShowLabelMarker laeuft pro
// Label pro Sync (jeder Zoom, jeder Move). Das ELEMENT zu cachen waere die falsche Reparatur: es
// haengt in einem hidden-Container, den der Moduswechsel umschaltet.
// Dreiwertig wie beim Grenzen-Haken: true = zeigen, false = verbergen, null = kein Haken da
// -> allein der Modus entscheidet.
// ⚠️ Diese Datei stand am 12.08.2026 in ihrer ALTEN Fassung auf dem Server (fuenf gescheiterte
// Deploys), der Labels-Haken wirkte im Frontend also noch nicht. Nur eine Inhaltsaenderung heilt.
// 🔴 Der Vorbehalt `IS_EDIT_MODE ?` ist am 12.08.2026 gefallen: der Haken steht seither fuer
// JEDEN Besucher im Anzeige-Menue an der Karte (#map-display-menu). Die Dreiwertigkeit bleibt
// aber tragend -- `?? null` faengt den Fall, dass das Element gar nicht da ist (fremde Seite,
// halber Deploy). Dann entscheidet der Modus allein, genau wie vor diesem Datum.
function isMapLabelEditorOverrideActive() {
	return document.getElementById("toggleMapLabels")?.checked ?? null;
}

// „nur Labels mit Region" — Edit-Mode und nur mit eingeschaltetem Landschaftsmodul (bootstrap.js).
// Fehlt der Regionenbestand, kann der Filter nichts wissen und gilt als aus: lieber alles zeigen als
// alles verbergen.
function isLabelsWithRegionFilterActive() {
	return typeof ecosystemRegionOfLabel === "function"
		&& document.getElementById("toggleLabelsWithRegion")?.checked === true;
}

// PUR (und deshalb prüfbar): gehört diese Beschriftung zur gerade gewählten Landschaftsebene?
//
// Vier Fälle, und nur der letzte filtert:
//   * gar kein Landschaftsmodus  -> ja (die Regel gilt nicht)
//   * „Alle"                     -> ja (Owner: „bei Alle darf alles dranstehen")
//   * Gipfel in der Topographie  -> ja (Owner 27.08.2026, siehe unten)
//   * eine gewählte Ebene        -> nur, wenn die Fläche dieses Labels zu ihr gehört
//
// 🪤 Die Umgebungsfunktionen werden mit `typeof` abgefragt, weil map-features-labels.js VOR
// map-features-ecosystem-layer-switch.js geladen wird (index.html). Zur AUFRUFzeit sind sie da; beim
// Laden noch nicht, und ein harter Zugriff auf Modulebene wäre ein ReferenceError.
function isLabelOfActiveEcosystemLayer(label) {
	if (typeof isEcosystemLayerModeActive !== "function" || !isEcosystemLayerModeActive()) {
		return true;
	}
	if (typeof isEcosystemShowAllLayers === "function" && isEcosystemShowAllLayers()) {
		// 🔴 Ausser den Ebenen, die „Alle" ausnimmt -- heute die Klimazonen (Owner 27.08.2026). Die Liste
		// steht in map-features-ecosystem-layer-switch.js und wird hier nur gelesen.
		// 🪤 DIESER ZWEIG HAT HEUTE KEINEN ERZEUGER, und das ist Absicht, kein Versehen: live trägt KEINE
		// der 980 Beschriftungen ein `ecosystem_region_kind = klima` (gemessen 27.08.2026) -- die
		// Zonennamen malt das Klima-Modul selbst (drawClimateZoneNames). Er steht trotzdem da, weil eine
		// Klimaregion jederzeit ein `label_public_id` bekommen kann und der Name dann durch diese
		// Pipeline käme, an der Ausnahme vorbei. Wer ihn für tot hält, prüft erst die Zahl neu.
		return !(typeof isEcosystemKindHiddenInShowAll === "function"
			&& isEcosystemKindHiddenInShowAll(label?.ecosystemRegionKind));
	}
	if (typeof getActiveEcosystemLayerKind !== "function") {
		return true;
	}
	const ebene = getActiveEcosystemLayerKind();

	// 🔴 EIN GIPFEL GEHÖRT ZUR TOPOGRAPHIE, AUCH OHNE FLÄCHE (Owner 27.08.2026: „topographie soll für
	// editoren und normale nutzer berggipfel anzeigen"). Ein Berggipfel ist ein PUNKT und trägt deshalb
	// nie ein `ecosystem_region_kind` -- live gemessen 0 von 73 --, fiel also durch die Zeile darunter,
	// obwohl er der ARBEITSPUNKT genau dieser Ebene ist: aus seiner Höhe entsteht das Relief.
	//
	// 💣 DIESELBE AUSNAHME STEHT SCHON EINMAL DA, und dass sie hier fehlte, ist die ganze Störung:
	// isEcosystemLabelMuted nimmt Gipfel in der Topographie vom BLASSMACHEN aus (mit derselben
	// Begründung), der Sichtbarkeitsfilter kam am 04.08.2026 dazu und hat sie wieder zugemacht. Der
	// Gipfel war seither nicht blass, sondern gar nicht da -- und damit auch nicht ziehbar, obwohl
	// syncEcosystemPeakDragging ihn freischaltet. Wer eine der beiden Stellen ändert, prüft die andere.
	//
	// 🔴 ROLLENFREI. Diese Zeile fragt kein Recht: Besucher und Editor sehen denselben Gipfel. Das Recht
	// entscheidet über das ZIEHEN (isEcosystemPeakActive), nie über das Sehen.
	//
	// 🪤 Über den `labelType`, nicht über isEcosystemPeakLabel(publicId): jenes scannt `labelData`
	// linear, und diese Funktion läuft pro Label pro Zoom und pro Move. Welche Subtypen Gipfel sind,
	// steht weiterhin an EINER Stelle (ECOSYSTEM_PEAK_SUBTYPES: berggipfel + vulkan).
	// ⚠️ `typeof` wie bei den Nachbarn -- map-features-labels.js lädt vor dem Höhenmodul. Fehlt es,
	// gilt „kein Gipfel", also das Verhalten von vorher.
	if (ebene === "topographie" && typeof isEcosystemPeakSubtype === "function"
		&& isEcosystemPeakSubtype(label?.labelType)) {
		return true;
	}

	return String(label?.ecosystemRegionKind || "") === ebene;
}

// Liegt diese Beschriftung auf dieser Zoomstufe in ihrem Band?
//
// 🔴 DIE TAFEL RAET -- und das ist die UMGEKEHRTE Regel zur Groesse (Entwurf §6). Der eigene Wert
// des Labels gewinnt; die Vorgabe je Art greift nur, wo das Label KEINEN traegt. Weil heute jede
// Beschriftung min_zoom und max_zoom traegt, aendert sich an der Sichtbarkeit vorerst NICHTS --
// gewollt: der Editor behaelt seine Entscheidung und sieht die Vorgabe nur als Marke.
//
// 💣 Wer das mit der GROESSE gleich behandelt, nimmt den Editoren entweder ihre Baender weg (Tafel
// gilt) oder laesst die Groesse wirkungslos (Tafel raet). Beides ist genau falsch herum.
//
// 🔴 UND GENAU EINE AUSNAHME: BEI GIPFELN GILT DIE TAFEL (Owner 27.08.2026, „berggipfel und vulkane
// sollen ab Z4 erscheinen“). Als blosse Vorgabe waere die Anweisung wirkungslos gewesen -- live
// traegt jeder der 73 Gipfel ein eigenes min_zoom, verteilt ueber z2 bis z6. Die Ausnahme MUSS eine
// bleiben: gaelte sie fuer alle Arten, waere sie der Fehler, vor dem der Absatz darueber warnt.
//
// ⭐ Eigene, REINE Funktion, damit ein Test sie AUSFUEHREN kann. Als Ausdruck mitten in
// shouldShowLabelMarker liess sie sich nur ueber ihren Quelltext pruefen -- und eine Mutation, die
// den eigenen Wert ignoriert, blieb dabei gruen (gemessen am 24.08.2026).
function avesmapsLabelImBand(label, bandZoom) {
	// 💣 `Number(null)` ist 0, NICHT NaN -- ein Label ohne Band fiele mit `Number.isFinite` allein in
	// den „hat eigenes Band"-Zweig und waere nur auf z0 sichtbar. Deshalb erst auf null/undefined
	// pruefen und dann auf Zahl. Der Test hat genau das gefunden.
	const rohMin = label?.minZoom;
	const rohMax = label?.maxZoom;
	const min = Number(rohMin);
	const max = Number(rohMax);
	const hatEigenes = rohMin !== null && rohMin !== undefined && Number.isFinite(min)
		&& rohMax !== null && rohMax !== undefined && Number.isFinite(max);
	// 🔴 Ein Gipfel folgt der Tafel, nicht seinem eigenen Band -- die eine Ausnahme, oben begruendet.
	// ⚠️ `typeof` wie beim Nachbarn darunter: diese Datei laedt vor dem Hoehenmodul, und der Test
	// schneidet die Funktion allein heraus. Fehlt die Liste, gilt „kein Gipfel“ -- das Verhalten von
	// vorher, kein Wurf.
	const istGipfel = typeof isEcosystemPeakSubtype === "function"
		&& isEcosystemPeakSubtype(label?.labelType);
	if (hatEigenes && !istGipfel) {
		return bandZoom >= min && bandZoom <= max;
	}
	if (typeof avesmapsEcosystemDisplaySichtbar === "function") {
		return avesmapsEcosystemDisplaySichtbar(label?.labelType, bandZoom);
	}
	// 🪤 Der Notausgang: fehlt auch die Tafel, faellt ein Gipfel auf sein eigenes Band zurueck. Das ist
	// die sichere Richtung -- lieber ein Name zur falschen Zoomstufe als gar keiner.
	return bandZoom >= (Number.isFinite(min) ? min : 0) && bandZoom <= (Number.isFinite(max) ? max : 7);
}

function shouldShowLabelMarker(entry, zoomLevel = map.getZoom(), renderBounds = getMapRenderBounds(), editorOverride = isMapLabelEditorOverrideActive(), mitKurvenriegel = true) {
	const minZoom = Number(entry.label.minZoom) || 0;
	const maxZoom = Number.isFinite(Number(entry.label.maxZoom)) ? Number(entry.label.maxZoom) : 7;
	// Sichtbarkeits-Band gegen die ECHTE Zoomstufe pruefen (Karte geht bis 7), NICHT gegen den auf
	// VISUAL_MAX_ZOOM_LEVEL=5 geklemmten Visual-Zoom -- sonst sind Zoom 5/6/7 fuer Labels ununterscheidbar
	// und "Sichtbar bis Zoom" hat oben keinen Effekt (5 <= maxZoom ist fuer maxZoom>=5 immer wahr). Die
	// Label-GROESSE skaliert weiter ueber den Visual-Zoom (s. getScaledLabelSize).
	const bandZoom = Math.max(0, Math.round(Number(zoomLevel)));
	// Haken aus -> immer weg. `return false` und NICHT `return box.checked`: ein wahrheitswertiges
	// Vorab-return wuerde Zoomband und Culling mit aushebeln; false kann nur verbergen, nie zeigen.
	if (editorOverride === false) {
		return false;
	}

	// „Regionname anzeigen" aus -> das Label bleibt bestehen, wird aber nicht gezeichnet. Wie der
	// Editor-Riegel darüber ein `return false` und keine wahrheitswertige Bedingung: es darf nur
	// verbergen, nie zeigen, sonst höbe es Zoomband und Culling mit aus.
	if (entry.label.showName === false) {
		return false;
	}

	// „nur Labels mit Region": blendet Beschriftungen aus, an denen keine Landschaftsfläche hängt.
	// Wieder ein `return false` und keine wahrheitswertige Bedingung -- der Haken darf nur verbergen.
	if (isLabelsWithRegionFilterActive() && !ecosystemRegionOfLabel(entry.label)) {
		return false;
	}

	// 🔴 EINE GEWÄHLTE EBENE ZEIGT NUR IHRE EIGENEN BESCHRIFTUNGEN (Owner 2026-08-04: „Wälder bei
	// Vegetation, Namen der Klimazonen, etc. -- bei Alle darf alles dranstehen"). Wer auf Vegetation
	// schaltet, will die Wälder lesen und nicht die Gebirge daneben.
	//
	// 🪤 Auch die Beschriftungen OHNE Fläche fallen weg -- Ortsnamen, Meere, alles, was an keiner
	// Landschaftsfläche hängt. Das ist gewollt: „nur die Labels, die für die jeweilige Zone gelten".
	// In „Alle" greift die Regel gar nicht, dort steht wieder alles.
	//
	// Wieder ein `return false` und keine wahrheitswertige Bedingung: der Filter darf nur verbergen.
	if (!isLabelOfActiveEcosystemLayer(entry.label)) {
		return false;
	}

	// 🔴 Ein Kurvenlabel wird auf CANVAS gemalt (Entwurf §7.3), nicht als gedrehtes <img> im divIcon.
	// Wieder ein `return false` und keine wahrheitswertige Bedingung, aus demselben Grund wie die
	// vier Riegel darueber: er darf nur verbergen, nie zeigen.
	// ⚠️ DER RIEGEL STEHT ZULETZT. Weiter oben stuende er ueber dem Ebenen- und dem Zoomfilter --
	// dann waere „Kurvenbeschriftung an" ein Weg, ein Label an der Ebenenwahl vorbeizuschmuggeln.
	// ⚠️ Er haengt an einem Zustand, den erst der Kollisionsdurchgang setzt
	// (avesmapsKurvenlabelPlatzierungen). Beim allerersten Bild ist die Ablage noch leer, der Marker
	// steht also einen Durchgang lang. Das ist richtig herum: lieber ein Bild zu viel Marker als ein
	// fehlender Name.
	// 💣 `typeof`, nicht blank: mit ?canvaspathlabels=0 steigt das Overlay aus, bevor es die Funktion
	// ueberhaupt setzt -- dann wird auch keine Kurve gemalt, und genau dann gehoert der Marker
	// stehengelassen. Ein blanker Aufruf waere derselbe ReferenceError, an dem am 22.08.2026
	// findFreePlacement beinahe saemtliche Wegnamen gekostet haette.
	// 🔴 `mitKurvenriegel` ist die EINE Ausnahme, und sie ist tragend: avesmapsKurvenlabelKandidaten
	// fragt mit `false`. Sonst schluege der Riegel auf seine eigene Voraussetzung zurueck -- ein
	// gemaltes Kurvenlabel fiele im naechsten Durchgang aus der Kandidatenliste, wuerde nicht mehr
	// gemalt, der Marker kaeme zurueck, und das Ganze flackerte im Wechsel.
	// 🔴 DER MARKER GEHT AUCH IM BEARBEITEN-MODUS (Owner 23.08.2026, an vier Screenshots: „jetzt
	// muessen nur ihre vorgaenger weg“). Bis dahin blieb er dort absichtlich stehen, und der Name
	// stand doppelt -- gebogen auf der Kurve und waagerecht daneben.
	// 💣 DER PREIS, UND ER IST BEWUSST BEZAHLT: mit dem Marker gehen Klick, Popup und ZIEHGRIFF des
	// Labels. Ein Label laesst sich seither nicht mehr mit der Maus verschieben, und der
	// Klick-Schiedsrichter des Canvas-Overlays steigt bei IS_EDIT_MODE weiterhin sofort aus (ein
	// Klick soll die FLAECHE darunter treffen).
	// ⭐ OHNE ERSATZ WAEREN ALLE 52 BESCHRIFTUNGEN UNERREICHBAR GEWESEN -- die Owner-Regel von den
	// verwaisten Aussenhuellen, zweite Auflage („es darf keine Elemente geben, ueber die ich keine
	// Kontrolle mehr habe“). Gemessen vor dem Umbau: das Flaechenmenue kannte nur `create-label`,
	// einen Weg zu einem BESTEHENDEN Label gab es dort nicht. Der Ersatz ist „Beschriftung
	// bearbeiten“ im Kontextmenue der FLAECHE (map-features-ecosystem-context-action.js, Eintrag
	// `edit-label`) -- woertlich der vom Owner gewaehlte Weg. Wer diesen Riegel je wieder anfasst,
	// prueft ZUERST, ob es diesen Eintrag noch gibt.
	if (mitKurvenriegel
		&& typeof avesmapsLabelWirdAlsKurveGemalt === "function"
		&& avesmapsLabelWirdAlsKurveGemalt(entry.label)) {
		return false;
	}

	// 🔴 DIE TAFEL RAET -- und das ist die UMGEKEHRTE Regel zur Groesse darueber (Entwurf §6).
	// Der eigene Wert des Labels gewinnt; die Vorgabe je Art greift nur, wo das Label KEINEN traegt.
	// Weil heute jede Beschriftung min_zoom und max_zoom traegt, aendert sich an der Sichtbarkeit
	// vorerst NICHTS -- gewollt: der Editor behaelt seine Entscheidung und sieht die Vorgabe nur als
	// Marke auf seinem Regler.
	// 💣 Wer beides gleich behandelt, nimmt den Editoren entweder ihre Baender weg (Tafel gilt) oder
	// laesst die Groesse wirkungslos (Tafel raet). Beides ist genau falsch herum.
	return (MAP_LABEL_MODES.includes(getSelectedMapLayerMode()) || editorOverride === true)
		&& avesmapsLabelImBand(entry.label, bandZoom)
		&& isLatLngInRenderBounds(entry.marker.getLatLng(), renderBounds);
}

// Welche Labels wuerden JETZT als Kurve gezeichnet? Der schmale Leser fuer Kanal C
// (map-features-path-label-canvas-overlay.js) -- er liefert genau die Labels, die eine `curveLine`
// tragen UND nach `shouldShowLabelMarker` sichtbar waeren. Die Sichtbarkeitsregel bleibt damit an
// ihrer EINEN Stelle; das Overlay bekommt eine fertige Liste und kein zweites Regelwerk.
// 💣 Wer die Zoom- und Ebenenpruefung im Overlay nachbaut, hat zwei Regeln, die beim ersten neuen
// Filter auseinanderlaufen. Genau diese Falle hat am 14.08.2026 die Verkehrsmittel-Sperre gekostet:
// eine Regel, die einen von vier Erzeugern bindet, ist keine Regel.
// ⚠️ `shouldShowLabelMarker` prueft den Bildausschnitt gegen `entry.marker.getLatLng()` -- die
// ANKERLAGE des Labels. Eine Kurve ist bis zu 88 Karteneinheiten lang; ihr Anker kann ausserhalb
// liegen, waehrend ein Stueck Kurve noch im Bild ist. Das ergibt an den Bildraendern ein spaet
// erscheinendes Kurvenlabel -- fuer Plan 2 hingenommen und gemessen (Aufgabe 7), nicht behoben: die
// Ankerpruefung gilt heute allen Labels, sie hier allein fuer Kurven zu aendern waere eine zweite
// Sichtbarkeitsregel.
// Eine frisch gespeicherte Kurveneinstellung SOFORT auf die Karte bringen.
//
// 🔴 WARUM ES DAS BRAUCHT: die Kurve reist im Kartenpayload, und der wird nach einem Speichern nicht
// neu geholt. Ohne diesen Schritt aendert sich am Bild gar nichts -- der Editor stellt um, drueckt
// Speichern und sieht denselben Zustand wie vorher. Genau so gemeldet am 23.08.2026
// („speichere, nix passiert").
//
// ⚠️ EINSCHALTEN kann hier keine Kurve herbeizaubern: sie wird auf dem SERVER gerechnet und liegt im
// Zwischenspeicher, den nur der Sammellauf fuellt („Kurven rechnen“ im Landschaften-Editor). Diese
// Funktion setzt deshalb beim Einschalten nur die ANZAHL; die Kurve selbst erscheint nach dem Lauf.
// AUSschalten dagegen wirkt sofort -- die Kurve wird entfernt, das Label ist wieder ein normales.
//
// ⭐ Mit `roheLinie` faellt auch das Einschalten sofort ins Bild: die Aktion `refresh_curve` rechnet
// die Kurve serverseitig und reicht sie zurueck, statt den Browser auf den naechsten Kartenpayload
// warten zu lassen.
function avesmapsCurveSettingAufLabelsAnwenden(regionPublicId, an, max, roheLinie) {
	const eintraege = avesmapsLabelEntriesForEcosystemRegion(regionPublicId);
	if (eintraege.length === 0) {
		return 0;
	}
	for (const eintrag of eintraege) {
		if (an === false) {
			eintrag.label.curveLine = null;
		} else if (roheLinie) {
			// ⭐ Eine frisch gerechnete Kurve („Labelkurve aktualisieren" im Flaechenmenue). Gedreht wird mit
			// DEMSELBEN Leser, mit dem der Kartenpayload gelesen wird -- GeoJSON haelt [x, y], Leaflet
			// [lat, lng] = [y, x] (AGENTS.md §5). Ein zweiter Dreh-Weg waere die Stelle, an der die
			// Vorzeichen irgendwann auseinanderlaufen, und das faellt bei N/O/S/W nicht auf.
			// ⚠️ Nur uebernehmen, wenn der Leser sie annimmt: eine unbrauchbare Linie darf die
			// vorhandene nicht loeschen -- sonst macht ein Fehlschlag den Namen unsichtbar.
			const gedreht = readLabelCurveLine({ curve_label_line: roheLinie });
			if (gedreht) {
				eintrag.label.curveLine = gedreht;
			}
		}
		if (Number.isFinite(Number(max))) {
			eintrag.label.curveMax = Math.min(3, Math.max(1, Math.round(Number(max))));
		}
		// Der Marker muss neu gezeichnet werden: ohne Kurve traegt er den Namen wieder, und zwar
		// waagerecht (Entwurf §4.3). Sein Icon kennt die Drehung, nicht die Kurve -- also neu bauen.
		eintrag.marker.setIcon(createLabelIcon(eintrag.label));
	}
	// 💣 UND JETZT DIE DREI SCHRITTE IN GENAU DIESER REIHENFOLGE. Am 23.08.2026 im Browser des Owners
	// gemessen, nachdem „Kurvenbeschriftung aus" den Namen GANZ verschwinden liess:
	//
	// 1. Die Platzierung NEU RECHNEN. `avesmapsLabelWirdAlsKurveGemalt` fragt das Ergebnis des letzten
	//    Durchgangs; ohne Neurechnung gilt das eben abgeschaltete Label dort weiter als „wird als
	//    Kurve gemalt", und der Riegel haelt seinen Marker unten. Gemessen: shouldShowLabelMarker
	//    blieb `false`, obwohl Zoomband, Bildausschnitt und Ansicht alle passten.
	//    ⚠️ Gerufen wird sie fuer ihren NEUAUFBAU, nicht fuer ihren Rueckgabewert.
	// 2. Die Marker der geaenderten Labels EINZELN nachziehen. `avesmapsSyncKurvenlabelMarker`
	//    kann das nicht: er ueberspringt jedes Label OHNE `curveLine` -- und genau das ist ein eben
	//    abgeschaltetes. Gemessen: nach ihm blieb der Marker weg, nach syncLabelMarkerVisibility kam
	//    er zurueck.
	// 3. Und den normalen Durchgang anstossen, damit Kollisionen und Canvas nachziehen.
	if (typeof avesmapsKurvenlabelPlatzierungen === "function") {
		avesmapsKurvenlabelPlatzierungen(null);
	}
	for (const eintrag of eintraege) {
		syncLabelMarkerVisibility(eintrag);
	}
	if (typeof scheduleLabelCollisionResolution === "function") {
		scheduleLabelCollisionResolution();
	}
	return eintraege.length;
}

// Die Beschriftungen EINER Landschaftsflaeche -- fuer „Beschriftung bearbeiten“ im Flaechenmenue.
//
// 🔴 Sie ist der Ersatz fuer den Marker, den der Kurvenriegel im Bearbeiten-Modus abmeldet. Ohne sie
// gaebe es keinen Weg mehr zu einem bestehenden Label (das Flaechenmenue kannte nur `create-label`).
//
// 💣 Aufgeloest wird ueber `ecosystemRegionOfLabel`, den EINEN Aufloeser des Hauses -- nicht ueber
// einen eigenen Vergleich auf `label.ecosystemRegionPublicId`. Die Zugehoerigkeit steht in BEIDEN
// Richtungen (Zeiger am Label und `label_public_id` an der Region); wer nur eine liest, findet das
// zweite und dritte Label einer Flaeche nie -- und genau die sind bei „Max. Namen 2“ der Sinn.
function avesmapsLabelEntriesForEcosystemRegion(regionPublicId) {
	const gesucht = String(regionPublicId || "").trim();
	if (gesucht === "" || typeof labelMarkers === "undefined" || !Array.isArray(labelMarkers)) {
		return [];
	}
	if (typeof ecosystemRegionOfLabel !== "function") {
		return [];
	}
	return labelMarkers.filter((eintrag) => {
		const region = ecosystemRegionOfLabel(eintrag?.label);
		return Boolean(region) && String(region.public_id || "") === gesucht;
	});
}

function avesmapsKurvenlabelKandidaten() {
	if (typeof labelMarkers === "undefined" || !Array.isArray(labelMarkers)) {
		return [];
	}
	const zoomLevel = map.getZoom();
	const renderBounds = getMapRenderBounds();
	const editorOverride = isMapLabelEditorOverrideActive();
	return labelMarkers
		.filter((entry) => Array.isArray(entry.label.curveLine) && entry.label.curveLine.length >= 2)
		// 💣 OHNE DEN KURVENRIEGEL (letztes Argument `false`). Der Riegel in shouldShowLabelMarker
		// fragt, ob dieses Label GERADE als Kurve gemalt wird -- und diese Liste ist es, aus der das
		// Malen erst hervorgeht. Mit Riegel fiele jedes einmal gemalte Kurvenlabel im naechsten
		// Durchgang aus seiner eigenen Kandidatenliste; es wuerde nicht mehr gemalt, der Marker kaeme
		// zurueck, und beides wechselte sich Bild fuer Bild ab. Alle uebrigen Regeln (Zoomband,
		// Ebenenwahl, Bildausschnitt, die beiden Haken) gelten unveraendert -- es ist EIN Riegel, der
		// hier ausgenommen ist, kein zweites Regelwerk.
		.filter((entry) => shouldShowLabelMarker(entry, zoomLevel, renderBounds, editorOverride, false))
		.map((entry) => entry.label);
}

// Die Marker der Kurvenlabels nachziehen -- gerufen vom Kollisionsdurchgang, direkt nachdem die
// Platzierungen stehen (map-features-label-collisions.js).
//
// 💣 Ohne diesen Aufruf stuende der Name DOPPELT: der Riegel in shouldShowLabelMarker haengt am
// Ergebnis der Platzierung, aber niemand sonst fragt ihn erneut -- syncLabelVisibility laeuft nur
// bei Zoom und Schwenk. Nach dem Laden bliebe der waagerechte Marker also neben der Kurve stehen,
// bis der Benutzer die Karte bewegt.
//
// ⚠️ Sie ruft syncLabelMarkerVisibility und NICHT syncLabelVisibility: jenes meldet am Ende einen
// neuen Kollisionsdurchgang an, und der liefe mitten im laufenden Durchgang auf eine Schleife
// hinaus. Nachgezogen werden nur Labels MIT Kurve -- alle anderen kann dieser Riegel nicht
// betreffen.
function avesmapsSyncKurvenlabelMarker() {
	if (typeof labelMarkers === "undefined" || !Array.isArray(labelMarkers)) {
		return;
	}
	const zoomLevel = map.getZoom();
	const renderBounds = getMapRenderBounds();
	const editorOverride = isMapLabelEditorOverrideActive();
	labelMarkers.forEach((entry) => {
		if (!Array.isArray(entry.label.curveLine) || entry.label.curveLine.length < 2) {
			return;
		}
		syncLabelMarkerVisibility(entry, zoomLevel, renderBounds, editorOverride);
	});
}

function syncLabelMarkerVisibility(entry, zoomLevel = map.getZoom(), renderBounds = getMapRenderBounds(), editorOverride = isMapLabelEditorOverrideActive()) {
	const shouldShow = shouldShowLabelMarker(entry, zoomLevel, renderBounds, editorOverride);
	const isVisible = map.hasLayer(entry.marker);
	if (shouldShow && !isVisible) {
		// 🔴 RASTERN VOR DEM `addTo` -- das ist die ganze Bedarfs-Rasterung, und die Reihenfolge ist
		// tragend: ein Marker auf der Karte muss sein echtes Icon tragen, sonst misst die
		// Kollisionsaufloesung ein Rechteck der Groesse 0 und schiebt die Ortsnamen daneben ins Leere.
		// Ohne `?labelbedarf=1` steht hier von vornherein das echte Icon, die Bedingung ist dann falsch.
		if (avesmapsLabelBedarfAktiv() && entry._bedarfIconZoom !== zoomLevel) {
			avesmapsLabelIconRastern(entry, zoomLevel);
		}
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
	const editorOverride = isMapLabelEditorOverrideActive();
	labelMarkers.forEach((entry) => syncLabelMarkerVisibility(entry, zoomLevel, renderBounds, editorOverride));
	scheduleLabelCollisionResolution();
}

function syncLabelIcons() {
	const zoomLevel = map.getZoom();
	const renderBounds = getMapRenderBounds();
	const editorOverride = isMapLabelEditorOverrideActive();
	labelMarkers.forEach((entry) => {
		if (shouldShowLabelMarker(entry, zoomLevel, renderBounds, editorOverride) || map.hasLayer(entry.marker)) {
			avesmapsLabelIconRastern(entry, zoomLevel);
		}
		syncLabelMarkerVisibility(entry, zoomLevel, renderBounds, editorOverride);
	});
	scheduleLabelCollisionResolution();
}

function prepareLabelData(data) {
	// 💣 DIE DAUER GEHOERT IN DIE BILANZ, IN BEIDEN ZUSTAENDEN. Sonst vergleicht man zwei Messungen,
	// die verschieden zustande kamen (js/map-features/label-bedarf.js). Live gemessen 26.08.2026:
	// 1.660 ms in einem 2.788 ms langen Stillstand nach dem Start.
	const begonnen = (typeof performance !== "undefined" && typeof performance.now === "function") ? performance.now() : 0;
	labelMarkers.forEach((entry) => map.removeLayer(entry.marker));
	labelData = data.features.filter((feature) => feature.properties?.feature_type === "label").map(normalizeLabelFeature);
	// 🔴 VOLLZAEHLIG UND SOFORT, auch mit `?labelbedarf=1`. Gespart wird das BILD und das
	// POPUP-Markup, nie der Eintrag: `preparePathData` laeuft direkt danach und baut aus genau diesen
	// labelMarkers den Verlinkungs-Index seiner Weg-Popups (routing.js, map-features-path-item-links.js).
	labelMarkers = labelData.map(createLabelMarkerEntry);
	syncLabelVisibility();
	const beendet = (typeof performance !== "undefined" && typeof performance.now === "function") ? performance.now() : 0;
	avesmapsLabelStartFesthalten(labelMarkers.length, beendet - begonnen);
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
	// 💣 DIE ANTWORT DES SCHREIBWEGS KENNT KEINE KURVE. Sie entsteht nur im LESEPFAD
	// (avesmapsCurveApplyToFeatures in api/app/map-features.php); der Editor-Endpunkt gibt das nackte
	// Feature zurueck. Ohne diese zwei Zeilen setzt `Object.assign` `curveLine` auf `null`, der
	// Kurvenriegel greift nicht mehr, der alte waagerechte Marker kommt zurueck -- und zwar bei JEDEM
	// Speichern eines Kurven-Labels. Genau so gemeldet am 23.08.2026 („kommt wieder das waagrechte,
	// alte label", nach dem Erhoehen der Anzahl auf 2).
	// 🔴 Die Kurve haengt an der GEOMETRIE der Flaeche, nicht am Label -- ein Label-Speichern kann sie
	// gar nicht ungueltig machen. Sie zu behalten ist deshalb nicht Notbehelf, sondern richtig.
	// ⚠️ Das AUSschalten laeuft nicht hierueber, sondern ueber avesmapsCurveSettingAufLabelsAnwenden --
	// dort wird sie ausdruecklich entfernt.
	if (label.curveLine === null && Array.isArray(entry.label.curveLine)) {
		label.curveLine = entry.label.curveLine;
		label.curveMax = entry.label.curveMax;
	}
	Object.assign(entry.label, label);
	entry.marker.setLatLng(label.coordinates);
	// Ueber den gemeinsamen Rasterer, damit der Zoom-Merker der Bedarfs-Rasterung mitwandert -- sonst
	// hielte eine gerade gespeicherte Beschriftung ihren Stand fuer aelter, als er ist.
	avesmapsLabelIconRastern(entry, map.getZoom());
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

// 💣 Ein Label wird NICHT ueber deleteLocationMarker geloescht, sondern hier -- und ein als Nodix
// markiertes Label ist ein gueltiger Kraftlinien-Endpunkt (Owner 2026-07-28,
// api/edit/map/powerlines.php:93: „a nodix label was already a valid endpoint"). Ohne die Abfrage
// war dieser Weg ungebremst: Region auf Nodix stellen, Kraftlinie anhaengen, Label loeschen --
// eine frische Waise, lautlos. Der Riegel selbst wohnt bei den Kraftlinien, wo seine Datenquelle
// liegt (map-features-powerlines.js); hier steht nur der Aufruf.
async function deleteLabelEntry(entry, { closeDialog = false } = {}) {
	if (!entry) {
		return;
	}
	if (refusePowerlineAnchoredDeletion(entry.label?.text || "Das Label", entry.label?.publicId || "")) {
		return;
	}
	// 🔴 Das LETZTE Label einer Landschaftsfläche nimmt die Fläche mit (Owner 2026-07-28, serverseitig
	// in avesmapsEcosystemCascadeAfterRemoval). Die Rückfrage muss das sagen, bevor sie es tut -- sie
	// ist die einzige Bremse. Für jedes andere Label bleibt es bei der schlichten Fassung.
	//
	// 🪤 ERST DIE REGIONSLISTEN HOLEN -- dieselbe Zeile, die duplicateLabelEntry und
	// selectEcosystemAreaOfLabel längst tragen; ausgerechnet der eine der drei Wege, der etwas
	// ZERSTÖRT, ging bis zu den Fällen #80/#81 daran vorbei. `ecosystemRegionsByKind` hält im
	// Normalfall nur die AKTIVE Ebene, nach jedem Schreibvorgang sogar nur sie allein, und
	// ausserhalb des Landschaftsmodus gar nichts. Ohne das kennt die Rückfrage weder Namen noch
	// Flächenzahl -- und bei einem Label ohne eigenen Zeiger (die grosse Mehrheit) nicht einmal,
	// DASS eine Fläche daran hängt. Gecacht, also im Regelfall kein Netzverkehr.
	if (typeof loadEcosystemRegions === "function" && typeof ECOSYSTEM_KINDS !== "undefined") {
		await Promise.all(ECOSYSTEM_KINDS.map((kind) => loadEcosystemRegions(kind)));
	}
	const ecoRegion = typeof ecosystemRegionOfLabel === "function" ? ecosystemRegionOfLabel(entry.label) : null;
	const confirmText = typeof formatEcosystemLabelDeleteConfirmation === "function"
		? formatEcosystemLabelDeleteConfirmation(
			entry.label.text,
			ecoRegion,
			typeof ecosystemLabelCountOfRegion === "function" ? ecosystemLabelCountOfRegion(ecoRegion?.public_id) : 0,
			// 💣 `null`, nicht `false`, wenn es den Leser gar nicht gibt: die Rückfrage behandelt „nie
			// gehört" wie „eingeschaltet" und beruhigt nur bei einem ausdrücklichen Nein. Die Kurzform
			// `typeof … === "function" && …()` machte aus einem fehlenden Modul genau so ein
			// ausdrückliches Nein -- und damit aus der Warnung eine Entwarnung.
			typeof isEcosystemCascadeEnabled === "function" ? isEcosystemCascadeEnabled() : null
		)
		: `${entry.label.text} wirklich löschen?`;
	if (!window.confirm(confirmText)) {
		return;
	}

	try {
		const result = await submitMapFeatureEdit({
			action: "delete_feature",
			public_id: entry.label.publicId,
		});
		removeLabelEntryLocally(entry);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		if (closeDialog) {
			setLabelEditDialogOpen(false, { resetForm: true });
		}
		// 🔴 War das das letzte Label seiner Fläche, hat der Server die Region samt Flächen mitgelöscht
		// (avesmapsEcosystemCascadeAfterRemoval). Der Editor erfährt es hier -- eine Fläche, die
		// stillschweigend verschwindet, wäre die schlechteste Art, es zu erfahren.
		if (result?.region_deleted) {
			removeEcosystemCascadedLabels(result);
			if (typeof invalidateEcosystemRegionCache === "function") {
				invalidateEcosystemRegionCache();
			}
			if (typeof scheduleEcosystemAreaReload === "function") {
				scheduleEcosystemAreaReload({ immediate: true });
			}
			const flaechen = Number(result.areas_deleted) || 0;
			showFeedbackToast(
				`Label gelöscht — es war das letzte, also ist die Region mit ${flaechen === 1 ? "ihrer Fläche" : `ihren ${flaechen} Flächen`} mitgegangen.`,
				"success"
			);
			return;
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

// 🔴 Vom Label zur Flaeche. Die Region kennt der Auflöser aus beiden Richtungen; welche ihrer Flaechen
// gemeint ist, entscheidet die Naehe -- eine Region kann mehrere tragen, und das Label sitzt auf einer
// bestimmten davon. Ohne geladene Flaeche passiert nichts: sie kann ausserhalb des Ausschnitts liegen.
//
// 🪤 Die Ebene wechselt MIT. Eine Flaeche der Topographie auszuwaehlen, waehrend die Vegetationsebene
// aktiv ist, hiesse: markiert, aber unanklickbar und ohne Griffe -- die ruhende Ebene nimmt keine Klicks.
async function selectEcosystemAreaOfLabel(label) {
	if (typeof isEcosystemLayerModeActive !== "function" || !isEcosystemLayerModeActive()) {
		return;
	}
	const treffer = await avesmapsEcosystemAreaPublicIdOfLabel(label);
	if (treffer === "" || typeof setSelectedEcosystemArea !== "function") {
		return;
	}
	setSelectedEcosystemArea(treffer);
}

// Welche FLAECHE ist mit diesem Label gemeint -- und die Ansicht steht danach darauf.
//
// 🔴 EIGENE FUNKTION, weil DREI Handgriffe dieselbe Antwort brauchen: die Auswahl beim Label-Klick,
// „Eigenschaften" und „Fläche bearbeiten" im Kachelmenue (Owner 24.08.2026). Zweimal gerechnet waere
// es die Stelle, an der die drei irgendwann auf verschiedene Flaechen zeigen -- eine Region traegt
// mehrere, und welche gemeint ist, entscheidet allein die NAEHE zum Label.
//
// 🪤 Die Ebene wechselt MIT. Eine Flaeche der Topographie auszuwaehlen, waehrend die Vegetationsebene
// aktiv ist, hiesse: markiert, aber unanklickbar und ohne Griffe -- die ruhende Ebene nimmt keine Klicks.
//
// 🔴 UND AUS DEM STANDARDMODUS HERAUS ebenfalls (`wechsleAnsicht`). Dort sind gar keine Flaechen
// geladen (`ecosystemLayers` ist leer), die Naehe-Rechnung fiele also ins Leere. Deshalb erst der
// Wechsel in die Landschaftsansicht, dann `loadEcosystemAreas()` abwarten, dann rechnen. Genau das
// meinte der Owner mit „hier wechselt die ansicht in die landschaft".
//
// @param label            das Label
// @param wechsleAnsicht   true = notfalls in den Landschaftsmodus wechseln und Flaechen nachladen
// @return die public_id der Flaeche, oder "" wenn keine zu finden ist
async function avesmapsEcosystemAreaPublicIdOfLabel(label, { wechsleAnsicht = false } = {}) {
	if (typeof loadEcosystemRegions === "function" && typeof ECOSYSTEM_KINDS !== "undefined") {
		await Promise.all(ECOSYSTEM_KINDS.map((kind) => loadEcosystemRegions(kind)));
	}
	const region = typeof ecosystemRegionOfLabel === "function" ? ecosystemRegionOfLabel(label) : null;
	const regionPublicId = String(region?.public_id || "");
	if (regionPublicId === "") {
		return "";
	}

	// Die Ebene der Region kennt der Auflöser; sie ist die Ansicht, in der ihre Flaechen ueberhaupt
	// liegen. Ohne geladene Regionsliste steht sie nicht da -- dann bleibt es beim Bestand.
	const regionKind = String(region?.kind || "");
	if (wechsleAnsicht && regionKind !== "") {
		if (typeof setActiveEcosystemLayerKind === "function"
			&& (typeof getActiveEcosystemLayerKind !== "function" || getActiveEcosystemLayerKind() !== regionKind)) {
			setActiveEcosystemLayerKind(regionKind);
		}
		// Kind VOR dem Modus, wie im Kontextmenue: der Moduswechsel holt die Flaechen der EINGESTELLTEN
		// Ebene -- andersherum waere es eine Anfrage fuer die alte plus eine Korrektur.
		if (typeof setSelectedMapLayerMode === "function"
			&& (typeof getSelectedMapLayerMode !== "function" || getSelectedMapLayerMode() !== "ecosystem")) {
			setSelectedMapLayerMode("ecosystem");
		}
		if (typeof loadEcosystemAreas === "function") {
			try {
				await loadEcosystemAreas();
			} catch (error) {
				// Die Flaechen fehlen dann eben -- die Pruefung darunter faengt es ab.
			}
		}
	}

	if (typeof ecosystemLayers === "undefined" || !(ecosystemLayers instanceof Map)) {
		return "";
	}
	const punkt = L.latLng(label.coordinates[0], label.coordinates[1]);
	let treffer = "";
	let beste = Infinity;
	ecosystemLayers.forEach((layer, publicId) => {
		const area = layer?._ecosystemArea;
		if (!area || String(area.region_public_id || "") !== regionPublicId) {
			return;
		}
		const mitte = typeof layer.getBounds === "function" ? layer.getBounds().getCenter() : null;
		const abstand = mitte ? punkt.distanceTo(mitte) : Infinity;
		if (abstand < beste) {
			beste = abstand;
			treffer = publicId;
		}
	});
	if (treffer === "") {
		return "";
	}

	const kind = String(ecosystemLayers.get(treffer)?._ecosystemArea?.kind || "");
	if (kind !== "" && typeof setActiveEcosystemLayerKind === "function" && typeof getActiveEcosystemLayerKind === "function"
		&& kind !== getActiveEcosystemLayerKind()) {
		setActiveEcosystemLayerKind(kind);
	}

	return treffer;
}

// „Eigenschaften" und „Fläche bearbeiten" am Label -- beide fuehren auf die FLAECHE, die unter dem
// Namen liegt (Owner 24.08.2026). Sie tun genau das, was die gleichnamigen Eintraege im Kontextmenue
// der Flaeche tun: kein zweiter Weg, sondern derselbe, nur von der Beschriftung aus erreicht.
//
// 💣 Ohne Flaeche sagt es das, statt still zu bleiben. Ein Label ohne Landschaftsflaeche gibt es
// wirklich (freie Labels, Gipfel), und ein Knopf, der nichts tut, sieht aus wie ein Fehler.
async function avesmapsLabelFlaechenHandgriff(label, was) {
	const flaeche = await avesmapsEcosystemAreaPublicIdOfLabel(label, { wechsleAnsicht: true });
	if (flaeche === "") {
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast("Zu dieser Beschriftung ist keine Fläche geladen.", "warning");
		}
		return;
	}
	if (was === "eigenschaften") {
		// Der EINE Zugang zum Dialog -- er ist privat in seiner Datei und wird ueber das Fenster
		// herausgereicht (map-features-ecosystem-properties.js). Ein Nachbau waere die zweite Wahrheit.
		window.AvesmapsEcosystemProperties?.open?.(flaeche);
		return;
	}
	if (typeof openEcosystemGeometryEdit !== "function") {
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast("Der Ecken-Editor ist nicht bereit.", "warning");
		}
		return;
	}
	// 💣 Eine offene Sitzung wird NICHT neu geoeffnet: openEcosystemGeometryEdit schliesst und baut neu
	// auf, und das wirft den Rueckgaengig-Stapel weg. Dieselbe Bremse wie im Kontextmenue.
	if (typeof isEcosystemGeometryEditOpen === "function" && isEcosystemGeometryEditOpen(flaeche)) {
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast("Diese Fläche ist bereits in Bearbeitung — ihre Ecken liegen schon frei.");
		}
		return;
	}
	openEcosystemGeometryEdit(flaeche);
}

// ---- „Position zurücksetzen“: zurück an den Point of Inaccessibility --------------------------
//
// Owner 25.08.2026: „dass es an den point of inaccesiblity zurückverschoben wird“. Das ist genau der
// Punkt, den das Anlegen einer Landschaftsfläche vergibt (createEcosystemRegionLabel,
// map-features-ecosystem-draw.js) -- der mit dem grössten Abstand zu allen Kanten.
//
// Gewacht von js/map-features/__tests__/label-position-zuruecksetzen.test.js: die beiden reinen
// Rechnungen einzeln, die Kachel, die Verdrahtung und der Ablauf mit Attrappen fuer Karte,
// Regionen und Speicherweg.

// Wie weit eine zurückgesetzte Beschriftung ausweicht, wenn dort schon eine andere derselben Fläche
// liegt: 20 px nach unten UND nach rechts, wie beim Duplizieren (Owner 25.08.2026). Layer-Punkte,
// also Bildschirmpixel der aktuellen Zoomstufe -- dieselbe Einheit, in der duplicateLabelEntry
// seinen Versatz misst.
const LABEL_ZURUECK_VERSATZ_PX = 20;

// Der Zielpunkt aus der Geometrie, in Leaflet-Ordnung.
//
// 💣 GeoJSON speichert [x, y], Leaflet L.CRS.Simple will [lat, lng] = [y, x] -- bewusst gedreht
// (AGENTS.md §5). Ein vertauschtes Paar sieht nirgends falsch aus; die Beschriftung landet nur
// woanders auf der Karte.
// 🪤 Der Rückfall ist `null`, nie ein Paar aus NaN: ein NaN reiste bis in `move_label` durch und
// schriebe die Beschriftung ins Nirgendwo -- ohne Fehler und ohne Meldung.
function avesmapsLabelZurueckPoiLatLng(geometry) {
	const punkt = typeof avesmapsComputeLabelPoint === "function" ? avesmapsComputeLabelPoint(geometry) : null;
	if (!punkt || !Number.isFinite(punkt.x) || !Number.isFinite(punkt.y)) {
		return null;
	}

	return { lat: punkt.y, lng: punkt.x };
}

// Der freie Platz am Zielpunkt: er selbst, solange dort keine andere Beschriftung derselben Fläche
// liegt -- sonst je ein Schritt nach rechts unten. Reine Rechnung in Layer-Punkten.
//
// 💣 GEDECKELT, und der Deckel ist gerechnet: auf der Schrittdiagonale (28,3 px Abstand) verdeckt
// ein einzelner belegter Punkt mit seinem 20-px-Radius höchstens ZWEI Kandidaten, also lassen n
// Nachbarn von 2n+1 Kandidaten mindestens einen frei. Ohne den Deckel drehte sich die Schleife im
// Klick-Handler eines Popups endlos -- das ist kein Fehler, das ist ein eingefrorener Browser.
function avesmapsLabelZurueckFreierPunkt(ziel, belegte) {
	const nachbarn = Array.isArray(belegte) ? belegte : [];
	const maxSchritte = nachbarn.length * 2;
	for (let schritt = 0; schritt <= maxSchritte; schritt += 1) {
		const kandidat = {
			x: ziel.x + schritt * LABEL_ZURUECK_VERSATZ_PX,
			y: ziel.y + schritt * LABEL_ZURUECK_VERSATZ_PX,
		};
		const belegt = nachbarn.some((punkt) => Math.hypot(punkt.x - kandidat.x, punkt.y - kandidat.y) < LABEL_ZURUECK_VERSATZ_PX);
		if (!belegt) {
			return kandidat;
		}
	}

	// Unerreichbar nach der Rechnung oben -- ein Rückgabewert gehört trotzdem hin.
	return ziel;
}

// Der Handgriff selbst.
//
// 🔴 DERSELBE WEG ZUR FLÄCHE wie „Eigenschaften“ und „Fläche bearbeiten“
// (avesmapsEcosystemAreaPublicIdOfLabel), samt Ansichtswechsel: im Standardmodus ist die Fläche gar
// nicht geladen, und ohne ihre Geometrie gibt es keinen Punkt zu rechnen. Ein zweiter Weg dorthin
// wäre die zweite Wahrheit.
//
// 🔴 RÜCKFRAGE, SOBALD DIE FLÄCHE MEHR ALS EINE BESCHRIFTUNG TRÄGT (Owner-Entscheid 25.08.2026).
// Fläche↔Label ist 1:N -- der Finsterkamm trägt einen Namen im Norden und einen im Süden. Setzt man
// beide zurück, rücken sie auf denselben Punkt, und die Kollisionsauflösung blendet einen davon aus:
// es sähe aus, als hätte der Knopf nichts getan. Gezählt wird VOR dem Ansichtswechsel, damit die
// Rückfrage vor der Wirkung steht.
async function avesmapsLabelPositionZuruecksetzen(entry) {
	if (!entry) {
		showFeedbackToast("Label konnte nicht gefunden werden.", "warning");
		return;
	}

	// 🪤 Erst die Regionslisten holen -- bei ~124 Bestandslabels steht der Zeiger Label↔Fläche NUR
	// an der Region. Gecacht, also im Regelfall kein Netzverkehr (wie in duplicateLabelEntry).
	if (typeof loadEcosystemRegions === "function" && typeof ECOSYSTEM_KINDS !== "undefined") {
		await Promise.all(ECOSYSTEM_KINDS.map((kind) => loadEcosystemRegions(kind)));
	}
	const region = typeof ecosystemRegionOfLabel === "function" ? ecosystemRegionOfLabel(entry.label) : null;
	const regionPublicId = String(region?.public_id || "");
	const geschwister = regionPublicId !== "" && typeof countEcosystemRegionLabels === "function"
		? countEcosystemRegionLabels(regionPublicId)
		: 0;
	if (geschwister > 1 && !window.confirm(
		`Diese Fläche trägt ${geschwister} Beschriftungen. Zurückgesetzt rücken sie dicht zusammen — je ${LABEL_ZURUECK_VERSATZ_PX} px versetzt. Fortfahren?`
	)) {
		return;
	}

	const flaeche = await avesmapsEcosystemAreaPublicIdOfLabel(entry.label, { wechsleAnsicht: true });
	const geometrie = flaeche !== "" && typeof ecosystemLayers !== "undefined" && ecosystemLayers instanceof Map
		? ecosystemLayers.get(flaeche)?._ecosystemArea?.geometry
		: null;
	const ziel = geometrie ? avesmapsLabelZurueckPoiLatLng(geometrie) : null;
	if (!ziel) {
		showFeedbackToast("Zu dieser Beschriftung ist keine Fläche geladen.", "warning");
		return;
	}

	// Die anderen Beschriftungen derselben Fläche, in Layer-Punkten: der Versatz gilt in PIXELN, nicht
	// in Kartenkoordinaten -- dieselbe Einheit wie beim Duplizieren.
	const belegte = labelData
		.filter((label) => label !== entry.label
			&& String(ecosystemRegionOfLabel(label)?.public_id || "") === regionPublicId)
		.map((label) => map.latLngToLayerPoint(L.latLng(label.coordinates[0], label.coordinates[1])));
	const poiPunkt = map.latLngToLayerPoint(L.latLng(ziel.lat, ziel.lng));
	const frei = avesmapsLabelZurueckFreierPunkt(poiPunkt, belegte);

	// 💣 OHNE AUSWEICHEN GENAU DER GERECHNETE PUNKT, nicht der Rückweg durch die Layer-Punkte:
	// `latLngToLayerPoint` liefert GANZE Pixel. Bei Zoom 4 sind das 1/16 Karteneinheit (live gemessen
	// am Sichelhag: gerechnet 601,2425 | 569,7005, gespeichert 601,25 | 569,6875), bei Zoom 0 aber eine
	// GANZE -- die Beschriftung läge dann sichtbar neben ihrem Punkt, je nachdem, wie weit der Editor
	// gerade herausgezoomt hat. Nur der VERSATZ gehört in Pixel, der Punkt selbst nicht.
	const latlng = frei.x === poiPunkt.x && frei.y === poiPunkt.y
		? L.latLng(ziel.lat, ziel.lng)
		: map.layerPointToLatLng(L.point(frei.x, frei.y));

	// 🪤 Über den GEMEINSAMEN Speicherweg (saveLabelPosition), nicht über einen eigenen Aufruf:
	// Protokoll, Revision und der sofortige Nachzug auf der Karte hängen alle dort. Wie beim Ziehen
	// bleibt die Beschriftung bei einem Fehlschlag am neuen Fleck stehen, bis neu geladen wird.
	entry.marker.setLatLng(latlng);
	await saveLabelPosition(entry);
}

async function duplicateLabelEntry(entry) {
	if (!entry) {
		showFeedbackToast("Label konnte nicht gefunden werden.", "warning");
		return;
	}

	const sourceLatLng = entry.marker.getLatLng();
	// 💣 WEIT GENUG WEG, sonst ist die Kopie unsichtbar. Sie traegt denselben Text, dieselbe Groesse und
	// dieselbe Drehung wie das Original -- 24 px daneben lag ihr Kasten MITTEN im Kasten des Originals,
	// die Kollisionsaufloesung fand keinen freien Platz und blendete sie aus (map-labels.css, is-colliding).
	// Ergebnis: der Editor duplizierte vier Mal und sah kein einziges Mal etwas (Owner 2026-07-28) --
	// angelegt waren alle vier. Ein Versatz um die eigene Hoehe trennt die beiden achsenparallelen
	// Kaesten garantiert; gemessen wird das gedrehte Element, nicht geschaetzt.
	// 🪤 NICHT das Marker-Element messen: das ist ein divIcon mit iconSize [0, 0] und liefert eine Box
	// der Hoehe 0. Der sichtbare, gedrehte Teil ist das <img> darin -- also dieselbe Messung benutzen,
	// mit der die Kollisionsaufloesung selbst rechnet, samt ihrer Polsterung.
	const sourceElement = typeof entry.marker.getElement === "function" ? entry.marker.getElement() : null;
	const sourceBox = sourceElement && typeof measureLabelCollisionRect === "function"
		? measureLabelCollisionRect(sourceElement)
		: null;
	const stepY = sourceBox && sourceBox.height > 0 ? Math.ceil(sourceBox.height) + 8 : 48;
	const duplicateLatLng = map.layerPointToLatLng(map.latLngToLayerPoint(sourceLatLng).add([0, stepY]));

	// Die Flaeche des Originals -- aus beiden Richtungen (Zeiger am Label ODER an der Region). Genau das
	// war der Auftrag: eine grosse Region wie der Finsterkamm soll mehrere Beschriftungen tragen duerfen,
	// im Norden und im Sueden, jede mit eigener Drehung und Lage.
	// 🪤 Erst die Regionslisten holen. Ausserhalb des Landschaftsmodus sind sie leer, und dann faende der
	// Klon weder seine Flaeche noch deren Wiki-Landschaft -- "Label duplizieren" gibt es aber ueberall.
	// Gecacht, also im Regelfall kein Netzverkehr.
	if (typeof loadEcosystemRegions === "function" && typeof ECOSYSTEM_KINDS !== "undefined") {
		await Promise.all(ECOSYSTEM_KINDS.map((kind) => loadEcosystemRegions(kind)));
	}
	const quellRegionZeile = typeof ecosystemRegionOfLabel === "function" ? ecosystemRegionOfLabel(entry.label) : null;
	const quellRegion = String(quellRegionZeile?.public_id || "");

	// 🪤 Der Wiki-Eintrag steht oft NICHT am Label, sondern an seiner Region -- die Infobox zeigt ihn
	// trotzdem, weil sie ihn von dort holt. Ein Klon, der nur `label.wikiRegion` kopiert, kommt deshalb
	// leer heraus, obwohl das Original vollstaendig aussieht (Owner 2026-07-28). Also dieselbe Leiter wie
	// beim Anlegen eines Regionslabels: erst das Label selbst, sonst die Wiki-Landschaft seiner Flaeche.
	let wikiRegion = entry.label.wikiRegion || null;
	if (!wikiRegion && quellRegionZeile?.wiki_region_key && typeof ecosystemWikiRegionSnapshot === "function") {
		wikiRegion = await ecosystemWikiRegionSnapshot(quellRegionZeile.wiki_region_key, quellRegionZeile.wiki_url || "");
	}
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
			// Eine KOPIE, kein neues Label: Sichtbarkeit, Wiki-Landschaft und Zugehoerigkeit reisen mit.
			// Ohne das war die Kopie ein Fremdkoerper -- kein Wiki-Eintrag, keine Flaeche, und damit auch
			// unsichtbar unter "nur Labels mit Region".
			show_name: entry.label.showName !== false,
			...(wikiRegion ? { wiki_region: wikiRegion } : {}),
			...(quellRegion ? { ecosystem_region_public_id: quellRegion } : {}),
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
