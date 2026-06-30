// Rendert ALLE Orts-Marker (alle sechs Typen) in EINEM Canvas-Pass statt als je ein DOM-Element ->
// umgeht Leaflets teure _onZoomTransitionEnd-Reprojektion pro Marker. GEMESSEN 2026-06-09: senkt den
// Zoom-Freeze bei Tiefzoom spuerbar (z.B. ~440-613ms -> ~346ms beim Umschalten von ~535 Markern auf Canvas;
// Marker-Reprojektion dominiert, NICHT die Labels [~3ms]). DEFAULT AN; per ?canvasmarkers=0 abschaltbar.
// Edit-Modus bleibt komplett DOM (syncLocationMarkerVisibility: canvasOn = ... && !IS_EDIT_MODE), ebenso
// temporaer angepinnte/Routen-Wegpunkt-Marker. Klick: getroffenen Marker zu DOM "promoten" + Popup oeffnen.
// Formen/Farben/Groessen aus DENSELBEN Funktionen wie die DOM-Marker (eine Quelle der Wahrheit):
// Kreis-Familie (#cc2f2a), Staette = violette Raute (#7a4fd0), Metropole = Gold-Akzentring (#e7b04a),
// weisse Kontur + 1px-Dunkel-Hairline rgba(0,0,0,.55) -- 1:1 zu css/features/location-popups-markers.css.

const LOCATION_CANVAS_MARKERS_ENABLED = (() => {
	try {
		return new URLSearchParams(window.location.search).get("canvasmarkers") !== "0";
	} catch (error) {
		return true;
	}
})();

const LOCATION_CANVAS_TYPES = new Set(["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"]);

