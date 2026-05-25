/*
 * Extracted region operation chip helper from js/map-features.js.
 * This file contains only function declarations and no top-level execution.
 */

function syncRegionOperationChip() {
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
		 (pendingRegionOperation.points.length === 1  "zweiten Schnittpunkt setzen." : "ersten Schnittpunkt setzen.")
		: pendingRegionOperation.operation === "move"
			 "Maus bewegen, Klick speichert."
			: "Zielgebiet anklicken.";
	textElement.textContent = `${labels[pendingRegionOperation.operation] || "Operation"}: ${instruction}`;
	chipElement.hidden = false;
}
