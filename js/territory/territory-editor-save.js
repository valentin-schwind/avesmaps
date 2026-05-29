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

		const transformedValue = await runBeforeSaveTransforms(value);
		const result = await externalOnSave(transformedValue);
		return runAfterSaveHooks({ value: transformedValue, originalValue: value, result });
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
