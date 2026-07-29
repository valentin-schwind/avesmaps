// Gebündeltes Speichern für den TERRITORIEN-Editor (Owner 2026-07-29) -- dieselbe 800-ms-Regel, die
// der Landschaften-Editor seit V3.3 hat.
//
// 💣 WAS VORHER PASSIERTE: Jede gezogene Ecke war ein eigener POST -- plus je einer für jede
// Nachbarregion, die die geteilte Grenze mitgeschoben hat. Zehn Ecken an einer Grenze zwischen zwei
// Gebieten waren also zwanzig Schreibvorgänge, zwanzig Audit-Zeilen und zwanzig Zeilen im
// „Änderungen"-Fenster für eine einzige Handbewegung. Jetzt: ein Schreibvorgang je Gebiet, 800 ms nach
// dem letzten Loslassen.
//
// 🔴 DIE GEOMETRIE WIRD ERST BEIM SCHREIBEN GELESEN. saveRegionGeometry holt sie über
// regionLayerToGeoJsonGeometry aus dem LAYER, nicht aus einem Schnappschuss -- deshalb ist das Bündeln
// von sich aus richtig: Was gespeichert wird, ist der Stand am Ende der Bewegung, nicht der zum
// Zeitpunkt des Einreihens. Hier wird nur gemerkt, WELCHE Gebiete dran sind.
//
// ⚠️ Nicht für jede Speicherung. Verschieben, Zerschneiden und Herauslösen sind einzelne, bewusste
// Gesten und schreiben weiterhin sofort -- dort gibt es nichts zu bündeln, und eine Verzögerung wäre
// nur eine Verzögerung.

const REGION_GEOMETRY_SAVE_DEBOUNCE_MS = 800;

// Gebiete, die noch geschrieben werden müssen. Ein Set nach regionEntry: zehn Eckzüge an derselben
// Region sind ein Eintrag, und die Nachbarn, die eine geteilte Grenze mitgezogen hat, kommen als eigene
// Einträge dazu.
const regionGeometrySaveQueue = new Set();
let regionGeometrySaveTimeoutId = null;

function scheduleRegionGeometrySave(regionEntry) {
	if (!regionEntry) {
		return;
	}
	regionGeometrySaveQueue.add(regionEntry);

	if (regionGeometrySaveTimeoutId !== null) {
		window.clearTimeout(regionGeometrySaveTimeoutId);
	}
	regionGeometrySaveTimeoutId = window.setTimeout(() => {
		regionGeometrySaveTimeoutId = null;
		flushRegionGeometrySaves();
	}, REGION_GEOMETRY_SAVE_DEBOUNCE_MS);
}

// Schreibt alles Ausstehende sofort. Wird auch gerufen, wenn die Bearbeitung endet -- sonst verschluckte
// ein Schließen innerhalb der 800 ms den letzten Eckzug. Genau die Falle, die V3.3 bei den Landschaften
// schon einmal geschlossen hat.
function flushRegionGeometrySaves() {
	if (regionGeometrySaveTimeoutId !== null) {
		window.clearTimeout(regionGeometrySaveTimeoutId);
		regionGeometrySaveTimeoutId = null;
	}
	if (regionGeometrySaveQueue.size === 0) {
		return;
	}

	// Erst leeren, dann schreiben: ein Fehlschlag darf die Warteschlange nicht mit einer Zeile
	// zurücklassen, die beim nächsten Zug ein zweites Mal ginge.
	const pending = Array.from(regionGeometrySaveQueue);
	regionGeometrySaveQueue.clear();
	pending.forEach((regionEntry) => {
		if (typeof saveRegionGeometry === "function") {
			void saveRegionGeometry(regionEntry);
		}
	});
}

if (typeof window !== "undefined") {
	// Wegnavigieren innerhalb der 800 ms würde den letzten Zug verlieren. Das Absenden ist hier keine
	// Garantie -- der Browser darf die Anfrage noch abschneiden --, aber es ist deutlich besser als der
	// sichere Verlust, den Nichtstun bedeutet.
	window.addEventListener("pagehide", () => {
		flushRegionGeometrySaves();
	});
}
