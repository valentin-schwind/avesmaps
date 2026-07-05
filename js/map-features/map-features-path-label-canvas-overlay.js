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

	// Kanal A (Way-Labels): wiki-zugewiesene Wege werden als Ganzes beschriftet (Endpunkt-Verkettung
	// über Segmente, Label alle ~WAY_LABEL_SCREEN_INTERVAL_PX Bildschirm-Pixel) statt pro Segment.
	// Escape-Hatch: ?waylabels=0 schaltet zurück auf reines Kanal-B-Verhalten (auch für zugewiesene
	// Wege -- alte per-Segment/show_label-Logik, wie vor diesem Feature).
	const wayLabelsEnabled = (() => {
		try { return new URLSearchParams(window.location.search).get("waylabels") !== "0"; } catch (e) { return true; }
	})();
	// Ziel-Bildschirm-Abstand (px) zwischen zwei Way-Label-Wiederholungen entlang einer Kette; tunbar
	// via ?waylabelinterval=NNN für Live-Vergleich ohne Deploy.
	const WAY_LABEL_SCREEN_INTERVAL_PX = (() => {
		try {
			const raw = new URLSearchParams(window.location.search).get("waylabelinterval");
			const parsed = Number(raw);
			return Number.isFinite(parsed) && parsed > 0 ? parsed : 600;
		} catch (e) { return 600; }
	})();

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
				ctx.shadowBlur = halo.blur * (window.devicePixelRatio || 1); // shadowBlur zählt in Geräte-Pixeln -> mit dpr nachziehen

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
		// HiDPI: Backing-Store in Geräte-Pixeln, CSS-Größe in Layout-Pixeln -> scharf auf Retina/Mobile (dpr 2–3),
		// unverändert auf Standard-Desktop (dpr 1). Gezeichnet wird weiter in CSS-px (ctx ist mit dpr skaliert).
		const dpr = window.devicePixelRatio || 1;
		const pw = Math.round(size.x * dpr), ph = Math.round(size.y * dpr);
		if (canvas.width !== pw) canvas.width = pw;
		if (canvas.height !== ph) canvas.height = ph;
		if (canvas.style.width !== size.x + "px") canvas.style.width = size.x + "px";
		if (canvas.style.height !== size.y + "px") canvas.style.height = size.y + "px";
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		if (typeof pathData === "undefined" || !Array.isArray(pathData) || !pathData.length) {
			return;
		}
		if (typeof isPathLabelVisibleAtCurrentZoom !== "function" || typeof getPathLabelVisualLatLngCoordinates !== "function") {
			return;
		}
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		pathData.forEach((path) => {
			// Kanal B: wiki-zugewiesene Wege werden jetzt als Ganzes über Kanal A beschriftet (unten) --
			// show_label wird für sie ignoriert (kein Doppel-Label). Unzugewiesene Segmente bleiben
			// unverändert beim bisherigen per-Segment-Verhalten.
			if (wayLabelsEnabled && path?.properties?.wiki_path?.wiki_key) {
				return;
			}
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

		// Kanal A: wiki-zugewiesene Wege als GANZES beschriften (Endpunkt-Verkettung über Segmente,
		// Label alle ~WAY_LABEL_SCREEN_INTERVAL_PX Bildschirm-Pixel entlang jeder Kette). show_label wird
		// hier bewusst ignoriert (siehe Kanal-B-Skip oben). Escape: ?waylabels=0.
		if (wayLabelsEnabled
			&& typeof isWayLabelEligible === "function"
			&& typeof buildWayLabelChains === "function"
			&& typeof computeWayLabelIntervalOffsets === "function"
			&& typeof getPathGeomBounds === "function") {
			const viewportBounds = map.getBounds().pad(0.25); // gleiches Polster wie currentPathVisibilityContext()
			// PERF: einmal pro Redraw statt einmal pro Pfad (siehe buildWayLabelEligibilityContext).
			const wayLabelEligibilityCtx = typeof buildWayLabelEligibilityContext === "function"
				? buildWayLabelEligibilityContext()
				: {};
			const wayGroups = new Map(); // wiki_key -> { name, pathsById: Map<public_id, path> }
			pathData.forEach((path) => {
				if (!isWayLabelEligible(path, wayLabelEligibilityCtx)) {
					return;
				}
				const geomBounds = getPathGeomBounds(path);
				if (!geomBounds || !viewportBounds.intersects(geomBounds)) {
					return;
				}
				const wikiKey = path.properties.wiki_path.wiki_key;
				if (!wayGroups.has(wikiKey)) {
					const wikiName = String(path.properties.wiki_path.name || "").trim();
					wayGroups.set(wikiKey, { name: wikiName || getPathDisplayName(path), pathsById: new Map() });
				}
				const publicId = path.properties?.public_id || path.id;
				wayGroups.get(wikiKey).pathsById.set(publicId, path);
			});

			const acceptedWayLabelBoxes = []; // Selbstkollision: {x1,y1,x2,y2} bereits platzierter Way-Labels
			const boxesOverlap = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

			wayGroups.forEach((group) => {
				const segments = Array.from(group.pathsById.values()).map((p) => ({
					id: p.properties?.public_id || p.id,
					coordinates: p.geometry.coordinates,
				}));
				const chains = buildWayLabelChains(segments);
				chains.forEach((chain) => {
					// Kette zur geglätteten Bildschirm-Polyline zusammensetzen: pro Eintrag die (geglättete)
					// Label-Leitlinie desselben Helfers wie Kanal B, bei reversed umgedreht, dieselbe
					// Projektion (map.latLngToContainerPoint) wie im per-Segment-Zweig oben; doppelte
					// Gelenkpunkte zwischen Segmenten werden übersprungen.
					let pts = [];
					chain.forEach((entry) => {
						const path = group.pathsById.get(entry.id);
						let latlngs = getPathLabelVisualLatLngCoordinates(path.geometry.coordinates);
						if (!Array.isArray(latlngs) || latlngs.length < 2) {
							return;
						}
						if (entry.reversed) {
							latlngs = latlngs.slice().reverse();
						}
						const segPts = latlngs.map(([lat, lng]) => map.latLngToContainerPoint(L.latLng(lat, lng)));
						if (pts.length && segPts.length) {
							// Ersten Punkt nur dann überspringen, wenn er den vorigen Kettenpunkt WIRKLICH
							// dupliziert (exakt/gerundet geteilter Gelenkpunkt, <= 1.5px). An Phase-2-
							// verbrückten Ortsstoß-Lücken (bis ~7 Karteneinheiten ≈ ~112px bei Zoom 4) ist
							// er ein echter Stützpunkt und muss erhalten bleiben.
							const prevPt = pts[pts.length - 1];
							const firstPt = segPts[0];
							const isDuplicateJoint = Math.hypot(firstPt.x - prevPt.x, firstPt.y - prevPt.y) <= 1.5;
							pts.push(...(isDuplicateJoint ? segPts.slice(1) : segPts));
						} else {
							pts.push(...segPts);
						}
					});
					if (pts.length < 2) {
						return;
					}
					// Lesbarkeit: ganze Kette links -> rechts (wie beim per-Segment-Zweig, nur auf Kettenebene).
					if (pts[pts.length - 1].x < pts[0].x) {
						pts = pts.slice().reverse();
					}

					const firstPath = group.pathsById.get(chain[0].id);
					const subtype = normalizePathSubtype(firstPath.properties?.feature_subtype || firstPath.properties?.name);
					const isRiver = subtype === "Flussweg" || subtype === "Seeweg";
					const style = getPathLabelStyle(firstPath);
					const fontSize = parseFloat(style.fontSize) || 11;
					const ls = parseFloat(style.letterSpacing) || 0;

					const cumAtPts = [0]; // kumulierte Distanz je Punkt in pts (einmal pro Kette berechnet)
					for (let i = 1; i < pts.length; i += 1) {
						cumAtPts.push(cumAtPts[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
					}
					const totalLen = cumAtPts[cumAtPts.length - 1];
					if (totalLen < 1) {
						return;
					}

					ctx.font = `${style.fontWeight || "400"} ${fontSize}px ${style.fontFamily}`;
					const chars = [...group.name];
					const widths = chars.map((c) => ctx.measureText(c).width);
					const textLen = widths.reduce((s, w) => s + w + ls, 0) - ls;

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
					const perp = -(typeof PATH_LABEL_DY !== "undefined" ? PATH_LABEL_DY : 0);

					// Punkt bei kumulierter Distanz `d` entlang der (bereits projizierten) Kettenpunkte pts
					// interpolieren -- Grundlage sowohl fürs Fenster-Slicing als auch die Kollisions-BBox.
					const sampleAt = (d) => {
						let remaining = Math.max(0, Math.min(d, totalLen));
						for (let i = 1; i < pts.length; i += 1) {
							const segLen = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
							if (remaining <= segLen || i === pts.length - 1) {
								const t = segLen > 0 ? remaining / (segLen || 1) : 0;
								return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
							}
							remaining -= segLen;
						}
						return pts[0];
					};

					const offsets = computeWayLabelIntervalOffsets(totalLen, WAY_LABEL_SCREEN_INTERVAL_PX, textLen);
					offsets.forEach((centerOffset) => {
						const halfWindow = textLen / 2 + 4; // etwas Luft über die reine Textbreite hinaus
						const windowStart = Math.max(0, centerOffset - halfWindow);
						const windowEnd = Math.min(totalLen, centerOffset + halfWindow);
						// drawGlyphsAlong zentriert IMMER auf dem übergebenen Punkte-Array (dist = (total-textLen)/2)
						// -- für mehrere Platzierungen entlang derselben Kette wird deshalb, wie beim per-Segment-
						// Zweig, ein Fenster (Sub-Polyline) um den Ziel-Offset ausgeschnitten und UNVERÄNDERT mit
						// derselben Signatur an drawGlyphsAlong übergeben (kein neuer Parameter erfunden).
						const windowPts = [sampleAt(windowStart)];
						for (let i = 0; i < pts.length; i += 1) {
							// Zwischenpunkte der Original-Polyline im Fenster mit übernehmen, damit Kurven
							// (nicht nur Start/Ende) erhalten bleiben.
							if (cumAtPts[i] > windowStart && cumAtPts[i] < windowEnd) {
								windowPts.push(pts[i]);
							}
						}
						windowPts.push(sampleAt(windowEnd));
						if (windowPts.length < 2) {
							return;
						}
						// Selbstkollision: BBox aus Fenster-Start/-Mitte/-Ende ± Schriftgröße (nur Kanal-A-Labels
						// nehmen daran teil).
						const mid = sampleAt(centerOffset);
						const pad = fontSize;
						const xs = [windowPts[0].x, mid.x, windowPts[windowPts.length - 1].x];
						const ys = [windowPts[0].y, mid.y, windowPts[windowPts.length - 1].y];
						const box = {
							x1: Math.min(...xs) - pad, y1: Math.min(...ys) - pad,
							x2: Math.max(...xs) + pad, y2: Math.max(...ys) + pad,
						};
						if (acceptedWayLabelBoxes.some((accepted) => boxesOverlap(accepted, box))) {
							return;
						}
						acceptedWayLabelBoxes.push(box);
						drawGlyphsAlong(windowPts, chars, widths, ls, halo, style.fill, perp);
					});
				});
			});
		}

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
