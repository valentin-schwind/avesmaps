// Landschaften (Erprobung) -- the vertex editor (plan V3.3): the SELECTED area grows handles, dragging
// a corner is written 800 ms after the last release in ONE request, and Ctrl+Z takes corner moves back.
//
// The template (map-features-region-edit-handles.js) was READ, not called -- global rule 1 keeps the
// political files at arm's length. Three deliberate departures from it, each one measured:
//
//  1. 💣 BATCHED SAVE. There, every dragged corner is its own POST plus a toast (2200 ms standing time,
//     ONE slot -- map-features.js:178/:198), and dragend additionally saves every neighbouring region
//     applySharedBoundaryVertexMove touched (:56-59). Tracing a coastline that way is one write per
//     corner and a toast queue nobody can read. Here: one write, 800 ms after the last release, and the
//     state lives in a quiet status line instead of the toast slot.
//  2. 💣 CTRL+CLICK ON AN EDGE SETS **ONE** CORNER. The template sets four (subdivideRegionEditHoveredEdge,
//     map-features-region-edit-edge-controls.js:209; the variant actually live at runtime calls it with
//     4 -- map-features-region-vertex-detach-edit.js:461). Four corners per click is the wrong grain for
//     a coastline: you get 4 where you wanted 1 and then delete 3.
//  3. 💣 UNDO STACK, 20 steps, in memory -- and an undo that changes an ALREADY SAVED geometry triggers a
//     NEW write. Without that the screen is right and the database is wrong, and an acceptance that only
//     looks at the screen would pass.
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
let ecosystemGeometryEditStatusTimeoutId = null;

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

// ---- the status line -------------------------------------------------------------------------------
// 🪤 NOT A NEW COMPONENT. #open-path-ends-chip already is this thing -- role="status" aria-live="polite",
// edit-only, bottom centre (where the eye is while drawing, not top), fully token-based
// (css/features/location-popups-markers.css:768ff). It belongs to the detached-path-ends feature and
// syncs itself from that state, so sharing the element would mean two features overwriting each other.
// This is the exact rebuild the plan permits, one slot higher so both can stand at once.

function setEcosystemEditStatus(text, tone = "info") {
	const chipElement = document.getElementById("ecosystem-edit-chip");
	const textElement = document.getElementById("ecosystem-edit-chip-text");
	if (!chipElement || !textElement) {
		return;
	}

	if (ecosystemGeometryEditStatusTimeoutId !== null) {
		window.clearTimeout(ecosystemGeometryEditStatusTimeoutId);
		ecosystemGeometryEditStatusTimeoutId = null;
	}

	if (!text) {
		chipElement.hidden = true;
		textElement.textContent = "";
		return;
	}

	textElement.textContent = text;
	chipElement.dataset.tone = tone;
	chipElement.hidden = false;
}

// The resting text of an open session: what the three gestures are. It comes back after every transient
// message, so the line is never empty while handles are on the map.
function ecosystemEditIdleStatusText() {
	return "Ecken ziehen · Strg+Klick auf eine Kante setzt eine Ecke · Doppelklick löscht sie · Strg+Z macht rückgängig";
}

function setEcosystemEditTransientStatus(text, tone = "info") {
	setEcosystemEditStatus(text, tone);
	ecosystemGeometryEditStatusTimeoutId = window.setTimeout(() => {
		ecosystemGeometryEditStatusTimeoutId = null;
		if (activeEcosystemGeometryEdit) {
			setEcosystemEditStatus(ecosystemEditIdleStatusText());
		} else {
			setEcosystemEditStatus("");
		}
	}, 2200);
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
}

// ---- adding and deleting corners -------------------------------------------------------------------

function deleteEcosystemEditVertex(partIndex, ringIndex, vertexIndex) {
	const session = activeEcosystemGeometryEdit;
	if (!session) {
		return;
	}

	const before = JSON.parse(JSON.stringify(session.geometry));
	if (!ecosystemEditRemoveVertex(session.geometry, { partIndex, ringIndex, vertexIndex })) {
		setEcosystemEditTransientStatus("Eine Fläche braucht mindestens drei Ecken.", "warning");
		return;
	}

	pushEcosystemGeometryUndoStep(session.undoStack, before);
	applyEcosystemEditGeometryToLayer(session);
	refreshEcosystemEditHandles();
	scheduleEcosystemGeometrySave();
}

