"use strict";

(function initPoliticalTerritoryEditorInheritanceSync() {
	function getAssignmentValue() {
		return window.AvesmapsPoliticalTerritoryAssignment?.getValue?.() || null;
	}

	function getActiveBreadcrumbIndex() {
		const buttons = [...document.querySelectorAll("#manualEditPath button")];
		const activeIndex = buttons.findIndex(button => button.classList.contains("is-active"));
		return activeIndex >= 0 ? activeIndex : buttons.length - 1;
	}

	function syncInheritanceControls() {
		const value = getAssignmentValue();
		const path = Array.isArray(value?.assignedPath) ? value.assignedPath : [];
		const activeIndex = getActiveBreadcrumbIndex();
		const hasLowerBreadcrumb = activeIndex >= 0 && activeIndex < path.length - 1;
		const colorButton = document.getElementById("inheritColorVarianceButton");
		if (colorButton) {
			colorButton.hidden = !hasLowerBreadcrumb;
		}

		for (const id of ["inheritZoomToDescendantsCheckbox", "inheritColorToDescendantsCheckbox", "inheritOpacityToDescendantsCheckbox", "inheritValidityToDescendantsCheckbox"]) {
			const input = document.getElementById(id);
			const label = input?.closest(".deferred-subtree-checkbox");
			if (!input || !label) {
				continue;
			}

			label.hidden = !hasLowerBreadcrumb;
			if (!hasLowerBreadcrumb) {
				input.checked = false;
			}
		}

		if (!hasLowerBreadcrumb) {
			const preview = document.getElementById("deferredColorHierarchyPreview");
			if (preview) {
				preview.hidden = true;
			}
		}
	}

	function init() {
		const path = document.getElementById("manualEditPath");
		if (path) {
			new MutationObserver(syncInheritanceControls).observe(path, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["class"]
			});
		}

		[0, 150, 500, 1200].forEach(delay => window.setTimeout(syncInheritanceControls, delay));
		document.addEventListener("click", () => window.setTimeout(syncInheritanceControls, 0), true);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init, { once: true });
	} else {
		init();
	}
})();
