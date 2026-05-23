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

	function installDefaultZoomRulesStyle() {
		if (document.getElementById("defaultZoomRulesStyle")) {
			return;
		}

		const style = document.createElement("style");
		style.id = "defaultZoomRulesStyle";
		style.textContent = `
			.zoom-rules-table {
				margin-top: 10px;
				padding: 10px 12px;
				border: 1px solid #e4d4c2;
				border-radius: 8px;
				background: #fbf7f2;
				color: var(--muted, #6c5a49);
				font-size: 11px;
				line-height: 1.4;
				box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
			}

			.zoom-rules-title {
				margin-bottom: 6px;
				font-size: 11px;
				font-weight: 700;
				color: var(--text-strong, #3f3428);
				letter-spacing: 0.02em;
			}

			.zoom-rules-table table {
				width: 100%;
				border-collapse: collapse;
				font-size: 11px;
				line-height: 1.4;
			}

			.zoom-rules-table thead th {
				padding: 4px 6px 5px 0;
				border-bottom: 1px solid #e6d8c8;
				text-align: left;
				font-size: 10px;
				font-weight: 700;
				color: #5a4a3b;
				text-transform: uppercase;
				letter-spacing: 0.04em;
			}

			.zoom-rules-table tbody td {
				padding: 4px 6px 4px 0;
				border-bottom: 1px solid rgba(230, 216, 200, 0.65);
				vertical-align: top;
			}

			.zoom-rules-table tbody tr:last-child td {
				border-bottom: none;
			}

			.zoom-rules-table tbody td:first-child {
				width: 92px;
				white-space: nowrap;
				font-weight: 700;
				color: #4e4034;
			}

			.zoom-rules-table tbody td:last-child {
				color: #6f5d4c;
			}

			.zoom-rules-note {
				margin-top: 6px;
				font-size: 10px;
				color: #8a7968;
			}
		`;
		document.head.appendChild(style);
	}

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

		const note = document.createElement("div");
		note.className = "zoom-rules-note";
		note.textContent = "Diese Regeln gelten als Default für neue Breadcrumb-Zoomstufen.";
		wrapper.appendChild(note);

		visibilitySection.appendChild(wrapper);
	}

	function install() {
		installDefaultZoomRulesStyle();
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
