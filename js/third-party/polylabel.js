/*
 * Vendored: mapbox/polylabel 1.1.0 (ISC) — "Pole of Inaccessibility": findet den Punkt im
 * Polygon mit maximalem Abstand zu allen Kanten ("dickste Stelle"), ideal als Label-Anker.
 * tinyqueue (ISC, binary heap) inline, damit die Datei ohne Build/Dependency lädt.
 * Exporte global: window.polylabel(polygon, precision) sowie window.avesmapsComputeLabelPoint(geometry).
 *
 * polygon = Array von Ringen; Ring = Array von [x, y]; erster Ring = Außenkontur, weitere = Löcher.
 * Rückgabe: [x, y] mit zusätzlicher .distance-Eigenschaft.
 */
(function (global) {
	"use strict";

	function TinyQueue(data, compare) {
		this.data = data || [];
		this.length = this.data.length;
		this.compare = compare || defaultCompare;
		if (this.length > 0) {
			for (var i = (this.length >> 1) - 1; i >= 0; i--) this._down(i);
		}
	}
	function defaultCompare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
	TinyQueue.prototype = {
		push: function (item) {
			this.data.push(item);
			this.length++;
			this._up(this.length - 1);
		},
		pop: function () {
			if (this.length === 0) return undefined;
			var top = this.data[0];
			this.length--;
			if (this.length > 0) {
				this.data[0] = this.data[this.length];
				this._down(0);
			}
			this.data.pop();
			return top;
		},
		_up: function (pos) {
			var data = this.data, compare = this.compare, item = data[pos];
			while (pos > 0) {
				var parent = (pos - 1) >> 1, current = data[parent];
				if (compare(item, current) >= 0) break;
				data[pos] = current;
				pos = parent;
			}
			data[pos] = item;
		},
		_down: function (pos) {
			var data = this.data, compare = this.compare, halfLength = this.length >> 1, item = data[pos];
			while (pos < halfLength) {
				var left = (pos << 1) + 1, right = left + 1, best = data[left];
				if (right < this.length && compare(data[right], best) < 0) { left = right; best = data[right]; }
				if (compare(best, item) >= 0) break;
				data[pos] = best;
				pos = left;
			}
			data[pos] = item;
		}
	};

	function compareMax(a, b) { return b.max - a.max; }

	function Cell(x, y, h, polygon) {
		this.x = x;
		this.y = y;
		this.h = h;
		this.d = pointToPolygonDist(x, y, polygon);
		this.max = this.d + this.h * Math.SQRT2;
	}

	function pointToPolygonDist(x, y, polygon) {
		var inside = false, minDistSq = Infinity;
		for (var k = 0; k < polygon.length; k++) {
			var ring = polygon[k];
			for (var i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
				var a = ring[i], b = ring[j];
				if ((a[1] > y !== b[1] > y) && (x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0])) inside = !inside;
				minDistSq = Math.min(minDistSq, getSegDistSq(x, y, a, b));
			}
		}
		return minDistSq === 0 ? 0 : (inside ? 1 : -1) * Math.sqrt(minDistSq);
	}

	function getCentroidCell(polygon) {
		var area = 0, x = 0, y = 0, points = polygon[0];
		for (var i = 0, len = points.length, j = len - 1; i < len; j = i++) {
			var a = points[i], b = points[j];
			var f = a[0] * b[1] - b[0] * a[1];
			x += (a[0] + b[0]) * f;
			y += (a[1] + b[1]) * f;
			area += f * 3;
		}
		if (area === 0) return new Cell(points[0][0], points[0][1], 0, polygon);
		return new Cell(x / area, y / area, 0, polygon);
	}

	function getSegDistSq(px, py, a, b) {
		var x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
		if (dx !== 0 || dy !== 0) {
			var t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
			if (t > 1) { x = b[0]; y = b[1]; }
			else if (t > 0) { x += dx * t; y += dy * t; }
		}
		dx = px - x;
		dy = py - y;
		return dx * dx + dy * dy;
	}

	function polylabel(polygon, precision) {
		precision = precision || 1.0;
		if (!polygon || !polygon.length || !polygon[0] || !polygon[0].length) return null;

		var minX, minY, maxX, maxY;
		for (var i = 0; i < polygon[0].length; i++) {
			var p = polygon[0][i];
			if (!i || p[0] < minX) minX = p[0];
			if (!i || p[1] < minY) minY = p[1];
			if (!i || p[0] > maxX) maxX = p[0];
			if (!i || p[1] > maxY) maxY = p[1];
		}

		var width = maxX - minX, height = maxY - minY;
		var cellSize = Math.min(width, height);
		var h = cellSize / 2;

		if (cellSize === 0) {
			var degenerate = [minX, minY];
			degenerate.distance = 0;
			return degenerate;
		}

		var cellQueue = new TinyQueue(undefined, compareMax);
		for (var x = minX; x < maxX; x += cellSize) {
			for (var y = minY; y < maxY; y += cellSize) {
				cellQueue.push(new Cell(x + h, y + h, h, polygon));
			}
		}

		var bestCell = getCentroidCell(polygon);
		var bboxCell = new Cell(minX + width / 2, minY + height / 2, 0, polygon);
		if (bboxCell.d > bestCell.d) bestCell = bboxCell;

		while (cellQueue.length) {
			var cell = cellQueue.pop();
			if (cell.d > bestCell.d) bestCell = cell;
			if (cell.max - bestCell.d <= precision) continue;
			h = cell.h / 2;
			cellQueue.push(new Cell(cell.x - h, cell.y - h, h, polygon));
			cellQueue.push(new Cell(cell.x + h, cell.y - h, h, polygon));
			cellQueue.push(new Cell(cell.x - h, cell.y + h, h, polygon));
			cellQueue.push(new Cell(cell.x + h, cell.y + h, h, polygon));
		}

		var best = [bestCell.x, bestCell.y];
		best.distance = bestCell.d;
		return best;
	}

	// Komfort-Helfer: bester Label-Punkt fuer GeoJSON Polygon/MultiPolygon (groesster Teil
	// nach polylabel-distance). Rueckgabe {x, y, distance} oder null.
	function avesmapsComputeLabelPoint(geometry) {
		if (!geometry || typeof polylabel !== "function") return null;
		var polys = geometry.type === "Polygon" ? [geometry.coordinates]
			: geometry.type === "MultiPolygon" ? geometry.coordinates
			: [];
		var best = null;
		for (var i = 0; i < polys.length; i++) {
			var rings = polys[i];
			if (!rings || !rings.length || !rings[0] || rings[0].length < 3) continue;
			try {
				var p = polylabel(rings, 1.0);
				if (p && (!best || (p.distance || 0) > (best.distance || 0))) {
					best = p;
				}
			} catch (error) {
				/* degenerierte Geometrie ueberspringen */
			}
		}
		if (!best) return null;
		return { x: best[0], y: best[1], distance: best.distance || 0 };
	}

	global.polylabel = polylabel;
	global.avesmapsComputeLabelPoint = avesmapsComputeLabelPoint;
})(typeof window !== "undefined" ? window : this);
