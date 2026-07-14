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

// Active/clicked settlement highlight (Owner: the active location's marker fills gold-yellow). The
// active id lives in runtime-state (activeLocationPublicId). These helpers set/clear it, repaint the
// canvas, and toggle a DOM-marker class so BOTH render paths follow. Reading the token (not a hardcode)
// keeps it theme-correct.
function getLocationMarkerActiveColor() {
	try {
		return getComputedStyle(document.documentElement).getPropertyValue("--color-marker-active").trim() || "#f0b429";
	} catch (error) {
		return "#f0b429";
	}
}

// DOM markers (edit mode / promoted / temporarily pinned) turn gold via CSS; canvas dots are handled in
// _redraw. Move the class to the currently-active marker (or remove it everywhere when nothing active).
function applyActiveLocationMarkerClass() {
	document.querySelectorAll(".location-visual-marker--active")
		.forEach((el) => el.classList.remove("location-visual-marker--active"));
	if (!activeLocationPublicId || typeof locationMarkers === "undefined") {
		return;
	}
	const entry = locationMarkers.find((m) => m && m.publicId === activeLocationPublicId);
	const el = entry && entry.marker && typeof entry.marker.getElement === "function" ? entry.marker.getElement() : null;
	if (el) {
		el.classList.add("location-visual-marker--active");
	}
}

// Die Auswahl faerbt nicht nur den Siedlungs-Marker gold, sondern auch den Wegpunkt-Marker derselben
// Stadt (route-render.js) und die Perle im Infopanel -- alle drei haengen an activeLocationPublicId.
// typeof-Guard: route-render.js wird nach dieser Datei geladen.
function syncActiveLocationDependents() {
	applyActiveLocationMarkerClass();
	if (typeof applyActiveRouteWaypointMarkers === "function") {
		applyActiveRouteWaypointMarkers();
	}
	if (typeof applyActiveWaypointRow === "function") {
		applyActiveWaypointRow();
	}
}

function setActiveLocationMarker(entryOrId) {
	const publicId = typeof entryOrId === "string" ? entryOrId : (entryOrId && entryOrId.publicId) || "";
	if (!publicId || activeLocationPublicId === publicId) {
		return;
	}
	activeLocationPublicId = publicId;
	if (typeof locationCanvasLayer !== "undefined" && locationCanvasLayer._ready) {
		locationCanvasLayer._redraw();
	}
	syncActiveLocationDependents();
}

function clearActiveLocationMarker() {
	if (!activeLocationPublicId) {
		return;
	}
	activeLocationPublicId = "";
	if (typeof locationCanvasLayer !== "undefined" && locationCanvasLayer._ready) {
		locationCanvasLayer._redraw();
	}
	syncActiveLocationDependents();
	// Auch das Infopanel entmarkieren: sonst bliebe seine Perle golden stehen, waehrend die Karte ihre
	// Auswahl schon verloren hat (der Panel-Zustand haengt am Namen, nicht an der publicId).
	if (typeof window !== "undefined" && typeof window.avesmapsClearInfopanelActiveWaypoint === "function") {
		window.avesmapsClearInfopanelActiveWaypoint();
	}
}

if (typeof window !== "undefined") {
	window.avesmapsSetActiveLocation = setActiveLocationMarker;
	window.avesmapsClearActiveLocation = clearActiveLocationMarker;
}

