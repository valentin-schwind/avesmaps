// Landschaften (Erprobung) -- the vertex editor (plan V3.3): DOUBLE-CLICK an area to edit its corners,
// dragging one is written 800 ms after the last release in ONE request, and Ctrl+Z takes corner moves
// back. A double-click anywhere else finishes.
//
// The template (map-features-region-edit-handles.js) was READ, not called -- global rule 1 keeps the
// political files at arm's length. Three deliberate departures from it, each one measured:
//
//  1. 💣 BATCHED SAVE. There, every dragged corner is its own POST plus a toast, and dragend
//     additionally saves every neighbouring region applySharedBoundaryVertexMove touched (:56-59).
//     Tracing a coastline that way is one write per corner. Here it is one write per gesture burst.
//  2. 💣 CTRL+CLICK ON AN EDGE SETS **ONE** CORNER. The template sets four (subdivideRegionEditHoveredEdge,
//     map-features-region-edit-edge-controls.js:209; the variant actually live at runtime calls it with
//     4 -- map-features-region-vertex-detach-edit.js:461). Four per click is the wrong grain for a
//     coastline: you get 4 where you wanted 1 and then delete 3.
//  3. 💣 UNDO STACK, 20 steps, in memory -- and an undo that changes an ALREADY SAVED geometry triggers a
//     NEW write. Without that the screen is right and the database is wrong, and an acceptance that only
//     looks at the screen would pass.
//
// 🔴 THE GESTURE IS A DOUBLE-CLICK, NOT THE SELECTION (owner 2026-07-26). A single click still only
// selects, as in V3.0. That is not just taste: opening on the SELECTION means the first click of a
// double-click raises the handles and the second one lands on a handle that has only just appeared --
// and a double-click on a handle deletes a corner. This is the same collision V3.2 flagged for the
// drawing tool. Opening on `dblclick` puts both clicks safely before the handles exist.
//
// 🔴 expected_revision IS MANDATORY (V2.3): missing -> 400, stale -> 409. It starts from
// layer._ecosystemArea.geometry_revision, and 💣 THE SECOND BATCHED SAVE OF A SESSION MUST SEND THE NEW
// ONE -- the server bumps it on every write, so re-sending the first value produces a 409 in the middle
// of drawing. The answer carries area.geometry_revision; it is taken from there and never assumed to
// have arrived through the loader.
//
// 🔴 GeoJSON on the wire is [x, y], UNSWAPPED. Leaflet's L.CRS.Simple is [lat, lng] = [y, x], so the
// session keeps GeoJSON as its single source of truth and converts to Leaflet through the existing
// ecosystemAreaLatLngs() on the way out. One direction only -- a round trip is where coordinate bugs
// come from.

const ECOSYSTEM_GEOMETRY_SAVE_DEBOUNCE_MS = 800;
const ECOSYSTEM_GEOMETRY_UNDO_LIMIT = 20;
// Ctrl+click closer than this to an edge (in map units, which L.CRS.Simple keeps linear) counts as a hit
// on that edge. Far enough away is not an edge click and is left alone.
const ECOSYSTEM_EDIT_EDGE_HIT_DISTANCE = 12;

// The open session, or null. The Ctrl+Z capture listener at the bottom of this file asks exactly this
// question -- it is what keeps the key with the audit undo whenever nothing is being edited.
let activeEcosystemGeometryEdit = null;
let ecosystemGeometrySaveTimeoutId = null;

// ---- pure ring maths (unit-tested in Node, see __tests__/ecosystem-edit.test.js) --------------------

// A GeoJSON ring repeats its first position as its last. That duplicate must never grow a handle of its
// own (two handles on one corner, one of which silently does nothing) and must follow corner 0 when it
// moves -- otherwise the ring tears open at exactly the corner being dragged.
function ecosystemEditRingIsClosed(ring) {
	if (!Array.isArray(ring) || ring.length < 2) {
		return false;
	}
	const first = ring[0];
	const last = ring[ring.length - 1];

	return Array.isArray(first) && Array.isArray(last) && first[0] === last[0] && first[1] === last[1];
}

