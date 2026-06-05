"use strict";

/*
 * SPIKE (de-iframe/boundary-rendering): nicht-interaktives Canvas-Overlay, das die
 * abgeleiteten politischen Außengrenzen ("derived") als "inside" geclippte, solide,
 * farbige Konturen zeichnet (Technik aus prototype/inside-outline-proto.html).
 *
 * Ziel dieses Spikes: beweisen, dass sich ein Canvas-Overlay sauber in die bestehende
 * Leaflet-Karte (L.CRS.Simple, SVG-Default) einklinkt — Projektion, Pan/Zoom-Redraw,
 * Layer-Reihenfolge, keine Klick-Regression. ADDITIV: die bestehende SVG-Darstellung
 * bleibt unangetastet (kein Regressionsrisiko), das Overlay liegt nur darüber.
 *
 * Liest die globalen `map` (Leaflet), `L`, `regionData` (Feature-Liste).
 */
(function initBoundaryCanvasOverlay() {
	const PANE = "avesmapsBoundaryCanvasPane";
	const OUTER_LINE_WIDTH = 2;      // doppelt gestrokt, Clip zeigt innere Haelfte -> sichtbar ~1px
	const OUTER_LINE_WIDTH_ROOT = 4; // Root-Gebiete (eigenstaendige Reiche): +1px sichtbar (~2px)
	// Zoom 0/1: Außengrenzen ~1px duenner (kleine Gebiete -> Kontur wirkt sonst zu dick).
	const OUTER_LINE_WIDTH_FINE = 1;
	const OUTER_LINE_WIDTH_ROOT_FINE = 3;
	const INNER_LINE_WIDTH = 2;         // Innengrenzen: weiss-gestrichelt, leicht transparent
	const INNER_LINE_COLOR = "#ffffff";
	const INNER_LINE_ALPHA = 0.6;
	const INNER_LINE_DASH = [5, 4];
	// Innengrenzen je Zoom: Zoom 0 ganz aus (s. drawInnerBoundaries), Zoom 1 extra fein
	// (0.75px + [2,3]), ab Zoom 2 normal (2px + [5,4]).
	const INNER_LINE_WIDTH_FINE = 0.75;
	const INNER_LINE_DASH_FINE = [2, 3];
	const INNER_LINE_FINE_MAX_ZOOM = 1;
		// Innengrenzen bleiben bis Zoom 2 fein (Zoom 1+2 wie bisher Zoom 1); Zoom 0 ganz aus, ab Zoom 3 normal.
		const INNER_DASH_FINE_MAX_ZOOM = 2;
		// Zoom 3: Innengrenzen etwas duenner als normal (zwischen fein und 2px).
		const INNER_DASH_MEDIUM_ZOOM = 3;
		const INNER_LINE_WIDTH_MEDIUM = 1.25;
		const INNER_LINE_DASH_MEDIUM = [4, 3];
	const OUTER_LINE_COLOR = "#d3d3d3";              // Aussenkontur statisch hellgrau (null = Territoriumsfarbe)

	// --- Reichsstadt-Innenkontur (eng gegated, leicht reversibel ueber das Flag) ---
	// Einzelkind-Siedlungen (territory_type leer, genau 1 Kind des Eltern, kein eigenes Derived)
	// bekommen ihre eigene Stadt-Kontur als weiss-gestrichelte Linie — funktioniert auch, wenn die
	// Stadt an einen Nachbarn statt an den Eltern gesnappt ist (Hirschfurt/Perricum) oder als
	// Loch-in-Flaeche modelliert ist (Luring). Der Eltern-Dedup (bei 1 Kind oft Muell, z.B. Waldfang
	// trasst den Perimeter) wird fuer solche Eltern unterdrueckt. Flag = false -> komplett aus.
	const REICHSSTADT_INNER_OUTLINE_ENABLED = true;
	const REICHSSTADT_RING_MAX_EXTENT = 8; // max. bbox-Kantenlaenge eines Stadt-Rings; groesser = Baronie-Flaeche -> ignorieren

	function ready() {
		return typeof map !== "undefined" && map && typeof map.createPane === "function" && typeof L !== "undefined";
	}

	if (!ready()) {
		window.setTimeout(initBoundaryCanvasOverlay, 50);
		return;
	}

	if (!map.getPane(PANE)) {
		map.createPane(PANE);
		const pane = map.getPane(PANE);
		pane.style.zIndex = 350;          // ueber Fuellungen (regionsPane 200), unter Labels (475)
		pane.style.pointerEvents = "none"; // nicht-interaktiv, Klicks gehen an die SVG-Flaechen
	}

	const canvas = document.createElement("canvas");
	canvas.style.position = "absolute";
	canvas.style.pointerEvents = "none";
	canvas.style.top = "0";
	canvas.style.left = "0";
	canvas.style.transformOrigin = "0 0"; // Skalierung waehrend der Zoom-Animation um die obere linke Ecke
	// Dieselbe Easing wie Leaflets Ebenen: die Klasse aktiviert (unter .leaflet-zoom-anim) die
	// transition transform 0.25s cubic-bezier(0,0,0.25,1) -> Canvas easet im Gleichschritt mit
	// Kacheln/Flaechen/SVG-Linien statt sofort auf die Endgroesse zu springen.
	canvas.classList.add("leaflet-zoom-animated");
	map.getPane(PANE).appendChild(canvas);
	const ctx = canvas.getContext("2d");

	// LatLng der oberen linken Canvas-Ecke (Container 0,0) beim letzten Redraw — Anker fuer
	// die Zoom-Animations-Transform (wie L.ImageOverlay._animateZoom).
	let canvasTopLeftLatLng = null;

	function polygonsOf(geom) {
		if (!geom) return [];
		if (geom.type === "Polygon") return [geom.coordinates];
		if (geom.type === "MultiPolygon") return geom.coordinates;
		return [];
	}

	// Geom-Koordinaten [x,y] -> Leaflet-LatLng [y,x] -> Canvas-Pixel (Container-relativ,
	// da das Canvas am Layer-Punkt von Container [0,0] positioniert wird).
	function tracePolys(polys) {
		polys.forEach((rings) => rings.forEach((ring) => {
			for (let i = 0; i < ring.length; i += 1) {
				const p = map.latLngToContainerPoint(L.latLng(Number(ring[i][1]), Number(ring[i][0])));
				if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
			}
			ctx.closePath();
		}));
	}

	function normalizeColor(value) {
		const c = String(value || "").trim();
		return /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(c) ? c : "#4a3620";
	}

	// Innengrenzen: vorberechnete, deduppte Trennlinien der direkten Kinder (genau 1 Tiefe)
	// als weiss-gestrichelte, nicht-geclippte Polyline. setLineDash/globalAlpha werden vom
	// ctx.save()/restore() mit-gesichert und danach zurueckgesetzt.
	function drawInnerBoundaries(geojson) {
		if (!geojson) return;
		// Zoom 0: Innengrenzen ganz aus (winzige Gebiete -> nur Liniengewirr).
		if (Math.round(Number(map.getZoom())) <= 0) return;
		const lines = geojson.type === "MultiLineString" ? geojson.coordinates
			: geojson.type === "LineString" ? [geojson.coordinates]
			: null;
		if (!Array.isArray(lines) || !lines.length) return;
		ctx.save();
		ctx.beginPath();
		lines.forEach((line) => {
			if (!Array.isArray(line) || line.length < 2) return;
			for (let i = 0; i < line.length; i += 1) {
				const p = map.latLngToContainerPoint(L.latLng(Number(line[i][1]), Number(line[i][0])));
				if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
			}
		});
		const innerZoom = Math.round(Number(map.getZoom()));
		const fine = innerZoom <= INNER_DASH_FINE_MAX_ZOOM;        // Zoom 1-2: extra fein
		const medium = innerZoom === INNER_DASH_MEDIUM_ZOOM;       // Zoom 3: etwas duenner
		ctx.lineWidth = fine ? INNER_LINE_WIDTH_FINE : (medium ? INNER_LINE_WIDTH_MEDIUM : INNER_LINE_WIDTH);
		ctx.strokeStyle = INNER_LINE_COLOR;
		ctx.globalAlpha = INNER_LINE_ALPHA;
		ctx.setLineDash(fine ? INNER_LINE_DASH_FINE : (medium ? INNER_LINE_DASH_MEDIUM : INNER_LINE_DASH));
		ctx.lineJoin = "round";
		ctx.stroke();
		ctx.restore();
	}

	function ringMaxExtent(ring) {
		let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
		for (let i = 0; i < ring.length; i += 1) {
			const x = Number(ring[i][0]), y = Number(ring[i][1]);
			if (x < minx) minx = x; if (x > maxx) maxx = x;
			if (y < miny) miny = y; if (y > maxy) maxy = y;
		}
		return Math.max(maxx - minx, maxy - miny);
	}

	// Ermittelt die Einzelkind-Siedlungen (Reichsstaedte) + ihre Eltern aus dem aktuellen Feature-Satz.
	// settlements = deren eigene Stadt-Kontur gestrichelt gezeichnet wird; suppressParents = deren
	// gespeicherte (oft falsche) Innengrenze NICHT mehr gezeichnet wird (durch die Stadt-Kontur ersetzt).
	function buildReichsstadtSets(all, derivedTerritoryKeys) {
		const settlements = new Set();
		const suppressParents = new Set();
		if (!REICHSSTADT_INNER_OUTLINE_ENABLED) return { settlements, suppressParents };
		const childrenByParent = new Map();
		const parentOf = new Map();
		const typeOf = new Map();
		all.forEach((f) => {
			const p = f && f.properties; if (!p || p.is_derived_geometry === true) return;
			const tp = String(p.territory_public_id || "").trim(); if (!tp) return;
			typeOf.set(tp, String(p.territory_type || "").trim());
			const par = String(p.parent_public_id || "").trim();
			if (par) {
				parentOf.set(tp, par);
				if (!childrenByParent.has(par)) childrenByParent.set(par, new Set());
				childrenByParent.get(par).add(tp);
			}
		});
		typeOf.forEach((tt, tp) => {
			const par = parentOf.get(tp);
			if (!par) return;
			const siblings = childrenByParent.get(par);
			const isLeaf = !childrenByParent.has(tp);   // selbst keine Kinder
			const isSettlement = tt === "";             // Reichsstadt/Siedlung = kein Territoriumstyp
			const noOwnDerived = !derivedTerritoryKeys.has(tp);
			if (isSettlement && isLeaf && noOwnDerived && siblings && siblings.size === 1) {
				settlements.add(tp);
				suppressParents.add(par);
			}
		});
		return { settlements, suppressParents };
	}

	function redraw() {
		if (!map.getPane(PANE)) return;
		// Nur waehrend der CSS-Zoom-Animation NICHT neu zeichnen: dort uebernimmt die zoomanim-
		// Transform das weiche Mitskalieren. Bei flyTo/setView (Doppelklick, Orts-Fokus) gibt es
		// KEIN zoomanim, der View wird pro Frame real aktualisiert -> dort MUSS neu gezeichnet
		// werden, sonst bleiben die Grenzen stehen bis zum Zoom-Ende.
		if (cssZoomActive) return;
		const size = map.getSize();
		const topLeft = map.containerPointToLayerPoint([0, 0]);
		L.DomUtil.setPosition(canvas, topLeft); // reine Translation -> setzt eine evtl. Zoom-Skalierung zurueck
		canvasTopLeftLatLng = map.containerPointToLatLng([0, 0]);
		if (canvas.width !== size.x) canvas.width = size.x;
		if (canvas.height !== size.y) canvas.height = size.y;
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		const all = (Array.isArray(window.regionData) ? window.regionData : (typeof regionData !== "undefined" ? regionData : []));
		const feats = all.filter((f) => f && f.properties && f.properties.is_derived_geometry === true);
		const derivedTerritoryKeys = new Set();
		feats.forEach((f) => { const k = String(f.properties.territory_public_id || "").trim(); if (k) derivedTerritoryKeys.add(k); });
		const reichsstadt = buildReichsstadtSets(all, derivedTerritoryKeys);

		feats.forEach((f) => {
			const polys = polygonsOf(f.geometry);
			if (!polys.length) return;
			const color = normalizeColor(f.properties.fill || f.properties.stroke || f.properties.color);
			// "inside"-Kontur: auf das Polygon-Innere clippen, dann doppelt breit stroken
			// -> sichtbar bleibt die innere Haelfte, exakt auf der Grenze.
			ctx.save();
			ctx.beginPath();
			tracePolys(polys);
			ctx.clip();
			ctx.beginPath();
			tracePolys(polys);
			// Root-Gebiete (kein parent_public_id) bekommen eine etwas dickere Aussenkontur.
			const isRootBoundary = !String(f.properties.parent_public_id || "").trim();
			const fineOuterZoom = Math.round(Number(map.getZoom())) <= INNER_LINE_FINE_MAX_ZOOM;
			ctx.lineWidth = isRootBoundary
				? (fineOuterZoom ? OUTER_LINE_WIDTH_ROOT_FINE : OUTER_LINE_WIDTH_ROOT)
				: (fineOuterZoom ? OUTER_LINE_WIDTH_FINE : OUTER_LINE_WIDTH);
			ctx.strokeStyle = OUTER_LINE_COLOR || color;
			ctx.lineJoin = "round";
			ctx.stroke();
			ctx.restore();

			// Innengrenzen: sichtbar wann immer die Derived existiert UND "Innengrenzen an"
			// (an die Außenkontur gekoppelt, NICHT ans Fuellband) -> die Unterteilungen
			// bleiben ueber alle Zoomstufen konsistent statt am Bandrand zu verschwinden.
			if (f.properties.show_inner_boundaries === true
				&& !reichsstadt.suppressParents.has(String(f.properties.territory_public_id || "").trim())) {
				drawInnerBoundaries(f.properties.inner_boundary_geojson);
			}
		});

		// Reichsstadt-Innenkontur: kleine Stadt-Ringe der Einzelkind-Siedlungen als weiss-gestrichelte
		// Linie (kleine Ringe = Stadtkern; grosse Ringe = Baronie-Flaeche werden via Extent ausgefiltert,
		// z.B. Lurings 80-Punkt-Aussenring). Segment-Dedup vermeidet Doppellinien (Loch == Fuellung).
		if (reichsstadt.settlements.size) {
			const segMap = new Map();
			all.forEach((f) => {
				const p = f && f.properties; if (!p || p.is_derived_geometry === true) return;
				const tp = String(p.territory_public_id || "").trim();
				if (!reichsstadt.settlements.has(tp)) return;
				polygonsOf(f.geometry).forEach((rings) => rings.forEach((ring) => {
					if (!Array.isArray(ring) || ring.length < 3) return;
					if (ringMaxExtent(ring) > REICHSSTADT_RING_MAX_EXTENT) return;
					for (let i = 0; i < ring.length - 1; i += 1) {
						const a = ring[i], b = ring[i + 1];
						const ka = Number(a[0]).toFixed(3) + "," + Number(a[1]).toFixed(3);
						const kb = Number(b[0]).toFixed(3) + "," + Number(b[1]).toFixed(3);
						if (ka === kb) continue;
						const key = ka < kb ? ka + "|" + kb : kb + "|" + ka;
						if (!segMap.has(key)) segMap.set(key, [a, b]);
					}
				}));
			});
			if (segMap.size) {
				drawInnerBoundaries({ type: "MultiLineString", coordinates: [...segMap.values()] });
			}
		}
	}

	function hasDerivedData() {
		const rd = Array.isArray(window.regionData) ? window.regionData : (typeof regionData !== "undefined" ? regionData : []);
		return rd.some((f) => f && f.properties && f.properties.is_derived_geometry === true);
	}

	// Nach Karten-Interaktion lädt der politische Layer debounced+async neu -> ein paar
	// "settle"-Redraws holen den frischen regionData-Stand nach (unabhängig vom Loader-Hook).
	function scheduleSettleRedraws() {
		[120, 350, 800].forEach((delay) => window.setTimeout(redraw, delay));
	}

	// Zwei Zoom-Mechaniken, unterschiedlich behandelt:
	// - CSS-Zoom (Buttons/Scroll): feuert 'zoomanim'. Leaflets interner Zoom springt sofort aufs
	//   Ziel, sichtbar easet eine CSS-Transform -> NICHT neu zeichnen, sondern die Canvas per
	//   Transform mitskalieren (mit Transition, wie Leaflets Ebenen).
	// - flyTo/setView-Animation (Doppelklick, Orts-Fokus): KEIN 'zoomanim', der View wird pro Frame
	//   real aktualisiert -> bei jedem 'zoom'-Frame neu zeichnen (ohne Transform/Transition).
	let cssZoomActive = false;
	map.on("moveend zoomend viewreset resize", () => {
		cssZoomActive = false;
		canvas.style.transition = "";
		redraw();
		scheduleSettleRedraws();
	});
	// CSS-Zoom: Canvas weich mitskalieren (wie L.ImageOverlay._animateZoom), inkl. passender Easing.
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
	// flyTo/setView: pro 'zoom'-Frame neu zeichnen (nur wenn KEIN CSS-Zoom laeuft -> sonst Transform).
	map.on("zoom", function () { if (!cssZoomActive) redraw(); });

	window.AvesmapsBoundaryCanvasOverlay = { redraw, paneName: PANE };

	// Signatur-Poll: zeichnet neu, sobald sich der derived-Satz ändert (z. B. nach
	// 'Grenzen berechnen' + Layer-Reload erhalten die Derived neue public_ids). Deckt auch
	// den asynchronen Erst-Load ab und ist robust gegen den cache-fragilen Loader-Hook.
	// redraw() ist billig (wenige Polygone); gezeichnet wird nur bei tatsächlicher Änderung.
	let lastDerivedSignature = null;
	window.setInterval(function () {
		const rd = Array.isArray(window.regionData) ? window.regionData : (typeof regionData !== "undefined" ? regionData : []);
		let sig = rd.length + "|";
		for (let i = 0; i < rd.length; i += 1) {
			const f = rd[i];
			if (f && f.properties && f.properties.is_derived_geometry === true) sig += (f.properties.public_id || "") + ",";
		}
		if (sig !== lastDerivedSignature) { lastDerivedSignature = sig; redraw(); }
	}, 200);
	redraw();
})();
