// Die Rechenstrecke der Kurvenbeschriftung als PROTOTYP -- segmentieren -> vereinfachen ->
// Delaunay -> Innendreiecke -> Chordal Axis -> laengster Pfad -> glaetten.
//
// 🔴 HERAUSGELOEST AM 24.08.2026 aus docs/kurvenlabel-mockup.html, wo dieser Block inline stand.
// Grund: docs/landschaften-darstellung-mockup.html braucht dieselbe Rechnung fuer seine
// Kurven-Vorschau, und eine zweite Abschrift waere genau die Divergenz, vor der AGENTS.md an
// einem Dutzend Stellen warnt. EIN Prototyp, zwei Leser.
//
// ⚠️ ER IST NICHT DIE PRODUKTION. Live rechnet der SERVER die Kurve
// (api/_internal/app/curve-labels.php) und der Browser passt nur den Text darauf ein
// (js/map-features/curve-label-fit.js). Diese Datei ist Anschauung fuer die docs/-Mockups --
// wer eine Zahl hier gegen eine Zahl von der Karte haelt, vergleicht zwei verschiedene Laeufe.
//
// Alles in KARTENkoordinaten [x, y]; die Projektion auf den Schirm kommt spaeter und ist bei
// L.CRS.Simple eine reine Aehnlichkeitsabbildung, die Kurve also zoomunabhaengig.

(function (root) {
"use strict";

function dist(a, b) { const dx = a[0] - b[0], dy = a[1] - b[1]; return Math.hypot(dx, dy); }

function ringArea(ring) {
	let s = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		s += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
	}
	return s / 2;
}

function pointInRing(pt, ring) {
	let inside = false;
	const x = pt[0], y = pt[1];
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
		if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
	}
	return inside;
}

// rings[0] = Aussenring, rings[1..] = Loecher.
function pointInPolygon(pt, rings) {
	if (!pointInRing(pt, rings[0])) return false;
	for (let i = 1; i < rings.length; i += 1) if (pointInRing(pt, rings[i])) return false;
	return true;
}

// ---------- Schritt 2: vereinfachen (Douglas-Peucker) ----------
function dp(pts, tol) {
	if (pts.length < 3) return pts.slice();
	const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
	const stack = [[0, pts.length - 1]];
	while (stack.length) {
		const seg = stack.pop();
		const s = seg[0], e = seg[1];
		let maxD = -1, idx = -1;
		const ax = pts[s][0], ay = pts[s][1], bx = pts[e][0], by = pts[e][1];
		const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
		for (let i = s + 1; i < e; i += 1) {
			const px = pts[i][0] - ax, py = pts[i][1] - ay;
			let d;
			if (len2 === 0) d = Math.hypot(px, py);
			else { let t = (px * dx + py * dy) / len2; t = Math.max(0, Math.min(1, t)); d = Math.hypot(px - t * dx, py - t * dy); }
			if (d > maxD) { maxD = d; idx = i; }
		}
		if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
	}
	const out = [];
	for (let i = 0; i < pts.length; i += 1) if (keep[i]) out.push(pts[i]);
	return out;
}

function simplifyRing(ring, tol) {
	if (tol <= 0 || ring.length < 5) return ring;
	const closed = dist(ring[0], ring[ring.length - 1]) < 1e-9;
	const pts = closed ? ring.slice(0, -1) : ring.slice();
	if (pts.length < 5) return ring;
	// Ein geschlossener Ring hat keine natuerlichen Enden fuer DP -> die zwei am weitesten
	// auseinander liegenden Punkte als Anker nehmen und beide Haelften einzeln vereinfachen.
	let a = 0, b = 0, best = -1;
	for (let i = 1; i < pts.length; i += 1) { const d = dist(pts[0], pts[i]); if (d > best) { best = d; b = i; } }
	best = -1;
	for (let i = 0; i < pts.length; i += 1) { const d = dist(pts[b], pts[i]); if (d > best) { best = d; a = i; } }
	const lo = Math.min(a, b), hi = Math.max(a, b);
	if (hi - lo < 2 || (pts.length - (hi - lo)) < 2) return ring;
	const s1 = dp(pts.slice(lo, hi + 1), tol);
	const s2 = dp(pts.slice(hi).concat(pts.slice(0, lo + 1)), tol);
	const out = s1.concat(s2.slice(1, -1));
	return out.length >= 3 ? out.concat([out[0]]) : ring;
}

