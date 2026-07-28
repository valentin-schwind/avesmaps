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
	module.exports = { avesmapsDerivedBoundarySaveAction, avesmapsDerivedBoundaryInnerFlagOverride };
}
