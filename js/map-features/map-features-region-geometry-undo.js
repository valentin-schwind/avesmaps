// Ctrl+Z for the TERRITORY geometry editor (owner 2026-07-26). Same rule as in the landscape editor:
// the key undoes local geometry steps while an edit is open, and the audit log is only ever undone by
// clicking "Rückgängig" on a named entry.
//
// 💣 THE HARD PART IS NOT THE KEY, IT IS THE NEIGHBOURS. Dragging a vertex here is not a local edit:
// applySharedBoundaryVertexMove (map-features-region-crud.js:49) walks every OTHER political region and
// moves the same corner wherever a shared boundary touches it, then saves each of them. An undo that
// restored only the edited region would leave those neighbours displaced -- with no visible trace,
// because their handles are not on screen. So one undo step is a LIST of regions, and every region the
// move touched goes into it.
//
// The step is opened BEFORE the mutation (the drag has not happened yet, so the edited region's rings
// are still pristine) and neighbours are appended DURING it, from inside applySharedBoundaryVertexMove,
// which is the only moment their pre-move state still exists.
//
// 🔴 Individual undo steps are NOT audit entries. Restoring writes through the normal
// saveRegionGeometry path, so the audit records "geometry changed" exactly as a drag would -- the steps
// in between never existed as far as the server is concerned. That is the owner's rule: the audit holds
// the central steps, Ctrl+Z holds the local ones.

const REGION_GEOMETRY_UNDO_LIMIT = 20;

// Deep copy of Leaflet's nested ring structure into plain {lat, lng} objects. Plain on purpose: a
// snapshot holding live L.LatLng instances would still be safe, but plain objects cannot be mistaken
// for something you may hand back to Leaflet without cloning, and setLatLngs accepts them unchanged.
function cloneRegionLatLngs(value) {
	if (Array.isArray(value)) {
		return value.map(cloneRegionLatLngs);
	}
	return { lat: Number(value?.lat), lng: Number(value?.lng) };
}

function regionGeometryUndoStack() {
	if (!activeRegionGeometryEdit) {
		return null;
	}
	// Created lazily rather than in startRegionGeometryEdit: that function is one of the seven the
	// detach-edit file re-assigns at runtime, and a field added there would exist only in whichever
	// copy happened to win.
	if (!Array.isArray(activeRegionGeometryEdit.undoStack)) {
		activeRegionGeometryEdit.undoStack = [];
	}
	return activeRegionGeometryEdit.undoStack;
}

// Opens a new step and puts the region that is about to change into it.
function pushRegionGeometryUndoStep(regionEntry) {
	const stack = regionGeometryUndoStack();
	const layer = regionEntry ? getRegionEditLayer(regionEntry) : null;
	if (!stack || !layer || typeof layer.getLatLngs !== "function") {
		return;
	}

	stack.push([{ regionEntry, layer, latLngs: cloneRegionLatLngs(layer.getLatLngs()) }]);
	while (stack.length > REGION_GEOMETRY_UNDO_LIMIT) {
		stack.shift();
	}
}

// Adds a region to the step that is currently open -- used for the neighbours a shared-boundary move
// drags along. Silently does nothing when no step is open (a shared move outside an edit session) and
// never records the same region twice within one step.
function addRegionGeometryUndoRegion(regionEntry, layer) {
	const stack = regionGeometryUndoStack();
	const step = stack?.[stack.length - 1];
	if (!step || !layer || typeof layer.getLatLngs !== "function") {
		return;
	}
	if (step.some((entry) => entry.layer === layer)) {
		return;
	}

	step.push({ regionEntry, layer, latLngs: cloneRegionLatLngs(layer.getLatLngs()) });
}

function undoRegionGeometryStep() {
	const stack = regionGeometryUndoStack();
	const step = stack?.pop();
	if (!step) {
		// Reaching past the first change of the session is a no-op, not an error.
		showFeedbackToast?.("Nichts mehr zum Rückgängigmachen.", "info");
		return false;
	}

	step.forEach(({ regionEntry, layer, latLngs }) => {
		if (!layer || typeof layer.setLatLngs !== "function") {
			return;
		}
		layer.setLatLngs(cloneRegionLatLngs(latLngs));
		if (regionEntry && typeof updateRegionLabelPosition === "function") {
			updateRegionLabelPosition(regionEntry);
		}
	});

	if (typeof clearRegionEditEdgeHover === "function") {
		clearRegionEditEdgeHover();
	}
	if (typeof refreshRegionEditHandles === "function") {
		refreshRegionEditHandles();
	}

	// 💣 Every region in the step is written back, not just the edited one -- the neighbours were saved
	// when the move happened, so leaving them out would make the undo look right on screen while the
	// database kept the moved boundary. Same trap as in the landscape editor, one layer up in cost:
	// here it is somebody else's territory.
	step.forEach(({ regionEntry }) => {
		if (regionEntry && typeof saveRegionGeometry === "function") {
			void saveRegionGeometry(regionEntry);
		}
	});

	return true;
}

// ---- the key ---------------------------------------------------------------------------------------
// Capture phase + stopImmediatePropagation, the same shape the landscape editor uses. Nothing competes
// for Ctrl+Z any more (the change-log binding was removed on the owner's rule), but a handler added
// later must not silently start receiving territory undos.
//
// 💣 isTextEditingShortcutTarget, NOT isTextEditingTarget -- the latter does not exist, and naming it
// wrong throws inside the listener BEFORE preventDefault(). Guarded with typeof so a missing global
// degrades to "the text check is skipped" instead of a thrown listener.
function isRegionGeometryUndoTextTarget(target) {
	if (typeof isTextEditingShortcutTarget === "function") {
		return isTextEditingShortcutTarget(target);
	}
	const element = target instanceof Element ? target : null;

	return Boolean(element?.isContentEditable || element?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

if (typeof document !== "undefined") {
	document.addEventListener("keydown", (event) => {
		// Only while a territory geometry edit is actually open. Outside one the key belongs to nobody
		// here -- and never to the audit log.
		if (typeof activeRegionGeometryEdit === "undefined" || !activeRegionGeometryEdit) { return; }
		const key = String(event.key || "").toLowerCase();
		if (key !== "z" || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) { return; }
		if (isRegionGeometryUndoTextTarget(event.target)) { return; }
		event.preventDefault();
		event.stopImmediatePropagation();
		undoRegionGeometryStep();
	}, true);
}
