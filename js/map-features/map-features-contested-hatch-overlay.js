"use strict";

/*
 * Canvas-Overlay für UMSTRITTENE GEBIETE (Feature, Phase 1b).
 *
 * Zeichnet für Gebiete mit mehreren Anspruchstellern eine diagonale SCHRAFFUR (20px, 45°), die durch
 * die Farben der Parteien rotiert; jede Partei mit ihrer eigenen Deckkraft (= territory.opacity).
 *
 * ADDITIV und EIGENSTÄNDIG: das Grenzen-Overlay UND die bestehenden SVG-Flächen werden NICHT angefasst —
 * dieses Canvas liegt nur darüber (über den Füllungen, UNTER den Grenzen/Labels). Kein Regressionsrisiko.
 *
 * Datenquelle pro Gebiet = Liste von Parteien `[{ color, opacity }, ...]` (Reihenfolge = Streifenfolge):
 *   - feature.properties.contestedParties          (echter Layer-Endpoint, Phase 1a — noch nicht vorhanden)
 *   - window.__avesmapsContestedClaims[territory_public_id]   (Test-/Live-Override, Phase 1b)
 *
 * Liest die globalen `map` (Leaflet, L.CRS.Simple), `L`, `regionData` (Feature-Liste der polit. Ebene).
 */