// ---------- Schritt 1: segmentieren ----------
function densifyRing(ring, spacing) {
	const out = [];
	for (let i = 0; i < ring.length - 1; i += 1) {
		const a = ring[i], b = ring[i + 1];
		const d = dist(a, b);
		out.push(a);
		if (d > spacing) {
			const n = Math.floor(d / spacing);
			for (let k = 1; k <= n; k += 1) {
				const t = k / (n + 1);
				out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
			}
		}
	}
	return out;
}

// ---------- Schritt 3: Delaunay (Bowyer-Watson) ----------
function circumcircle(ax, ay, bx, by, cx, cy) {
	const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
	if (Math.abs(d) < 1e-12) return null;
	const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
	const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
	const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
	return { x: ux, y: uy, r2: (ax - ux) * (ax - ux) + (ay - uy) * (ay - uy) };
}

function makeTri(pts, a, b, c) {
	return { a: a, b: b, c: c, cc: circumcircle(pts[a][0], pts[a][1], pts[b][0], pts[b][1], pts[c][0], pts[c][1]) };
}

function delaunay(points) {
	const n = points.length;
	if (n < 3) return [];
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const p of points) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
	const dm = Math.max(maxX - minX || 1, maxY - minY || 1) * 20;
	const mx = (minX + maxX) / 2, my = (minY + maxY) / 2;
	const pts = points.concat([[mx - dm, my - dm], [mx + dm, my - dm], [mx, my + dm]]);
	let tris = [makeTri(pts, n, n + 1, n + 2)];
	for (let i = 0; i < n; i += 1) {
		const px = pts[i][0], py = pts[i][1];
		const bad = [], good = [];
		for (const t of tris) {
			if (t.cc && ((px - t.cc.x) * (px - t.cc.x) + (py - t.cc.y) * (py - t.cc.y)) <= t.cc.r2 + 1e-9) bad.push(t); else good.push(t);
		}
		const edgeCount = new Map();
		for (const t of bad) {
			for (const e of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
				const k = e[0] < e[1] ? e[0] + "," + e[1] : e[1] + "," + e[0];
				const cur = edgeCount.get(k);
				if (cur) cur.n += 1; else edgeCount.set(k, { n: 1, a: e[0], b: e[1] });
			}
		}
		tris = good;
		for (const rec of edgeCount.values()) if (rec.n === 1) tris.push(makeTri(pts, rec.a, rec.b, i));
	}
	const out = [];
	for (const t of tris) if (t.a < n && t.b < n && t.c < n) out.push([t.a, t.b, t.c]);
	return out;
}