const locationCanvasLayer = {
	_map: null,
	_canvas: null,
	_ctx: null,
	_entries: [],
	_ready: false,

	init(map) {
		if (this._ready || !LOCATION_CANVAS_MARKERS_ENABLED) {
			return;
		}
		this._map = map;
		if (!map.getPane("locationCanvasPane")) {
			map.createPane("locationCanvasPane");
			const locationsPane = map.getPane("locationsPane");
			const baseZ = locationsPane ? (parseInt(window.getComputedStyle(locationsPane).zIndex, 10) || 600) : 600;
			const pane = map.getPane("locationCanvasPane");
			pane.style.zIndex = String(baseZ - 1); // DOM-Marker (Metropole etc.) liegen drueber
			pane.style.pointerEvents = "none";      // Klicks gehen an die Karte -> Hit-Test in _onClick
		}
		this._canvas = L.DomUtil.create("canvas", "location-canvas-layer", map.getPane("locationCanvasPane"));
		this._canvas.style.position = "absolute";
		this._canvas.style.top = "0";
		this._canvas.style.left = "0";
		this._ctx = this._canvas.getContext("2d");
		map.on("moveend zoomend viewreset resize", this._reset, this);
		map.on("move", this._onMove, this);
		map.on("zoomstart", this._onZoomStart, this);
		map.on("click", this._onClick, this);
		this._reset();
		this._ready = true;
	},

	setEntries(entries) {
		if (!this._ready) {
			return;
		}
		const zoomLevel = this._map.getZoom();
		const visualZoom = getVisualZoomLevel(zoomLevel);
		const inPowerlineMode = typeof getSelectedMapLayerMode === "function" && getSelectedMapLayerMode() === "powerlines";
		this._entries = entries.map((entry) => {
			const locationType = entry.locationType;
			const isSite = locationType === "gebaeude";
			const markerSize = getLocationMarkerSize(locationType, zoomLevel);
			const core = getLocationMarkerCoreRadius(locationType, zoomLevel);
			const contour = getLocationMarkerBorderWidth(locationType, zoomLevel);
			// Form/Sichtbarkeit der Sonderformen EXAKT wie createLocationMarkerIcon (eine Quelle der Wahrheit):
			const isDiamond = isSite && visualZoom >= 4;
			const isCapital = locationType === "metropole" && visualZoom >= 3 && markerSize >= 14;
			// Kraftlinien-Modus: Nodices als leuchtende „Ley-Knoten" zeichnen (heben sich von den Linien ab).
			const leyNode = inPowerlineMode && !!(entry.location && entry.location.isNodix);
			return {
				entry,
				latLng: entry.marker.getLatLng(),
				core,
				contour,
				isDiamond,
				isCapital,
				accentRing: isCapital ? Math.round(markerSize * 0.12) : 0,
				fill: isSite ? "#7a4fd0" : "#cc2f2a",
				leyNode,
				leyR: leyNode ? Math.max(5, (core + contour) * 1.7) : 0,
			};
		});
		this._canvas.style.transition = "opacity 200ms ease-in";
		this._canvas.style.opacity = "1";
		this._redraw();
	},

	_reset() {
		if (!this._ready) {
			return;
		}
		const size = this._map.getSize();
		const dpr = window.devicePixelRatio || 1;
		L.DomUtil.setPosition(this._canvas, this._map.containerPointToLayerPoint([0, 0]).round());
		this._canvas.width = Math.round(size.x * dpr);
		this._canvas.height = Math.round(size.y * dpr);
		this._canvas.style.width = `${size.x}px`;
		this._canvas.style.height = `${size.y}px`;
		this._canvas.style.transition = "opacity 200ms ease-in";
		this._canvas.style.opacity = "1";
		this._redraw();
	},

	_onMove() {
		if (!this._ready) {
			return;
		}
		L.DomUtil.setPosition(this._canvas, this._map.containerPointToLayerPoint([0, 0]).round());
		this._redraw();
	},

	_onZoomStart() {
		// Der Canvas skaliert waehrend der Zoom-Animation nicht mit (feste Marker-Pixelgroessen) -> weich
		// AUSfaden statt hart ausblenden; am zoomend (_reset) frisch zeichnen und weich EINfaden. Das gleicht
		// das harte "Plopp" gegen die mitskalierenden Tiles/Grenzen aus.
		if (this._ready) {
			this._canvas.style.transition = "opacity 100ms ease-out";
			this._canvas.style.opacity = "0";
		}
	},

	_redraw() {
		if (!this._ready) {
			return;
		}
		const ctx = this._ctx;
		const dpr = window.devicePixelRatio || 1;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		// Gerundeter Ursprung = exakt die (auf ganze Pixel gerundete) Canvas-Position -> kein Sub-Pixel-Versatz,
		// scharf auf Retina (fraktionales transform verwischt sonst).
		const origin = this._map.containerPointToLayerPoint([0, 0]).round();
		const TWO_PI = Math.PI * 2;
		const disc = (x, y, r, color) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TWO_PI); ctx.fillStyle = color; ctx.fill(); };
		for (const item of this._entries) {
			if (item.entry._canvasPromoted) {
				continue;
			}
			const layerPoint = this._map.latLngToLayerPoint(item.latLng);
			const x = layerPoint.x - origin.x;
			const y = layerPoint.y - origin.y;
			if (item.leyNode) {
				// Leuchtender Kraftlinien-Knoten: weicher Schein -> heller Kern -> pinker Punkt.
				ctx.save();
				ctx.shadowColor = "#ff7da0";
				ctx.shadowBlur = 16;
				disc(x, y, item.leyR, "#fff3f7");
				ctx.shadowBlur = 8;
				disc(x, y, item.leyR * 0.92, "#ffd3e0");
				ctx.restore();
				disc(x, y, Math.max(1.5, item.leyR * 0.42), "#ff3d68");
				continue;
			}
			const core = item.core;
			const outer = core + item.contour; // = Aussenkante der weissen Kontur (markerSize/2)
			if (item.isDiamond) {
				// Besondere Staette: gedrehtes Quadrat (Raute) -- Hairline -> weisse Kontur -> Fuellung.
				this._square(x, y, outer + 1, "rgba(0, 0, 0, 0.55)");
				this._square(x, y, outer, "#ffffff");
				this._square(x, y, core, item.fill);
				continue;
			}
			if (item.isCapital) {
				// Metropole: 1px-Dunkel -> Gold-Band -> 1px-Dunkel (1:1 zum --capital box-shadow-Stapel).
				disc(x, y, outer + item.accentRing + 1, "rgba(0, 0, 0, 0.35)");
				disc(x, y, outer + item.accentRing, "#e7b04a");
			}
			disc(x, y, outer + 1, "rgba(0, 0, 0, 0.55)");
			disc(x, y, outer, "#ffffff");
			disc(x, y, core, item.fill);
		}
	},

	_square(centerX, centerY, half, color) {
		const ctx = this._ctx;
		ctx.save();
		ctx.translate(centerX, centerY);
		ctx.rotate(Math.PI / 4);
		ctx.fillStyle = color;
		ctx.fillRect(-half, -half, half * 2, half * 2);
		ctx.restore();
	},

	_onClick(event) {
		if (!this._ready || !this._entries.length) {
			return;
		}
		const point = event.containerPoint;
		let hit = null;
		let hitDistance = Infinity;
		for (const item of this._entries) {
			if (item.entry._canvasPromoted) {
				continue;
			}
			const containerPoint = this._map.latLngToContainerPoint(item.latLng);
			const distance = Math.hypot(containerPoint.x - point.x, containerPoint.y - point.y);
			const hitRadius = item.core * (1 + LOCATION_MARKER_CONTOUR_RATIO) + 3;
			if (distance <= hitRadius && distance < hitDistance) {
				hit = item;
				hitDistance = distance;
			}
		}
		if (!hit) {
			return;
		}
		const entry = hit.entry;
		entry._canvasPromoted = true;
		this._redraw();
		// The DOM marker's icon may be stale -- it was set at the creation zoom and never updated while
		// the marker lived on the canvas overlay. Refresh it to the CURRENT zoom so the promoted marker
		// matches the canvas dot instead of rendering tiny.
		const promotedZoomLevel = this._map.getZoom();
		if (entry.iconZoomLevel !== promotedZoomLevel) {
			entry.marker.setIcon(createLocationMarkerIcon(entry.locationType, promotedZoomLevel));
			entry.iconZoomLevel = promotedZoomLevel;
		}
		if (!this._map.hasLayer(entry.marker)) {
			this._map.addLayer(entry.marker);
		}
		entry.marker.once("popupclose", () => {
			entry._canvasPromoted = false;
			if (this._map.hasLayer(entry.marker)) {
				this._map.removeLayer(entry.marker);
			}
			this._redraw();
		});
		entry.marker.openPopup();
	},
};