// Corners a human sees and can grab -- the closing duplicate is not one of them.
function ecosystemEditVertexCount(ring) {
	if (!Array.isArray(ring)) {
		return 0;
	}

	return ring.length - (ecosystemEditRingIsClosed(ring) ? 1 : 0);
}

// Moves one corner in place. Corner 0 drags the closing duplicate with it.
function ecosystemEditSetVertex(ring, index, position) {
	if (!Array.isArray(ring) || !Array.isArray(position) || index < 0 || index >= ecosystemEditVertexCount(ring)) {
		return false;
	}

	// 💣 Asked BEFORE the write. Writing corner 0 first makes the ring look open (its new first position
	// no longer equals its unchanged last one), the duplicate is then never updated, and the ring tears
	// open at exactly the corner being dragged.
	const isClosed = ecosystemEditRingIsClosed(ring);
	ring[index] = [Number(position[0]), Number(position[1])];
	if (index === 0 && isClosed) {
		ring[ring.length - 1] = [Number(position[0]), Number(position[1])];
	}

	return true;
}

function ecosystemEditRingAt(geometry, partIndex, ringIndex) {
	const parts = typeof ecosystemGeometryParts === "function" ? ecosystemGeometryParts(geometry) : [];
	const part = parts[partIndex];

	return Array.isArray(part) && Array.isArray(part[ringIndex]) ? part[ringIndex] : null;
}

// Inserts ONE corner (departure 2). insertAt is the index it takes afterwards, so inserting into the
// segment between corner i and corner i+1 means insertAt = i + 1.
function ecosystemEditInsertVertex(geometry, { partIndex = 0, ringIndex = 0, insertAt = 0, position = null } = {}) {
	const ring = ecosystemEditRingAt(geometry, partIndex, ringIndex);
	if (!ring || !Array.isArray(position) || insertAt < 1 || insertAt > ring.length - 1) {
		return false;
	}

	ring.splice(insertAt, 0, [Number(position[0]), Number(position[1])]);
	return true;
}

// The counterpart to inserting. A ring below three corners is not a face any more, so the floor is
// enforced here rather than in the caller -- the same rule the template keeps at :87.
function ecosystemEditRemoveVertex(geometry, { partIndex = 0, ringIndex = 0, vertexIndex = 0 } = {}) {
	const ring = ecosystemEditRingAt(geometry, partIndex, ringIndex);
	const vertexCount = ecosystemEditVertexCount(ring);
	if (!ring || vertexCount <= 3 || vertexIndex < 0 || vertexIndex >= vertexCount) {
		return false;
	}

	const isClosed = ecosystemEditRingIsClosed(ring);
	ring.splice(vertexIndex, 1);
	// Removing corner 0 leaves the old closing duplicate pointing at a corner that no longer exists --
	// re-close against the new first one.
	if (vertexIndex === 0 && isClosed) {
		ring[ring.length - 1] = [ring[0][0], ring[0][1]];
	}

	return true;
}

// Nearest edge to a point, over every ring of every part -- hole boundaries included, because a hole's
// edge is an edge you can want another corner on. Returns where the new corner would go and where it
// would sit (the projection onto the segment, so the shape does not jump when the corner appears).
//
// The projection is written out here rather than borrowed from distanceToEcosystemEdge: that one answers
// "how far", this one has to answer "where", and a scalar cannot be turned back into a position.
function ecosystemEditNearestEdge(point, geometry) {
	const parts = typeof ecosystemGeometryParts === "function" ? ecosystemGeometryParts(geometry) : [];
	let best = null;

	parts.forEach((part, partIndex) => {
		(Array.isArray(part) ? part : []).forEach((ring, ringIndex) => {
			if (!Array.isArray(ring) || ring.length < 2) {
				return;
			}
			for (let index = 0; index < ring.length - 1; index += 1) {
				const start = ring[index];
				const end = ring[index + 1];
				const dx = end[0] - start[0];
				const dy = end[1] - start[1];
				const lengthSquared = (dx * dx) + (dy * dy);
				let t = lengthSquared > 0 ? (((point[0] - start[0]) * dx) + ((point[1] - start[1]) * dy)) / lengthSquared : 0;
				t = Math.max(0, Math.min(1, t));
				const projected = [start[0] + (t * dx), start[1] + (t * dy)];
				const distance = Math.hypot(point[0] - projected[0], point[1] - projected[1]);

				if (!best || distance < best.distance) {
					best = { partIndex, ringIndex, insertAt: index + 1, position: projected, distance };
				}
			}
		});
	});

	return best;
}

