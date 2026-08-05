// Die gemeinsame Belegungskarte der Beschriftung -- der eine Ort, an dem steht, WO auf dem Bildschirm
// schon ein Name liegt.
//
// Warum es sie gibt: Ortsnamen, Landschafts-/Meerestitel und Gebietsnamen sind DOM-Marker und loesen
// ihre Ueberlagerungen in map-features-label-collisions.js auf. Weg- und Flussnamen dagegen malt
// map-features-path-label-canvas-overlay.js Glyphe fuer Glyphe auf ein Canvas. Bis 2026-08-05 wussten
// die beiden Welten nichts voneinander, und ein Strassenname legte sich mitten ueber einen Ortsnamen
// (Owner-Meldung mit Screenshot: „Reichsstrasse 1" quer ueber „Wehrheim"). Gemessen ueber die ganze
// Karte bei Zoom 4: 362 von 575 gezeichneten Wegnamen lagen ueber einem anderen Namen.
//
// Die Rangfolge ist die ganze Loesung: Gebietsnamen -> Landschaftstitel -> Ortsnamen -> zuletzt die
// Wegnamen. Wer zuerst steht, ist Hindernis fuer alle danach. Ein Wegname weicht dabei NICHT zur Seite
// aus (er gehoert auf seine Strasse), sondern rutscht an der eigenen Linie entlang; findet er dort
// nichts Freies, faellt die Platzierung aus -- sein Name steht alle ~600 px erneut am selben Weg.
//
// 💣 EIN KOORDINATENSYSTEM, UND ZWAR CONTAINER-PIXEL. Die DOM-Aufloesung misst mit
// getBoundingClientRect, das sind VIEWPORT-Koordinaten; das Canvas-Overlay rechnet in Container-Pixeln
// (map.latLngToContainerPoint). Umgerechnet wird EINMAL pro Pass beim Veroeffentlichen
// (publishLabelOccupancy), nicht je Label. Wer die Umrechnung vergisst, verschiebt jedes Hindernis um
// den Versatz der Karte auf der Seite -- die Ausweichentscheidungen stimmen dann fast, und „fast" sieht
// man genau dort, wo man es nicht sucht.

// Kantenlaenge einer Gitterzelle. Ein Kasten haengt in allen Zellen, die er beruehrt; eine Abfrage
// schaut nur in die Zellen unter dem eigenen Kasten. Ohne das Gitter verglichen sich pro Bild ein paar
// hundert Wegnamen-Kandidaten gegen ein paar hundert Namen -- mit ihm sind es die Nachbarn.
const LABEL_OCCUPANCY_CELL_PX = 128;

// Ueberlappen sich zwei achsenparallele Kaesten? Eigener Name, KEINE Doppelung von rectanglesOverlap
// aus map-features-label-collisions.js: zwei gleichnamige Funktionen in zwei Skripten sind eine
// Zeitbombe (die spaeter geladene gewinnt, siehe die Kollisions-Falle in AGENTS.md §7).
function labelBoxesOverlap(first, second) {
	return first.left < second.right
		&& first.right > second.left
		&& first.top < second.bottom
		&& first.bottom > second.top;
}

// Die vier Ecken eines Kastens -- Eingang fuer den SAT-Test unten.
function labelBoxCorners(box) {
	return [
		{ x: box.left, y: box.top },
		{ x: box.right, y: box.top },
		{ x: box.right, y: box.bottom },
		{ x: box.left, y: box.bottom },
	];
}

// Die vier Ecken einer GEDREHTEN Glyphe. Ein Buchstabe auf einem Weg steht auf der Tangente, sein
// Kasten ist also gedreht; die achsenparallele Huelle waere an schraegen Wegen deutlich zu gross und
// wuerde Namen wegwerfen, die in Wahrheit frei stehen.
function labelGlyphCorners(glyph) {
	const halfWidth = glyph.w / 2;
	const halfHeight = glyph.h / 2;
	const cos = Math.cos(glyph.ang);
	const sin = Math.sin(glyph.ang);
	return [[-halfWidth, -halfHeight], [halfWidth, -halfHeight], [halfWidth, halfHeight], [-halfWidth, halfHeight]]
		.map(([dx, dy]) => ({ x: glyph.x + dx * cos - dy * sin, y: glyph.y + dx * sin + dy * cos }));
}

// Separating-Axis-Test fuer zwei konvexe Vierecke. Pur -- unit-getestet in
// tools/paths/test-label-occupancy.mjs.
function labelPolygonsOverlap(firstPolygon, secondPolygon) {
	for (const polygon of [firstPolygon, secondPolygon]) {
		for (let i = 0; i < polygon.length; i += 1) {
			const start = polygon[i];
			const end = polygon[(i + 1) % polygon.length];
			const axisX = -(end.y - start.y);
			const axisY = end.x - start.x;
			let firstMin = Infinity;
			let firstMax = -Infinity;
			let secondMin = Infinity;
			let secondMax = -Infinity;
			for (const point of firstPolygon) {
				const value = point.x * axisX + point.y * axisY;
				if (value < firstMin) firstMin = value;
				if (value > firstMax) firstMax = value;
			}
			for (const point of secondPolygon) {
				const value = point.x * axisX + point.y * axisY;
				if (value < secondMin) secondMin = value;
				if (value > secondMax) secondMax = value;
			}
			if (firstMax < secondMin || secondMax < firstMin) {
				return false;
			}
		}
	}
	return true;
}