// ---------- Schritt 3b: Mittelachse aus den Innendreiecken (Chordal Axis) ----------
function chordalAxis(points, tris, rings) {
	const inner = [];
	for (const t of tris) {
		const a = t[0], b = t[1], c = t[2];
		const cx = (points[a][0] + points[b][0] + points[c][0]) / 3;
		const cy = (points[a][1] + points[b][1] + points[c][1]) / 3;
		if (!pointInPolygon([cx, cy], rings)) continue;
		// 💣 Der Schwerpunkt allein genuegt nicht: ein Dreieck ueber einer Bucht kann ihn drinnen
		// haben und trotzdem draussen verlaufen. Also auch die drei Kantenmitten pruefen -- ABER
		// ein Stueck zum Schwerpunkt hin gerueckt. Die Mitte einer RANDkante liegt exakt auf der
		// Polygonlinie, und dort ist der Strahlentest eine Muenze; ungerueckt fiel jedes
		// randstaendige Dreieck heraus und die Mittelachse zerfiel in Splitter (gemessen an den
		// Drachensteinen: Rohachse 2,2 statt 139 Einheiten). Eine Sehne UEBER eine Bucht holt der
		// Ruck nicht herein, dafuer sind 5 % zu wenig.
		// 💣 Und KEIN Deckel auf die Kantenlaenge: im Inneren einer breiten Flaeche sind die
		// Dreiecke von Natur aus gross -- ein Laengendeckel loescht genau die Achse, die man sucht.
		const nud = function (px, py) { return [px + (cx - px) * 0.05, py + (cy - py) * 0.05]; };
		if (!pointInPolygon(nud((points[a][0] + points[b][0]) / 2, (points[a][1] + points[b][1]) / 2), rings)) continue;
		if (!pointInPolygon(nud((points[b][0] + points[c][0]) / 2, (points[b][1] + points[c][1]) / 2), rings)) continue;
		if (!pointInPolygon(nud((points[c][0] + points[a][0]) / 2, (points[c][1] + points[a][1]) / 2), rings)) continue;
		inner.push({ v: t, cx: cx, cy: cy });
	}
	const edgeKey = function (i, j) { return i < j ? i + "," + j : j + "," + i; };
	const edgeUse = new Map();
	for (let ti = 0; ti < inner.length; ti += 1) {
		const v = inner[ti].v;
		for (const e of [[v[0], v[1]], [v[1], v[2]], [v[2], v[0]]]) {
			const k = edgeKey(e[0], e[1]);
			const cur = edgeUse.get(k);
			if (cur) cur.push(ti); else edgeUse.set(k, [ti]);
		}
	}
	const nodes = [], adj = [], nodeIdx = new Map();
	function addNode(key, x, y) {
		if (nodeIdx.has(key)) return nodeIdx.get(key);
		const id = nodes.length; nodes.push([x, y]); nodeIdx.set(key, id); adj.push([]); return id;
	}
	function link(u, v) {
		const w = dist(nodes[u], nodes[v]);
		adj[u].push([v, w]); adj[v].push([u, w]);
	}
	// Ein Dreieck mit 3 inneren Kanten ist eine Verzweigung (Stern ueber den Schwerpunkt),
	// mit 2 ein Durchgang, mit 1 eine Spitze (bis zur gegenueberliegenden Ecke).
	for (let ti = 0; ti < inner.length; ti += 1) {
		const v = inner[ti].v;
		const a = v[0], b = v[1], c = v[2];
		const shared = [];
		for (const e of [[a, b], [b, c], [c, a]]) if ((edgeUse.get(edgeKey(e[0], e[1])) || []).length === 2) shared.push(e);
		if (shared.length === 0) continue;
		const midId = function (e) {
			return addNode("e" + edgeKey(e[0], e[1]), (points[e[0]][0] + points[e[1]][0]) / 2, (points[e[0]][1] + points[e[1]][1]) / 2);
		};
		if (shared.length === 3) {
			const cId = addNode("t" + ti, inner[ti].cx, inner[ti].cy);
			for (const e of shared) link(cId, midId(e));
		} else if (shared.length === 2) {
			link(midId(shared[0]), midId(shared[1]));
		} else {
			const e = shared[0];
			const apex = [a, b, c].filter(function (x) { return x !== e[0] && x !== e[1]; })[0];
			link(midId(e), addNode("v" + apex, points[apex][0], points[apex][1]));
		}
	}
	return { nodes: nodes, adj: adj, innerTris: inner };
}

// ---------- Schritt 4: die „beste" Mittellinie = laengster Pfad ----------
function farthest(nodes, adj, start) {
	const n = nodes.length;
	const dists = new Float64Array(n).fill(Infinity);
	const prev = new Int32Array(n).fill(-1);
	const done = new Uint8Array(n);
	dists[start] = 0;
	for (;;) {
		let u = -1, bd = Infinity;
		for (let i = 0; i < n; i += 1) if (!done[i] && dists[i] < bd) { bd = dists[i]; u = i; }
		if (u < 0) break;
		done[u] = 1;
		for (const e of adj[u]) if (dists[u] + e[1] < dists[e[0]]) { dists[e[0]] = dists[u] + e[1]; prev[e[0]] = u; }
	}
	let best = start, bd = -1;
	for (let i = 0; i < n; i += 1) if (dists[i] < Infinity && dists[i] > bd) { bd = dists[i]; best = i; }
	return { node: best, prev: prev };
}