// Deep copy, capped at the limit. The copy is the point: a snapshot that shared arrays with the live
// geometry would follow every later drag and undo would restore the present.
function pushEcosystemGeometryUndoStep(stack, geometry, limit = ECOSYSTEM_GEOMETRY_UNDO_LIMIT) {
	if (!Array.isArray(stack) || !geometry) {
		return stack;
	}

	stack.push(JSON.parse(JSON.stringify(geometry)));
	while (stack.length > limit) {
		stack.shift();
	}

	return stack;
}

// ---- saying things ---------------------------------------------------------------------------------
// 🔴 THE HOUSE TOAST, NOT A COMPONENT OF ITS OWN (owner 2026-07-26). An earlier draft grew a private
// status chip at the bottom of the map; it was more furniture than the feature is worth. Everything
// here is a short, occasional message, which is exactly what showFeedbackToast is for -- and the
// handles on the map are themselves the permanent "you are editing this" signal, so no second one is
// needed. Quiet by design: no "saving …", no idle hint standing around, one line when something
// actually happened.
function sayEcosystemEdit(message, tone = "info") {
	if (typeof showFeedbackToast === "function" && message) {
		showFeedbackToast(message, tone);
	}
}

// ---- handles ---------------------------------------------------------------------------------------

function createEcosystemEditHandleIcon() {
	// The same dot the path and region editors use. Its blue is the documented "edit in progress"
	// exception in docs/design-language.md, not chrome -- reusing the class keeps that one exception in
	// one place instead of adding a fourth copy of the colour.
	return L.divIcon({
		className: "path-edit-handle-marker ecosystem-edit-handle-marker",
		html: '<span class="path-edit-handle-marker__dot"></span>',
		iconSize: [18, 18],
		iconAnchor: [9, 9],
	});
}

function clearEcosystemEditHandles() {
	if (!activeEcosystemGeometryEdit) {
		return;
	}
	activeEcosystemGeometryEdit.handles.forEach((handle) => {
		if (typeof map !== "undefined" && map && map.hasLayer(handle)) {
			map.removeLayer(handle);
		}
	});
	activeEcosystemGeometryEdit.handles = [];
}

function refreshEcosystemEditHandles() {
	const session = activeEcosystemGeometryEdit;
	if (!session || typeof map === "undefined" || !map) {
		return;
	}

	clearEcosystemEditHandles();
	const parts = ecosystemGeometryParts(session.geometry);
	parts.forEach((part, partIndex) => {
		(Array.isArray(part) ? part : []).forEach((ring, ringIndex) => {
			const vertexCount = ecosystemEditVertexCount(ring);
			for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
				const position = ring[vertexIndex];
				// GeoJSON [x, y] -> Leaflet [lat, lng] = [y, x].
				const handle = L.marker([Number(position[1]), Number(position[0])], {
					icon: createEcosystemEditHandleIcon(),
					pane: "measurementHandlesPane",
					draggable: true,
					keyboard: false,
					bubblingMouseEvents: false,
				}).addTo(map);

				handle.on("dragstart", () => {
					// The snapshot is taken BEFORE the move, so one undo is one corner move -- not the
					// dozens of mousemove states in between.
					pushEcosystemGeometryUndoStep(session.undoStack, session.geometry);
				});

				handle.on("drag", (event) => {
					const latLng = event.target.getLatLng();
					const targetRing = ecosystemEditRingAt(session.geometry, partIndex, ringIndex);
					if (ecosystemEditSetVertex(targetRing, vertexIndex, [latLng.lng, latLng.lat])) {
						applyEcosystemEditGeometryToLayer(session);
					}
				});

				handle.on("dragend", () => {
					// 💣 The whole point of this file: ONE write per gesture burst, not one per corner.
					scheduleEcosystemGeometrySave();
				});

				const element = handle.getElement?.();
				if (element) {
					// Without this a click on a handle also reaches the map and the area underneath.
					L.DomEvent.disableClickPropagation(element);
					L.DomEvent.disableScrollPropagation(element);
					// 💣 DELETING A CORNER HANGS ON A **NATIVE** LISTENER, NOT ON handle.on("dblclick").
					// Leaflet routes marker events through the MAP CONTAINER (addInteractiveTarget +
					// _fireDOMEvent), so the line above -- which is required -- cuts the Leaflet-level
					// dblclick off before it is ever dispatched. That is why the template carries both
					// (map-features-region-edit-handles.js:62 and :72); only the native one actually
					// runs. Registering just this one keeps it at one path and one deletion per gesture.
					element.addEventListener("dblclick", (event) => {
						event.preventDefault();
						event.stopPropagation();
						deleteEcosystemEditVertex(partIndex, ringIndex, vertexIndex);
					});
				}

				session.handles.push(handle);
			}
		});
	});
}

