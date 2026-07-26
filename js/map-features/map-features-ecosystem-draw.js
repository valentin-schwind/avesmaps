// Landschaften (Erprobung) -- drawing an area click by click (plan V3.2).
//
// 🔴 THE MOST EXPENSIVE SINGLE DECISION OF THIS FEATURE. There is no drawing tool in this house:
// createRegionAt() drops a hexagon of radius 10 and saves it immediately. Tracing the Farindel that
// way means bending six corners into shape -- 3 to 5 minutes an area, 42 hours for 500. Click by
// click it is 1 to 2 minutes, so 17. Nothing else in this program moves a number like that.
//
// Behaviour: a click sets a point, the preview runs with the cursor, DOUBLE-CLICK or ENTER finishes,
// ESCAPE cancels. 🔴 Nothing is written until the finish -- that is what keeps "hexagon corpses" out
// of the data, and it is why cancelling is free.
//
// 💣 Two things the template (map-features-path-creation.js:58-104) does NOT provide:
//  1. The rubber band is new. That file has no mousemove handler at all; updatePendingPathCreationLine
//     (:36-56) only draws through the points ALREADY placed. The line that follows the cursor -- and,
//     from the second point on, the closing line back to the start -- is the part that makes drawing
//     bearable, and it had to be built.
//  2. The template is blue: #1452F7 hardcoded at :28 and :48. Copied literally that would walk a
//     foreign UI colour into this layer against AGENTS.md §12. The draft uses --color-marker-active,
//     the token the map already uses for "this is the thing being worked on".
//
// 💣 A double-click fires click, click, dblclick. Without a guard the finishing gesture adds two more
// corners, the second one a pixel off the first -- a spur on every single area. The second click is
// swallowed by position and time below, so the first one still places its corner and dblclick only
// finishes. map.doubleClickZoom is switched off for the duration as well, otherwise finishing also
// zooms the map in.
//
// ⚠️ V3.3 (vertex editor) must NOT open the editing handles straight from the finish: the second
// click of the finishing double-click would land on a handle that has only just appeared, and that
// template's double-click DELETES a corner and saves. Finishing and opening the editor stay decoupled.

const ECOSYSTEM_DRAW_DOUBLE_CLICK_MS = 350;
const ECOSYSTEM_DRAW_DOUBLE_CLICK_PIXELS = 6;

let ecosystemDrawActive = false;
let ecosystemDrawPoints = [];
let ecosystemDrawLine = null;
let ecosystemDrawRubberBand = null;
let ecosystemDrawVertices = null;
let ecosystemDrawLastClick = null;
let ecosystemDrawSaving = false;
// Held when the finish finds no active region: the dialog opens, and a successful create_region
// resumes the save instead of throwing the outline away.
let ecosystemPendingAreaRing = null;

function isEcosystemDrawing() {
	return ecosystemDrawActive;
}

function ecosystemDraftColor() {
	return getComputedStyle(document.documentElement).getPropertyValue("--color-marker-active").trim();
}

// ---- preview ---------------------------------------------------------------------------------------

function clearEcosystemDrawPreview() {
	[ecosystemDrawLine, ecosystemDrawRubberBand, ecosystemDrawVertices].forEach((layer) => {
		if (layer && map.hasLayer(layer)) {
			map.removeLayer(layer);
		}
	});
	ecosystemDrawLine = null;
	ecosystemDrawRubberBand = null;
	ecosystemDrawVertices = null;
}

function updateEcosystemDrawPreview(cursorLatLng) {
	clearEcosystemDrawPreview();
	if (ecosystemDrawPoints.length === 0) {
		return;
	}

	const color = ecosystemDraftColor();
	if (ecosystemDrawPoints.length >= 2) {
		ecosystemDrawLine = L.polyline(ecosystemDrawPoints, {
			pane: "measurementPane",
			color,
			weight: 3,
			opacity: 0.95,
			interactive: false,
			lineCap: "round",
			lineJoin: "round",
		}).addTo(map);
	}

	// The rubber band: cursor -> and, from the second corner on, back to the start, so the shape that
	// would be created is visible BEFORE the finish rather than after it.
	if (cursorLatLng) {
		const band = [ecosystemDrawPoints[ecosystemDrawPoints.length - 1], cursorLatLng];
		if (ecosystemDrawPoints.length >= 2) {
			band.push(ecosystemDrawPoints[0]);
		}
		ecosystemDrawRubberBand = L.polyline(band, {
			pane: "measurementPane",
			color,
			weight: 2,
			opacity: 0.75,
			dashArray: "6 6",
			interactive: false,
		}).addTo(map);
	}

	// The first corner is drawn larger: it is the one the closing line runs to, and on a busy map it
	// is otherwise impossible to tell which one it was.
	ecosystemDrawVertices = L.layerGroup(
		ecosystemDrawPoints.map((point, index) => L.circleMarker(point, {
			pane: "measurementHandlesPane",
			radius: index === 0 ? 6 : 4,
			color,
			weight: 2,
			fillColor: "#ffffff",
			fillOpacity: 0.9,
			interactive: false,
		}))
	).addTo(map);
}

