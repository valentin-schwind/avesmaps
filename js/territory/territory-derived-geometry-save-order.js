"use strict";

(function installDerivedGeometryBeforeSaveHook() {
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
