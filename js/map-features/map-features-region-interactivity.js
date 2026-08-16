// Wer darf einen Klick fangen? -- die Entscheidung fuer JEDES Regionspolygon an EINER Stelle.
//
// 🔴 Im Bearbeiten-Modus sind abgeleitete Huellen absichtlich inert: der Klick soll die
// Quellgeometrie treffen, sonst landet update_geometry auf einer Derived-ID und antwortet
// „Geometrie nicht gefunden". Die Regel setzt voraus, dass unter der Huelle eine Quelle LIEGT.
// Fuer eine Huelle ohne jede Quelle gilt der Grund nicht -- dort ist nichts zu treffen, und ohne
// Ausnahme waere das Gebiet ueberhaupt nicht mehr erreichbar (Owner 16.08.2026).
//
// 💣 „Hat Quellen?" kommt vom SERVER und wird nie im Browser gezaehlt. Der Layer liefert je Huelle
// derived_source_geometry_public_ids (zwei Abfragen, is_active auf Geometrie UND Territorium).
// Wer stattdessen im Payload nachsieht, ob eine Quellflaeche mitgeliefert wurde, verwechselt
// „hat keine" mit „bei diesem Zoom nicht dabei": am 16.08.2026 waren das 111 gesunde Aggregate
// von 114 -- Kosch, Weiden, Nordmarken.

"use strict";

function avesmapsRegionDerivedIsSourceless(properties) {
	if (!properties || properties.is_derived_geometry !== true) {
		return false;
	}
	// Fehlt das Feld, ist das die Lage zwischen zwei Deploys: keine Aussage, also kein Geist.
	if (!Array.isArray(properties.derived_source_geometry_public_ids)) {
		return false;
	}
	return properties.derived_source_geometry_public_ids.length === 0;
}

function avesmapsRegionPolygonIsInteractive({ isEditMode, regionEntry, isAtActiveDisplayZoom, isAggregatedSourceFragment }) {
	const entry = regionEntry || {};
	if (isEditMode) {
		return entry.isDerivedGeometry !== true || entry.derivedIsSourceless === true;
	}
	return entry.source === "political_territory"
		&& isAtActiveDisplayZoom === true
		&& (entry.isDerivedGeometry === true || isAggregatedSourceFragment !== true);
}

// Welche Eintraege des Rechtsklick-Menues ergeben fuer diese Flaeche Sinn?
// Bei einer Huelle ohne Quelle sind Grenzen bearbeiten, Verschieben, Zerschneiden, Vereinigen und
// die drei Ausschneiden-Varianten sinnlos: sie alle arbeiten auf einer Quellgeometrie, und genau
// die fehlt. Uebrig bleibt, was am GEBIET haengt -- plus das Loeschen der Huelle selbst.
const AVESMAPS_REGION_SOURCELESS_HULL_ACTIONS = ["edit-properties", "show-info", "delete"];

function avesmapsRegionContextMenuPlan(regionEntry) {
	const entry = regionEntry || {};
	const isSourceless = entry.isDerivedGeometry === true && entry.derivedIsSourceless === true;
	return {
		// null heisst ausdruecklich „alles wie bisher" -- eine leere Liste hiesse „nichts zeigen".
		actions: isSourceless ? AVESMAPS_REGION_SOURCELESS_HULL_ACTIONS.slice() : null,
		// 🔴 Nur der Geist bekommt eine eigene Beschriftung. Gesunde Huellen behalten „Löschen" --
		// ihr Pfad wird von dieser Baustelle nicht angefasst.
		deleteLabel: isSourceless ? "Außenhülle löschen" : "Löschen",
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsRegionDerivedIsSourceless,
		avesmapsRegionPolygonIsInteractive,
		avesmapsRegionContextMenuPlan,
	};
}