// ---- the gesture -----------------------------------------------------------------------------------

function isEcosystemDrawEchoClick(event) {
	const now = (typeof performance !== "undefined" ? performance.now() : 0);
	const containerPoint = event?.containerPoint;
	const previous = ecosystemDrawLastClick;
	ecosystemDrawLastClick = { containerPoint, at: now };
	if (!previous || !previous.containerPoint || !containerPoint) {
		return false;
	}

	return (now - previous.at) < ECOSYSTEM_DRAW_DOUBLE_CLICK_MS
		&& previous.containerPoint.distanceTo(containerPoint) <= ECOSYSTEM_DRAW_DOUBLE_CLICK_PIXELS;
}

function handleEcosystemDrawClick(event) {
	if (!ecosystemDrawActive || isEcosystemDrawEchoClick(event)) {
		return;
	}
	ecosystemDrawPoints.push(event.latlng);
	updateEcosystemDrawPreview(event.latlng);
}

function handleEcosystemDrawMouseMove(event) {
	if (ecosystemDrawActive && ecosystemDrawPoints.length > 0) {
		updateEcosystemDrawPreview(event.latlng);
	}
}

function handleEcosystemDrawDoubleClick(event) {
	if (!ecosystemDrawActive) {
		return;
	}
	if (event?.originalEvent) {
		L.DomEvent.stop(event);
	}
	void finishEcosystemAreaDrawing();
}

function handleEcosystemDrawKeydown(event) {
	if (!ecosystemDrawActive) {
		return;
	}
	if (event.key === "Escape") {
		event.stopPropagation();
		cancelEcosystemAreaDrawing("Zeichnen abgebrochen — es wurde nichts gespeichert.");
		return;
	}
	if (event.key === "Enter") {
		event.preventDefault();
		event.stopPropagation();
		void finishEcosystemAreaDrawing();
	}
}

// `startLatLng` (V3.4): the map context menu's three "Neue ..." entries sit in the "Hier hinzufügen"
// submenu, so "hier" has to mean something -- the right-clicked point becomes the first corner. Called
// without it (the "Fläche zeichnen" button) the tool starts empty exactly as before.
function startEcosystemAreaDrawing({ startLatLng = null } = {}) {
	if (typeof isEcosystemLayerModeActive !== "function" || !isEcosystemLayerModeActive() || ecosystemDrawActive) {
		return;
	}

	// V3.3: handles and drawing are never open at once -- a handle sits between the cursor and the map,
	// and a click on one would swallow the corner instead of placing it. Closed WITH a flush, so the last
	// dragged corner is written rather than dropped.
	if (typeof closeEcosystemGeometryEdit === "function") {
		closeEcosystemGeometryEdit({ flush: true });
		setSelectedEcosystemArea?.("");
	}

	ecosystemDrawActive = true;
	ecosystemDrawPoints = [];
	ecosystemDrawLastClick = null;
	map.doubleClickZoom.disable();
	map.getContainer().classList.add("ecosystem-draw-cursor");
	// Everything else on the map stays visible but stops taking clicks -- otherwise a click meant as a
	// corner lands on the river it crosses and never reaches map.on("click"). Same rule the vertex
	// editor uses; the CSS lives in ecosystem-layer.css.
	syncEcosystemMapEditingClass?.();
	map.on("click", handleEcosystemDrawClick);
	map.on("mousemove", handleEcosystemDrawMouseMove);
	map.on("dblclick", handleEcosystemDrawDoubleClick);
	document.addEventListener("keydown", handleEcosystemDrawKeydown, true);
	syncEcosystemDrawButton();
	// The seeded corner is set AFTER the handlers are live, so the preview is drawn by the same code path
	// a clicked corner uses -- and it is not run through the echo-click filter, because it is not a click:
	// the next real click has to count even if it lands on the same spot within 350 ms.
	if (startLatLng) {
		ecosystemDrawPoints.push(L.latLng(startLatLng));
		updateEcosystemDrawPreview(null);
	}
	showFeedbackToast?.("Klicken setzt Punkte. Doppelklick oder Enter schließt ab, Escape bricht ab.");
}

