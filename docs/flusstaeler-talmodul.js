// Die Rechenstrecke der FLUSSTAELER im Hoehenfeld als PROTOTYP -- Laeufe verketten -> Talboden
// monoton fallend -> Segmentindex -> absenken.
//
// 🔴 HERAUSGELOEST AM 03.09.2026 aus docs/flusstaeler-hoehenfeld-mockup.html, wo dieser Block inline
// stand. Grund: docs/gebirge-kammanwuchs-mockup.html braucht dieselbe Rechnung, um Kamm-Anwuchs,
// Taeler und Erosion in EINER Kette zu zeigen -- und eine zweite Abschrift waere genau die Divergenz,
// vor der AGENTS.md an einem Dutzend Stellen warnt. Derselbe Schritt, den docs/kurvenlabel-pipeline.js
// am 24.08.2026 gegangen ist, mit derselben Begruendung. EIN Prototyp, zwei Leser.
//
// ⚠️ ER IST NICHT DIE PRODUKTION. Fall #109 ist ENTWORFEN, nicht gebaut (Entwurf
// docs/superpowers/specs/2026-09-03-flusstaeler-hoehenfeld-design.md, Bauplan
// docs/superpowers/plans/2026-09-03-flusstaeler-hoehenfeld.md, Aufgabe 1 macht daraus
// js/map-features/map-features-ecosystem-river-valley.js). Wer eine Zahl hier gegen eine Zahl von
// der Karte haelt, vergleicht einen Entwurf mit dem Ist-Zustand.
//
// Alles in KARTENkoordinaten [x, y], 1 Einheit = 3 Meilen = 3.000 Schritt (AGENTS.md §5).
/* ══ PROTOTYP-MODUL — wird zu js/map-features/map-features-ecosystem-river-valley.js ══ */
// PROTOTYP — Flusstäler im Höhenfeld (Fall #109). Reine Rechnung, kein DOM, kein Leaflet.
// Läuft unter Node (module.exports) und im Browser (Globals). Wird in Aufgabe 1 des Bauplans zu
// js/map-features/map-features-ecosystem-river-valley.js.

// Halbe Talbreite eines Flusses in KARTENEINHEITEN (1 Einheit = 3 Meilen = 3.000 Schritt).
const ECOSYSTEM_VALLEY_WIDTH = 1.5;
// Ein Bach (Flussweg mit is_bach) bekommt diesen Anteil der Talbreite.
const ECOSYSTEM_VALLEY_BACH_SHARE = 0.5;
// Ein Tal wird nie breiter als dieser Anteil des Abstands zum nächsten Gipfel -- so liest jeder
// Gipfel weiter genau seine Zahl (bei 0,5 liegt der Gipfel bei d >= 2w, also außerhalb des Tals).
const ECOSYSTEM_VALLEY_PEAK_SHARE = 0.5;
// Schrittweite, mit der ein Flusslauf entlang seiner Länge abgetastet wird (Karteneinheiten).
const ECOSYSTEM_VALLEY_SAMPLE_STEP = 0.5;
// Zwei Flussstücke gelten als verbunden, wenn ein Punkt des einen so nah an einem Punkt des anderen liegt.
const ECOSYSTEM_VALLEY_JOIN_TOLERANCE = 0.05;

function ecosystemValleyIsRiver(river) {
	return String(river?.properties?.feature_subtype || river?.subtype || "") === "Flussweg";
}

// Fließrichtung: "forward" = gespeicherte Reihenfolge ist Quelle -> Mündung, "reverse" umgekehrt.
function ecosystemValleyFlowDir(river) {
	const dir = river?.properties?.flow?.dir ?? river?.dir ?? null;
	return dir === "forward" || dir === "reverse" ? dir : null;
}

