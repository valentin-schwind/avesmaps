"use strict";

(function initPoliticalTerritoryEditorSavePipeline() {
	const beforeSaveTransforms = [];
	const afterSaveHooks = [];
	let externalOnSave = null;
	let patchInstalled = false;

	function registerBeforeSaveTransform(transform) {
		if (typeof transform === "function" && !beforeSaveTransforms.includes(transform)) {
			beforeSaveTransforms.push(transform);
		}
	}

	function registerAfterSaveHook(hook) {
		if (typeof hook === "function" && !afterSaveHooks.includes(hook)) {
			afterSaveHooks.push(hook);
		}
	}

	function getParentWindow() {
		try {
			const host = window.AvesmapsEditorContext?.host?.();
				if (host) return host;
				return window.parent && window.parent !== window ? window.parent : null;
		} catch (error) {
			return null;
		}
	}

	function createParentCompletionController() {
		const parentWindow = getParentWindow();
		if (!parentWindow) {
			return {
				restore() {},
				complete() {},
			};
		}

		const originalClose = typeof parentWindow.closePoliticalTerritoryEditor === "function"
			? parentWindow.closePoliticalTerritoryEditor
			: null;
		let closeRequested = false;
		let restored = false;

		if (originalClose) {
			try {
				parentWindow.closePoliticalTerritoryEditor = function deferPoliticalTerritoryEditorClose() {
					closeRequested = true;
					// Der Save fordert den Close per setTimeout(0) an -> dieser Recorder kann
					// als Macrotask ERST NACH complete() feuern (das closeRequested synchron
					// prueft). Ist die Completion schon durch (restored), holen wir den echten
					// Close hier direkt nach, sonst bliebe der Editor nach dem Speichern offen.
					if (restored && originalClose) {
						try { parentWindow.setTimeout(originalClose, 0); }
						catch (error) { try { originalClose(); } catch (innerError) {} }
					}
				};
			} catch (error) {
				// If the parent cannot be patched, saving still continues normally.
			}
		}

		function restore() {
			if (restored) return;
			restored = true;
			if (originalClose) {
				try {
					parentWindow.closePoliticalTerritoryEditor = originalClose;
				} catch (error) {
					// Ignore restore failures; the iframe may already be detached.
				}
			}
		}

		function complete() {
			restore();
			try {
				if (typeof parentWindow.drawDerivedGeometryPreview === "function") {
					parentWindow.drawDerivedGeometryPreview(null);
				}
				if (typeof parentWindow.refreshPoliticalTerritoryEditorMapLayer === "function") {
					parentWindow.refreshPoliticalTerritoryEditorMapLayer();
				} else if (typeof parentWindow.schedulePoliticalTerritoryLayerReload === "function") {
					parentWindow.schedulePoliticalTerritoryLayerReload({ immediate: true });
				}
			} catch (error) {
				// Parent reload is best-effort; the save result remains authoritative.
			}

			if (closeRequested && originalClose) {
				try {
					parentWindow.setTimeout(originalClose, 0);
				} catch (error) {
					try { originalClose(); } catch (innerError) {}
				}
			}
		}

		return { restore, complete };
	}

	async function runBeforeSaveTransforms(value) {
		let nextValue = value;
		for (const transform of beforeSaveTransforms) {
			nextValue = await transform(nextValue);
		}
		return nextValue;
	}

	async function runAfterSaveHooks(context) {
		let nextResult = context.result;
		for (const hook of afterSaveHooks) {
			const hookResult = await hook({ ...context, result: nextResult });
			if (hookResult) {
				nextResult = hookResult;
			}
		}
		return nextResult;
	}

	async function saveWithPipeline(value) {
		if (typeof externalOnSave !== "function") {
			return value;
		}

		const completionController = createParentCompletionController();
		try {
			const transformedValue = await runBeforeSaveTransforms(value);
			const result = await externalOnSave(transformedValue);
			const finalResult = await runAfterSaveHooks({ value: transformedValue, originalValue: value, result });
			completionController.complete();
			return finalResult;
		} catch (error) {
			completionController.restore();
			throw error;
		}
	}

	function installOnAssignmentModule(module) {
		if (!module || patchInstalled || typeof module.configure !== "function") {
			return false;
		}

		const originalConfigure = module.configure.bind(module);
		module.configure = function configureWithSavePipeline(options = {}) {
			if (typeof options.onSave === "function" && options.onSave !== saveWithPipeline) {
				externalOnSave = options.onSave;
				return originalConfigure({ ...options, onSave: saveWithPipeline });
			}
			return originalConfigure(options);
		};
		patchInstalled = true;
		return true;
	}

	function installWhenReady() {
		const module = window.AvesmapsPoliticalTerritoryAssignment;
		if (installOnAssignmentModule(module)) {
			return;
		}
		window.setTimeout(installWhenReady, 50);
	}

	window.AvesmapsPoliticalTerritoryEditorSave = {
		registerBeforeSaveTransform,
		registerAfterSaveHook,
		runBeforeSaveTransforms,
		runAfterSaveHooks,
		saveWithPipeline,
		installOnAssignmentModule
	};

	installWhenReady();
})();
