// Die Rechenstrecke des KAMM-ANWUCHSES als PROTOTYP -- Randabstand und Kammabstand zu einer Huelle,
// weichgezeichnet, bilinear gelesen.
//
// 🔴 HERAUSGELOEST, damit er unter Node pruefbar ist und ein zweiter Leser ihn nicht abschreiben
// muss -- derselbe Schritt wie bei docs/kurvenlabel-pipeline.js (24.08.2026) und
// docs/flusstaeler-talmodul.js (03.09.2026), mit derselben Begruendung.
//
// ⚠️ ER IST NICHT DIE PRODUKTION. Nichts davon ist in Avesmaps gebaut.
/* ══ PROTOTYP-MODUL — wuerde zu js/map-features/map-features-ecosystem-kamm.js ══ */
// PROTOTYP — Kamm-Anwuchs im Hoehenfeld. Reine Rechnung, kein DOM, kein Leaflet.
//
// 🔴 WAS ES IST. Eine Huelle 0..1 ueber der Flaeche: am Rand 0, auf der Beschriftungskurve 1,
// dazwischen monoton. Multipliziert wird damit ausschliesslich das RAUSCHEN des Feldes -- die
// Gipfelbuckel bleiben unberuehrt, sonst las ein 3.000er nicht mehr seine 3.000 (dieselbe Falle,
// die im Feldmodul schon Warping und Slope Weighting je einmal gekostet hat).
//
// 🔴 KEIN EIGENES MASS. `dRand / (dRand + dKamm)` ist selbstnormierend: kein Reichweitenwert,
// keine Staerke, keine Abfallkurve. Der einzige neue Wert ist der Blur, und der glaettet nur den
// Knick, den der Abstand zu einer Linie auf dieser Linie hat.
//
// Alles in KARTENkoordinaten 0..1024, nie in Bildschirmpunkten (AGENTS.md §5).

// Rasterweite der Huelle. Wie ECOSYSTEM_RIDGED_EDGE_GRID (48) eine Zahl, die glatt gelesen wird --
// hier feiner, weil der Kamm eine LINIE ist und ein grobes Raster sie verschmiert, bevor der Blur
// ueberhaupt greift. 128² = 16.384 Punkte je Flaeche, einmalig beim Feldbau.
const ECOSYSTEM_KAMM_GRID = 128;

// Abstand eines Punktes zur Kammlinie (Polylinie in Kartenkoordinaten).
// ⚠️ Zur STRECKE, nicht zu den Stuetzpunkten: die Server-Kurve hat 32 Punkte auf teils 100
// Einheiten Laenge, ein blosser Punktabstand gaebe eine Perlenkette statt eines Kamms.
function ecosystemKammDistance(line, x, y) {
	let best = Infinity;
	for (let i = 1; i < line.length; i++) {
		const ax = line[i - 1][0], ay = line[i - 1][1];
		const bx = line[i][0], by = line[i][1];
		const dx = bx - ax, dy = by - ay;
		const len2 = dx * dx + dy * dy;
		let t = 0;
		if (len2 > 0) {
			t = ((x - ax) * dx + (y - ay) * dy) / len2;
			t = t < 0 ? 0 : (t > 1 ? 1 : t);
		}
		const px = ax + t * dx, py = ay + t * dy;
		const d = Math.hypot(x - px, y - py);
		if (d < best) { best = d; }
	}

	return best === Infinity ? 0 : best;
}

// Das Huellenraster. Gerechnet wird NUR innerhalb der Flaeche; ausserhalb steht 0 -- dieselbe
// Regel wie beim Randabstandsraster des Gratverfahrens.
//
// 💣 `distanceToEcosystemEdge` und `pointInGeometry` kommen aus den ECHTEN Modulen. Ein Nachbau
// waere eine zweite Wahrheit ueber die Frage "wie weit ist der Rand?" -- und genau diese Frage
// entscheidet, wie breit das Gebirge auslaeuft.
function buildEcosystemKammIndex(field, line, options) {
	const opts = options || {};
	const blur = Number(opts.blur) > 0 ? Number(opts.blur) : 0;
	const bounds = field && field.bounds ? field.bounds : null;
	if (!bounds || !field.geometry || !Array.isArray(line) || line.length < 2) {
		return null;
	}
	const size = ECOSYSTEM_KAMM_GRID;
	const stepX = (bounds.max_x - bounds.min_x) / (size - 1);
	const stepY = (bounds.max_y - bounds.min_y) / (size - 1);
	let grid = new Float64Array(size * size);
	for (let j = 0; j < size; j++) {
		const y = bounds.min_y + j * stepY;
		for (let i = 0; i < size; i++) {
			const x = bounds.min_x + i * stepX;
			if (!pointInGeometry([x, y], field.geometry)) {
				continue;                                   // ausserhalb: 0, wie das Feld selbst
			}
			const dRand = distanceToEcosystemEdge([x, y], field.geometry);
			const dKamm = ecosystemKammDistance(line, x, y);
			const summe = dRand + dKamm;
			grid[j * size + i] = summe > 0 ? dRand / summe : 1;
		}
	}
	if (blur > 0) {
		grid = ecosystemKammBlur(grid, size, blur, stepX, stepY);
	}

	return {
		grid: grid,
		size: size,
		minX: bounds.min_x,
		minY: bounds.min_y,
		stepX: stepX > 0 ? stepX : 1,
		stepY: stepY > 0 ? stepY : 1,
		blur: blur,
	};
}