function longestPath(nodes, adj) {
	if (!nodes.length) return [];
	const a = farthest(nodes, adj, 0);
	const b = farthest(nodes, adj, a.node);
	const path = [];
	let cur = b.node, guard = 0;
	while (cur !== -1 && guard++ < nodes.length + 5) { path.push(nodes[cur]); cur = b.prev[cur]; }
	return path.reverse();
}

// ---------- Schritt 5: glaetten ----------
function lineLength(line) {
	let L = 0;
	for (let i = 1; i < line.length; i += 1) L += dist(line[i - 1], line[i]);
	return L;
}

function resample(line, n) {
	if (line.length < 2) return line.slice();
	const cum = [0];
	for (let i = 1; i < line.length; i += 1) cum.push(cum[i - 1] + dist(line[i - 1], line[i]));
	const L = cum[cum.length - 1];
	if (L <= 0) return line.slice();
	const out = [];
	let seg = 1;
	for (let k = 0; k < n; k += 1) {
		const target = (L * k) / (n - 1);
		while (seg < cum.length - 1 && cum[seg] < target) seg += 1;
		const t = (target - cum[seg - 1]) / ((cum[seg] - cum[seg - 1]) || 1);
		out.push([
			line[seg - 1][0] + (line[seg][0] - line[seg - 1][0]) * t,
			line[seg - 1][1] + (line[seg][1] - line[seg - 1][1]) * t,
		]);
	}
	return out;
}

function movingAverage(line, passes, win) {
	let cur = line.map(function (p) { return p.slice(); });
	for (let p = 0; p < passes; p += 1) {
		const src = cur;
		cur = src.map(function (pt, i) {
			let sx = 0, sy = 0, c = 0;
			for (let k = -win; k <= win; k += 1) {
				const j = i + k;
				if (j < 0 || j >= src.length) continue;
				sx += src[j][0]; sy += src[j][1]; c += 1;
			}
			return [sx / c, sy / c];
		});
	}
	return cur;
}

// Polynom-Fit im Hauptachsen-Frame. Die ruhigste aller Glaettungen, weil das Ergebnis von Bauart
// her EINE weiche Biegung ist und kein geglaetteter Zickzack -- Schrift auf einem Zickzack ist
// unlesbar, lange bevor die Kurve „falsch" waere.
function polyFit(line, degree) {
	const n = line.length;
	if (n < degree + 2) return line.slice();
	let mx = 0, my = 0;
	for (const p of line) { mx += p[0]; my += p[1]; }
	mx /= n; my /= n;
	let sxx = 0, sxy = 0, syy = 0;
	for (const p of line) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
	const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
	const ct = Math.cos(theta), st = Math.sin(theta);
	const U = [], V = [];
	for (const p of line) { const dx = p[0] - mx, dy = p[1] - my; U.push(dx * ct + dy * st); V.push(-dx * st + dy * ct); }
	const m = degree + 1;
	const A = [];
	for (let r = 0; r < m; r += 1) A.push(new Float64Array(m + 1));
	for (let i = 0; i < n; i += 1) {
		const pw = [1];
		for (let k = 1; k < 2 * m; k += 1) pw.push(pw[k - 1] * U[i]);
		for (let r = 0; r < m; r += 1) {
			for (let c = 0; c < m; c += 1) A[r][c] += pw[r + c];
			A[r][m] += pw[r] * V[i];
		}
	}
	for (let col = 0; col < m; col += 1) {
		let piv = col;
		for (let r = col + 1; r < m; r += 1) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
		if (Math.abs(A[piv][col]) < 1e-12) return line.slice();
		const tmp = A[col]; A[col] = A[piv]; A[piv] = tmp;
		for (let r = 0; r < m; r += 1) {
			if (r === col) continue;
			const f = A[r][col] / A[col][col];
			for (let c = col; c <= m; c += 1) A[r][c] -= f * A[col][c];
		}
	}
	const coef = [];
	for (let r = 0; r < m; r += 1) coef.push(A[r][m] / A[r][r]);
	const out = [];
	for (let i = 0; i < n; i += 1) {
		let v = 0, p = 1;
		for (let k = 0; k < m; k += 1) { v += coef[k] * p; p *= U[i]; }
		out.push([mx + U[i] * ct - v * st, my + U[i] * st + v * ct]);
	}
	return out;
}