// The contour state (Owner 2026-07-26): selected is white, open-for-editing is the handle blue. Only the
// class is set here -- both colours live in the matrix in css/features/ecosystem-layer.css, so there is
// never a second set of values in JS to keep in step.
function applyEcosystemEditClass(layer, isEditing) {
	const element = typeof layer?.getElement === "function" ? layer.getElement() : null;
	element?.classList.toggle("ecosystem-area--editing", isEditing === true);
}

function applyEcosystemEditGeometryToLayer(session) {
	if (!session?.layer || typeof ecosystemAreaLatLngs !== "function") {
		return;
	}
	const latlngs = ecosystemAreaLatLngs(session.geometry);
	if (!latlngs) {
		return;
	}

	session.layer.setLatLngs(latlngs);
	if (typeof applyEcosystemSelectionClass === "function") {
		applyEcosystemSelectionClass(session.layer);
	}
	applyEcosystemEditClass(session.layer, true);
}

// ---- adding and deleting corners -------------------------------------------------------------------

function deleteEcosystemEditVertex(partIndex, ringIndex, vertexIndex) {
	const session = activeEcosystemGeometryEdit;
	if (!session) {
		return;
	}

	const before = JSON.parse(JSON.stringify(session.geometry));
	if (!ecosystemEditRemoveVertex(session.geometry, { partIndex, ringIndex, vertexIndex })) {
		sayEcosystemEdit("Eine Fläche braucht mindestens drei Ecken.", "warning");
		return;
	}

	pushEcosystemGeometryUndoStep(session.undoStack, before);
	applyEcosystemEditGeometryToLayer(session);
	refreshEcosystemEditHandles();
	scheduleEcosystemGeometrySave();
}

function handleEcosystemEditEdgeClick(event) {
	const session = activeEcosystemGeometryEdit;
	if (!session || !event?.originalEvent?.ctrlKey || !event.latlng) {
		return;
	}

	L.DomEvent.stop(event);
	// [lat, lng] -> GeoJSON [x, y].
	const point = [event.latlng.lng, event.latlng.lat];
	const edge = ecosystemEditNearestEdge(point, session.geometry);
	if (!edge || edge.distance > ECOSYSTEM_EDIT_EDGE_HIT_DISTANCE) {
		sayEcosystemEdit("Keine Kante in der Nähe — näher an den Rand klicken.", "warning");
		return;
	}

	const before = JSON.parse(JSON.stringify(session.geometry));
	// The corner lands on the edge, not under the cursor: a corner that jumps sideways the moment it
	// appears is impossible to place accurately. No toast -- the new handle is the feedback.
	if (!ecosystemEditInsertVertex(session.geometry, edge)) {
		return;
	}

	pushEcosystemGeometryUndoStep(session.undoStack, before);
	applyEcosystemEditGeometryToLayer(session);
	refreshEcosystemEditHandles();
	scheduleEcosystemGeometrySave();
}

// ---- saving --------------------------------------------------------------------------------------