const locationCanvasLayer = {
	_map: null,
	_canvas: null,
	_ctx: null,
	_entries: [],
	_ready: false,
	_cursorActive: false,

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
		map.on("mousemove", this._onMouseMove, this);
		this._reset();
		this._ready = true;
		// Click arbiter: roads/regions/territories call this first and defer to a settlement here.
		window.avesmapsTryOpenLocationAtContainerPoint = (containerPoint) => this._tryOpenAtContainerPoint(containerPoint);
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
		// Groesse/Position IMMER frisch aus dem aktuellen Kartenzustand ziehen (nicht nur neu zeichnen):
		// beim ersten -- kontaktlosen -- Datenload kann der Canvas aus init() noch mit falscher Groesse/
		// Position stehen (die Karte war beim init evtl. nicht final vermessen) -> Marker unsichtbar bis zum
		// ersten Pan. _reset() = setPosition + getSize + Opacity + Redraw, also erscheinen die Marker auch
		// ohne Interaktion. (_entries ist oben bereits gesetzt.)
		this._reset();
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
		// Active/clicked settlement -> gold-yellow core fill (Owner). Read the token ONCE per redraw (not
		// per marker) so it follows the theme without hardcoding a hex on the canvas; empty when nothing active.
		const activeId = typeof activeLocationPublicId !== "undefined" ? activeLocationPublicId : "";
		const activeGold = activeId ? getLocationMarkerActiveColor() : "";
		for (const item of this._entries) {
			if (item.entry._canvasPromoted) {
				continue;
			}
			const layerPoint = this._map.latLngToLayerPoint(item.latLng);
			const x = layerPoint.x - origin.x;
			const y = layerPoint.y - origin.y;
			const fill = (activeGold && item.entry.publicId && item.entry.publicId === activeId) ? activeGold : item.fill;
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
				this._square(x, y, core, fill);
				continue;
			}
			if (item.isCapital) {
				// Metropole: 1px-Dunkel -> Gold-Band -> 1px-Dunkel (1:1 zum --capital box-shadow-Stapel).
				disc(x, y, outer + item.accentRing + 1, "rgba(0, 0, 0, 0.35)");
				disc(x, y, outer + item.accentRing, "#e7b04a");
			}
			disc(x, y, outer + 1, "rgba(0, 0, 0, 0.55)");
			disc(x, y, outer, "#ffffff");
			disc(x, y, core, fill);
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
		// A settlement hit sets the active gold marker (in _tryOpen). No settlement here -> deselect: this is
		// either an empty click or a lower-priority feature (road/region), neither of which is the active
		// location. (Road/region layers call _tryOpen themselves first, so a settlement still wins.)
		if (!this._tryOpenAtContainerPoint(event.containerPoint)) {
			clearActiveLocationMarker();
		}
	},

	// Shared settlement hit-test = the click "arbiter" (see docs/click-arbiter-coordination.md): opens
	// the settlement whose marker sits under `point` and returns TRUE, else FALSE. Lower-priority layers
	// (Strasse/Fluss, Region, Herrschaftsgebiet) call this FIRST via window.avesmapsTryOpenLocationAt-
	// ContainerPoint and defer when it wins. Priority: Siedlung > Strasse/Fluss > Region > Gebiet.
	_tryOpenAtContainerPoint(point) {
		if (!this._ready || !this._entries.length || !point) {
			return false;
		}
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
			return false;
		}
		const entry = hit.entry;

		// Owner: clicking a settlement makes it the active location -> gold marker fill. Set it here (before
		// the panel/popup branch) so it applies in BOTH modes; a click resolves to exactly one settlement.
		setActiveLocationMarker(entry);

		// Infopanel (?infopanel=true): Feature-Info ins rechte Panel statt ins schwebende Popup --
		// VOR dem DOM-Marker-Promote/openPopup abzweigen (sonst bleibt ein promoteter Marker oder ein
		// offenes Popup zurueck).
		if (typeof window.avesmapsShowLocationInInfopanel === "function") {
			window.avesmapsShowLocationInInfopanel(entry);
			// Floating box ALONGSIDE the panel (Owner: keep seeing WHERE the place is). Direct map click
			// only -- breadcrumb/deeplink/auto-open go through avesmapsShowLocationInInfopanel WITHOUT this
			// arbiter, so they open the panel only (§6 rule).
			if (typeof openFloatingLocationBoxForMarkerEntry === "function") {
				openFloatingLocationBoxForMarkerEntry(entry);
			}
			return true;
		}
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
		return true;
	},

	// Hover-Cursor fuer die Canvas-Siedlungen: das Canvas-Pane ist pointer-events:none (Klicks laufen ueber den
	// Hit-Test in _onClick), daher gibt es ueber den gezeichneten Punkten sonst KEINEN Finger-Cursor wie bei
	// DOM-Markern. Wir setzen ihn hier per Hit-Test auf mousemove -> klickbare Orte signalisieren das wieder.
	// Nur Desktop (mousemove feuert nicht bei Touch); geschrieben wird nur beim Zustandswechsel (kein Thrashing),
	// und auf "" zuruecksetzen laesst Leaflets grab/grabbing-Cursor unangetastet. Gleiche Trefferflaeche wie _onClick.
	_onMouseMove(event) {
		if (!this._ready) {
			return;
		}
		let over = false;
		const point = event.containerPoint;
		for (const item of this._entries) {
			if (item.entry._canvasPromoted) {
				continue;
			}
			const containerPoint = this._map.latLngToContainerPoint(item.latLng);
			const dx = containerPoint.x - point.x;
			const dy = containerPoint.y - point.y;
			const hitRadius = item.core * (1 + LOCATION_MARKER_CONTOUR_RATIO) + 3;
			if (dx * dx + dy * dy <= hitRadius * hitRadius) {
				over = true;
				break;
			}
		}
		if (over !== this._cursorActive) {
			this._map.getContainer().style.cursor = over ? "pointer" : "";
			this._cursorActive = over;
		}
	},
};