// Der Lauf in Fließrichtung, dicht abgetastet. Gespeicherte Stützpunkte bleiben erhalten, dazwischen
// wird aufgefüllt, damit der Talboden auch ZWISCHEN zwei weit auseinander liegenden Stützpunkten dem
// Gelände folgt statt einer Sehne.
function ecosystemValleyResample(coords, step) {
	const points = [];
	let s = 0;
	for (let i = 0; i < coords.length; i++) {
		const x = coords[i][0];
		const y = coords[i][1];
		if (i > 0) {
			const px = coords[i - 1][0];
			const py = coords[i - 1][1];
			const dx = x - px;
			const dy = y - py;
			const length = Math.sqrt(dx * dx + dy * dy);
			const pieces = Math.max(1, Math.ceil(length / step));
			for (let k = 1; k < pieces; k++) {
				const t = k / pieces;
				points.push({ x: px + dx * t, y: py + dy * t, s: s + length * t });
			}
			s += length;
		}
		points.push({ x, y, s });
	}
	return points;
}

function ecosystemValleyPointSegmentDistance(px, py, ax, ay, bx, by) {
	const dx = bx - ax;
	const dy = by - ay;
	const len2 = dx * dx + dy * dy;
	let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
	if (t < 0) { t = 0; } else if (t > 1) { t = 1; }
	const qx = ax + dx * t;
	const qy = ay + dy * t;
	return Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy));
}

function ecosystemValleyReverse(dense) {
	dense.reverse();
	const total = dense[0].s;
	dense.forEach((p) => { p.s = total - p.s; });
}