function scheduleEcosystemGeometrySave() {
	const session = activeEcosystemGeometryEdit;
	if (!session) {
		return;
	}

	if (ecosystemGeometrySaveTimeoutId !== null) {
		window.clearTimeout(ecosystemGeometrySaveTimeoutId);
		ecosystemGeometrySaveTimeoutId = null;
	}

	// Back at the last state the server was told about -- most often an undo that cancels an unsaved
	// drag. Nothing to write, and nothing to announce.
	if (JSON.stringify(session.geometry) === session.savedGeometryJson) {
		return;
	}

	ecosystemGeometrySaveTimeoutId = window.setTimeout(() => {
		ecosystemGeometrySaveTimeoutId = null;
		void flushEcosystemGeometrySave();
	}, ECOSYSTEM_GEOMETRY_SAVE_DEBOUNCE_MS);
}

async function flushEcosystemGeometrySave() {
	const session = activeEcosystemGeometryEdit;
	if (!session || session.saving || typeof postEcosystemEdit !== "function") {
		return;
	}

	if (ecosystemGeometrySaveTimeoutId !== null) {
		window.clearTimeout(ecosystemGeometrySaveTimeoutId);
		ecosystemGeometrySaveTimeoutId = null;
	}

	const geometryJson = JSON.stringify(session.geometry);
	if (geometryJson === session.savedGeometryJson) {
		return;
	}

	session.saving = true;
	try {
		const result = await postEcosystemEdit("update_area_geometry", {
			public_id: session.publicId,
			expected_revision: session.revision,
			geometry_geojson: JSON.parse(geometryJson),
		});

		// 💣 THE BUNDLING TRAP. The server bumped geometry_revision; the NEXT batched save of this same
		// session has to send the new value or it gets a 409 in the middle of drawing. It is taken from
		// the answer, never from the loader -- the loader may not have run yet, and by the time it does
		// the second save has already gone out.
		const nextRevision = Number(result?.area?.geometry_revision);
		if (Number.isFinite(nextRevision) && nextRevision > 0) {
			session.revision = nextRevision;
		}
		// What we SENT, not what came back: the comparison above has to be exact, and the server may
		// legitimately return a normalized form. A superfluous save is harmless, a skipped one is loss.
		session.savedGeometryJson = geometryJson;

		// Keeping the registry row in step is what stops the next viewport reload from rebuilding this
		// layer underneath the open handles -- the loader compares exactly these two fields.
		if (session.layer?._ecosystemArea) {
			session.layer._ecosystemArea.geometry_revision = session.revision;
			session.layer._ecosystemArea.geometry = JSON.parse(geometryJson);
		}

		sayEcosystemEdit("Fläche gespeichert.");
	} catch (error) {
		if (error?.code === "conflict") {
			// Somebody else moved this area. Nothing local can be salvaged -- the read path decides.
			closeEcosystemGeometryEdit({ flush: false });
			sayEcosystemEdit(error.message || "Diese Fläche wurde inzwischen geändert.", "warning");
			scheduleEcosystemAreaReload?.({ immediate: true });
			return;
		}
		// The session stays open and the geometry stays unsaved, so the next drag schedules another
		// attempt instead of the work being silently gone.
		sayEcosystemEdit(error?.message || "Die Geometrie konnte nicht gespeichert werden.", "warning");
	} finally {
		session.saving = false;
	}
}

// ---- undo ------------------------------------------------------------------------------------------

function undoEcosystemGeometryStep() {
	const session = activeEcosystemGeometryEdit;
	if (!session) {
		return false;
	}

	const previous = session.undoStack.pop();
	if (!previous) {
		// Reaching past the first move of the session is a no-op, not an error (plan V3.3).
		sayEcosystemEdit("Nichts mehr zum Rückgängigmachen.");
		return false;
	}

	session.geometry = previous;
	applyEcosystemEditGeometryToLayer(session);
	refreshEcosystemEditHandles();
	// 💣 If the undone move had already been written (the 800 ms passed), this schedules a NEW write.
	// Otherwise the map would be right and the database wrong -- and an acceptance that only looks at
	// the screen would never notice. scheduleEcosystemGeometrySave itself decides: it compares against
	// what was last sent and stays quiet when the undo landed back on it.
	scheduleEcosystemGeometrySave();
	sayEcosystemEdit("Eckzug zurückgenommen.");
	return true;
}

