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
// Seit V3.0 ist das hier der EINE Eintrittspunkt der Ebene: setSelectedMapLayerMode ruft diese
// Funktion, und sie verteilt an Schalter (map-features-ecosystem-layer-switch.js) und Loader
// (map-features-ecosystem-loader.js). Beide sind mit typeof geschuetzt -- faellt eine der neuen
// Dateien einmal aus, verkommt derselbe Fall zu "der Erprobungsmodus tut nichts" statt zu einem
// ReferenceError, der jedem Besucher den Zustands-Restore mitreisst.

function syncEcosystemVisibility() {
	// `map` entsteht als Letztes (bootstrap.js laedt nach den map-features-Dateien); vor dem ersten
	// Kartenaufbau kann setSelectedMapLayerMode bereits laufen.
	if (typeof map === "undefined" || !map || !(ecosystemLayers instanceof Map)) {
		return;
	}

	// Drei Tore, nicht eins (Totmannschalter, Plan Regel 4): Modus UND Edit-Modus UND ?landschaften=1.
	const shouldShow = typeof isEcosystemLayerModeActive === "function" && isEcosystemLayerModeActive();

	if (typeof syncEcosystemControlsVisibility === "function") {
		syncEcosystemControlsVisibility();
	}

	if (!shouldShow) {
		// Ein laufendes Zeichnen gehoert zum Modus: der Moduswechsel beendet es, sonst haengen
		// Klick-/Tastatur-Handler weiter an einer Karte, auf der es keine Landschaftsebene mehr gibt.
		// Gespeichert wird dabei nichts -- der Entwurf ist bis zum Abschluss ohnehin fluechtig.
		if (typeof cancelEcosystemAreaDrawing === "function") {
			cancelEcosystemAreaDrawing();
		}
		// V3.3: eine offene Eckenbearbeitung gehoert ebenso zum Modus -- aber sie hat, anders als der
		// fluechtige Zeichenentwurf, echte Aenderungen. Deshalb wird sie GESCHLOSSEN UND GESCHRIEBEN,
		// bevor die Registry faellt: der Buendel-Save wartet bis zu 800 ms, und ein Moduswechsel in
		// diesem Fenster darf den letzten Eckzug nicht verschlucken. Vor clearEcosystemAreaLayers, weil
		// das die Auswahl loescht und die Sitzung dann nicht mehr weiss, welche Flaeche sie schreibt.
		if (typeof closeEcosystemGeometryEdit === "function") {
			closeEcosystemGeometryEdit({ flush: true });
		}
		// Modus verlassen -> eigene Registry leeren. 🔴 `regionPolygons` bleibt unangetastet.
		if (typeof clearEcosystemAreaLayers === "function") {
			clearEcosystemAreaLayers();
		}
		return;
	}

	if (typeof hookEcosystemViewportReload === "function") {
		hookEcosystemViewportReload();
	}
	// V3.3: Klick auf die leere Karte hebt die Auswahl auf. Genauso lazy wie der Zeilen darueber --
	// `map` entsteht als Letztes, ein map.on() zur Ladezeit gaebe es nicht.
	if (typeof hookEcosystemSelectionGestures === "function") {
		hookEcosystemSelectionGestures();
	}
	if (typeof scheduleEcosystemAreaReload === "function") {
		// Sofort: der Moduswechsel ist die Nutzeraktion, auf die eine leere Karte folgen wuerde. Die
		// Entprellung gilt dem Schwenken, nicht dem Einschalten.
		scheduleEcosystemAreaReload({ immediate: true });
	}
}
