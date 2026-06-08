// EXPERIMENTELL (Flag ?canvasvectors=1, default AUS): Wege/Fluesse (spaeter ggf. Gebiets-Flaechen) ueber
// Leaflets eingebauten Canvas-Renderer statt SVG zeichnen. Vorteil bei Tiefzoom: keine SVG-Reprojektion
// pro Element, ein Canvas pro Pane; Z-Ordnung (eigene Pane je Renderer) sowie Klick/Hover-Hit-Testing
// bleiben via L.canvas erhalten. NICHT fuer Powerlines (CSS-Animation). Nur ausserhalb Edit-Modus
// (Vertex-/Geometrie-Edits bleiben SVG). Flag aus -> renderer:undefined -> Leaflet-Default (SVG), unveraendert.
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
