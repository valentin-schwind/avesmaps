"use strict";

(function installPoliticalTerritoryEditorUiHints() {
	const DEFAULT_ZOOM_RULES = [
		["1 Ebene", "0–6"],
		["2 Ebenen", "0–1, 2–6"],
		["3 Ebenen", "0–1, 2–3, 4–6"],
		["4 Ebenen", "0–1, 2–2, 3–3, 4–6"],
		["5 Ebenen", "0–1, 2–2, 3–3, 4–4, 5–6"],
		["6+ Ebenen", "0–1, 2–2, 3–3, 4–4, 5–5, 6–6"]
	];

	function installDefaultZoomRulesTable() {
		if (document.getElementById("defaultZoomRulesTable")) {
			return;
		}

		const zoomFromInput = document.getElementById("zoomFromInput");
		const visibilitySection = zoomFromInput?.closest?.(".manual-data-section");
		if (!visibilitySection) {
			return;
		}

		const wrapper = document.createElement("div");
		wrapper.id = "defaultZoomRulesTable";
		wrapper.className = "zoom-rules-table";

		const title = document.createElement("div");
		title.className = "zoom-rules-title";
		title.textContent = "Default-Zoomregeln";
		wrapper.appendChild(title);

		const table = document.createElement("table");
		const thead = document.createElement("thead");
		const headerRow = document.createElement("tr");
		for (const label of ["Tiefe", "Zooms pro Ebene"]) {
			const cell = document.createElement("th");
			cell.textContent = label;
			headerRow.appendChild(cell);
		}
		thead.appendChild(headerRow);
		table.appendChild(thead);

		const tbody = document.createElement("tbody");
		for (const [depthLabel, ranges] of DEFAULT_ZOOM_RULES) {
			const row = document.createElement("tr");
			const depthCell = document.createElement("td");
			depthCell.textContent = depthLabel;
			const rangesCell = document.createElement("td");
			rangesCell.textContent = ranges;
			row.append(depthCell, rangesCell);
			tbody.appendChild(row);
		}
		table.appendChild(tbody);
		wrapper.appendChild(table);
		visibilitySection.appendChild(wrapper);
	}

	function install() {
		installDefaultZoomRulesTable();
	}

	window.AvesmapsPoliticalTerritoryEditorUiHints = {
		install,
		defaultZoomRules: DEFAULT_ZOOM_RULES.map(([depthLabel, ranges]) => ({ depthLabel, ranges }))
	};

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", install, { once: true });
	} else {
		install();
	}
})();