// Die Flussläufe EINES Feldes: orientiert, abgetastet, verkettet, mit Talboden und Talbreite je Punkt.
//
// `sampleUncarved(x, y)` liefert die Höhe des noch UNGESCHNITTENEN Feldes (samt Gipfelfenster).
// `peaks` sind ALLE wirksamen Gipfel (das verdichtete Gipfelfenster), nicht nur die eigenen.
function buildEcosystemRiverCourses(field, rivers, sampleUncarved, peaks, options) {
	const settings = options || {};
	const width = Number(settings.width) > 0 ? Number(settings.width) : ECOSYSTEM_VALLEY_WIDTH;
	const bachShare = Number.isFinite(Number(settings.bachShare)) ? Number(settings.bachShare) : ECOSYSTEM_VALLEY_BACH_SHARE;
	const peakShare = Number.isFinite(Number(settings.peakShare)) ? Number(settings.peakShare) : ECOSYSTEM_VALLEY_PEAK_SHARE;
	const step = Number(settings.step) > 0 ? Number(settings.step) : ECOSYSTEM_VALLEY_SAMPLE_STEP;
	const linear = settings.linear !== false;
	const bounds = field ? field.bounds : null;
	if (!bounds || !field.geometry || !Array.isArray(rivers)) {
		return { pieces: [], segments: [] };
	}
	const pad = width;
	const peakPoints = (Array.isArray(peaks) ? peaks : []).map((p) => ({ x: Number(p.x), y: Number(p.y) }));

	// 1. Auswahl + Orientierung + Abtastung. Sortiert nach public_id, damit Reihenfolge und damit
	//    Verkettung nicht an der Ladereihenfolge hängen (Determinismus).
	const pieces = [];
	const idOf = (river) => String((river.properties && river.properties.public_id) || river.id || "");
	const sorted = rivers.filter(ecosystemValleyIsRiver).slice().sort((a, b) => idOf(a).localeCompare(idOf(b)));
	for (const river of sorted) {
		const coords = river.geometry ? river.geometry.coordinates : null;
		if (!Array.isArray(coords) || coords.length < 2) { continue; }
		let touches = false;
		for (const c of coords) {
			if (c[0] >= bounds.min_x - pad && c[0] <= bounds.max_x + pad && c[1] >= bounds.min_y - pad && c[1] <= bounds.max_y + pad) { touches = true; break; }
		}
		if (!touches) { continue; }
		const dense = ecosystemValleyResample(coords, step);
		// 🔴 AUSSERHALB DER FLÄCHE SAGT DIESES FELD NICHTS -- nicht „null Höhe". Dieselbe Regel wie beim
		// Rasterleser (heightmap.php: „Outside is no data, NOT 0"). Ein Punkt außerhalb treibt den
		// Talboden nicht: sonst zöge ein Fluss, der von außen kommt, einen Canyon auf Fußhöhe 0 durch
		// das ganze Massiv, weil „außerhalb" in diesem Feld immer 0 ist.
		let inside = false;
		for (const p of dense) { p.inside = pointInGeometry([p.x, p.y], field.geometry); if (p.inside) { inside = true; } }
		if (!inside) { continue; }
		const dir = ecosystemValleyFlowDir(river);
		let guessed = false;
		if (dir === "reverse") {
			ecosystemValleyReverse(dense);
		} else if (dir === null) {
			// Rückfall: die Quelle liegt höher. Bei Gleichstand bleibt die gespeicherte Reihenfolge.
			const first = sampleUncarved(dense[0].x, dense[0].y);
			const last = sampleUncarved(dense[dense.length - 1].x, dense[dense.length - 1].y);
			guessed = true;
			if (last > first) { ecosystemValleyReverse(dense); }
		}
		const isBach = (river.properties && river.properties.is_bach === true) || river.bach === true;
		const baseWidth = width * (isBach ? bachShare : 1);
		dense.forEach((p) => { p.h = sampleUncarved(p.x, p.y); });
		// Talbreite je Punkt: die Grundbreite, gedeckelt durch den Gipfelabstand der ANGRENZENDEN Segmente --
		// so liegt jeder Punkt eines Segments mindestens 2w vom Gipfel entfernt, nicht nur die Stützpunkte.
		for (let i = 0; i < dense.length; i++) {
			let w = baseWidth;
			for (const peak of peakPoints) {
				if (i > 0) { w = Math.min(w, peakShare * ecosystemValleyPointSegmentDistance(peak.x, peak.y, dense[i - 1].x, dense[i - 1].y, dense[i].x, dense[i].y)); }
				if (i < dense.length - 1) { w = Math.min(w, peakShare * ecosystemValleyPointSegmentDistance(peak.x, peak.y, dense[i].x, dense[i].y, dense[i + 1].x, dense[i + 1].y)); }
			}
			dense[i].w = w;
		}
		pieces.push({
			publicId: idOf(river),
			name: String((river.properties && (river.properties.display_name || river.properties.name)) || river.name || ""),
			isBach,
			dirGuessed: guessed,
			points: dense,
			downstream: null,
			downstreamIndex: -1,
			tributaries: [],
		});
	}

	// 2. Verkettung: die Mündung eines Stücks trifft einen Punkt eines anderen -> dorthin fließt es.
	const tol = ECOSYSTEM_VALLEY_JOIN_TOLERANCE;
	const cell = Math.max(tol * 4, 0.2);
	const index = new Map();
	const keyOf = (x, y) => Math.floor(x / cell) + ":" + Math.floor(y / cell);
	pieces.forEach((piece, pi) => piece.points.forEach((p, i) => {
		const key = keyOf(p.x, p.y);
		if (!index.has(key)) { index.set(key, []); }
		index.get(key).push([pi, i]);
	}));
	pieces.forEach((piece, pi) => {
		const mouth = piece.points[piece.points.length - 1];
		let best = null;
		for (let cx = -1; cx <= 1; cx++) {
			for (let cy = -1; cy <= 1; cy++) {
				const list = index.get((Math.floor(mouth.x / cell) + cx) + ":" + (Math.floor(mouth.y / cell) + cy));
				if (!list) { continue; }
				for (const entry of list) {
					const qi = entry[0];
					const j = entry[1];
					if (qi === pi) { continue; }
					const q = pieces[qi].points[j];
					const d = Math.sqrt((q.x - mouth.x) * (q.x - mouth.x) + (q.y - mouth.y) * (q.y - mouth.y));
					if (d <= tol && (best === null || d < best.d || (d === best.d && qi < best.qi))) { best = { d, qi, j }; }
				}
			}
		}
		if (best) {
			piece.downstream = best.qi;
			piece.downstreamIndex = best.j;
			pieces[best.qi].tributaries.push(pi);
		}
	});

	// 3. Talboden: der kumulative Tiefstwert flussabwärts über den ganzen Baum (Wasser fließt nie
	//    bergauf), dann zwischen den Knoten linear gedeckelt. Topologische Reihenfolge: Zuflüsse zuerst.
	const state = new Array(pieces.length).fill(0);   // 0 = offen, 1 = in Arbeit, 2 = fertig
	const beds = new Array(pieces.length);
	function resolve(pi) {
		if (state[pi] === 2) { return beds[pi]; }
		if (state[pi] === 1) { return null; }          // Kreis (widersprüchliche Fließrichtungen) -> als Quelle behandeln
		state[pi] = 1;
		const piece = pieces[pi];
		const n = piece.points.length;
		const bed = new Float64Array(n);
		const incoming = new Map();                    // Punktindex -> tiefster einmündender Talboden
		for (const ti of piece.tributaries) {
			const tb = resolve(ti);
			if (tb === null) { continue; }
			const at = pieces[ti].downstreamIndex;
			// Eine Mündung AUSSERHALB der Fläche trägt nichts herein (siehe oben: außerhalb = keine Aussage).
			if (!piece.points[at].inside || !pieces[ti].points[pieces[ti].points.length - 1].inside) { continue; }
			const value = tb[tb.length - 1];
			incoming.set(at, Math.min(incoming.has(at) ? incoming.get(at) : Infinity, value));
		}
		let running = Infinity;
		let firstInside = -1;
		let lastInside = -1;
		for (let i = 0; i < n; i++) {
			if (piece.points[i].inside) {
				running = Math.min(running, piece.points[i].h);
				if (firstInside < 0) { firstInside = i; }
				lastInside = i;
			}
			if (incoming.has(i)) { running = Math.min(running, incoming.get(i)); }
			bed[i] = running;
		}
		// Vor dem ersten Innenpunkt gibt es noch keinen Talboden -- dort ist das Feld ohnehin 0. Damit die
		// Reihe trotzdem monoton lesbar bleibt, tragen diese Punkte den ersten bekannten Wert.
		for (let i = 0; i < n && bed[i] === Infinity; i++) { bed[i] = firstInside >= 0 ? bed[firstInside] : 0; }
		if (linear && firstInside >= 0) {
			const inner = Array.from(incoming.keys()).filter((k) => k > firstInside && k < lastInside).sort((a, b) => a - b);
			const knots = [firstInside].concat(inner, [lastInside]);
			for (let k = 0; k < knots.length - 1; k++) {
				const a = knots[k];
				const b = knots[k + 1];
				const sa = piece.points[a].s;
				const sb = piece.points[b].s;
				for (let i = a; i <= b; i++) {
					const t = sb > sa ? (piece.points[i].s - sa) / (sb - sa) : 0;
					const lin = bed[a] + (bed[b] - bed[a]) * t;
					if (lin < bed[i]) { bed[i] = lin; }
				}
			}
		}
		beds[pi] = bed;
		state[pi] = 2;
		return bed;
	}
	pieces.forEach((_, pi) => resolve(pi));

	// 4. Segmente für den Index
	const segments = [];
	pieces.forEach((piece, pi) => {
		const bed = beds[pi];
		piece.points.forEach((p, i) => { p.bed = bed[i]; });
		for (let i = 0; i < piece.points.length - 1; i++) {
			const a = piece.points[i];
			const b = piece.points[i + 1];
			if (a.w <= 0 && b.w <= 0) { continue; }
			segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, bedA: bed[i], bedB: bed[i + 1], wA: a.w, wB: b.w, piece: pi });
		}
	});

	return { pieces, segments };
}