// ---- session lifecycle -----------------------------------------------------------------------------

// Called from the area's dblclick (wired in map-features-ecosystem-rendering.js).
function openEcosystemGeometryEdit(publicId) {
	const areaId = String(publicId || "");
	// Selecting first, so an open session on ANOTHER area is closed and flushed through the usual hook
	// before this one is built -- and so the highlight and the handles always agree about the subject.
	if (typeof setSelectedEcosystemArea === "function") {
		setSelectedEcosystemArea(areaId);
	}
	closeEcosystemGeometryEdit({ flush: true });

	const layer = ecosystemLayers instanceof Map ? ecosystemLayers.get(areaId) : null;
	const area = layer?._ecosystemArea;
	const revision = Number(area?.geometry_revision);
	// 🔴 Without a revision there is no optimistic guard, and a save would answer 400. Better no handles
	// than handles whose every save fails.
	if (!layer || !area?.geometry || !Number.isFinite(revision) || revision < 1) {
		return;
	}

	const geometry = JSON.parse(JSON.stringify(area.geometry));
	activeEcosystemGeometryEdit = {
		publicId: areaId,
		layer,
		geometry,
		savedGeometryJson: JSON.stringify(geometry),
		revision,
		handles: [],
		undoStack: [],
		saving: false,
	};

	layer.on("click", handleEcosystemEditEdgeClick);
	if (typeof map !== "undefined" && map) {
		// A double-click elsewhere finishes (owner). Bound only for the length of the session, which
		// also sidesteps the "map is created last" problem -- by now it certainly exists.
		map.on("dblclick", handleEcosystemEditFinishDoubleClick);
		// Otherwise both the opening and the finishing gesture would zoom the map as well. Same reason
		// the drawing tool switches it off (map-features-ecosystem-draw.js).
		map.doubleClickZoom.disable();
	}

	applyEcosystemEditClass(layer, true);
	syncEcosystemMapEditingClass();
	refreshEcosystemEditHandles();
	sayEcosystemEdit("Ecken ziehen · Strg+Klick auf eine Kante setzt eine Ecke · Doppelklick löscht sie · Doppelklick daneben beendet.");
}

function closeEcosystemGeometryEdit({ flush = true } = {}) {
	const session = activeEcosystemGeometryEdit;
	if (!session) {
		return;
	}

	if (ecosystemGeometrySaveTimeoutId !== null) {
		window.clearTimeout(ecosystemGeometrySaveTimeoutId);
		ecosystemGeometrySaveTimeoutId = null;
	}

	clearEcosystemEditHandles();
	// Back to the white selection contour (or to none, when the deselect follows straight after).
	applyEcosystemEditClass(session.layer, false);
	session.layer?.off?.("click", handleEcosystemEditEdgeClick);
	if (typeof map !== "undefined" && map) {
		map.off("dblclick", handleEcosystemEditFinishDoubleClick);
		map.doubleClickZoom.enable();
	}

	if (flush && JSON.stringify(session.geometry) !== session.savedGeometryJson) {
		// Closing inside the 800 ms window must not drop the last gesture. The session object is still
		// referenced by the promise, so the write completes even though the handles are already gone.
		void flushEcosystemGeometrySave();
	}

	activeEcosystemGeometryEdit = null;
	syncEcosystemMapEditingClass();
}

// A double-click that did NOT land on an area finishes the session. A double-click ON an area never
// reaches here: its own handler stops the event, which is also what stops Leaflet from bubbling it to
// the map (Map._fireDOMEvent checks originalEvent._stopped).
function handleEcosystemEditFinishDoubleClick(event) {
	if (!activeEcosystemGeometryEdit) {
		return;
	}
	if (event?.originalEvent) {
		L.DomEvent.stop(event);
	}
	closeEcosystemGeometryEdit({ flush: true });
	if (typeof setSelectedEcosystemArea === "function") {
		setSelectedEcosystemArea("");
	}
	sayEcosystemEdit("Bearbeitung beendet.");
}

