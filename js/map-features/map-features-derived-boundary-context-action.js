// Welche abgeleitete Aussenhuelle umschliesst diesen Punkt? Rein, ohne DOM, ohne Leaflet --
// deshalb auch aus einem Test heraus pruefbar (__tests__/derived-boundary-ziel-punkt.test.js).
//
// 💣 GEPRUEFT WIRD DIE FLAECHE, NIE DAS UMHUELLENDE RECHTECK. Die Rechteck-Fassung hat am
// 25.08.2026 dreimal das falsche Reich gerechnet: ein Rechtsklick mitten in „Königsland Nostria“
// (358,4 / 543,2) landete beim „Fürstentum Albernia“, weil dessen Rechteck (x 330-428, y 476-561)
// KLEINER ist als Nostrias (x 313-443, y 528-623) und den Punkt mitueberdeckt -- Albernias Flaeche
// liegt dort nicht einmal in der Naehe. Gerechnet wurde daraufhin
// `Grafschaft Großer Fluss -> Fürstentum Albernia -> Kaiserreich`, waehrend Nostrias Huelle
// unveraendert stehenblieb; fuer den Editor sah es aus, als taete der Knopf nichts.
// 🪤 Fuenf Einheiten weiter noerdlich (Seegrafschaft Siebenwind, y 566,6) lag derselbe Klick knapp
// AUSSERHALB von Albernias Rechteck und traf richtig. Eine Regel, die an der Kante eines FREMDEN
// Rechtecks umschlaegt, ist keine Regel, sondern Glueckssache -- und genau das macht sie so schwer
// als Fehler erkennbar.
// ⚠️ KEIN Rueckfall auf die Rechteck-Suche, wenn der Punkttest nichts findet: „nichts“ ist dann die
// richtige Antwort. Der Aufrufer nimmt das angeklickte Gebiet, und dessen Blatt-Zweig zieht seine
// Vorfahren ohnehin nach (territory-derived-geometry-editor.js).
function avesmapsFindEnclosingDerivedTargetFeature(point, features, clickedTerritoryPublicId) {
	const pip = (typeof window !== "undefined" && window.AvesmapsPip) || null;
	if (!point || !Array.isArray(features) || !pip || typeof pip.pointInGeometry !== "function") {
		return null;
	}

	const clickedKey = String(clickedTerritoryPublicId || "").trim();
	let bestes = null;
	let besteFlaeche = Number.POSITIVE_INFINITY;
	for (const feature of features) {
		const properties = feature && feature.properties;
		if (!properties || properties.is_derived_geometry !== true || !feature.geometry) {
			continue;
		}
		// Das angeklickte Gebiet ist nie sein eigenes Ziel.
		if (String(properties.territory_public_id || "").trim() === clickedKey) {
			continue;
		}
		if (!pip.pointInGeometry(point, feature.geometry)) {
			continue;
		}
		// Liegen mehrere Huellen uebereinander (Grafschaft in Herzogtum in Reich), gewinnt die
		// innerste -- und die ist die mit der kleinsten ECHTEN Flaeche.
		const flaeche = avesmapsDerivedTargetGeometryArea(feature.geometry);
		if (flaeche < besteFlaeche) {
			besteFlaeche = flaeche;
			bestes = feature;
		}
	}
	return bestes;
}

// Echte Flaeche einer GeoJSON-Flaechengeometrie (Schnuersenkelformel). Loecher zaehlen ab,
// MultiPolygon zaehlt zusammen. Ohne Geometrie unendlich -- so ein Kandidat gewinnt nie.
function avesmapsDerivedTargetGeometryArea(geometry) {
	if (!geometry) {
		return Number.POSITIVE_INFINITY;
	}
	const polygone = geometry.type === "Polygon"
		? [geometry.coordinates]
		: (geometry.type === "MultiPolygon" ? geometry.coordinates : null);
	if (!Array.isArray(polygone)) {
		return Number.POSITIVE_INFINITY;
	}
	let summe = 0;
	for (const polygon of polygone) {
		if (!Array.isArray(polygon)) continue;
		polygon.forEach((ring, index) => {
			summe += (index === 0 ? 1 : -1) * avesmapsDerivedTargetRingArea(ring);
		});
	}
	return summe;
}

function avesmapsDerivedTargetRingArea(ring) {
	if (!Array.isArray(ring) || ring.length < 3) {
		return 0;
	}
	let doppelt = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		doppelt += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
	}
	return Math.abs(doppelt) / 2;
}
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
		button.textContent = "Grenzen berechnen";
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

	// Der Klickpunkt ist der ECHTE Rechtsklick (pendingContextMenuLatLng), nicht die Mitte der
	// angeklickten Flaeche. Bei einer konkaven Flaeche liegt deren Mitte nicht einmal in ihr selbst,
	// und der Editor hat auf einen Punkt gezeigt, nicht auf einen Schwerpunkt.
	// ⚠️ Leaflet fuehrt [lat, lng], GeoJSON [x, y] = [lng, lat] -- hier wird bewusst gedreht
	// (AGENTS.md §5).
	function readBoundaryActionClickPoint(regionEntry) {
		const latlng = typeof pendingContextMenuLatLng !== "undefined" && pendingContextMenuLatLng
			? pendingContextMenuLatLng
			: null;
		if (latlng && Number.isFinite(Number(latlng.lat)) && Number.isFinite(Number(latlng.lng))) {
			return [Number(latlng.lng), Number(latlng.lat)];
		}
		// Rueckfall nur, wenn kein Klickpunkt vorliegt (Aufruf aus dem Editor statt von der Karte).
		const center = getRegionEntryBounds(regionEntry)?.getCenter?.();
		return center ? [Number(center.lng), Number(center.lat)] : null;
	}

	function findSmallestEnclosingDerivedRegion(regionEntry) {
		const point = readBoundaryActionClickPoint(regionEntry);
		const clickedTerritoryPublicId = String(regionEntry?.territoryPublicId || regionEntry?.publicId || "").trim();
		const feature = avesmapsFindEnclosingDerivedTargetFeature(point, regionData || [], clickedTerritoryPublicId);
		if (!feature) {
			return null;
		}
		// Die gerenderte Fassung tragen Leaflet-Layer und Zustand -- der Aufrufer braucht sie.
		const entry = normalizeRegionFeature(feature);
		return findRenderedRegionEntry(entry) || entry;
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
			// Ganzer Teilbaum: recomputet auch Zwischen-Aggregatoren (sonst bleibt deren
			// eigene Außengrenze stale, wenn eine tiefer liegende Quelle geändert wurde).
			await window.AvesmapsDerivedBoundaryEditor.generateOrUpdateForRegion(targetRegionEntry, { drawPreview: false, applyToSubregions: true });
			setProgress(`${targetName}: Außengrenze gespeichert. Karte wird neu geladen...`, 100, true);
			hideProgressSoon();
		} catch (error) {
			console.error("Außengrenze konnte nicht erzeugt werden:", error);
			setProgress(error.message || "Außengrenze konnte nicht erzeugt werden.", 0, true);
			hideProgressSoon();
		}
	}

	// Ohne DOM (Node/Test) gibt es nichts zu verdrahten -- die reinen Bauteile oben stehen trotzdem.
	if (typeof document === "undefined") {
		return;
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

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsFindEnclosingDerivedTargetFeature,
		avesmapsDerivedTargetGeometryArea,
	};
}