function stopEcosystemAreaDrawing() {
	ecosystemDrawActive = false;
	ecosystemDrawPoints = [];
	ecosystemDrawLastClick = null;
	clearEcosystemDrawPreview();
	if (typeof map !== "undefined" && map) {
		map.doubleClickZoom.enable();
		map.getContainer().classList.remove("ecosystem-draw-cursor");
		syncEcosystemMapEditingClass?.();
		map.off("click", handleEcosystemDrawClick);
		map.off("mousemove", handleEcosystemDrawMouseMove);
		map.off("dblclick", handleEcosystemDrawDoubleClick);
	}
	document.removeEventListener("keydown", handleEcosystemDrawKeydown, true);
	syncEcosystemDrawButton();
}

function cancelEcosystemAreaDrawing(message) {
	if (!ecosystemDrawActive) {
		return;
	}
	stopEcosystemAreaDrawing();
	ecosystemPendingAreaRing = null;
	if (message) {
		showFeedbackToast?.(message);
	}
}

async function finishEcosystemAreaDrawing() {
	if (!ecosystemDrawActive) {
		return;
	}

	// GeoJSON [x, y] -- L.CRS.Simple maps lat->y and lng->x, so the swap happens here and only here.
	const ring = normalizeEcosystemDrawnRing(ecosystemDrawPoints.map((point) => [point.lng, point.lat]));
	if (!ring) {
		showFeedbackToast?.("Eine Fläche braucht mindestens drei Punkte.", "warning");
		return;
	}

	stopEcosystemAreaDrawing();
	await saveEcosystemAreaRing(ring);
}

// ---- saving ----------------------------------------------------------------------------------------

async function saveEcosystemAreaRing(ring) {
	if (ecosystemDrawSaving) {
		return;
	}

	const regionPublicId = typeof getActiveEcosystemRegionId === "function" ? getActiveEcosystemRegionId() : "";
	if (!regionPublicId) {
		// The plan's rule: no active region leads into the dialog, NOT into a save that answers 400.
		// The outline waits here until the region exists.
		ecosystemPendingAreaRing = ring;
		showFeedbackToast?.("Zuerst eine Region wählen oder anlegen — die Fläche wartet solange.");
		openEcosystemRegionDialog?.();
		return;
	}

	// A self-crossing outline is repaired before it is sent; without the library or on a shape
	// polygon-clipping cannot handle, the drawn geometry goes as it is and the server validates.
	const geometry = repairEcosystemGeometry({ type: "Polygon", coordinates: [ring] });

	ecosystemDrawSaving = true;
	try {
		await postEcosystemEdit("create_area", { region_public_id: regionPublicId, geometry_geojson: geometry });
		ecosystemPendingAreaRing = null;
		// Rendered through the normal read path, never from the answer: one way onto the map, so a
		// drawn area and a reloaded one can never look or behave differently.
		scheduleEcosystemAreaReload?.({ immediate: true });
		showFeedbackToast?.("Fläche gespeichert.");
	} catch (error) {
		// The outline is kept, so the editor can pick a different region and try again instead of
		// re-drawing the whole thing.
		ecosystemPendingAreaRing = ring;
		showFeedbackToast?.(error?.message || "Die Fläche konnte nicht gespeichert werden.", "warning");
	} finally {
		ecosystemDrawSaving = false;
	}
}

// Called by the region dialog after a successful create_region (guarded there, so neither file has to
// exist for the other to work).
function resumePendingEcosystemAreaSave() {
	if (!ecosystemPendingAreaRing) {
		return;
	}
	const ring = ecosystemPendingAreaRing;
	ecosystemPendingAreaRing = null;
	void saveEcosystemAreaRing(ring);
}

// ---- the button ------------------------------------------------------------------------------------

function syncEcosystemDrawButton() {
	const button = document.getElementById("ecosystem-draw-toggle");
	if (!button) {
		return;
	}
	button.classList.toggle("is-active", ecosystemDrawActive);
	button.setAttribute("aria-pressed", ecosystemDrawActive ? "true" : "false");
	button.textContent = ecosystemDrawActive ? "Zeichnen abbrechen" : "Fläche zeichnen";
}

function toggleEcosystemAreaDrawing() {
	if (ecosystemDrawActive) {
		cancelEcosystemAreaDrawing("Zeichnen abgebrochen — es wurde nichts gespeichert.");
		return;
	}
	startEcosystemAreaDrawing();
}

document.addEventListener("click", (event) => {
	if (event.target?.closest?.("#ecosystem-draw-toggle")) {
		toggleEcosystemAreaDrawing();
	}
});
