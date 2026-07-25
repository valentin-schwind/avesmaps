// Sichtbarkeit der Landschaften-Ebene ("Landschaften (Erprobung)", mapLayerMode=ecosystem).
//
// Diese Ebene teilt sich mit der politischen Ebene NICHTS -- weder Registry noch Sync-Funktion noch
// Namen. Das ist kein Purismus, sondern die Antwort auf drei nachgewiesene Fallen:
//
//  1. `regionPolygons` mitbenutzen geht nicht: clearRenderedRegionLayers()
//     (map-features-region-rendering.js) leert die Liste bei jedem moveend. Eine Landschaftsflaeche
//     darin waere nach dem ersten Schwenk aus der Registry verschwunden, waehrend ihr Layer noch auf
//     der Karte liegt -- ein Leck, das sich als "verschwindet beim Schwenken" zeigt.
//  2. `syncRegionVisibility` erweitern geht nicht: die Funktion existiert ZWEIMAL
//     (political-region-visibility.js und der Territorien-Loader). Der Loader gewinnt und installiert
//     sich zusaetzlich dreimal zeitverzoegert nach. Welche Fassung eine Erweiterung traefe, haengt am
//     Timing.
//  3. Gleichnamige Funktionen gehen nicht: map-features-region-vertex-detach-edit.js ueberschreibt
//     sieben window.*-Handler zur Laufzeit. Ein doppelter Name killt die POLITISCHE Ebene, nicht diese.
//
// In V1 ist die Registry immer leer -- es gibt noch nichts zu zeichnen. Die Funktion ist trotzdem
// vollstaendig, damit V3 nur noch fuellt und nicht auch noch die Schaltung nachbaut.

function syncEcosystemVisibility() {
	// `map` entsteht als Letztes (bootstrap.js laedt nach den map-features-Dateien); vor dem ersten
	// Kartenaufbau kann setSelectedMapLayerMode bereits laufen.
	if (typeof map === "undefined" || !map || !Array.isArray(ecosystemLayers)) {
		return;
	}

	const shouldShow = typeof getSelectedMapLayerMode === "function" && getSelectedMapLayerMode() === "ecosystem";
	ecosystemLayers.forEach((layer) => {
		if (!layer) {
			return;
		}

		const isOnMap = map.hasLayer(layer);
		if (shouldShow && !isOnMap) {
			layer.addTo(map);
			return;
		}

		if (!shouldShow && isOnMap) {
			map.removeLayer(layer);
		}
	});
}
