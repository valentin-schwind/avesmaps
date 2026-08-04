"use strict";

// Decides what a territory save should do with the derived outer boundary.
// Two independent questions used to share one "dirty" flag, which caused bug #56:
// a plain save (colour, name, geometry assignment) never recomputed the boundary
// unless the editor had first clicked one of the boundary checkboxes.
//   - "delete"    only after a DELIBERATE un-tick in this editor session. The dirty guard is
//                 load-bearing here: opening the editor over a leaf node leaves the checkbox
//                 wrongly unchecked, and an ungated save would silently drop the boundary.
//   - "recompute" whenever the boundary is enabled - no checkbox click required (#56).
//   - "none"      unchecked and untouched: leave the stored boundary alone.
// Only real booleans count, so a half-initialised UI can never trigger a write.
function avesmapsDerivedBoundarySaveAction(options) {
	const enabled = options && options.enabled === true;
	const dirty = options && options.dirty === true;
	if (enabled) {
		return "recompute";
	}
	return dirty ? "delete" : "none";
}

// May this plan node have its own derived outer boundary, i.e. should the editor's
// "Aussengrenzen darstellen" checkbox stay usable?
// FAIL CLOSED on a missing node. No plan node means the plan could not resolve the target
// (a self-made tree node never resolves -- its key lives in wiki_territory_model, and the
// resolver only knows UUIDs and wiki keys) or the target has no source area yet. In both
// cases the save cannot produce a boundary, and answering "allowed" armed a checkbox whose
// save died server-side ("Die abgeleitete Geometrie braucht ein gespeichertes
// Ziel-Herrschaftsgebiet") and took the whole assignment save down with it -- the editor
// could then never assign anything (Alt-Gareth, 2026-08-04).
// Locking cannot destroy a stored boundary: the delete branch additionally requires
// hasActiveBoundary, which a missing node never reports.
// NOTE: isOwnDerivedBoundaryForbidden() in territory-derived-geometry-editor.js looks the
// same but stays FAIL OPEN on purpose -- it guards a delete, where "unknown" must never
// mean "throw it away". Do not unify the two without keeping that difference.
function avesmapsDerivedBoundaryOuterBoundaryForbidden(node) {
	if (!node || typeof node !== "object") {
		return true;
	}
	const isRoot = Number(node.parent_id || 0) === 0;
	const isPureAggregate = Number(node.direct_geometry_count || 0) === 0
		&& Number(node.child_boundary_source_count || 0) > 0;
	return !isRoot && !isPureAggregate;
}

// Should the save hand an explicit show_inner_boundaries flag down to the cascade engine?
// Only when the editor actually touched the boundary controls in this session. On a plain save the
// "Innengrenzen darstellen" checkbox is not a mirror of the stored value -- updateInnerBoundaryControl()
// force-unchecks it for leaf and last-breadcrumb nodes -- so passing it would clobber a stored
// "inner boundaries on" back to off. undefined lets the engine keep what is stored.
function avesmapsDerivedBoundaryInnerFlagOverride(options) {
	if (!options || options.touched !== true) {
		return undefined;
	}
	return options.canShowInner === true && options.checked === true;
}

(function installDerivedGeometryBeforeSaveHook() {
	if (typeof document === "undefined" || typeof window === "undefined") {
		return;
	}

	function installWhenReady() {
		const savePipeline = window.AvesmapsPoliticalTerritoryEditorSave;
		const derivedEditor = window.AvesmapsPoliticalDerivedGeometryEditor;
		if (!savePipeline?.registerBeforeSaveTransform || !derivedEditor?.saveIfNeeded) {
			window.setTimeout(installWhenReady, 50);
			return;
		}

		if (savePipeline.__avesmapsDerivedGeometryBeforeSaveInstalled === true) {
			return;
		}
		savePipeline.__avesmapsDerivedGeometryBeforeSaveInstalled = true;

		savePipeline.registerBeforeSaveTransform(async (value) => {
			window.__avesmapsDerivedGeometrySavedBeforeMainAssignment = true;
			await derivedEditor.saveIfNeeded({ value });
			return value;
		});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", installWhenReady, { once: true });
	} else {
		installWhenReady();
	}
})();

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsDerivedBoundarySaveAction,
		avesmapsDerivedBoundaryInnerFlagOverride,
		avesmapsDerivedBoundaryOuterBoundaryForbidden,
	};
}