// Die Zellenschluessel, in denen ein Kasten haengt. Pur.
function labelOccupancyCellKeys(box, cellPx) {
	const size = Number(cellPx) > 0 ? Number(cellPx) : LABEL_OCCUPANCY_CELL_PX;
	const keys = [];
	const firstColumn = Math.floor(box.left / size);
	const lastColumn = Math.floor(box.right / size);
	const firstRow = Math.floor(box.top / size);
	const lastRow = Math.floor(box.bottom / size);
	for (let column = firstColumn; column <= lastColumn; column += 1) {
		for (let row = firstRow; row <= lastRow; row += 1) {
			keys.push(`${column}|${row}`);
		}
	}
	return keys;
}

function createLabelOccupancyGrid(cellPx = LABEL_OCCUPANCY_CELL_PX) {
	const cells = new Map();
	let queryStamp = 0;
	return {
		cellPx,
		// Zu Beginn JEDES Passes leeren, nicht am Ende. Bricht ein Pass frueh ab (keine sichtbaren
		// Labels), stuende sonst die Belegung des VORIGEN Bildes noch da, und Wegnamen wichen Namen
		// aus, die es nicht mehr gibt.
		reset() {
			cells.clear();
		},
		add(box) {
			if (!(box.right > box.left) || !(box.bottom > box.top)) {
				return;
			}
			labelOccupancyCellKeys(box, cellPx).forEach((key) => {
				const bucket = cells.get(key);
				if (bucket) {
					bucket.push(box);
					return;
				}
				cells.set(key, [box]);
			});
		},
		// Alle Kaesten in den beruehrten Zellen, jeder genau einmal. Die Entdopplung laeuft ueber einen
		// Stempel am Kasten statt ueber ein Set pro Abfrage -- die Abfrage laeuft je Kandidatenstelle
		// eines jeden Wegnamens, also ein paar hundert Mal pro Bild.
		hits(box) {
			queryStamp += 1;
			const found = [];
			labelOccupancyCellKeys(box, cellPx).forEach((key) => {
				const bucket = cells.get(key);
				if (!bucket) {
					return;
				}
				for (const candidate of bucket) {
					if (candidate._labelOccupancyStamp === queryStamp) {
						continue;
					}
					candidate._labelOccupancyStamp = queryStamp;
					found.push(candidate);
				}
			});
			return found;
		},
		isEmpty() {
			return cells.size === 0;
		},
	};
}

// Die eine Belegungskarte der Anwendung (Container-Pixel).
const avesmapsLabelOccupancy = createLabelOccupancyGrid(LABEL_OCCUPANCY_CELL_PX);

// Liegt irgendeine Glyphe dieser Platzierung auf einem schon gesetzten Namen? Zweistufig: erst die
// grobe Huelle gegen das Gitter (billig, meist leer), dann nur gegen diese wenigen Kaesten der genaue
// Test je Buchstabe.
function labelOccupancyBlocksGlyphs(grid, hullBox, glyphs) {
	if (!grid || !Array.isArray(glyphs) || glyphs.length === 0) {
		return false;
	}
	const near = grid.hits(hullBox);
	if (near.length === 0) {
		return false;
	}
	const nearCorners = near.map(labelBoxCorners);
	for (const glyph of glyphs) {
		const glyphCorners = labelGlyphCorners(glyph);
		for (const corners of nearCorners) {
			if (labelPolygonsOverlap(glyphCorners, corners)) {
				return true;
			}
		}
	}
	return false;
}

// Der Ursprung des Kartencontainers auf der Seite -- der Unterschied zwischen Viewport- und
// Container-Koordinaten.
// ⚠️ VOR der Schreibphase des Kollisionspasses aufrufen, nicht danach. Der Pass ist bewusst
// messen-rechnen-schreiben gebaut (ein erzwungener Reflow statt tausender, HEAD 72e0e167); ein
// getBoundingClientRect NACH dem Schreiben erzwingt einen zusaetzlichen Reflow und nimmt genau das
// wieder weg. Davor gelesen kostet es nichts -- es liegt in derselben Lesephase.
function readLabelOccupancyOrigin() {
	const container = typeof map !== "undefined" && map && typeof map.getContainer === "function"
		? map.getContainer()
		: null;
	if (!container) {
		return { left: 0, top: 0 };
	}
	const rect = container.getBoundingClientRect();
	return { left: rect.left, top: rect.top };
}

// Die Endlage der DOM-Beschriftung in die Belegungskarte schreiben. `viewportRects` sind die Rechtecke,
// die resolveLabelCollisions ohnehin schon ausgerechnet hat (Gebietsnamen inklusive, ausgeblendete
// Labels NICHT -- ein verstecktes Label ist kein Hindernis).
function publishLabelOccupancy(viewportRects, containerOrigin) {
	avesmapsLabelOccupancy.reset();
	if (!Array.isArray(viewportRects) || viewportRects.length === 0) {
		return;
	}
	const origin = containerOrigin || readLabelOccupancyOrigin();
	viewportRects.forEach((rect) => {
		avesmapsLabelOccupancy.add({
			left: rect.left - origin.left,
			right: rect.right - origin.left,
			top: rect.top - origin.top,
			bottom: rect.bottom - origin.top,
		});
	});
}