// Called from setSelectedEcosystemArea. It only ever CLOSES -- opening is the double-click's job
// (owner). Selecting another area, switching the layer, leaving the mode and clearing the registry all
// arrive here, so a session can never outlive the selection it belongs to.
function syncEcosystemGeometryEdit() {
	const publicId = typeof getSelectedEcosystemAreaPublicId === "function" ? getSelectedEcosystemAreaPublicId() : "";
	if (activeEcosystemGeometryEdit && activeEcosystemGeometryEdit.publicId !== publicId) {
		closeEcosystemGeometryEdit({ flush: true });
	}
}

// ---- letting go of a selection ---------------------------------------------------------------------
// Selecting an area was reachable from the start, dropping it was not: the only ways out were picking a
// DIFFERENT area, switching layer or leaving the mode (owner 2026-07-26). Both gestures below are the
// ones every map application uses, and both route through setSelectedEcosystemArea(""), so an open
// vertex session is closed AND flushed on the way out -- letting go never costs a dragged corner.

let ecosystemSelectionGesturesHooked = false;

// While an area is being drawn or its corners edited, the map is a drawing surface: everything else
// stays VISIBLE but stops taking clicks, so a river or a label cannot swallow the click meant for a
// vertex (Owner 2026-07-26). The whole rule set is one class in css/features/ecosystem-layer.css --
// nothing here enumerates panes, because that list would go stale.
function syncEcosystemMapEditingClass() {
	const container = typeof map !== "undefined" && map && typeof map.getContainer === "function" ? map.getContainer() : null;
	if (!container) {
		return;
	}

	const isEditing = Boolean(activeEcosystemGeometryEdit)
		|| (typeof isEcosystemDrawing === "function" && isEcosystemDrawing());
	container.classList.toggle("ecosystem-geometry-editing", isEditing);
}

function handleEcosystemMapClickDeselect() {
	// 💣 A click on an AREA never gets here: the layer's own handler stops the event, which is what
	// keeps Leaflet from bubbling it to the map. So reaching this point means empty map.
	if (typeof isEcosystemLayerModeActive !== "function" || !isEcosystemLayerModeActive()) {
		return;
	}
	// While the drawing tool runs, a click on the map is a CORNER, not a gesture about selection.
	if (typeof isEcosystemDrawing === "function" && isEcosystemDrawing()) {
		return;
	}
	if (typeof getSelectedEcosystemAreaPublicId !== "function" || !getSelectedEcosystemAreaPublicId()) {
		return;
	}

	setSelectedEcosystemArea("");
}

// Lazily, like hookEcosystemViewportReload: `map` is built LAST, after every map-features file has
// loaded, so there is no top-level moment at which map.on() could be called from here.
function hookEcosystemSelectionGestures() {
	if (ecosystemSelectionGesturesHooked || typeof map === "undefined" || !map || typeof map.on !== "function") {
		return;
	}
	ecosystemSelectionGesturesHooked = true;
	map.on("click", handleEcosystemMapClickDeselect);
}

// 🪤 There is deliberately NO second hook for "the loader rebuilt my layer". It looks necessary -- an
// open session holds ONE layer object -- but it can never fire: every rebuild and every removal goes
// through removeEcosystemAreaLayer, which deselects, and the deselect arrives here as
// syncEcosystemGeometryEdit and closes the session WITH a flush. A layer whose geometry_revision is
// unchanged keeps its object, so an undisturbed session is never touched. A hook would have been dead
// code that reads like a safety net.