function handleEcosystemEditEdgeClick(event) {
	const session = activeEcosystemGeometryEdit;
	// armed one tick after opening: the very click that SELECTED the area must not also add a corner,
	// and the second click of a double-click must not either.
	if (!session || !session.armed || !event?.originalEvent?.ctrlKey || !event.latlng) {
		return;
	}

	L.DomEvent.stop(event);
	// [lat, lng] -> GeoJSON [x, y].
	const point = [event.latlng.lng, event.latlng.lat];
	const edge = ecosystemEditNearestEdge(point, session.geometry);
	if (!edge || edge.distance > ECOSYSTEM_EDIT_EDGE_HIT_DISTANCE) {
		setEcosystemEditTransientStatus("Keine Kante in der Nähe — näher an den Rand klicken.", "warning");
		return;
	}

	const before = JSON.parse(JSON.stringify(session.geometry));
	// The corner lands on the edge, not under the cursor: a corner that jumps sideways the moment it
	// appears is impossible to place accurately.
	if (!ecosystemEditInsertVertex(session.geometry, edge)) {
		return;
	}

	pushEcosystemGeometryUndoStep(session.undoStack, before);
	applyEcosystemEditGeometryToLayer(session);
	refreshEcosystemEditHandles();
	scheduleEcosystemGeometrySave();
	setEcosystemEditTransientStatus("Ecke gesetzt.");
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
		setEcosystemEditStatus(ecosystemEditIdleStatusText());
		return;
	}

	setEcosystemEditStatus("Änderung wird gleich gespeichert …", "busy");
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
	setEcosystemEditStatus("Wird gespeichert …", "busy");
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

		setEcosystemEditTransientStatus("Gespeichert.");
	} catch (error) {
		if (error?.code === "conflict") {
			// Somebody else moved this area. Nothing local can be salvaged -- the read path decides.
			closeEcosystemGeometryEdit({ flush: false });
			setEcosystemEditTransientStatus(error.message || "Diese Fläche wurde inzwischen geändert.", "warning");
			scheduleEcosystemAreaReload?.({ immediate: true });
			return;
		}
		// The session stays open and the geometry stays unsaved, so the next drag schedules another
		// attempt instead of the work being silently gone.
		setEcosystemEditStatus(error?.message || "Die Geometrie konnte nicht gespeichert werden.", "warning");
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
		setEcosystemEditTransientStatus("Nichts mehr zum Rückgängigmachen.");
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
	setEcosystemEditTransientStatus("Eckzug zurückgenommen.");
	return true;
}

// ---- session lifecycle -----------------------------------------------------------------------------

function openEcosystemGeometryEdit(publicId) {
	const layer = ecosystemLayers instanceof Map ? ecosystemLayers.get(String(publicId || "")) : null;
	const area = layer?._ecosystemArea;
	const revision = Number(area?.geometry_revision);
	// 🔴 Without a revision there is no optimistic guard, and a save would answer 400. Better no handles
	// than handles whose every save fails.
	if (!layer || !area?.geometry || !Number.isFinite(revision) || revision < 1) {
		return;
	}

	closeEcosystemGeometryEdit({ flush: true });

	const geometry = JSON.parse(JSON.stringify(area.geometry));
	activeEcosystemGeometryEdit = {
		publicId: String(publicId),
		layer,
		geometry,
		savedGeometryJson: JSON.stringify(geometry),
		revision,
		handles: [],
		undoStack: [],
		saving: false,
		armed: false,
	};

	layer.on("click", handleEcosystemEditEdgeClick);
	// One tick later: the click that selected this area is still being dispatched, and it must not also
	// count as a Ctrl+click on an edge.
	window.setTimeout(() => {
		if (activeEcosystemGeometryEdit?.publicId === String(publicId)) {
			activeEcosystemGeometryEdit.armed = true;
		}
	}, 0);

	refreshEcosystemEditHandles();
	setEcosystemEditStatus(ecosystemEditIdleStatusText());
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
	session.layer?.off?.("click", handleEcosystemEditEdgeClick);

	if (flush && JSON.stringify(session.geometry) !== session.savedGeometryJson) {
		// Closing inside the 800 ms window must not drop the last gesture. The session object is still
		// referenced by the promise, so the write completes even though the handles are already gone.
		void flushEcosystemGeometrySave();
	}

	activeEcosystemGeometryEdit = null;
	setEcosystemEditStatus("");
}