// Zellindex der Talsegmente -- dasselbe Muster wie der Buckelindex (buildEcosystemHeightIndex): jedes
// Segment steht in allen Zellen, die sein um die Talbreite aufgeblasenes Rechteck berührt; eine Abfrage
// liest nur ihre eigene Zelle.
function buildEcosystemValleyIndex(segments, options) {
	if (!segments || !segments.length) { return null; }
	// Wie tief das Tal höchstens einschneidet, als Anteil der ÖRTLICHEN Höhe. 1 = bis auf den Talboden
	// (die reine Regel aus #109), darunter bleibt ein Rest stehen -- dort kann Wasser im Modell bergauf
	// fließen, dafür wird aus einem Grenzfluss kein Canyon. Ein Regler für die Abstimmung.
	const depthShare = options && Number.isFinite(Number(options.depthShare)) ? Math.max(0, Math.min(1, Number(options.depthShare))) : 1;
	let maxW = 0;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const s of segments) {
		maxW = Math.max(maxW, s.wA, s.wB);
		minX = Math.min(minX, s.ax, s.bx);
		maxX = Math.max(maxX, s.ax, s.bx);
		minY = Math.min(minY, s.ay, s.by);
		maxY = Math.max(maxY, s.ay, s.by);
	}
	const cell = Math.max(0.5, maxW);
	const originX = Math.floor((minX - maxW) / cell) * cell;
	const originY = Math.floor((minY - maxW) / cell) * cell;
	const width = Math.ceil((maxX + maxW - originX) / cell) + 1;
	const height = Math.ceil((maxY + maxW - originY) / cell) + 1;
	const grid = new Array(width * height);
	for (const s of segments) {
		const w = Math.max(s.wA, s.wB);
		const i0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - w - originX) / cell));
		const i1 = Math.min(width - 1, Math.floor((Math.max(s.ax, s.bx) + w - originX) / cell));
		const j0 = Math.max(0, Math.floor((Math.min(s.ay, s.by) - w - originY) / cell));
		const j1 = Math.min(height - 1, Math.floor((Math.max(s.ay, s.by) + w - originY) / cell));
		for (let j = j0; j <= j1; j++) {
			for (let i = i0; i <= i1; i++) {
				const key = j * width + i;
				(grid[key] || (grid[key] = [])).push(s);
			}
		}
	}
	return { grid, cell, originX, originY, width, height, segmentCount: segments.length, depthShare };
}