// Weichzeichnen: separierbarer Boxfilter, zweimal gefahren (zwei Boxen sind naeherungsweise ein
// Gauss und kosten nichts).
//
// 💣 Gemittelt wird nur ueber Zellen INNERHALB der Flaeche -- sonst zieht die 0 von draussen die
// Huelle am Rand nach unten und der Auslauf wandert nach innen. Die Randzelle mittelt also ueber
// weniger Nachbarn, und das ist richtig: sie soll ihren eigenen Wert behalten.
// ⚠️ Der Blur kann die Huelle am Rand ueber 0 heben. Das ist unschaedlich -- die Fusshoehe-0-
// Invariante haengt am kompakten Traeger der Buckel, nicht an dieser Huelle (sie FORMT nur, wie
// ecosystemEdgeEnvelope beim Gratverfahren; derselbe Kommentar steht dort).
function ecosystemKammBlur(grid, size, blur, stepX, stepY) {
	const rx = Math.max(1, Math.round(blur / stepX));
	const ry = Math.max(1, Math.round(blur / stepY));
	let src = grid;
	for (let pass = 0; pass < 2; pass++) {
		const tmp = new Float64Array(size * size);
		for (let j = 0; j < size; j++) {                     // waagerecht
			for (let i = 0; i < size; i++) {
				if (src[j * size + i] <= 0) { continue; }
				let sum = 0, n = 0;
				for (let k = -rx; k <= rx; k++) {
					const ii = i + k;
					if (ii < 0 || ii >= size) { continue; }
					const v = src[j * size + ii];
					if (v <= 0) { continue; }
					sum += v; n++;
				}
				tmp[j * size + i] = n > 0 ? sum / n : src[j * size + i];
			}
		}
		const out = new Float64Array(size * size);
		for (let j = 0; j < size; j++) {                     // senkrecht
			for (let i = 0; i < size; i++) {
				if (tmp[j * size + i] <= 0) { continue; }
				let sum = 0, n = 0;
				for (let k = -ry; k <= ry; k++) {
					const jj = j + k;
					if (jj < 0 || jj >= size) { continue; }
					const v = tmp[jj * size + i];
					if (v <= 0) { continue; }
					sum += v; n++;
				}
				out[j * size + i] = n > 0 ? sum / n : tmp[j * size + i];
			}
		}
		src = out;
	}

	return src;
}

// Die Huelle an einer Stelle, bilinear -- Zeile fuer Zeile die Bauform von ecosystemEdgeEnvelope.
function ecosystemKammEnvelope(index, x, y) {
	if (!index) {
		return 1;
	}
	const size = index.size;
	const fx = (x - index.minX) / index.stepX;
	const fy = (y - index.minY) / index.stepY;
	let i = Math.floor(fx);
	let j = Math.floor(fy);
	if (i < 0) { i = 0; } else if (i > size - 2) { i = size - 2; }
	if (j < 0) { j = 0; } else if (j > size - 2) { j = size - 2; }
	const tx = Math.min(1, Math.max(0, fx - i));
	const ty = Math.min(1, Math.max(0, fy - j));
	const g = index.grid;
	const a = g[j * size + i];
	const b = g[j * size + i + 1];
	const c = g[(j + 1) * size + i];
	const d = g[(j + 1) * size + i + 1];
	const top = a + (b - a) * tx;
	const bottom = c + (d - c) * tx;
	const v = top + (bottom - top) * ty;

	return v < 0 ? 0 : (v > 1 ? 1 : v);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { ECOSYSTEM_KAMM_GRID, ecosystemKammDistance, buildEcosystemKammIndex, ecosystemKammEnvelope };
}