// 💣 Ein Gebirge ist selten EINE Flaeche. Die Koschberge liegen in zwei Lappen (59 % / 41 %), und
// die Mittelachse der groesseren allein endet mitten im Gebirge -- das Label beschriftet dann die
// halbe Kette. Deshalb: die Mittelachsen ALLER wesentlichen Teile als EINE Punktwolke nehmen und
// EIN Polynom hindurchlegen. Die Luecke zwischen den Lappen ueberbrueckt die Kurve von selbst,
// weil sie ueber die Hauptachse parametrisiert ist und nicht ueber die Flaeche laeuft.
// ⚠️ Das ist bewusst nur fuer die BESCHRIFTUNG richtig, nicht als Geometrie: die Kurve verlaesst
// zwischen zwei Lappen die Flaeche. Genau das tut eine Kartenbeschriftung auch.
function polyFitSpanning(clouds, degree, samples) {
	const pts = [];
	for (const c of clouds) for (const p of c) pts.push(p);
	const n = pts.length;
	if (n < degree + 2) return null;
	let mx = 0, my = 0;
	for (const p of pts) { mx += p[0]; my += p[1]; }
	mx /= n; my /= n;
	let sxx = 0, sxy = 0, syy = 0;
	for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
	const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
	const ct = Math.cos(theta), st = Math.sin(theta);
	const paare = pts.map(function (p) {
		const dx = p[0] - mx, dy = p[1] - my;
		return [dx * ct + dy * st, -dx * st + dy * ct];
	}).sort(function (a, b) { return a[0] - b[0]; });
	const gefittet = polyFit(paare.map(function (uv) { return [mx + uv[0] * ct - uv[1] * st, my + uv[0] * st + uv[1] * ct]; }), degree);
	return resample(gefittet, samples);
}

function straighten(line, amount) {
	if (amount <= 0 || line.length < 2) return line;
	const a = line[0], b = line[line.length - 1];
	const cum = [0];
	for (let i = 1; i < line.length; i += 1) cum.push(cum[i - 1] + dist(line[i - 1], line[i]));
	const L = cum[cum.length - 1] || 1;
	return line.map(function (p, i) {
		const t = cum[i] / L;
		return [p[0] + (a[0] + (b[0] - a[0]) * t - p[0]) * amount, p[1] + (a[1] + (b[1] - a[1]) * t - p[1]) * amount];
	});
}

function centerlineForRings(rings, opts) {
	const o = Object.assign({ spacing: 1.0, simplifyTol: 0.3, mode: "poly", polyDegree: 3, smoothPasses: 4, smoothWindow: 3, samples: 120, straighten: 0 }, opts || {});
	const simplified = rings.map(function (r) { return simplifyRing(r, o.simplifyTol); });
	let pts = [];
	for (const r of simplified) pts = pts.concat(densifyRing(r, o.spacing));
	const seen = new Set(), uniq = [];
	for (const p of pts) { const k = p[0].toFixed(4) + "," + p[1].toFixed(4); if (!seen.has(k)) { seen.add(k); uniq.push(p); } }
	if (uniq.length < 4) return null;
	const tris = delaunay(uniq);
	const axis = chordalAxis(uniq, tris, simplified);
	if (!axis.nodes.length) return null;
	const raw = longestPath(axis.nodes, axis.adj);
	if (raw.length < 2) return null;
	let line = resample(raw, o.samples);
	line = o.mode === "mittel" ? movingAverage(line, o.smoothPasses, o.smoothWindow) : polyFit(line, o.polyDegree);
	line = straighten(line, o.straighten);
	return { line: line, raw: raw, axis: axis, points: uniq, tris: tris, rings: simplified, length: lineLength(line) };
}

function geometryParts(geoms) {
	const out = [];
	for (const g of geoms) {
		const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
		for (const rings of polys) out.push({ rings: rings, area: Math.abs(ringArea(rings[0])) });
	}
	return out.sort(function (a, b) { return b.area - a.area; });
}

root.AvesKurve = {
	dist: dist, ringArea: ringArea, pointInPolygon: pointInPolygon, lineLength: lineLength,
	resample: resample, centerlineForRings: centerlineForRings, geometryParts: geometryParts,
	polyFitSpanning: polyFitSpanning, straighten: straighten,
};
})(window);