// ---- Ctrl+Z ----------------------------------------------------------------------------------------
// 🔴 THE KEY IS NOW THIS FILE'S, AND ONLY THIS FILE'S (Owner 2026-07-26). It used to be shared with
// handleChangeLogUndoShortcut, which reverted the newest change-log entry server-side -- that binding is
// gone (js/app/bootstrap.js), because a near-miss there cost somebody else's edit while a near-miss here
// costs nothing. The rule now: the audit log is undone by clicking "Rückgängig" on the named entry and
// by nothing else; Ctrl+Z is local geometry editing, and only the resulting SAVE reaches the audit, not
// the individual steps.
//
// The listener still runs in the CAPTURE phase and still calls stopImmediatePropagation(): nothing is
// competing for the key today, but a keydown handler added later would otherwise silently start
// receiving corner undos. Same shape as the capture click listener in
// map-features-settlement-context-action.js:114-116 (that one is a click, the phase is the point).
//
// 💣 The function is isTextEditingShortcutTarget, NOT isTextEditingTarget -- the latter does not exist.
// Naming it wrong throws a ReferenceError BEFORE preventDefault(), which is why the typeof guard is
// here too: a missing global degrades to "the text check is skipped", never to a thrown listener.
function isEcosystemEditTextTarget(target) {
	if (typeof isTextEditingShortcutTarget === "function") {
		return isTextEditingShortcutTarget(target);
	}
	const element = target instanceof Element ? target : null;

	return Boolean(element?.isContentEditable || element?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

if (typeof document !== "undefined") {
	document.addEventListener("keydown", (event) => {
		const key = String(event.key || "").toLowerCase();
		if (key !== "z" || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) { return; }
		if (isEcosystemEditTextTarget(event.target)) { return; }

		// The key is claimed for the whole MODE, not just for an open session: a stroke that lands a
		// moment after the area was deselected should say "nothing happened", not fall through to the
		// browser's own undo or to whatever binds the key next.
		const session = activeEcosystemGeometryEdit;
		const inEcosystemMode = typeof isEcosystemLayerModeActive === "function" && isEcosystemLayerModeActive();
		if (!session && !inEcosystemMode) { return; }

		event.preventDefault();
		event.stopImmediatePropagation();
		if (session) {
			undoEcosystemGeometryStep();
			return;
		}
		// Deliberately says what DID NOT happen: the whole point is that the editor can tell "my undo
		// did nothing" from "my undo silently changed something else".
		sayEcosystemEdit("Keine Fläche in Bearbeitung — es wurde nichts rückgängig gemacht. Doppelklick auf eine Fläche öffnet ihre Ecken.");
	}, true);

	// Escape drops the selection (and with it an open vertex session). Deliberately does NOT
	// preventDefault or stop propagation: Escape is a shared key -- dialogs, the drawing tool and the
	// browser all answer to it -- and this is the quietest possible participant. It bails on every
	// other claimant rather than out-shouting them.
	document.addEventListener("keydown", (event) => {
		if (event.key !== "Escape") { return; }
		// The drawing tool owns Escape while it runs (it aborts the outline); its own listener is
		// registered on start, so it sits AFTER this one and would otherwise never see the key alone.
		if (typeof isEcosystemDrawing === "function" && isEcosystemDrawing()) { return; }
		if (typeof isEcosystemLayerModeActive !== "function" || !isEcosystemLayerModeActive()) { return; }
		if (isEcosystemEditTextTarget(event.target)) { return; }
		// An open dialog gets to close itself first; Escape means "the innermost thing", not "everything".
		if (document.getElementById("ecosystem-region-overlay")?.hidden === false) { return; }
		if (typeof getSelectedEcosystemAreaPublicId !== "function" || !getSelectedEcosystemAreaPublicId()) { return; }

		setSelectedEcosystemArea("");
	}, true);

	// Navigating away inside the 800 ms window would drop the last gesture. Firing the pending write now
	// is not a guarantee (the browser may still cut the request), but it is strictly better than the
	// certain loss of doing nothing.
	window.addEventListener("pagehide", () => {
		if (activeEcosystemGeometryEdit) {
			void flushEcosystemGeometrySave();
		}
	});
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		ecosystemEditRingIsClosed,
		ecosystemEditVertexCount,
		ecosystemEditSetVertex,
		ecosystemEditInsertVertex,
		ecosystemEditRemoveVertex,
		ecosystemEditNearestEdge,
		pushEcosystemGeometryUndoStep,
		ECOSYSTEM_GEOMETRY_UNDO_LIMIT,
	};
}
