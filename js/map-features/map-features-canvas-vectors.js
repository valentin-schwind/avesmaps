// EXPERIMENTELL (Flag ?canvasvectors=1, default AUS): Wege/Fluesse ueber Leaflets eingebauten Canvas-Renderer
// statt SVG zeichnen. GEMESSEN 2026-06-09: KEIN Gewinn -- Zoom-Reprojektion 244ms (Canvas) vs 243ms (SVG),
// auch kein Pan-Vorteil. Grund: L.canvas reprojiziert trotzdem JEDEN Vertex jeder Polylinie und zeichnet alles
// neu; bei Linien dominieren die Punkte, nicht das Zeichenverfahren. Zusaetzlich wuerde Canvas die Fluss-/Weg-
// Labels brechen (kein SVG-<textPath> mehr). Daher DORMANT belassen (default AUS, null Produktionsrisiko: Flag
// aus -> renderer:undefined -> Leaflet-Default SVG, unveraendert), aber nicht entfernt -- Option fuer spaeter
// (z.B. falls Pfade im Tiefzoom gecullt werden). NICHT fuer Powerlines. Nur ausserhalb Edit-Modus.
const CANVAS_VECTORS_ENABLED = (() => {
	try {
		return new URLSearchParams(window.location.search).has("canvasvectors");
	} catch (error) {
		return false;
	}
})();

const _canvasVectorRenderers = {};

function getVectorRenderer(paneName) {
	if (!CANVAS_VECTORS_ENABLED || (typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE)) {
		return undefined; // -> Leaflet-Default-Renderer (SVG), unveraendertes Verhalten
	}
	if (!_canvasVectorRenderers[paneName]) {
		_canvasVectorRenderers[paneName] = L.canvas({ pane: paneName, padding: 0.3 });
	}
	return _canvasVectorRenderers[paneName];
}
