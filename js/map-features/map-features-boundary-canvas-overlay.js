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

	// In den reinen Grenzen-Modi (Regionen/Kraftlinien) Außen- UND Innenlinien dezenter: halbe Deckkraft.
	// Im political-Modus volle Deckkraft. Der Faktor wird pro redraw gesetzt und auch von drawInnerBoundaries
	// gelesen (gleiche IIFE-Closure). 0.5 hier leicht justierbar (z. B. 0.4/0.6).
	const BOUNDARY_WEAK_MODES = ["deregraphic", "powerlines"];
	// Deckkraft der Grenzlinien in Regionen/Kraftlinien je Zoomstufe (0..1): z0 ganz aus, dann zunehmend,
	// ab z4 gedeckelt. Außenlinie = dieser Wert; Innenlinie proportional (× INNER_LINE_ALPHA, wie bisher).
	// z3 = 0.5 entspricht dem bisherigen festen Stand. Leicht justierbar.
	const BOUNDARY_WEAK_ALPHA_BY_ZOOM = { 0: 0, 1: 0.15, 2: 0.30, 3: 0.50, 4: 0.65, 5: 0.65, 6: 0.65 };
	function getBoundaryWeakAlpha(zoomLevel) {
		const z = Math.max(0, Math.min(6, Math.round(Number(zoomLevel))));
		return BOUNDARY_WEAK_ALPHA_BY_ZOOM[z] != null ? BOUNDARY_WEAK_ALPHA_BY_ZOOM[z] : 0.65;
	}
	// Konturbreite der Außengrenze (Stroke px) in Regionen/Kraftlinien, PRO ZOOM (4/5/6) -- live tunbar.
	// Innen-Clip zeigt die innere Hälfte -> sichtbar ~Stroke/2. Zoom <4 (faint borders) fällt auf 2 zurück.
	const BOUNDARY_WEAK_OUTER_WIDTH_BY_ZOOM = { 4: 2, 5: 2, 6: 2 };
	function getBoundaryWeakOuterWidth(zoomLevel) {
		const z = Math.round(Number(zoomLevel));
		return BOUNDARY_WEAK_OUTER_WIDTH_BY_ZOOM[z] != null ? BOUNDARY_WEAK_OUTER_WIDTH_BY_ZOOM[z] : 2;
	}
	let boundaryAlphaFactor = 1;

	// --- Territoriums-Namen entlang der Außengrenzen (NUR "Regionen"/deregraphic, ab hohem Zoom) ---
	// Schrift folgt der geglätteten Außenkontur, nach innen versetzt (Links-Normale des CCW-Rings). Baronien/
	// Siedlungen ausgenommen (zu kleinteilig). Pro Move neu gezeichnet (redraw läuft eh bei jedem moveend/zoom).
	// Weiß, halbtransparent, KEIN Glow/Schatten. Notausschalter ?borderlabels=0.
	const TERRITORY_BORDER_LABELS_ENABLED = (() => { try { return new URLSearchParams(window.location.search).get("borderlabels") !== "0"; } catch (e) { return true; } })();
	const TERRITORY_LABEL_MIN_ZOOM = 4;
	const TERRITORY_LABEL_EXCLUDE = /^(Baronie|Junkertum|Vogtei|Rittergut|Freiherrschaft|Reichsstadt|Stadt)\b/i;
	// PRO ZOOMSTUFE (4/5/6) -- Labels zeigen nur ab Zoom 4. Live tunbar via ?labeltune=1 (Slider mutieren diese
	// Objekte; OK-Button schreibt den Stand nach window.__avesmapsBorderLabelTuning zum Übernehmen als Default).
	const TERRITORY_LABEL_OFFSET_BY_ZOOM = { 4: 11, 5: 12, 6: 24 };       // px nach innen (Abstand Grenze->Text)
	const TERRITORY_LABEL_FONT_SIZE_BY_ZOOM = { 4: 8, 5: 10, 6: 16 };     // px Schriftgröße
	const TERRITORY_LABEL_DETAIL_BY_ZOOM = { 4: 0.95, 5: 1, 6: 1 };       // Stützpunkt-Dichte (Anteil 0..1)
	const territoryLabelByZoom = (table, zoomLevel, fallback) => {
		const z = Math.max(4, Math.min(6, Math.round(Number(zoomLevel))));
		return table[z] != null ? table[z] : fallback;
	};
	function getTerritoryLabelOffset(z) { return territoryLabelByZoom(TERRITORY_LABEL_OFFSET_BY_ZOOM, z, 20); }
	function getTerritoryLabelFontSize(z) { return territoryLabelByZoom(TERRITORY_LABEL_FONT_SIZE_BY_ZOOM, z, 11); }
	function getTerritoryLabelDetail(z) { return territoryLabelByZoom(TERRITORY_LABEL_DETAIL_BY_ZOOM, z, 0.5); }
	const TERRITORY_LABEL_FONT_FAMILY = '"Faculty Glyphic", Georgia, "Times New Roman", serif'; // wie .map-label
	const TERRITORY_LABEL_LETTER_SPACING = 3;
	const TERRITORY_LABEL_ALPHA = 0.9; // weiß, gut deckend
	// Gewicht des mittleren Kontrollpunkts im (rationalen) B-Spline (1 = klassisch, >1 strafft). Global, live tunbar.
	let TERRITORY_LABEL_SPLINE_WEIGHT = 2;

	// Gewichteter (rationaler) quadratischer B-Spline durch ein (ausgedünntes) Kontrollpolygon -> glatte Leitkurve.
	// weight>1 strafft die Kurve in Richtung der Kontrollpunkte (NURBS-artige Gewichtung des Mittelpunkts).
	function quadraticBSplinePoints(ctrl, samples, weight) {
		if (ctrl.length < 3) return ctrl.slice();
		const w = weight || 1;
		const out = [ctrl[0]];
		for (let i = 1; i < ctrl.length - 1; i += 1) {
			const p0 = ctrl[i - 1], p1 = ctrl[i], p2 = ctrl[i + 1];
			for (let s = 1; s <= samples; s += 1) {
				const t = s / samples;
				const a = 0.5 * (1 - t) * (1 - t), b = (0.5 + t - t * t) * w, c = 0.5 * t * t;
				const inv = 1 / (a + b + c);
				out.push({ x: (a * p0.x + b * p1.x + c * p2.x) * inv, y: (a * p0.y + b * p1.y + c * p2.y) * inv });
			}
		}
		out.push(ctrl[ctrl.length - 1]);
		return out;
	}

	// Name 1:1 wie im Tool (KEINE Kürzung/Umbenennung) -- nur Großschreibung für den Karten-Look.
	function territoryLabelText(properties) {
		return String(properties.label_name || properties.name || "").trim().toUpperCase();
	}

	function territoryOuterRing(f) {
		let ring = null, best = -1;
		polygonsOf(f.geometry).forEach((p) => { const r = p[0]; if (r && r.length > best) { best = r.length; ring = r; } });
		return ring;
	}

	// Ungerichteter Kanten-Schlüssel (auf 3 Nachkommastellen gerundet -> geteilte Grenzen koinzidieren exakt).
	function territoryEdgeKey(a, b) {
		const ka = (+a[0]).toFixed(3) + "," + (+a[1]).toFixed(3);
		const kb = (+b[0]).toFixed(3) + "," + (+b[1]).toFixed(3);
		return ka < kb ? ka + "|" + kb : kb + "|" + ka;
	}

	// Setzt pro Gebiet `_labelRing` + `_peerVertices` (1 = Kante i ist mit einem PEER-Nachbarn geteilt, nicht
	// Eltern/Kind). Peer-Kanten = die "echten" Nachbar-Grenzen, an denen sich zwei Gebiete GEGENÜBERSTEHEN
	// (Frontier zum Mutter-Reich liegt auf DERSELBEN Seite -> ausgeschlossen). Diese werden beim Anker-Pick
	// bevorzugt. Einmal pro Daten-Load (Features neu -> _peerVertices undefined); danach gecacht.
	function computeTerritoryLabelMeta(features) {
		const id = features.map((f) => String(f.properties.territory_public_id || "").trim());
		const par = features.map((f) => String(f.properties.parent_public_id || "").trim());
		const isParentChild = (i, j) => (par[i] && par[i] === id[j]) || (par[j] && par[j] === id[i]);
		const owners = new Map();
		features.forEach((f, ti) => {
			const ring = f._labelRing || (f._labelRing = territoryOuterRing(f));
			if (!ring) return;
			for (let i = 0; i < ring.length - 1; i += 1) {
				const k = territoryEdgeKey(ring[i], ring[i + 1]);
				let s = owners.get(k); if (!s) { s = []; owners.set(k, s); } if (s.indexOf(ti) < 0) s.push(ti);
			}
		});
		features.forEach((f, ti) => {
			const ring = f._labelRing;
			if (!ring) { f._peerVertices = null; return; }
			const peer = new Uint8Array(ring.length);
			for (let i = 0; i < ring.length - 1; i += 1) {
				const o = owners.get(territoryEdgeKey(ring[i], ring[i + 1]));
				if (o) { for (let n = 0; n < o.length; n += 1) { const tj = o[n]; if (tj !== ti && !isParentChild(ti, tj)) { peer[i] = 1; break; } } }
			}
			f._peerVertices = peer;
		});
	}

	// Glyphen einzeln entlang der (geglätteten) Pixel-Polyline platzieren, zentriert, tangential rotiert.
	function drawTextAlongSmoothPath(ctx, pts, chars, widths, ls) {
		const seg = []; let total = 0;
		for (let i = 1; i < pts.length; i += 1) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push({ cum: total, len: d, a: pts[i - 1], b: pts[i] }); total += d; }
		const textLen = widths.reduce((s, w) => s + w + ls, 0) - ls;
		let dist = (total - textLen) / 2;
		const at = (d) => { for (const s of seg) { if (d <= s.cum + s.len) { const t = (d - s.cum) / (s.len || 1); return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t, ang: Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) }; } } const l = seg[seg.length - 1]; return { x: l.b.x, y: l.b.y, ang: Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x) }; };
		for (let i = 0; i < chars.length; i += 1) { const w = widths[i]; const p = at(dist + w / 2); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang); ctx.fillText(chars[i], 0, 0); ctx.restore(); dist += w + ls; }
	}

	// Fußabdruck eines Labels: K+1 gleichmäßig verteilte Punkte entlang der TEXT-Strecke (zentriert auf dem Pfad)
	// -> für echte Überlappungs-Kollision (nicht nur Mittelpunkt). Gespiegelte Paare liegen ~2*OFFSET auseinander
	// und kollidieren so nicht, echte Überlagerungen schon.
	function labelFootprintPoints(smooth, textLen, k) {
		const seg = []; let total = 0;
		for (let i = 1; i < smooth.length; i += 1) { const d = Math.hypot(smooth[i].x - smooth[i - 1].x, smooth[i].y - smooth[i - 1].y); seg.push({ cum: total, len: d, a: smooth[i - 1], b: smooth[i] }); total += d; }
		const start = Math.max(0, (total - textLen) / 2);
		const at = (dd) => { for (const s of seg) { if (dd <= s.cum + s.len) { const t = (dd - s.cum) / (s.len || 1); return { x: s.a.x + (s.b.x - s.a.x) * t, y: s.a.y + (s.b.y - s.a.y) * t }; } } const l = seg[seg.length - 1]; return { x: l.b.x, y: l.b.y }; };
		const span = Math.min(textLen, total);
		const pts = [];
		for (let j = 0; j <= k; j += 1) pts.push(at(start + span * j / k));
		return pts;
	}

	function drawTerritoryBorderLabels(ctx) {
		const size = map.getSize();
		const rd = Array.isArray(window.regionData) ? window.regionData : (typeof regionData !== "undefined" ? regionData : []);
		const labelable = rd.filter((f) => f && f.properties && f.properties.is_derived_geometry === true && !TERRITORY_LABEL_EXCLUDE.test(String(f.properties.name || "")));
		labelable.sort((a, b) => { // große Gebiete zuerst -> gewinnen die Kollision
			const ra = (a.geometry.type === "MultiPolygon" ? a.geometry.coordinates[0] : a.geometry.coordinates)[0].length;
			const rb = (b.geometry.type === "MultiPolygon" ? b.geometry.coordinates[0] : b.geometry.coordinates)[0].length;
			return rb - ra;
		});
		const toPoint = (lng, lat) => map.latLngToContainerPoint(L.latLng(lat, lng));
		// Peer-Grenzen EINMAL pro Daten-Load markieren (Features nach Reload neu -> _peerVertices undefined).
		if (labelable.length && labelable[0]._peerVertices === undefined) {
			computeTerritoryLabelMeta(labelable);
		}
		// Pro-Zoom-Werte (Slider via ?labeltune=1).
		const territoryFontSize = getTerritoryLabelFontSize(map.getZoom());
		const territoryOffset = getTerritoryLabelOffset(map.getZoom());
		const territoryDetail = getTerritoryLabelDetail(map.getZoom());
		const placed = []; // Liste von Fußabdruck-Punktgruppen bereits gezeichneter Labels
		// Kollision per FUSSABDRUCK-Abstand: Mindestabstand ~Schrifthöhe zwischen den Textstrecken. Muss kleiner
		// als 2*TERRITORY_LABEL_OFFSET bleiben, sonst sterben die gespiegelten Nachbarpaare (die liegen ~2*OFFSET
		// auseinander). Echte Überlappungen (kreuzend/gestapelt) fallen weg.
		const LABEL_MIN_GAP = Math.min(territoryFontSize + 2, 2 * territoryOffset - 6);
		const collidesFootprint = (pts) => {
			const r2 = LABEL_MIN_GAP * LABEL_MIN_GAP;
			for (let g = 0; g < placed.length; g += 1) { const grp = placed[g]; for (let a = 0; a < grp.length; a += 1) { const q = grp[a]; for (let b = 0; b < pts.length; b += 1) { const dx = pts[b].x - q.x, dy = pts[b].y - q.y; if (dx * dx + dy * dy < r2) return true; } } }
			return false;
		};
		ctx.save();
		ctx.font = `${territoryFontSize}px ${TERRITORY_LABEL_FONT_FAMILY}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillStyle = `rgba(255, 255, 255, ${TERRITORY_LABEL_ALPHA})`;
		labelable.forEach((f) => {
			const ring = f._labelRing || territoryOuterRing(f);
			if (!ring || ring.length < 8) return;
			// Geo-Bbox -> schneller Off-Screen-Cull (ohne jeden Vertex zu projizieren).
			let gx1 = Infinity, gy1 = Infinity, gx2 = -Infinity, gy2 = -Infinity;
			for (let i = 0; i < ring.length; i += 1) { const x = +ring[i][0], y = +ring[i][1]; if (x < gx1) gx1 = x; if (x > gx2) gx2 = x; if (y < gy1) gy1 = y; if (y > gy2) gy2 = y; }
			const cA = toPoint(gx1, gy1), cB = toPoint(gx2, gy2), cC = toPoint(gx1, gy2), cD = toPoint(gx2, gy1);
			const bx1 = Math.min(cA.x, cB.x, cC.x, cD.x), bx2 = Math.max(cA.x, cB.x, cC.x, cD.x), by1 = Math.min(cA.y, cB.y, cC.y, cD.y), by2 = Math.max(cA.y, cB.y, cC.y, cD.y);
			if (bx2 < 0 || bx1 > size.x || by2 < 0 || by1 > size.y) return; // ganz off-screen
			// Anker: STICKY + bildschirm-nah + bevorzugt PEER-Grenzpunkt (Gegenüberstehen). Aktuellen Anker
			// behalten, solange er sichtbar ist -> beim Pannen kein Springen. Sonst neu wählen: nächster
			// SICHTBARER Peer-Grenzpunkt zur Bildschirmmitte (sonst beliebiger sichtbarer). So zeigt jedes
			// sichtbare Gebiet ein Label nahe der Ansicht (auch große Reiche an ihrer Außengrenze).
			const proj = new Array(ring.length);
			const PT = (i) => proj[i] || (proj[i] = toPoint(ring[i][0], ring[i][1])); // nur benötigte Vertices projizieren
			const visible = (p, m) => p.x >= -m && p.x <= size.x + m && p.y >= -m && p.y <= size.y + m;
			let anchorIndex = f._currentAnchorIdx;
			if (anchorIndex == null || anchorIndex >= ring.length || !visible(PT(anchorIndex), 24)) {
				const cx0 = size.x / 2, cy0 = size.y / 2;
				const peerV = f._peerVertices;
				let bestPeer = -1, bestPeerD = Infinity, bestAny = -1, bestAnyD = Infinity;
				for (let i = 0; i < ring.length - 1; i += 1) {
					const p = PT(i);
					if (!visible(p, 0)) continue;
					const d = (p.x - cx0) * (p.x - cx0) + (p.y - cy0) * (p.y - cy0);
					if (d < bestAnyD) { bestAnyD = d; bestAny = i; }
					if (peerV && peerV[i] && d < bestPeerD) { bestPeerD = d; bestPeer = i; }
				}
				anchorIndex = bestPeer >= 0 ? bestPeer : bestAny;
				if (anchorIndex < 0) return; // nichts vom Rand sichtbar
				f._currentAnchorIdx = anchorIndex;
			}
			const nearestIndex = anchorIndex;
			const text = territoryLabelText(f.properties);
			if (!text) return;
			const chars = [...text];
			const widths = chars.map((c) => ctx.measureText(c).width);
			const textLen = widths.reduce((s, w) => s + w + TERRITORY_LABEL_LETTER_SPACING, 0) - TERRITORY_LABEL_LETTER_SPACING;
			let lo = nearestIndex, hi = nearestIndex, len = 0;
			const target = textLen * 1.4;
			while (len < target && (lo > 0 || hi < ring.length - 1)) {
				if (hi < ring.length - 1) { hi += 1; const a = PT(hi), b = PT(hi - 1); len += Math.hypot(a.x - b.x, a.y - b.y); }
				if (len < target && lo > 0) { lo -= 1; const a = PT(lo), b = PT(lo + 1); len += Math.hypot(a.x - b.x, a.y - b.y); }
			}
			if (len < textLen) return;
			const baseline = [];
			for (let i = lo; i <= hi; i += 1) {
				const a = ring[Math.max(lo, i - 1)], b = ring[Math.min(hi, i + 1)];
				let dx = b[0] - a[0], dy = b[1] - a[1]; const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
				const nx = -dy, ny = dx; // Links-Normale = innen (CCW-Außenring, RFC7946)
				const base = PT(i);
				const inward = toPoint(ring[i][0] + nx * 0.3, ring[i][1] + ny * 0.3);
				let ox = inward.x - base.x, oy = inward.y - base.y; const om = Math.hypot(ox, oy) || 1; ox /= om; oy /= om;
				baseline.push({ x: base.x + ox * territoryOffset, y: base.y + oy * territoryOffset });
			}
			const nCtrl = Math.max(4, Math.min(baseline.length, Math.round(baseline.length * territoryDetail)));
			const ctrl = [];
			for (let k = 0; k < nCtrl; k += 1) ctrl.push(baseline[Math.round(k * (baseline.length - 1) / (nCtrl - 1))]);
			let smooth = quadraticBSplinePoints(ctrl, 8, TERRITORY_LABEL_SPLINE_WEIGHT);
			if (smooth[smooth.length - 1].x < smooth[0].x) smooth.reverse(); // Lesbarkeit: links->rechts
			const footprint = labelFootprintPoints(smooth, textLen, 12);
			if (collidesFootprint(footprint)) return; // echte Überlappung -> auslassen; gespiegelte Paare bleiben
			placed.push(footprint);
			drawTextAlongSmoothPath(ctx, smooth, chars, widths, TERRITORY_LABEL_LETTER_SPACING);
		});
		ctx.restore();
	}

	// --- Reichsstadt-Innenkontur (eng gegated, leicht reversibel über das Flag) ---
	// Einzelkind-Siedlungen (territory_type leer, genau 1 Kind des Eltern, kein eigenes Derived)
	// bekommen ihre eigene Stadt-Kontur als weiss-gestrichelte Linie — funktioniert auch, wenn die
	// Stadt an einen Nachbarn statt an den Eltern gesnappt ist (Hirschfurt/Perricum) oder als
	// Loch-in-Flaeche modelliert ist (Luring). Der Eltern-Dedup (bei 1 Kind oft Muell, z.B. Waldfang
	// trasst den Perimeter) wird für solche Eltern unterdrückt. Flag = false -> komplett aus.
	const REICHSSTADT_INNER_OUTLINE_ENABLED = true;
	const REICHSSTADT_RING_MAX_EXTENT = 8; // max. bbox-Kantenlaenge eines Stadt-Rings; größer = Baronie-Flaeche -> ignorieren

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
		pane.style.zIndex = 350;          // über Fuellungen (regionsPane 200), unter Labels (475)
		pane.style.pointerEvents = "none"; // nicht-interaktiv, Klicks gehen an die SVG-Flaechen
	}

	const canvas = document.createElement("canvas");
	canvas.style.position = "absolute";
	canvas.style.pointerEvents = "none";
	canvas.style.top = "0";
	canvas.style.left = "0";
	canvas.style.transformOrigin = "0 0"; // Skalierung während der Zoom-Animation um die obere linke Ecke
	// Dieselbe Easing wie Leaflets Ebenen: die Klasse aktiviert (unter .leaflet-zoom-anim) die
	// transition transform 0.25s cubic-bezier(0,0,0.25,1) -> Canvas easet im Gleichschritt mit
	// Kacheln/Flaechen/SVG-Linien statt sofort auf die Endgroesse zu springen.
	canvas.classList.add("leaflet-zoom-animated");
	map.getPane(PANE).appendChild(canvas);
	const ctx = canvas.getContext("2d");

	// LatLng der oberen linken Canvas-Ecke (Container 0,0) beim letzten Redraw — Anker für
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
	// ctx.save()/restore() mit-gesichert und danach zurückgesetzt.
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
		ctx.globalAlpha = INNER_LINE_ALPHA * boundaryAlphaFactor;
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
		// Nur während der CSS-Zoom-Animation NICHT neu zeichnen: dort übernimmt die zoomanim-
		// Transform das weiche Mitskalieren. Bei flyTo/setView (Doppelklick, Orts-Fokus) gibt es
		// KEIN zoomanim, der View wird pro Frame real aktualisiert -> dort MUSS neu gezeichnet
		// werden, sonst bleiben die Grenzen stehen bis zum Zoom-Ende.
		if (cssZoomActive) return;
		const size = map.getSize();
		const topLeft = map.containerPointToLayerPoint([0, 0]);
		L.DomUtil.setPosition(canvas, topLeft); // reine Translation -> setzt eine evtl. Zoom-Skalierung zurück
		canvasTopLeftLatLng = map.containerPointToLatLng([0, 0]);
		if (canvas.width !== size.x) canvas.width = size.x;
		if (canvas.height !== size.y) canvas.height = size.y;
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		// Grenzen (Außen + Innen, OHNE Fuellung/Labels) zeichnen in political/deregraphic/powerlines.
		// In "none" ("Nur Karte") bleibt das (geleerte) Canvas leer -> dort gewollt KEINE Grenzen; ohne
		// diese Sperre blieben beim Moduswechsel die alten Linien stehen (regionData bleibt bestehen).
		const BOUNDARY_OVERLAY_MODES = ["political", "deregraphic", "powerlines"];
		const currentMapLayerMode = typeof getSelectedMapLayerMode === "function" ? getSelectedMapLayerMode() : "political";
		if (!BOUNDARY_OVERLAY_MODES.includes(currentMapLayerMode)) {
			return;
		}
		// Regionen/Kraftlinien: Linien halb so deckend + Außenlinien uniform duenn; political: voll/abgestuft.
		const weakBoundaries = BOUNDARY_WEAK_MODES.includes(currentMapLayerMode);
		boundaryAlphaFactor = weakBoundaries ? getBoundaryWeakAlpha(map.getZoom()) : 1;
		const weakOuterWidth = getBoundaryWeakOuterWidth(map.getZoom());

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
			ctx.lineWidth = weakBoundaries
				? weakOuterWidth // Regionen/Kraftlinien: Konturbreite pro Zoom (kein Root-Verdicken/Fine)
				: (isRootBoundary
					? (fineOuterZoom ? OUTER_LINE_WIDTH_ROOT_FINE : OUTER_LINE_WIDTH_ROOT)
					: (fineOuterZoom ? OUTER_LINE_WIDTH_FINE : OUTER_LINE_WIDTH));
			ctx.strokeStyle = OUTER_LINE_COLOR || color;
			ctx.globalAlpha = boundaryAlphaFactor; // Regionen/Kraftlinien dezenter; im save/restore gekapselt
			ctx.lineJoin = "round";
			ctx.stroke();
			ctx.restore();

			// Innengrenzen: sichtbar wann immer die Derived existiert UND "Innengrenzen an"
			// (an die Außenkontur gekoppelt, NICHT ans Fuellband) -> die Unterteilungen
			// bleiben über alle Zoomstufen konsistent statt am Bandrand zu verschwinden.
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

		// Territoriums-Namen entlang der Außengrenzen -- NUR in "Regionen" (deregraphic) ab hohem Zoom.
		// (Political zeigt die Namen schon als normale Labels; deshalb dort nicht.)
		if (TERRITORY_BORDER_LABELS_ENABLED && currentMapLayerMode === "deregraphic"
			&& Math.round(Number(map.getZoom())) >= TERRITORY_LABEL_MIN_ZOOM) {
			drawTerritoryBorderLabels(ctx);
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
	// flyTo/setView: pro 'zoom'-Frame neu zeichnen (nur wenn KEIN CSS-Zoom läuft -> sonst Transform).
	map.on("zoom", function () { if (!cssZoomActive) redraw(); });

	window.AvesmapsBoundaryCanvasOverlay = { redraw, paneName: PANE };

	// Optionales Live-Tuning-Panel (nur mit ?labeltune=1): zwei Slider für Spline-Gewicht + Offset der
	// Grenz-Label-Leitlinie. Auf Eingabe sofort neu zeichnen. Kein Einfluss auf den Normalbetrieb.
	(function initBorderLabelTuningPanel() {
		let on = false;
		try { on = new URLSearchParams(window.location.search).has("labeltune"); } catch (e) { on = false; }
		if (!on || !document.body) return;
		const panel = document.createElement("div");
		panel.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:99999;background:rgba(28,28,28,0.92);color:#fff;font:12px Georgia,serif;padding:10px 12px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.45);width:220px;max-height:88vh;overflow:auto;";
		const title = document.createElement("div");
		title.textContent = "Grenz-Label-Tuning"; title.style.cssText = "font-weight:bold;margin-bottom:8px;";
		panel.appendChild(title);
		const slider = (label, min, max, step, value, apply) => {
			const wrap = document.createElement("div"); wrap.style.marginBottom = "7px";
			const head = document.createElement("div"); head.style.cssText = "display:flex;justify-content:space-between;margin-bottom:2px;";
			const name = document.createElement("span"); name.textContent = label;
			const val = document.createElement("span"); val.textContent = value;
			head.appendChild(name); head.appendChild(val);
			const input = document.createElement("input");
			input.type = "range"; input.min = min; input.max = max; input.step = step; input.value = value; input.style.width = "100%";
			input.addEventListener("input", function () { val.textContent = input.value; apply(parseFloat(input.value)); redraw(); });
			wrap.appendChild(head); wrap.appendChild(input);
			panel.appendChild(wrap);
		};
		const sectionTitle = (text) => { const d = document.createElement("div"); d.textContent = text; d.style.cssText = "margin:8px 0 4px;font-weight:bold;opacity:0.85;border-top:1px solid rgba(255,255,255,0.15);padding-top:6px;"; panel.appendChild(d); };
		slider("Spline-Gewicht (global)", 1, 30, 0.5, TERRITORY_LABEL_SPLINE_WEIGHT, (v) => { TERRITORY_LABEL_SPLINE_WEIGHT = v; });
		[4, 5, 6].forEach((z) => {
			sectionTitle("Zoom " + z);
			slider("Offset (px)", 0, 40, 1, TERRITORY_LABEL_OFFSET_BY_ZOOM[z], (v) => { TERRITORY_LABEL_OFFSET_BY_ZOOM[z] = v; });
			slider("Schriftgröße (px)", 6, 24, 1, TERRITORY_LABEL_FONT_SIZE_BY_ZOOM[z], (v) => { TERRITORY_LABEL_FONT_SIZE_BY_ZOOM[z] = v; });
			slider("Stützpunkt-Dichte", 0.05, 1, 0.05, TERRITORY_LABEL_DETAIL_BY_ZOOM[z], (v) => { TERRITORY_LABEL_DETAIL_BY_ZOOM[z] = v; });
			slider("Konturbreite Grenze (px)", 0.5, 8, 0.5, BOUNDARY_WEAK_OUTER_WIDTH_BY_ZOOM[z], (v) => { BOUNDARY_WEAK_OUTER_WIDTH_BY_ZOOM[z] = v; });
		});
		const okBtn = document.createElement("button");
		okBtn.textContent = "OK / Werte merken";
		okBtn.style.cssText = "width:100%;margin-top:10px;padding:7px;border:1px solid #5e4329;border-radius:6px;background:#7a5a3a;color:#fff;font:inherit;cursor:pointer;";
		okBtn.addEventListener("click", () => {
			const result = {
				offset: { ...TERRITORY_LABEL_OFFSET_BY_ZOOM },
				fontSize: { ...TERRITORY_LABEL_FONT_SIZE_BY_ZOOM },
				detail: { ...TERRITORY_LABEL_DETAIL_BY_ZOOM },
				outerWidth: { ...BOUNDARY_WEAK_OUTER_WIDTH_BY_ZOOM },
				splineWeight: TERRITORY_LABEL_SPLINE_WEIGHT,
			};
			window.__avesmapsBorderLabelTuning = result;
			console.log("[Grenz-Label-Tuning] " + JSON.stringify(result));
			okBtn.textContent = "✓ gemerkt";
			setTimeout(() => { okBtn.textContent = "OK / Werte merken"; }, 1500);
		});
		panel.appendChild(okBtn);
		const hint = document.createElement("div");
		hint.textContent = "Regionen-Modus; je Zoom 4/5/6 reinzoomen zum Sehen"; hint.style.cssText = "opacity:0.6;margin-top:6px;";
		panel.appendChild(hint);
		document.body.appendChild(panel);
	})();

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
	// Webfont (Faculty Glyphic) kann beim ersten Paint noch nicht geladen sein -> nach dem Laden neu zeichnen,
	// sonst zeigt das Canvas kurz den Georgia-Fallback.
	try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw); } catch (e) { /* noop */ }
	redraw();
})();
