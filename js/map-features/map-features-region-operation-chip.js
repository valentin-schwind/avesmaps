/*
 * Extracted region operation chip helper from js/map-features.js.
 * This file contains only function declarations and no top-level execution.
 */

// Nur die BOOLESCHEN Operationen suchen ein Zielgebiet per Klick. "split" setzt Schnittpunkte und
// "move" folgt der Maus -- beide brauchen die Fläche und dürfen nicht auf die Kontur verengt werden.
function isRegionOutlineTargetPickOperation(operation) {
	return ["union", "difference", "difference-keep-target", "intersection"].includes(String(operation || ""));
}

// Schaltet die Zielauswahl auf "nur Kontur" (CSS: .regions-pane--pick-outline, siehe
// css/features/political-timeline.css). Ohne das gewinnt immer die oberste Füllung, und alles, was
// unter der eigenen Quellfläche liegt, ist mit der Maus unerreichbar.
function syncRegionOutlineTargetPickMode() {
	const pane = typeof map !== "undefined" && typeof map?.getPane === "function"
		? map.getPane("regionsPane")
		: null;
	if (!pane) {
		return;
	}

	const active = !!pendingRegionOperation && isRegionOutlineTargetPickOperation(pendingRegionOperation.operation);
	pane.classList.toggle("regions-pane--pick-outline", active);

	// Zustandslos neu setzen statt die letzte Markierung mitzuführen: die Marke sitzt am
	// SVG-Element, und das überlebt einen Neuaufbau der Ebene nicht. Geht sie verloren, fängt die
	// Quelle ihren eigenen Konturklick wieder ab und meldet "Bitte eine andere Flaeche wählen" --
	// ein verständlicher Rückfall, kein Schaden.
	pane.querySelectorAll("path.region-operation-source").forEach((element) => {
		element.classList.remove("region-operation-source");
	});
	const sourceElement = active ? pendingRegionOperation.sourceLayer?.getElement?.() : null;
	if (sourceElement) {
		sourceElement.classList.add("region-operation-source");
	}
}

function syncRegionOperationChip() {
	// Vor den frühen Returns: der Maus-Modus hängt am selben Zustand wie der Chip, und diese
	// Funktion läuft bei JEDEM Wechsel (Start, Abbruch, Fertig, Fehler, Schnittpunkt). Stünde er
	// unten, bliebe die Karte im Kontur-Modus hängen, sobald das Chip-DOM fehlt.
	syncRegionOutlineTargetPickMode();

	const chipElement = document.getElementById("region-operation-chip");
	const textElement = document.getElementById("region-operation-chip-text");
	if (!chipElement || !textElement) {
		return;
	}

	if (!pendingRegionOperation) {
		chipElement.hidden = true;
		textElement.textContent = "";
		return;
	}

	const labels = {
		move: "Gebiet verschieben",
		split: "Gebiet zerschneiden",
		union: "Mit anderem vereinigen",
		difference: "Von anderem ausschneiden",
		"difference-keep-target": "Von anderem ausschneiden und anderes beibehalten",
		intersection: "Neues von anderem ausschneiden",
	};
	const instruction = pendingRegionOperation.operation === "split"
		? (pendingRegionOperation.points?.length === 1 ? "zweiten Schnittpunkt setzen." : "ersten Schnittpunkt setzen.")
		: pendingRegionOperation.operation === "move"
			? "Maus bewegen, Klick speichert."
			: "Kontur des Zielgebiets anklicken.";
	textElement.textContent = `${labels[pendingRegionOperation.operation] || "Operation"}: ${instruction}`;
	chipElement.hidden = false;
}