(function initContestedHatchOverlay() {
	const PANE = "avesmapsContestedHatchPane";
	const STRIPE_ANGLE = 45; // Grad — im Spike abgenommen
	// Streifenbreite skaliert mit dem Zoom (Regel statt manuellem Mapping je Stufe): schmaler beim
	// Rauszoomen, breiter beim Reinzoomen. Geometrische Staffelung um die Referenz (höchster Zoom =
	// Spike-Wert 20px), nach unten/oben geklammert.
	const STRIPE_WIDTH_BASE = 20;     // px bei Referenz-Zoom
	const STRIPE_WIDTH_REF_ZOOM = 6;  // Referenz = höchster Zoom -> Basisbreite
	const STRIPE_WIDTH_RATIO = 1.25;  // Faktor je Zoomstufe
	const STRIPE_WIDTH_MIN = 3;       // px Untergrenze (ganz rausgezoomt) -- feiner, damit auch kleine Flaechen bei Tiefzoom Streifen zeigen
	const STRIPE_WIDTH_MAX = 22;      // px Obergrenze
	// Pauschale Schraffur-Deckkraft (Nutzer-Wunsch 2026-06-13): ALLE Streifen mit EINER festen Deckkraft
	// statt der je-Partei territory.opacity. 0.25 = deutlich transparenter (Gelaende scheint klar durch).
	// Live justierbar via ?hatchopacity=0.25 (0..1).
	const HATCH_FILL_OPACITY = (() => {
		const m = /[?&]hatchopacity=([0-9.]+)/.exec(typeof location !== "undefined" ? location.search : "");
		const v = m ? parseFloat(m[1]) : 0.25;
		return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.25;
	})();

	function stripeWidthForZoom(zoom) {
		const z = Number.isFinite(zoom) ? zoom : STRIPE_WIDTH_REF_ZOOM;
		const width = STRIPE_WIDTH_BASE * Math.pow(STRIPE_WIDTH_RATIO, z - STRIPE_WIDTH_REF_ZOOM);
		return Math.max(STRIPE_WIDTH_MIN, Math.min(STRIPE_WIDTH_MAX, width));
	}

	function ready() {
		return typeof map !== "undefined" && map && typeof map.createPane === "function" && typeof L !== "undefined";
	}
	if (!ready()) { window.setTimeout(initContestedHatchOverlay, 50); return; }

	if (!map.getPane(PANE)) {
		map.createPane(PANE);
		const pane = map.getPane(PANE);
		pane.style.zIndex = 300;            // über Füllungen (regionsPane 200), unter Grenzen (350) + Labels (475)
		pane.style.pointerEvents = "none";  // nicht-interaktiv, Klicks gehen an die SVG-Flächen
	}
	const canvas = document.createElement("canvas");
	canvas.style.position = "absolute";
	canvas.style.pointerEvents = "none";
	canvas.style.top = "0";
	canvas.style.left = "0";
	canvas.style.transformOrigin = "0 0";
	canvas.classList.add("leaflet-zoom-animated"); // easet im Gleichschritt mit den Leaflet-Ebenen
	map.getPane(PANE).appendChild(canvas);
	const ctx = canvas.getContext("2d");

	let canvasTopLeftLatLng = null;
	let cssZoomActive = false;

	function getRegionData() {
		return Array.isArray(window.regionData) ? window.regionData : (typeof regionData !== "undefined" ? regionData : []);
	}
	function polygonsOf(geom) {
		if (!geom) return [];
		if (geom.type === "Polygon") return [geom.coordinates];
		if (geom.type === "MultiPolygon") return geom.coordinates;
		return [];
	}
	function clamp01(value) {
		const n = Number(value);
		return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
	}

	// Parteien eines Features ermitteln (Liste {color, opacity}): echter Layer ODER Test-Override.
	function partiesFor(feature) {
		const p = (feature && feature.properties) || {};
		if (Array.isArray(p.contestedParties) && p.contestedParties.length) return p.contestedParties;
		const test = window.__avesmapsContestedClaims || null;
		const pid = p.territory_public_id || p.public_id || "";
		if (test && pid && Array.isArray(test[pid]) && test[pid].length) return test[pid];
		return null;
	}

	// Ein Gebiet schraffieren: aufs Polygon clippen, diagonale Streifen durch die Parteifarben rotieren.
	function hatchFeature(feature, parties, stripeWidth) {
		const polys = polygonsOf(feature.geometry);
		if (!polys.length || !parties.length) return;

		ctx.save();
		ctx.beginPath();
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;
		polys.forEach((rings) => rings.forEach((ring) => {
			for (let i = 0; i < ring.length; i += 1) {
				const pt = map.latLngToContainerPoint(L.latLng(Number(ring[i][1]), Number(ring[i][0])));
				if (i === 0) ctx.moveTo(pt.x, pt.y); else ctx.lineTo(pt.x, pt.y);
				if (pt.x < minX) minX = pt.x; if (pt.x > maxX) maxX = pt.x;
				if (pt.y < minY) minY = pt.y; if (pt.y > maxY) maxY = pt.y;
				any = true;
			}
			ctx.closePath();
		}));
		if (!any) { ctx.restore(); return; }
		ctx.clip("evenodd"); // evenodd -> Innenringe (Löcher) bleiben frei

		const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
		const R = Math.hypot(maxX - minX, maxY - minY) || 1; // deckt das rotierte Bounding-Rechteck
		ctx.translate(cx, cy);
		ctx.rotate(STRIPE_ANGLE * Math.PI / 180);
		const n = parties.length;
		const w = stripeWidth > 0 ? stripeWidth : STRIPE_WIDTH_BASE;
		let i = 0;
		for (let x = -R; x <= R; x += w) {
			const party = parties[((i % n) + n) % n] || {};
			ctx.globalAlpha = HATCH_FILL_OPACITY; // pauschal fuer ALLE Streifen (ignoriert je-Partei-Deckkraft)
			ctx.fillStyle = party.color || "#888888";
			ctx.fillRect(x, -R, w, 2 * R); // exakt aneinander, KEIN Ueberlapp -> keine doppelt gezeichneten
			// Naehte (sonst zwei 0.75-Baender uebereinander = 0.94 an der Naht; bei Tiefzoom mit schmalen
			// Baendern war das ~20% der Flaeche -> wirkte "nahezu opak"). Aneinanderstossende Rects fuellen
			// per Anti-Aliasing lueckenlos, ohne die Deckkraft an den Kanten zu verdoppeln.
			i += 1;
		}
		ctx.restore();
	}

	function redraw() {
		if (!map.getPane(PANE) || cssZoomActive) return;
		const size = map.getSize();
		const topLeft = map.containerPointToLayerPoint([0, 0]);
		L.DomUtil.setPosition(canvas, topLeft);
		canvasTopLeftLatLng = map.containerPointToLatLng([0, 0]);

		// HiDPI: Backing-Store in Geräte-Pixeln, CSS-Größe in Layout-Pixeln -> scharf auf Retina/Mobile.
		const dpr = window.devicePixelRatio || 1;
		const pw = Math.round(size.x * dpr), ph = Math.round(size.y * dpr);
		if (canvas.width !== pw) canvas.width = pw;
		if (canvas.height !== ph) canvas.height = ph;
		if (canvas.style.width !== size.x + "px") canvas.style.width = size.x + "px";
		if (canvas.style.height !== size.y + "px") canvas.style.height = size.y + "px";
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		// Schraffur NUR im politischen Modus. In "Regionen"(deregraphic)/"Kraftlinien"/"keine" ist
		// regionData zwar geladen (fuer die Grenzlinien), aber die Konflikt-Schraffur darf dort NICHT
		// erscheinen. Canvas ist oben bereits geleert -> beim Wechsel weg aus "politisch" verschwindet sie.
		const layerMode = typeof getSelectedMapLayerMode === "function" ? getSelectedMapLayerMode() : "political";
		if (layerMode !== "political") return;

		const rd = getRegionData();
		if (!rd.length) return;
		const stripeWidth = stripeWidthForZoom(map.getZoom());
		// Quell-IDs aller Derived, die JETZT fuellen UND eigene contested_pieces mitbringen: diese Stuecke
		// uebernehmen die Schraffur der Konflikt-Baronien. Deren Own-Level-Feature darf dann NICHT zusaetzlich
		// schraffieren -- sonst zwei Lagen a 0.75 = ~0.94 (zu deckend). Greift auch bei Innengrenzen-AN, wo die
		// Quellflaechen nur stroke-hidden (nicht visual_hidden) sind und so sonst durch die Gate-Pruefung kaemen.
		const piecesCoveredTerritoryIds = new Set();
		for (let k = 0; k < rd.length; k += 1) {
			const props = (rd[k] && rd[k].properties) || {};
			if (props.is_derived_geometry && props.derived_fill_active === true
				&& Array.isArray(props.contested_pieces) && props.contested_pieces.length
				&& Array.isArray(props.derived_source_territory_public_ids)) {
				for (let s = 0; s < props.derived_source_territory_public_ids.length; s += 1) {
					const id = String(props.derived_source_territory_public_ids[s] || "");
					if (id) piecesCoveredTerritoryIds.add(id);
				}
			}
		}
		function coveredByFillingDerivedPieces(props) {
			const tid = String(props.territory_public_id || "");
			if (tid && piecesCoveredTerritoryIds.has(tid)) return true;
			const agg = String(props.aggregate_source_territory_public_id || "");
			if (agg && piecesCoveredTerritoryIds.has(agg)) return true;
			return false;
		}
		for (let k = 0; k < rd.length; k += 1) {
			const props = (rd[k] && rd[k].properties) || {};
			const parties = partiesFor(rd[k]);
			// Own-Level-Schraffur NUR, wenn das Feature NICHT von einer Derived verdeckt ist UND nicht von den
			// contested_pieces einer fuellenden Derived abgedeckt wird. Sonst wird dieselbe Baronie doppelt
			// schraffiert -- einmal hier (eigenes Feature) und einmal als contested_pieces der fuellenden
			// Derived -> zwei Lagen a 0.75 = viel zu deckend. Verdeckte/abgedeckte Baronien uebernimmt die
			// Derived (unten).
			if (parties && props.visual_hidden_by_derived_boundary !== true && !coveredByFillingDerivedPieces(props)) {
				hatchFeature(rd[k], parties, stripeWidth);
			}
			// Derived-Split: pro Konflikt-Baronie ein eigenes Stueck mit eigenen Streifenfarben.
			// NUR wenn die Derived auf dieser Zoomstufe FUELLT (derived_fill_active) -- sonst wuerde
			// es bei Hochzoom doppelt schraffieren (Eigen-Ebene-Baronien zeichnen dann selbst), und
			// jede aggregierende Ebene deckt ihre Konflikt-Nachfahren ab (lueckenlose Uebergabe).
			if (props.derived_fill_active === true && Array.isArray(props.contested_pieces)) {
				for (let p = 0; p < props.contested_pieces.length; p += 1) {
					const piece = props.contested_pieces[p];
					if (piece && piece.geometry && Array.isArray(piece.contestedParties) && piece.contestedParties.length) {
						hatchFeature(piece, piece.contestedParties, stripeWidth);
					}
				}
			}
		}
	}

	// "settle"-Redraws holen den frischen regionData-Stand nach (analog Grenzen-Overlay).
	function scheduleSettleRedraws() {
		[120, 350, 800].forEach((delay) => window.setTimeout(redraw, delay));
	}

	map.on("moveend zoomend viewreset resize", () => {
		cssZoomActive = false;
		canvas.style.transition = "";
		redraw();
		scheduleSettleRedraws();
	});
	// CSS-Zoom (Buttons/Scroll): Canvas weich mitskalieren statt neu zeichnen.
	map.on("zoomanim", function (event) {
		if (!canvasTopLeftLatLng || typeof map._latLngToNewLayerPoint !== "function") return;
		cssZoomActive = true;
		canvas.style.transition = "transform 250ms cubic-bezier(0,0,0.25,1)";
		const scale = map.getZoomScale(event.zoom);
		const offset = map._latLngToNewLayerPoint(canvasTopLeftLatLng, event.zoom, event.center);
		L.DomUtil.setTransform(canvas, offset, scale);
	});
	map.on("zoom", function () { if (!cssZoomActive) redraw(); });

	window.AvesmapsContestedHatchOverlay = { redraw, paneName: PANE };
	redraw();
})();