// The one entry point: the selection IS the edit session (plan V3.3 -- "a selected area grows handles").
// Called from setSelectedEcosystemArea, so selecting, deselecting, switching layers and leaving the mode
// all arrive here without any of them having to know this file exists.
function syncEcosystemGeometryEdit() {
	const publicId = typeof getSelectedEcosystemAreaPublicId === "function" ? getSelectedEcosystemAreaPublicId() : "";
	if (activeEcosystemGeometryEdit?.publicId === publicId) {
		return;
	}

	if (!publicId) {
		closeEcosystemGeometryEdit({ flush: true });
		return;
	}
	openEcosystemGeometryEdit(publicId);
}

// 🪤 There is deliberately NO second hook for "the loader rebuilt my layer". It looks necessary -- an
// open session holds ONE layer object -- but it can never fire: every rebuild and every removal goes
// through removeEcosystemAreaLayer, which deselects, and the deselect arrives here as
// syncEcosystemGeometryEdit("") and closes the session WITH a flush. A layer whose geometry_revision is
// unchanged keeps its object, so an undisturbed session is never touched. A hook would have been dead
// code that reads like a safety net.

// ---- Ctrl+Z ----------------------------------------------------------------------------------------
// 🔴 THE KEY IS ALREADY TAKEN. handleChangeLogUndoShortcut (js/review/review-panels-change-log.js:364)
// undoes the last change-log entry SERVER-SIDE and consumes the key with preventDefault() +
// stopPropagation(); it is bound in js/app/bootstrap.js:516-518 through jQuery, so in the BUBBLE phase.
//
// Owner decision: Ctrl+Z belongs to the geometry stack ONLY while a landscape area is being edited --
// otherwise it stays with the audit undo. A capture-phase listener runs before the jQuery binding and
// calls stopImmediatePropagation(); the same shape as the capture click listener in
// map-features-settlement-context-action.js:114-116 (that one is a click, the phase is the point).
//
// 💣 The function is isTextEditingShortcutTarget, NOT isTextEditingTarget. Getting that wrong throws a
// ReferenceError BEFORE preventDefault(), the key falls through to the jQuery binding, and Ctrl+Z during
// a geometry edit silently undoes the last CHANGE-LOG entry instead of a corner move. Nothing on screen,
// real data loss elsewhere -- hence the typeof guard as well: a missing global degrades to "the text
// check is skipped", never to a thrown listener.
function isEcosystemEditTextTarget(target) {
	if (typeof isTextEditingShortcutTarget === "function") {
		return isTextEditingShortcutTarget(target);
	}
	const element = target instanceof Element ? target : null;

	return Boolean(element?.isContentEditable || element?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

if (typeof document !== "undefined") {
	document.addEventListener("keydown", (event) => {
		if (!activeEcosystemGeometryEdit) { return; }
		const key = String(event.key || "").toLowerCase();
		if (key !== "z" || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) { return; }
		if (isEcosystemEditTextTarget(event.target)) { return; }
		event.preventDefault();
		event.stopImmediatePropagation();
		undoEcosystemGeometryStep();
	}, true);

	document.addEventListener("click", (event) => {
		if (event.target?.closest?.("#ecosystem-edit-chip-done")) {
			closeEcosystemGeometryEdit({ flush: true });
			setSelectedEcosystemArea?.("");
		}
	});

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