// Die Abfrage: das ungeschnittene Feld an (x,y) wird auf den Talboden gesenkt -- ganz am Fluss, gar nicht
// jenseits der Talbreite, dazwischen weich. Nie angehoben: die Fußhöhe-0-Invariante bleibt wörtlich.
function carveEcosystemValley(valley, x, y, height) {
	if (!valley || height <= 0) { return height; }
	const i = Math.floor((x - valley.originX) / valley.cell);
	const j = Math.floor((y - valley.originY) / valley.cell);
	if (i < 0 || j < 0 || i >= valley.width || j >= valley.height) { return height; }
	const list = valley.grid[j * valley.width + i];
	if (!list) { return height; }
	let carve = 0;
	const floor = height * (1 - valley.depthShare);
	for (let k = 0; k < list.length; k++) {
		const s = list[k];
		const dx = s.bx - s.ax;
		const dy = s.by - s.ay;
		const len2 = dx * dx + dy * dy;
		let t = len2 > 0 ? ((x - s.ax) * dx + (y - s.ay) * dy) / len2 : 0;
		if (t < 0) { t = 0; } else if (t > 1) { t = 1; }
		const w = s.wA + (s.wB - s.wA) * t;
		if (w <= 0) { continue; }
		const qx = s.ax + dx * t - x;
		const qy = s.ay + dy * t - y;
		const d2 = qx * qx + qy * qy;
		if (d2 >= w * w) { continue; }
		const u = Math.sqrt(d2) / w;
		const weight = 1 - u * u * (3 - 2 * u);
		let bed = s.bedA + (s.bedB - s.bedA) * t;
		if (bed < floor) { bed = floor; }
		const c = height > bed ? weight * (height - bed) : 0;
		if (c > carve) { carve = c; }
	}
	return height - carve;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		ECOSYSTEM_VALLEY_WIDTH, ECOSYSTEM_VALLEY_BACH_SHARE, ECOSYSTEM_VALLEY_PEAK_SHARE,
		ECOSYSTEM_VALLEY_SAMPLE_STEP, ECOSYSTEM_VALLEY_JOIN_TOLERANCE,
		ecosystemValleyResample, ecosystemValleyPointSegmentDistance,
		buildEcosystemRiverCourses, buildEcosystemValleyIndex, carveEcosystemValley,
	};
}

/* ══ PROTOTYP-MODUL ENDE ══ */
