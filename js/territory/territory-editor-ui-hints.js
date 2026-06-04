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

	let derivedGeometryBreadcrumbSyncInstalled = false;
	let derivedGeometryBreadcrumbSyncTimer = null;
	let lastDerivedGeometryBreadcrumbTargetKey = "";

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

	function installAssignmentDropZoneStyle() {
		if (document.getElementById("assignmentDropZoneStyle")) {
			return;
		}

		const style = document.createElement("style");
		style.id = "assignmentDropZoneStyle";
		style.textContent = `
			.drop-zone.has-node {
				justify-content: stretch;
				text-align: left;
			}

			.drop-zone.has-node .dropped-node {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 10px;
				width: 100%;
				min-width: 0;
				box-sizing: border-box;
			}

			.drop-zone.has-node .dropped-node > div {
				min-width: 0;
			}

			.drop-zone.has-node .dropped-node-name,
			.drop-zone.has-node .dropped-node-kind {
				overflow-wrap: anywhere;
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

		// #1: Häkchen UNTER der Default-Zoomregeln-Tabelle. Setzt beim Speichern die depth-basierten
		// Default-Zoom-Bänder auf das gesamte vertikale Aggregat (Über- UND Unterregionen). Solange
		// aktiv, ist "Für alle Geschwisterregionen übernehmen" gesperrt (hier wird die ganze
		// Hierarchie gesetzt). Apply-Logik: territory-editor-inheritance.js (resetDefaultZoomToHierarchyCheckbox).
		if (!document.getElementById("resetDefaultZoomToHierarchyCheckbox")) {
			const resetLabel = document.createElement("label");
			resetLabel.className = "deferred-subtree-checkbox";
			const resetInput = document.createElement("input");
			resetInput.type = "checkbox";
			resetInput.id = "resetDefaultZoomToHierarchyCheckbox";
			const resetSpan = document.createElement("span");
			resetSpan.textContent = "Über- und Unterregionen auf diese Default-Zoomregeln zurücksetzen";
			resetLabel.append(resetInput, resetSpan);
			// In den Default-Zoomregeln-Container statt darunter.
			wrapper.appendChild(resetLabel);

			resetInput.addEventListener("change", () => {
				const siblingZoomCheckbox = document.getElementById("inheritZoomToDescendantsCheckbox");
				if (!siblingZoomCheckbox) {
					return;
				}
				siblingZoomCheckbox.disabled = resetInput.checked;
				if (resetInput.checked) {
					siblingZoomCheckbox.checked = false;
				}
			});
		}
	}

	function loadScriptOnce(src) {
		const editorAssetVersion = window.AvesmapsPoliticalTerritoryEditorInlineHost && window.AvesmapsPoliticalTerritoryEditorInlineHost.assetVersion;
		if (editorAssetVersion && src.indexOf("v=") < 0) {
			src += (src.indexOf("?") >= 0 ? "&" : "?") + "v=" + editorAssetVersion;
		}
		return new Promise((resolve, reject) => {
			const existingScript = document.querySelector(`script[src="${src}"]`);
			if (existingScript) {
				if (existingScript.dataset.loaded === "1") {
					resolve();
					return;
				}
				existingScript.addEventListener("load", () => resolve(), { once: true });
				existingScript.addEventListener("error", () => reject(new Error(`${src} konnte nicht geladen werden.`)), { once: true });
				return;
			}

			const script = document.createElement("script");
			script.src = src;
			script.onload = () => {
				script.dataset.loaded = "1";
				resolve();
			};
			script.onerror = () => reject(new Error(`${src} konnte nicht geladen werden.`));
			document.body.appendChild(script);
		});
	}

	function installDerivedGeometryEditorPanel() {
		void loadScriptOnce("/js/territory/territory-derived-geometry-source-context.js")
			.then(() => loadScriptOnce("/js/third-party/polygon-clipping.umd.min.js"))
			.then(() => loadScriptOnce("/js/territory/territory-derived-geometry-iframe-editor.js"))
			.then(installActiveBreadcrumbDerivedGeometrySync)
			.catch((error) => {
				console.warn("Derived-Geometry-Panel konnte nicht geladen werden:", error);
			});
	}

	function installActiveBreadcrumbDerivedGeometrySync() {
		const breadcrumb = document.getElementById("manualEditPath");
		if (!breadcrumb || derivedGeometryBreadcrumbSyncInstalled) {
			return;
		}

		derivedGeometryBreadcrumbSyncInstalled = true;

		const scheduleSync = () => {
			if (derivedGeometryBreadcrumbSyncTimer) {
				window.clearTimeout(derivedGeometryBreadcrumbSyncTimer);
			}

			derivedGeometryBreadcrumbSyncTimer = window.setTimeout(syncDerivedGeometryForActiveBreadcrumb, 0);
		};

		const observer = new MutationObserver(scheduleSync);
		observer.observe(breadcrumb, {
			attributes: true,
			attributeFilter: ["class"],
			childList: true,
			subtree: true
		});

		scheduleSync();
	}

	function syncDerivedGeometryForActiveBreadcrumb() {
		const editor = window.AvesmapsPoliticalDerivedGeometryEditor || null;
		const assignment = window.AvesmapsPoliticalTerritoryAssignment || null;

		if (typeof editor?.loadForCurrentTerritory !== "function" || typeof assignment?.getValue !== "function") {
			return;
		}

		const value = assignment.getValue();
		// A2: aktiven Breadcrumb-Knoten in den globalen Store publizieren (Sentinel: A2-PUBLISH-ACTIVE-NODE).
		// Quelle ist der echte activeDisplayNode (= createNodeReference(editedNode)), kein Fallback.
		window.AvesmapsEditorActiveNode?.set?.(value?.activeDisplayNode || null);
		const targetKey = typeof editor.getTargetKey === "function"
			? editor.getTargetKey(value)
			: "";

		if (targetKey && targetKey === lastDerivedGeometryBreadcrumbTargetKey) {
			return;
		}

		lastDerivedGeometryBreadcrumbTargetKey = targetKey || "";

		void editor.loadForCurrentTerritory(value).catch((error) => {
			console.warn("Derived-Geometry-Panel konnte nach Breadcrumb-Wechsel nicht synchronisiert werden:", error);
		});
	}

	function syncAssignmentDropZoneHint() {
		const dropZone = document.getElementById("dropZone");
		if (!dropZone) {
			return;
		}

		const hasAssignment = Boolean(dropZone.querySelector(".dropped-node"));
		const title = dropZone.querySelector(".drop-zone-title");

		if (hasAssignment && title) {
			title.remove();
		}
	}

	function installAssignmentDropZoneHintObserver() {
		const dropZone = document.getElementById("dropZone");
		if (!dropZone || dropZone.dataset.assignmentHintObserver === "1") {
			return;
		}

		dropZone.dataset.assignmentHintObserver = "1";
		syncAssignmentDropZoneHint();

		const observer = new MutationObserver(syncAssignmentDropZoneHint);
		observer.observe(dropZone, {
			childList: true,
			subtree: true
		});
	}

	function install() {
		installDefaultZoomRulesStyle();
		installAssignmentDropZoneStyle();
		installDefaultZoomRulesTable();
		installAssignmentDropZoneHintObserver();
		installDerivedGeometryEditorPanel();
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