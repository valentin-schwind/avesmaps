// EXPERIMENTELL (Test hinter URL-Flag ?canvasmarkers=1; default AUS -> kein Risiko fuer Normalbetrieb).
// Rendert die haeufigen kleinen Orts-Marker (dorf + kleinstadt) in EINEM Canvas-Pass statt als je ein
// DOM-Element -> umgeht Leaflets _onZoomTransitionEnd-Reprojektion (~248ms bei Tiefzoom).
// Metropole/Stadt/Grossstadt/Staette/Kreuzung bleiben DOM; Edit-Modus bleibt komplett DOM.
// Klick: getroffenen Marker temporaer zu DOM "promoten" + dessen Popup oeffnen (Look/Popup 1:1).
// Geometrie/Farbe aus DENSELBEN Funktionen wie die DOM-Marker (eine Quelle der Wahrheit).

const LOCATION_CANVAS_MARKERS_ENABLED = (() => {
	try {
		return new URLSearchParams(window.location.search).has("canvasmarkers");
	} catch (error) {
		return false;
	}
})();

const LOCATION_CANVAS_TYPES = new Set(["dorf", "kleinstadt"]);

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
		this._entries = entries.map((entry) => ({
			entry,
			latLng: entry.marker.getLatLng(),
			core: getLocationMarkerCoreRadius(entry.locationType, zoomLevel),
			fill: entry.locationType === "dorf" ? "#e23b35" : "#cc2f2a",
		}));
		this._canvas.style.visibility = "";
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
		this._canvas.style.visibility = "";
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
		// Waehrend der Zoom-Animation skaliert der Canvas nicht mit -> kurz ausblenden, am zoomend (_reset) neu.
		if (this._ready) {
			this._canvas.style.visibility = "hidden";
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
		const ratio = LOCATION_MARKER_CONTOUR_RATIO;
		const contourMin = LOCATION_MARKER_CONTOUR_MIN;
		const TWO_PI = Math.PI * 2;
		for (const item of this._entries) {
			if (item.entry._canvasPromoted) {
				continue;
			}
			const layerPoint = this._map.latLngToLayerPoint(item.latLng);
			const x = layerPoint.x - origin.x;
			const y = layerPoint.y - origin.y;
			const core = item.core;
			const contour = Math.max(contourMin, core * ratio);
			ctx.beginPath(); ctx.arc(x, y, core + contour + 1, 0, TWO_PI); ctx.fillStyle = "rgba(0, 0, 0, 0.55)"; ctx.fill();
			ctx.beginPath(); ctx.arc(x, y, core + contour, 0, TWO_PI); ctx.fillStyle = "#ffffff"; ctx.fill();
			ctx.beginPath(); ctx.arc(x, y, core, 0, TWO_PI); ctx.fillStyle = item.fill; ctx.fill();
		}
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
