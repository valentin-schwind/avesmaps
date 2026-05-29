(function initDerivedBoundaryContextAction() {
	"use strict";

	const ACTION = "refresh-derived-boundary";
	const PROGRESS_ID = "derived-boundary-context-progress";

	function ensureContextMenuButton() {
		const menu = document.getElementById("region-context-menu");
		if (!menu || menu.querySelector(`[data-region-context-action="${ACTION}"]`)) {
			return;
		}

		const propertiesButton = menu.querySelector('[data-region-context-action="edit-properties"]');
		const button = document.createElement("button");
		button.type = "button";
		button.className = "map-context-menu__item";
		button.dataset.regionContextAction = ACTION;
		button.textContent = "Außengrenzen erzeugen/aktualisieren";
		if (propertiesButton) {
			propertiesButton.insertAdjacentElement("afterend", button);
			return;
		}

		menu.appendChild(button);
	}

	function ensureProgressBox() {
		let box = document.getElementById(PROGRESS_ID);
		if (box) {
			return box;
		}

		box = document.createElement("div");
		box.id = PROGRESS_ID;
		box.className = "derived-boundary-context-progress";
		box.hidden = true;
		box.innerHTML = `
			<div class="derived-boundary-context-progress__panel" role="status" aria-live="polite">
				<strong>Außengrenze wird erzeugt</strong>
				<span class="derived-boundary-context-progress__message">Vorbereitung...</span>
				<progress max="100" value="0"></progress>
			</div>
		`;
		document.body.appendChild(box);
		injectProgressStyles();
		return box;
	}

	function injectProgressStyles() {
		if (document.getElementById("derived-boundary-context-progress-styles")) {
			return;
		}

		const style = document.createElement("style");
		style.id = "derived-boundary-context-progress-styles";
		style.textContent = `
			.derived-boundary-context-progress {
				position: fixed;
				left: 50%;
				bottom: 24px;
				z-index: 2400;
				transform: translateX(-50%);
				width: min(420px, calc(100vw - 32px));
				pointer-events: none;
			}
			.derived-boundary-context-progress__panel {
				display: grid;
				gap: 6px;
				padding: 12px 14px;
				border: 1px solid rgba(74, 54, 32, .35);
				border-radius: 10px;
				background: rgba(255, 250, 238, .96);
				box-shadow: 0 12px 28px rgba(35, 24, 12, .28);
				color: #3b2f1f;
				font-size: 13px;
			}
			.derived-boundary-context-progress__message {
				font-size: 12px;
				color: #6f5a3c;
			}
			.derived-boundary-context-progress progress {
				width: 100%;
				height: 10px;
			}
		`;
		document.head.appendChild(style);
	}

	function setProgress(message, value, visible = true) {
		const box = ensureProgressBox();
		const messageElement = box.querySelector(".derived-boundary-context-progress__message");
		const progressElement = box.querySelector("progress");
		if (messageElement) {
			messageElement.textContent = message || "";
		}
		if (progressElement) {
			progressElement.value = Math.max(0, Math.min(100, Number(value) || 0));
		}
		box.hidden = !visible;
	}

	function hideProgressSoon() {
		window.setTimeout(() => {
			const box = document.getElementById(PROGRESS_ID);
			if (box) {
				box.hidden = true;
			}
		}, 650);
	}

	function resolveBoundaryActionRegion(regionEntry) {
		if (!regionEntry || regionEntry.isDerivedGeometry === true) {
			return regionEntry;
		}

		const hiddenByTerritoryPublicId = String(regionEntry.hiddenByDerivedTerritoryPublicId || "").trim();
		if (hiddenByTerritoryPublicId) {
			const hiddenByRegion = findDerivedRegionByTerritoryPublicId(hiddenByTerritoryPublicId);
			if (hiddenByRegion) {
				return hiddenByRegion;
			}
		}

		const enclosingDerivedRegion = findSmallestEnclosingDerivedRegion(regionEntry);
		return enclosingDerivedRegion || regionEntry;
	}

	function findDerivedRegionByTerritoryPublicId(territoryPublicId) {
		return (regionData || []).map((feature) => normalizeRegionFeature(feature)).find((entry) => (
			entry.isDerivedGeometry === true
			&& String(entry.territoryPublicId || "").trim() === territoryPublicId
		)) || null;
	}

	function findSmallestEnclosingDerivedRegion(regionEntry) {
		const bounds = getRegionEntryBounds(regionEntry);
		const center = bounds?.getCenter?.();
		if (!bounds || !center) {
			return null;
		}

		const clickedTerritoryPublicId = String(regionEntry.territoryPublicId || regionEntry.publicId || "").trim();
		return (regionData || [])
			.map((feature) => normalizeRegionFeature(feature))
			.filter((entry) => entry.isDerivedGeometry === true)
			.map((entry) => {
				const renderedEntry = findRenderedRegionEntry(entry);
				const candidateBounds = getRegionEntryBounds(renderedEntry || entry);
				return { entry: renderedEntry || entry, bounds: candidateBounds, area: calculateBoundsArea(candidateBounds) };
			})
			.filter((candidate) => (
				candidate.bounds
				&& candidate.bounds.contains(center)
				&& String(candidate.entry.territoryPublicId || "").trim() !== clickedTerritoryPublicId
			))
			.sort((left, right) => left.area - right.area)[0]?.entry || null;
	}

	function findRenderedRegionEntry(regionEntry) {
		const territoryPublicId = String(regionEntry.territoryPublicId || "").trim();
		const geometryPublicId = String(regionEntry.geometryPublicId || regionEntry.publicId || "").trim();
		return regionPolygons
			.map((polygon) => polygon?._regionEntry)
			.find((entry) => entry && (
				String(entry.geometryPublicId || entry.publicId || "").trim() === geometryPublicId
				|| String(entry.territoryPublicId || "").trim() === territoryPublicId
			)) || null;
	}

	function calculateBoundsArea(bounds) {
		if (!bounds) {
			return Number.POSITIVE_INFINITY;
		}
		const west = bounds.getWest?.() ?? 0;
		const east = bounds.getEast?.() ?? 0;
		const south = bounds.getSouth?.() ?? 0;
		const north = bounds.getNorth?.() ?? 0;
		return Math.abs((east - west) * (north - south));
	}

	async function handleContextAction(event) {
		const actionElement = event.target?.closest?.(`[data-region-context-action="${ACTION}"]`);
		if (!actionElement) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();

		const clickedRegionEntry = activeRegionContextEntry;
		const targetRegionEntry = resolveBoundaryActionRegion(clickedRegionEntry);
		closeRegionContextMenu();
		if (!targetRegionEntry) {
			showFeedbackToast("Kein Herrschaftsgebiet ausgewählt.", "warning");
			return;
		}
		if (!window.AvesmapsDerivedBoundaryEditor?.generateOrUpdateForRegion) {
			showFeedbackToast("Boundary-Editor ist noch nicht geladen.", "warning");
			return;
		}

		try {
			const targetName = targetRegionEntry.name || "Herrschaftsgebiet";
			setProgress(`${targetName}: Boundary-Plan und Quellflächen werden geladen...`, 12, true);
			await window.AvesmapsDerivedBoundaryEditor.generateOrUpdateForRegion(targetRegionEntry, { drawPreview: false });
			setProgress(`${targetName}: Außengrenze gespeichert. Karte wird neu geladen...`, 100, true);
			hideProgressSoon();
		} catch (error) {
			console.error("Außengrenze konnte nicht erzeugt werden:", error);
			setProgress(error.message || "Außengrenze konnte nicht erzeugt werden.", 0, true);
			hideProgressSoon();
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", ensureContextMenuButton, { once: true });
	} else {
		ensureContextMenuButton();
	}
	document.addEventListener("click", (event) => {
		void handleContextAction(event);
	}, true);
})();
