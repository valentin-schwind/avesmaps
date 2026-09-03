"use strict";

/*
 * SPIKE (de-iframe/boundary-rendering): nicht-interaktives Canvas-Overlay, das die
 * abgeleiteten politischen Außengrenzen ("derived") als "inside" geclippte, solide,
 * farbige Konturen zeichnet (Technik aus docs/spikes/inside-outline-proto.html).
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
	const BOUNDARY_WEAK_MODES = ["deregraphic", "powerlines", "ecosystem"];
	// BOUNDARY_OVERLAY_MODES (welche Modi Grenzen zeichnen) steht in js/config.js -- der "Grenzen"-Haken
	// im Editor wird beim Moduswechsel auf dieselbe Liste gesetzt und muss dieselbe Wahrheit lesen.
	// Deckkraft der Grenzlinien in Regionen/Kraftlinien je Zoomstufe (0..1): z0 ganz aus, dann zunehmend,
	// ab z4 gedeckelt. Außenlinie = dieser Wert; Innenlinie proportional (× INNER_LINE_ALPHA, wie bisher).
	// z3 = 0.5 entspricht dem bisherigen festen Stand. Leicht justierbar.
	const BOUNDARY_WEAK_ALPHA_BY_ZOOM = { 0: 0, 1: 0.15, 2: 0.30, 3: 0.50, 4: 1, 5: 1, 6: 1 }; // AUSSEN
	function getBoundaryWeakAlpha(zoomLevel) {
		const z = Math.max(0, Math.min(6, Math.round(Number(zoomLevel))));
		return BOUNDARY_WEAK_ALPHA_BY_ZOOM[z] != null ? BOUNDARY_WEAK_ALPHA_BY_ZOOM[z] : 0.65;
	}
	// INNEN-Deckkraft separat: bei z4-6 ABSOLUT pro Zoom tunbar; bei z0-3 proportional zur Außen-Fade (wie bisher).
	const BOUNDARY_WEAK_INNER_ALPHA_BY_ZOOM = { 4: 0.5, 5: 0.75, 6: 1 };
	function getBoundaryInnerAlpha(zoomLevel) {
		const z = Math.round(Number(zoomLevel));
		return BOUNDARY_WEAK_INNER_ALPHA_BY_ZOOM[z] != null ? BOUNDARY_WEAK_INNER_ALPHA_BY_ZOOM[z] : INNER_LINE_ALPHA * getBoundaryWeakAlpha(z);
	}
	// Konturbreite der Außengrenze (Stroke px) in Regionen/Kraftlinien, PRO ZOOM (4/5/6) -- live tunbar.
	// Innen-Clip zeigt die innere Hälfte -> sichtbar ~Stroke/2. Zoom <4 (faint borders) fällt auf 2 zurück.
	const BOUNDARY_WEAK_OUTER_WIDTH_BY_ZOOM = { 4: 3, 5: 4, 6: 6 };
	function getBoundaryWeakOuterWidth(zoomLevel) {
		const z = Math.round(Number(zoomLevel));
		return BOUNDARY_WEAK_OUTER_WIDTH_BY_ZOOM[z] != null ? BOUNDARY_WEAK_OUTER_WIDTH_BY_ZOOM[z] : 2;
	}
	let boundaryAlphaFactor = 1;        // Außenlinien-Deckkraft (pro redraw gesetzt)
	let boundaryInnerAlphaFactor = INNER_LINE_ALPHA; // Innenlinien-Deckkraft (pro redraw gesetzt)

	// Live-Tuning (?boundarytune=1): Faktoren/Zusätze auf die (zoomabhängige) Grenzen-Darstellung. Defaults
	// reproduzieren den aktuellen Look: Faktor 1, keine Kontur, Außen durchgezogen, Innen = bestehendes Muster.
	// Dicke/Deckkraft als FAKTOR (× auf den zoomabhängigen Wert -> Fade/Feinheiten bleiben erhalten).
	// Grenzen-Tuning PRO Zoomstufe (0..6), live via ?boundarytune=1 (Grid). Wirkt auf die bereits zoomgestufte
	// Basis (fine/medium/root bleiben erhalten). Defaults: Dicke/Deckkraft = 1 (×, unverändert), Strichelung = 0
	// (außen durchgezogen, innen bestehendes Muster). Dicke 0 = Linie auf der Zoomstufe aus. (Kontur entfällt.)
	const BOUNDARY_OUTER_WIDTH_MUL_BY_ZOOM = { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 };
	const BOUNDARY_OUTER_ALPHA_MUL_BY_ZOOM = { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 };
	const BOUNDARY_OUTER_DASH_BY_ZOOM = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
	const BOUNDARY_INNER_WIDTH_MUL_BY_ZOOM = { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 };
	const BOUNDARY_INNER_ALPHA_MUL_BY_ZOOM = { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 };
	const BOUNDARY_INNER_DASH_BY_ZOOM = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
	function boundaryZoomVal(table, zoomLevel, fallback) {
		const z = Math.max(0, Math.min(6, Math.round(Number(zoomLevel))));
		const value = table[z];
		return Number.isFinite(value) ? value : fallback;
	}

	// --- Territoriums-Namen entlang der Außengrenzen (NUR "Regionen"/deregraphic, ab hohem Zoom) ---
	// Schrift folgt der geglätteten Außenkontur, nach innen versetzt (Links-Normale des CCW-Rings). Baronien/
	// Siedlungen ausgenommen (zu kleinteilig). Pro Move neu gezeichnet (redraw läuft eh bei jedem moveend/zoom).
	// Weiß, halbtransparent, KEIN Glow/Schatten. Notausschalter ?borderlabels=0.
	const TERRITORY_BORDER_LABELS_ENABLED = (() => { try { return new URLSearchParams(window.location.search).get("borderlabels") !== "0"; } catch (e) { return true; } })();
	// 🔴 z4 (Owner 24.08.2026: „die grenzbeschriftungen beginnen schon bei zoom 4 :)“).
	// 🪤 Kurzzeitig stand hier 5, weil die Vorgabe woertlich „von z4 (0) --> z5 (0.75)“ lautete --
	// gemeint war aber die BLENDE an der Schwelle, nicht das Verschieben der Schwelle selbst. Die
	// Schwelle liegt bei z4 wie eh und je; geblendet wird jetzt beim Schritt z3 -> z4.
	const TERRITORY_LABEL_MIN_ZOOM = 4;
	const TERRITORY_LABEL_EXCLUDE = /^(Baronie|Junkertum|Vogtei|Rittergut|Freiherrschaft|Reichsstadt|Stadt)\b/i;
	// PRO ZOOMSTUFE (4/5/6) -- Labels zeigen nur ab Zoom 4. Live tunbar via ?labeltune=1 (Slider mutieren diese
	// Objekte; OK-Button schreibt den Stand nach window.__avesmapsBorderLabelTuning zum Übernehmen als Default).
	const TERRITORY_LABEL_OFFSET_BY_ZOOM = { 4: 10, 5: 12, 6: 20 };       // px nach innen (Abstand Grenze->Text)
	const TERRITORY_LABEL_FONT_SIZE_BY_ZOOM = { 4: 9, 5: 11, 6: 16 };     // px Schriftgröße
	const TERRITORY_LABEL_DETAIL_BY_ZOOM = { 4: 0.8, 5: 0.9, 6: 1 };      // Stützpunkt-Dichte (Anteil 0..1)
	const territoryLabelByZoom = (table, zoomLevel, fallback) => {
		const z = Math.max(4, Math.min(6, Math.round(Number(zoomLevel))));
		return table[z] != null ? table[z] : fallback;
	};
	function getTerritoryLabelOffset(z) { return territoryLabelByZoom(TERRITORY_LABEL_OFFSET_BY_ZOOM, z, 20); }
	function getTerritoryLabelFontSize(z) { return territoryLabelByZoom(TERRITORY_LABEL_FONT_SIZE_BY_ZOOM, z, 11); }
	function getTerritoryLabelDetail(z) { return territoryLabelByZoom(TERRITORY_LABEL_DETAIL_BY_ZOOM, z, 0.5); }
	const TERRITORY_LABEL_FONT_FAMILY = '"Faculty Glyphic", Georgia, "Times New Roman", serif'; // wie .map-label
	const TERRITORY_LABEL_LETTER_SPACING = 3;
	// 🔴 DECKEL FUER DEN BACKING-STORE DIESER CANVAS (Owner 24.08.2026: „devicePixelRatio - setz das mal
	// runter“). 1 heisst: ein Canvas-Pixel je CSS-Pixel. Auf einem 1,5x- oder 2x-Schirm streckt der
	// Browser das fertige Bild dann selbst -- das ergibt den weicheren, „bitmapigen“ Eindruck, den der
	// Owner von frueher kennt, statt der pixelscharfen Schrift von HEAD 5c4a3787.
	// ⚠️ ES GIBT ACHT CANVASSE, DIE `devicePixelRatio` EINZELN LESEN: diese hier, contested-hatch,
	// ecosystem-height-render, location-canvas-layer (2x), path-label-canvas-overlay (2x),
	// river-flow-arrows und route-speed-arrows. Der Deckel gilt NUR fuer die Grenzen-Canvas -- er ist
	// eine Antwort auf einen Befund an DIESEM Bild, keine Hausregel. Wer ihn verallgemeinert, macht
	// aus acht Einzelentscheidungen eine, und das waere eine eigene Entscheidung mit eigenem Blick.
	// ⭐ Live vergleichbar ohne Deploy: ?canvasdpr=1.5 stellt den scharfen Stand her, ?canvasdpr=2 mehr.
	// 🔴 UND DIE WEGENAMEN STEHEN BEWUSST ANDERS: PATH_LABEL_CANVAS_MAX_DPR ist Infinity
	// (path-label-canvas-overlay.js). Owner 24.08.2026: „bei straßen und flüssen sieht canvasdpr=1.5
	// besser aus, bei den grenzbeschriftungen canvasdpr=1.0“. Zwei Schrift-Canvasse, zwei Vorgaben --
	// wer sie angleicht, nimmt eine am Bild getroffene Entscheidung zurueck.
	// 🔴 ZWEI DECKEL, WEIL DERSELBE DECKEL AUF ZWEI SCHIRMEN NICHT DASSELBE BEDEUTET.
	// Owner 24.08.2026: „kannst du die dpr fuer telefone hochstellen?“ -- zu Recht: auf seinem
	// 1,5x-Schirm heisst Deckel 1 „ein Drittel weniger Aufloesung“ und liest sich als der weiche,
	// bitmapige Ton, den er wollte. Auf einem 3x-Telefon hiesse derselbe Deckel „zwei Drittel weniger“
	// -- das ist kein Ton mehr, das ist Matsch, und zwar auf dem kleinsten Bildschirm, wo Schrift die
	// Schaerfe am noetigsten hat.
	const TERRITORY_CANVAS_MAX_DPR = 1;         // Zeigergeraete: der abgenommene weiche Ton
	// ⚠️ „Telefon“ hat im Haus GENAU EINE Definition: avesmapsIsPhoneViewport() in
	// js/app/runtime-state.js (grober Zeiger UND Bildschirm-Kurzseite <= 600 px, damit ein quer
	// gehaltenes Telefon eins bleibt). Eine zweite Fassung hier -- etwa nur `devicePixelRatio >= 2`
	// -- traefe auch jeden Retina-Laptop und liefe beim ersten Sonderfall auseinander.
	// 💣 PRO REDRAW AUSGEWERTET, nicht einmal beim Laden: ein Telefon wird gedreht, und ein
	// Desktopfenster laesst sich auf Telefonbreite ziehen (bleibt aber Zeigergeraet). Der frueher hier
	// stehende Einmal-Wert haette die Drehung nie mitbekommen.
	// ⚠️ Die Telefon-Regel steht NICHT hier, sondern EINMAL in js/app/runtime-state.js
	// (avesmapsCanvasDpr). Hier bleibt nur der eigene Deckel fuer Zeigergeraete.
	const TERRITORY_LABEL_ALPHA = 0.75; // weiß, LEICHT TRANSPARENT -- nicht „gut deckend“ erhöhen:
	// 0.75 ist der Ursprungswert (54a5ac96) und der, den der Owner am 24.08.2026 zurückverlangt hat.
	// 4d2771b6 zog ihn auf 0.9 („Grenz-Namen deckender“); der Kommentar drei Zeilen weiter oben sagte
	// die ganze Zeit weiter „halbtransparent“ -- der Wert und seine Begründung liefen auseinander.
	// Owner, wörtlich: „die grenznamen waren früher mal bitmap und leicht transparenz“.
	// Gewicht des mittleren Kontrollpunkts im (rationalen) B-Spline (1 = klassisch, >1 strafft). Global, live tunbar.
	let TERRITORY_LABEL_SPLINE_WEIGHT = 1;

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

	/**
	 * @param {CanvasRenderingContext2D} ctx
	 * @param {number} [zielZoom] Zoomstufe, FUER DIE gezeichnet werden soll -- nicht die aktuelle.
	 * @param {object} [zielCenter] Zugehoeriges Zentrum.
	 * 🔴 DIE VORAUSSETZUNG FUER DEN WECHSEL WAEHREND DES ZOOMS. Damit die neue Schrift schon
	 * hereinkommen kann, waehrend die Bewegung laeuft, muss sie existieren, bevor die Bewegung
	 * beginnt -- also fuer eine Stufe gezeichnet werden, auf der die Karte noch gar nicht steht.
	 * Leaflet gibt sie im zoomanim mit (`event.zoom`, `event.center`).
	 * ⚠️ Ohne die zwei Parameter verhaelt sich alles wie vorher -- der Pfad fuer Pan und moveend.
	 */
	function drawTerritoryBorderLabels(ctx, zielZoom, zielCenter) {
		const fuerZiel = Number.isFinite(Number(zielZoom)) && !!zielCenter;
		const zeichenZoom = fuerZiel ? zielZoom : map.getZoom();
		const size = map.getSize();
		const rd = Array.isArray(window.regionData) ? window.regionData : (typeof regionData !== "undefined" ? regionData : []);
		const labelable = rd.filter((f) => f && f.properties && f.properties.is_derived_geometry === true && !TERRITORY_LABEL_EXCLUDE.test(String(f.properties.name || "")));
		labelable.sort((a, b) => { // große Gebiete zuerst -> gewinnen die Kollision
			const ra = (a.geometry.type === "MultiPolygon" ? a.geometry.coordinates[0] : a.geometry.coordinates)[0].length;
			const rb = (b.geometry.type === "MultiPolygon" ? b.geometry.coordinates[0] : b.geometry.coordinates)[0].length;
			return rb - ra;
		});
		// 💣 `latLngToContainerPoint` liest IMMER den aktuellen Stand. Fuer die Zielstufe muss von
		// Hand projiziert werden -- das leistet die geteilte, nachgerechnete Zielprojektion aus
		// js/map-features/zoom-uebergang.js (getestet in __tests__/zoom-vorab-flaeche.test.js).
		const zielProj = fuerZiel ? avesmapsZoomZielProjektion(map, zielZoom, zielCenter) : null;
		const toPoint = zielProj
			? ((lng, lat) => zielProj(L.latLng(lat, lng)))
			: ((lng, lat) => map.latLngToContainerPoint(L.latLng(lat, lng)));
		// Peer-Grenzen EINMAL pro Daten-Load markieren (Features nach Reload neu -> _peerVertices undefined).
		if (labelable.length && labelable[0]._peerVertices === undefined) {
			computeTerritoryLabelMeta(labelable);
		}
		// Pro-Zoom-Werte (Slider via ?labeltune=1).
		const territoryFontSize = getTerritoryLabelFontSize(zeichenZoom);
		const territoryOffset = getTerritoryLabelOffset(zeichenZoom);
		const territoryDetail = getTerritoryLabelDetail(zeichenZoom);
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
	// Dieselbe Easing wie alle uebrigen Ebenen: die Klasse aktiviert (unter .leaflet-zoom-anim) die
	// gemeinsame Zoom-Transition -> Canvas easet im Gleichschritt mit Kacheln/Flaechen/SVG-Linien
	// statt sofort auf die Endgroesse zu springen.
	// 🔴 Seit 26.08.2026 steht sie in css/features/zoom-uebergang.css und ueberschreibt dort
	// Leaflets eigene Regel (ease-in-out statt cubic-bezier(0,0,0.25,1)); die Zahlen selbst liegen
	// in js/map-features/zoom-uebergang.js. Hier stand bis dahin die alte Kurve als Fliesstext --
	// ein Kommentar, der einen Wert abschreibt, ueberlebt dessen Aenderung nicht.
	canvas.classList.add("leaflet-zoom-animated");
	map.getPane(PANE).appendChild(canvas);
	const ctx = canvas.getContext("2d");

	// 🔴 DIE BESCHRIFTUNG BEKOMMT EINE EIGENE CANVAS -- und das ist der ganze Grund fuer diesen Umbau.
	// Owner 24.08.2026: „ich will, dass die grenzbeschriftungen animiert einblenden von z4 (0) --> z5
	// (0.75) in ... millisekunden ... halt nicht nur fuer die grenzbeschriftungen sondern fuer alles
	// auf der karte“. Gemeint ist eine ZEITANIMATION beim Ueberschreiten der Schwelle -- nicht eine
	// abgestufte Deckkraft je Zoomstufe (das war f6667300, zu Recht zurueckgenommen).
	// 💣 EINE CANVAS HAT NUR EINE DECKKRAFT. Solange Linien und Namen auf derselben Flaeche liegen,
	// kann man die Namen nicht blenden, ohne die Linien mitzublenden. Deshalb zwei Flaechen.
	// 💣 UND NEU ZEICHNEN GEHT NICHT: ein redraw() blockiert live gemessen 52-99 ms (Pan bei z5).
	// Eine 350-ms-Blende Bild fuer Bild waeren 5-10 Redraws -- die Karte stuende still. Die Deckkraft
	// EINES Elements animiert dagegen der Compositor, ohne den Hauptthread anzufassen; genau daran
	// liegt es, dass die Ortsmarkierungen (auch eine Canvas) so weich blenden.
	// 🔴 ZWEI BESCHRIFTUNGSFLAECHEN, NICHT EINE -- fuer die GLEICHZEITIGE Blende.
	// Owner 24.08.2026: „du blendest gerade aus und wieder ein, kann man das gleichzeitig?“
	// 💣 Mit EINER Flaeche ist das unmoeglich: sie verliert ihr altes Bild in dem Moment, in dem sie
	// das neue zeichnet. Es kann also nur nacheinander gehen. Zwei Flaechen halten das alte und das
	// neue Bild gleichzeitig -- die eine blendet ab, die andere auf, im selben Zeitfenster.
	// ⚠️ Sie tauschen nach jeder Ueberblendung die Rollen (kein Kopieren von Bitmaps): gezeichnet wird
	// immer in die HINTERE, danach werden die Zeiger getauscht. Das spart ein drawImage ueber die
	// volle Flaeche pro Zoomschritt.
	function baueLabelFlaeche() {
		const c = document.createElement("canvas");
		c.style.position = "absolute";
		c.style.pointerEvents = "none";
		c.style.top = "0";
		c.style.left = "0";
		c.style.transformOrigin = "0 0";
		c.style.opacity = "0";           // startet unsichtbar -> die erste Anzeige ist auch eine Blende
		c.classList.add("leaflet-zoom-animated", "avesmaps-border-label-canvas");
		map.getPane(PANE).appendChild(c); // NACH der Linien-Canvas -> zeichnet darueber
		return c;
	}
	const labelFlaechen = [baueLabelFlaeche(), baueLabelFlaeche()];
	let labelVorne = labelFlaechen[0];   // zeigt gerade das gueltige Bild
	let labelHinten = labelFlaechen[1];  // nimmt beim naechsten Zoom das neue Bild auf
	// ⭐ Zum Vergleichen ohne Deploy: ?crossfade=0 schaltet auf das alte Nacheinander zurueck
	// (nur die vordere Flaeche, erst aus, dann ein).
	const KREUZBLENDE_AN = (() => {
		try { return new URLSearchParams(window.location.search).get("crossfade") !== "0"; }
		catch (e) { return true; }
	})();
	// Erst nach einem Zoomschritt wird ueberblendet. Ein Pan zeichnet in dieselbe Flaeche weiter --
	// dort gibt es nichts zu ueberblenden, und ein Rollentausch waere ein Flackern ohne Anlass.
	let zoomSchrittOffen = false;
	// ⭐ ?parallelfade=0 stellt den Stand von vorher her: erst zoomen, dann die neue Schrift.
	const PARALLELBLENDE_AN = (() => {
		// 🔴 VORGABE WIEDER AN, seit 26.08.2026 nachts. Sie stand einen Abend auf AUS (c468ef1c),
		// weil das Einblenden waehrend der Bewegung zweimal Befunde erzeugt hatte. Die Ursache sass
		// NUR bei den Wegenamen (Doppelanmeldung von pfadLabelBlendeEin aus dem Vorabzeichnen,
		// behoben und gewacht von __tests__/wegenamen-parallelblende-ablauf.test.js); dieser Pfad
		// hier laeuft im Pruefstand __tests__/grenznamen-parallelblende-ablauf.test.js sauber
		// durch. Der Owner hat den AUS-Zustand noch am selben Abend beanstandet
		// („grenzbeschriftungen sind noch nicht im fading integriert -- frueher waren sie das").
		// ⚠️ Nachschub 26.08.2026: der Deploy-Lauf des Vorgabe-Commits (0c5d33a3) wurde vom
		// naechsten fremden Push verdraengt (§9, abgebrochener Lauf) -- erst der Commit mit dieser
		// Zeile hat die Datei wirklich hochgeladen. Nur eine Inhaltsaenderung heilt das.
		try { return new URLSearchParams(window.location.search).get("parallelfade") !== "0"; }
		catch (e) { return true; }
	})();
	// 💣 Wurde die Beschriftung schon im zoomanim gezeichnet? Dann darf der redraw am zoomend sie
	// NICHT noch einmal loeschen -- sonst waere die Flaeche unmittelbar nach der Blende leer, und
	// zwar genau dann, wenn alles fertig aussieht.
	let labelsVorabGezeichnet = false;
	// 🔴 Wieviel der Zoomdauer auf das AUSblenden entfaellt; der Rest gehoert dem Einblenden, mit
	// genau diesem Verzug. 0,45 heisst: ~112 ms raus, ~138 ms rein, kein Ueberlappen.
	// ⭐ ?labelstaffel=<0..1> zum Vergleichen -- 0 waere die echte Ueberblendung (und damit die
	// doppelte Schrift), 1 waere „nur raus".
	const AUSBLENDEN_ANTEIL = (() => {
		try {
			const roh = new URLSearchParams(window.location.search).get("labelstaffel");
			const wert = Number(roh);
			if (roh !== null && Number.isFinite(wert) && wert >= 0 && wert <= 1) { return wert; }
		} catch (e) { /* ohne Adresszeile die Vorgabe */ }
		return 0.45;
	})();
	// 💣 DAS BUDGET IST KUERZER ALS DER ZOOM, und das ist tragend: am Ende der Zoomdauer raeumt
	// Leaflet auf (Transitions loeschen, Flaeche neu setzen). Eine Blende, die dann noch
	// laeuft, wird abgeschnitten und ihr Rest springt in einem Bild -- Owner 26.08.2026:
	// „zuerst stabil, dann ploetzlich sprung auf neues". Mit ?zoomlupe war es richtig, weil
	// dort das Aufraeumen mitgedehnt wird; genau diese Gegenprobe hat den Wettlauf gezeigt.
	const BLENDEN_BUDGET_MS = avesmapsZoomBlendenBudgetMs();
	const AUSBLENDEN_MS = Math.max(60, Math.round(BLENDEN_BUDGET_MS * AUSBLENDEN_ANTEIL));
	const EINBLENDEN_MS = Math.max(60, BLENDEN_BUDGET_MS - AUSBLENDEN_MS);
	let labelCtx = labelVorne.getContext("2d");   // Kontext der Flaeche, in die gerade gezeichnet wird

	// Dauer der Blende. ⭐ Live probierbar ohne Deploy: ?labelfade=600 (ms).
	// ⚠️ Sie steht als CSS-Variable am Element, NICHT als Inline-`transition`: die Zoom-Animation
	// setzt `style.transition` fuer die Transform, und `transition` ist EINE Eigenschaft -- inline
	// gesetzt wuerde die eine die andere ausloeschen. Die zwei Regeln in css/features/map-labels.css
	// trennen das ueber die Spezifitaet: waehrend `.leaflet-zoom-anim` liegt, gewinnt die Transform.
	const TERRITORY_LABEL_FADE_MS = (() => {
		try {
			const roh = new URLSearchParams(window.location.search).get("labelfade");
			const wert = Number(roh);
			if (roh !== null && Number.isFinite(wert) && wert >= 0) { return wert; }
		} catch (e) { /* ohne Adresszeile die Vorgabe */ }
		return AVESMAPS_ZOOM_DAUER_MS;
	})();
	labelFlaechen.forEach((c) => c.style.setProperty("--border-label-fade", TERRITORY_LABEL_FADE_MS + "ms"));
	// Ausblenden beim Zoomschritt -- seit 26.08.2026 auf der GEMEINSAMEN Dauer und ab t = 0.
	// 🔴 Hier stand „EIGENER Wert und bewusst kuerzer als die 250 ms, sonst springt es beim
	// Neuzeichnen": das galt, solange das Ausblenden erst NACH dem Zoom lief. Seit es bei t = 0
	// beginnt, endet es genau dann, wenn die Zoomstufe sitzt -- und danach wird ohnehin neu
	// gezeichnet und eingeblendet. ?labelfadeout=<ms> bleibt als Stellschraube.
	const TERRITORY_LABEL_FADE_OUT_MS = (() => {
		try {
			const roh = new URLSearchParams(window.location.search).get("labelfadeout");
			const wert = Number(roh);
			if (roh !== null && Number.isFinite(wert) && wert >= 0) { return wert; }
		} catch (e) { /* ohne Adresszeile die Vorgabe */ }
		return AVESMAPS_ZOOM_DAUER_MS;
	})();
	labelFlaechen.forEach((c) => c.style.setProperty("--border-label-fade-out", TERRITORY_LABEL_FADE_OUT_MS + "ms"));

	// Die Easing der Zoom-Animation, wie sie Leaflets eigene Ebenen benutzen. Einmal benannt, weil
	// sie jetzt an zwei Stellen im selben Inline-String steht wie die Deckkraft.
	const TERRITORY_ZOOM_TRANSFORM = avesmapsZoomTransition("transform");

	// Ob beim letzten redraw wirklich Namen gezeichnet wurden. 🔴 Der Wert wird VOR den vorzeitigen
	// `return`s in redraw() zurueckgesetzt und erst an der Zeichenstelle gesetzt -- so stimmt die
	// Blende auch dann, wenn redraw() unterwegs aussteigt (Haken aus, falscher Modus).
	let grenzLabelsGezeichnet = false;

	/**
	 * Setzt die Blende auf den Stand des letzten redraw -- aber erst, wenn wirklich wieder gezeichnet
	 * wird.
	 * 💣 DIE ZWEI requestAnimationFrame SIND TRAGEND, NICHT VORSICHT. Am zoomend blockiert der
	 * Hauptthread live gemessen 215 ms (Standard) bis 836 ms (Politisch). Ein Uebergang, der dort
	 * startet, verstreicht vollstaendig, ohne dass ein Bild davon gezeichnet wird -- er ist fertig,
	 * sobald wieder gezeichnet werden kann, und sieht aus wie ein Sprung. Genau das hat der Owner am
	 * 24.08.2026 als „blippt und ist dann woanders“ gemeldet. Das erste Bild kommt NACH der
	 * synchronen Arbeit, das zweite erst, wenn davon etwas auf dem Schirm stand.
	 */
	function blendeNachZeichnung() {
		requestAnimationFrame(function () {
			requestAnimationFrame(function () {
				// Die frisch gezeichnete Flaeche auf (oder auf 0, wenn nichts zu zeigen war) ...
				const ziel = grenzLabelsGezeichnet ? "1" : "0";
				labelVorne.style.opacity = ziel;
				// ... und im SELBEN Bild die alte ab. Das ist die ganze Ueberblendung: zwei Uebergaenge,
				// gleiche Dauer, gleicher Startzeitpunkt. Die alte Flaeche behaelt ihre Zoom-Transform und
				// steht deshalb noch am richtigen Fleck, waehrend sie verschwindet.
				// 💣 HART AUF 0, NICHT UEBERBLENDET -- und das ist die Reparatur der doppelten Schrift
				// vom 26.08.2026 (Owner, per Aufzeichnung belegt: „AVENTURIEN" stand zweimal da,
				// senkrecht versetzt). Die hintere Flaeche hat ihre Blende bereits beim ZOOMSTART
				// bekommen. Laeuft die dort noch, ueberlappt ihr Rest mit der neuen Schrift -- und weil
				// beide an VERSCHIEDENEN Stellen stehen, liest sich das als doppelte Beschriftung.
				// 🪤 Meine Rechnung sagte, das koenne nicht sein: 250 ms Ausblenden ab t = 0, das neue
				// Bild erst nach dem zoomend. Der Fehler in der Rechnung war die ANNAHME, eine Blende
				// beginne im Augenblick des Setzens. Sie beginnt beim naechsten Stilabgleich, und der
				// Hauptthread ist beim Zoomstart mit dem Zeichnen aller Ebenen belegt.
				// ⚠️ Die Inline-Transition wird SOFORT wieder entfernt: `transition` ist EINE
				// Eigenschaft, und inline gewinnt -- sie stehenzulassen loeschte die CSS-Blendenregel
				// aus css/features/map-labels.css dauerhaft aus.
				if (KREUZBLENDE_AN) {
					labelHinten.style.transition = "none";
					labelHinten.style.opacity = "0";
					void labelHinten.offsetWidth;   // Zwischenstand erzwingen, sonst wirkt `none` nicht
					labelHinten.style.transition = "";
				}
				// 🔴 NUR DIE NAMEN BLENDEN, DIE LINIEN NICHT. Owner 24.08.2026: „kannst du die grenzen,
				// strassen und fluesse selber (nicht die labels!) stabil halten? labels sollen schoen ein und
				// ausblenden“. 🪤 d02eaec4 liess die Linien-Flaeche mitblenden und ging damit zu weit: eine
				// Grenze ist GEOMETRIE, die beim Zoomen stufenlos mitskaliert -- sie soll stehenbleiben wie
				// Kacheln, Wege und Fluesse. Nur was NICHT mitskaliert (Schrift, Marker) braucht die Blende,
				// damit sein Umschnitt nicht als Sprung im Bild steht.
				// ⚠️ Der Preis ist bekannt und gewollt: die Strichbreite springt beim Zoomschritt weiterhin
				// (BOUNDARY_WEAK_OUTER_WIDTH_BY_ZOOM: 3 / 4 / 6 px bei z4 / z5 / z6). Dem Owner ist das lieber
				// als eine blinkende Grenze.
			});
		});
	}

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
		const baseInnerWidth = fine ? INNER_LINE_WIDTH_FINE : (medium ? INNER_LINE_WIDTH_MEDIUM : INNER_LINE_WIDTH);
		const innerTuneZoom = map.getZoom();
		const innerWidth = baseInnerWidth * boundaryZoomVal(BOUNDARY_INNER_WIDTH_MUL_BY_ZOOM, innerTuneZoom, 1);
		const baseInnerDash = fine ? INNER_LINE_DASH_FINE : (medium ? INNER_LINE_DASH_MEDIUM : INNER_LINE_DASH);
		const innerDashPx = boundaryZoomVal(BOUNDARY_INNER_DASH_BY_ZOOM, innerTuneZoom, 0);
		const innerDashArr = innerDashPx > 0 ? [innerDashPx, Math.max(1, innerDashPx * 0.7)] : baseInnerDash;
		ctx.lineJoin = "round";
		ctx.globalAlpha = Math.max(0, Math.min(1, boundaryInnerAlphaFactor * boundaryZoomVal(BOUNDARY_INNER_ALPHA_MUL_BY_ZOOM, innerTuneZoom, 1)));
		ctx.setLineDash(innerDashArr);
		ctx.lineWidth = innerWidth;
		ctx.strokeStyle = INNER_LINE_COLOR;
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

	function redraw(force) {
		if (!map.getPane(PANE)) return;
		// Nur während der CSS-Zoom-Animation NICHT neu zeichnen: dort übernimmt die zoomanim-
		// Transform das weiche Mitskalieren. Bei flyTo/setView (Doppelklick, Orts-Fokus) gibt es
		// KEIN zoomanim, der View wird pro Frame real aktualisiert -> dort MUSS neu gezeichnet
		// werden, sonst bleiben die Grenzen stehen bis zum Zoom-Ende.
		// force=true (mode switch into political) bypasses the zoom-animation guard: a switch raises no
		// moveend/zoomend to clear cssZoomActive, so without this the borders stay blank until a manual
		// pan/zoom/resize. There is no real CSS zoom in flight on a mode switch, so drawing is safe.
		if (cssZoomActive && !force) return;
		if (force) {
			cssZoomActive = false;
			canvas.style.transition = "";
		}
		const size = map.getSize();
		const topLeft = map.containerPointToLayerPoint([0, 0]);
		L.DomUtil.setPosition(canvas, topLeft); // reine Translation -> setzt eine evtl. Zoom-Skalierung zurück
		canvasTopLeftLatLng = map.containerPointToLatLng([0, 0]);
		// HiDPI: Backing-Store in Geräte-Pixeln, CSS-Größe in Layout-Pixeln -> scharfe Grenzen/Grenz-Namen auf
		// Retina/Mobile (dpr 2–3); auf dpr 1 unverändert. Gezeichnet wird weiter in CSS-px (ctx mit dpr skaliert).
		const dpr = avesmapsCanvasDpr(TERRITORY_CANVAS_MAX_DPR);
		const pw = Math.round(size.x * dpr), ph = Math.round(size.y * dpr);
		if (canvas.width !== pw) canvas.width = pw;
		if (canvas.height !== ph) canvas.height = ph;
		if (canvas.style.width !== size.x + "px") canvas.style.width = size.x + "px";
		if (canvas.style.height !== size.y + "px") canvas.style.height = size.y + "px";
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		// 💣 DIE ZWEITE FLAECHE MUSS IM GLEICHSCHRITT BLEIBEN -- gleiche Lage, gleiche Groesse, gleicher
		// dpr. Liefe sie auseinander, staenden die Namen neben ihren Grenzen, und das saehe nach einem
		// Rechenfehler in der Geometrie aus statt nach zwei Flaechen. Deshalb Zeile fuer Zeile dasselbe,
		// direkt darunter und aus denselben Variablen.
		// 🔴 BEIM ZOOM WIRD IN DIE HINTERE FLAECHE GEZEICHNET, sonst in die vordere. Nur so ueberlebt
		// das alte Bild bis zur Ueberblendung. ⚠️ Die ausgehende Flaeche wird hier BEWUSST nicht
		// ausgerichtet: sie traegt noch die Zoom-Transform aus dem zoomanim und sitzt damit genau
		// richtig. Ein setPosition darauf wuerde sie im Moment des Ausblendens verspringen lassen.
		if (KREUZBLENDE_AN && zoomSchrittOffen) {
			const tausch = labelVorne; labelVorne = labelHinten; labelHinten = tausch;
			labelCtx = labelVorne.getContext("2d");
			zoomSchrittOffen = false;
		}
		const labelCanvas = labelVorne;
		L.DomUtil.setPosition(labelCanvas, topLeft);
		if (labelCanvas.width !== pw) labelCanvas.width = pw;
		if (labelCanvas.height !== ph) labelCanvas.height = ph;
		if (labelCanvas.style.width !== size.x + "px") labelCanvas.style.width = size.x + "px";
		if (labelCanvas.style.height !== size.y + "px") labelCanvas.style.height = size.y + "px";
		// 💣 EIN VORAB GEZEICHNETES BILD WIRD NICHT GELOESCHT. Bei der parallelen Blende hat der
		// zoomanim-Block die Beschriftung bereits fuer die Zielstufe gezeichnet; der redraw am
		// zoomend richtet die Flaeche dann nur noch aus.
		const labelsSchonDa = labelsVorabGezeichnet;
		labelsVorabGezeichnet = false;
		if (!labelsSchonDa) {
			labelCtx.setTransform(1, 0, 0, 1, 0, 0);
			labelCtx.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
			labelCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
		}
		// Ab hier gilt: erst wenn unten wirklich gezeichnet wurde, blendet die Flaeche ein.
		// 💣 ABER NICHT ZURUECKSETZEN, WENN VORAB GEZEICHNET WURDE. Die Flagge steht dann aus dem
		// zoomanim und sagt bereits die Wahrheit; blind auf false gezogen liesse
		// blendeNachZeichnung() die eben eingeblendete Schrift sofort wieder auf 0 gehen -- ein
		// Aufblitzen und Verschwinden genau im Moment des Fertigwerdens.
		if (!labelsSchonDa) { grenzLabelsGezeichnet = false; }
		blendeNachZeichnung();

		// Grenzen (Außen + Innen, OHNE Fuellung/Labels) zeichnen in political/deregraphic/ecosystem.
		// In "none" ("Nur Karte") bleibt das (geleerte) Canvas leer -> dort gewollt KEINE Grenzen; ohne
		// diese Sperre blieben beim Moduswechsel die alten Linien stehen (regionData bleibt bestehen).
		// Kraftlinien-Modus zeigt KEINE Grenzen mehr (nur Karte entsättigt + Kraftlinien + Nodices).
		const currentMapLayerMode = typeof getSelectedMapLayerMode === "function" ? getSelectedMapLayerMode() : "political";
		// Der "Grenzen"-Haken uebersteuert den Modus in BEIDE Richtungen: Haken aus nimmt die Grenzen
		// auch dort weg, wo der Modus sie zeigt; Haken an zeichnet sie auch dort, wo er sie sonst
		// unterdrueckt.
		// ⚠️ Diese Datei stand am 12.08.2026 in ihrer ALTEN Fassung auf dem Server (fuenf gescheiterte
		// Deploys), der Grenzen-Haken wirkte im Frontend also noch nicht. Nur eine Inhaltsaenderung heilt.
		// 🔴 Der Vorbehalt `IS_EDIT_MODE ?` ist am 12.08.2026 gefallen -- der Haken steht seither fuer
		// jeden Besucher im Anzeige-Menue an der Karte. `?? null` bleibt: fehlt das Element, entscheidet
		// der Modus allein, genau wie vorher.
		// ⚠️ Haken an in "none"/"original"/"powerlines" zeichnet nur, was bereits geladen IST: das Laden
		// haengt an TERRITORY_BOUNDARY_MODES (political-territory-loader.js), das dieser Haken nicht
		// anfasst. Deshalb graut das Anzeige-Menue die Zeile in genau diesen Ansichten aus, statt einen
		// Schalter anzubieten, der sichtbar nichts tut (js/ui/map-display-menu.js).
		const editorOverride = document.getElementById("toggleTerritoryBorders")?.checked ?? null;
		if (editorOverride === false) {
			return;
		}
		if (editorOverride !== true && !BOUNDARY_OVERLAY_MODES.includes(currentMapLayerMode)) {
			return;
		}
		// Regionen/Kraftlinien: Linien halb so deckend + Außenlinien uniform duenn; political: voll/abgestuft.
		const weakBoundaries = BOUNDARY_WEAK_MODES.includes(currentMapLayerMode);
		boundaryAlphaFactor = weakBoundaries ? getBoundaryWeakAlpha(map.getZoom()) : 1;
		boundaryInnerAlphaFactor = weakBoundaries ? getBoundaryInnerAlpha(map.getZoom()) : INNER_LINE_ALPHA;
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
			const baseOuterWidth = weakBoundaries
				? weakOuterWidth // Regionen/Kraftlinien: Konturbreite pro Zoom (kein Root-Verdicken/Fine)
				: (isRootBoundary
					? (fineOuterZoom ? OUTER_LINE_WIDTH_ROOT_FINE : OUTER_LINE_WIDTH_ROOT)
					: (fineOuterZoom ? OUTER_LINE_WIDTH_FINE : OUTER_LINE_WIDTH));
			const outerTuneZoom = map.getZoom();
			const outerWidth = baseOuterWidth * boundaryZoomVal(BOUNDARY_OUTER_WIDTH_MUL_BY_ZOOM, outerTuneZoom, 1);
			const outerDashPx = boundaryZoomVal(BOUNDARY_OUTER_DASH_BY_ZOOM, outerTuneZoom, 0);
			ctx.lineJoin = "round";
			ctx.globalAlpha = Math.max(0, Math.min(1, boundaryAlphaFactor * boundaryZoomVal(BOUNDARY_OUTER_ALPHA_MUL_BY_ZOOM, outerTuneZoom, 1)));
			ctx.setLineDash(outerDashPx > 0 ? [outerDashPx, outerDashPx] : []);
			ctx.lineWidth = outerWidth;
			ctx.strokeStyle = OUTER_LINE_COLOR || color;
			ctx.stroke();
			ctx.restore();

			// Innengrenzen: sichtbar wann immer die Derived existiert UND "Innengrenzen an"
			// (an die Außenkontur gekoppelt, NICHT ans Fuellband) -> die Unterteilungen
			// bleiben über alle Zoomstufen konsistent statt am Bandrand zu verschwinden.
			// Innengrenzen werden im Frontend jetzt GENAUSO wie im Editmode gezeigt: ab Zoom 1
			// (der drawInnerBoundaries-Guard haelt Zoom 0 aus), unabhaengig vom Anzeigeband. Frueher
			// waren sie im Frontend erst UEBER dem Band sichtbar (currentZoom > max_zoom); auf Wunsch
			// vereinheitlicht, damit die Unterteilungen auch bei Zoom 1 erscheinen (Naehte kaschiert).
			const showInnerHere = true;
			if (f.properties.show_inner_boundaries === true
				&& showInnerHere
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
			if (!labelsSchonDa) {
				drawTerritoryBorderLabels(labelCtx);
				grenzLabelsGezeichnet = true;
			}
		}
	}

	function hasDerivedData() {
		const rd = Array.isArray(window.regionData) ? window.regionData : (typeof regionData !== "undefined" ? regionData : []);
		return rd.some((f) => f && f.properties && f.properties.is_derived_geometry === true);
	}

	// Nach Karten-Interaktion lädt der politische Layer debounced+async neu -> ein paar
	// "settle"-Redraws holen den frischen regionData-Stand nach (unabhängig vom Loader-Hook).
	// 💣 DREI BLINDE NACHZIEH-ZEICHNUNGEN, und der Handler darueber laeuft am Zoomende ZWEIMAL
	// (Leaflet feuert `moveend` UND `zoomend`). Macht 2 + 6 = acht Voll-Neuzeichnungen je Zoomschritt,
	// je 52-99 ms. Hinter `?zoombuendel=1` werden sie gebuendelt und datengetrieben; ohne den
	// Schalter bleibt alles zeichengleich wie vorher. Siehe js/map-features/zeichen-buendel.js.
	const zeichneNachzug = avesmapsZeichenNachzugWennNeu(
		"grenzen-nachzug",
		redraw,
		() => (typeof regionData !== "undefined" ? regionData : null)
	);
	function scheduleSettleRedraws() {
		[120, 350, 800].forEach((delay) => window.setTimeout(zeichneNachzug, delay));
	}

	// Zwei Zoom-Mechaniken, unterschiedlich behandelt:
	// - CSS-Zoom (Buttons/Scroll): feuert 'zoomanim'. Leaflets interner Zoom springt sofort aufs
	//   Ziel, sichtbar easet eine CSS-Transform -> NICHT neu zeichnen, sondern die Canvas per
	//   Transform mitskalieren (mit Transition, wie Leaflets Ebenen).
	// - flyTo/setView-Animation (Doppelklick, Orts-Fokus): KEIN 'zoomanim', der View wird pro Frame
	//   real aktualisiert -> bei jedem 'zoom'-Frame neu zeichnen (ohne Transform/Transition).
	let cssZoomActive = false;
	// ⚠️ Am Zoomende feuert Leaflet `moveend` UND `zoomend`: dieser Handler laeuft zweimal und
	// zeichnete bisher zweimal voll. Gebuendelt wird daraus eine Zeichnung im naechsten Bild.
	const zeichneGebuendelt = avesmapsZeichenGebuendelt("grenzen", redraw);
	map.on("moveend zoomend viewreset resize", () => {
		cssZoomActive = false;
		canvas.style.transition = "";
		// 💣 UND AUF BEIDEN BESCHRIFTUNGSFLAECHEN. Seit die parallele Blende ihnen im zoomanim eine
		// INLINE-Transform-Transition gibt, ueberlebt die den Zoom -- und weil L.DomUtil.setPosition
		// per transform verschiebt, animiert danach JEDER Pan die Position nach. Owner 24.08.2026:
		// „wenn ich mit der maus panne, ziehen die 2x nach" (e85b31d1, und noch einmal im
		// zurueckgebauten Parallel-Versuch ed1e2e93). Auch die gerade UNSICHTBARE Flaeche: sie wird
		// beim naechsten Rollentausch die sichtbare.
		labelFlaechen.forEach((c) => { c.style.transition = ""; });
		zeichneGebuendelt();
		scheduleSettleRedraws();
	});
	// CSS-Zoom: Canvas weich mitskalieren (wie L.ImageOverlay._animateZoom), inkl. passender Easing.
	map.on("zoomanim", function (event) {
		if (!canvasTopLeftLatLng || typeof map._latLngToNewLayerPoint !== "function") {
			return;
		}
		cssZoomActive = true;
		canvas.style.transition = TERRITORY_ZOOM_TRANSFORM;   // NUR die Transform -- die Linien blenden nicht
		const scale = map.getZoomScale(event.zoom);
		const offset = map._latLngToNewLayerPoint(canvasTopLeftLatLng, event.zoom, event.center);
		L.DomUtil.setTransform(canvas, offset, scale);
		// 💣 DIE ZWEITE FLAECHE BRAUCHT DIESELBE TRANSFORM, SONST BLEIBT DIE SCHRIFT BEIM ZOOMEN STEHEN
		// und rutscht erst am zoomend an ihren Platz -- der Fehler saehe aus wie eine falsche Geometrie.
		// ⚠️ Ihre Transition kommt aus css/features/map-labels.css, NICHT inline: eine Inline-`transition`
		// wuerde die Blenden-Regel dauerhaft ausloeschen (es ist EINE Eigenschaft, und inline gewinnt).
		// Beide Beschriftungsflaechen mitskalieren -- die vordere zeigt noch das alte Bild und muss am
		// Kartenfleck kleben bleiben, die hintere bekommt gleich das neue.
		labelFlaechen.forEach((c) => L.DomUtil.setTransform(c, offset, scale));
		zoomSchrittOffen = true;
		// 🔴 UND WEGGEHEN, SOLANGE DER ZOOM LAEUFT. Owner 24.08.2026: „von zoom 6 auf 7 (beide
		// eingeblendet) springts“. An der Schwelle genuegte das Einblenden; zwischen zwei Stufen, auf
		// denen die Namen beide Male stehen, wechselt ihr INHALT (Lage, Schriftgroesse) und schneidet
		// hart um. Also erst weg, dann neu zeichnen, dann wieder einblenden -- genau das Mittel, mit dem
		// die Ortsmarkierungen ihr „Plopp“ loswerden (location-canvas-layer.js).
		// ⚠️ Die Dauer kommt aus der `.leaflet-zoom-anim`-Regel in css/features/map-labels.css; die
		// Klasse liegt hier bereits (Leaflet setzt sie VOR dem zoomanim-Ereignis), sonst spraenge es.
		// 🔴 SEIT 26.08.2026 WIRD IMMER AUSGEBLENDET -- auch bei der Ueberblendung, und ab t = 0.
		// Owner, nachdem die Siedlungsnamen es taten: „WOW zum erstenmal verschwinden die labels im
		// augenblick des reinzoomens!!!!! ... das bei allen beschriftungen wenns geht!"
		// Hier stand vorher `if (!KREUZBLENDE_AN)`: mit Ueberblendung blieb das alte Schriftbild
		// waehrend des ganzen Zooms stehen und wechselte erst danach.
		// ⚠️ Das Einblenden der NEUEN Schrift bleibt beim zoomend -- sie existiert vorher noch nicht.
		// Wer sie mitwandern lassen will, zeichnet im zoomanim fuer die Zielstufe und rechnet die
		// Flaeche gegen (Entwurf 2026-08-26-zoom-uebergang-konsistenz-design.md §5).
		// 💣 UND HIER KOMMT KEINE INLINE-TRANSITION HIN. Die Blendenregel steht in
		// css/features/map-labels.css; `transition` ist EINE Eigenschaft, und inline gewinnt -- eine
		// Inline-Zuweisung loeschte die CSS-Regel dauerhaft aus. Die Dauer kommt ueber die Variable
		// `--border-label-fade-out`.
		// 💣 UND DIE DAUER MUSS VOR DEM START STEHEN. Bei der gestaffelten Blende bekommt das
		// Ausblenden nur einen ANTEIL der Zoomdauer; wird die Variable erst danach geaendert,
		// laeuft die Blende bereits mit der alten Zahl -- und eine Dauer mitten im Uebergang zu
		// aendern ist ein zweites, undefiniertes Verhalten obendrauf.
		labelVorne.style.setProperty("--border-label-fade-out", AUSBLENDEN_MS + "ms");
		labelVorne.style.opacity = "0";

		// 🔴 UND HIER KOMMT DIE NEUE SCHRIFT SCHON WAEHREND DER BEWEGUNG HEREIN (Schritt 3).
		// ⭐ Das Zeichnen darf hier stehen, weil der Zoom eine CSS-Transform-Transition ist und auf
		// dem Compositor laeuft -- es haelt die Bewegung nicht an. Und es kommt nicht DAZU, es wird
		// VORGEZOGEN: der redraw am zoomend ueberspringt die Beschriftung dann.
		if (!PARALLELBLENDE_AN || !hasDerivedData()) { return; }
		if (!(TERRITORY_BORDER_LABELS_ENABLED
			&& (typeof getSelectedMapLayerMode === "function" ? getSelectedMapLayerMode() : "") === "deregraphic"
			&& Math.round(Number(event.zoom)) >= TERRITORY_LABEL_MIN_ZOOM)) { return; }
		const g = avesmapsZoomVorabFlaeche(map, event.zoom, event.center);
		if (!g) { return; }   // kuenftiges Leaflet ohne _latLngToNewLayerPoint -> Verhalten wie vorher

		// Rollen tauschen: in die bisher unsichtbare Flaeche kommt das neue Bild.
		const tausch = labelVorne; labelVorne = labelHinten; labelHinten = tausch;
		labelCtx = labelVorne.getContext("2d");
		zoomSchrittOffen = false;   // der Tausch ist hier schon passiert

		const groesse = map.getSize();
		const dprV = avesmapsCanvasDpr(TERRITORY_CANVAS_MAX_DPR);
		const pwV = Math.round(groesse.x * dprV), phV = Math.round(groesse.y * dprV);
		if (labelVorne.width !== pwV) labelVorne.width = pwV;
		if (labelVorne.height !== phV) labelVorne.height = phV;
		if (labelVorne.style.width !== groesse.x + "px") labelVorne.style.width = groesse.x + "px";
		if (labelVorne.style.height !== groesse.y + "px") labelVorne.style.height = groesse.y + "px";
		labelCtx.setTransform(1, 0, 0, 1, 0, 0);
		labelCtx.clearRect(0, 0, labelVorne.width, labelVorne.height);
		labelCtx.setTransform(dprV, 0, 0, dprV, 0, 0);
		grenzLabelsGezeichnet = false;
		drawTerritoryBorderLabels(labelCtx, event.zoom, event.center);
		grenzLabelsGezeichnet = true;
		labelsVorabGezeichnet = true;

		// 💣 DIE GEGENRECHNUNG -- aus der geteilten, nachgerechneten Funktion, nicht von Hand.
		// Das neue Bild liegt in ZIEL-Koordinaten, die Karte steht noch auf der alten Stufe. Die
		// Flaeche startet deshalb dort, wo die kuenftige linke obere Ecke JETZT liegt, auf
		// 1/Massstab geschrumpft, und animiert von da auf ihren Platz nach dem Zoom.
		labelVorne.style.transition = "none";
		L.DomUtil.setTransform(labelVorne, g.start, g.startMassstab);
		labelVorne.style.opacity = "0";
		void labelVorne.offsetWidth;   // Zwischenstand erzwingen, sonst gibt es keinen Uebergang

		// 🔴 GESTAFFELT, NICHT UEBERLAPPEND. Der Bauplan sah eine echte Ueberblendung vor -- alt und
		// neu gleichzeitig. Genau das hat am 26.08.2026 die doppelten Beschriftungen erzeugt (Owner
		// per Aufzeichnung: „AVENTURIEN" zweimal, senkrecht versetzt), denn zwischen zwei Zoomstufen
		// hat sich die Lage jeder Beschriftung verschoben. Also: erst raus, dann rein -- beides
		// INNERHALB der Zoomdauer. Siehe docs/kartenflaechen-und-zoomblenden.md §5a.
		// ⚠️ Beide Uebergaenge werden im SELBEN Augenblick gesetzt und nur durch `transition-delay`
		// getrennt. Startet der Stilabgleich verspaetet (Hauptthread beim Zoomstart), verschiebt sich
		// dadurch BEIDES gleich weit -- die Staffelung bleibt erhalten. Mit zwei getrennt gesetzten
		// Uebergaengen waere genau das nicht garantiert.
		labelVorne.style.transition = avesmapsZoomTransition("transform")
			+ ", opacity " + EINBLENDEN_MS + "ms " + AVESMAPS_ZOOM_KURVE + " " + AUSBLENDEN_MS + "ms";
		L.DomUtil.setTransform(labelVorne, g.ende, 1);
		labelVorne.style.opacity = "1";
	});
	// flyTo/setView: pro 'zoom'-Frame neu zeichnen (nur wenn KEIN CSS-Zoom läuft -> sonst Transform).
	map.on("zoom", function () { if (!cssZoomActive) redraw(); });

	// Live-Tuning-Panel der Grenzen als Grid pro Zoom (Außen/Innen: Dicke ×, Deckkraft ×, Strichelung), nur mit ?boundarytune=1.
	(function initBoundaryTunePanel() {
		let on = false;
		try { on = new URLSearchParams(window.location.search).has("boundarytune"); } catch (e) { on = false; }
		if (!on || !document.body) return;
		const panel = document.createElement("div");
		panel.style.cssText = "position:fixed;right:12px;top:12px;z-index:99999;background:rgba(28,28,28,0.92);color:#fff;font:12px Georgia,serif;padding:10px 12px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.45);width:230px;max-height:92vh;overflow:auto;";
		const title = document.createElement("div");
		title.textContent = "Grenzen-Tuning"; title.style.cssText = "font-weight:bold;margin-bottom:8px;";
		panel.appendChild(title);
		const sub = (t) => { const d = document.createElement("div"); d.textContent = t; d.style.cssText = "font-weight:bold;opacity:0.85;margin:10px 0 3px;"; panel.appendChild(d); };
		// Eine Zahl-Zelle im Grid; übernimmt + zeichnet live neu.
		const numCell = (value, min, max, step, apply) => {
			const input = document.createElement("input");
			input.type = "number"; input.min = min; input.max = max; input.step = step; input.value = value;
			input.style.cssText = "width:100%;box-sizing:border-box;background:#141414;color:#fff;border:1px solid #555;border-radius:3px;padding:2px;font:11px Georgia,serif;text-align:center;";
			input.addEventListener("input", () => { const v = parseFloat(input.value); if (Number.isFinite(v)) { apply(v); redraw(); } });
			return input;
		};
		// Grid pro Zoom (0..6): Spalten Dicke ×, Deckkraft ×, Strichelung (px). Je eine Tabelle für Außen/Innen.
		const buildGrid = (titleText, widthTable, alphaTable, dashTable) => {
			sub(titleText);
			const g = document.createElement("div");
			g.style.cssText = "display:grid;grid-template-columns:30px 1fr 1fr 1fr;gap:3px 4px;align-items:center;margin-bottom:4px;";
			["Zoom", "Dicke×", "Deckkr×", "Strich"].forEach((h) => { const c = document.createElement("div"); c.textContent = h; c.style.cssText = "opacity:0.6;font-size:10px;text-align:center;"; g.appendChild(c); });
			[0, 1, 2, 3, 4, 5, 6].forEach((z) => {
				const lbl = document.createElement("div"); lbl.textContent = String(z); lbl.style.cssText = "opacity:0.8;text-align:center;"; g.appendChild(lbl);
				g.appendChild(numCell(widthTable[z], 0, 3, 0.1, (v) => { widthTable[z] = v; }));
				g.appendChild(numCell(alphaTable[z], 0, 2, 0.05, (v) => { alphaTable[z] = v; }));
				g.appendChild(numCell(dashTable[z], 0, 16, 1, (v) => { dashTable[z] = v; }));
			});
			panel.appendChild(g);
		};
		buildGrid("Außengrenze (pro Zoom)", BOUNDARY_OUTER_WIDTH_MUL_BY_ZOOM, BOUNDARY_OUTER_ALPHA_MUL_BY_ZOOM, BOUNDARY_OUTER_DASH_BY_ZOOM);
		buildGrid("Innengrenze (pro Zoom)", BOUNDARY_INNER_WIDTH_MUL_BY_ZOOM, BOUNDARY_INNER_ALPHA_MUL_BY_ZOOM, BOUNDARY_INNER_DASH_BY_ZOOM);
		const okBtn = document.createElement("button");
		okBtn.textContent = "OK / Werte merken";
		okBtn.style.cssText = "width:100%;margin-top:10px;padding:7px;border:1px solid #5e4329;border-radius:6px;background:#7a5a3a;color:#fff;font:inherit;cursor:pointer;";
		okBtn.addEventListener("click", () => {
			window.__avesmapsBoundaryTune = {
				outerWidthMulByZoom: Object.assign({}, BOUNDARY_OUTER_WIDTH_MUL_BY_ZOOM),
				outerAlphaMulByZoom: Object.assign({}, BOUNDARY_OUTER_ALPHA_MUL_BY_ZOOM),
				outerDashByZoom: Object.assign({}, BOUNDARY_OUTER_DASH_BY_ZOOM),
				innerWidthMulByZoom: Object.assign({}, BOUNDARY_INNER_WIDTH_MUL_BY_ZOOM),
				innerAlphaMulByZoom: Object.assign({}, BOUNDARY_INNER_ALPHA_MUL_BY_ZOOM),
				innerDashByZoom: Object.assign({}, BOUNDARY_INNER_DASH_BY_ZOOM),
			};
			console.log("[Grenzen-Tuning] " + JSON.stringify(window.__avesmapsBoundaryTune));
			okBtn.textContent = "✓ gemerkt"; setTimeout(() => { okBtn.textContent = "OK / Werte merken"; }, 1500);
		});
		panel.appendChild(okBtn);
		const hint = document.createElement("div");
		hint.textContent = "Wirkt in Standard/Politisch. Dicke/Deckkraft = Faktor (×), Strich px (0 = außen durchgezogen / innen Muster), Dicke 0 = aus."; hint.style.cssText = "opacity:0.6;margin-top:6px;";
		panel.appendChild(hint);
		document.body.appendChild(panel);
	})();

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
			slider("Außengrenze Deckkraft", 0, 1, 0.05, BOUNDARY_WEAK_ALPHA_BY_ZOOM[z], (v) => { BOUNDARY_WEAK_ALPHA_BY_ZOOM[z] = v; });
			slider("Innengrenze Deckkraft", 0, 1, 0.05, BOUNDARY_WEAK_INNER_ALPHA_BY_ZOOM[z], (v) => { BOUNDARY_WEAK_INNER_ALPHA_BY_ZOOM[z] = v; });
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
				outerAlpha: { ...BOUNDARY_WEAK_ALPHA_BY_ZOOM },
				innerAlpha: { ...BOUNDARY_WEAK_INNER_ALPHA_BY_ZOOM },
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
	// ⚠️ 1 s, nicht 200 ms (bis 03.09.2026): fuenfmal je Sekunde ueber alle regionData, fuer jeden
	// Besucher in jeder Ansicht, auch in versteckten Tabs. Der Loader ruft redraw() nach jedem Laden
	// ohnehin selbst; der Poll ist nur das Sicherheitsnetz fuer Wege, die daran vorbeigehen.
	let lastDerivedSignature = null;
	window.setInterval(function () {
		if (document.hidden) { return; }
		const rd = Array.isArray(window.regionData) ? window.regionData : (typeof regionData !== "undefined" ? regionData : []);
		let sig = rd.length + "|";
		for (let i = 0; i < rd.length; i += 1) {
			const f = rd[i];
			if (f && f.properties && f.properties.is_derived_geometry === true) sig += (f.properties.public_id || "") + ",";
		}
		if (sig !== lastDerivedSignature) { lastDerivedSignature = sig; redraw(); }
	}, 1000);
	// Webfont (Faculty Glyphic) kann beim ersten Paint noch nicht geladen sein -> nach dem Laden neu zeichnen,
	// sonst zeigt das Canvas kurz den Georgia-Fallback.
	try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(redraw); } catch (e) { /* noop */ }
	redraw();
})();
