// Pfad-Namen (Flüsse/Straßen) auf einem Canvas-Overlay zeichnen — wie die übrigen Karten-/Grenz-Namen, statt
// als SVG-<textPath>. Glyph-für-Glyph entlang der (geglätteten) Label-Linie, tangential rotiert; Halo per
// Stärke/Schärfe (weicher Canvas-Schatten <-> scharfe Kontur), identisch zur Siedlungs-/Regionen-Label-Optik.
// Sicherheitsnetz: ?canvaspathlabels=0 schaltet zurück auf die alte SVG-Variante (dann ist dieses Overlay aus).
(function initPathLabelCanvasOverlay() {
	const PANE = "avesmapsPathLabelCanvasPane";

	function canvasEnabled() {
		return typeof PATH_LABELS_ON_CANVAS === "undefined" ? true : !!PATH_LABELS_ON_CANVAS;
	}
	function ready() {
		return typeof map !== "undefined" && map && typeof map.createPane === "function" && typeof L !== "undefined";
	}
	if (!ready()) {
		window.setTimeout(initPathLabelCanvasOverlay, 50);
		return;
	}
	if (!canvasEnabled()) {
		return; // SVG-Fallback aktiv -> kein Canvas-Overlay
	}

	if (!map.getPane(PANE)) {
		map.createPane(PANE);
		const pane = map.getPane(PANE);
		pane.style.zIndex = 640;           // über Wegen/Markern, unter den Orts-/Regionen-Namen (labelsPane 650)
		pane.style.pointerEvents = "none"; // nicht-interaktiv
	}

	const canvas = document.createElement("canvas");
	canvas.style.position = "absolute";
	canvas.style.pointerEvents = "none";
	canvas.style.top = "0";
	canvas.style.left = "0";
	canvas.style.transformOrigin = "0 0";
	canvas.classList.add("leaflet-zoom-animated"); // weiches Mitskalieren während der CSS-Zoom-Animation
	map.getPane(PANE).appendChild(canvas);
	const ctx = canvas.getContext("2d");
	let canvasTopLeftLatLng = null;

	// Glyphen einzeln entlang der Pixel-Polyline platzieren (zentriert auf dem jeweiligen Slot, tangential
	// rotiert). textAlign/textBaseline werden in redraw() gesetzt; Halo = weicher Schatten + scharfe Kontur.
	function drawGlyphsAlong(pts, chars, widths, ls, halo, fillColor, perpOffset) {
		if (perpOffset) {
			// Alle Punkte senkrecht zur Linie verschieben (positiv = „oben"/über der Linie für links->rechts).
			const shifted = [];
			for (let i = 0; i < pts.length; i += 1) {
				const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
				let tx = b.x - a.x, ty = b.y - a.y; const tm = Math.hypot(tx, ty) || 1; tx /= tm; ty /= tm;
				shifted.push({ x: pts[i].x + ty * perpOffset, y: pts[i].y - tx * perpOffset });
			}
			pts = shifted;
		}
		const seg = [];
		let total = 0;
		for (let i = 1; i < pts.length; i += 1) {
			const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
			seg.push({ cum: total, len: d, a: pts[i - 1], b: pts[i] });
			total += d;
		}
		if (!seg.length) {
			return;
		}
		const textLen = widths.reduce((s, w) => s + w + ls, 0) - ls;
		if (textLen > total) {
			return; // Linie zu kurz für den Namen
		}
		let dist = (total - textLen) / 2;
		const at = (d) => {
			for (const s of seg) {
				if (d <= s.cum + s.len) {
					const t = (d - s.cum) / (s.len || 1);
					return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t, ang: Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) };
				}
			}
			const l = seg[seg.length - 1];
			return { x: l.b.x, y: l.b.y, ang: Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x) };
		};
		for (let i = 0; i < chars.length; i += 1) {
			const w = widths[i];
			const p = at(dist + w / 2);
			ctx.save();
			ctx.translate(p.x, p.y);
			ctx.rotate(p.ang);
			if (halo.glow && halo.blur > 0.01) {
				ctx.save();
				ctx.shadowColor = halo.glow;
				ctx.shadowBlur = halo.blur;
				ctx.fillStyle = halo.glow;
				ctx.fillText(chars[i], 0, 0);
				ctx.restore();
			}
			if (halo.glow && halo.strokeW > 0.01) {
				ctx.lineJoin = "round";
				ctx.lineCap = "round";
				ctx.strokeStyle = halo.glow;
				ctx.lineWidth = halo.strokeW;
				ctx.strokeText(chars[i], 0, 0);
			}
			ctx.fillStyle = fillColor;
			ctx.fillText(chars[i], 0, 0);
			ctx.restore();
			dist += w + ls;
		}
	}

	function redraw() {
		if (!canvasEnabled() || !map.getPane(PANE) || cssZoomActive) {
			return;
		}
		const size = map.getSize();
		const topLeft = map.containerPointToLayerPoint([0, 0]);
		L.DomUtil.setPosition(canvas, topLeft);
		canvasTopLeftLatLng = map.containerPointToLatLng([0, 0]);
		if (canvas.width !== size.x) canvas.width = size.x;
		if (canvas.height !== size.y) canvas.height = size.y;
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		if (typeof pathData === "undefined" || !Array.isArray(pathData) || !pathData.length) {
			return;
		}
		if (typeof isPathLabelVisibleAtCurrentZoom !== "function" || typeof getPathLabelVisualLatLngCoordinates !== "function") {
			return;
		}
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		pathData.forEach((path) => {
			if (!isPathLabelVisibleAtCurrentZoom(path)) {
				return;
			}
			const name = getPathDisplayName(path);
			if (!name) {
				return;
			}
			const subtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
			const isRiver = subtype === "Flussweg" || subtype === "Seeweg";
			const style = getPathLabelStyle(path);
			const fontSize = parseFloat(style.fontSize) || 11;
			const ls = parseFloat(style.letterSpacing) || 0;

			const latlngs = getPathLabelVisualLatLngCoordinates(path.geometry.coordinates);
			if (!Array.isArray(latlngs) || latlngs.length < 2) {
				return;
			}
			let pts = latlngs.map(([lat, lng]) => map.latLngToContainerPoint(L.latLng(lat, lng)));
			// Off-Screen-Cull über die Bounding-Box der projizierten Punkte (mit Halo-/Schrift-Reserve).
			let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
			for (let i = 0; i < pts.length; i += 1) {
				if (pts[i].x < bx1) bx1 = pts[i].x;
				if (pts[i].x > bx2) bx2 = pts[i].x;
				if (pts[i].y < by1) by1 = pts[i].y;
				if (pts[i].y > by2) by2 = pts[i].y;
			}
			const m = fontSize + 8;
			if (bx2 < -m || bx1 > size.x + m || by2 < -m || by1 > size.y + m) {
				return;
			}
			// Lesbarkeit: Text immer links -> rechts.
			if (pts[pts.length - 1].x < pts[0].x) {
				pts = pts.slice().reverse();
			}
			ctx.font = `${style.fontWeight || "400"} ${fontSize}px ${style.fontFamily}`;
			const chars = [...name];
			const widths = chars.map((c) => ctx.measureText(c).width);
			let halo = { glow: null, blur: 0, strokeW: 0 };
			if (typeof getLabelHaloParams === "function") {
				const hp = getLabelHaloParams(
					isRiver ? PATH_LABEL_RIVER_HALO_STRENGTH : PATH_LABEL_ROAD_HALO_STRENGTH,
					isRiver ? PATH_LABEL_RIVER_HALO_SHARPNESS : PATH_LABEL_ROAD_HALO_SHARPNESS
				);
				if (hp.glow) {
					halo = { glow: hp.glow, blur: fontSize * (hp.glowBlurRatio || 0), strokeW: fontSize * (hp.strokeRatio || 0) };
				}
			}
			// dy-Slider (?pathtune=1): senkrechter Versatz; SVG-dy negativ = oben -> perpOffset = -dy.
			const perp = -(typeof PATH_LABEL_DY !== "undefined" ? PATH_LABEL_DY : 0);
			drawGlyphsAlong(pts, chars, widths, ls, halo, style.fill, perp);
		});

		// Kraftlinien-Namen -- nur im Modus „Kraftlinien". Text liegt auf der (geraden) Mittellinie, leicht
		// darüber versetzt (wie früher SVG-dy -10), mit dezentem weichem Halo für Lesbarkeit.
		if (typeof getSelectedMapLayerMode === "function" && getSelectedMapLayerMode() === "powerlines"
			&& typeof powerlineData !== "undefined" && Array.isArray(powerlineData) && powerlineData.length
			&& typeof isPowerlineLabelVisibleAtCurrentZoom === "function" && typeof getPowerlineLatLngs === "function") {
			powerlineData.forEach((powerline) => {
				if (!isPowerlineLabelVisibleAtCurrentZoom(powerline)) {
					return;
				}
				const name = typeof getPowerlineDisplayName === "function" ? getPowerlineDisplayName(powerline) : "";
				if (!name) {
					return;
				}
				const style = typeof getPowerlineLabelStyle === "function" ? getPowerlineLabelStyle() : null;
				const fontSize = style ? (parseFloat(style.fontSize) || 18) : 18;
				const ls = style ? (parseFloat(style.letterSpacing) || 0) : 0;
				const ll = getPowerlineLatLngs(powerline);
				if (!Array.isArray(ll) || ll.length < 2) {
					return;
				}
				let pts = ll.map((p) => map.latLngToContainerPoint(p));
				let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
				for (let i = 0; i < pts.length; i += 1) {
					if (pts[i].x < bx1) bx1 = pts[i].x;
					if (pts[i].x > bx2) bx2 = pts[i].x;
					if (pts[i].y < by1) by1 = pts[i].y;
					if (pts[i].y > by2) by2 = pts[i].y;
				}
				const mm = fontSize + 16;
				if (bx2 < -mm || bx1 > size.x + mm || by2 < -mm || by1 > size.y + mm) {
					return;
				}
				if (pts[pts.length - 1].x < pts[0].x) {
					pts = pts.slice().reverse();
				}
				ctx.font = `${(style && style.fontWeight) || "500"} ${fontSize}px ${(style && style.fontFamily) || '"Faculty Glyphic", Georgia, serif'}`;
				const chars = [...name];
				const widths = chars.map((c) => ctx.measureText(c).width);
				const halo = { glow: "rgba(0, 0, 0, 0.5)", blur: fontSize * 0.14, strokeW: 0 };
				drawGlyphsAlong(pts, chars, widths, ls, halo, (style && style.fill) || "rgba(255, 196, 214, 0.98)", 10);
			});
		}
	}

	// Zoom-Animation wie beim Grenzen-Overlay: CSS-Zoom -> Canvas weich mitskalieren (nicht neu zeichnen);
	// flyTo/setView (kein zoomanim) -> pro Frame neu zeichnen.
	let cssZoomActive = false;
	map.on("moveend zoomend viewreset resize", () => {
		cssZoomActive = false;
		canvas.style.transition = "";
		redraw();
	});
	map.on("zoomanim", function (event) {
		if (!canvasTopLeftLatLng || typeof map._latLngToNewLayerPoint !== "function") {
			return;
		}
		cssZoomActive = true;
		canvas.style.transition = "transform 250ms cubic-bezier(0,0,0.25,1)";
		const scale = map.getZoomScale(event.zoom);
		const offset = map._latLngToNewLayerPoint(canvasTopLeftLatLng, event.zoom, event.center);
		L.DomUtil.setTransform(canvas, offset, scale);
	});
	map.on("zoom", function () { if (!cssZoomActive) redraw(); });

	window.AvesmapsPathLabelCanvasOverlay = { redraw, paneName: PANE };
	// Erst-/Nachzieh-Redraws, falls die Pfad-Daten erst nach Overlay-Init geladen werden.
	[120, 400, 1000].forEach((delay) => window.setTimeout(redraw, delay));
	// Sobald die App-Schrift (Faculty Glyphic) geladen ist, neu zeichnen -> kein Fallback-Font beim Erst-Paint.
	if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === "function") {
		document.fonts.ready.then(redraw).catch(() => { /* noop */ });
	}
})();
